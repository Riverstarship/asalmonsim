import type { CameraMode } from '../cameras/FishEyeCamera';

export class Controls {
  readonly el: HTMLDivElement;
  private followBtn: HTMLButtonElement;
  private fishEyeBtn: HTMLButtonElement;
  private hudBtn: HTMLButtonElement;
  private onMode: (mode: CameraMode) => void;
  private onHudToggle: () => boolean;

  constructor(
    parent: HTMLElement,
    onMode: (mode: CameraMode) => void,
    onHudToggle: () => boolean,
    hudInitiallyVisible: boolean,
  ) {
    this.onMode = onMode;
    this.onHudToggle = onHudToggle;
    this.el = document.createElement('div');
    this.el.id = 'controls';
    parent.appendChild(this.el);

    this.followBtn = document.createElement('button');
    this.followBtn.textContent = 'Follow cam';
    this.followBtn.className = 'active';
    this.followBtn.type = 'button';
    this.followBtn.addEventListener('click', () => {
      this.setActive('follow');
      this.onMode('follow');
    });

    this.fishEyeBtn = document.createElement('button');
    this.fishEyeBtn.textContent = 'Fish-eye';
    this.fishEyeBtn.type = 'button';
    this.fishEyeBtn.addEventListener('click', () => {
      this.setActive('fisheye');
      this.onMode('fisheye');
    });

    this.hudBtn = document.createElement('button');
    this.hudBtn.type = 'button';
    this.hudBtn.addEventListener('click', () => {
      const visible = this.onHudToggle();
      this.syncHudBtn(visible);
    });
    this.syncHudBtn(hudInitiallyVisible);

    this.el.appendChild(this.followBtn);
    this.el.appendChild(this.fishEyeBtn);
    this.el.appendChild(this.hudBtn);
  }

  /** Keep Show/Hide info button in sync after Overlay.sealChrome(). */
  syncHud(visible: boolean): void {
    this.syncHudBtn(visible);
  }

  private syncHudBtn(visible: boolean): void {
    this.hudBtn.textContent = visible ? 'Hide info' : 'Show info';
    this.hudBtn.classList.toggle('active', visible);
    this.hudBtn.setAttribute('aria-pressed', visible ? 'true' : 'false');
  }

  private setActive(mode: CameraMode): void {
    this.followBtn.classList.toggle('active', mode === 'follow');
    this.fishEyeBtn.classList.toggle('active', mode === 'fisheye');
  }
}
