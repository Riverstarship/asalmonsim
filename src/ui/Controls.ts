import type { CameraMode } from '../cameras/FishEyeCamera';

export class Controls {
  readonly el: HTMLDivElement;
  private followBtn: HTMLButtonElement;
  private fishEyeBtn: HTMLButtonElement;
  private onMode: (mode: CameraMode) => void;

  constructor(parent: HTMLElement, onMode: (mode: CameraMode) => void) {
    this.onMode = onMode;
    this.el = document.createElement('div');
    this.el.id = 'controls';
    parent.appendChild(this.el);

    this.followBtn = document.createElement('button');
    this.followBtn.textContent = 'Follow cam';
    this.followBtn.className = 'active';
    this.followBtn.addEventListener('click', () => {
      this.setActive('follow');
      this.onMode('follow');
    });

    this.fishEyeBtn = document.createElement('button');
    this.fishEyeBtn.textContent = 'Fish-eye';
    this.fishEyeBtn.addEventListener('click', () => {
      this.setActive('fisheye');
      this.onMode('fisheye');
    });

    this.el.appendChild(this.followBtn);
    this.el.appendChild(this.fishEyeBtn);
  }

  private setActive(mode: CameraMode): void {
    this.followBtn.classList.toggle('active', mode === 'follow');
    this.fishEyeBtn.classList.toggle('active', mode === 'fisheye');
  }
}
