import { type SimConfig, baseTempC } from '../config';

/**
 * Simple temperature field: cooler near bed & banks, warmer mid-channel surface.
 * Holding lies prefer cooler, lower-energy pockets.
 * Width/depth from env pack (v1.11).
 */
export class TemperatureField {
  readonly baseC: number;
  readonly width: number;
  readonly depth: number;

  constructor(cfg: SimConfig, dims: { width: number; depth: number } = { width: 12, depth: 4 }) {
    this.baseC = baseTempC(cfg);
    this.width = dims.width;
    this.depth = dims.depth;
  }

  sample(x: number, y: number, z: number): number {
    const halfW = this.width * 0.5;
    const nx = Math.abs(x) / halfW;
    const depthFrac = y / this.depth;
    const bankCool = nx * 0.8;
    const bedCool = (1 - depthFrac) * 1.2;
    const along = Math.sin(z * 0.08) * 0.4;
    return this.baseC - bankCool - bedCool + along;
  }
}
