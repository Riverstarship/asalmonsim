# Atlantic Salmon Migration Simulator (v1)

Observational **Vite + TypeScript + Three.js** demo of an adult Atlantic salmon (*Salmo salar*) ascending a simplified river corridor. No player swim controls — camera toggle and accuracy overlay only.

## Run

```bash
cd /workspace/asalmonsim
npm install
npm run dev
```

Open the printed local URL (typically `http://localhost:5173`).

Production build:

```bash
npm run build
npm run preview
```

## Controls

| UI | Action |
|----|--------|
| **Follow cam** | Chase camera behind the fish (default) |
| **Fish-eye** | Wide FOV + barrel-distortion pass from near the head |

## Architecture (build order)

```
hydro → env → decisions → cameras → look
```

| Module | Path | Role |
|--------|------|------|
| Config | `src/config.ts` | Season + geolocation knobs → temp / mean current |
| Hydro | `src/fish/Hydrodynamics.ts` | Buoyancy, drag, body/caudal thrust, pitch/yaw/roll coupling, collision damp |
| Fins | `src/fish/Fins.ts` | Wired caudal, dorsal, pectorals, pelvic, anal with amplitude/phase caps |
| Mesh | `src/fish/Mesh.ts` | Procedural fusiform body + wet PBR-ish materials |
| Env | `src/env/*` | River corridor, current field (core/shear/eddies), temperature, holding lies |
| AI | `src/ai/*` | Sense flow/temp/obstacles → hold / cruise / burst / seek_hold |
| Cameras | `src/cameras/*` | Follow/chase + fish-eye distortion |
| UI | `src/ui/*` | Camera buttons + HUD + accuracy overlay |
| Sim | `src/sim/Simulation.ts` | Wire loop |

## Product locks (v1)

- Target: Atlantic salmon adult, **migration / upriver ascent**
- Portable fish; habitat = currents/shear/eddies lite, depth, temperature
- Tradeoff: awareness/decisions first, then biomechanics, then visuals
- Honest fidelity notes in [`ACCURACY.md`](./ACCURACY.md)

## License

Demo / research sketch — no warranty of biological accuracy.
