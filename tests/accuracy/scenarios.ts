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
}

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'hold_midchannel',
    description: 'Start mid-channel moderate flow; hold mode limits downstream slip',
    seed: 101,
    dt: 1 / 30,
    duration: 12,
    start: [0.15, 1.0, 11.8],
    initialEnergy: 0.48,
    dischargeScale: 1.05,
  },
  {
    id: 'seek_lie_when_tired',
    description: 'Low energy + high flow → reaches/occupies a holding lie',
    seed: 202,
    dt: 1 / 30,
    duration: 45,
    start: [-1.5, 0.8, 16],
    initialEnergy: 0.26,
    dischargeScale: 1.3,
  },
  {
    id: 'upstream_dmg',
    description: 'Cruise/rheotaxis net upstream distance-made-good over window',
    seed: 303,
    dt: 1 / 30,
    duration: 45,
    start: [0, 1.2, 8],
    initialEnergy: 0.9,
    dischargeScale: 0.85,
  },
  {
    id: 'energy_burst_limits',
    description: 'Sustained burst drains energy; cannot stay at max thrust forever',
    seed: 404,
    dt: 1 / 30,
    duration: 22,
    start: [0, 1.4, 42],
    initialEnergy: 1.0,
    dischargeScale: 1.55,
  },
  {
    id: 'stability',
    description: 'No NaN; stays in river bounds roughly',
    seed: 505,
    dt: 1 / 30,
    duration: 60,
    start: [0, 1.2, 8],
    initialEnergy: 0.8,
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
    start: [4.8, 3.4, 25],
    initialEnergy: 0.85,
    dischargeScale: 1.2,
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
  });
  return sim.run(def.duration, def.dt);
}
