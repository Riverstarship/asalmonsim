import * as THREE from 'three';
import { DEFAULT_CONFIG } from '../config';
import { CoreSim } from './CoreSim';
import { FollowCamera } from '../cameras/FollowCamera';
import { FishEyeCamera, type CameraMode } from '../cameras/FishEyeCamera';
import { Overlay } from '../ui/Overlay';
import { Controls } from '../ui/Controls';
import { sense } from '../ai/Sensors';

const ACCURACY = {
  goal: 'Adult Salmo salar ascent with headless-checked hold/seek/DMG/fatigue.',
  gap: 'No real bathymetry/CFD; thrust not force-plate fitted; homing is weak bias only.',
  strategy: 'Harness gates regressions; next: site current maps + calibrated fatigue.',
};

export class Simulation {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private core: CoreSim;
  private follow: FollowCamera;
  private fishEye: FishEyeCamera;
  private cameraMode: CameraMode = 'follow';
  private overlay: Overlay;
  private clock = new THREE.Clock();
  private running = false;
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1a24);
    this.scene.fog = new THREE.FogExp2(0x0b1a24, 0.025);

    this.setupLights();

    this.core = new CoreSim({
      config: DEFAULT_CONFIG,
      headless: false,
      seed: 7,
      startPosition: new THREE.Vector3(0, 1.2, 8),
    });
    this.scene.add(this.core.river.group);
    this.scene.add(this.core.fish.group);

    this.follow = new FollowCamera(w / h);
    this.fishEye = new FishEyeCamera(w / h, w, h);

    this.overlay = new Overlay(container, ACCURACY);
    new Controls(this.overlay.root, (mode) => {
      this.cameraMode = mode;
    });

    window.addEventListener('resize', () => this.onResize());
  }

  private setupLights(): void {
    const amb = new THREE.AmbientLight(0x6a8aaa, 0.45);
    this.scene.add(amb);

    const sun = new THREE.DirectionalLight(0xc8e0ff, 1.1);
    sun.position.set(8, 20, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 60;
    sun.shadow.camera.left = -20;
    sun.shadow.camera.right = 20;
    sun.shadow.camera.top = 40;
    sun.shadow.camera.bottom = -10;
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight(0x3a6a7a, 0.35);
    fill.position.set(-10, 5, -5);
    this.scene.add(fill);

    const caustic = new THREE.PointLight(0x4a9aaa, 0.5, 30);
    caustic.position.set(0, 3.5, 40);
    this.scene.add(caustic);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  stop(): void {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  private frame(): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);

    const decision = this.core.step(dt);

    this.follow.update(dt, this.core.fish);
    this.fishEye.update(dt, this.core.fish);

    if (this.cameraMode === 'fisheye') {
      this.fishEye.render(this.renderer, this.scene);
    } else {
      this.renderer.render(this.scene, this.follow.camera);
    }

    const cfg = DEFAULT_CONFIG;
    const snap = sense(this.core.fish, this.core.river);
    this.overlay.updateHud({
      mode: decision.mode,
      rationale: decision.rationale,
      energy: decision.energy,
      groundSpeed: this.core.fish.groundSpeed,
      waterSpeed: this.core.fish.speedThroughWater(this.core.river),
      flowSpeed: snap.flowSpeed,
      tempC: snap.tempC,
      cameraMode: this.cameraMode,
      season: cfg.season,
      location: cfg.location.name,
      dmg: this.core.dmg,
      timeInLie: this.core.timeInLieSec,
    });
  }

  private onResize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.follow.setAspect(w / h);
    this.fishEye.setSize(w, h, w / h);
  }
}
