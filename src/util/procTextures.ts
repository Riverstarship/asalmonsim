import * as THREE from 'three';

/** Tiny seeded hash for procedural noise (no dep). */
export function hash2(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

export function valueNoise2(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0);
  const b = hash2(x0 + 1, y0);
  const c = hash2(x0, y0 + 1);
  const d = hash2(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export function fbm2(x: number, y: number, octaves = 4): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

export interface CanvasTexOpts {
  width: number;
  height: number;
  wrapS?: THREE.Wrapping;
  wrapT?: THREE.Wrapping;
  anisotropy?: number;
  colorSpace?: THREE.ColorSpace;
}

/**
 * Build a CanvasTexture from a paint callback. Compact procedural assets —
 * prefer over shipping large PNGs for Pages / phone payload.
 */
export function makeCanvasTexture(
  opts: CanvasTexOpts,
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = opts.width;
  canvas.height = opts.height;
  const ctx = canvas.getContext('2d')!;
  paint(ctx, opts.width, opts.height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = opts.wrapS ?? THREE.RepeatWrapping;
  tex.wrapT = opts.wrapT ?? THREE.RepeatWrapping;
  tex.colorSpace = opts.colorSpace ?? THREE.SRGBColorSpace;
  tex.anisotropy = opts.anisotropy ?? 2;
  tex.needsUpdate = true;
  return tex;
}

/** Roughness/normal-ish grayscale DataTexture from fbm (compact). */
export function makeNoiseDataTexture(
  size: number,
  scale = 4,
  contrast = 1,
): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm2((x / size) * scale, (y / size) * scale, 5);
      const v = Math.max(0, Math.min(255, ((n - 0.5) * contrast + 0.5) * 255));
      const i = (y * size + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}
