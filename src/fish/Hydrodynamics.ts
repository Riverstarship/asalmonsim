import * as THREE from 'three';
import { FISH_LENGTH_M, FISH_MASS_KG } from '../config';

export interface HydroForces {
  thrust: THREE.Vector3;
  drag: THREE.Vector3;
  buoyancy: THREE.Vector3;
  torque: THREE.Vector3;
}

export interface SwimCommand {
  /** Forward thrust demand 0–1. */
  thrustLevel: number;
  /** Desired pitch rate contribution. */
  pitch: number;
  /** Desired yaw rate contribution. */
  yaw: number;
  /** Desired roll (bank) contribution. */
  roll: number;
}

const WATER_DENSITY = 1000;
const BODY_VOLUME = FISH_MASS_KG / 1060; // slightly negatively buoyant when inactive
const CD_BODY = 0.08;
const AREA = Math.PI * (FISH_LENGTH_M * 0.1) ** 2;
const I_PITCH = 0.35;
const I_YAW = 0.4;
const I_ROLL = 0.15;

/**
 * Buoyancy, quadratic drag, body/caudal thrust, pitch/yaw/roll coupling.
 */
export class Hydrodynamics {
  readonly velocity = new THREE.Vector3();
  readonly angularVelocity = new THREE.Vector3(); // pitch, yaw, roll rates in body frame-ish

  computeForces(
    orientation: THREE.Quaternion,
    waterVel: THREE.Vector3,
    cmd: SwimCommand,
    caudalAngle: number,
  ): HydroForces {
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(orientation);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(orientation);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(orientation);

    // Relative velocity through water
    const vRel = this.velocity.clone().sub(waterVel);
    const speed = vRel.length();

    // Quadratic drag opposing relative motion
    const dragMag = 0.5 * WATER_DENSITY * CD_BODY * AREA * speed * speed;
    const drag = speed > 1e-4 ? vRel.clone().multiplyScalar(-dragMag / speed) : new THREE.Vector3();
    // Extra lateral drag (fish is streamlined fore-aft)
    const lat = vRel.dot(right);
    drag.addScaledVector(right, -lat * 40);

    // Buoyancy − weight
    const buoyForce = (WATER_DENSITY * BODY_VOLUME - FISH_MASS_KG) * 9.81;
    // Active swim bladder lite: slight upward bias when thrusting
    const buoyancy = new THREE.Vector3(0, buoyForce + cmd.thrustLevel * 2.5, 0);

    // Body + caudal thrust along forward; caudal angle adds slight lateral
    const thrustMax = 55; // N peak adult burst (order-of-magnitude)
    const thrustMag = cmd.thrustLevel * thrustMax;
    const thrust = forward.clone().multiplyScalar(thrustMag);
    thrust.addScaledVector(right, Math.sin(caudalAngle) * thrustMag * 0.15);

    // Torques: command + hydrodynamic damping + pitch/yaw/roll coupling
    const torque = new THREE.Vector3(
      cmd.pitch * 8 - this.angularVelocity.x * 4 + this.angularVelocity.z * 0.3,
      cmd.yaw * 10 - this.angularVelocity.y * 5,
      cmd.roll * 6 - this.angularVelocity.z * 3 - this.angularVelocity.x * 0.4,
    );
    // Speed-dependent yaw authority
    torque.y *= 0.5 + Math.min(1, speed);

    // Coupling: yaw induces roll (bank into turn)
    torque.z += -cmd.yaw * 2.5;
    // Pitch couples with thrust (nose up when bursting upward intent already in cmd)

    void up; // reserved for future fin force frame
    return { thrust, drag, buoyancy, torque };
  }

  integrate(
    dt: number,
    forces: HydroForces,
    orientation: THREE.Quaternion,
    position: THREE.Vector3,
  ): void {
    const acc = new THREE.Vector3()
      .add(forces.thrust)
      .add(forces.drag)
      .add(forces.buoyancy)
      .multiplyScalar(1 / FISH_MASS_KG);

    this.velocity.addScaledVector(acc, dt);
    // Soft speed clamp (burst ~3–4 m/s adult)
    const spd = this.velocity.length();
    if (spd > 4.2) this.velocity.multiplyScalar(4.2 / spd);

    position.addScaledVector(this.velocity, dt);

    // Angular integrate (simplified Euler in body-ish axes)
    this.angularVelocity.x += (forces.torque.x / I_PITCH) * dt;
    this.angularVelocity.y += (forces.torque.y / I_YAW) * dt;
    this.angularVelocity.z += (forces.torque.z / I_ROLL) * dt;

    const dq = new THREE.Quaternion();
    const wx = this.angularVelocity.x * dt;
    const wy = this.angularVelocity.y * dt;
    const wz = this.angularVelocity.z * dt;
    dq.setFromEuler(new THREE.Euler(wx, wy, wz, 'YXZ'));
    orientation.multiply(dq).normalize();
  }

  /**
   * Hard containment: kill inward normal velocity (no bounce through walls).
   * Light tangential damp only on bed/surface contacts so bank scrapes
   * do not erase upstream progress.
   */
  collide(normal: THREE.Vector3): void {
    const vn = this.velocity.dot(normal);
    if (vn < 0) {
      this.velocity.addScaledVector(normal, -vn);
    }
    if (Math.abs(normal.y) > 0.55) {
      const nComp = normal.clone().multiplyScalar(this.velocity.dot(normal));
      const tang = this.velocity.clone().sub(nComp);
      this.velocity.copy(nComp.addScaledVector(tang, 0.92));
    }
  }
}
