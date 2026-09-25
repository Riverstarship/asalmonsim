import * as THREE from 'three';
import { DEFAULT_CONFIG, type SimConfig } from '../../src/config';
import { CoreSim, type CoreMetrics } from '../../src/sim/CoreSim';

export interface ScenarioDef {
  id: string;
  description: string;
  seed: number;
  dt: number;
  duration: number;
  start: [number, number, number];
  initialEnergy?: number;
  /** Optional discharge scale override (higher = harder flow). */
  dischargeScale?: number;
  config?: Partial<SimConfig>;
  /** Harness: lock DecisionLayer mode for metabolic probes. */
  forceMode?: 'hold' | 'cruise' | 'burst' | 'seek_hold';
}

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'hold_midchannel',
    description:
      'Near structure lie; duty-cycle hold limits downstream slip / low ground speed',
    seed: 101,
    dt: 1 / 30,
    duration: 24,
    start: [0.2, 1.6, 12.0],
    initialEnergy: 0.4,
    dischargeScale: 1.05,
  },
  {
    id: 'seek_lie_when_tired',
    description: 'Low energy + high flow → reaches/occupies a holding lie',
    seed: 202,
    dt: 1 / 30,
    duration: 45,
    start: [-1.5, 1.2, 16],
    initialEnergy: 0.26,
    dischargeScale: 1.3,
  },
  {
    id: 'upstream_dmg',
    description: 'Migratory bouts accumulate upstream DMG (hold bouts allowed)',
    seed: 303,
    dt: 1 / 30,
    duration: 70,
    start: [0, 1.8, 8],
    initialEnergy: 1.0,
    dischargeScale: 0.75,
  },
  {
    id: 'energy_burst_limits',
    description: 'Sustained burst drains energy; cannot stay at max thrust forever',
    seed: 404,
    dt: 1 / 30,
    duration: 22,
    start: [0, 1.6, 42],
    initialEnergy: 1.0,
    dischargeScale: 1.55,
  },
  {
    id: 'stability',
    description: 'No NaN; stays in river bounds roughly',
    seed: 505,
    dt: 1 / 30,
    duration: 60,
    start: [0, 1.7, 8],
    initialEnergy: 0.85,
    dischargeScale: 1.0,
  },
  {
    id: 'containment',
    description:
      'Hard bed/bank/surface clamp: time above surface ≈ 0; penetration scrapes bounded',
    seed: 606,
    dt: 1 / 30,
    duration: 40,
    // Start near surface and a bank to stress containment
    start: [4.2, 2.4, 25],
    initialEnergy: 0.85,
    dischargeScale: 1.15,
  },
  {
    id: 'duty_cycle_ethology',
    description:
      'Stepwise ascent: substantial hold / low-speed hold; mid-column while migrating; low scrapes',
    seed: 730,
    dt: 1 / 30,
    duration: 90,
    start: [0.3, 1.7, 11],
    initialEnergy: 0.85,
    dischargeScale: 0.95,
  },
  {
    id: 'attitude_hydro',
    description:
      'Dorsal-up attitude plant: |roll| bounded, roll-rate low — no sustained corkscrew',
    seed: 814,
    dt: 1 / 30,
    duration: 75,
    start: [0.2, 1.8, 10],
    initialEnergy: 0.9,
    dischargeScale: 1.05,
  },
  {
    id: 'fatigue_cruise_drain',
    description:
      'Forced continuous cruise: activity drains energy over wall time (Lennox-informed OOM)',
    seed: 916,
    dt: 1 / 30,
    duration: 16,
    start: [0.15, 1.9, 14],
    initialEnergy: 1.0,
    dischargeScale: 1.0,
    forceMode: 'cruise',
    config: { tempOverrideC: 10 },
  },
  {
    id: 'fatigue_hold_recover',
    description:
      'Forced hold in structure: low drain / recovery vs cruise over same wall time',
    seed: 917,
    dt: 1 / 30,
    duration: 16,
    start: [0.2, 1.6, 12.0],
    initialEnergy: 0.55,
    dischargeScale: 1.0,
    forceMode: 'hold',
    config: { tempOverrideC: 10 },
  },
  {
    id: 'fatigue_temp_warm',
    description: 'Forced cruise at warm water — modestly higher drain than cool',
    seed: 918,
    dt: 1 / 30,
    duration: 8,
    start: [0.15, 1.9, 14],
    initialEnergy: 1.0,
    dischargeScale: 1.0,
    forceMode: 'cruise',
    config: { tempOverrideC: 16 },
  },
  {
    id: 'fatigue_temp_cool',
    description: 'Forced cruise at cool water — lower drain than warm',
    seed: 918,
    dt: 1 / 30,
    duration: 8,
    start: [0.15, 1.9, 14],
    initialEnergy: 1.0,
    dischargeScale: 1.0,
    forceMode: 'cruise',
    config: { tempOverrideC: 6 },
  },
  {
    id: 'undulatory_gait_cruise',
    description:
      'Forced cruise: traveling-wave amp/freq/power elevated; thrust tracks wave intensity',
    seed: 1020,
    dt: 1 / 30,
    duration: 12,
    start: [0.15, 1.9, 14],
    initialEnergy: 1.0,
    dischargeScale: 1.0,
    forceMode: 'cruise',
    config: { tempOverrideC: 10 },
  },
  {
    id: 'undulatory_gait_hold',
    description:
      'Forced hold: wave nearly quiet; wave power ≪ cruise (gait intensity gate)',
    seed: 1021,
    dt: 1 / 30,
    duration: 12,
    start: [0.2, 1.6, 12.0],
    initialEnergy: 0.7,
    dischargeScale: 1.0,
    forceMode: 'hold',
    config: { tempOverrideC: 10 },
  },
  {
    id: 'thermorefuge_warm',
    description:
      'Heat stress: adult bias toward cooler + lower-V refuge vs mid-channel core',
    seed: 1190,
    dt: 1 / 30,
    duration: 70,
    start: [0.15, 2.0, 14],
    initialEnergy: 0.72,
    dischargeScale: 1.0,
    config: { tempOverrideC: 17 },
  },
  {
    id: 'thermorefuge_cool',
    description:
      'Cool control (same start/seed/flow): little heat-driven refuge bias',
    seed: 1190,
    dt: 1 / 30,
    duration: 70,
    start: [0.15, 2.0, 14],
    initialEnergy: 0.72,
    dischargeScale: 1.0,
    config: { tempOverrideC: 9 },
  },
];

export function runScenario(def: ScenarioDef): CoreMetrics {
  const cfg: SimConfig = {
    ...DEFAULT_CONFIG,
    ...def.config,
    dischargeScale: def.dischargeScale ?? DEFAULT_CONFIG.dischargeScale,
  };
  const sim = new CoreSim({
    config: cfg,
    seed: def.seed,
    headless: true,
    startPosition: new THREE.Vector3(...def.start),
    initialEnergy: def.initialEnergy,
    forceMode: def.forceMode,
  });
  return sim.run(def.duration, def.dt);
}
