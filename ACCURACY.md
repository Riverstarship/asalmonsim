# Accuracy — Atlantic salmon adult (v1.1)

Honest fidelity tracking for *Salmo salar* upriver ascent. Prefer stating gaps over implying validation.

## Goal

Represent an **adult Atlantic salmon** migrating up a river corridor such that:

1. The fish **samples** a spatially varying current and temperature field (including **real velocity deficits** inside discrete holding lies).
2. **Behavioral modes** (hold / cruise / burst / seek holding lie) change kinematics and energy use; tired / high-flow fish **prefer lies**.
3. Hydrodynamics give plausible **station-holding**, **slip**, and **burst** against flow at order-of-magnitude adult scales (~0.7–0.8 m length, few m/s burst).
4. A **headless accuracy harness** (`npm run test:accuracy`) gates regressions on hold slip, lie-seeking, upstream DMG, burst fatigue, and numerical stability — without WebGL/DOM.
5. Cameras support observation (follow + fish-eye) without implying a player avatar.

v1.1 success is **qualitative behavioral fidelity + automated scenario checks**, not CFD-validated swimming or stock-specific phenology.

## Gap

| Area | What we have | What’s missing / wrong |
|------|----------------|-------------------------|
| Hydrodynamics | Lumped buoyancy, quadratic drag, thrust + simple torque coupling | No added-mass, no vortex wake, no ground-effect; thrust curve not fitted to force plates / CFD |
| Body / fins | Wired fins with amp/phase constraints; caudal coupled to lateral thrust | No muscle activation, no undulatory body wave as force generator, no fin–fin interference |
| Current field | Analytic core + bank shear + **hard lie pockets** (pool / bank scallop / boulder wake deficits) | No real bathymetry, gauge data, or CFD; pocket shapes are schematic |
| Temperature | Coarse season+lat base with bank/bed gradients | No diurnal cycle, stratification physics, or measured thermal refugia |
| Decisions | Sense → mode select; **lie preference when tired/high flow**; weak upstream rheotaxis/homing bias; rationale strings | No olfactory plume following, photoperiod, social cues, predators, or dam/weir negotiation |
| Energetics | Mode drain + flow-scaled ascent cost; better recover in lies; burst thrust caps with fatigue | Not calibrated to oxygen debt or measured ascent budgets |
| Morphology | Procedural mesh, wet clearcoat look | Not morphometric; no sex/age/condition variants; no silvering / kelt states |
| Collision | AABB-ish bed/banks | No complex structure mesh (boulders are velocity pockets only) |
| Harness | Fixed-seed scenarios + baseline thresholds | Thresholds are order-of-magnitude, not field-validated |

**Do not treat HUD speeds or forces as measured values.**

## Next strategy

1. **Keep the harness green** when changing hydro/decisions — extend scenarios before loosening thresholds.
2. **Environment maps:** Replace analytic current with a 2.5D field from a real reach (ADCP / shallow CFD / published vector maps). Keep the same `sample(x,y,z)` API.
3. **Calibrate fatigue–recovery** to published ascent energetic budgets; expose season/temp as metabolic multipliers.
4. **Homing upgrade:** Strengthen rheotaxis/olfactory bias with a weak along-corridor gradient before path planning.
5. **Biomechanics pass:** Traveling-wave body envelope driving thrust; decision layer stays the outer loop.
6. **Visuals last:** Mesh/materials only after motion and decisions read correctly on mobile-sized viewports.

## Headless harness

```bash
npm run test:accuracy
```

Runs Node-only (`tsx`) scenarios under `tests/accuracy/` with seeds/dt fixed, writes metrics JSON to `tests/scenarios/`, and fails if results miss `tests/baselines/thresholds.json`. Core loop is `CoreSim.step()` — shared with the browser, no renderer.

## Live demo

Observational demo: [https://riverstarship.github.io/asalmonsim/](https://riverstarship.github.io/asalmonsim/). Repo may be temporarily public for free-plan Pages.

## Overlay (in-app)

The on-screen accuracy panel mirrors a short form of **Goal / Gap / Strategy**. HUD also shows mode, energy, upstream DMG, and time-in-lie.
