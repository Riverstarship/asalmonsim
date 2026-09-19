import * as THREE from 'three';
import type { RiverEnvironment } from '../env/River';
import type { Salmon } from '../fish/Salmon';

export interface SenseSnapshot {
  flow: THREE.Vector3;
  flowSpeed: number;
  shear: number;
  tempC: number;
  /** Distance to nearest bank (approx). */
  bankClearance: number;
  /** Distance to bed. */
  bedClearance: number;
  /** Obstacle ahead (bank/end) proximity 0–1. */
  obstacleAhead: number;
  /** Vector toward nearest holding lie. */
  toHoldingLie: THREE.Vector3;
  holdingLieDist: number;
  /** Radius of nearest holding lie. */
  lieRadius: number;
  energy: number;
  groundSpeed: number;
}

/**
 * Sense flow, temperature, obstacles — feeds decision layer.
 * Flow speeds inside lies reflect real velocity deficits from CurrentField.
 */
export function sense(fish: Salmon, river: RiverEnvironment): SenseSnapshot {
  const p = fish.position;
  const flow = river.current.sample(p.x, p.y, p.z);
  const shear = river.current.shearMagnitude(p.x, p.y, p.z);
  const tempC = river.temperature.sample(p.x, p.y, p.z);
  const halfW = 6;
  const bankClearance = halfW - Math.abs(p.x);
  const bedClearance = p.y;

  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(fish.orientation);
  const ahead = p.clone().addScaledVector(forward, 2.5);
  const { hit } = river.resolveCollision(ahead, 0.2);
  let obstacleAhead = hit ? 0.8 : 0;
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
    obstacleAhead,
    toHoldingLie,
    holdingLieDist,
    lieRadius: lie.radius,
    energy: fish.energy,
    groundSpeed: fish.groundSpeed,
  };
}
