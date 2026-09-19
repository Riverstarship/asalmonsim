# Accuracy — Atlantic salmon adult

Honest fidelity tracking for *Salmo salar* **adult upriver / pre-spawn migration**. Prefer stating gaps over implying validation. Accuracy lives in this doc, the headless harness, and chat — **not** an in-app overlay.

## Goal

A portable adult Atlantic salmon whose **duty cycle and habitat use** match confirmed ethology: stepwise ascent, long energy-saving holds in low-velocity structure, mid-column swimming when moving, positive rheotaxis when station-holding, burst only for hard hydraulics, then recover. Environment and cameras serve that fish target.

## Confirmed behavior (research baseline)

Sources used for planning (not claimed as “implemented”):

| Finding | Implication for the sim | Key refs |
|--------|-------------------------|----------|
| Migration is **phased**: migratory (direct or **stepwise** with stops) → search near spawn → **long holding** with little/no movement | Modes must be duty-cycled (move → hold), not continuous cruise | Økland et al. 2001 (*J Fish Biol*, River Tana) |
| Much of freshwater residence is **holding in pools**; whole-migration mean swim effort can be ~**0.1 BL s⁻¹** effective | Holding is the default energy strategy; continuous high thrust is wrong | Bernatchez & Dodson 1987; Lennox et al. 2018; Richard et al. 2014 |
| Ground speeds on ascent often **~0.4–11 km day⁻¹** (site-dependent; e.g. mean ~2.6 km day⁻¹ in one Alta study) | Net upstream progress is slow vs body-length swim speed | Heggberget / Alta telemetry summaries |
| Holding habitat: **slow water**, pools, **boulders / bank structure**; observed prefs often ~**0.15–0.3 m s⁻¹** local velocity, not the high-velocity core | Lies must be real low-V pockets; fish should seek them to economize | Salmon-peloton / hydraulic habitat observations; Crisp 1996 (context) |
| Ascending adults often swim **~1–4 m below surface** (site-dependent), not glued to bed or surface | Prefer **mid-column** when migrating; near-bed only when using structure | Kemijoki tailrace telemetry (pressure tags) |
| **Positive rheotaxis** for position holding facing into flow | Hold = cancel slip, head into current | Standard rheotaxis / station-holding |
| Avoid **abrupt hydraulic change** when relocating (shown strongly in kelts; lateral-line relevant) | Don’t thrash across shear; prefer similar V / moderate eddies | Simmons et al. (kelt hydraulics, *J Fish Biol*) |
| Gait: sustain aerobic ~**≤1.5 BL s⁻¹**; anaerobic transition ~**>2 BL s⁻¹**; short bursts for obstacles then recover | Burst is rare and costly; then hold/recover | Adult salmon swim-performance reviews (e.g. CJFAS 2023 review context) |
| Adults **cease feeding**; **activity** dominates energy burn vs modest warming | Fatigue must punish continuous burst/cruise more than temperature alone | Lennox et al. 2018 *Freshwater Biology* |
| Heat stress can shift fish toward cooler / lower-V refugia | Temp is a **later** multiplier on hold/seek, not v1.3 core | Thermoregulation / refuge studies |

**What real adults do *not* do:** pin continuously into banks and the free surface, or cruise at high thrust with no holding phase. That is a sim artifact to eliminate.

## Gap vs current build (v1.2a)

| Ethology target | Current sim | Gap |
|-----------------|-------------|-----|
| Stepwise move/hold duty cycle | Modes exist but often look like restless cruise | Need explicit migratory vs hold phases + hysteresis |
| Near-zero ground speed in lies | Hold reduces slip but not “pool motionless” | Stronger hold thrust-matching + long hold residency |
| Mid-column when moving | Hard clamps only; weak clearance bias | Anticipatory depth/bank preference |
| Low-V structure selection | Hard lie pockets + seek_hold | OK scaffold; needs hydraulic gradients (v1.4) |
| Burst then recover | Burst mode + energy drain | Tie burst to obstacle/high-V only; longer recover-in-lie |
| Fish-eye observation | **Black screen** (RT post-process) | Sidecar fix — not an ethology item |

## Version plan (toward the goal)

| Version | Focus | Ethology payoff | Exit criteria (headless + your visual check) |
|---------|--------|-----------------|-----------------------------------------------|
| **v1.2b** | Fish-eye unblack (direct wide-FOV; clamp POV in free water). **Sidecar, not accuracy core.** | Lets you observe behavior | Fish-eye shows corridor; harness unchanged |
| **v1.3** | **Duty-cycle migration + mid-water behavior** | Matches stepwise ascent + mid-column + anticipatory avoidance | ↑ time-in-hold; ↑ time mid-column; ↓ scrape rate; hold slip≈0 in lies; DMG only during migratory bouts |
| **v1.4** | Richer hydraulic field (same `sample()` API): shear, pools, boulder wakes as continuous gradients | Makes lie choice physically motivated | Lie occupancy correlates with local V deficit; avoid high-V core when holding |
| **v1.5** | Fatigue / temp metabolic multipliers (OOM from Lennox-style curves) | Activity cost ≫ mild temp cost | Continuous cruise drains faster than hold; temp scales drain modestly |
| **v1.6** | Undulatory / biomechanics thrust | Body motion generates force | Gait metrics; still decision-outer-loop |
| **Later** | Olfactory/homing lite, thermoregulatory refuge shifts, ocean/estuary packs, visuals | Expand habitat without rewriting fish | Portable fish + env packs |

**Explicitly deferred until listed version:** soft-wall hydro, CFD site maps before v1.4, barrel-distortion polish, textures, in-app accuracy overlay.

## Strategy (one line)

Unblack the camera → make the fish **hold and move like telemetry says** (v1.3) → give it **truer hydraulics** (v1.4) → calibrate **energy** (v1.5) → then biomechanics/visuals.

## Headless harness

```bash
npm run test:accuracy
```

Core loop: `CoreSim.step()` (shared with browser). Thresholds in `tests/baselines/` are order-of-magnitude gates, not field validation.

## Live demo

https://riverstarship.github.io/asalmonsim/ — repo may be temporarily public for free-plan Pages.

## UI

Toggleable HUD only. No in-app accuracy overlay.
