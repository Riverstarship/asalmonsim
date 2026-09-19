import * as THREE from 'three';
import { DEFAULT_CONFIG, type SimConfig } from '../config';
import { RiverEnvironment } from '../env/River';
import { Salmon } from '../fish/Salmon';
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
  minEnergy: number;
  maxEnergy: number;
  endEnergy: number;
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
  private lastDecision: DecisionOutput | null = null;

  constructor(opts: CoreSimOptions = {}) {
    const cfg = opts.config ?? DEFAULT_CONFIG;
    const headless = opts.headless ?? false;
    const seed = opts.seed ?? 42;
    this.rng = new SeededRng(seed);
    this.river = new RiverEnvironment(cfg, { visual: !headless });
    const start = opts.startPosition?.clone() ?? new THREE.Vector3(0, 1.2, 8);
    this.fish = new Salmon(start, { visual: !headless });
    this.decisions = new DecisionLayer(this.rng);
    if (opts.initialEnergy !== undefined) {
      this.decisions.setEnergy(opts.initialEnergy);
      this.fish.energy = opts.initialEnergy;
    }
    this.startZ = start.z;
    this.prevZ = start.z;
    this.minEnergy = this.decisions.getEnergy();
    this.maxEnergy = this.decisions.getEnergy();
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
      minEnergy: this.minEnergy,
      maxEnergy: this.maxEnergy,
      endEnergy: energy,
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
        if (this.fish.groundSpeed < 0.28) this.timeHoldLowSpeed += dt;
        break;
      case 'seek_hold':
        this.timeInSeekHold += dt;
        break;
      case 'burst':
        this.timeInBurst += dt;
        this.timeMigrate += dt;
        this.migrateDmg += dz;
        if (midColumn) this.timeMidColumnMigrate += dt;
        break;
      case 'cruise':
        this.timeInCruise += dt;
        this.timeMigrate += dt;
        this.migrateDmg += dz;
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
  }
}
