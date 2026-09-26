/**
 * Portable habitat / environment pack (v1.11).
 * Fish plant keeps sample() APIs; packs swap reach geometry + structure markers.
 */

export type LieKind = 'pool' | 'bank_scallop' | 'boulder_wake';

export interface EnvLieMarker {
  x: number;
  y: number;
  z: number;
  radius: number;
  /** Peak streamwise deficit fraction at centre (0–1). */
  deficit: number;
  kind: LieKind;
}

/** Soft along-river pool well for Continuous CurrentField.runPoolMul. */
export interface EnvPoolWell {
  z: number;
  w: number;
  sigma: number;
}

export interface EnvOdorSource {
  x: number;
  y: number;
  z: number;
  /** Along-river falloff length scale (m). */
  lengthScale?: number;
}

/**
 * Habitat data pack — reach extents + optional structure / odor markers.
 * Velocity / temp / odor fields remain synthetic samplers driven by this data.
 */
export interface EnvPack {
  id: string;
  name: string;
  length: number;
  width: number;
  depth: number;
  bankSlope?: number;
  lies: EnvLieMarker[];
  /** Soft pool decelerations along Z (defaults derived from pool lies if omitted). */
  poolWells?: EnvPoolWell[];
  odorSource?: EnvOdorSource;
}

export type EnvPackId = 'synthetic_ascent_v1' | 'pool_riffle_v1';
