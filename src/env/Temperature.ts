import { RIVER, type SimConfig, baseTempC } from '../config';

/**
 * Simple temperature field: cooler near bed & banks, warmer mid-channel surface.
 * Holding lies prefer cooler, lower-energy pockets.
 */
export class TemperatureField {
  readonly baseC: number;

  constructor(cfg: SimConfig) {
    this.baseC = baseTempC(cfg);
  }

  sample(x: number, y: number, z: number): number {
    const halfW = RIVER.width * 0.5;
    const nx = Math.abs(x) / halfW;
    const depthFrac = y / RIVER.depth;
    // Cooler near bed and banks; slight along-river variation
    const bankCool = nx * 0.8;
    const bedCool = (1 - depthFrac) * 1.2;
    const along = Math.sin(z * 0.08) * 0.4;
    return this.baseC - bankCool - bedCool + along;
  }
}
