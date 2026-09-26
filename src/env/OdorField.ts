import * as THREE from 'three';
import type { EnvOdorSource } from './packs';

/** Natal cue on / flat control for harness comparisons. */
export type OdorMode = 'natal' | 'flat';

export interface OdorFieldOptions {
  mode?: OdorMode;
  source?: EnvOdorSource;
  /** Fallback corridor length when source.z not given. */
  length?: number;
}

/**
 * Simple olfactory / natal-homing cue field (v1.10).
 * Source upstream (high +Z spawn marker); concentration falls with distance
 * and is lightly diluted by fast mid-channel flow. Flat mode returns a
 * constant field (no gradient) for control runs.
 * Source from env pack when provided (v1.11).
 */
export class OdorField {
  readonly mode: OdorMode;
  /** Natal / spawn cue source (m). */
  readonly source: THREE.Vector3;
  /** Along-river falloff length scale (m). */
  private readonly lengthScale: number;

  constructor(modeOrOpts: OdorMode | OdorFieldOptions = 'natal') {
    const opts: OdorFieldOptions =
      typeof modeOrOpts === 'string' ? { mode: modeOrOpts } : modeOrOpts;
    this.mode = opts.mode ?? 'natal';
    const length = opts.length ?? 80;
    if (opts.source) {
      this.source = new THREE.Vector3(opts.source.x, opts.source.y, opts.source.z);
      this.lengthScale = opts.source.lengthScale ?? 36;
    } else {
      this.source = new THREE.Vector3(0.15, 1.55, length - 6);
      this.lengthScale = 36;
    }
  }

  /**
   * Concentration ~0–1 at world position.
   * Optional flowSpeed dilutes cue in the fast jet (rheotaxis-friendly banks).
   */
  sample(x: number, y: number, z: number, flowSpeed = 0): number {
    if (this.mode === 'flat') return 0.45;
    const dx = x - this.source.x;
    const dy = y - this.source.y;
    const dz = z - this.source.z;
    const dist = Math.sqrt(dx * dx + dy * dy * 0.6 + dz * dz);
    let c = Math.exp(-dist / this.lengthScale);
    const dil = 1 / (1 + Math.max(0, flowSpeed) * 0.5);
    c *= 0.62 + 0.38 * dil;
    return THREE.MathUtils.clamp(c, 0, 1);
  }

  /**
   * Vector toward higher cue (toward natal source). Zero length when flat.
   */
  toHome(x: number, y: number, z: number): THREE.Vector3 {
    if (this.mode === 'flat') return new THREE.Vector3(0, 0, 0);
    return this.source.clone().sub(new THREE.Vector3(x, y, z));
  }

  /** Scalar cue strength for decision weighting (0 flat / far → 1 near source). */
  strength(x: number, y: number, z: number, flowSpeed = 0): number {
    if (this.mode === 'flat') return 0;
    const c = this.sample(x, y, z, flowSpeed);
    const dist = Math.hypot(x - this.source.x, z - this.source.z);
    const climbLeft = THREE.MathUtils.clamp(dist / this.lengthScale, 0.15, 1);
    return c * climbLeft;
  }
}
