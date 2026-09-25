import * as THREE from 'three';
import type { RiverEnvironment } from '../env/River';
import type { Salmon } from '../fish/Salmon';

export interface SenseSnapshot {
  flow: THREE.Vector3;
  flowSpeed: number;
  shear: number;
  /** Cheap turbulence-intensity proxy (0 quiet → ~1 abrupt shear/wake). */
  turbulence: number;
  tempC: number;
  /** Mid-channel temperature at fish y,z (°C) — warm-core comparison. */
  midChannelTempC: number;
  /** Distance to nearest bank (m), accounting for body radius. */
  bankClearance: number;
  /** Distance above bed plane (m), accounting for body radius. */
  bedClearance: number;
  /** Distance below free surface (m), accounting for body radius. */
  surfaceClearance: number;
  /** Obstacle ahead (bank/end) proximity 0–1. */
  obstacleAhead: number;
  /** Vector toward nearest holding lie. */
  toHoldingLie: THREE.Vector3;
  holdingLieDist: number;
  /** Radius of nearest holding lie. */
  lieRadius: number;
  /** True if inside nearest lie ellipsoid (structure pocket). */
  inLie: boolean;
  /**
   * Local cool + low-V refuge direction from nearby probes
   * (bank/bed pockets TemperatureField + CurrentField already provide).
   */
  toRefuge: THREE.Vector3;
  /** Best probe score − current score (positive = better refuge nearby). */
  refugeAdvantage: number;
  /** Vector toward coolest / lowest-V holding lie (may differ from nearest). */
  toCoolLie: THREE.Vector3;
  coolLieDist: number;
  /** Local natal / olfactory cue concentration (0–1). */
  odor: number;
  /** Vector toward higher cue / natal source (zero when flat). */
  toHome: THREE.Vector3;
  /** Decision weight for homing (0 when flat / far). */
  odorStrength: number;
  energy: number;
  groundSpeed: number;
  /** Lateral position (m); sign used for bank avoidance toward centre. */
  lateralX: number;
  /** Ground velocity along +Z (upstream). Negative = downstream slip. */
  streamwiseGround: number;
}

/** Habitat score: cooler + quieter is better (higher = better). */
function habitatScore(tempC: number, flowSpeed: number): number {
  return -tempC * 1.15 - flowSpeed * 2.4;
}

/**
 * Sense flow, temperature, obstacles — feeds decision layer.
 * Flow speeds inside lies reflect real velocity deficits from CurrentField.
 * v1.9: local cool/low-V probes + coolest-lie vector for thermoregulatory refuge.
 * v1.10: natal / olfactory cue concentration + toHome vector.
 */
export function sense(fish: Salmon, river: RiverEnvironment): SenseSnapshot {
  const p = fish.position;
  const r = fish.bodyRadius;
  const flow = river.current.sample(p.x, p.y, p.z);
  const shear = river.current.shearMagnitude(p.x, p.y, p.z);
  const turbulence = river.current.turbulenceIntensity(p.x, p.y, p.z);
  const tempC = river.temperature.sample(p.x, p.y, p.z);
  const midChannelTempC = river.temperature.sample(0, p.y, p.z);
  const bankClearance = river.bankClearanceAt(p, r);
  const bedClearance = river.bedClearanceAt(p, r);
  const surfaceClearance = river.surfaceClearanceAt(p, r);

  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(fish.orientation);
  // Horizontal probe — vertical clearance is handled via bed/surfaceClearance, not obstacleAhead
  const ahead = p.clone().addScaledVector(forward, 2.5);
  ahead.y = p.y;
  const { bankHit, hit } = river.resolveCollision(ahead, 0.2);
  const endHit = hit && !bankHit && Math.abs(ahead.x) <= river.bankLimit(0.2) + 0.01;
  let obstacleAhead = bankHit || endHit ? 0.8 : 0;
  if (bankClearance < 1.2) obstacleAhead = Math.max(obstacleAhead, 1 - bankClearance / 1.2);

  const lie = river.nearestHoldingLie(p);
  const toHoldingLie = lie.position.clone().sub(p);
  const holdingLieDist = toHoldingLie.length();

  // --- v1.9 local cool / low-V refuge probes ---
  const hereScore = habitatScore(tempC, flow.length());
  const probeOffsets: Array<[number, number, number]> = [
    [1.6, -0.35, 0.2],
    [-1.6, -0.35, 0.2],
    [2.4, -0.55, 0.6],
    [-2.4, -0.55, 0.6],
    [0.0, -0.85, 0.0],
    [0.0, 0.55, 0.0],
    [1.1, -0.25, 1.4],
    [-1.1, -0.25, 1.4],
    [0.8, -0.5, -0.8],
    [-0.8, -0.5, -0.8],
  ];
  let bestScore = hereScore;
  const bestPos = p.clone();
  for (const [dx, dy, dz] of probeOffsets) {
    const x = p.x + dx;
    const y = THREE.MathUtils.clamp(p.y + dy, 0.35, 3.6);
    const z = p.z + dz;
    // Skip probes clearly outside banks
    if (Math.abs(x) > river.bankLimit(0.25) + 0.4) continue;
    const f = river.current.sample(x, y, z);
    const t = river.temperature.sample(x, y, z);
    const s = habitatScore(t, f.length());
    if (s > bestScore) {
      bestScore = s;
      bestPos.set(x, y, z);
    }
  }
  const toRefuge = bestPos.clone().sub(p);
  const refugeAdvantage = bestScore - hereScore;

  // Coolest / lowest-V holding lie (distance-penalized) for heat-biased seek
  let coolLie = river.holdingLies[0]!;
  let coolBest = -Infinity;
  for (const h of river.holdingLies) {
    const d = p.distanceTo(h.position);
    if (d > 36) continue;
    const lf = river.current.sample(h.position.x, h.position.y, h.position.z);
    const lt = river.temperature.sample(h.position.x, h.position.y, h.position.z);
    const s = habitatScore(lt, lf.length()) - d * 0.12;
    if (s > coolBest) {
      coolBest = s;
      coolLie = h;
    }
  }
  const toCoolLie = coolLie.position.clone().sub(p);
  const coolLieDist = toCoolLie.length();

  const flowSpeed = flow.length();
  const odor = river.odor.sample(p.x, p.y, p.z, flowSpeed);
  const toHome = river.odor.toHome(p.x, p.y, p.z);
  const odorStrength = river.odor.strength(p.x, p.y, p.z, flowSpeed);

  return {
    flow,
    flowSpeed,
    shear,
    turbulence,
    tempC,
    midChannelTempC,
    bankClearance,
    bedClearance,
    surfaceClearance,
    obstacleAhead,
    toHoldingLie,
    holdingLieDist,
    lieRadius: lie.radius,
    inLie: river.occupiesLie(p, lie),
    toRefuge,
    refugeAdvantage,
    toCoolLie,
    coolLieDist,
    odor,
    toHome,
    odorStrength,
    energy: fish.energy,
    groundSpeed: fish.groundSpeed,
    lateralX: p.x,
    streamwiseGround: fish.hydro.velocity.z,
  };
}
