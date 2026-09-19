import * as THREE from 'three';
import type { BodyWave } from './BodyWave';

export type FinId = 'caudal' | 'dorsal' | 'pectoralL' | 'pectoralR' | 'pelvicL' | 'pelvicR' | 'anal';

export interface FinState {
  id: FinId;
  /** Current flap angle (rad). */
  angle: number;
  /** Target amplitude (rad). */
  amplitude: number;
  /** Phase offset (rad). */
  phase: number;
  /** Angular frequency (rad/s). */
  omega: number;
  /** Soft constraint: max amplitude. */
  maxAmplitude: number;
  mesh: THREE.Object3D | null;
}

/**
 * Wired fins with amplitude/phase constraints.
 * v1.7: caudal amp/phase locked to body traveling wave; pectorals mostly visual / light.
 */
export class FinController {
  readonly fins: Record<FinId, FinState>;
  private time = 0;

  constructor() {
    this.fins = {
      caudal: this.make('caudal', 0.35, 0, 12, 0.55),
      dorsal: this.make('dorsal', 0.08, 0.4, 6, 0.15),
      pectoralL: this.make('pectoralL', 0.2, 0, 4, 0.4),
      pectoralR: this.make('pectoralR', 0.2, Math.PI, 4, 0.4),
      pelvicL: this.make('pelvicL', 0.12, 0.2, 3.5, 0.25),
      pelvicR: this.make('pelvicR', 0.12, Math.PI + 0.2, 3.5, 0.25),
      anal: this.make('anal', 0.1, 0.6, 5, 0.2),
    };
  }

  private make(
    id: FinId,
    amplitude: number,
    phase: number,
    omega: number,
    maxAmplitude: number,
  ): FinState {
    return { id, angle: 0, amplitude, phase, omega, maxAmplitude, mesh: null };
  }

  bindMesh(id: FinId, mesh: THREE.Object3D): void {
    this.fins[id].mesh = mesh;
  }

  /**
   * Drive fin animation from locomotion intensity, yaw rate, and body wave.
   * Caudal follows wave; pectorals active when holding / turning (visual/light).
   */
  update(
    dt: number,
    intensity: number,
    yawRate: number,
    mode: string,
    wave?: BodyWave,
  ): void {
    this.time += dt;
    const burst = mode === 'burst' ? 1.4 : mode === 'hold' ? 0.35 : 1;

    const caudal = this.fins.caudal;
    if (wave) {
      // Phase-lock caudal to traveling-wave peduncle slope
      const ampFromWave = THREE.MathUtils.clamp(
        Math.abs(wave.amplitude) * 12 + 0.04,
        0.04,
        caudal.maxAmplitude,
      );
      caudal.amplitude = ampFromWave;
      caudal.omega = wave.omega;
      caudal.angle = THREE.MathUtils.clamp(
        wave.caudalAngle,
        -caudal.maxAmplitude,
        caudal.maxAmplitude,
      );
      this.applyPose(caudal);
    } else {
      caudal.amplitude = THREE.MathUtils.clamp(
        0.12 + intensity * 0.35 * burst,
        0.05,
        caudal.maxAmplitude,
      );
      caudal.omega = 8 + intensity * 10 * burst;
      caudal.angle = Math.sin(this.time * caudal.omega + caudal.phase) * caudal.amplitude;
      this.applyPose(caudal);
    }

    // Pectorals active when holding / turning (mostly visual / light)
    const pecAmp =
      mode === 'hold'
        ? 0.28
        : 0.08 + Math.min(0.2, Math.abs(yawRate) * 0.5);
    this.fins.pectoralL.amplitude = Math.min(pecAmp, this.fins.pectoralL.maxAmplitude);
    this.fins.pectoralR.amplitude = Math.min(pecAmp, this.fins.pectoralR.maxAmplitude);
    this.fins.pectoralL.omega = mode === 'hold' ? 5 : 3.5;
    this.fins.pectoralR.omega = this.fins.pectoralL.omega;

    for (const fin of Object.values(this.fins)) {
      if (fin.id === 'caudal') continue;
      if (!fin.id.startsWith('pectoral')) {
        fin.amplitude = THREE.MathUtils.clamp(
          fin.maxAmplitude * (0.3 + intensity * 0.5),
          0.02,
          fin.maxAmplitude,
        );
      }
      fin.angle = Math.sin(this.time * fin.omega + fin.phase) * fin.amplitude;
      this.applyPose(fin);
    }
  }

  private applyPose(fin: FinState): void {
    if (!fin.mesh) return;
    switch (fin.id) {
      case 'caudal':
        fin.mesh.rotation.y = fin.angle;
        break;
      case 'dorsal':
        fin.mesh.rotation.z = fin.angle * 0.5;
        break;
      case 'anal':
        fin.mesh.rotation.z = -fin.angle * 0.5;
        break;
      case 'pectoralL':
        fin.mesh.rotation.z = 0.4 + fin.angle;
        fin.mesh.rotation.y = fin.angle * 0.3;
        break;
      case 'pectoralR':
        fin.mesh.rotation.z = -0.4 + fin.angle;
        fin.mesh.rotation.y = fin.angle * 0.3;
        break;
      case 'pelvicL':
        fin.mesh.rotation.z = 0.25 + fin.angle;
        break;
      case 'pelvicR':
        fin.mesh.rotation.z = -0.25 + fin.angle;
        break;
    }
  }

  /** Instantaneous caudal lateral angle (wave-coupled when available). */
  get caudalAngle(): number {
    return this.fins.caudal.angle;
  }
}
