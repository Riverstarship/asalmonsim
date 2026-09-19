import * as THREE from 'three';
import type { SenseSnapshot } from './Sensors';
import type { SeededRng } from '../util/rng';

export type BehaviorMode = 'hold' | 'cruise' | 'burst' | 'seek_hold';

export type DutyPhase = 'migrate' | 'hold';

export interface DecisionOutput {
  mode: BehaviorMode;
  thrustLevel: number;
  pitch: number;
  yaw: number;
  roll: number;
  energy: number;
  rationale: string;
  /** Outer duty-cycle phase (migratory progress vs energy-saving hold). */
  phase: DutyPhase;
}

/**
 * Decision layer v1.3/v1.4: duty-cycled stepwise ascent; roll cmd mostly automatic.
 * Migratory bout → energy-saving hold (low-V / structure lies) with hysteresis;
 * mid-column preference when migrating; anticipatory bed/bank/surface avoidance;
 * burst only for hard hydraulics / obstacles, then recover in lie.
 */
export class DecisionLayer {
  private energy = 1;
  private mode: BehaviorMode = 'cruise';
  private phase: DutyPhase = 'migrate';
  private phaseElapsed = 0;
  private migrateTarget = 8;
  private holdTarget = 14;
  private burstCooldown = 0;
  private burstTimer = 0;
  /** Continuous time settled in a good lie (residency). */
  private lieResidency = 0;
  private readonly preferredTemp = 9.5;
  private readonly rng: SeededRng | null;
  /** Minimum time in a phase before hysteresis allows switching. */
  private readonly minPhaseHold = 3.2;

  constructor(rng: SeededRng | null = null) {
    this.rng = rng;
    this.rollBoutTargets();
  }

  setEnergy(e: number): void {
    this.energy = THREE.MathUtils.clamp(e, 0.05, 1);
    // Tired fish begin in energy-saving hold, not restless cruise
    if (this.energy < 0.52) {
      this.phase = 'hold';
      this.phaseElapsed = 0;
      this.mode = 'hold';
    }
  }

  getEnergy(): number {
    return this.energy;
  }

  getPhase(): DutyPhase {
    return this.phase;
  }

  private rand(): number {
    return this.rng ? this.rng.next() : Math.random();
  }

  private rollBoutTargets(): void {
    // Stepwise: migrate progress bouts, then longer energy-saving holds
    this.migrateTarget = 7 + this.rand() * 5; // ~7–12 s
    this.holdTarget = 8 + this.rand() * 7; // ~8–15 s
  }

  private enterHoldPhase(): void {
    this.phase = 'hold';
    this.phaseElapsed = 0;
    this.rollBoutTargets();
  }

  private enterMigratePhase(): void {
    this.phase = 'migrate';
    this.phaseElapsed = 0;
    this.rollBoutTargets();
  }

  update(dt: number, sense: SenseSnapshot, orientation: THREE.Quaternion): DecisionOutput {
    this.burstCooldown = Math.max(0, this.burstCooldown - dt);
    this.phaseElapsed += dt;

    this.selectMode(dt, sense);
    const drain = this.drainRate(sense);
    const recover = this.recoverRate(sense);
    this.energy = THREE.MathUtils.clamp(this.energy - drain * dt + recover * dt, 0.05, 1);

    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(orientation);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(orientation);
    const upstream = new THREE.Vector3(0, 0, 1);

    let thrust = 0.35;
    let pitch = 0;
    let yaw = 0;
    let rationale = '';

    // Positive rheotaxis: face into flow (flow typically −Z)
    if (sense.flowSpeed > 0.04) {
      const intoFlow = sense.flow.clone().multiplyScalar(-1).normalize();
      yaw += new THREE.Vector3().crossVectors(forward, intoFlow).y * 0.35;
    } else {
      yaw += new THREE.Vector3().crossVectors(forward, upstream).y * 0.22;
    }

    const inLie = sense.inLie;
    const nearLie = sense.holdingLieDist < 6.5;

    switch (this.mode) {
      case 'hold': {
        // Near-zero ground speed: hydro needs only tiny thrust in lies (deficit shelters).
        // Larger baseline overshoots upstream and ejects the fish from the pocket.
        const slip = Math.max(0, -sense.streamwiseGround);
        const surge = Math.max(0, sense.streamwiseGround);
        let match = inLie
          ? 0.012 + sense.flowSpeed * 0.2
          : 0.04 + sense.flowSpeed * 0.45;
        match += slip * 0.28;
        match -= Math.min(0.18, surge * 0.45);
        thrust = THREE.MathUtils.clamp(match, 0.01, 0.48);
        if (nearLie && !inLie) {
          yaw += sense.toHoldingLie.dot(right) * 0.18;
        }
        rationale = inLie
          ? 'Holding in low-V structure lie'
          : 'Station-holding (energy-saving)';
        break;
      }
      case 'cruise': {
        thrust = 0.52 + Math.min(0.3, sense.flowSpeed * 0.25);
        yaw += new THREE.Vector3().crossVectors(forward, upstream).y * 0.48;
        pitch += this.midColumnPitch(sense);
        rationale = 'Migratory bout — mid-column cruise';
        break;
      }
      case 'burst': {
        const fatigueCap = 0.5 + this.energy * 0.5;
        thrust = THREE.MathUtils.clamp(0.9 * fatigueCap, 0.55, 1);
        yaw += (this.rand() - 0.5) * 0.03;
        pitch += this.midColumnPitch(sense) * 0.45 + 0.03;
        rationale =
          this.energy < 0.45
            ? 'Fatigued burst — thrust capped'
            : 'Burst through high flow / obstacle';
        break;
      }
      case 'seek_hold': {
        thrust = this.energy < 0.35 ? 0.5 : 0.42;
        if (sense.toHoldingLie.lengthSq() > 1e-6) {
          const dir = sense.toHoldingLie.clone().normalize();
          // Approach above lie centre to reduce bed scrape
          const aimY = dir.y + 0.35;
          let steer = this.energy < 0.4 ? 1.0 : 0.8;
          if (sense.bankClearance < 2.0) steer *= 0.15;
          yaw += dir.dot(right) * steer;
          pitch += aimY * 0.45;
        }
        // Far from lie: don't dive — keep mid-column while relocating
        if (sense.holdingLieDist > 6) {
          pitch += this.midColumnPitch(sense) * 0.5;
        }
        yaw += new THREE.Vector3().crossVectors(forward, upstream).y * 0.1;
        rationale =
          this.energy < 0.4
            ? 'Low energy — seeking holding lie'
            : 'Hold phase — seeking low-V structure';
        break;
      }
    }

    // Anticipatory avoidance before hard-clamp scrapes
    const allowNearBed = this.mode === 'seek_hold' || (this.mode === 'hold' && inLie);
    yaw += this.anticipatoryYaw(sense);
    pitch += this.anticipatoryPitch(sense, allowNearBed);

    if (sense.obstacleAhead > 0.45) {
      const side = sense.lateralX >= 0 ? -1 : 1;
      yaw += side * sense.obstacleAhead * 0.5;
      if (this.mode !== 'burst' && sense.flowSpeed > 0.8 && this.energy > 0.42) {
        thrust = Math.max(thrust, Math.min(0.7, 0.46 + this.energy * 0.26));
      }
    }

    const tempErr = sense.tempC - this.preferredTemp;
    if (Math.abs(tempErr) > 1.5 && this.mode === 'cruise') {
      pitch += -Math.sign(tempErr) * 0.04;
    }

    if (this.energy < 0.22 && this.mode !== 'hold') {
      thrust = Math.min(thrust, 0.36);
    }

    // Hold mode: damp jitter; keep a little bed clearance in the pocket
    if (this.mode === 'hold' && inLie) {
      pitch *= 0.35;
      yaw *= 0.55;
      if (sense.bedClearance < 0.55) pitch += 0.2;
    }

    // Hard bank escape — break wall-riding chatter that racks scrape counts
    if (sense.bankClearance < 0.55) {
      yaw = -Math.sign(sense.lateralX || 0.01);
      thrust = Math.min(thrust, 0.35);
    }

    // v1.4: roll mostly automatic via dorsal-up hydro — AI mainly yaw/pitch/thrust
    const yawCmd = THREE.MathUtils.clamp(yaw, -1, 1);
    const roll = THREE.MathUtils.clamp(-yawCmd * 0.05, -0.08, 0.08);

    return {
      mode: this.mode,
      thrustLevel: THREE.MathUtils.clamp(thrust, 0.05, 1),
      pitch: THREE.MathUtils.clamp(pitch, -1, 1),
      yaw: yawCmd,
      roll,
      energy: this.energy,
      rationale,
      phase: this.phase,
    };
  }

  /** Mid water-column bias when migrating (~45–55% of free column). */
  private midColumnPitch(sense: SenseSnapshot): number {
    const col = sense.bedClearance + sense.surfaceClearance;
    if (col < 0.2) return 0;
    const frac = sense.bedClearance / col;
    return (0.52 - frac) * 0.85;
  }

  private anticipatoryYaw(sense: SenseSnapshot): number {
    if (sense.bankClearance >= 3.2) return 0;
    const towardCentre = -Math.sign(sense.lateralX || 0.01);
    const urgency = (3.2 - sense.bankClearance) / 3.2;
    // Quadratic urgency near the wall to cut scrape chatter
    return towardCentre * urgency * urgency * 1.35;
  }

  private anticipatoryPitch(sense: SenseSnapshot, allowNearBed: boolean): number {
    let pitch = 0;
    // Even when using structure, keep a minimum bed buffer to cut scrape chatter
    const bedStart = allowNearBed ? 0.5 : 1.2;
    const surfStart = 1.2;
    if (sense.bedClearance < bedStart) {
      pitch += ((bedStart - sense.bedClearance) / Math.max(0.05, bedStart)) * 1.05;
    }
    if (sense.surfaceClearance < surfStart) {
      pitch -= ((surfStart - sense.surfaceClearance) / surfStart) * 0.85;
    }
    return pitch;
  }

  private selectMode(dt: number, sense: SenseSnapshot): void {
    const inLie = sense.inLie;

    const wantBurst =
      this.burstCooldown <= 0 &&
      this.energy > 0.5 &&
      (sense.obstacleAhead > 0.8 || sense.flowSpeed > 1.1 || sense.shear > 0.4);

    if (wantBurst && this.mode !== 'burst') {
      this.mode = 'burst';
      this.burstTimer = 0.7 + this.rand() * 0.45;
      this.burstCooldown = 3.5;
      return;
    }

    if (this.mode === 'burst') {
      this.burstTimer -= dt;
      if (this.burstTimer > 0 && this.energy > 0.32) return;
      // Recover in lie / hold
      this.enterHoldPhase();
      this.mode = inLie ? 'hold' : 'seek_hold';
      return;
    }

    // Settle into structure only during hold phase (or when exhausted).
    // Do not abort migratory bouts just because a lie is nearby.
    if (inLie && (this.phase === 'hold' || this.energy < 0.36)) {
      if (this.phase !== 'hold') this.enterHoldPhase();
      this.lieResidency += dt;
      this.mode = 'hold';
      return;
    }
    if (!(inLie && this.phase === 'hold')) this.lieResidency = 0;

    // --- Duty-cycle transitions (hysteresis) ---
    if (this.phase === 'migrate') {
      const tired = this.energy < 0.36;
      const boutDone =
        this.phaseElapsed >= this.migrateTarget && this.phaseElapsed >= this.minPhaseHold;
      if (tired || boutDone) this.enterHoldPhase();
    } else {
      const recovered = this.energy > 0.5;
      const boutDone =
        this.phaseElapsed >= this.holdTarget && this.phaseElapsed >= this.minPhaseHold;
      // Minimum lie residency when a lie was used; allow leave if bout done without lie
      const resided =
        this.lieResidency >= 3 || (this.lieResidency === 0 && boutDone);
      if (recovered && boutDone && resided) {
        this.enterMigratePhase();
        this.lieResidency = 0;
      }
    }

    if (this.phase === 'hold') {
      // Hold only in structure; never sit in mid-channel core while "holding"
      this.mode = inLie ? 'hold' : 'seek_hold';
      return;
    }

    // Migrate phase
    if (this.energy < 0.38) {
      this.enterHoldPhase();
      this.mode = inLie ? 'hold' : 'seek_hold';
      return;
    }
    this.mode = 'cruise';
  }

  private drainRate(sense: SenseSnapshot): number {
    const oppose = Math.max(0, sense.flowSpeed - 0.28);
    const ascent = oppose * 0.055;
    // Activity-dominated: cruise/burst ≫ hold
    switch (this.mode) {
      case 'burst':
        return 0.38 + ascent * 2.3;
      case 'cruise':
        return 0.072 + ascent * 1.05;
      case 'seek_hold':
        return 0.055 + ascent * 0.55;
      case 'hold':
        return 0.01 + sense.flowSpeed * 0.006;
      default:
        return 0.05;
    }
  }

  private recoverRate(sense: SenseSnapshot): number {
    const inLie = sense.inLie || sense.holdingLieDist <= sense.lieRadius * 1.25;
    if (this.mode === 'hold' && inLie) return 0.14;
    if (this.mode === 'hold') return 0.06;
    if (this.mode === 'seek_hold' && inLie) return 0.045;
    return 0.01;
  }
}
