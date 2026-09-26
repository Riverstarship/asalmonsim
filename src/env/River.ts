import * as THREE from 'three';
import type { SimConfig } from '../config';
import { CurrentField, type LiePocket } from './CurrentField';
import { TemperatureField } from './Temperature';
import { OdorField, type OdorMode } from './OdorField';
import { getEnvPack, type EnvPack } from './packs';
import { createRiverMaps } from './RiverTextures';

export interface HoldingLie {
  position: THREE.Vector3;
  radius: number;
  kind: LiePocket['kind'];
  deficit: number;
}

export interface RiverOptions {
  /** Build Three.js corridor mesh (browser). Default true. */
  visual?: boolean;
  /** Natal cue field mode (v1.10). Default 'natal'. */
  odorMode?: OdorMode;
  /** Habitat env-pack id or pack object (v1.11). Default synthetic_ascent_v1. */
  envPack?: string | EnvPack;
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
 * Geometry + lies come from a portable EnvPack (v1.11).
 */
export class RiverEnvironment {
  readonly group = new THREE.Group();
  readonly current: CurrentField;
  readonly temperature: TemperatureField;
  readonly odor: OdorField;
  readonly holdingLies: HoldingLie[];
  /** Active habitat pack (v1.11). */
  readonly pack: EnvPack;
  readonly length: number;
  readonly width: number;
  readonly depth: number;

  constructor(cfg: SimConfig, opts: RiverOptions = {}) {
    const visual = opts.visual !== false;
    this.pack =
      typeof opts.envPack === 'object' && opts.envPack !== null
        ? opts.envPack
        : getEnvPack(opts.envPack ?? cfg.envPackId);
    this.length = this.pack.length;
    this.width = this.pack.width;
    this.depth = this.pack.depth;

    this.holdingLies = this.pack.lies.map((h) => ({
      position: new THREE.Vector3(h.x, h.y, h.z),
      radius: h.radius,
      kind: h.kind,
      deficit: h.deficit,
    }));

    const pockets: LiePocket[] = this.holdingLies.map((h) => ({
      x: h.position.x,
      y: h.position.y,
      z: h.position.z,
      radius: h.radius,
      deficit: h.deficit,
      kind: h.kind,
    }));

    this.current = CurrentField.fromPack(cfg, this.pack, pockets);
    this.temperature = new TemperatureField(cfg, {
      width: this.width,
      depth: this.depth,
    });
    this.odor = new OdorField({
      mode: opts.odorMode ?? 'natal',
      source: this.pack.odorSource,
      length: this.length,
    });
    if (visual) this.buildMesh();
  }

  private buildMesh(): void {
    const L = this.length;
    const W = this.width;
    const D = this.depth;
    const maps = createRiverMaps();
    this.group.userData.riverMaps = maps;

    // Slightly denser bed for gravel read; still modest for mobile
    const bedGeo = new THREE.PlaneGeometry(W + 4, L, 32, 64);
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
      map: maps.bedAlbedo,
      roughnessMap: maps.bedRoughness,
      color: 0xffffff,
      roughness: 0.9,
      metalness: 0.04,
    });
    const bed = new THREE.Mesh(bedGeo, bedMat);
    bed.position.set(0, 0, L * 0.5);
    bed.receiveShadow = true;
    this.group.add(bed);

    const bankMat = new THREE.MeshStandardMaterial({
      map: maps.bankAlbedo,
      color: 0xffffff,
      roughness: 0.94,
      metalness: 0.02,
    });
    for (const side of [-1, 1]) {
      const bank = new THREE.Mesh(new THREE.BoxGeometry(1.5, D + 1, L), bankMat);
      bank.position.set(side * (W * 0.5 + 0.4), D * 0.35, L * 0.5);
      bank.receiveShadow = true;
      bank.castShadow = true;
      this.group.add(bank);
    }

    // Water: normal + soft foam, no expensive transmission (mobile-friendly)
    const waterGeo = new THREE.PlaneGeometry(W * 0.98, L, 8, 24);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a5570,
      transparent: true,
      opacity: 0.38,
      roughness: 0.22,
      metalness: 0.05,
      clearcoat: 0.55,
      clearcoatRoughness: 0.28,
      normalMap: maps.waterNormal,
      normalScale: new THREE.Vector2(0.45, 0.45),
      emissive: new THREE.Color(0x0a2030),
      emissiveMap: maps.waterFoam,
      emissiveIntensity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.position.set(0, D * 0.95, L * 0.5);
    water.renderOrder = 2;
    this.group.add(water);
    this.group.userData.waterMat = waterMat;

    for (const lie of this.holdingLies) {
      const color =
        lie.kind === 'pool' ? 0x2a6a7a : lie.kind === 'boulder_wake' ? 0x3a5a6a : 0x2a5a5a;
      const lieMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.22,
      });
      const m = new THREE.Mesh(new THREE.SphereGeometry(lie.radius * 0.55, 12, 8), lieMat);
      m.position.copy(lie.position);
      this.group.add(m);
    }
  }

  /** Optional: scroll water normals slowly (called from Simulation frame). */
  scrollWater(dt: number): void {
    const maps = this.group.userData.riverMaps as { waterNormal?: THREE.Texture; waterFoam?: THREE.Texture } | undefined;
    if (!maps?.waterNormal) return;
    maps.waterNormal.offset.y = (maps.waterNormal.offset.y + dt * 0.035) % 1;
    if (maps.waterFoam) {
      maps.waterFoam.offset.y = (maps.waterFoam.offset.y + dt * 0.02) % 1;
    }
  }

  /** Nominal bed elevation under the fish (flat collision bed). */
  bedElevation(_x: number, _z: number): number {
    return 0.25;
  }

  /** Free-surface elevation (m). */
  surfaceElevation(): number {
    return this.depth - 0.15;
  }

  /** Lateral half-width usable by fish center given body radius. */
  bankLimit(radius: number): number {
    return this.width * 0.5 - radius - 0.35;
  }

  bedClearanceAt(position: THREE.Vector3, radius: number): number {
    return position.y - this.bedElevation(position.x, position.z) - radius;
  }

  surfaceClearanceAt(position: THREE.Vector3, radius: number): number {
    return this.surfaceElevation() - radius - position.y;
  }

  bankClearanceAt(position: THREE.Vector3, radius: number): number {
    return this.bankLimit(radius) - Math.abs(position.x);
  }

  resolveCollision(position: THREE.Vector3, radius: number): CollisionResult {
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
    if (position.z > this.length - 2) {
      correction.z += this.length - 2 - position.z;
      normal.z -= 1;
      hit = true;
    }

    if (normal.lengthSq() > 0) normal.normalize();
    return { correction, normal, hit, bedHit, bankHit, surfaceHit };
  }

  clampIntoFreeWater(position: THREE.Vector3, margin = 0.25): THREE.Vector3 {
    const minY = this.bedElevation(position.x, position.z) + margin;
    const maxY = this.surfaceElevation() - margin;
    const maxX = this.bankLimit(margin);
    position.x = THREE.MathUtils.clamp(position.x, -maxX, maxX);
    position.y = THREE.MathUtils.clamp(position.y, minY, maxY);
    position.z = THREE.MathUtils.clamp(position.z, 2 + margin, this.length - 2 - margin);
    return position;
  }

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
