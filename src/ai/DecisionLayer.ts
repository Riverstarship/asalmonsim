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
 * Decision layer v1.3–v1.10: duty-cycled stepwise ascent; roll cmd mostly automatic.
 * Migratory bout → energy-saving hold (low-V / structure lies) with hysteresis;
 * mid-column preference when migrating; anticipatory bed/bank/surface avoidance;
 * burst only for hard hydraulics / obstacles, then recover in lie.
 * v1.6: activity-dominated metabolic drain + light temp multiplier (Lennox-informed OOM).
 * v1.8: hold-residency retune — longer holds, stronger migrate→hold hysteresis,
 * lower default migrate duty, near-zero ground speed / minimal thrust in lies.
 * v1.9: thermoregulatory refuge — under heat stress, bias seek/hold toward cooler
 * + lower-V bank/bed pockets; modestly raise hold tendency (cool baseline unchanged).
 * v1.10: olfactory / upstream homing lite — migrate cruise (and light seek when not
 * heat-dominated) bias yaw/thrust toward increasing natal cue; never overrides
 * hold-in-lie or strong heat-refuge.
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
  /** Deadband °C above preferred before heat stress rises (cool runs unchanged). */
  private readonly heatDeadband = 1.25;
  /** Scale °C for heatStress ramp to 1. */
  private readonly heatScale = 4.0;
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

  /** 0 = at/below preferred+deadband; 1 = strongly heat-stressed. */
  private heatStress(tempC: number): number {
    return THREE.MathUtils.clamp(
      (tempC - this.preferredTemp - this.heatDeadband) / this.heatScale,
      0,
      1,
    );
  }

  private rollBoutTargets(heat = 0): void {
    // v1.8: short migrate progress bouts, long energy-saving holds (mostly holding)
    // v1.9: under heat, modestly shorten migrate / lengthen hold (cool unchanged)
    const migrateShrink = 1 - heat * 0.28;
    const holdStretch = 1 + heat * 0.35;
    this.migrateTarget = (5.5 + this.rand() * 3.5) * migrateShrink; // ~5.5–9 s cool
    this.holdTarget = (12 + this.rand() * 10) * holdStretch; // ~12–22 s cool
  }

  private enterHoldPhase(heat = 0): void {
    this.phase = 'hold';
    this.phaseElapsed = 0;
    this.rollBoutTargets(heat);
  }

  private enterMigratePhase(heat = 0): void {
    this.phase = 'migrate';
    this.phaseElapsed = 0;
    this.rollBoutTargets(heat);
  }

  update(dt: number, sense: SenseSnapshot, orientation: THREE.Quaternion): DecisionOutput {
    this.burstCooldown = Math.max(0, this.burstCooldown - dt);
    this.phaseElapsed += dt;

    const hs = this.heatStress(sense.tempC);

    if (this.forceMode) {
      this.mode = this.forceMode;
    } else {
      this.selectMode(dt, sense, hs);
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

    // Seek target: nearest structure vs cooler/low-V lie under heat stress
    const seekTarget = this.seekTargetDir(sense, hs);

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
          yaw += seekTarget.dot(right) * (0.18 + hs * 0.22);
          pitch += seekTarget.y * hs * 0.25;
        }
        // Warm mid-channel hold: nudge toward local cool/low-V pocket
        if (hs > 0.05 && !inLie) {
          this.applyRefugeSteer(sense, right, hs, (dy, dp) => {
            yaw += dy;
            pitch += dp;
          });
        }
        rationale = inLie
          ? hs > 0.25
            ? 'Holding in cool low-V refuge'
            : 'Holding in low-V structure lie'
          : hs > 0.25
            ? 'Station-holding — seeking cooler pocket'
            : 'Station-holding (energy-saving)';
        break;
      }
      case 'cruise': {
        thrust = 0.52 + Math.min(0.3, sense.flowSpeed * 0.25);
        yaw += new THREE.Vector3().crossVectors(forward, upstream).y * 0.48;
        pitch += this.midColumnPitch(sense);
        // Under heat: light bias toward cooler bank/bed while still migrating
        if (hs > 0.2) {
          this.applyRefugeSteer(sense, right, hs * 0.45, (dy, dp) => {
            yaw += dy;
            pitch += dp;
          });
        }
        // v1.10: natal-cue / upstream homing — prefer ascending cue gradient
        // Heat refuge still wins when strongly stressed; otherwise cue steers lightly
        if (hs < 0.55) {
          const homeGain = this.applyHomingSteer(sense, forward, right, upstream, 0.75 - hs * 0.5);
          yaw += homeGain.yaw;
          pitch += homeGain.pitch;
          thrust = Math.min(1, thrust + homeGain.thrust);
        }
        rationale =
          hs > 0.35
            ? 'Migratory bout — heat-biased path'
            : sense.odorStrength > 0.08
              ? 'Migratory bout — cue-biased cruise'
              : 'Migratory bout — mid-column cruise';
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
        if (seekTarget.lengthSq() > 1e-6) {
          const dir = seekTarget.clone().normalize();
          // Approach above lie centre to reduce bed scrape; under heat allow lower aim
          const aimY = dir.y + (0.35 - hs * 0.22);
          let steer = this.energy < 0.4 ? 1.0 : 0.8;
          if (sense.bankClearance < 2.0) steer *= 0.15;
          // Stronger cool-lie steer under heat
          steer *= 1 + hs * 0.35;
          yaw += dir.dot(right) * steer;
          pitch += aimY * (0.45 + hs * 0.2);
        }
        // Local probe refuge when warm and not yet near a good lie
        if (hs > 0.1 && sense.holdingLieDist > sense.lieRadius * 0.9) {
          this.applyRefugeSteer(sense, right, hs * 0.85, (dy, dp) => {
            yaw += dy;
            pitch += dp;
          });
        }
        // Far from lie: don't dive — keep mid-column while relocating (less so when hot)
        if (sense.holdingLieDist > 6) {
          pitch += this.midColumnPitch(sense) * (0.5 - hs * 0.25);
        }
        yaw += new THREE.Vector3().crossVectors(forward, upstream).y * 0.1;
        // v1.5: light avoid-abrupt-change bias (turbulence proxy)
        if (sense.turbulence > 0.55 && sense.holdingLieDist > sense.lieRadius) {
          yaw += -Math.sign(sense.lateralX || 0.01) * (sense.turbulence - 0.55) * 0.12;
        }
        // v1.10: light cue bias while relocating — never when heat-dominated
        if (hs < 0.28 && sense.odorStrength > 0.05) {
          const homeGain = this.applyHomingSteer(sense, forward, right, upstream, 0.18);
          yaw += homeGain.yaw;
          pitch += homeGain.pitch * 0.4;
        }
        rationale =
          hs > 0.25
            ? this.energy < 0.4
              ? 'Low energy — seeking cool low-V refuge'
              : 'Heat stress — seeking cooler low-V lie'
            : this.energy < 0.4
              ? 'Low energy — seeking holding lie'
              : 'Hold phase — seeking low-V structure';
        break;
      }
    }

    // Anticipatory avoidance before hard-clamp scrapes
    // Under heat, allow slightly nearer bed when seeking cool pockets
    const allowNearBed =
      this.mode === 'seek_hold' ||
      (this.mode === 'hold' && inLie) ||
      (hs > 0.4 && this.mode === 'hold');
    yaw += this.anticipatoryYaw(sense);
    pitch += this.anticipatoryPitch(sense, allowNearBed, hs);

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

  /**
   * Blend nearest structure lie with coolest/low-V lie under heat stress.
   * Cool runs (hs≈0) keep nearest-lie steering unchanged.
   */
  private seekTargetDir(sense: SenseSnapshot, hs: number): THREE.Vector3 {
    const nearest = sense.toHoldingLie;
    if (hs < 0.05 || sense.toCoolLie.lengthSq() < 1e-8) {
      return nearest.clone();
    }
    const cool = sense.toCoolLie;
    const w = THREE.MathUtils.clamp(hs * 0.9, 0, 0.9);
    return nearest.clone().multiplyScalar(1 - w).addScaledVector(cool, w);
  }

  private applyRefugeSteer(
    sense: SenseSnapshot,
    right: THREE.Vector3,
    weight: number,
    apply: (yawDelta: number, pitchDelta: number) => void,
  ): void {
    if (weight <= 0 || sense.toRefuge.lengthSq() < 1e-6) return;
    // Only steer when local probes actually improve habitat
    const adv = Math.max(0, sense.refugeAdvantage);
    const gain = weight * (0.45 + Math.min(1.4, adv) * 0.55);
    const dir = sense.toRefuge.clone().normalize();
    // Prefer bedward component when probes point cooler/lower
    const pitchMul = dir.y < 0 ? 1.15 : 0.75;
    apply(dir.dot(right) * gain, dir.y * gain * pitchMul);
  }

  /**
   * v1.10 olfactory / rheotaxis-lite: bias toward natal cue / upstream when
   * a gradient is available. Does not run inside settled holds (caller gates).
   */
  private applyHomingSteer(
    sense: SenseSnapshot,
    forward: THREE.Vector3,
    right: THREE.Vector3,
    upstream: THREE.Vector3,
    weight: number,
  ): { yaw: number; pitch: number; thrust: number } {
    const out = { yaw: 0, pitch: 0, thrust: 0 };
    if (weight <= 0 || sense.odorStrength < 0.02) return out;
    const str = THREE.MathUtils.clamp(sense.odorStrength, 0, 1);
    // Light OOM bias — must not flatten hold residency (duty_cycle gate)
    const gain = weight * (0.18 + str * 0.38);
    if (sense.toHome.lengthSq() > 1e-6) {
      const dir = sense.toHome.clone().normalize();
      // Prefer streamwise (+Z); damp lateral so we don't wall-seek
      const flat = new THREE.Vector3(dir.x * 0.22, 0, Math.max(0.2, dir.z));
      if (flat.lengthSq() > 1e-8) flat.normalize();
      out.yaw += flat.dot(right) * gain;
      out.yaw += new THREE.Vector3().crossVectors(forward, upstream).y * gain * 0.42;
      out.pitch += dir.y * gain * 0.08;
      // Tiny thrust nudge only — activity cost still dominates (v1.6)
      if (dir.z > 0.25 && this.energy > 0.55) {
        out.thrust = 0.015 + str * 0.035 * weight;
      }
    } else {
      out.yaw += new THREE.Vector3().crossVectors(forward, upstream).y * gain * 0.15;
    }
    return out;
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

  private anticipatoryPitch(
    sense: SenseSnapshot,
    allowNearBed: boolean,
    hs = 0,
  ): number {
    let pitch = 0;
    // Even when using structure, keep a minimum bed buffer to cut scrape chatter
    // Under heat, allow slightly nearer bed for cooler pockets (still buffered)
    const bedStart = allowNearBed ? 0.72 - hs * 0.12 : 1.2;
    const surfStart = 1.2;
    if (sense.bedClearance < bedStart) {
      pitch += ((bedStart - sense.bedClearance) / Math.max(0.05, bedStart)) * 1.05;
    }
    if (sense.surfaceClearance < surfStart) {
      pitch -= ((surfStart - sense.surfaceClearance) / surfStart) * 0.85;
    }
    return pitch;
  }

  private selectMode(dt: number, sense: SenseSnapshot, hs: number): void {
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
      this.enterHoldPhase(hs);
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
    // v1.9: under heat, also drop earlier when warm mid-channel (leave warm core)
    const warmCorePush =
      hs > 0.28 &&
      Math.abs(sense.lateralX) < 2.0 &&
      sense.tempC > sense.midChannelTempC - 0.35;
    if (
      this.phase === 'migrate' &&
      ((inLie && this.energy < 0.42) ||
        (warmCorePush && this.energy < 0.78 && this.phaseElapsed >= 1.2))
    ) {
      this.enterHoldPhase(hs);
      this.lieResidency = inLie ? dt : 0;
      this.mode = inLie ? 'hold' : 'seek_hold';
      return;
    }

    // --- Duty-cycle transitions (v1.8 stronger migrate→hold hysteresis) ---
    if (this.phase === 'migrate') {
      // Under heat: tired sooner; migrate bouts end a bit earlier
      const tired = this.energy < 0.48 + hs * 0.1;
      const boutDone =
        this.phaseElapsed >= this.migrateTarget &&
        this.phaseElapsed >= this.minMigrateHold * (1 - hs * 0.15);
      // Hard hydraulics end migrate early → seek lie (burst path still separate)
      const hydraulicsPush =
        sense.flowSpeed > 1.2 || sense.obstacleAhead > 0.82 || sense.shear > 0.5;
      // Leave warm mid-channel faster under heat stress
      const heatPush =
        hs > 0.3 &&
        this.phaseElapsed >= 1.5 &&
        Math.abs(sense.lateralX) < 2.0 &&
        sense.tempC >= sense.midChannelTempC - 0.25;
      if (
        tired ||
        boutDone ||
        (hydraulicsPush && this.phaseElapsed >= 2.0) ||
        heatPush
      )
        this.enterHoldPhase(hs);
    } else {
      // Leave hold only when recovered + long bout + residency (even while in lie).
      // Default duty stays holding; ascent still needs occasional migrate windows.
      // Under heat: require higher recovery / longer residency before leaving cool refuge
      const recovered = this.energy > 0.58 + hs * 0.08;
      const boutDone =
        this.phaseElapsed >= this.holdTarget &&
        this.phaseElapsed >= this.minHoldLeave * (1 + hs * 0.2);
      const resided =
        this.lieResidency >= this.minLieResidency * (1 + hs * 0.25) ||
        (this.lieResidency === 0 && this.phaseElapsed >= this.holdTarget * 1.1);
      if (recovered && boutDone && resided) {
        this.enterMigratePhase(hs);
        this.lieResidency = 0;
      }
    }

    if (this.phase === 'hold') {
      // Hold only in structure; never sit in mid-channel core while "holding"
      // Under heat: also treat strong local cool/low-V pocket as acceptable sit
      const coolPocket =
        hs > 0.3 &&
        sense.refugeAdvantage < 0.35 &&
        sense.flowSpeed < 0.32 &&
        sense.tempC < sense.midChannelTempC - 0.45;
      this.mode = inLie || coolPocket ? 'hold' : 'seek_hold';
      return;
    }

    // Migrate phase — low default duty; drop to hold if energy softens
    if (this.energy < 0.48 + hs * 0.08) {
      this.enterHoldPhase(hs);
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
