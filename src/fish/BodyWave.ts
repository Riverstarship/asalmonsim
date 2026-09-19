import { MathUtils } from 'three';
import { FISH_LENGTH_M } from '../config';

/**
 * Carangiform / subcarangiform traveling-wave envelope for adult salmon.
 * Driven by outer-loop locomotion intensity / mode — not muscle FEM.
 *
 * Lateral displacement: y(s,t) = A·E(s)·sin(k·s − ωt)
 * where s ∈ [0,1] is fractional station (snout → caudal tip) and E(s)
 * grows toward the peduncle (carangiform).
 */
export class BodyWave {
  /** Sim time (s). */
  time = 0;
  /** Traveling-wave phase (rad). */
  phase = 0;
  /** Peak caudal amplitude (m). */
  amplitude = 0.02;
  /** Angular frequency ω (rad/s). */
  omega = 8;
  /** Wave number k along body (rad per body-length fraction). */
  waveNumber = 2.4 * Math.PI;
  /** Last drive intensity 0–1. */
  intensity = 0;
  mode = 'cruise';

  /** Dimensionless wave-power proxy ∝ (A/Aref)²(ω/ωref)² — drives thrust. */
  wavePower = 0;
  /** Instantaneous caudal lateral displacement (m). */
  caudalLateral = 0;
  /** Instantaneous caudal lateral velocity (m/s). */
  caudalLatVel = 0;
  /** Peduncle slope proxy used as caudal fin angle (rad). */
  caudalAngle = 0;

  private static readonly A_REF = 0.05;
  private static readonly OMEGA_REF = 12;

  /**
   * Advance wave from thrust demand + gait mode.
   * Hold → low amp/freq; cruise → aerobic undulation; burst → elevated.
   */
  update(dt: number, intensity: number, mode: string): void {
    this.intensity = MathUtils.clamp(intensity, 0, 1);
    this.mode = mode;

    const modeAmp =
      mode === 'burst' ? 1.35 : mode === 'hold' ? 0.22 : mode === 'seek_hold' ? 0.65 : 1;
    const modeOmega =
      mode === 'burst' ? 1.3 : mode === 'hold' ? 0.45 : mode === 'seek_hold' ? 0.75 : 1;

    const i = this.intensity;
    // Peak caudal amp ~0.8–6 cm; hold stays nearly stiff
    const ampTarget = (0.005 + i * 0.048) * modeAmp;
    const omegaTarget = (5 + i * 11) * modeOmega;

    const blend = Math.min(1, dt * 7);
    this.amplitude += (ampTarget - this.amplitude) * blend;
    this.omega += (omegaTarget - this.omega) * blend;

    this.time += dt;
    this.phase += this.omega * dt;
    // Keep phase bounded for numeric comfort
    if (this.phase > Math.PI * 1e4) this.phase %= Math.PI * 2;

    this.caudalLateral = this.lateral(1);
    this.caudalLatVel = this.lateralVel(1);
    // Fin angle ≈ local slope near peduncle
    const ds = 0.12;
    const dy = this.lateral(1) - this.lateral(1 - ds);
    this.caudalAngle = Math.atan2(dy, ds * FISH_LENGTH_M);

    const aN = this.amplitude / BodyWave.A_REF;
    const wN = this.omega / BodyWave.OMEGA_REF;
    this.wavePower = aN * aN * wN * wN;
  }

  /**
   * Carangiform envelope E(s): small at snout, large at caudal.
   * Normalized so E(1) = 1.
   */
  envelope(s: number): number {
    const u = MathUtils.clamp(s, 0, 1);
    // 0.05 + 0.2 s + 0.75 s² → E(1)=1
    return 0.05 + 0.2 * u + 0.75 * u * u;
  }

  /** Lateral displacement (m) at fractional station s. */
  lateral(s: number): number {
    const A = this.amplitude * this.envelope(s);
    return A * Math.sin(this.waveNumber * s - this.phase);
  }

  /** Lateral velocity (m/s) at fractional station s. */
  lateralVel(s: number): number {
    const A = this.amplitude * this.envelope(s);
    return -A * this.omega * Math.cos(this.waveNumber * s - this.phase);
  }

  /** Frequency in Hz (harness / HUD). */
  get frequencyHz(): number {
    return this.omega / (Math.PI * 2);
  }
}
