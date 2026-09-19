import * as THREE from 'three';
import { RIVER, type SimConfig, meanCurrentSpeed } from '../config';

/**
 * Simplified river current field: downstream core, bank shear,
 * weak recirculating eddies, depth decay.
 * Fish samples via sample(x, y, z) → world velocity (m/s).
 * +Z = upstream (fish migrates +Z), current flows −Z.
 */
export class CurrentField {
  readonly meanSpeed: number;
  private readonly eddies: { x: number; z: number; r: number; strength: number }[];

  constructor(cfg: SimConfig) {
    this.meanSpeed = meanCurrentSpeed(cfg);
    // Fixed lite eddy set along corridor
    this.eddies = [
      { x: -3.5, z: 15, r: 2.2, strength: 0.35 },
      { x: 4.0, z: 32, r: 2.8, strength: 0.4 },
      { x: -2.0, z: 48, r: 2.0, strength: 0.3 },
      { x: 3.2, z: 62, r: 2.5, strength: 0.38 },
    ];
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

    // Eddies: tangential swirl in XZ
    for (const e of this.eddies) {
      const dx = x - e.x;
      const dz = z - e.z;
      const d2 = dx * dx + dz * dz;
      const r2 = e.r * e.r;
      if (d2 < r2 * 4) {
        const fall = Math.exp(-d2 / r2);
        const s = e.strength * this.meanSpeed * fall;
        out.x += -dz * s * 0.5;
        out.z += dx * s * 0.5;
      }
    }

    // Tiny vertical (upwell near eddy centres — lite)
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
