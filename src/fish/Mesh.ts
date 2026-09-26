import * as THREE from 'three';
import { FISH_LENGTH_M } from '../config';
import type { FinController } from './Fins';
import type { BodyWave } from './BodyWave';
import { createSalmonSkinMaps } from './SalmonTextures';

/**
 * Cascading spine joints for carangiform bend (visual only).
 * Station s ∈ [0,1] matches BodyWave.lateral(s).
 */
export interface SpineJoint {
  obj: THREE.Object3D;
  /** Fractional station along body (snout→caudal). */
  s: number;
  /** Rest local yaw (usually 0). */
  restYaw: number;
}

export interface BodyBendTargets {
  /** Cascading joints head→peduncle for undulatory S-curve. */
  joints: SpineJoint[];
}

/** Adult Salmo salar half-depth (dorsal-ventral) vs station s (TL fraction). */
function profileHalfDepth(s: number, L: number): number {
  const u = THREE.MathUtils.clamp(s, 0, 1);
  // Snout taper → max depth ~0.38–0.45 TL → peduncle pinch
  const snout = Math.pow(Math.min(1, u / 0.12), 0.65);
  const body = Math.sin(Math.PI * Math.min(1, Math.max(0, (u - 0.05) / 0.75)));
  const ped = u > 0.78 ? Math.pow(1 - (u - 0.78) / 0.22, 0.85) : 1;
  const shape = (0.22 * snout + 0.78 * body) * ped;
  return L * 0.105 * Math.max(0.12, shape);
}

/** Adult half-width (lateral) — fusiform, compressed vs depth. */
function profileHalfWidth(s: number, L: number): number {
  return profileHalfDepth(s, L) * 0.72;
}

/**
 * Procedural adult Atlantic salmon mesh — fusiform Salmo salar proportions,
 * silver sea-run materials, full fin set (incl. adipose + forked caudal),
 * cascading spine driven by BodyWave (visual only; plant unchanged).
 */
export function createSalmonMesh(fins: FinController): THREE.Group {
  const root = new THREE.Group();
  root.name = 'salmon';

  const L = FISH_LENGTH_M;
  const maps = createSalmonSkinMaps();

  const bodyMat = new THREE.MeshPhysicalMaterial({
    map: maps.albedo,
    roughnessMap: maps.roughness,
    normalMap: maps.normal,
    normalScale: new THREE.Vector2(0.35, 0.35),
    color: 0xffffff,
    roughness: 0.32,
    metalness: 0.22,
    clearcoat: 0.72,
    clearcoatRoughness: 0.18,
    sheen: 0.55,
    sheenRoughness: 0.28,
    sheenColor: new THREE.Color(0xc8d8e8),
    reflectivity: 0.55,
  });

  const finMat = new THREE.MeshPhysicalMaterial({
    color: 0x6a8a78,
    map: maps.albedo,
    roughness: 0.42,
    metalness: 0.12,
    clearcoat: 0.45,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    sheen: 0.25,
    sheenColor: new THREE.Color(0xa8c0b0),
  });

  const adiposeMat = new THREE.MeshPhysicalMaterial({
    color: 0x5a7060,
    roughness: 0.55,
    metalness: 0.05,
    clearcoat: 0.3,
  });

  // --- Cascading spine (snout → peduncle) ---
  // Joints placed at stations; each child carries the next body section.
  const jointStations = [0.08, 0.22, 0.4, 0.58, 0.75, 0.9];
  const joints: SpineJoint[] = [];
  let parent: THREE.Object3D = root;
  let prevS = 0;

  for (let i = 0; i < jointStations.length; i++) {
    const s = jointStations[i]!;
    const joint = new THREE.Group();
    joint.name = `spine_${i}`;
    // Local offset along +Z (nose) from previous station
    const dz = (s - prevS) * L;
    joint.position.z = i === 0 ? (s - 0.5) * L : dz;
    parent.add(joint);
    joints.push({ obj: joint, s, restYaw: 0 });

    // Ellipsoid slab centered on this station (extends halfway to neighbors)
    const s0 = i === 0 ? 0 : (jointStations[i - 1]! + s) * 0.5;
    const s1 = i === jointStations.length - 1 ? 1 : (s + jointStations[i + 1]!) * 0.5;
    const segLen = Math.max(0.04 * L, (s1 - s0) * L * 1.05);
    const hw = profileHalfWidth(s, L);
    const hd = profileHalfDepth(s, L);
    const geo = new THREE.SphereGeometry(1, 14, 10);
    geo.scale(hw, hd, segLen * 0.55);
    stampBodyUVs(geo, s0, s1);
    const mesh = new THREE.Mesh(geo, bodyMat);
    // Center segment so joint sits at station; first joint includes snout forward
    if (i === 0) mesh.position.z = segLen * 0.25;
    else mesh.position.z = 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    joint.add(mesh);

    parent = joint;
    prevS = s;
  }

  const headJoint = joints[0]!.obj;
  const midJoint = joints[2]!.obj;
  const postJoint = joints[3]!.obj;
  const pedJoint = joints[5]!.obj;

  // Eyes on head
  const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xd8d0b8, roughness: 0.4 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a1810, roughness: 0.25 });
  for (const side of [-1, 1]) {
    const socket = new THREE.Mesh(new THREE.SphereGeometry(L * 0.022, 8, 8), eyeWhite);
    socket.position.set(side * profileHalfWidth(0.1, L) * 0.85, L * 0.02, L * 0.06);
    headJoint.add(socket);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(L * 0.012, 8, 8), eyeMat);
    pupil.position.set(side * profileHalfWidth(0.1, L) * 0.95, L * 0.022, L * 0.07);
    headJoint.add(pupil);
  }

  // Operculum hint (gills)
  const opMat = new THREE.MeshPhysicalMaterial({
    color: 0x8aa090,
    roughness: 0.35,
    metalness: 0.15,
    clearcoat: 0.4,
  });
  for (const side of [-1, 1]) {
    const op = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), opMat);
    op.scale.set(L * 0.02, L * 0.07, L * 0.06);
    op.position.set(side * profileHalfWidth(0.18, L) * 0.95, 0, -L * 0.02);
    joints[1]!.obj.add(op);
  }

  // --- Fins ---
  const caudal = makeForkedCaudal(L, finMat);
  caudal.position.z = L * 0.06;
  pedJoint.add(caudal);
  fins.bindMesh('caudal', caudal);

  const dorsal = makeDorsalFin(L, finMat);
  dorsal.position.set(0, profileHalfDepth(0.42, L) * 0.95, 0);
  midJoint.add(dorsal);
  fins.bindMesh('dorsal', dorsal);

  // Soft adipose (Salmo hallmark) — static fleshy nub
  const adipose = makeAdipose(L, adiposeMat);
  adipose.position.set(0, profileHalfDepth(0.78, L) * 0.9, L * 0.02);
  joints[4]!.obj.add(adipose);

  const anal = makeAnalFin(L, finMat);
  anal.position.set(0, -profileHalfDepth(0.72, L) * 0.9, 0);
  postJoint.add(anal);
  fins.bindMesh('anal', anal);

  const pecL = makePectoral(L, finMat);
  pecL.position.set(profileHalfWidth(0.2, L) * 0.9, -L * 0.02, 0);
  joints[1]!.obj.add(pecL);
  fins.bindMesh('pectoralL', pecL);

  const pecR = makePectoral(L, finMat);
  pecR.position.set(-profileHalfWidth(0.2, L) * 0.9, -L * 0.02, 0);
  pecR.scale.x = -1;
  joints[1]!.obj.add(pecR);
  fins.bindMesh('pectoralR', pecR);

  const pelL = makePelvic(L, finMat);
  pelL.position.set(L * 0.04, -profileHalfDepth(0.48, L) * 0.85, 0);
  midJoint.add(pelL);
  fins.bindMesh('pelvicL', pelL);

  const pelR = makePelvic(L, finMat);
  pelR.position.set(-L * 0.04, -profileHalfDepth(0.48, L) * 0.85, 0);
  pelR.scale.x = -1;
  midJoint.add(pelR);
  fins.bindMesh('pelvicR', pelR);

  root.userData.bodyBend = { joints } satisfies BodyBendTargets;
  root.userData.salmonMaps = maps;

  return root;
}

/**
 * Drive cascading spine yaw from the same traveling wave used for thrust.
 * Idle/hold wave is quieter (BodyWave modeAmp) → subtler visual undulation.
 * Visual only; hydro uses wave separately.
 */
export function applyBodyWaveBend(root: THREE.Object3D, wave: BodyWave): void {
  const targets = root.userData.bodyBend as BodyBendTargets | undefined;
  if (!targets?.joints?.length) return;
  const L = FISH_LENGTH_M;
  // Lateral metres → joint yaw; softer toward snout (carangiform)
  const scale = 1 / (L * 0.28);

  for (let i = 0; i < targets.joints.length; i++) {
    const j = targets.joints[i]!;
    const lat = wave.lateral(j.s);
    // Differential yaw vs previous station → S-curve when cascaded
    const prevS = i === 0 ? 0 : targets.joints[i - 1]!.s;
    const prevLat = i === 0 ? wave.lateral(0) * 0.15 : wave.lateral(prevS);
    const dLat = lat - prevLat;
    const yaw = THREE.MathUtils.clamp(dLat * scale, -0.42, 0.42);
    // Head stays quieter; peduncle / caudal beat hardest
    const carangiform = 0.35 + 0.65 * j.s;
    j.obj.rotation.y = yaw * carangiform;
  }
}


/** Map segment vertices to skin atlas: u = station along TL, v = belly→dorsal. */
function stampBodyUVs(geo: THREE.BufferGeometry, s0: number, s1: number): void {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  if (!pos || !uv) return;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const ySpan = Math.max(1e-6, maxY - minY);
  const zSpan = Math.max(1e-6, maxZ - minZ);
  for (let i = 0; i < pos.count; i++) {
    const zt = (pos.getZ(i) - minZ) / zSpan;
    const u = THREE.MathUtils.lerp(s0, s1, zt);
    const v = (pos.getY(i) - minY) / ySpan;
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
}

function makeForkedCaudal(L: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  // Homocercal forked tail — upper & lower lobes
  const lobe = (sign: number) => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.quadraticCurveTo(L * 0.04, sign * L * 0.04, L * 0.11, sign * L * 0.175);
    shape.quadraticCurveTo(L * 0.07, sign * L * 0.08, L * 0.02, sign * L * 0.015);
    shape.lineTo(0, 0);
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape, 8), mat);
    mesh.rotation.y = Math.PI / 2;
    return mesh;
  };
  g.add(lobe(1));
  g.add(lobe(-1));
  // Narrow peduncle fill
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(L * 0.035, L * 0.04),
    mat,
  );
  fill.rotation.y = Math.PI / 2;
  fill.position.z = L * 0.01;
  g.add(fill);
  return g;
}

function makeDorsalFin(L: number, mat: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape();
  // Mid-body dorsal: rises then tapers aft (salmon-like)
  shape.moveTo(0, 0);
  shape.lineTo(L * 0.02, L * 0.02);
  shape.quadraticCurveTo(L * 0.06, L * 0.14, L * 0.13, L * 0.1);
  shape.quadraticCurveTo(L * 0.16, L * 0.04, L * 0.15, 0);
  shape.closePath();
  const m = new THREE.Mesh(new THREE.ShapeGeometry(shape, 10), mat);
  m.rotation.y = Math.PI / 2;
  return m;
}

function makeAdipose(L: number, mat: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(L * 0.02, L * 0.035, L * 0.045, L * 0.02);
  shape.lineTo(L * 0.03, 0);
  shape.closePath();
  const m = new THREE.Mesh(new THREE.ShapeGeometry(shape, 6), mat);
  m.rotation.y = Math.PI / 2;
  return m;
}

function makeAnalFin(L: number, mat: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(L * 0.05, -L * 0.1, L * 0.12, -L * 0.06);
  shape.lineTo(L * 0.02, 0);
  shape.closePath();
  const m = new THREE.Mesh(new THREE.ShapeGeometry(shape, 8), mat);
  m.rotation.y = Math.PI / 2;
  return m;
}

function makePectoral(L: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(L * 0.09, -L * 0.01, L * 0.16, -L * 0.07);
  shape.quadraticCurveTo(L * 0.08, -L * 0.06, L * 0.02, -L * 0.035);
  shape.closePath();
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape, 8), mat);
  g.add(mesh);
  return g;
}

function makePelvic(L: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(L * 0.05, -L * 0.01, L * 0.09, -L * 0.045);
  shape.lineTo(L * 0.015, -L * 0.025);
  shape.closePath();
  g.add(new THREE.Mesh(new THREE.ShapeGeometry(shape, 6), mat));
  return g;
}
