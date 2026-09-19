import * as THREE from 'three';
import type { SenseSnapshot } from './Sensors';

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
 * Decision layer: sense flow/temp/obstacles → hold / cruise / burst / seek holding lie.
 * Drives hydro SwimCommand. Observational — no player input.
 */
export class DecisionLayer {
  private energy = 1;
  private mode: BehaviorMode = 'cruise';
  private modeTimer = 0;
  private readonly preferredTemp = 9.5;

  update(dt: number, sense: SenseSnapshot, orientation: THREE.Quaternion): DecisionOutput {
    this.energy = THREE.MathUtils.clamp(
      this.energy - this.drainRate() * dt + 0.04 * dt,
      0.05,
      1,
    );
    this.modeTimer += dt;

    // Re-evaluate periodically or on strong stimuli
    if (this.modeTimer > 0.6 || sense.obstacleAhead > 0.7 || sense.flowSpeed > 1.1) {
      this.mode = this.chooseMode(sense);
      this.modeTimer = 0;
    }

    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(orientation);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(orientation);

    let thrust = 0.35;
    let pitch = 0;
    let yaw = 0;
    let rationale = '';

    switch (this.mode) {
      case 'hold': {
        // Station-hold: thrust to cancel downstream drift; linger near lies
        const need = 0.15 + sense.flowSpeed * 0.55;
        thrust = THREE.MathUtils.clamp(need * 0.45, 0.15, 0.45);
        if (sense.holdingLieDist < 4) {
          yaw += sense.toHoldingLie.dot(right) * 0.15;
          pitch += Math.sign(sense.toHoldingLie.y) * 0.08;
        }
        pitch += (0.7 - sense.bedClearance) * 0.05;
        rationale = 'Station-holding against current';
        break;
      }
      case 'cruise': {
        thrust = 0.4 + Math.min(0.25, sense.flowSpeed * 0.2);
        const upstream = new THREE.Vector3(0, 0, 1);
        yaw += forward.cross(upstream).y * 0.4;
        // Steer toward channel centre when near banks (flow.x shear cue + lie bias)
        if (sense.bankClearance < 2) {
          const towardCentre = -Math.sign(sense.flow.x !== 0 ? sense.flow.x : sense.toHoldingLie.x || 0.01);
          yaw += towardCentre * (1.2 - sense.bankClearance) * 0.35;
        }
        pitch += (1.2 - sense.bedClearance) * 0.04;
        rationale = 'Steady upstream cruise';
        break;
      }
      case 'burst': {
        thrust = 0.85 + (1 - this.energy) * -0.1;
        thrust = THREE.MathUtils.clamp(thrust, 0.7, 1);
        // Punch through high flow / obstacle
        yaw += (Math.random() - 0.5) * 0.05;
        pitch += 0.05;
        rationale = 'Burst through high flow / obstacle';
        break;
      }
      case 'seek_hold': {
        thrust = 0.5;
        const dir = sense.toHoldingLie.clone().normalize();
        yaw += dir.dot(right) * 0.6;
        pitch += dir.y * 0.4;
        // Face somewhat upstream while seeking
        yaw += forward.cross(new THREE.Vector3(0, 0, 1)).y * 0.2;
        rationale = 'Seeking holding lie';
        break;
      }
    }

    // Obstacle avoidance overlay
    if (sense.obstacleAhead > 0.4) {
      yaw += (Math.random() > 0.5 ? 1 : -1) * sense.obstacleAhead * 0.5;
      pitch += 0.15;
      if (this.mode !== 'burst' && sense.flowSpeed > 0.7) {
        thrust = Math.max(thrust, 0.75);
      }
    }

    // Temperature preference (mild)
    const tempErr = sense.tempC - this.preferredTemp;
    if (Math.abs(tempErr) > 1.5 && this.mode === 'cruise') {
      pitch += -Math.sign(tempErr) * 0.06; // warmer → go deeper (cooler)
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
    // Low energy → seek hold or hold
    if (this.energy < 0.35) {
      return sense.holdingLieDist < 3 ? 'hold' : 'seek_hold';
    }
    // Strong adverse flow or high shear → burst or seek shelter
    if (sense.flowSpeed > 1.05 || sense.shear > 0.35) {
      if (this.energy > 0.55 && sense.holdingLieDist > 5) return 'burst';
      return sense.holdingLieDist < 6 ? 'seek_hold' : 'burst';
    }
    // Near comfortable lie and moderate flow → hold briefly
    if (sense.holdingLieDist < 2.2 && sense.flowSpeed < 0.7 && Math.random() < 0.45) {
      return 'hold';
    }
    // Obstacle → burst
    if (sense.obstacleAhead > 0.75) return 'burst';
    // Default migration cruise
    if (sense.holdingLieDist < 4 && this.energy < 0.55) return 'seek_hold';
    return 'cruise';
  }

  private drainRate(): number {
    switch (this.mode) {
      case 'burst':
        return 0.22;
      case 'cruise':
        return 0.06;
      case 'seek_hold':
        return 0.08;
      case 'hold':
        return 0.03;
      default:
        return 0.05;
    }
  }
}
