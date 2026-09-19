import * as THREE from 'three';
import type { RiverEnvironment } from '../env/River';
import type { Salmon } from '../fish/Salmon';

export interface SenseSnapshot {
  flow: THREE.Vector3;
  flowSpeed: number;
  shear: number;
  tempC: number;
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
  energy: number;
  groundSpeed: number;
  /** Lateral position (m); sign used for bank avoidance toward centre. */
  lateralX: number;
  /** Ground velocity along +Z (upstream). Negative = downstream slip. */
  streamwiseGround: number;
}

/**
 * Sense flow, temperature, obstacles — feeds decision layer.
 * Flow speeds inside lies reflect real velocity deficits from CurrentField.
 */
export function sense(fish: Salmon, river: RiverEnvironment): SenseSnapshot {
  const p = fish.position;
  const r = fish.bodyRadius;
  const flow = river.current.sample(p.x, p.y, p.z);
  const shear = river.current.shearMagnitude(p.x, p.y, p.z);
  const tempC = river.temperature.sample(p.x, p.y, p.z);
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

  return {
    flow,
    flowSpeed: flow.length(),
    shear,
    tempC,
    bankClearance,
    bedClearance,
    surfaceClearance,
    obstacleAhead,
    toHoldingLie,
    holdingLieDist,
    lieRadius: lie.radius,
    inLie: river.occupiesLie(p, lie),
    energy: fish.energy,
    groundSpeed: fish.groundSpeed,
    lateralX: p.x,
    streamwiseGround: fish.hydro.velocity.z,
  };
}
