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
}

export interface AccuracyContent {
  goal: string;
  gap: string;
  strategy: string;
}

export class Overlay {
  readonly root: HTMLDivElement;
  private hudEl: HTMLDivElement;
  private accuracyEl: HTMLDivElement;

  constructor(parent: HTMLElement, accuracy: AccuracyContent) {
    this.root = document.createElement('div');
    this.root.id = 'ui-root';
    parent.appendChild(this.root);

    const title = document.createElement('div');
    title.id = 'title-bar';
    title.innerHTML =
      '<h1>Atlantic Salmon Migration Sim</h1><p>Observational · Salmo salar adult ascent</p>';
    this.root.appendChild(title);

    this.hudEl = document.createElement('div');
    this.hudEl.id = 'hud';
    this.hudEl.className = 'panel';
    this.root.appendChild(this.hudEl);

    this.accuracyEl = document.createElement('div');
    this.accuracyEl.id = 'accuracy';
    this.accuracyEl.className = 'panel';
    this.accuracyEl.innerHTML = `
      <h3>Accuracy overlay</h3>
      <div class="row"><strong>Goal:</strong> ${escapeHtml(accuracy.goal)}</div>
      <div class="row"><strong>Gap:</strong> ${escapeHtml(accuracy.gap)}</div>
      <div class="row"><strong>Strategy:</strong> ${escapeHtml(accuracy.strategy)}</div>
    `;
    this.root.appendChild(this.accuracyEl);
  }

  updateHud(s: HudState): void {
    this.hudEl.innerHTML = `
      <div class="label">Behavior</div>
      <div class="value">${escapeHtml(s.mode)} — ${escapeHtml(s.rationale)}</div>
      <div class="label">Energy</div>
      <div class="value">${(s.energy * 100).toFixed(0)}%</div>
      <div class="label">Ground / through-water / flow</div>
      <div class="value">${s.groundSpeed.toFixed(2)} / ${s.waterSpeed.toFixed(2)} / ${s.flowSpeed.toFixed(2)} m/s</div>
      <div class="label">Temp</div>
      <div class="value">${s.tempC.toFixed(1)} °C</div>
      <div class="label">Camera · Season · Site</div>
      <div class="value">${escapeHtml(s.cameraMode)} · ${escapeHtml(s.season)} · ${escapeHtml(s.location)}</div>
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
