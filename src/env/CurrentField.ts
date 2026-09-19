import * as THREE from 'three';
import { RIVER, type SimConfig, meanCurrentSpeed } from '../config';

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

/**
 * Continuous synthetic river velocity field (v1.5).
 * Mid-channel jet, bank boundary layers, depth decay, pool decelerations,
 * and boulder-wake deficits as smooth gradients. sample(x,y,z) API stable.
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
    const nx = THREE.MathUtils.clamp(x / halfW, -1, 1);
    const absNx = Math.abs(nx);

    // Mid-channel jet: flatter core, steeper bank boundary layers
    // (1 - |nx|^p) with p>2 → faster core, slower near banks
    const jet = Math.pow(1 - Math.pow(absNx, 2.4), 1.15);
    const bankBl = Math.exp(-Math.pow(absNx / 0.92, 6)); // soft wall damping
    const lateral = THREE.MathUtils.clamp(0.12 + 0.88 * jet * bankBl, 0.08, 1);

    // Depth: slower near bed, faster toward surface (1/7-power-ish)
    const depthFrac = THREE.MathUtils.clamp(y / RIVER.depth, 0, 1);
    const depthMul = 0.28 + 0.72 * Math.pow(depthFrac, 0.38);

    // Continuous along-river run / pool modulation (smooth, not discrete pockets)
    const runPool = this.runPoolMul(z);

    let stream = this.meanSpeed * lateral * depthMul * runPool;

    // Soft structure kernels (continuous gradients around lie markers)
    let wakeX = 0;
    let wakeZ = 0;
    for (const p of this.pockets) {
      const dx = x - p.x;
      const dy = y - p.y;
      const dz = z - p.z;
      // Anisotropic soft Gaussian — wider than old hard r² cut, always differentiable
      const rx = p.radius * 1.15;
      const ry = p.radius * 1.45;
      const rz = p.radius * (p.kind === 'boulder_wake' ? 1.55 : 1.25);
      const q =
        (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) + (dz * dz) / (rz * rz);
      const fall = Math.exp(-q); // smooth everywhere
      stream *= 1 - p.deficit * fall;

      if (p.kind === 'boulder_wake') {
        // Weak continuous recirculation in the lee (dz>0 = upstream of boulder in +Z frame;
        // wake is downstream = −Z side of boulder → dz negative relative to fish going up)
        const lee = fall * p.deficit * this.meanSpeed;
        wakeX += -Math.sign(p.x || dx || 0.01) * 0.12 * lee;
        wakeZ += 0.08 * lee; // slight upstream eddy component (reduces |−Z| further)
      }
      if (p.kind === 'bank_scallop') {
        wakeX += -Math.sign(p.x) * 0.1 * this.meanSpeed * fall * p.deficit;
      }
      if (p.kind === 'pool') {
        // Mild vertical recirculation lite (continuous)
        // handled via stream deficit only — keep cheap
      }
    }

    out.set(wakeX, 0, -stream + wakeZ);

    // Continuous bank shear: lateral inflow near banks (boundary-layer secondary)
    if (absNx > 0.4) {
      const shear = Math.pow((absNx - 0.4) / 0.6, 1.4) * 0.22 * this.meanSpeed;
      out.x += -Math.sign(nx) * shear * depthMul;
    }

    // Tiny continuous vertical (upwell / downwell)
    out.y += Math.sin(z * 0.18 + x * 0.7) * 0.025 * this.meanSpeed * depthMul;

    return out;
  }

  /**
   * Smooth along-river speed multiplier: runs faster, pools slower.
   * Continuous sinusoids + soft Gaussian pool wells (not hard spheres).
   */
  private runPoolMul(z: number): number {
    let mul = 0.88 + 0.14 * Math.sin(z * 0.11) + 0.06 * Math.sin(z * 0.29 + 0.8);
    // Soft pool wells at known structure longitudes (continuous decelerations)
    const wells = [
      { z: 12, w: 0.18, sigma: 4.5 },
      { z: 18, w: 0.12, sigma: 3.5 },
      { z: 35, w: 0.1, sigma: 3.8 },
      { z: 52, w: 0.2, sigma: 5.0 },
      { z: 68, w: 0.12, sigma: 3.6 },
    ];
    for (const well of wells) {
      const t = (z - well.z) / well.sigma;
      mul -= well.w * Math.exp(-0.5 * t * t);
    }
    return THREE.MathUtils.clamp(mul, 0.45, 1.15);
  }

  /** Approximate vorticity / shear magnitude for sensing (finite-diff). */
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

  /**
   * Cheap turbulence-intensity proxy (0≈quiet, ~1≈abrupt shear / wake).
   * Analytical blend of lateral shear + wake proximity — no extra CFD.
   */
  turbulenceIntensity(x: number, y: number, z: number): number {
    const halfW = RIVER.width * 0.5;
    const nx = THREE.MathUtils.clamp(x / halfW, -1, 1);
    const absNx = Math.abs(nx);
    // Peak shear in bank boundary layer
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

  /** Mid-channel reference speed at given depth & station (no structure kernels). */
  midChannelSpeed(y: number, z: number): number {
    const depthFrac = THREE.MathUtils.clamp(y / RIVER.depth, 0, 1);
    const depthMul = 0.28 + 0.72 * Math.pow(depthFrac, 0.38);
    const runPool = this.runPoolMul(z);
    // Lateral at x=0: jet ≈ 1
    return this.meanSpeed * 1.0 * depthMul * runPool;
  }
}
