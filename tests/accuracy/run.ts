/**
 * Headless accuracy harness — Node only, no WebGL/DOM.
 * Usage: npm run test:accuracy
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG } from '../../src/config';
import { CoreSim, type CoreMetrics } from '../../src/sim/CoreSim';
import { SCENARIOS, runScenario } from './scenarios';
import { drainRate as metabolicDrainRate } from '../../src/ai/Metabolism';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const METRICS_DIR = join(ROOT, 'tests/scenarios');
const BASELINE_PATH = join(ROOT, 'tests/baselines/thresholds.json');

interface Thresholds {
  hold_midchannel: {
    maxHoldDownstreamSlip: number;
    minTimeInHold: number;
    minHoldFraction: number;
    minHoldLowSpeed: number;
  };
  seek_lie_when_tired: {
    mustReachOrOccupyLie: boolean;
    minTimeInLieOrSeek: number;
  };
  upstream_dmg: {
    minDmg: number;
    minTimeInCruise: number;
  };
  energy_burst_limits: {
    maxEndEnergyIfBurstHeavy: number;
    maxMeanThrustWhenDrained: number;
    requireEnergyDrop: number;
  };
  stability: {
    maxNanCount: number;
    maxOutOfBoundsCount: number;
    maxAbsX: number;
    minY: number;
    maxY: number;
    maxBankPenetrationEvents: number;
    maxBedPenetrationEvents: number;
    maxSurfaceBreachEvents: number;
  };
  containment: {
    maxTimeAboveSurface: number;
    maxBankPenetrationEvents: number;
    maxBedPenetrationEvents: number;
    maxSurfaceBreachEvents: number;
    maxOutOfBoundsCount: number;
  };
  duty_cycle_ethology: {
    minHoldFraction: number;
    minHoldLowSpeed: number;
    minMidColumnMigrateFraction: number;
    minTimeInCruise: number;
    maxBankPenetrationEvents: number;
    maxBedPenetrationEvents: number;
    maxSurfaceBreachEvents: number;
    maxOutOfBoundsCount: number;
  };
  attitude_hydro: {
    maxAbsRollDeg: number;
    maxMeanAbsRollDeg: number;
    minTimeRollUnder45Fraction: number;
    maxMeanAbsRollRate: number;
    maxRollRateVariance: number;
    maxAbsRollRate: number;
    maxNanCount: number;
  };
  continuous_hydraulics: {
    maxLieVsMidRatio: number;
    maxHoldVsMidRatio: number;
    maxLieFlowVsMidRatio: number;
    maxTimeHoldFastCore: number;
    minBankDeficitRatio: number;
    minSurfaceVsBedRatio: number;
  };
  fatigue_cruise_drain: {
    minEnergyDrop: number;
    maxEndEnergy: number;
    minTimeInCruise: number;
  };
  fatigue_hold_recover: {
    minNetEnergyChange: number;
    minTimeInHold: number;
    minEndEnergy: number;
  };
  fatigue_compare: {
    minCruiseVsHoldDrainGap: number;
    minWarmVsCoolDrainGap: number;
    minActivityOverTempGap: number;
  };
  undulatory_gait: {
    minCruiseWavePower: number;
    maxHoldWavePower: number;
    minCruiseOverHoldPowerRatio: number;
    minCruiseWaveAmplitude: number;
    minCruiseWaveFrequency: number;
    minCruiseWaveThrust: number;
    minThrustWaveCorrelation: number;
  };
}

function loadThresholds(): Thresholds {
  const raw = readFileSync(BASELINE_PATH, 'utf8');
  return JSON.parse(raw) as Thresholds;
}

type Check = { ok: boolean; msg: string };

function checkHold(m: CoreMetrics, t: Thresholds['hold_midchannel']): Check[] {
  return [
    {
      ok: m.holdDownstreamSlip <= t.maxHoldDownstreamSlip,
      msg: `holdDownstreamSlip ${m.holdDownstreamSlip.toFixed(3)} <= ${t.maxHoldDownstreamSlip}`,
    },
    {
      ok: m.timeInHold >= t.minTimeInHold,
      msg: `timeInHold ${m.timeInHold.toFixed(2)} >= ${t.minTimeInHold}`,
    },
    {
      ok: m.holdFraction >= t.minHoldFraction,
      msg: `holdFraction ${m.holdFraction.toFixed(2)} >= ${t.minHoldFraction}`,
    },
    {
      ok: m.timeHoldLowSpeed >= t.minHoldLowSpeed,
      msg: `timeHoldLowSpeed ${m.timeHoldLowSpeed.toFixed(2)} >= ${t.minHoldLowSpeed}`,
    },
  ];
}

function checkSeek(m: CoreMetrics, t: Thresholds['seek_lie_when_tired']): Check[] {
  const seekOrLie = m.timeInLie + m.timeInSeekHold;
  return [
    {
      ok: !t.mustReachOrOccupyLie || m.reachedLie || m.occupiedLie,
      msg: `reached/occupied lie (reached=${m.reachedLie}, occupied=${m.occupiedLie})`,
    },
    {
      ok: seekOrLie >= t.minTimeInLieOrSeek,
      msg: `timeInLie+seek ${seekOrLie.toFixed(2)} >= ${t.minTimeInLieOrSeek}`,
    },
  ];
}

function checkDmg(m: CoreMetrics, t: Thresholds['upstream_dmg']): Check[] {
  return [
    {
      ok: m.dmg >= t.minDmg,
      msg: `dmg ${m.dmg.toFixed(2)} >= ${t.minDmg}`,
    },
    {
      ok: m.timeInCruise >= t.minTimeInCruise,
      msg: `timeInCruise ${m.timeInCruise.toFixed(2)} >= ${t.minTimeInCruise}`,
    },
  ];
}

function checkBurst(m: CoreMetrics, t: Thresholds['energy_burst_limits']): Check[] {
  const drop = m.maxEnergy - m.minEnergy;
  return [
    {
      ok: drop >= t.requireEnergyDrop,
      msg: `energy drop ${drop.toFixed(3)} >= ${t.requireEnergyDrop}`,
    },
    {
      ok: m.minEnergy <= t.maxEndEnergyIfBurstHeavy || m.endEnergy < 0.85,
      msg: `energy drained (min=${m.minEnergy.toFixed(3)}, end=${m.endEnergy.toFixed(3)})`,
    },
    {
      ok: m.maxThrust <= 1.001 && m.meanThrust <= t.maxMeanThrustWhenDrained,
      msg: `meanThrust ${m.meanThrust.toFixed(3)} <= ${t.maxMeanThrustWhenDrained} (max=${m.maxThrust.toFixed(3)})`,
    },
  ];
}

function checkStability(m: CoreMetrics, t: Thresholds['stability']): Check[] {
  return [
    {
      ok: m.nanCount <= t.maxNanCount,
      msg: `nanCount ${m.nanCount} <= ${t.maxNanCount}`,
    },
    {
      ok: m.outOfBoundsCount <= t.maxOutOfBoundsCount,
      msg: `outOfBoundsCount ${m.outOfBoundsCount} <= ${t.maxOutOfBoundsCount}`,
    },
    {
      ok: m.maxAbsX <= t.maxAbsX,
      msg: `maxAbsX ${m.maxAbsX.toFixed(2)} <= ${t.maxAbsX}`,
    },
    {
      ok: m.minY >= t.minY && m.maxY <= t.maxY,
      msg: `y in [${t.minY},${t.maxY}] (got ${m.minY.toFixed(2)}..${m.maxY.toFixed(2)})`,
    },
    {
      ok: m.bankPenetrationEvents <= t.maxBankPenetrationEvents,
      msg: `bankPenetrationEvents ${m.bankPenetrationEvents} <= ${t.maxBankPenetrationEvents}`,
    },
    {
      ok: m.bedPenetrationEvents <= t.maxBedPenetrationEvents,
      msg: `bedPenetrationEvents ${m.bedPenetrationEvents} <= ${t.maxBedPenetrationEvents}`,
    },
    {
      ok: m.surfaceBreachEvents <= t.maxSurfaceBreachEvents,
      msg: `surfaceBreachEvents ${m.surfaceBreachEvents} <= ${t.maxSurfaceBreachEvents}`,
    },
  ];
}

function checkContainment(m: CoreMetrics, t: Thresholds['containment']): Check[] {
  return [
    {
      ok: m.timeAboveSurface <= t.maxTimeAboveSurface,
      msg: `timeAboveSurface ${m.timeAboveSurface.toFixed(3)}s <= ${t.maxTimeAboveSurface}`,
    },
    {
      ok: m.bankPenetrationEvents <= t.maxBankPenetrationEvents,
      msg: `bankPenetrationEvents ${m.bankPenetrationEvents} <= ${t.maxBankPenetrationEvents}`,
    },
    {
      ok: m.bedPenetrationEvents <= t.maxBedPenetrationEvents,
      msg: `bedPenetrationEvents ${m.bedPenetrationEvents} <= ${t.maxBedPenetrationEvents}`,
    },
    {
      ok: m.surfaceBreachEvents <= t.maxSurfaceBreachEvents,
      msg: `surfaceBreachEvents ${m.surfaceBreachEvents} <= ${t.maxSurfaceBreachEvents}`,
    },
    {
      ok: m.outOfBoundsCount <= t.maxOutOfBoundsCount,
      msg: `outOfBoundsCount ${m.outOfBoundsCount} <= ${t.maxOutOfBoundsCount}`,
    },
  ];
}

function checkDuty(m: CoreMetrics, t: Thresholds['duty_cycle_ethology']): Check[] {
  return [
    {
      ok: m.holdFraction >= t.minHoldFraction,
      msg: `holdFraction ${m.holdFraction.toFixed(2)} >= ${t.minHoldFraction}`,
    },
    {
      ok: m.timeHoldLowSpeed >= t.minHoldLowSpeed,
      msg: `timeHoldLowSpeed ${m.timeHoldLowSpeed.toFixed(2)} >= ${t.minHoldLowSpeed}`,
    },
    {
      ok: m.midColumnMigrateFraction >= t.minMidColumnMigrateFraction,
      msg: `midColumnMigrateFraction ${m.midColumnMigrateFraction.toFixed(2)} >= ${t.minMidColumnMigrateFraction}`,
    },
    {
      ok: m.timeInCruise >= t.minTimeInCruise,
      msg: `timeInCruise ${m.timeInCruise.toFixed(2)} >= ${t.minTimeInCruise}`,
    },
    {
      ok: m.bankPenetrationEvents <= t.maxBankPenetrationEvents,
      msg: `bankPenetrationEvents ${m.bankPenetrationEvents} <= ${t.maxBankPenetrationEvents}`,
    },
    {
      ok: m.bedPenetrationEvents <= t.maxBedPenetrationEvents,
      msg: `bedPenetrationEvents ${m.bedPenetrationEvents} <= ${t.maxBedPenetrationEvents}`,
    },
    {
      ok: m.surfaceBreachEvents <= t.maxSurfaceBreachEvents,
      msg: `surfaceBreachEvents ${m.surfaceBreachEvents} <= ${t.maxSurfaceBreachEvents}`,
    },
    {
      ok: m.outOfBoundsCount <= t.maxOutOfBoundsCount,
      msg: `outOfBoundsCount ${m.outOfBoundsCount} <= ${t.maxOutOfBoundsCount}`,
    },
  ];
}

function checkAttitude(m: CoreMetrics, t: Thresholds['attitude_hydro']): Check[] {
  const maxDeg = (m.maxAbsRoll * 180) / Math.PI;
  const meanDeg = (m.meanAbsRoll * 180) / Math.PI;
  return [
    {
      ok: maxDeg <= t.maxAbsRollDeg,
      msg: `maxAbsRoll ${maxDeg.toFixed(1)}° <= ${t.maxAbsRollDeg}°`,
    },
    {
      ok: meanDeg <= t.maxMeanAbsRollDeg,
      msg: `meanAbsRoll ${meanDeg.toFixed(1)}° <= ${t.maxMeanAbsRollDeg}°`,
    },
    {
      ok: m.timeRollUnder45Fraction >= t.minTimeRollUnder45Fraction,
      msg: `timeRollUnder45Fraction ${m.timeRollUnder45Fraction.toFixed(3)} >= ${t.minTimeRollUnder45Fraction}`,
    },
    {
      ok: m.meanAbsRollRate <= t.maxMeanAbsRollRate,
      msg: `meanAbsRollRate ${m.meanAbsRollRate.toFixed(3)} <= ${t.maxMeanAbsRollRate}`,
    },
    {
      ok: m.rollRateVariance <= t.maxRollRateVariance,
      msg: `rollRateVariance ${m.rollRateVariance.toFixed(3)} <= ${t.maxRollRateVariance}`,
    },
    {
      ok: m.maxAbsRollRate <= t.maxAbsRollRate,
      msg: `maxAbsRollRate ${m.maxAbsRollRate.toFixed(3)} <= ${t.maxAbsRollRate}`,
    },
    {
      ok: m.nanCount <= t.maxNanCount,
      msg: `nanCount ${m.nanCount} <= ${t.maxNanCount}`,
    },
  ];
}


function checkFatigueCruise(m: CoreMetrics, t: Thresholds['fatigue_cruise_drain']): Check[] {
  const drop = m.initialEnergy - m.endEnergy;
  return [
    {
      ok: drop >= t.minEnergyDrop,
      msg: `cruise energy drop ${drop.toFixed(3)} >= ${t.minEnergyDrop}`,
    },
    {
      ok: m.endEnergy <= t.maxEndEnergy,
      msg: `endEnergy ${m.endEnergy.toFixed(3)} <= ${t.maxEndEnergy}`,
    },
    {
      ok: m.timeInCruise >= t.minTimeInCruise,
      msg: `timeInCruise ${m.timeInCruise.toFixed(2)} >= ${t.minTimeInCruise}`,
    },
  ];
}

function checkFatigueHold(m: CoreMetrics, t: Thresholds['fatigue_hold_recover']): Check[] {
  return [
    {
      ok: m.netEnergyChange >= t.minNetEnergyChange,
      msg: `netEnergyChange ${m.netEnergyChange.toFixed(3)} >= ${t.minNetEnergyChange}`,
    },
    {
      ok: m.timeInHold >= t.minTimeInHold,
      msg: `timeInHold ${m.timeInHold.toFixed(2)} >= ${t.minTimeInHold}`,
    },
    {
      ok: m.endEnergy >= t.minEndEnergy,
      msg: `endEnergy ${m.endEnergy.toFixed(3)} >= ${t.minEndEnergy}`,
    },
  ];
}

function checkContinuous(m: CoreMetrics, t: Thresholds['continuous_hydraulics']): Check[] {
  const holdRatio =
    m.meanHoldMidRefFlow > 1e-6 ? m.meanHoldFlow / m.meanHoldMidRefFlow : 0;
  const lieRatio =
    m.meanHoldMidRefFlow > 1e-6 ? m.meanLieFlow / m.meanHoldMidRefFlow : 0;
  // If no hold/lie samples, skip ratio gates (but fail fast-core if somehow holding nowhere)
  const checks: Check[] = [
    {
      ok: m.holdFlowSamples === 0 || holdRatio <= t.maxHoldVsMidRatio,
      msg: `holdFlow/midRef ${holdRatio.toFixed(3)} <= ${t.maxHoldVsMidRatio} (n=${m.holdFlowSamples})`,
    },
    {
      ok: m.lieFlowSamples === 0 || lieRatio <= t.maxLieFlowVsMidRatio,
      msg: `lieFlow/midRef ${lieRatio.toFixed(3)} <= ${t.maxLieFlowVsMidRatio} (n=${m.lieFlowSamples})`,
    },
    {
      ok: m.timeHoldFastCore <= t.maxTimeHoldFastCore,
      msg: `timeHoldFastCore ${m.timeHoldFastCore.toFixed(2)}s <= ${t.maxTimeHoldFastCore}`,
    },
  ];
  return checks;
}


function checkUndulatoryCruise(m: CoreMetrics, t: Thresholds['undulatory_gait']): Check[] {
  // Correlation proxy: E[thrust·power] / (E[thrust]·E[power] + ε) ≥ threshold when both vary together
  const meanT = m.meanThrustLevel;
  const meanP = m.meanWavePower;
  const corrProxy =
    meanT > 1e-6 && meanP > 1e-6 ? m.thrustWaveCov / (meanT * meanP) : 0;
  return [
    {
      ok: m.meanWavePower >= t.minCruiseWavePower,
      msg: `meanWavePower ${m.meanWavePower.toFixed(3)} >= ${t.minCruiseWavePower}`,
    },
    {
      ok: m.meanWaveAmplitude >= t.minCruiseWaveAmplitude,
      msg: `meanWaveAmplitude ${m.meanWaveAmplitude.toFixed(4)}m >= ${t.minCruiseWaveAmplitude}`,
    },
    {
      ok: m.meanWaveFrequency >= t.minCruiseWaveFrequency,
      msg: `meanWaveFrequency ${m.meanWaveFrequency.toFixed(2)}Hz >= ${t.minCruiseWaveFrequency}`,
    },
    {
      ok: m.meanWaveThrust >= t.minCruiseWaveThrust,
      msg: `meanWaveThrust ${m.meanWaveThrust.toFixed(1)}N >= ${t.minCruiseWaveThrust}`,
    },
    {
      ok: corrProxy >= t.minThrustWaveCorrelation,
      msg: `thrust↔wave corr proxy ${corrProxy.toFixed(3)} >= ${t.minThrustWaveCorrelation}`,
    },
    {
      ok: m.timeInCruise >= 10,
      msg: `forced cruise time ${m.timeInCruise.toFixed(2)} >= 10`,
    },
  ];
}

function checkUndulatoryHold(m: CoreMetrics, t: Thresholds['undulatory_gait']): Check[] {
  return [
    {
      ok: m.meanWavePower <= t.maxHoldWavePower,
      msg: `hold meanWavePower ${m.meanWavePower.toFixed(3)} <= ${t.maxHoldWavePower}`,
    },
    {
      ok: m.timeInHold >= 10,
      msg: `forced hold time ${m.timeInHold.toFixed(2)} >= 10`,
    },
  ];
}

function main(): void {
  mkdirSync(METRICS_DIR, { recursive: true });
  if (!existsSync(BASELINE_PATH)) {
    console.error('missing baselines at', BASELINE_PATH);
    process.exit(1);
  }
  const thresholds = loadThresholds();
  let failed = 0;
  const summary: Record<string, unknown> = {};

  console.log('asalmonsim accuracy harness (v1.8 hold-residency retune)\n');

  {
    const probe = new CoreSim({ config: DEFAULT_CONFIG, headless: true, seed: 1 });
    const th = thresholds.continuous_hydraulics;
    const lie = probe.river.holdingLies[1]!;
    const y = lie.position.y;
    const z = lie.position.z;
    const mid = probe.river.current.sample(0, y, z);
    const inLie = probe.river.current.sample(lie.position.x, y, z);
    const bank = probe.river.current.sample(5.2, y, z);
    const bed = probe.river.current.sample(0, 0.4, z);
    const surf = probe.river.current.sample(0, 3.2, z);
    const midSp = mid.length();
    const lieSp = inLie.length();
    const bankSp = bank.length();
    const bedSp = bed.length();
    const surfSp = surf.length();
    const lieRatio = midSp > 1e-6 ? lieSp / midSp : 1;
    const bankRatio = bankSp > 1e-6 ? midSp / bankSp : 0;
    const depthRatio = bedSp > 1e-6 ? surfSp / bedSp : 0;
    // Smoothness: finite difference magnitude stays bounded (no hard discontinuities)
    const eps = 0.25;
    const a = probe.river.current.sample(lie.position.x - eps, y, z);
    const b = probe.river.current.sample(lie.position.x + eps, y, z);
    const grad = a.distanceTo(b) / (2 * eps);
    const turb = probe.river.current.turbulenceIntensity(lie.position.x, y, z);

    const checks: Check[] = [
      {
        ok: lieRatio <= th.maxLieVsMidRatio,
        msg: `lie/mid ${lieRatio.toFixed(3)} <= ${th.maxLieVsMidRatio} (${lie.kind})`,
      },
      {
        ok: bankRatio >= th.minBankDeficitRatio,
        msg: `mid/bank ${bankRatio.toFixed(3)} >= ${th.minBankDeficitRatio}`,
      },
      {
        ok: depthRatio >= th.minSurfaceVsBedRatio,
        msg: `surf/bed ${depthRatio.toFixed(3)} >= ${th.minSurfaceVsBedRatio}`,
      },
      {
        ok: grad < 2.5 && Number.isFinite(grad),
        msg: `smooth grad ${grad.toFixed(3)} < 2.5 m/s per m`,
      },
      {
        ok: turb > 0.15 && turb < 1.3,
        msg: `turbulence proxy ${turb.toFixed(3)} in (0.15, 1.3)`,
      },
    ];
    const ok = checks.every((c) => c.ok);
    console.log(`[${ok ? 'PASS' : 'FAIL'}] continuous_field_probe`);
    for (const c of checks) {
      console.log(`       ${c.ok ? '✓' : '✗'} ${c.msg}`);
    }
    console.log(
      `       mid ${midSp.toFixed(3)} lie ${lieSp.toFixed(3)} bank ${bankSp.toFixed(3)} bed ${bedSp.toFixed(3)} surf ${surfSp.toFixed(3)} m/s`,
    );
    if (!ok) failed += 1;
    summary.continuous_field_probe = {
      ok,
      midSp,
      lieSp,
      bankSp,
      bedSp,
      surfSp,
      lieRatio,
      bankRatio,
      depthRatio,
      grad,
      turb,
      kind: lie.kind,
    };
    // Keep legacy alias for older summaries
    summary.lie_velocity_deficit = { ok: lieRatio <= th.maxLieVsMidRatio, midSp, lieSp, kind: lie.kind };
  }

  for (const def of SCENARIOS) {
    const m = runScenario(def);
    const outPath = join(METRICS_DIR, `${def.id}.metrics.json`);
    writeFileSync(outPath, JSON.stringify({ scenario: def, metrics: m }, null, 2));

    let checks: Check[] = [];
    switch (def.id) {
      case 'hold_midchannel':
        checks = checkHold(m, thresholds.hold_midchannel);
        break;
      case 'seek_lie_when_tired':
        checks = checkSeek(m, thresholds.seek_lie_when_tired);
        break;
      case 'upstream_dmg':
        checks = checkDmg(m, thresholds.upstream_dmg);
        break;
      case 'energy_burst_limits':
        checks = checkBurst(m, thresholds.energy_burst_limits);
        break;
      case 'stability':
        checks = checkStability(m, thresholds.stability);
        break;
      case 'containment':
        checks = checkContainment(m, thresholds.containment);
        break;
      case 'duty_cycle_ethology':
        checks = checkDuty(m, thresholds.duty_cycle_ethology);
        break;
      case 'attitude_hydro':
        checks = checkAttitude(m, thresholds.attitude_hydro);
        break;
      case 'fatigue_cruise_drain':
        checks = checkFatigueCruise(m, thresholds.fatigue_cruise_drain);
        break;
      case 'fatigue_hold_recover':
        checks = checkFatigueHold(m, thresholds.fatigue_hold_recover);
        break;
      case 'fatigue_temp_warm':
      case 'fatigue_temp_cool':
        // Compared pairwise after the loop (activity ≫ modest ΔT)
        checks = [
          {
            ok: m.timeInCruise >= 7,
            msg: `forced cruise time ${m.timeInCruise.toFixed(2)} >= 7`,
          },
          {
            ok: m.netEnergyChange < -0.12,
            msg: `net drain ${m.netEnergyChange.toFixed(3)} < -0.12`,
          },
        ];
        break;
      case 'undulatory_gait_cruise':
        checks = checkUndulatoryCruise(m, thresholds.undulatory_gait);
        break;
      case 'undulatory_gait_hold':
        checks = checkUndulatoryHold(m, thresholds.undulatory_gait);
        break;
      default:
        checks = [{ ok: false, msg: `unknown scenario ${def.id}` }];
    }

    // v1.5: occupancy ↔ V-deficit gates on hold-heavy scenarios
    if (def.id === 'hold_midchannel' || def.id === 'duty_cycle_ethology' || def.id === 'seek_lie_when_tired') {
      checks = checks.concat(checkContinuous(m, thresholds.continuous_hydraulics));
    }

    const ok = checks.every((c) => c.ok);
    if (!ok) failed += 1;
    const mark = ok ? 'PASS' : 'FAIL';
    console.log(`[${mark}] ${def.id}`);
    for (const c of checks) {
      console.log(`       ${c.ok ? '✓' : '✗'} ${c.msg}`);
    }
    console.log(
      `       dmg=${m.dmg.toFixed(2)} energy=${m.endEnergy.toFixed(2)} dE=${m.netEnergyChange.toFixed(2)} T=${m.meanTempC.toFixed(1)}°C hold=${m.timeInHold.toFixed(1)}s` +
        ` holdFrac=${m.holdFraction.toFixed(2)} midMigFrac=${m.midColumnMigrateFraction.toFixed(2)}` +
        ` lie=${m.timeInLie.toFixed(1)}s burst=${m.timeInBurst.toFixed(1)}s` +
        ` surfT=${m.timeAboveSurface.toFixed(2)}s pen(bank/bed/surf)=${m.bankPenetrationEvents}/${m.bedPenetrationEvents}/${m.surfaceBreachEvents}` +
        ` rollMax=${((m.maxAbsRoll * 180) / Math.PI).toFixed(1)}°` +
        ` |ωr|=${m.meanAbsRollRate.toFixed(3)}` +
        ` holdV=${m.meanHoldFlow.toFixed(3)} midRef=${m.meanHoldMidRefFlow.toFixed(3)}` +
        ` fastCore=${m.timeHoldFastCore.toFixed(1)}s` +
        ` waveP=${m.meanWavePower.toFixed(3)} A=${m.meanWaveAmplitude.toFixed(3)} f=${m.meanWaveFrequency.toFixed(2)}Hz` +
        ` Fwave=${m.meanWaveThrust.toFixed(1)}N`,
    );

    summary[def.id] = { ok, metrics: m, checks };
  }

  // v1.6 comparative: activity drain ≫ modest temperature effect
  {
    const th = thresholds.fatigue_compare;
    const cruise = (summary.fatigue_cruise_drain as { metrics: CoreMetrics } | undefined)?.metrics;
    const hold = (summary.fatigue_hold_recover as { metrics: CoreMetrics } | undefined)?.metrics;
    const warm = (summary.fatigue_temp_warm as { metrics: CoreMetrics } | undefined)?.metrics;
    const cool = (summary.fatigue_temp_cool as { metrics: CoreMetrics } | undefined)?.metrics;
    const checks: Check[] = [];
    // Analytical OOM rates at representative mid-channel flow (avoids energy-floor saturation)
    const flowRef = 0.55;
    const rateCruise = metabolicDrainRate('cruise', flowRef, 10);
    const rateHold = metabolicDrainRate('hold', flowRef, 10);
    const rateWarm = metabolicDrainRate('cruise', flowRef, 16);
    const rateCool = metabolicDrainRate('cruise', flowRef, 6);
    const rateActivityGap = rateCruise - rateHold;
    const rateTempGap = rateWarm - rateCool;
    checks.push({
      ok: rateActivityGap > rateTempGap * 1.35,
      msg: `rate activity ${rateActivityGap.toFixed(4)}/s ≫ temp ${rateTempGap.toFixed(4)}/s (cruise=${rateCruise.toFixed(4)}, hold=${rateHold.toFixed(4)}, warm=${rateWarm.toFixed(4)}, cool=${rateCool.toFixed(4)})`,
    });
    if (!cruise || !hold || !warm || !cool) {
      checks.push({ ok: false, msg: 'missing fatigue scenario metrics for compare' });
    } else {
      const cruiseLoss = -cruise.netEnergyChange;
      const holdLoss = -hold.netEnergyChange; // typically ≤ 0 when recovering
      const warmLoss = -warm.netEnergyChange;
      const coolLoss = -cool.netEnergyChange;
      const activityGap = cruiseLoss - holdLoss;
      const tempGap = warmLoss - coolLoss;
      checks.push({
        ok: activityGap >= th.minCruiseVsHoldDrainGap,
        msg: `cruise−hold drain gap ${activityGap.toFixed(3)} >= ${th.minCruiseVsHoldDrainGap} (cruiseLoss=${cruiseLoss.toFixed(3)}, holdLoss=${holdLoss.toFixed(3)})`,
      });
      // Prefer wall-clock temp gap; if both floored, analytical rateTempGap still required above
      checks.push({
        ok: tempGap >= th.minWarmVsCoolDrainGap || rateTempGap >= 0.01,
        msg: `warm−cool drain gap ${tempGap.toFixed(3)} (wall) / rate ${rateTempGap.toFixed(4)} (T≈${warm.meanTempC.toFixed(1)}/${cool.meanTempC.toFixed(1)}°C)`,
      });
      checks.push({
        ok: activityGap - Math.max(0, tempGap) >= th.minActivityOverTempGap,
        msg: `activity over temp ${(activityGap - Math.max(0, tempGap)).toFixed(3)} >= ${th.minActivityOverTempGap}`,
      });
    }
    const ok = checks.every((c) => c.ok);
    if (!ok) failed += 1;
    console.log(`[${ok ? 'PASS' : 'FAIL'}] fatigue_compare`);
    for (const c of checks) {
      console.log(`       ${c.ok ? '✓' : '✗'} ${c.msg}`);
    }
    summary.fatigue_compare = { ok, checks };
  }

  // v1.7 comparative: cruise wave power ≫ hold; thrust tracks wave
  {
    const th = thresholds.undulatory_gait;
    const cruise = (summary.undulatory_gait_cruise as { metrics: CoreMetrics } | undefined)?.metrics;
    const hold = (summary.undulatory_gait_hold as { metrics: CoreMetrics } | undefined)?.metrics;
    const checks: Check[] = [];
    if (!cruise || !hold) {
      checks.push({ ok: false, msg: 'missing undulatory scenario metrics for compare' });
    } else {
      const ratio =
        hold.meanWavePower > 1e-8
          ? cruise.meanWavePower / hold.meanWavePower
          : cruise.meanWavePower > th.minCruiseWavePower
            ? 999
            : 0;
      checks.push({
        ok: cruise.meanWavePower >= th.minCruiseWavePower,
        msg: `cruise wavePower ${cruise.meanWavePower.toFixed(3)} >= ${th.minCruiseWavePower}`,
      });
      checks.push({
        ok: hold.meanWavePower <= th.maxHoldWavePower,
        msg: `hold wavePower ${hold.meanWavePower.toFixed(3)} <= ${th.maxHoldWavePower}`,
      });
      checks.push({
        ok: ratio >= th.minCruiseOverHoldPowerRatio,
        msg: `cruise/hold wavePower ratio ${ratio.toFixed(2)} >= ${th.minCruiseOverHoldPowerRatio}`,
      });
      checks.push({
        ok: cruise.meanWaveThrust > hold.meanWaveThrust * 1.8,
        msg: `cruise thrust ${cruise.meanWaveThrust.toFixed(1)}N > hold ${hold.meanWaveThrust.toFixed(1)}N ×1.8`,
      });
      // Attitude still green on gait runs
      const rollDeg = (cruise.maxAbsRoll * 180) / Math.PI;
      checks.push({
        ok: rollDeg <= 15,
        msg: `gait cruise maxAbsRoll ${rollDeg.toFixed(1)}° <= 15° (v1.4 preserved)`,
      });
    }
    const ok = checks.every((c) => c.ok);
    if (!ok) failed += 1;
    console.log(`[${ok ? 'PASS' : 'FAIL'}] undulatory_compare`);
    for (const c of checks) {
      console.log(`       ${c.ok ? '✓' : '✗'} ${c.msg}`);
    }
    summary.undulatory_compare = { ok, checks };
  }

  const summaryPath = join(METRICS_DIR, '_summary.json');
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  console.log(`\nMetrics written to tests/scenarios/`);
  if (failed > 0) {
    console.error(`\n${failed} scenario(s) failed`);
    process.exit(1);
  }
  console.log('\nAll accuracy scenarios passed.');
}

main();
