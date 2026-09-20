import * as THREE from 'three';
import type { SenseSnapshot } from './Sensors';
import type { SeededRng } from '../util/rng';
import {
  drainRate as metabolicDrain,
  recoverRate as metabolicRecover,
} from './Metabolism';

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
 * Decision layer v1.3–v1.8: duty-cycled stepwise ascent; roll cmd mostly automatic.
 * Migratory bout → energy-saving hold (low-V / structure lies) with hysteresis;
 * mid-column preference when migrating; anticipatory bed/bank/surface avoidance;
 * burst only for hard hydraulics / obstacles, then recover in lie.
 * v1.6: activity-dominated metabolic drain + light temp multiplier (Lennox-informed OOM).
 * v1.8: hold-residency retune — longer holds, stronger migrate→hold hysteresis,
 * lower default migrate duty, near-zero ground speed / minimal thrust in lies.
 */
export class DecisionLayer {
  private energy = 1;
  private mode: BehaviorMode = 'cruise';
  private phase: DutyPhase = 'migrate';
  private phaseElapsed = 0;
  private migrateTarget = 5;
  private holdTarget = 28;
  private burstCooldown = 0;
  private burstTimer = 0;
  /** Continuous time settled in a good lie (residency). */
  private lieResidency = 0;
  private readonly preferredTemp = 9.5;
  private readonly rng: SeededRng | null;
  /** Minimum migrate bout before hold may begin (hysteresis floor). */
  private readonly minMigrateHold = 3.0;
  /** Minimum hold bout before migrate may resume (harder to leave). */
  private readonly minHoldLeave = 8.0;
  /** Extra residency required in a lie before leaving hold. */
  private readonly minLieResidency = 6.0;
  /** Harness-only: lock mode (skips selectMode) for fatigue probes. */
  private forceMode: BehaviorMode | null = null;

  constructor(rng: SeededRng | null = null) {
    this.rng = rng;
    this.rollBoutTargets();
  }

  setEnergy(e: number): void {
    this.energy = THREE.MathUtils.clamp(e, 0.05, 1);
    // Tired fish begin in energy-saving hold, not restless cruise
    if (this.energy < 0.62) {
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

  /** Headless harness: lock behavior mode for metabolic comparisons. */
  setForceMode(mode: BehaviorMode | null): void {
    this.forceMode = mode;
    if (mode) this.mode = mode;
  }

  private rand(): number {
    return this.rng ? this.rng.next() : Math.random();
  }

  private rollBoutTargets(): void {
    // v1.8: short migrate progress bouts, long energy-saving holds (mostly holding)
    this.migrateTarget = 5.5 + this.rand() * 3.5; // ~5.5–9 s
    this.holdTarget = 12 + this.rand() * 10; // ~12–22 s
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

    if (this.forceMode) {
      this.mode = this.forceMode;
    } else {
      this.selectMode(dt, sense);
    }
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
        // v1.8: near-zero ground speed in lies — tiny match thrust, strong rheotaxis.
        // Larger baseline overshoots upstream and ejects the fish from the pocket.
        const slip = Math.max(0, -sense.streamwiseGround);
        const surge = Math.max(0, sense.streamwiseGround);
        const lowV = inLie || sense.flowSpeed < 0.28;
        let match = inLie
          ? 0.004 + sense.flowSpeed * 0.1
          : lowV
            ? 0.018 + sense.flowSpeed * 0.26
            : 0.032 + sense.flowSpeed * 0.38;
        match += slip * (inLie ? 0.28 : 0.32);
        match -= Math.min(inLie ? 0.35 : 0.22, surge * (inLie ? 0.85 : 0.55));
        // Soft brake when already nearly still in a lie
        if (inLie && Math.abs(sense.streamwiseGround) < 0.12) {
          match *= 0.55;
        }
        thrust = THREE.MathUtils.clamp(match, inLie ? 0.003 : 0.01, inLie ? 0.24 : 0.42);
        // Strong positive rheotaxis while station-holding
        if (sense.flowSpeed > 0.03) {
          const intoFlow = sense.flow.clone().multiplyScalar(-1).normalize();
          yaw += new THREE.Vector3().crossVectors(forward, intoFlow).y * (inLie ? 0.55 : 0.4);
        }
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
        // v1.5: light avoid-abrupt-change bias (turbulence proxy)
        if (sense.turbulence > 0.55 && sense.holdingLieDist > sense.lieRadius) {
          yaw += -Math.sign(sense.lateralX || 0.01) * (sense.turbulence - 0.55) * 0.12;
        }
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

    // Hold mode: damp jitter; float slightly off bed; flatten when settled
    if (this.mode === 'hold' && inLie) {
      pitch *= 0.18;
      yaw *= 0.4;
      thrust = Math.min(thrust, 0.2);
      if (sense.bedClearance < 0.75) pitch += 0.3 + (0.75 - sense.bedClearance) * 0.5;
      else if (sense.bedClearance > 0.55 && sense.bedClearance < 1.4) pitch *= 0.35;
      if (sense.surfaceClearance < 0.9) pitch -= 0.12;
    }

    // Hard bank escape — break wall-riding chatter that racks scrape counts
    if (sense.bankClearance < 0.55) {
      yaw = -Math.sign(sense.lateralX || 0.01);
      thrust = Math.min(thrust, 0.35);
    }

    // v1.4: roll mostly automatic via dorsal-up hydro — AI mainly yaw/pitch/thrust
    const yawCmd = THREE.MathUtils.clamp(yaw, -1, 1);
    const roll = THREE.MathUtils.clamp(-yawCmd * 0.05, -0.08, 0.08);

    const thrustFloor =
      this.mode === 'hold' && inLie ? 0.004 : this.mode === 'hold' ? 0.02 : 0.05;
    return {
      mode: this.mode,
      thrustLevel: THREE.MathUtils.clamp(thrust, thrustFloor, 1),
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
    const bedStart = allowNearBed ? 0.72 : 1.2;
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

    // Burst rare: hard hydraulics / obstacles only, then return to hold / seek lie
    const wantBurst =
      this.burstCooldown <= 0 &&
      this.energy > 0.58 &&
      (sense.obstacleAhead > 0.85 || sense.flowSpeed > 1.25 || sense.shear > 0.55);

    if (wantBurst && this.mode !== 'burst') {
      this.mode = 'burst';
      this.burstTimer = 0.55 + this.rand() * 0.35;
      this.burstCooldown = 5.5;
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

    // Track lie residency during hold (must run before leave-hold check).
    if (inLie && this.phase === 'hold') {
      this.lieResidency += dt;
    } else if (!(inLie && this.phase === 'hold')) {
      // Keep residency while seeking only if we already banked some; else reset
      if (!inLie) this.lieResidency = 0;
    }

    // Tired fish drop into hold even mid-migrate (do not abort migrate solely for nearby lie)
    if (inLie && this.phase === 'migrate' && this.energy < 0.42) {
      this.enterHoldPhase();
      this.lieResidency = dt;
      this.mode = 'hold';
      return;
    }

    // --- Duty-cycle transitions (v1.8 stronger migrate→hold hysteresis) ---
    if (this.phase === 'migrate') {
      const tired = this.energy < 0.48;
      const boutDone =
        this.phaseElapsed >= this.migrateTarget &&
        this.phaseElapsed >= this.minMigrateHold;
      // Hard hydraulics end migrate early → seek lie (burst path still separate)
      const hydraulicsPush =
        sense.flowSpeed > 1.2 || sense.obstacleAhead > 0.82 || sense.shear > 0.5;
      if (tired || boutDone || (hydraulicsPush && this.phaseElapsed >= 2.0))
        this.enterHoldPhase();
    } else {
      // Leave hold only when recovered + long bout + residency (even while in lie).
      // Default duty stays holding; ascent still needs occasional migrate windows.
      const recovered = this.energy > 0.58;
      const boutDone =
        this.phaseElapsed >= this.holdTarget &&
        this.phaseElapsed >= this.minHoldLeave;
      const resided =
        this.lieResidency >= this.minLieResidency ||
        (this.lieResidency === 0 && this.phaseElapsed >= this.holdTarget * 1.1);
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

    // Migrate phase — low default duty; drop to hold if energy softens
    if (this.energy < 0.48) {
      this.enterHoldPhase();
      this.mode = inLie ? 'hold' : 'seek_hold';
      return;
    }
    this.mode = 'cruise';
  }

  private drainRate(sense: SenseSnapshot): number {
    return metabolicDrain(this.mode, sense.flowSpeed, sense.tempC);
  }

  private recoverRate(sense: SenseSnapshot): number {
    const inLie = sense.inLie;
    const nearLie = sense.holdingLieDist <= sense.lieRadius * 1.35;
    return metabolicRecover(this.mode, sense.flowSpeed, inLie, nearLie);
  }
}
