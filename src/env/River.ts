import * as THREE from 'three';
import { RIVER } from '../config';
import { CurrentField } from './CurrentField';
import { TemperatureField } from './Temperature';
import type { SimConfig } from '../config';

export interface HoldingLie {
  position: THREE.Vector3;
  radius: number;
}

/**
 * Visual + spatial river corridor and environment fields.
 */
export class RiverEnvironment {
  readonly group = new THREE.Group();
  readonly current: CurrentField;
  readonly temperature: TemperatureField;
  readonly holdingLies: HoldingLie[];

  constructor(cfg: SimConfig) {
    this.current = new CurrentField(cfg);
    this.temperature = new TemperatureField(cfg);
    this.holdingLies = [
      { position: new THREE.Vector3(-3.2, 0.6, 18), radius: 1.8 },
      { position: new THREE.Vector3(3.8, 0.7, 35), radius: 2.0 },
      { position: new THREE.Vector3(-2.5, 0.5, 52), radius: 1.6 },
      { position: new THREE.Vector3(2.8, 0.65, 68), radius: 1.9 },
    ];
    this.buildMesh();
  }

  private buildMesh(): void {
    const L = RIVER.length;
    const W = RIVER.width;
    const D = RIVER.depth;

    // Bed
    const bedGeo = new THREE.PlaneGeometry(W + 4, L, 24, 48);
    bedGeo.rotateX(-Math.PI / 2);
    // Gentle undulation
    const pos = bedGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h =
        Math.sin(z * 0.15) * 0.15 +
        Math.sin(x * 0.8 + z * 0.1) * 0.08 +
        (Math.abs(x) / (W * 0.5)) * 0.25;
      pos.setY(i, h);
    }
    pos.needsUpdate = true;
    bedGeo.computeVertexNormals();
    const bedMat = new THREE.MeshStandardMaterial({
      color: 0x3a4a38,
      roughness: 0.92,
      metalness: 0.05,
    });
    const bed = new THREE.Mesh(bedGeo, bedMat);
    bed.position.set(0, 0, L * 0.5);
    bed.receiveShadow = true;
    this.group.add(bed);

    // Banks
    const bankMat = new THREE.MeshStandardMaterial({
      color: 0x4a5a3a,
      roughness: 0.95,
      metalness: 0.02,
    });
    for (const side of [-1, 1]) {
      const bank = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, D + 1, L),
        bankMat,
      );
      bank.position.set(side * (W * 0.5 + 0.4), D * 0.35, L * 0.5);
      bank.receiveShadow = true;
      bank.castShadow = true;
      this.group.add(bank);
    }

    // Water surface (semi-transparent)
    const waterGeo = new THREE.PlaneGeometry(W, L, 1, 1);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a4a5a,
      transparent: true,
      opacity: 0.35,
      roughness: 0.15,
      metalness: 0.1,
      transmission: 0.4,
      thickness: 1.5,
      side: THREE.DoubleSide,
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.position.set(0, D * 0.95, L * 0.5);
    this.group.add(water);

    // Holding lie markers (subtle)
    const lieMat = new THREE.MeshBasicMaterial({
      color: 0x2a6a7a,
      transparent: true,
      opacity: 0.25,
    });
    for (const lie of this.holdingLies) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(lie.radius * 0.6, 12, 8), lieMat);
      m.position.copy(lie.position);
      this.group.add(m);
    }
  }

  /** Clamp / collide against bed and banks. Returns penetration correction. */
  resolveCollision(
    position: THREE.Vector3,
    radius: number,
  ): { correction: THREE.Vector3; normal: THREE.Vector3; hit: boolean } {
    const correction = new THREE.Vector3();
    const normal = new THREE.Vector3();
    let hit = false;
    const halfW = RIVER.width * 0.5;
    const minY = 0.25 + radius;
    const maxY = RIVER.depth - radius - 0.15;

    if (position.y < minY) {
      correction.y += minY - position.y;
      normal.y += 1;
      hit = true;
    }
    if (position.y > maxY) {
      correction.y += maxY - position.y;
      normal.y -= 1;
      hit = true;
    }
    const maxX = halfW - radius - 0.3;
    if (position.x > maxX) {
      correction.x += maxX - position.x;
      normal.x -= 1;
      hit = true;
    }
    if (position.x < -maxX) {
      correction.x += -maxX - position.x;
      normal.x += 1;
      hit = true;
    }
    // Soft wrap along corridor length (keep in view)
    if (position.z < 2) {
      correction.z += 2 - position.z;
      hit = true;
    }
    if (position.z > RIVER.length - 2) {
      correction.z += RIVER.length - 2 - position.z;
      // Allow soft stop near upstream end rather than bounce hard
    }

    if (normal.lengthSq() > 0) normal.normalize();
    return { correction, normal, hit };
  }

  nearestHoldingLie(pos: THREE.Vector3): HoldingLie {
    let best = this.holdingLies[0]!;
    let bestD = Infinity;
    for (const lie of this.holdingLies) {
      const d = pos.distanceTo(lie.position);
      if (d < bestD) {
        bestD = d;
        best = lie;
      }
    }
    return best;
  }
}
