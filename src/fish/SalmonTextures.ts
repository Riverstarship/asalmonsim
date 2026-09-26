import * as THREE from 'three';
import { fbm2, hash2, makeCanvasTexture } from '../util/procTextures';

export interface SalmonSkinMaps {
  albedo: THREE.CanvasTexture;
  roughness: THREE.CanvasTexture;
  /** Soft scale normal (lightweight bump). */
  normal: THREE.CanvasTexture;
}

/**
 * Procedural adult sea-run Atlantic salmon skin (silver flank, dark dorsal,
 * pale belly, sparse black spotting above lateral line). Not photogrammetry —
 * compact canvas maps sized for mobile Pages payload.
 */
export function createSalmonSkinMaps(): SalmonSkinMaps {
  const W = 256;
  const H = 128;

  const albedo = makeCanvasTexture(
    { width: W, height: H, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping },
    (ctx, w, h) => {
      const img = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          // u along body (snout→tail), v around (belly→dorsal→belly via flank)
          const u = x / (w - 1);
          const v = y / (h - 1);
          // Remap: v=0 belly, v=0.5 lateral line, v=1 dorsal
          const elev = v; // 0 belly → 1 dorsal
          const belly = Math.max(0, 1 - elev * 1.55);
          const back = Math.max(0, (elev - 0.45) / 0.55);
          const flank = 1 - belly - back * 0.85;

          // Sea-run silver: cool green-grey dorsal, bright silver flank, cream belly
          let r = 210 * belly + 168 * flank + 55 * back;
          let g = 205 * belly + 178 * flank + 78 * back;
          let b = 188 * belly + 185 * flank + 72 * back;

          // Subtle scale shimmer (anisotropic-ish via directional streaks)
          const scale = fbm2(u * 28, elev * 18, 3);
          const shimmer = (scale - 0.5) * 28;
          r += shimmer * 0.9;
          g += shimmer;
          b += shimmer * 1.1;

          // Head darkening near snout
          if (u < 0.18) {
            const t = 1 - u / 0.18;
            r *= 1 - 0.18 * t;
            g *= 1 - 0.12 * t;
            b *= 1 - 0.1 * t;
          }
          // Peduncle slightly darker
          if (u > 0.82) {
            const t = (u - 0.82) / 0.18;
            r *= 1 - 0.12 * t;
            g *= 1 - 0.1 * t;
            b *= 1 - 0.08 * t;
          }

          // Adult spots: mostly above lateral line (elev > 0.42), sparse on silver flank
          if (elev > 0.4 && u > 0.12 && u < 0.78) {
            const sx = Math.floor(u * 22);
            const sy = Math.floor(elev * 14);
            const hx = hash2(sx * 1.7, sy * 3.1);
            const hy = hash2(sx * 2.3 + 4, sy * 1.9);
            if (hx > 0.62) {
              const cx = (sx + 0.5) / 22;
              const cy = (sy + 0.5) / 14;
              const dx = (u - cx) * 22;
              const dy = (elev - cy) * 14;
              // Slightly X / irregular blob
              const d = Math.sqrt(dx * dx * 1.2 + dy * dy) + Math.abs(dx * dy) * 0.15;
              const rad = 0.35 + hy * 0.35;
              if (d < rad) {
                const k = (1 - d / rad) * (0.55 + back * 0.35);
                r *= 1 - 0.78 * k;
                g *= 1 - 0.8 * k;
                b *= 1 - 0.72 * k;
              }
            }
          }

          // Soft lateral-line hint
          const ll = Math.exp(-Math.pow((elev - 0.48) * 28, 2));
          r -= 12 * ll;
          g -= 8 * ll;
          b -= 4 * ll;

          const i = (y * w + x) * 4;
          img.data[i] = Math.max(0, Math.min(255, r));
          img.data[i + 1] = Math.max(0, Math.min(255, g));
          img.data[i + 2] = Math.max(0, Math.min(255, b));
          img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    },
  );

  const roughness = makeCanvasTexture(
    { width: 128, height: 64, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, colorSpace: THREE.NoColorSpace },
    (ctx, w, h) => {
      const img = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const elev = y / (h - 1);
          const n = fbm2(x * 0.18, y * 0.22, 4);
          // Flanks glossier (lower roughness); dorsal/belly slightly rougher
          const base = 0.22 + Math.abs(elev - 0.5) * 0.28 + n * 0.12;
          const v = Math.max(0, Math.min(255, base * 255));
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

  // Lightweight tangent-ish normal from scale noise (encode as RGB normal map)
  const normal = makeCanvasTexture(
    { width: 128, height: 64, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, colorSpace: THREE.NoColorSpace },
    (ctx, w, h) => {
      const img = ctx.createImageData(w, h);
      const eps = 0.02;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const u = x / w;
          const v = y / h;
          const h0 = fbm2(u * 20, v * 14, 3);
          const hx = fbm2((u + eps) * 20, v * 14, 3);
          const hy = fbm2(u * 20, (v + eps) * 14, 3);
          const dx = (hx - h0) * 2.2;
          const dy = (hy - h0) * 2.2;
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

  return { albedo, roughness, normal };
}
