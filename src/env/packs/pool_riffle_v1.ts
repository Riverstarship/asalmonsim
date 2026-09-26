import type { EnvPack } from './types';

/**
 * Longer pool–riffle reach with denser low-V structure / lies.
 * Meaningful geometry change vs synthetic_ascent_v1 (more lies, longer corridor,
 * alternating bank/pool/boulder pattern) without rewriting the fish plant.
 */
export const POOL_RIFFLE_V1: EnvPack = {
  id: 'pool_riffle_v1',
  name: 'Pool–riffle reach',
  length: 120,
  width: 14,
  depth: 4.5,
  bankSlope: 0.35,
  lies: [
    { x: 0.3, y: 1.55, z: 10, radius: 2.4, kind: 'pool', deficit: 0.68 },
    { x: -3.2, y: 1.7, z: 18, radius: 2.1, kind: 'bank_scallop', deficit: 0.74 },
    { x: 3.0, y: 1.65, z: 26, radius: 2.0, kind: 'boulder_wake', deficit: 0.8 },
    { x: -1.0, y: 1.5, z: 34, radius: 2.6, kind: 'pool', deficit: 0.7 },
    { x: 3.4, y: 1.7, z: 42, radius: 2.15, kind: 'bank_scallop', deficit: 0.72 },
    { x: -3.1, y: 1.65, z: 50, radius: 2.2, kind: 'boulder_wake', deficit: 0.78 },
    { x: 0.4, y: 1.45, z: 58, radius: 2.8, kind: 'pool', deficit: 0.72 },
    { x: 3.2, y: 1.7, z: 68, radius: 2.1, kind: 'boulder_wake', deficit: 0.76 },
    { x: -3.3, y: 1.65, z: 78, radius: 2.2, kind: 'bank_scallop', deficit: 0.75 },
    { x: 0.2, y: 1.5, z: 88, radius: 2.5, kind: 'pool', deficit: 0.68 },
    { x: 3.1, y: 1.7, z: 98, radius: 2.15, kind: 'boulder_wake', deficit: 0.77 },
    { x: -2.8, y: 1.6, z: 108, radius: 2.3, kind: 'pool', deficit: 0.66 },
  ],
  poolWells: [
    { z: 10, w: 0.2, sigma: 4.8 },
    { z: 18, w: 0.12, sigma: 3.4 },
    { z: 26, w: 0.1, sigma: 3.2 },
    { z: 34, w: 0.22, sigma: 5.2 },
    { z: 42, w: 0.11, sigma: 3.3 },
    { z: 50, w: 0.12, sigma: 3.5 },
    { z: 58, w: 0.24, sigma: 5.5 },
    { z: 68, w: 0.11, sigma: 3.4 },
    { z: 78, w: 0.12, sigma: 3.5 },
    { z: 88, w: 0.2, sigma: 4.8 },
    { z: 98, w: 0.11, sigma: 3.4 },
    { z: 108, w: 0.18, sigma: 4.5 },
  ],
  odorSource: { x: 0.2, y: 1.6, z: 114, lengthScale: 48 },
};
