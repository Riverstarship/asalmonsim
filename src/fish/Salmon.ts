import * as THREE from 'three';
import { FinController } from './Fins';
import { createSalmonMesh } from './Mesh';
import { Hydrodynamics, type SwimCommand } from './Hydrodynamics';
import type { RiverEnvironment } from '../env/River';
import type { DecisionOutput } from '../ai/DecisionLayer';

/** Layer 1 = fish body (hidden from fish-eye camera). */
export const FISH_LAYER = 1;

export interface SalmonOptions {
  /** Build visual mesh. Default true; false for headless Node runs. */
  visual?: boolean;
}

export class Salmon {
  readonly group: THREE.Group;
  readonly fins: FinController;
  readonly hydro = new Hydrodynamics();
  readonly position: THREE.Vector3;
  readonly orientation = new THREE.Quaternion();

  /** Last collision flags (for harness / HUD diagnostics). */
  lastBedHit = false;
  lastBankHit = false;
  lastSurfaceHit = false;

  private readonly cmd: SwimCommand = {
    thrustLevel: 0.3,
    pitch: 0,
    yaw: 0,
    roll: 0,
  };

  mode = 'cruise';
  energy = 1;
  /** Collision body radius (m). */
  readonly bodyRadius = 0.15;

  constructor(start: THREE.Vector3, opts: SalmonOptions = {}) {
    this.fins = new FinController();
    const visual = opts.visual !== false;
    this.group = visual ? createSalmonMesh(this.fins) : new THREE.Group();
    this.position = start.clone();
    this.group.position.copy(this.position);
    // Face upstream (+Z)
    this.orientation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0);

    // Hide body from fish-eye (camera layer 0 only); follow cam enables layer 1
    this.group.traverse((obj) => {
      obj.layers.set(FISH_LAYER);
    });
  }

  applyDecision(decision: DecisionOutput): void {
    this.mode = decision.mode;
    this.cmd.thrustLevel = decision.thrustLevel;
    this.cmd.pitch = decision.pitch;
    this.cmd.yaw = decision.yaw;
    this.cmd.roll = decision.roll;
    this.energy = decision.energy;
  }

  update(dt: number, river: RiverEnvironment): void {
    const water = river.current.sample(
      this.position.x,
      this.position.y,
      this.position.z,
    );

    const forces = this.hydro.computeForces(
      this.orientation,
      water,
      this.cmd,
      this.fins.caudalAngle,
    );

    this.hydro.integrate(dt, forces, this.orientation, this.position);

    const { correction, normal, hit, bedHit, bankHit, surfaceHit } =
      river.resolveCollision(this.position, this.bodyRadius);
    this.lastBedHit = bedHit;
    this.lastBankHit = bankHit;
    this.lastSurfaceHit = surfaceHit;
    if (hit) {
      this.position.add(correction);
      if (normal.lengthSq() > 0) this.hydro.collide(normal);
    }

    const intensity = this.cmd.thrustLevel;
    this.fins.update(dt, intensity, this.hydro.angularVelocity.y, this.mode);

    this.group.position.copy(this.position);
    this.group.quaternion.copy(this.orientation);
  }

  /** Ground-relative speed (m/s). */
  get groundSpeed(): number {
    return this.hydro.velocity.length();
  }

  /** Speed through water. */
  speedThroughWater(river: RiverEnvironment): number {
    const w = river.current.sample(this.position.x, this.position.y, this.position.z);
    return this.hydro.velocity.clone().sub(w).length();
  }
}
