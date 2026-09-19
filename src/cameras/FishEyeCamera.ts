import * as THREE from 'three';
import { FISH_LENGTH_M } from '../config';
import type { Salmon } from '../fish/Salmon';

/** Underwater clear / OOB tint — matches river scene fog, not black void. */
export const UNDERWATER_TINT = 0x0b1a24;
const UNDERWATER_RGB = { r: 0.043, g: 0.102, b: 0.141 }; // 0x0b1a24

/**
 * Fish-eye mode: wide FOV + barrel distortion (shader on full-screen quad).
 * Camera mounts at/near the head looking forward; fish body is on a hidden layer.
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
    // Near plane tuned for head-mounted view into the corridor ahead
    this.camera = new THREE.PerspectiveCamera(105, aspect, 0.12, 150);
    this.camera.layers.enable(0);
    this.camera.layers.disable(1); // hide fish body layer

    this.renderTarget = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });

    const material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.renderTarget.texture },
        strength: { value: 0.42 },
        oobColor: {
          value: new THREE.Color(UNDERWATER_RGB.r, UNDERWATER_RGB.g, UNDERWATER_RGB.b),
        },
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
        uniform vec3 oobColor;
        varying vec2 vUv;
        void main() {
          vec2 c = vUv * 2.0 - 1.0;
          float r2 = dot(c, c);
          vec2 d = c * (1.0 + strength * r2);
          vec2 uv = d * 0.5 + 0.5;
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
            gl_FragColor = vec4(oobColor, 1.0);
          } else {
            gl_FragColor = texture2D(tDiffuse, uv);
          }
        }
      `,
    });

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(UNDERWATER_TINT);
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
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(fish.orientation);
    // Mount just ahead of the snout so we are not inside the mesh
    const headFwd = FISH_LENGTH_M * 0.48;
    const headUp = FISH_LENGTH_M * 0.04;
    const desired = fish.position
      .clone()
      .addScaledVector(forward, headFwd)
      .addScaledVector(up, headUp);

    if (!this.initialized) {
      this.currentPos.copy(desired);
      this.initialized = true;
    } else {
      const k = 1 - Math.exp(-10 * dt);
      this.currentPos.lerp(desired, k);
    }

    this.camera.position.copy(this.currentPos);
    const look = this.currentPos.clone().addScaledVector(forward, 6);
    this.camera.up.copy(up);
    this.camera.lookAt(look);
    this.camera.fov = 105;
    this.camera.updateProjectionMatrix();
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    const prevClear = new THREE.Color();
    renderer.getClearColor(prevClear);
    const prevAlpha = renderer.getClearAlpha();
    renderer.setClearColor(UNDERWATER_TINT, 1);

    renderer.setRenderTarget(this.renderTarget);
    renderer.clear(true, true, true);
    renderer.render(scene, this.camera);
    renderer.setRenderTarget(null);

    renderer.setClearColor(prevClear, prevAlpha);
    renderer.render(this.distortionPass.scene, this.distortionPass.camera);
  }

  dispose(): void {
    this.renderTarget.dispose();
    this.distortionPass.material.dispose();
  }
}

export type CameraMode = 'follow' | 'fisheye';
