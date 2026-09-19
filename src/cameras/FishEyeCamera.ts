import * as THREE from 'three';
import type { Salmon } from '../fish/Salmon';

/**
 * Fish-eye mode: wide FOV + barrel distortion (shader on full-screen quad).
 * Camera sits just behind the head looking forward.
 */
export class FishEyeCamera {
  readonly camera: THREE.PerspectiveCamera;
  readonly distortionPass: {
    scene: THREE.Scene;
    camera: THREE.OrthographicCamera;
    material: THREE.ShaderMaterial;
  };
  private readonly renderTarget: THREE.WebGLRenderTarget;
  private initialized = false;
  private readonly currentPos = new THREE.Vector3();

  constructor(aspect: number, width: number, height: number) {
    this.camera = new THREE.PerspectiveCamera(110, aspect, 0.05, 150);
    this.renderTarget = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });

    const material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.renderTarget.texture },
        strength: { value: 0.45 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float strength;
        varying vec2 vUv;
        void main() {
          vec2 c = vUv * 2.0 - 1.0;
          float r2 = dot(c, c);
          vec2 d = c * (1.0 + strength * r2);
          vec2 uv = d * 0.5 + 0.5;
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
            gl_FragColor = vec4(0.02, 0.05, 0.08, 1.0);
          } else {
            gl_FragColor = texture2D(tDiffuse, uv);
          }
        }
      `,
    });

    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(quad);

    this.distortionPass = { scene, camera: cam, material };
  }

  setSize(width: number, height: number, aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.renderTarget.setSize(width, height);
  }

  update(dt: number, fish: Salmon): void {
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(fish.orientation);
    const desired = fish.position
      .clone()
      .addScaledVector(forward, 0.15)
      .add(new THREE.Vector3(0, 0.08, 0));

    if (!this.initialized) {
      this.currentPos.copy(desired);
      this.initialized = true;
    } else {
      const k = 1 - Math.exp(-8 * dt);
      this.currentPos.lerp(desired, k);
    }

    this.camera.position.copy(this.currentPos);
    const look = fish.position.clone().addScaledVector(forward, 4);
    this.camera.lookAt(look);
    this.camera.fov = 110;
    this.camera.quaternion.copy(fish.orientation);
    // Re-apply look to avoid roll lock issues
    this.camera.lookAt(look);
    this.camera.updateProjectionMatrix();
    void dt;
  }

  render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
  ): void {
    renderer.setRenderTarget(this.renderTarget);
    renderer.render(scene, this.camera);
    renderer.setRenderTarget(null);
    renderer.render(this.distortionPass.scene, this.distortionPass.camera);
  }

  dispose(): void {
    this.renderTarget.dispose();
    this.distortionPass.material.dispose();
  }
}

export type CameraMode = 'follow' | 'fisheye';
