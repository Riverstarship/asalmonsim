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
const I_PITCH = 0.38;
const I_YAW = 0.42;
/** Heavier roll inertia — roll is mostly stripped after integrate anyway. */
const I_ROLL = 0.9;

const MAX_PITCH_RATE = 2.0;
const MAX_YAW_RATE = 2.2;
const MAX_ROLL_RATE = 0.6;
/** Soft pitch-angle cap (rad) so bed-scrape pitch cmds cannot go vertical. */
const MAX_PITCH_ANGLE = 0.72; // ~41° — enough for bed escape / mid-column

/**
 * Buoyancy, quadratic drag, body/caudal thrust, pitch/yaw with dorsal-up attitude plant.
 * v1.4: stop corkscrew — rebuild orientation from forward + world-up (roll ≈ 0).
 */
export class Hydrodynamics {
  readonly velocity = new THREE.Vector3();
  readonly angularVelocity = new THREE.Vector3(); // pitch, yaw, roll rates in body frame-ish

  private readonly _forward = new THREE.Vector3();
  private readonly _up = new THREE.Vector3();
  private readonly _right = new THREE.Vector3();
  private readonly _worldUp = new THREE.Vector3(0, 1, 0);
  private readonly _tmp = new THREE.Vector3();
  private readonly _wu = new THREE.Vector3();
  private readonly _horiz = new THREE.Vector3();
  private readonly _dq = new THREE.Quaternion();
  private readonly _mat = new THREE.Matrix4();

  /**
   * Signed roll about body forward (rad): 0 = belly down.
   * atan2 so inverted (±π) is well-defined.
   */
  static signedRollRad(
    orientation: THREE.Quaternion,
    scratch?: {
      forward: THREE.Vector3;
      up: THREE.Vector3;
      worldUp: THREE.Vector3;
      wu: THREE.Vector3;
      tmp: THREE.Vector3;
    },
  ): number {
    const forward = scratch?.forward ?? new THREE.Vector3();
    const up = scratch?.up ?? new THREE.Vector3();
    const worldUp = scratch?.worldUp ?? new THREE.Vector3(0, 1, 0);
    const wu = scratch?.wu ?? new THREE.Vector3();
    const tmp = scratch?.tmp ?? new THREE.Vector3();
    if (!scratch) worldUp.set(0, 1, 0);
    forward.set(0, 0, 1).applyQuaternion(orientation);
    up.set(0, 1, 0).applyQuaternion(orientation);
    wu.copy(worldUp).addScaledVector(forward, -worldUp.dot(forward));
    if (wu.lengthSq() < 1e-10) return 0;
    wu.normalize();
    tmp.crossVectors(wu, up);
    const sin = tmp.dot(forward);
    const cos = wu.dot(up);
    return Math.atan2(sin, cos);
  }

  computeForces(
    orientation: THREE.Quaternion,
    waterVel: THREE.Vector3,
    cmd: SwimCommand,
    caudalAngle: number,
  ): HydroForces {
    this._forward.set(0, 0, 1).applyQuaternion(orientation);
    this._up.set(0, 1, 0).applyQuaternion(orientation);
    this._right.set(1, 0, 0).applyQuaternion(orientation);

    const vRel = this.velocity.clone().sub(waterVel);
    const speed = vRel.length();

    const dragMag = 0.5 * WATER_DENSITY * CD_BODY * AREA * speed * speed;
    const drag =
      speed > 1e-4 ? vRel.clone().multiplyScalar(-dragMag / speed) : new THREE.Vector3();
    const lat = vRel.dot(this._right);
    drag.addScaledVector(this._right, -lat * 40);

    const buoyForce = (WATER_DENSITY * BODY_VOLUME - FISH_MASS_KG) * 9.81;
    const buoyancy = new THREE.Vector3(0, buoyForce + cmd.thrustLevel * 2.5, 0);

    const thrustMax = 55;
    const thrustMag = cmd.thrustLevel * thrustMax;
    const thrust = this._forward.clone().multiplyScalar(thrustMag);
    thrust.addScaledVector(this._right, Math.sin(caudalAngle) * thrustMag * 0.15);

    // Pitch/yaw command + damping. No yaw→roll bank coupling (corkscrew fuel).
    // Roll cmd is tiny; plant zeros residual roll after integrate.
    const torque = new THREE.Vector3(
      cmd.pitch * 7 - this.angularVelocity.x * 5.5,
      cmd.yaw * 9 - this.angularVelocity.y * 6,
      cmd.roll * 1.2 - this.angularVelocity.z * 16,
    );
    torque.y *= 0.5 + Math.min(1, speed);

    // Mild spring on measured roll (backup; hard rebuild does the real work)
    const rollAng = Hydrodynamics.signedRollRad(orientation, {
      forward: this._forward,
      up: this._up,
      worldUp: this._worldUp,
      wu: this._wu,
      tmp: this._tmp,
    });
    torque.z += -22 * rollAng;

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
    const spd = this.velocity.length();
    if (spd > 4.2) this.velocity.multiplyScalar(4.2 / spd);

    position.addScaledVector(this.velocity, dt);

    this.angularVelocity.x += (forces.torque.x / I_PITCH) * dt;
    this.angularVelocity.y += (forces.torque.y / I_YAW) * dt;
    this.angularVelocity.z += (forces.torque.z / I_ROLL) * dt;

    this.angularVelocity.x = THREE.MathUtils.clamp(
      this.angularVelocity.x,
      -MAX_PITCH_RATE,
      MAX_PITCH_RATE,
    );
    this.angularVelocity.y = THREE.MathUtils.clamp(
      this.angularVelocity.y,
      -MAX_YAW_RATE,
      MAX_YAW_RATE,
    );
    this.angularVelocity.z = THREE.MathUtils.clamp(
      this.angularVelocity.z,
      -MAX_ROLL_RATE,
      MAX_ROLL_RATE,
    );

    // Apply pitch + yaw only (roll rebuilt next).
    // Convention: +angularVelocity.x = nose UP (DecisionLayer). Right-hand
    // about +X lowers the nose, so pitch is applied about −X.
    const wx = this.angularVelocity.x;
    const wy = this.angularVelocity.y;
    const wLen = Math.hypot(wx, wy);
    if (wLen > 1e-8) {
      const half = wLen * dt * 0.5;
      const s = Math.sin(half) / wLen;
      this._dq.set(-wx * s, wy * s, 0, Math.cos(half));
      orientation.multiply(this._dq).normalize();
    }

    // --- Saner orientation: clamp pitch, rebuild dorsal-up (roll = 0) ---
    this.enforceDorsalUp(orientation);
    this.angularVelocity.z *= 0.5; // bleed residual roll rate
  }

  /**
   * Keep heading + limited pitch; force belly-down by rebuilding basis
   * from forward × world-up. Prevents Euler-quat corkscrew / inverted sits.
   */
  private enforceDorsalUp(orientation: THREE.Quaternion): void {
    this._forward.set(0, 0, 1).applyQuaternion(orientation);

    // Horizontal heading; if nearly vertical, fall back to +Z
    this._horiz.set(this._forward.x, 0, this._forward.z);
    if (this._horiz.lengthSq() < 1e-8) {
      this._horiz.set(0, 0, 1);
    } else {
      this._horiz.normalize();
    }

    let pitch = Math.asin(THREE.MathUtils.clamp(this._forward.y, -1, 1));
    pitch = THREE.MathUtils.clamp(pitch, -MAX_PITCH_ANGLE, MAX_PITCH_ANGLE);

    // Rebuild forward at clamped pitch
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    this._forward.set(this._horiz.x * cp, sp, this._horiz.z * cp).normalize();

    // Orthonormal basis: right = worldUp × forward, up = forward × right
    this._right.crossVectors(this._worldUp, this._forward);
    if (this._right.lengthSq() < 1e-8) {
      // Degenerate (forward ‖ up) — use world X
      this._right.set(1, 0, 0);
    } else {
      this._right.normalize();
    }
    this._up.crossVectors(this._forward, this._right).normalize();
    // Re-orthogonalize right
    this._right.crossVectors(this._up, this._forward).normalize();

    this._mat.makeBasis(this._right, this._up, this._forward);
    orientation.setFromRotationMatrix(this._mat).normalize();
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
