# Atlantic Salmon Migration Simulator (v1.4)

Observational **Vite + TypeScript + Three.js** demo of an adult Atlantic salmon (*Salmo salar*) ascending a simplified river corridor. No player swim controls — camera toggle and a toggleable info/HUD card (accuracy lives in ACCURACY.md / harness).


## Live demo

**Public site (temporary for testing):** [https://riverstarship.github.io/asalmonsim/](https://riverstarship.github.io/asalmonsim/)

The repository is **temporarily public** so GitHub Pages can serve the demo on a free plan. After testing, you can make it private again — but note that on free GitHub, **private repos lose free Pages** (disable Pages or expect the public site to stop when going private).

**Deploy today:** static build on the `gh-pages` branch (Vite `base: '/asalmonsim/'`). `node_modules` / `dist` stay gitignored on `main`; CI builds locally / in Actions when enabled.

**Actions workflow (ready, not yet active):** `ci/github-pages-deploy.yml` is the intended `upload-pages-artifact` + `deploy-pages` workflow. Pushing it to `.github/workflows/` requires a PAT with the `workflow` scope (current token is `repo` only). After adding that scope, copy the file to `.github/workflows/deploy.yml`, push, and switch Pages to “GitHub Actions”.

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

Headless accuracy harness (no browser / WebGL):

```bash
npm run test:accuracy
```

Fixed-seed scenarios live in `tests/accuracy/`; baselines in `tests/baselines/thresholds.json`; metrics land in `tests/scenarios/`. See [`ACCURACY.md`](./ACCURACY.md).

## Controls

| UI | Action |
|----|--------|
| **Follow cam** | Chase camera behind the fish (default) |
| **Fish-eye** | Head-mounted wide FOV direct-to-screen (fish mesh hidden; barrel RT optional/off) |
| **Hide/Show info** | Toggle the HUD card for more screen space |

## Architecture (build order)

```
hydro → env → decisions → cameras → look
```

| Module | Path | Role |
|--------|------|------|
| Config | `src/config.ts` | Season + geolocation knobs → temp / mean current |
| Hydro | `src/fish/Hydrodynamics.ts` | Buoyancy, drag, thrust, dorsal-up attitude plant (v1.4), collision damp |
| Fins | `src/fish/Fins.ts` | Wired caudal, dorsal, pectorals, pelvic, anal with amplitude/phase caps |
| Mesh | `src/fish/Mesh.ts` | Procedural fusiform body + wet PBR-ish materials |
| Env | `src/env/*` | River corridor, current field (core/shear/**hard lie deficits**), temperature, holding lies |
| AI | `src/ai/*` | Sense → duty-cycled migrate/hold; mid-column cruise; anticipatory avoidance; lie residency |
| Cameras | `src/cameras/*` | Follow/chase + fish-eye wide-FOV (direct render) |
| UI | `src/ui/*` | Camera buttons + toggleable HUD (no accuracy overlay) |
| Core | `src/sim/CoreSim.ts` | Headless step loop (sense→decide→integrate) |
| Sim | `src/sim/Simulation.ts` | Browser renderer + HUD wired to CoreSim |

## Product locks (v1)

- Target: Atlantic salmon adult, **migration / upriver ascent**
- Portable fish; habitat = currents/shear/eddies lite, depth, temperature
- Tradeoff: awareness/decisions first, then biomechanics, then visuals
- Honest fidelity notes in [`ACCURACY.md`](./ACCURACY.md)

## License

Demo / research sketch — no warranty of biological accuracy.
