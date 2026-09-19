import * as THREE from 'three';
import type { SenseSnapshot } from './Sensors';
import type { SeededRng } from '../util/rng';

export type BehaviorMode = 'hold' | 'cruise' | 'burst' | 'seek_hold';

export interface DecisionOutput {
  mode: BehaviorMode;
  thrustLevel: number;
  pitch: number;
  yaw: number;
  roll: number;
  energy: number;
  rationale: string;
}

/**
 * Decision layer v1.1: sense → hold / cruise / burst / seek holding lie.
 * Prefers lies when energy low / flow high; weak upstream rheotaxis/homing;
 * light fatigue curves (ascent costs scale with opposing flow).
 */
export class DecisionLayer {
  private energy = 1;
  private mode: BehaviorMode = 'cruise';
  private modeTimer = 0;
  private readonly preferredTemp = 9.5;
  private readonly rng: SeededRng | null;

  constructor(rng: SeededRng | null = null) {
    this.rng = rng;
  }

  setEnergy(e: number): void {
    this.energy = THREE.MathUtils.clamp(e, 0.05, 1);
  }

  getEnergy(): number {
    return this.energy;
  }

  private rand(): number {
    return this.rng ? this.rng.next() : Math.random();
  }

  update(dt: number, sense: SenseSnapshot, orientation: THREE.Quaternion): DecisionOutput {
    const drain = this.drainRate(sense);
    const recover = this.recoverRate(sense);
    this.energy = THREE.MathUtils.clamp(this.energy - drain * dt + recover * dt, 0.05, 1);
    this.modeTimer += dt;

    if (
      this.modeTimer > 0.55 ||
      sense.obstacleAhead > 0.7 ||
      sense.flowSpeed > 1.0 ||
      this.energy < 0.32
    ) {
      this.mode = this.chooseMode(sense);
      this.modeTimer = 0;
    }

    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(orientation);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(orientation);
    const upstream = new THREE.Vector3(0, 0, 1);

    let thrust = 0.35;
    let pitch = 0;
    let yaw = 0;
    let rationale = '';

    // Weak upstream rheotaxis / homing bias (always on) — non-mutating cross
    yaw += new THREE.Vector3().crossVectors(forward, upstream).y * 0.22;

    switch (this.mode) {
      case 'hold': {
        // Station-hold: match opposing flow enough to limit slip (not decorative)
        const need = 0.18 + sense.flowSpeed * 0.72;
        thrust = THREE.MathUtils.clamp(need, 0.18, 0.62);
        if (sense.holdingLieDist < 4) {
          yaw += sense.toHoldingLie.dot(right) * 0.22;
          pitch += Math.sign(sense.toHoldingLie.y) * 0.1;
        }
        pitch += (0.7 - sense.bedClearance) * 0.05;
        rationale =
          sense.holdingLieDist < sense.lieRadius
            ? 'Holding in low-shear lie'
            : 'Station-holding against current';
        break;
      }
      case 'cruise': {
        thrust = 0.38 + Math.min(0.28, sense.flowSpeed * 0.22);
        yaw += new THREE.Vector3().crossVectors(forward, upstream).y * 0.35;
        if (sense.bankClearance < 2) {
          const towardCentre = -Math.sign(
            sense.flow.x !== 0 ? sense.flow.x : sense.toHoldingLie.x || 0.01,
          );
          yaw += towardCentre * (1.2 - sense.bankClearance) * 0.35;
        }
        pitch += (1.2 - sense.bedClearance) * 0.04;
        rationale = 'Steady upstream cruise (rheotaxis)';
        break;
      }
      case 'burst': {
        const fatigueCap = 0.55 + this.energy * 0.45;
        thrust = THREE.MathUtils.clamp(0.88 * fatigueCap, 0.55, 1);
        yaw += (this.rand() - 0.5) * 0.05;
        pitch += 0.05;
        rationale =
          this.energy < 0.45
            ? 'Fatigued burst — thrust capped'
            : 'Burst through high flow / obstacle';
        break;
      }
      case 'seek_hold': {
        // Push into the pocket; more authority when depleted
        thrust = this.energy < 0.35 ? 0.55 : 0.48;
        if (sense.toHoldingLie.lengthSq() > 1e-6) {
          const dir = sense.toHoldingLie.clone().normalize();
          const steer = this.energy < 0.4 ? 1.05 : 0.8;
          yaw += dir.dot(right) * steer;
          pitch += dir.y * 0.5;
        }
        yaw += new THREE.Vector3().crossVectors(forward, upstream).y * 0.18;
        rationale =
          this.energy < 0.4
            ? 'Low energy — seeking holding lie'
            : 'High flow — seeking holding lie';
        break;
      }
    }

    if (sense.obstacleAhead > 0.4) {
      yaw += (this.rand() > 0.5 ? 1 : -1) * sense.obstacleAhead * 0.5;
      pitch += 0.15;
      if (this.mode !== 'burst' && sense.flowSpeed > 0.7) {
        thrust = Math.max(thrust, Math.min(0.75, 0.5 + this.energy * 0.3));
      }
    }

    const tempErr = sense.tempC - this.preferredTemp;
    if (Math.abs(tempErr) > 1.5 && this.mode === 'cruise') {
      pitch += -Math.sign(tempErr) * 0.06;
    }

    // Fatigue caps burst/cruise, but hold must keep enough thrust to station-hold
    if (this.energy < 0.25 && this.mode !== 'hold') {
      thrust = Math.min(thrust, 0.4);
    }

    const roll = -yaw * 0.4;

    return {
      mode: this.mode,
      thrustLevel: THREE.MathUtils.clamp(thrust, 0.05, 1),
      pitch: THREE.MathUtils.clamp(pitch, -1, 1),
      yaw: THREE.MathUtils.clamp(yaw, -1, 1),
      roll: THREE.MathUtils.clamp(roll, -1, 1),
      energy: this.energy,
      rationale,
    };
  }

  private chooseMode(sense: SenseSnapshot): BehaviorMode {
    const inOrNearLie = sense.holdingLieDist < sense.lieRadius * 1.25;
    const nearLie = sense.holdingLieDist < 5;

    if (this.energy < 0.38) {
      return inOrNearLie || sense.holdingLieDist < 3.5 ? 'hold' : 'seek_hold';
    }

    if (sense.flowSpeed > 0.95 || sense.shear > 0.32) {
      if (this.energy < 0.55 || nearLie) {
        return inOrNearLie ? 'hold' : 'seek_hold';
      }
      if (this.energy > 0.6 && sense.holdingLieDist > 6) return 'burst';
      return nearLie ? 'seek_hold' : 'burst';
    }

    if (inOrNearLie && sense.flowSpeed < 0.75 && this.rand() < 0.55) {
      return 'hold';
    }

    if (sense.obstacleAhead > 0.75 && this.energy > 0.5) return 'burst';

    if (sense.holdingLieDist < 4 && this.energy < 0.55) return 'seek_hold';

    return 'cruise';
  }

  private drainRate(sense: SenseSnapshot): number {
    const oppose = Math.max(0, sense.flowSpeed - 0.35);
    const ascent = oppose * 0.055;
    switch (this.mode) {
      case 'burst':
        return 0.32 + ascent * 2.2;
      case 'cruise':
        return 0.058 + ascent;
      case 'seek_hold':
        return 0.075 + ascent * 0.7;
      case 'hold':
        return 0.022 + sense.flowSpeed * 0.01;
      default:
        return 0.05;
    }
  }

  private recoverRate(sense: SenseSnapshot): number {
    if (this.mode === 'hold' && sense.holdingLieDist <= sense.lieRadius * 1.2) {
      return 0.09;
    }
    if (this.mode === 'hold') return 0.045;
    return 0.028;
  }
}
