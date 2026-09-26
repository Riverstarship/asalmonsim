import * as THREE from 'three';
import { fbm2, hash2, makeCanvasTexture } from '../util/procTextures';

export interface RiverMaps {
  bedAlbedo: THREE.CanvasTexture;
  bedRoughness: THREE.CanvasTexture;
  bankAlbedo: THREE.CanvasTexture;
  waterNormal: THREE.CanvasTexture;
  waterFoam: THREE.CanvasTexture;
}

/**
 * Lightweight procedural river materials (gravel bed, bank earth/rock,
 * subtle water normal + foam). Sized for mobile; not photogrammetry.
 */
export function createRiverMaps(): RiverMaps {
  const bedAlbedo = makeCanvasTexture({ width: 256, height: 256 }, (ctx, w, h) => {
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = x / w;
        const v = y / h;
        const n = fbm2(u * 10, v * 10, 5);
        const pebble = fbm2(u * 28 + 3, v * 28, 3);
        // Mixed gravel: olive-grey, brown, slate
        const pick = hash2(Math.floor(u * 40), Math.floor(v * 40));
        let r = 72 + n * 40;
        let g = 78 + n * 35;
        let b = 58 + n * 28;
        if (pick > 0.72) {
          r = 95 + pebble * 50;
          g = 88 + pebble * 40;
          b = 70 + pebble * 30;
        } else if (pick < 0.22) {
          r = 55 + pebble * 25;
          g = 60 + pebble * 22;
          b = 62 + pebble * 28;
        }
        // Dark wet patches
        const wet = Math.max(0, 0.55 - n) * 0.35;
        r *= 1 - wet;
        g *= 1 - wet * 0.9;
        b *= 1 - wet * 0.7;
        const i = (y * w + x) * 4;
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
  bedAlbedo.repeat.set(6, 14);

  const bedRoughness = makeCanvasTexture(
    { width: 128, height: 128, colorSpace: THREE.NoColorSpace },
    (ctx, w, h) => {
      const img = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const n = fbm2((x / w) * 12, (y / h) * 12, 4);
          const v = Math.max(0, Math.min(255, (0.55 + n * 0.4) * 255));
          const i = (y * w + x) * 4;
          img.data[i] = v;
          img.data[i + 1] = v;
          img.data[i + 2] = v;
          img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    },
  );
  bedRoughness.repeat.set(6, 14);

  const bankAlbedo = makeCanvasTexture({ width: 256, height: 128 }, (ctx, w, h) => {
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = x / w;
        const v = y / h;
        const n = fbm2(u * 8, v * 5, 5);
        const rock = fbm2(u * 22 + 2, v * 12, 3);
        // Earth / mossy bank
        let r = 68 + n * 45 + rock * 20;
        let g = 78 + n * 50 + rock * 15;
        let b = 42 + n * 28;
        if (v > 0.7) {
          // Near-surface greener
          g += 25 * (v - 0.7);
          r -= 8 * (v - 0.7);
        }
        if (rock > 0.62) {
          r = 90 + rock * 40;
          g = 85 + rock * 30;
          b = 70 + rock * 25;
        }
        const i = (y * w + x) * 4;
        img.data[i] = Math.min(255, r);
        img.data[i + 1] = Math.min(255, g);
        img.data[i + 2] = Math.min(255, b);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
  bankAlbedo.repeat.set(2, 8);

  const waterNormal = makeCanvasTexture(
    { width: 128, height: 128, colorSpace: THREE.NoColorSpace },
    (ctx, w, h) => {
      const img = ctx.createImageData(w, h);
      const eps = 0.015;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const u = x / w;
          const v = y / h;
          // Soft ripples + flow streaks along v (streamwise)
          const h0 =
            fbm2(u * 6, v * 10, 3) * 0.65 + fbm2(u * 18, v * 4 + 1, 2) * 0.35;
          const hx =
            fbm2((u + eps) * 6, v * 10, 3) * 0.65 +
            fbm2((u + eps) * 18, v * 4 + 1, 2) * 0.35;
          const hy =
            fbm2(u * 6, (v + eps) * 10, 3) * 0.65 +
            fbm2(u * 18, (v + eps) * 4 + 1, 2) * 0.35;
          const dx = (hx - h0) * 1.8;
          const dy = (hy - h0) * 1.8;
          const nx = -dx;
          const ny = -dy;
          const nz = 1;
          const len = Math.hypot(nx, ny, nz) || 1;
          const i = (y * w + x) * 4;
          img.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
          img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
          img.data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
          img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    },
  );
  waterNormal.repeat.set(3, 10);

  // Soft foam / highlight mask (used as emissiveMap or alpha hint)
  const waterFoam = makeCanvasTexture(
    { width: 128, height: 128, colorSpace: THREE.SRGBColorSpace },
    (ctx, w, h) => {
      const img = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const u = x / w;
          const v = y / h;
          const edge = Math.pow(Math.abs(u - 0.5) * 2, 2.2);
          const n = fbm2(u * 14, v * 8, 3);
          const foam = Math.max(0, edge * 0.85 + (n - 0.55) * 0.5);
          const c = Math.min(255, foam * 220);
          const i = (y * w + x) * 4;
          img.data[i] = 200 + c * 0.2;
          img.data[i + 1] = 220 + c * 0.1;
          img.data[i + 2] = 230;
          img.data[i + 3] = Math.min(255, foam * 160);
        }
      }
      ctx.putImageData(img, 0, 0);
    },
  );
  waterFoam.repeat.set(1, 6);

  return { bedAlbedo, bedRoughness, bankAlbedo, waterNormal, waterFoam };
}
