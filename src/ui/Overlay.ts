export interface HudState {
  mode: string;
  rationale: string;
  energy: number;
  groundSpeed: number;
  waterSpeed: number;
  flowSpeed: number;
  tempC: number;
  cameraMode: string;
  season: string;
  location: string;
  dmg: number;
  timeInLie: number;
  /** Optional habitat pack name (v1.11). */
  pack?: string;
}

/**
 * Title + toggleable info/HUD card. Accuracy lives in ACCURACY.md / harness / chat only.
 * Chrome stack: controls row then HUD underneath so the panel never draws over buttons.
 */
export class Overlay {
  readonly root: HTMLDivElement;
  /** Left chrome column — Controls mounts here above the HUD. */
  readonly chrome: HTMLDivElement;
  private hudEl: HTMLDivElement;
  private hudVisible = true;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'ui-root';
    parent.appendChild(this.root);

    const title = document.createElement('div');
    title.id = 'title-bar';
    title.innerHTML =
      '<h1>Atlantic Salmon Migration Sim</h1><p>Observational · Salmo salar adult ascent</p>';
    this.root.appendChild(title);

    this.chrome = document.createElement('div');
    this.chrome.id = 'ui-chrome';
    this.root.appendChild(this.chrome);

    this.hudEl = document.createElement('div');
    this.hudEl.id = 'hud';
    this.hudEl.className = 'panel';
    // HUD appended in sealChrome() after Controls so it sits under the button row
  }

  /** Append HUD under the controls row (call after Controls mounts into chrome). */
  sealChrome(): void {
    if (!this.hudEl.parentElement) {
      this.chrome.appendChild(this.hudEl);
    }
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches) {
      this.setHudVisible(false);
    }
  }

  setHudVisible(visible: boolean): void {
    this.hudVisible = visible;
    this.hudEl.classList.toggle('hidden', !visible);
    this.hudEl.setAttribute('aria-hidden', visible ? 'false' : 'true');
  }

  toggleHud(): boolean {
    this.setHudVisible(!this.hudVisible);
    return this.hudVisible;
  }

  isHudVisible(): boolean {
    return this.hudVisible;
  }

  updateHud(s: HudState): void {
    if (!this.hudVisible) return;
    this.hudEl.innerHTML = `
      <div class="label">Behavior</div>
      <div class="value">${escapeHtml(s.mode)} — ${escapeHtml(s.rationale)}</div>
      <div class="label">Energy</div>
      <div class="value">${(s.energy * 100).toFixed(0)}%</div>
      <div class="label">DMG (upstream) · time-in-lie</div>
      <div class="value">${s.dmg.toFixed(1)} m · ${s.timeInLie.toFixed(1)} s</div>
      <div class="label">Ground / through-water / flow</div>
      <div class="value">${s.groundSpeed.toFixed(2)} / ${s.waterSpeed.toFixed(2)} / ${s.flowSpeed.toFixed(2)} m/s</div>
      <div class="label">Temp</div>
      <div class="value">${s.tempC.toFixed(1)} °C</div>
      <div class="label">Camera · Season · Site${s.pack ? ' · Pack' : ''}</div>
      <div class="value">${escapeHtml(s.cameraMode)} · ${escapeHtml(s.season)} · ${escapeHtml(s.location)}${s.pack ? ` · ${escapeHtml(s.pack)}` : ''}</div>
    `;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
