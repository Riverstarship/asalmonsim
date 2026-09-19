# Accuracy — Atlantic salmon adult (v1)

Honest fidelity tracking for *Salmo salar* upriver ascent. Prefer stating gaps over implying validation.

## Goal

Represent an **adult Atlantic salmon** migrating up a river corridor such that:

1. The fish **samples** a spatially varying current and temperature field.
2. **Behavioral modes** (hold / cruise / burst / seek holding lie) visibly change kinematics and energy use.
3. Hydrodynamics give plausible **station-holding**, **slip**, and **burst** against flow at order-of-magnitude adult scales (~0.7–0.8 m length, few m/s burst).
4. Cameras support observation (follow + fish-eye) without implying a player avatar.

v1 success is **qualitative behavioral fidelity**, not CFD-validated swimming or stock-specific phenology.

## Gap

| Area | What we have | What’s missing / wrong |
|------|----------------|-------------------------|
| Hydrodynamics | Lumped buoyancy, quadratic drag, thrust + simple torque coupling | No added-mass, no vortex wake, no ground-effect; thrust curve not fitted to force plates / CFD |
| Body / fins | Wired fins with amp/phase constraints; caudal coupled to lateral thrust | No muscle activation, no undulatory body wave as force generator, no fin–fin interference |
| Current field | Analytic core + bank shear + lite eddies; season/discharge scale | No real bathymetry, gauge data, or CFD; eddies are decorative attractors |
| Temperature | Coarse season+lat base with bank/bed gradients | No diurnal cycle, stratification physics, or thermal refugia from measurements |
| Decisions | Sense → mode select with energy budget | No olfactory homing, photoperiod, social cues, predators, or dam/weir negotiation |
| Energetics | Simple drain/recover by mode | Not calibrated to oxygen debt, temperature-dependent metabolism, or distance-made-good |
| Morphology | Procedural mesh, wet clearcoat look | Not morphometric; no sex/age/condition variants; no silvering / kelt states |
| Collision | AABB-ish bed/banks | No complex structure (boulders, woody debris) |

**Do not treat HUD speeds or forces as measured values.**

## Next strategy

1. **Environment first (highest leverage):** Replace analytic current with a 2.5D field from a real reach (ADCP / shallow CFD / published vector maps). Keep the same `sample(x,y,z)` API.
2. **Fatigue–recovery curves:** Fit mode costs and hold thresholds to published ascent energetic budgets; expose season/temp as metabolic multipliers.
3. **Homing lite:** Add a weak upstream olfactory / rheotaxis bias before any fancy path planning.
4. **Biomechanics pass:** Introduce a traveling-wave body envelope driving thrust; keep decision layer as the outer loop.
5. **Visuals last:** Improve mesh/materials only after motion and decisions read correctly on mobile-sized viewports.


## Live demo

Observational demo is published at [https://riverstarship.github.io/asalmonsim/](https://riverstarship.github.io/asalmonsim/). Repo is temporarily public for Pages testing on free GitHub; private again after testing disables free Pages.

## Overlay (in-app)

The on-screen accuracy panel mirrors a short form of **Goal / Gap / Strategy** so observers never confuse the demo for a validated bioenergetic model.
