import * as THREE from 'three';
import type { Salmon } from '../fish/Salmon';

/**
 * Chase / follow camera — default observational view.
 */
export class FollowCamera {
  readonly camera: THREE.PerspectiveCamera;
  private readonly offset = new THREE.Vector3(0, 1.8, -4.5);
  private readonly lookAhead = new THREE.Vector3(0, 0.3, 3);
  private readonly currentPos = new THREE.Vector3();
  private readonly currentLook = new THREE.Vector3();
  private initialized = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.1, 200);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number, fish: Salmon): void {
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(fish.orientation);
    const up = new THREE.Vector3(0, 1, 0);
    const back = forward.clone().multiplyScalar(-1);
    const desired = fish.position
      .clone()
      .addScaledVector(back, Math.abs(this.offset.z))
      .addScaledVector(up, this.offset.y);

    const look = fish.position.clone().addScaledVector(forward, this.lookAhead.z);
    look.y += this.lookAhead.y;

    if (!this.initialized) {
      this.currentPos.copy(desired);
      this.currentLook.copy(look);
      this.initialized = true;
    } else {
      const k = 1 - Math.exp(-3.5 * dt);
      this.currentPos.lerp(desired, k);
      this.currentLook.lerp(look, k);
    }

    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLook);
    this.camera.fov = 55;
    this.camera.updateProjectionMatrix();
  }
}
