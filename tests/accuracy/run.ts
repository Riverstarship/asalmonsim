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

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const METRICS_DIR = join(ROOT, 'tests/scenarios');
const BASELINE_PATH = join(ROOT, 'tests/baselines/thresholds.json');

interface Thresholds {
  hold_midchannel: {
    maxHoldDownstreamSlip: number;
    minTimeInHold: number;
  };
  seek_lie_when_tired: {
    mustReachOrOccupyLie: boolean;
    minTimeInLieOrSeek: number;
  };
  upstream_dmg: {
    minDmg: number;
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
  };
  containment: {
    maxTimeAboveSurface: number;
    maxBankPenetrationEvents: number;
    maxBedPenetrationEvents: number;
    maxSurfaceBreachEvents: number;
    maxOutOfBoundsCount: number;
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

function main(): void {
  mkdirSync(METRICS_DIR, { recursive: true });
  if (!existsSync(BASELINE_PATH)) {
    console.error('missing baselines at', BASELINE_PATH);
    process.exit(1);
  }
  const thresholds = loadThresholds();
  let failed = 0;
  const summary: Record<string, unknown> = {};

  console.log('asalmonsim accuracy harness\n');

  // Sanity: hard lies create measurable velocity deficits vs mid-channel
  {
    const probe = new CoreSim({ config: DEFAULT_CONFIG, headless: true, seed: 1 });
    const lie = probe.river.holdingLies[1]!;
    const mid = probe.river.current.sample(0, lie.position.y, lie.position.z);
    const inLie = probe.river.current.sample(lie.position.x, lie.position.y, lie.position.z);
    const midSp = mid.length();
    const lieSp = inLie.length();
    const ok = lieSp < midSp * 0.55;
    console.log(`[${ok ? 'PASS' : 'FAIL'}] lie_velocity_deficit`);
    console.log(
      `       mid-channel ${midSp.toFixed(3)} m/s vs lie(${lie.kind}) ${lieSp.toFixed(3)} m/s`,
    );
    if (!ok) failed += 1;
    summary.lie_velocity_deficit = { ok, midSp, lieSp, kind: lie.kind };
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
      default:
        checks = [{ ok: false, msg: `unknown scenario ${def.id}` }];
    }

    const ok = checks.every((c) => c.ok);
    if (!ok) failed += 1;
    const mark = ok ? 'PASS' : 'FAIL';
    console.log(`[${mark}] ${def.id}`);
    for (const c of checks) {
      console.log(`       ${c.ok ? '✓' : '✗'} ${c.msg}`);
    }
    console.log(
      `       dmg=${m.dmg.toFixed(2)} energy=${m.endEnergy.toFixed(2)} hold=${m.timeInHold.toFixed(1)}s lie=${m.timeInLie.toFixed(1)}s burst=${m.timeInBurst.toFixed(1)}s` +
        ` surfT=${m.timeAboveSurface.toFixed(2)}s pen(bank/bed/surf)=${m.bankPenetrationEvents}/${m.bedPenetrationEvents}/${m.surfaceBreachEvents}`,
    );

    summary[def.id] = { ok, metrics: m, checks };
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
