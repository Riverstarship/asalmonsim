import * as THREE from 'three';
import { DEFAULT_CONFIG, type SimConfig } from '../config';
import { RiverEnvironment } from '../env/River';
import type { OdorMode } from '../env/OdorField';
import { Salmon } from '../fish/Salmon';
import { Hydrodynamics } from '../fish/Hydrodynamics';
import { DecisionLayer, type DecisionOutput } from '../ai/DecisionLayer';
import { sense, type SenseSnapshot } from '../ai/Sensors';
import { SeededRng } from '../util/rng';

export interface CoreSimOptions {
  config?: SimConfig;
  /** PRNG seed for decision jitter (deterministic scenarios). */
  seed?: number;
  startPosition?: THREE.Vector3;
  /** Skip Three.js visual meshes (Node / accuracy harness). */
  headless?: boolean;
  /** Initial energy 0–1. */
  initialEnergy?: number;
  /** Harness: lock DecisionLayer mode for metabolic probes. */
  forceMode?: 'hold' | 'cruise' | 'burst' | 'seek_hold';
  /** Natal cue mode (v1.10). Default 'natal'; use 'flat' for control. */
  odorMode?: OdorMode;
}

export interface CoreMetrics {
  time: number;
  steps: number;
  startZ: number;
  endZ: number;
  /** Net upstream distance-made-good (Δz). */
  dmg: number;
  /** Upstream DMG accumulated only during migratory modes (cruise/burst). */
  migrateDmg: number;
  initialEnergy: number;
  minEnergy: number;
  maxEnergy: number;
  endEnergy: number;
  /** end − initial (negative = net drain). */
  netEnergyChange: number;
  timeInLie: number;
  timeInHold: number;
  timeInSeekHold: number;
  timeInBurst: number;
  timeInCruise: number;
  /** Seconds in hold with near-zero ground speed (energy-saving station-hold). */
  timeHoldLowSpeed: number;
  /** Seconds mid-column during migratory cruise/burst bouts. */
  timeMidColumnMigrate: number;
  /** Fraction of total time in hold mode. */
  holdFraction: number;
  /** Mid-column fraction of migratory (cruise+burst) time. */
  midColumnMigrateFraction: number;
  maxThrust: number;
  meanThrust: number;
  meanFlowSpeed: number;
  maxAbsX: number;
  minY: number;
  maxY: number;
  nanCount: number;
  outOfBoundsCount: number;
  lastMode: string;
  lastRationale: string;
  lastPhase: string;
  occupiedLie: boolean;
  reachedLie: boolean;
  /** Mean downstream ground speed while in hold (slip proxy). */
  holdDownstreamSlip: number;
  /** Time-weighted samples used for hold slip mean. */
  holdSlipSamples: number;
  /** Seconds with surfaceClearance < 0 (above free surface). */
  timeAboveSurface: number;
  /** Steps that required bank push-out. */
  bankPenetrationEvents: number;
  /** Steps that required bed push-out. */
  bedPenetrationEvents: number;
  /** Steps that required surface push-out. */
  surfaceBreachEvents: number;
  /** Peak |roll| angle (rad) from quaternion (belly-down error about forward). */
  maxAbsRoll: number;
  /** Mean |roll| angle (rad). */
  meanAbsRoll: number;
  /** Fraction of time with |roll| under 45°. */
  timeRollUnder45Fraction: number;
  /** Mean |ω_roll| (rad/s). */
  meanAbsRollRate: number;
  /** Variance of ω_roll (rad²/s²). */
  rollRateVariance: number;
  /** Peak |ω_roll| (rad/s). */
  maxAbsRollRate: number;
  /** Mean |flow| while in hold mode (m/s). */
  meanHoldFlow: number;
  /** Mean |flow| while occupying a lie (m/s). */
  meanLieFlow: number;
  /** Mean mid-channel reference |flow| sampled at fish y,z during hold (m/s). */
  meanHoldMidRefFlow: number;
  /** Seconds in hold with |x| near mid-channel and local flow near core speed. */
  timeHoldFastCore: number;
  /** hold samples used for flow means. */
  holdFlowSamples: number;
  lieFlowSamples: number;
  /** Mean sensed water temperature °C. */
  meanTempC: number;
  /** Gross energy drop max−min over the run (fatigue probe). */
  energyDrop: number;
  /** Mean traveling-wave amplitude (m) — undulatory gait. */
  meanWaveAmplitude: number;
  /** Mean wave frequency (Hz). */
  meanWaveFrequency: number;
  /** Mean wave-power proxy (dimensionless). */
  meanWavePower: number;
  /** Mean forward thrust magnitude from hydro (N). */
  meanWaveThrust: number;
  /** Peak wave power observed. */
  maxWavePower: number;
  /** Σ thrustLevel·wavePower / n — for intensity↔power correlation. */
  thrustWaveCov: number;
  /** Mean thrustLevel (same as meanThrust) alias for gait report. */
  meanThrustLevel: number;
  /** Time-weighted mean temp while in hold mode (°C). */
  meanHoldTempC: number;
  /** Time-weighted mid-channel temp during hold (°C). */
  meanHoldMidTempC: number;
  /** meanHoldMidTempC − meanHoldTempC (positive = holding cooler than mid-channel). */
  holdTempDeficit: number;
  /** Seconds in hold in cooler-than-midchannel + low-V pocket. */
  timeCoolRefuge: number;
  /** Seconds in hold in warm mid-channel core. */
  timeWarmCore: number;
  /** timeCoolRefuge / timeInHold (0 if no hold). */
  coolRefugeHoldFraction: number;
  /** Mean natal cue concentration. */
  meanOdor: number;
  /** Start / end cue concentration. */
  startOdor: number;
  endOdor: number;
  /** Net cue climb over run (end − start; positive = toward natal source). */
  cueAscent: number;
  /** Cue climb accumulated only during migratory cruise/burst. */
  migrateCueClimb: number;
  /** Mean |toHome| streamwise component during migrate (m remaining proxy). */
  meanMigrateHomeZ: number;
}

/**
 * Headless-capable core loop: sense → decide → apply → integrate.
 * Shared by browser Simulation and Node accuracy harness.
 */
export class CoreSim {
  readonly river: RiverEnvironment;
  readonly fish: Salmon;
  readonly decisions: DecisionLayer;
  readonly rng: SeededRng;

  time = 0;
  steps = 0;
  private readonly startZ: number;
  private thrustSum = 0;
  private flowSum = 0;
  private timeInLie = 0;
  private timeInHold = 0;
  private timeInSeekHold = 0;
  private timeInBurst = 0;
  private timeInCruise = 0;
  private timeHoldLowSpeed = 0;
  private timeMidColumnMigrate = 0;
  private timeMigrate = 0;
  private migrateDmg = 0;
  private prevZ: number;
  private maxThrust = 0;
  private minEnergy = 1;
  private maxEnergy = 0;
  private maxAbsX = 0;
  private minY = Infinity;
  private maxY = -Infinity;
  private nanCount = 0;
  private outOfBoundsCount = 0;
  private occupiedLie = false;
  private reachedLie = false;
  private holdSlipSum = 0;
  private holdSlipSamples = 0;
  private timeAboveSurface = 0;
  private bankPenetrationEvents = 0;
  private bedPenetrationEvents = 0;
  private surfaceBreachEvents = 0;
  private absRollSum = 0;
  private maxAbsRoll = 0;
  private timeRollUnder45 = 0;
  private absRollRateSum = 0;
  private maxAbsRollRate = 0;
  private rollRateSum = 0;
  private rollRateSqSum = 0;
  private holdFlowSum = 0;
  private holdFlowSamples = 0;
  private holdMidRefSum = 0;
  private lieFlowSum = 0;
  private lieFlowSamples = 0;
  private timeHoldFastCore = 0;
  private tempSum = 0;
  private holdTempSum = 0;
  private holdMidTempSum = 0;
  private holdTempSamples = 0;
  private timeCoolRefuge = 0;
  private timeWarmCore = 0;
  private odorSum = 0;
  private startOdor = 0;
  private endOdor = 0;
  private odorInitialized = false;
  private migrateCueClimb = 0;
  private prevOdor = 0;
  private migrateHomeZSum = 0;
  private migrateHomeZSamples = 0;
  private waveAmpSum = 0;
  private waveFreqSum = 0;
  private wavePowerSum = 0;
  private waveThrustSum = 0;
  private maxWavePower = 0;
  private thrustWaveProdSum = 0;
  private initialEnergy = 1;
  private lastDecision: DecisionOutput | null = null;
  private readonly _rollRight = new THREE.Vector3();
  private readonly _rollForward = new THREE.Vector3();
  private readonly _rollUp = new THREE.Vector3();
  private readonly _rollWorldUp = new THREE.Vector3(0, 1, 0);
  private readonly _rollTmp = new THREE.Vector3();

  constructor(opts: CoreSimOptions = {}) {
    const cfg = opts.config ?? DEFAULT_CONFIG;
    const headless = opts.headless ?? false;
    const seed = opts.seed ?? 42;
    this.rng = new SeededRng(seed);
    this.river = new RiverEnvironment(cfg, {
      visual: !headless,
      odorMode: opts.odorMode ?? 'natal',
    });
    const start = opts.startPosition?.clone() ?? new THREE.Vector3(0, 1.2, 8);
    this.fish = new Salmon(start, { visual: !headless });
    this.decisions = new DecisionLayer(this.rng);
    if (opts.initialEnergy !== undefined) {
      this.decisions.setEnergy(opts.initialEnergy);
      this.fish.energy = opts.initialEnergy;
    }
    if (opts.forceMode) {
      this.decisions.setForceMode(opts.forceMode);
    }
    this.startZ = start.z;
    this.prevZ = start.z;
    this.initialEnergy = this.decisions.getEnergy();
    this.minEnergy = this.initialEnergy;
    this.maxEnergy = this.initialEnergy;
  }

  /** One sim step — hydro sample, sensors, decisions, integration. */
  step(dt: number): DecisionOutput {
    const snap = sense(this.fish, this.river);
    const decision = this.decisions.update(dt, snap, this.fish.orientation);
    this.fish.applyDecision(decision);
    this.fish.update(dt, this.river);
    this.time += dt;
    this.steps += 1;
    this.accumulate(dt, decision, snap);
    this.lastDecision = decision;
    return decision;
  }

  /** Run for `duration` seconds at fixed `dt`. */
  run(duration: number, dt: number): CoreMetrics {
    const n = Math.max(1, Math.round(duration / dt));
    for (let i = 0; i < n; i++) this.step(dt);
    return this.metrics();
  }

  metrics(): CoreMetrics {
    const p = this.fish.position;
    const energy = this.decisions.getEnergy();
    const migrateT = this.timeMigrate;
    return {
      time: this.time,
      steps: this.steps,
      startZ: this.startZ,
      endZ: p.z,
      dmg: p.z - this.startZ,
      migrateDmg: this.migrateDmg,
      initialEnergy: this.initialEnergy,
      minEnergy: this.minEnergy,
      maxEnergy: this.maxEnergy,
      endEnergy: energy,
      netEnergyChange: energy - this.initialEnergy,
      timeInLie: this.timeInLie,
      timeInHold: this.timeInHold,
      timeInSeekHold: this.timeInSeekHold,
      timeInBurst: this.timeInBurst,
      timeInCruise: this.timeInCruise,
      timeHoldLowSpeed: this.timeHoldLowSpeed,
      timeMidColumnMigrate: this.timeMidColumnMigrate,
      holdFraction: this.time > 0 ? this.timeInHold / this.time : 0,
      midColumnMigrateFraction:
        migrateT > 0 ? this.timeMidColumnMigrate / migrateT : 0,
      maxThrust: this.maxThrust,
      meanThrust: this.steps > 0 ? this.thrustSum / this.steps : 0,
      meanFlowSpeed: this.steps > 0 ? this.flowSum / this.steps : 0,
      maxAbsX: this.maxAbsX,
      minY: this.minY === Infinity ? p.y : this.minY,
      maxY: this.maxY === -Infinity ? p.y : this.maxY,
      nanCount: this.nanCount,
      outOfBoundsCount: this.outOfBoundsCount,
      lastMode: this.lastDecision?.mode ?? 'cruise',
      lastRationale: this.lastDecision?.rationale ?? '',
      lastPhase: this.lastDecision?.phase ?? 'migrate',
      occupiedLie: this.occupiedLie,
      reachedLie: this.reachedLie,
      holdDownstreamSlip:
        this.holdSlipSamples > 0 ? this.holdSlipSum / this.holdSlipSamples : 0,
      holdSlipSamples: this.holdSlipSamples,
      timeAboveSurface: this.timeAboveSurface,
      bankPenetrationEvents: this.bankPenetrationEvents,
      bedPenetrationEvents: this.bedPenetrationEvents,
      surfaceBreachEvents: this.surfaceBreachEvents,
      maxAbsRoll: this.maxAbsRoll,
      meanAbsRoll: this.steps > 0 ? this.absRollSum / this.steps : 0,
      timeRollUnder45Fraction: this.time > 0 ? this.timeRollUnder45 / this.time : 1,
      meanAbsRollRate: this.steps > 0 ? this.absRollRateSum / this.steps : 0,
      rollRateVariance:
        this.steps > 1
          ? Math.max(
              0,
              this.rollRateSqSum / this.steps -
                (this.rollRateSum / this.steps) ** 2,
            )
          : 0,
      maxAbsRollRate: this.maxAbsRollRate,
      meanHoldFlow:
        this.holdFlowSamples > 0 ? this.holdFlowSum / this.holdFlowSamples : 0,
      meanLieFlow:
        this.lieFlowSamples > 0 ? this.lieFlowSum / this.lieFlowSamples : 0,
      meanHoldMidRefFlow:
        this.holdFlowSamples > 0 ? this.holdMidRefSum / this.holdFlowSamples : 0,
      timeHoldFastCore: this.timeHoldFastCore,
      holdFlowSamples: this.holdFlowSamples,
      lieFlowSamples: this.lieFlowSamples,
      meanTempC: this.steps > 0 ? this.tempSum / this.steps : 0,
      energyDrop: this.maxEnergy - this.minEnergy,
      meanWaveAmplitude: this.steps > 0 ? this.waveAmpSum / this.steps : 0,
      meanWaveFrequency: this.steps > 0 ? this.waveFreqSum / this.steps : 0,
      meanWavePower: this.steps > 0 ? this.wavePowerSum / this.steps : 0,
      meanWaveThrust: this.steps > 0 ? this.waveThrustSum / this.steps : 0,
      maxWavePower: this.maxWavePower,
      thrustWaveCov: this.steps > 0 ? this.thrustWaveProdSum / this.steps : 0,
      meanThrustLevel: this.steps > 0 ? this.thrustSum / this.steps : 0,
      meanHoldTempC:
        this.holdTempSamples > 0 ? this.holdTempSum / this.holdTempSamples : 0,
      meanHoldMidTempC:
        this.holdTempSamples > 0 ? this.holdMidTempSum / this.holdTempSamples : 0,
      holdTempDeficit:
        this.holdTempSamples > 0
          ? this.holdMidTempSum / this.holdTempSamples -
            this.holdTempSum / this.holdTempSamples
          : 0,
      timeCoolRefuge: this.timeCoolRefuge,
      timeWarmCore: this.timeWarmCore,
      coolRefugeHoldFraction:
        this.timeInHold > 0 ? this.timeCoolRefuge / this.timeInHold : 0,
      meanOdor: this.steps > 0 ? this.odorSum / this.steps : 0,
      startOdor: this.startOdor,
      endOdor: this.endOdor,
      cueAscent: this.endOdor - this.startOdor,
      migrateCueClimb: this.migrateCueClimb,
      meanMigrateHomeZ:
        this.migrateHomeZSamples > 0
          ? this.migrateHomeZSum / this.migrateHomeZSamples
          : 0,
    };
  }

  /** Live HUD helpers (browser). */
  get dmg(): number {
    return this.fish.position.z - this.startZ;
  }

  get timeInLieSec(): number {
    return this.timeInLie;
  }

  private accumulate(dt: number, decision: DecisionOutput, snap: SenseSnapshot): void {
    const p = this.fish.position;
    this.thrustSum += decision.thrustLevel;
    this.flowSum += snap.flowSpeed;
    this.tempSum += snap.tempC;
    this.odorSum += snap.odor;
    if (!this.odorInitialized) {
      this.startOdor = snap.odor;
      this.prevOdor = snap.odor;
      this.odorInitialized = true;
    }
    this.endOdor = snap.odor;
    const dOdor = snap.odor - this.prevOdor;
    this.prevOdor = snap.odor;
    this.maxThrust = Math.max(this.maxThrust, decision.thrustLevel);
    this.minEnergy = Math.min(this.minEnergy, decision.energy);
    this.maxEnergy = Math.max(this.maxEnergy, decision.energy);
    this.maxAbsX = Math.max(this.maxAbsX, Math.abs(p.x));
    this.minY = Math.min(this.minY, p.y);
    this.maxY = Math.max(this.maxY, p.y);

    if (
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.y) ||
      !Number.isFinite(p.z) ||
      !Number.isFinite(decision.energy) ||
      !Number.isFinite(this.fish.hydro.velocity.x)
    ) {
      this.nanCount += 1;
    }

    const r = this.fish.bodyRadius;
    if (
      this.river.bankClearanceAt(p, r) < -0.02 ||
      this.river.bedClearanceAt(p, r) < -0.02 ||
      this.river.surfaceClearanceAt(p, r) < -0.02 ||
      p.z < -2 ||
      p.z > 85
    ) {
      this.outOfBoundsCount += 1;
    }

    if (this.fish.lastBankHit) this.bankPenetrationEvents += 1;
    if (this.fish.lastBedHit) this.bedPenetrationEvents += 1;
    if (this.fish.lastSurfaceHit) this.surfaceBreachEvents += 1;

    if (this.river.surfaceClearanceAt(p, r) < -1e-4) {
      this.timeAboveSurface += dt;
    }

    const dz = p.z - this.prevZ;
    this.prevZ = p.z;

    const midColumn = snap.bedClearance >= 0.55 && snap.surfaceClearance >= 0.65;

    switch (decision.mode) {
      case 'hold':
        this.timeInHold += dt;
        this.holdSlipSum += Math.max(0, -this.fish.hydro.velocity.z);
        this.holdSlipSamples += 1;
        if (this.fish.groundSpeed < 0.32) this.timeHoldLowSpeed += dt;
        break;
      case 'seek_hold':
        this.timeInSeekHold += dt;
        break;
      case 'burst':
        this.timeInBurst += dt;
        this.timeMigrate += dt;
        this.migrateDmg += dz;
        this.migrateCueClimb += dOdor;
        this.migrateHomeZSum += snap.toHome.z;
        this.migrateHomeZSamples += 1;
        if (midColumn) this.timeMidColumnMigrate += dt;
        break;
      case 'cruise':
        this.timeInCruise += dt;
        this.timeMigrate += dt;
        this.migrateDmg += dz;
        this.migrateCueClimb += dOdor;
        this.migrateHomeZSum += snap.toHome.z;
        this.migrateHomeZSamples += 1;
        if (midColumn) this.timeMidColumnMigrate += dt;
        break;
    }

    const lie = this.river.nearestHoldingLie(p);
    const inLie = this.river.occupiesLie(p, lie);
    if (inLie) {
      this.timeInLie += dt;
      this.occupiedLie = true;
      this.reachedLie = true;
    }
    if (snap.holdingLieDist < lie.radius * 1.5) this.reachedLie = true;

    // v1.5 continuous hydraulics: occupancy vs velocity deficit
    if (decision.mode === 'hold') {
      this.holdFlowSum += snap.flowSpeed;
      this.holdFlowSamples += 1;
      const midRef = this.river.current.midChannelSpeed(p.y, p.z);
      this.holdMidRefSum += midRef;
      // Fast core: near centreline and local flow within 75% of mid-channel ref
      if (Math.abs(p.x) < 1.8 && snap.flowSpeed > midRef * 0.75) {
        this.timeHoldFastCore += dt;
      }
      // v1.9 thermoregulatory refuge occupancy
      this.holdTempSum += snap.tempC;
      this.holdMidTempSum += snap.midChannelTempC;
      this.holdTempSamples += 1;
      const coolerThanMid = snap.tempC < snap.midChannelTempC - 0.35;
      const lowV = snap.flowSpeed < 0.38 || inLie;
      if (coolerThanMid && lowV) this.timeCoolRefuge += dt;
      if (
        Math.abs(p.x) < 1.8 &&
        snap.tempC >= snap.midChannelTempC - 0.2 &&
        snap.flowSpeed > midRef * 0.65
      ) {
        this.timeWarmCore += dt;
      }
    }
    if (inLie) {
      this.lieFlowSum += snap.flowSpeed;
      this.lieFlowSamples += 1;
    }

    // Attitude / roll stability (v1.4)
    const roll = this.signedRollRad();
    const absRoll = Math.abs(roll);
    this.absRollSum += absRoll;
    this.maxAbsRoll = Math.max(this.maxAbsRoll, absRoll);
    if (absRoll < Math.PI / 4) this.timeRollUnder45 += dt;
    const wr = this.fish.hydro.angularVelocity.z;
    const absWr = Math.abs(wr);
    this.absRollRateSum += absWr;
    this.maxAbsRollRate = Math.max(this.maxAbsRollRate, absWr);
    this.rollRateSum += wr;
    this.rollRateSqSum += wr * wr;

    // v1.7 undulatory gait metrics
    const w = this.fish.wave;
    this.waveAmpSum += w.amplitude;
    this.waveFreqSum += w.frequencyHz;
    this.wavePowerSum += w.wavePower;
    this.waveThrustSum += this.fish.hydro.lastThrustMag;
    this.maxWavePower = Math.max(this.maxWavePower, w.wavePower);
    this.thrustWaveProdSum += decision.thrustLevel * w.wavePower;
  }

  private signedRollRad(): number {
    return Hydrodynamics.signedRollRad(this.fish.orientation, {
      forward: this._rollForward,
      up: this._rollUp,
      worldUp: this._rollWorldUp,
      wu: this._rollTmp,
      tmp: this._rollRight,
    });
  }
}
