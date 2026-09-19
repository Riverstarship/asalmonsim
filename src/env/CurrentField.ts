import * as THREE from 'three';
import { RIVER, type SimConfig, meanCurrentSpeed } from '../config';

/** Hard holding-lie pocket with a measurable velocity deficit. */
export interface LiePocket {
  x: number;
  y: number;
  z: number;
  radius: number;
  /** Fraction of streamwise speed removed at centre (0–1). */
  deficit: number;
  kind: 'pool' | 'bank_scallop' | 'boulder_wake';
}

/**
 * Simplified river current field: downstream core, bank shear,
 * hard low-shear holding pockets, depth decay.
 * Fish samples via sample(x, y, z) → world velocity (m/s).
 * +Z = upstream (fish migrates +Z), current flows −Z.
 */
export class CurrentField {
  readonly meanSpeed: number;
  private readonly pockets: LiePocket[];

  constructor(cfg: SimConfig, pockets: LiePocket[] = []) {
    this.meanSpeed = meanCurrentSpeed(cfg);
    this.pockets = pockets;
  }

  /** Sample current velocity at world position (m/s). */
  sample(x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const halfW = RIVER.width * 0.5;
    // Lateral: faster mid-channel, shear near banks
    const nx = THREE.MathUtils.clamp(x / halfW, -1, 1);
    const lateral = 1 - nx * nx * 0.65;

    // Depth: surface faster, bed slower
    const depthFrac = THREE.MathUtils.clamp(y / RIVER.depth, 0, 1);
    const depthMul = 0.35 + 0.65 * Math.pow(depthFrac, 0.45);

    // Mild along-river modulation (pools / runs)
    const run = 0.85 + 0.15 * Math.sin(z * 0.12);

    const core = this.meanSpeed * lateral * depthMul * run;
    out.set(0, 0, -core); // downstream = −Z

    // Bank shear lateral component (weak inward near banks)
    if (Math.abs(nx) > 0.55) {
      const shear = (Math.abs(nx) - 0.55) * 0.25 * this.meanSpeed;
      out.x += -Math.sign(nx) * shear;
    }

    // Hard holding pockets: real streamwise velocity deficits sensors measure
    for (const p of this.pockets) {
      const dx = x - p.x;
      const dy = y - p.y;
      const dz = z - p.z;
      const d2 = dx * dx + dy * dy * 0.5 + dz * dz;
      const r2 = p.radius * p.radius;
      if (d2 < r2 * 4) {
        const fall = Math.exp(-d2 / r2);
        // Reduce |streamwise| toward zero (shelter)
        out.z *= 1 - p.deficit * fall;
        // Weak recirculation in boulder wakes
        if (p.kind === 'boulder_wake') {
          const s = 0.15 * p.deficit * this.meanSpeed * fall;
          out.x += -dz * s * 0.35;
          out.z += dx * s * 0.15;
        }
        // Bank scallops pull slightly toward bank pocket
        if (p.kind === 'bank_scallop') {
          out.x += -Math.sign(p.x) * 0.08 * this.meanSpeed * fall;
        }
      }
    }

    // Tiny vertical (upwell lite)
    out.y += Math.sin(z * 0.2 + x) * 0.02 * this.meanSpeed;

    return out;
  }

  /** Approximate vorticity magnitude for sensing (shear awareness). */
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

}
