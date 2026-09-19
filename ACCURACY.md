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
| Heat stress can shift fish toward cooler / lower-V refugia | Temp is a **light metabolic multiplier** now; refuge seeking still later | Thermoregulation / refuge studies |

**What real adults do *not* do:** pin continuously into banks and the free surface, or cruise at high thrust with no holding phase. That is a sim artifact to eliminate.

## Gap vs current build (v1.6)

| Ethology target | Current sim (v1.6) | Gap |
|-----------------|---------------------|-----|
| Stable dorsal-up attitude (no corkscrew) | **v1.4:** dorsal-up rebuild + roll damp/rate caps; harness `attitude_hydro` (roll ≈ 0°) | Pitch still angle-capped (~41°); no true fin-generated moments |
| Stepwise move/hold duty cycle | Explicit migrate/hold phases + hysteresis; harness `duty_cycle_ethology` | Hold fraction still short of telemetry “mostly holding” residency |
| Near-zero ground speed in lies | Low thrust match + slip/surge correction; `timeHoldLowSpeed` gated | Occasional slip on soft wake edges |
| Mid-column when moving | Mid-column pitch on cruise/burst; fraction gated in harness | Mid-column fraction ~0.3–0.5 of migrate time — room to climb |
| Low-V structure selection | **v1.5:** continuous jet / bank BL / depth / pool & boulder-wake gradients; lie markers metadata; harness `continuous_field_probe` + hold/lie V-deficit gates | Not real ADCP/CFD; synthetic only |
| Burst then recover | Burst only for high flow/obstacle; then hold/seek lie; strong recover in low-V lie | Obstacle sensing still coarse |
| Anticipatory avoidance | Bank/bed/surface clearance + light turbulence-proxy bias when seeking | Bed scrape counts still O(10²)–O(10³) under hard clamps |
| Fish-eye observation | **v1.2b:** direct wide-FOV to screen; POV clamped in free water | Barrel distortion deferred (flag default off) |
| Activity ≫ mild temp energy cost | **v1.6:** `Metabolism.ts` — hold ≪ cruise ≪ burst drain; through-water effort; light Q10≈1.6 temp mul; harness `fatigue_*` + `fatigue_compare` | Not validated kcal / full bioenergetics; no thermoregulatory refuge seeking yet |

## Version plan (toward the goal)

| Version | Focus | Ethology payoff | Exit criteria (headless + your visual check) |
|---------|--------|-----------------|-----------------------------------------------|
| **v1.2b** ✓ | Fish-eye unblack (direct wide-FOV; clamp POV in free water). **Sidecar.** | Lets you observe behavior | Fish-eye shows corridor; barrel RT off |
| **v1.3** ✓ | **Duty-cycle migration + mid-water behavior** | Stepwise ascent + mid-column + anticipatory avoidance | ↑ time-in-hold; ↑ mid-column migrate frac; ↓ scrape caps vs v1.2a; hold slip low in lies; DMG during migrate windows |
| **v1.4** ✓ | **Attitude hydro** — dorsal-up rebuild, roll damp/rate caps, kill yaw→roll corkscrew; roll cmd automatic | Ethology can express without spinning plant | `attitude_hydro`: \|roll\| ≈ 0°; low \|ω_roll\|; existing scenarios still pass |
| **v1.5** ✓ | Richer hydraulic field (same `sample()` API): mid-channel jet, bank BL, depth decay, pools & boulder wakes as **continuous** gradients; turbulence-intensity proxy | Makes lie choice physically motivated | `continuous_field_probe`; hold/lie \|flow\| < mid-channel ref; low `timeHoldFastCore` |
| **v1.6** ✓ | Fatigue / temp metabolic multipliers (OOM from Lennox-style curves) | Activity cost ≫ mild temp cost | Continuous cruise drains faster than hold; warm > cool drain modestly; activity gap > ΔT gap |
| **v1.7** | Undulatory / biomechanics thrust | Body motion generates force | Gait metrics; still decision-outer-loop |
| **Later** | Olfactory/homing lite, thermoregulatory refuge shifts, ocean/estuary packs, visuals | Expand habitat without rewriting fish | Portable fish + env packs |

**Explicitly deferred until listed version:** real ADCP/CFD import, undulatory biomechanics (v1.7), barrel-distortion polish, textures, in-app accuracy overlay, precise validated kcal accounting.

## Strategy (one line)

Unblack the camera → hold/move like telemetry (v1.3) → stabilize attitude plant (v1.4) → truer continuous hydraulics (v1.5) → **calibrate energy / fatigue-temp (v1.6)** → then undulatory biomechanics (v1.7) / visuals.

## Headless harness

```bash
npm run test:accuracy
```

Core loop: `CoreSim.step()` (shared with browser). Thresholds in `tests/baselines/` are order-of-magnitude gates, not field validation. v1.6 adds forced-mode `fatigue_cruise_drain` / `fatigue_hold_recover` / warm–cool cruise pairs and `fatigue_compare` (activity gap ≫ modest ΔT) on top of v1.5 hydraulics + v1.4 attitude + v1.3 duty-cycle gates.

## Live demo

https://riverstarship.github.io/asalmonsim/ — repo may be temporarily public for free-plan Pages.

## UI

Toggleable HUD only. No in-app accuracy overlay.
