import * as THREE from 'three';
import { FISH_LENGTH_M } from '../config';
import type { Salmon } from '../fish/Salmon';
import type { RiverEnvironment } from '../env/River';

/** Underwater clear / OOB tint — matches river scene fog, not black void. */
export const UNDERWATER_TINT = 0x0b1a24;

/**
 * Fish-eye mode: wide-FOV head-mounted POV rendered **direct to screen**
 * (same path as follow cam). Barrel-distortion RT pass is optional and
 * default-off (v1.2a black-screen artifact).
 *
 * Camera mounts at/near the head looking forward; fish body stays on FISH_LAYER
 * (hidden from this camera). Position is clamped into free-water volume.
 */
export class FishEyeCamera {
  /** Leave false until a non-black RT/post path is validated. */
  static ENABLE_BARREL_DISTORTION = false;

  readonly camera: THREE.PerspectiveCamera;
  /** Dead / optional post path — only allocated when flag is on. */
  readonly distortionPass: {
    scene: THREE.Scene;
    camera: THREE.OrthographicCamera;
    material: THREE.ShaderMaterial;
  } | null = null;
  private readonly renderTarget: THREE.WebGLRenderTarget | null = null;
  private initialized = false;
  private readonly currentPos = new THREE.Vector3();

  constructor(aspect: number, width: number, height: number) {
    this.camera = new THREE.PerspectiveCamera(105, aspect, 0.12, 150);
    this.camera.layers.enable(0);
    this.camera.layers.disable(1); // hide fish body layer

    if (FishEyeCamera.ENABLE_BARREL_DISTORTION) {
      this.renderTarget = new THREE.WebGLRenderTarget(width, height, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      });
      const UNDERWATER_RGB = { r: 0.043, g: 0.102, b: 0.141 };
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
  }

  setSize(width: number, height: number, aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.renderTarget?.setSize(width, height);
  }

  update(dt: number, fish: Salmon, river?: RiverEnvironment): void {
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

    // Keep POV inside free-water envelope (bed / banks / surface) so the
    // camera cannot embed in geometry and paint a black / clipped view.
    if (river) {
      river.clampIntoFreeWater(this.currentPos, 0.28);
    }

    this.camera.position.copy(this.currentPos);
    const look = this.currentPos.clone().addScaledVector(forward, 6);
    if (river) {
      // Soft-clamp look target vertically so lookAt doesn't yank into bed/surface
      const lookClamp = look.clone();
      river.clampIntoFreeWater(lookClamp, 0.2);
      look.y = lookClamp.y;
    }
    this.camera.up.copy(up);
    this.camera.lookAt(look);
    this.camera.fov = 105;
    this.camera.updateProjectionMatrix();
  }

  /** Direct-to-screen wide-FOV render (follow-cam style). Optional RT path behind flag. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    const prevClear = new THREE.Color();
    renderer.getClearColor(prevClear);
    const prevAlpha = renderer.getClearAlpha();
    renderer.setClearColor(UNDERWATER_TINT, 1);

    if (
      FishEyeCamera.ENABLE_BARREL_DISTORTION &&
      this.renderTarget &&
      this.distortionPass
    ) {
      renderer.setRenderTarget(this.renderTarget);
      renderer.clear(true, true, true);
      renderer.render(scene, this.camera);
      renderer.setRenderTarget(null);
      renderer.setClearColor(prevClear, prevAlpha);
      renderer.render(this.distortionPass.scene, this.distortionPass.camera);
      return;
    }

    renderer.setRenderTarget(null);
    renderer.render(scene, this.camera);
    renderer.setClearColor(prevClear, prevAlpha);
  }

  dispose(): void {
    this.renderTarget?.dispose();
    this.distortionPass?.material.dispose();
  }
}

export type CameraMode = 'follow' | 'fisheye';
