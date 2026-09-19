import * as THREE from 'three';
import { DEFAULT_CONFIG } from '../config';
import { RiverEnvironment } from '../env/River';
import { Salmon } from '../fish/Salmon';
import { DecisionLayer } from '../ai/DecisionLayer';
import { sense } from '../ai/Sensors';
import { FollowCamera } from '../cameras/FollowCamera';
import { FishEyeCamera, type CameraMode } from '../cameras/FishEyeCamera';
import { Overlay } from '../ui/Overlay';
import { Controls } from '../ui/Controls';

const ACCURACY = {
  goal: 'Adult Salmo salar upriver ascent with plausible flow response & holding.',
  gap: 'No real bathymetry/CFD; simplified thrust; no olfactory/homing cueing.',
  strategy: 'Next: site current maps, fatigue–recovery curves, then finer mesh.',
};

export class Simulation {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private river: RiverEnvironment;
  private fish: Salmon;
  private decisions = new DecisionLayer();
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

    const cfg = DEFAULT_CONFIG;
    this.river = new RiverEnvironment(cfg);
    this.scene.add(this.river.group);

    this.fish = new Salmon(new THREE.Vector3(0, 1.2, 8));
    this.scene.add(this.fish.group);

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

    // Soft caustic-ish point under surface
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

    const snap = sense(this.fish, this.river);
    const decision = this.decisions.update(dt, snap, this.fish.orientation);
    this.fish.applyDecision(decision);
    this.fish.update(dt, this.river);

    this.follow.update(dt, this.fish);
    this.fishEye.update(dt, this.fish);

    if (this.cameraMode === 'fisheye') {
      this.fishEye.render(this.renderer, this.scene);
    } else {
      this.renderer.render(this.scene, this.follow.camera);
    }

    const cfg = DEFAULT_CONFIG;
    this.overlay.updateHud({
      mode: decision.mode,
      rationale: decision.rationale,
      energy: decision.energy,
      groundSpeed: this.fish.groundSpeed,
      waterSpeed: this.fish.speedThroughWater(this.river),
      flowSpeed: snap.flowSpeed,
      tempC: snap.tempC,
      cameraMode: this.cameraMode,
      season: cfg.season,
      location: cfg.location.name,
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
