import * as THREE from 'three';
import { type SimConfig, meanCurrentSpeed } from '../config';
import type { EnvPack, EnvLieMarker, EnvPoolWell } from './packs';

/**
 * Holding-structure marker (metadata for harness / seek targets).
 * Velocity deficits are applied as smooth continuous kernels, not hard blobs.
 */
export interface LiePocket {
  x: number;
  y: number;
  z: number;
  radius: number;
  /** Peak streamwise deficit fraction at centre (0–1). */
  deficit: number;
  kind: 'pool' | 'bank_scallop' | 'boulder_wake';
}

export interface CurrentFieldOptions {
  width: number;
  depth: number;
  pockets?: LiePocket[] | EnvLieMarker[];
  poolWells?: EnvPoolWell[];
}

/**
 * Continuous synthetic river velocity field (v1.5+).
 * Mid-channel jet, bank boundary layers, depth decay, pool decelerations,
 * and boulder-wake deficits as smooth gradients. sample(x,y,z) API stable.
 * +Z = upstream (fish migrates +Z), current flows −Z.
 * Geometry driven by env pack extents / wells (v1.11).
 */
export class CurrentField {
  readonly meanSpeed: number;
  readonly width: number;
  readonly depth: number;
  private readonly pockets: LiePocket[];
  private readonly poolWells: EnvPoolWell[];

  constructor(cfg: SimConfig, opts: CurrentFieldOptions | LiePocket[] = []) {
    this.meanSpeed = meanCurrentSpeed(cfg);
    // Back-compat: second arg was pockets array
    if (Array.isArray(opts)) {
      this.width = 12;
      this.depth = 4;
      this.pockets = opts;
      this.poolWells = defaultWellsFromPockets(opts);
    } else {
      this.width = opts.width;
      this.depth = opts.depth;
      this.pockets = (opts.pockets ?? []) as LiePocket[];
      this.poolWells = opts.poolWells ?? defaultWellsFromPockets(this.pockets);
    }
  }

  static fromPack(cfg: SimConfig, pack: EnvPack, pockets: LiePocket[]): CurrentField {
    return new CurrentField(cfg, {
      width: pack.width,
      depth: pack.depth,
      pockets,
      poolWells: pack.poolWells,
    });
  }

  /** Sample current velocity at world position (m/s). */
  sample(x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const halfW = this.width * 0.5;
    const nx = THREE.MathUtils.clamp(x / halfW, -1, 1);
    const absNx = Math.abs(nx);

    // Mid-channel jet: flatter core, steeper bank boundary layers
    const jet = Math.pow(1 - Math.pow(absNx, 2.4), 1.15);
    const bankBl = Math.exp(-Math.pow(absNx / 0.92, 6));
    const lateral = THREE.MathUtils.clamp(0.12 + 0.88 * jet * bankBl, 0.08, 1);

    const depthFrac = THREE.MathUtils.clamp(y / this.depth, 0, 1);
    const depthMul = 0.28 + 0.72 * Math.pow(depthFrac, 0.38);

    const runPool = this.runPoolMul(z);

    let stream = this.meanSpeed * lateral * depthMul * runPool;

    let wakeX = 0;
    let wakeZ = 0;
    for (const p of this.pockets) {
      const dx = x - p.x;
      const dy = y - p.y;
      const dz = z - p.z;
      const rx = p.radius * 1.15;
      const ry = p.radius * 1.45;
      const rz = p.radius * (p.kind === 'boulder_wake' ? 1.55 : 1.25);
      const q =
        (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) + (dz * dz) / (rz * rz);
      const fall = Math.exp(-q);
      stream *= 1 - p.deficit * fall;

      if (p.kind === 'boulder_wake') {
        const lee = fall * p.deficit * this.meanSpeed;
        wakeX += -Math.sign(p.x || dx || 0.01) * 0.12 * lee;
        wakeZ += 0.08 * lee;
      }
      if (p.kind === 'bank_scallop') {
        wakeX += -Math.sign(p.x) * 0.1 * this.meanSpeed * fall * p.deficit;
      }
    }

    out.set(wakeX, 0, -stream + wakeZ);

    if (absNx > 0.4) {
      const shear = Math.pow((absNx - 0.4) / 0.6, 1.4) * 0.22 * this.meanSpeed;
      out.x += -Math.sign(nx) * shear * depthMul;
    }

    out.y += Math.sin(z * 0.18 + x * 0.7) * 0.025 * this.meanSpeed * depthMul;

    return out;
  }

  private runPoolMul(z: number): number {
    let mul = 0.88 + 0.14 * Math.sin(z * 0.11) + 0.06 * Math.sin(z * 0.29 + 0.8);
    for (const well of this.poolWells) {
      const t = (z - well.z) / well.sigma;
      mul -= well.w * Math.exp(-0.5 * t * t);
    }
    return THREE.MathUtils.clamp(mul, 0.45, 1.15);
  }

  shearMagnitude(x: number, y: number, z: number): number {
    const eps = 0.3;
    const a = this.sample(x - eps, y, z);
    const b = this.sample(x + eps, y, z);
    const c = this.sample(x, y, z - eps);
    const d = this.sample(x, y, z + eps);
    const dVx = (b.x - a.x) / (2 * eps);
    const dVz = (d.z - c.z) / (2 * eps);
    return Math.sqrt(dVx * dVx + dVz * dVz);
  }

  turbulenceIntensity(x: number, y: number, z: number): number {
    const halfW = this.width * 0.5;
    const nx = THREE.MathUtils.clamp(x / halfW, -1, 1);
    const absNx = Math.abs(nx);
    const bankShear = Math.exp(-Math.pow((absNx - 0.72) / 0.18, 2));
    let wake = 0;
    for (const p of this.pockets) {
      const dx = x - p.x;
      const dy = y - p.y;
      const dz = z - p.z;
      const r = p.radius * 1.4;
      const q = (dx * dx + dy * dy * 0.6 + dz * dz) / (r * r);
      const fall = Math.exp(-q);
      const kindMul = p.kind === 'boulder_wake' ? 1.0 : p.kind === 'bank_scallop' ? 0.55 : 0.35;
      wake = Math.max(wake, fall * p.deficit * kindMul);
    }
    const shear = this.shearMagnitude(x, y, z);
    const shearN = THREE.MathUtils.clamp(shear / Math.max(0.15, this.meanSpeed * 0.5), 0, 1);
    return THREE.MathUtils.clamp(0.55 * bankShear + 0.7 * wake + 0.35 * shearN, 0, 1.25);
  }

  midChannelSpeed(y: number, z: number): number {
    const depthFrac = THREE.MathUtils.clamp(y / this.depth, 0, 1);
    const depthMul = 0.28 + 0.72 * Math.pow(depthFrac, 0.38);
    const runPool = this.runPoolMul(z);
    return this.meanSpeed * 1.0 * depthMul * runPool;
  }
}

function defaultWellsFromPockets(pockets: LiePocket[]): EnvPoolWell[] {
  return pockets.map((p) => ({
    z: p.z,
    w: p.kind === 'pool' ? 0.18 : 0.11,
    sigma: p.kind === 'pool' ? 4.8 : 3.5,
  }));
}
