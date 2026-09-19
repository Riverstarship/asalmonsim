/**
 * Order-of-magnitude fish-centered energy model (v1.6).
 *
 * Inspired by Lennox et al. 2018-style findings for adult Atlantic salmon:
 * activity (hold ≪ cruise ≪ burst) dominates drain; modest warming raises
 * cost secondarily. Not a validated bioenergetics / kcal model.
 */

export type MetabolicMode = 'hold' | 'cruise' | 'burst' | 'seek_hold';

/** Reference °C near typical cool freshwater ascent preference. */
export const METABOLIC_TREF_C = 10;

/**
 * Light temperature multiplier on metabolic cost.
 * ~Q10≈1.6 around Tref so +10 °C ≈ 1.6× — secondary to activity gaps.
 */
export function tempMultiplier(tempC: number, tRefC = METABOLIC_TREF_C): number {
  const q10 = 1.75;
  const mul = Math.pow(q10, (tempC - tRefC) / 10);
  // Clamp so extreme overrides stay OOM-plausible, not runaway
  return Math.min(2.2, Math.max(0.55, mul));
}

/**
 * Through-water / flow effort scalar (dimensionless ≥ 0).
 * Holding in low-V is cheap; opposing stronger current costs more.
 */
export function flowEffort(mode: MetabolicMode, flowSpeed: number): number {
  const v = Math.max(0, flowSpeed);
  switch (mode) {
    case 'hold':
      // Residual station-holding cost vs local V (sheltered lies ≈ cheap)
      return 0.05 + v * 0.35;
    case 'seek_hold':
      return 0.25 + v * 0.55;
    case 'cruise':
      return 0.55 + Math.max(0, v - 0.2) * 0.85;
    case 'burst':
      return 1.1 + Math.max(0, v - 0.15) * 1.15;
    default:
      return 0.4 + v * 0.5;
  }
}

/** Base activity drain (energy fraction / s) before temp × effort. */
export function baseActivityDrain(mode: MetabolicMode): number {
  switch (mode) {
    case 'hold':
      return 0.009;
    case 'seek_hold':
      return 0.048;
    case 'cruise':
      return 0.07;
    case 'burst':
      return 0.42;
    default:
      return 0.05;
  }
}

/**
 * Gross metabolic drain rate (energy fraction / s).
 * Activity sets the order of magnitude; temp multiplies lightly; effort scales with flow.
 */
export function drainRate(
  mode: MetabolicMode,
  flowSpeed: number,
  tempC: number,
): number {
  const base = baseActivityDrain(mode);
  const effort = flowEffort(mode, flowSpeed);
  const tMul = tempMultiplier(tempC);
  // Effort is a soft scale around ~1 so rates stay near base OOM
  return base * tMul * (0.55 + 0.45 * effort);
}

/**
 * Recovery rate (energy fraction / s). Strongest in low-V lies while holding;
 * burst/cruise recover almost nothing (oxygen debt / continuous work).
 */
export function recoverRate(
  mode: MetabolicMode,
  flowSpeed: number,
  inLie: boolean,
  nearLie: boolean,
): number {
  const lowV = flowSpeed < 0.35;
  if (mode === 'burst') return 0;
  if (mode === 'cruise') return 0.004; // tiny aerobic top-up only

  if (mode === 'hold') {
    if (inLie && lowV) return 0.155;
    if (inLie) return 0.11;
    if (nearLie && lowV) return 0.08;
    if (lowV) return 0.055;
    return 0.028; // holding against faster water — little net gain
  }

  // seek_hold
  if (inLie && lowV) return 0.05;
  if (nearLie && lowV) return 0.028;
  return 0.008;
}

/** Net dE/dt for harness probes (positive = gaining energy). */
export function netEnergyRate(
  mode: MetabolicMode,
  flowSpeed: number,
  tempC: number,
  inLie: boolean,
  nearLie: boolean,
): number {
  return (
    recoverRate(mode, flowSpeed, inLie, nearLie) -
    drainRate(mode, flowSpeed, tempC)
  );
}
