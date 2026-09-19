# Accuracy — Atlantic salmon adult (v1.2a)

Honest fidelity tracking for *Salmo salar* upriver ascent. Prefer stating gaps over implying validation. Accuracy is communicated via this doc, the headless harness, and chat — **not** an in-app overlay.

## Goal

Represent an **adult Atlantic salmon** migrating up a river corridor such that:

1. The fish **samples** a spatially varying current and temperature field (including **real velocity deficits** inside discrete holding lies).
2. **Behavioral modes** (hold / cruise / burst / seek holding lie) change kinematics and energy use; tired / high-flow fish **prefer lies**.
3. Hydrodynamics give plausible **station-holding**, **slip**, and **burst** against flow at order-of-magnitude adult scales (~0.7–0.8 m length, few m/s burst).
4. **Hard containment** keeps the body inside the wet corridor: bed, banks, and free surface use push-out + kill inward normal velocity (no wall tunneling / surface breach in post-state).
5. A **headless accuracy harness** (`npm run test:accuracy`) gates regressions on hold slip, lie-seeking, upstream DMG, burst fatigue, stability, and **containment** (time above surface ≈ 0; post-state OOB ≈ 0) — without WebGL/DOM.
6. Cameras support observation (follow + fish-eye). Fish-eye is head-mounted, hides the fish mesh via layers, and clears to an underwater tint (not black void).

v1.2a success is **qualitative behavioral fidelity + hard corridor integrity + automated scenario checks**, not CFD-validated swimming or stock-specific phenology.

## Gap

| Area | What we have | What’s missing / wrong |
|------|----------------|-------------------------|
| Hydrodynamics | Lumped buoyancy, quadratic drag, thrust + simple torque coupling; hard wall velocity kill | No added-mass, no vortex wake, **no soft near-wall hydro**; thrust curve not fitted to force plates / CFD |
| Body / fins | Wired fins with amp/phase constraints; caudal coupled to lateral thrust | No muscle activation, no undulatory body wave as force generator, no fin–fin interference |
| Current field | Analytic core + bank shear + **hard lie pockets** (pool / bank scallop / boulder wake deficits) | No real bathymetry, gauge data, or CFD; pocket shapes are schematic |
| Temperature | Coarse season+lat base with bank/bed gradients | No diurnal cycle, stratification physics, or measured thermal refugia |
| Decisions | Sense → mode select; lie preference; weak rheotaxis; light pitch bias from bed/surface clearance | **No deeper avoidance planner** / mid-column rewrite; no olfactory plume, predators, or dam/weir negotiation |
| Energetics | Mode drain + flow-scaled ascent cost; better recover in lies; burst thrust caps with fatigue | Not calibrated to oxygen debt or measured ascent budgets |
| Collision | **Hard** bed / bank / free-surface clamp + inward-velocity kill | Scrapes still register as penetration *events* when pressed into a wall; no complex structure mesh |
| Cameras | Follow + head-mounted fish-eye (layers, underwater clear) | Distortion is stylized, not measured fish optics |
| Harness | Fixed-seed scenarios + baseline thresholds incl. containment | Thresholds are order-of-magnitude, not field-validated |

**Do not treat HUD speeds or forces as measured values.**

## Next strategy

1. **Keep the harness green** when changing hydro/decisions — extend scenarios before loosening thresholds.
2. **Deferred (explicit):** deeper mid-column avoidance / soft near-wall hydro / CFD / textures / accuracy HUD — not in v1.2a.
3. **Environment maps:** Replace analytic current with a 2.5D field from a real reach (ADCP / shallow CFD / published vector maps). Keep the same `sample(x,y,z)` API.
4. **Calibrate fatigue–recovery** to published ascent energetic budgets; expose season/temp as metabolic multipliers.
5. **Homing upgrade:** Strengthen rheotaxis/olfactory bias with a weak along-corridor gradient before path planning.
6. **Biomechanics pass:** Traveling-wave body envelope driving thrust; decision layer stays the outer loop.
7. **Visuals last:** Mesh/materials only after motion and decisions read correctly on mobile-sized viewports.

## Headless harness

```bash
npm run test:accuracy
```

Runs Node-only (`tsx`) scenarios under `tests/accuracy/` with seeds/dt fixed, writes metrics JSON to `tests/scenarios/`, and fails if results miss `tests/baselines/thresholds.json`. Core loop is `CoreSim.step()` — shared with the browser, no renderer.

Scenarios include `containment` (near-surface / near-bank start): post-containment time above surface and OOB must stay ≈ 0; bank/bed/surface penetration *events* are allowed scrapes but capped.

## Live demo

Observational demo: [https://riverstarship.github.io/asalmonsim/](https://riverstarship.github.io/asalmonsim/). Repo may be temporarily public for free-plan Pages.

## UI note

Info/HUD card is **toggleable** (Hide/Show info). Camera buttons remain. There is **no** in-app accuracy overlay — see this file and the harness.
