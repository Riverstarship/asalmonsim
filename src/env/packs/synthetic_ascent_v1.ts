import type { EnvPack } from './types';

/**
 * Default habitat pack — parity with pre-v1.11 hard-coded corridor.
 * 80 m × 12 m × 4 m, five structure lies.
 */
export const SYNTHETIC_ASCENT_V1: EnvPack = {
  id: 'synthetic_ascent_v1',
  name: 'Synthetic ascent (default)',
  length: 80,
  width: 12,
  depth: 4,
  bankSlope: 0.4,
  lies: [
    { x: -2.4, y: 1.65, z: 18, radius: 2.2, kind: 'bank_scallop', deficit: 0.72 },
    { x: 2.5, y: 1.7, z: 35, radius: 2.3, kind: 'boulder_wake', deficit: 0.78 },
    { x: -2.0, y: 1.6, z: 52, radius: 2.1, kind: 'pool', deficit: 0.65 },
    { x: 2.2, y: 1.7, z: 68, radius: 2.2, kind: 'boulder_wake', deficit: 0.75 },
    { x: 0.2, y: 1.6, z: 12, radius: 2.0, kind: 'pool', deficit: 0.6 },
  ],
  poolWells: [
    { z: 12, w: 0.18, sigma: 4.5 },
    { z: 18, w: 0.12, sigma: 3.5 },
    { z: 35, w: 0.1, sigma: 3.8 },
    { z: 52, w: 0.2, sigma: 5.0 },
    { z: 68, w: 0.12, sigma: 3.6 },
  ],
  odorSource: { x: 0.15, y: 1.55, z: 74, lengthScale: 36 },
};
