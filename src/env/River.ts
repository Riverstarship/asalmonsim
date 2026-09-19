import * as THREE from 'three';
import { RIVER } from '../config';
import { CurrentField, type LiePocket } from './CurrentField';
import { TemperatureField } from './Temperature';
import type { SimConfig } from '../config';

export interface HoldingLie {
  position: THREE.Vector3;
  radius: number;
  kind: LiePocket['kind'];
  deficit: number;
}

export interface RiverOptions {
  /** Build Three.js corridor mesh (browser). Default true. */
  visual?: boolean;
}

export interface CollisionResult {
  correction: THREE.Vector3;
  normal: THREE.Vector3;
  hit: boolean;
  /** True if center was below bed plane (before push-out). */
  bedHit: boolean;
  /** True if center was past a bank (before push-out). */
  bankHit: boolean;
  /** True if center was at/above free surface (before push-out). */
  surfaceHit: boolean;
}

/**
 * Spatial river corridor and environment fields.
 * Visual mesh is optional so Node accuracy runs stay headless.
 */
export class RiverEnvironment {
  readonly group = new THREE.Group();
  readonly current: CurrentField;
  readonly temperature: TemperatureField;
  readonly holdingLies: HoldingLie[];

  constructor(cfg: SimConfig, opts: RiverOptions = {}) {
    const visual = opts.visual !== false;

    // Discrete hard holding lies: pools, bank scallops, stub boulder wakes
    this.holdingLies = [
      {
        position: new THREE.Vector3(-2.4, 1.65, 18),
        radius: 2.2,
        kind: 'bank_scallop',
        deficit: 0.72,
      },
      {
        position: new THREE.Vector3(2.5, 1.7, 35),
        radius: 2.3,
        kind: 'boulder_wake',
        deficit: 0.78,
      },
      {
        position: new THREE.Vector3(-2.0, 1.6, 52),
        radius: 2.1,
        kind: 'pool',
        deficit: 0.65,
      },
      {
        position: new THREE.Vector3(2.2, 1.7, 68),
        radius: 2.2,
        kind: 'boulder_wake',
        deficit: 0.75,
      },
      {
        position: new THREE.Vector3(0.2, 1.6, 12),
        radius: 2.0,
        kind: 'pool',
        deficit: 0.6,
      },
    ];

    const pockets: LiePocket[] = this.holdingLies.map((h) => ({
      x: h.position.x,
      y: h.position.y,
      z: h.position.z,
      radius: h.radius,
      deficit: h.deficit,
      kind: h.kind,
    }));

    this.current = new CurrentField(cfg, pockets);
    this.temperature = new TemperatureField(cfg);
    if (visual) this.buildMesh();
  }

  private buildMesh(): void {
    const L = RIVER.length;
    const W = RIVER.width;
    const D = RIVER.depth;

    // Bed
    const bedGeo = new THREE.PlaneGeometry(W + 4, L, 24, 48);
    bedGeo.rotateX(-Math.PI / 2);
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
      const bank = new THREE.Mesh(new THREE.BoxGeometry(1.5, D + 1, L), bankMat);
      bank.position.set(side * (W * 0.5 + 0.4), D * 0.35, L * 0.5);
      bank.receiveShadow = true;
      bank.castShadow = true;
      this.group.add(bank);
    }

    // Water surface
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

    // Holding lie markers (subtle) — tint by kind
    for (const lie of this.holdingLies) {
      const color =
        lie.kind === 'pool' ? 0x2a6a7a : lie.kind === 'boulder_wake' ? 0x3a5a6a : 0x2a5a5a;
      const lieMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.28,
      });
      const m = new THREE.Mesh(new THREE.SphereGeometry(lie.radius * 0.55, 12, 8), lieMat);
      m.position.copy(lie.position);
      this.group.add(m);
    }
  }

  /** Nominal bed elevation under the fish (flat collision bed). */
  bedElevation(_x: number, _z: number): number {
    return 0.25;
  }

  /** Free-surface elevation (m). */
  surfaceElevation(): number {
    return RIVER.depth - 0.15;
  }

  /** Lateral half-width usable by fish center given body radius. */
  bankLimit(radius: number): number {
    return RIVER.width * 0.5 - radius - 0.35;
  }

  /** Clearance above bed plane (m). */
  bedClearanceAt(position: THREE.Vector3, radius: number): number {
    return position.y - this.bedElevation(position.x, position.z) - radius;
  }

  /** Clearance below free surface (m). */
  surfaceClearanceAt(position: THREE.Vector3, radius: number): number {
    return this.surfaceElevation() - radius - position.y;
  }

  /** Clearance to nearest bank (m). */
  bankClearanceAt(position: THREE.Vector3, radius: number): number {
    return this.bankLimit(radius) - Math.abs(position.x);
  }

  /**
   * Hard containment against bed, banks, and free surface.
   * Push-out + unit normals for killing inward velocity.
   */
  resolveCollision(
    position: THREE.Vector3,
    radius: number,
  ): CollisionResult {
    const correction = new THREE.Vector3();
    const normal = new THREE.Vector3();
    let hit = false;
    let bedHit = false;
    let bankHit = false;
    let surfaceHit = false;

    const minY = this.bedElevation(position.x, position.z) + radius;
    const maxY = this.surfaceElevation() - radius;
    const maxX = this.bankLimit(radius);

    if (position.y < minY) {
      correction.y += minY - position.y;
      normal.y += 1;
      hit = true;
      bedHit = true;
    }
    if (position.y > maxY) {
      correction.y += maxY - position.y;
      normal.y -= 1;
      hit = true;
      surfaceHit = true;
    }
    if (position.x > maxX) {
      correction.x += maxX - position.x;
      normal.x -= 1;
      hit = true;
      bankHit = true;
    }
    if (position.x < -maxX) {
      correction.x += -maxX - position.x;
      normal.x += 1;
      hit = true;
      bankHit = true;
    }
    if (position.z < 2) {
      correction.z += 2 - position.z;
      normal.z += 1;
      hit = true;
    }
    if (position.z > RIVER.length - 2) {
      correction.z += RIVER.length - 2 - position.z;
      normal.z -= 1;
      hit = true;
    }

    if (normal.lengthSq() > 0) normal.normalize();
    return { correction, normal, hit, bedHit, bankHit, surfaceHit };
  }

  /**
   * Clamp a world point into the free-water volume (inside bed / banks / surface).
   * Used by fish-eye POV so the camera cannot embed in geometry.
   */
  clampIntoFreeWater(position: THREE.Vector3, margin = 0.25): THREE.Vector3 {
    const minY = this.bedElevation(position.x, position.z) + margin;
    const maxY = this.surfaceElevation() - margin;
    const maxX = this.bankLimit(margin);
    position.x = THREE.MathUtils.clamp(position.x, -maxX, maxX);
    position.y = THREE.MathUtils.clamp(position.y, minY, maxY);
    position.z = THREE.MathUtils.clamp(position.z, 2 + margin, RIVER.length - 2 - margin);
    return position;
  }

  /**
   * Ellipsoid occupancy: vertical axis stretched so mid-column fish can
   * still "use" a structure pocket without hugging the bed.
   */
  occupiesLie(pos: THREE.Vector3, lie: HoldingLie, scale = 1.15): boolean {
    const dx = (pos.x - lie.position.x) / lie.radius;
    const dy = (pos.y - lie.position.y) / (lie.radius * 1.35);
    const dz = (pos.z - lie.position.z) / lie.radius;
    return dx * dx + dy * dy + dz * dz <= scale * scale;
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
