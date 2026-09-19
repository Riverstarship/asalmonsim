import * as THREE from 'three';
import { FISH_LENGTH_M } from '../config';
import type { FinController } from './Fins';

/**
 * Procedural Atlantic salmon mesh — elongated fusiform body,
 * wet PBR-ish material, wired fin meshes.
 */
export function createSalmonMesh(fins: FinController): THREE.Group {
  const root = new THREE.Group();
  root.name = 'salmon';

  const L = FISH_LENGTH_M;
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: 0x7a9a78,
    roughness: 0.28,
    metalness: 0.15,
    clearcoat: 0.65,
    clearcoatRoughness: 0.2,
    sheen: 0.4,
    sheenRoughness: 0.35,
    sheenColor: new THREE.Color(0xb8d4c0),
    reflectivity: 0.6,
  });

  const bellyMat = new THREE.MeshPhysicalMaterial({
    color: 0xd8d0c0,
    roughness: 0.35,
    metalness: 0.08,
    clearcoat: 0.5,
    clearcoatRoughness: 0.25,
  });

  const finMat = new THREE.MeshPhysicalMaterial({
    color: 0x5a7a58,
    roughness: 0.4,
    metalness: 0.1,
    clearcoat: 0.4,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
  });

  // Body: tapered capsule via lathe-like scaling of spheres/cylinders
  const body = new THREE.Group();
  body.name = 'body';

  // Main trunk — ellipsoid
  const trunkGeo = new THREE.SphereGeometry(1, 24, 16);
  trunkGeo.scale(L * 0.22, L * 0.14, L * 0.48);
  const trunk = new THREE.Mesh(trunkGeo, bodyMat);
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  body.add(trunk);

  // Belly highlight (slightly lower, paler)
  const bellyGeo = new THREE.SphereGeometry(1, 16, 12);
  bellyGeo.scale(L * 0.18, L * 0.1, L * 0.4);
  const belly = new THREE.Mesh(bellyGeo, bellyMat);
  belly.position.y = -L * 0.04;
  body.add(belly);

  // Head / snout
  const headGeo = new THREE.SphereGeometry(1, 16, 12);
  headGeo.scale(L * 0.12, L * 0.11, L * 0.16);
  const head = new THREE.Mesh(headGeo, bodyMat);
  head.position.z = L * 0.38;
  head.castShadow = true;
  body.add(head);

  // Eye
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a1a14, roughness: 0.3 });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(L * 0.018, 8, 8), eyeMat);
    eye.position.set(side * L * 0.09, L * 0.03, L * 0.42);
    body.add(eye);
  }

  // Adipose hint (small nub)
  const adi = new THREE.Mesh(
    new THREE.SphereGeometry(L * 0.025, 6, 6),
    finMat,
  );
  adi.position.set(0, L * 0.12, -L * 0.15);
  body.add(adi);

  root.add(body);

  // --- Fins ---
  const caudal = makeCaudal(L, finMat);
  caudal.position.z = -L * 0.48;
  root.add(caudal);
  fins.bindMesh('caudal', caudal);

  const dorsal = makeRayFin(L * 0.14, L * 0.12, finMat);
  dorsal.position.set(0, L * 0.12, L * 0.05);
  root.add(dorsal);
  fins.bindMesh('dorsal', dorsal);

  const anal = makeRayFin(L * 0.1, L * 0.09, finMat);
  anal.position.set(0, -L * 0.1, -L * 0.1);
  anal.rotation.z = Math.PI;
  root.add(anal);
  fins.bindMesh('anal', anal);

  const pecL = makePectoral(L, finMat);
  pecL.position.set(L * 0.12, -L * 0.02, L * 0.2);
  root.add(pecL);
  fins.bindMesh('pectoralL', pecL);

  const pecR = makePectoral(L, finMat);
  pecR.position.set(-L * 0.12, -L * 0.02, L * 0.2);
  pecR.scale.x = -1;
  root.add(pecR);
  fins.bindMesh('pectoralR', pecR);

  const pelL = makePectoral(L * 0.7, finMat);
  pelL.position.set(L * 0.06, -L * 0.1, 0);
  pelL.scale.setScalar(0.7);
  root.add(pelL);
  fins.bindMesh('pelvicL', pelL);

  const pelR = makePectoral(L * 0.7, finMat);
  pelR.position.set(-L * 0.06, -L * 0.1, 0);
  pelR.scale.set(-0.7, 0.7, 0.7);
  root.add(pelR);
  fins.bindMesh('pelvicR', pelR);

  // Orient: local +Z = nose / forward
  return root;
}

function makeCaudal(L: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(L * 0.08, L * 0.16);
  shape.lineTo(L * 0.02, L * 0.02);
  shape.lineTo(L * 0.08, -L * 0.16);
  shape.lineTo(0, 0);
  const geo = new THREE.ShapeGeometry(shape);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.y = Math.PI / 2;
  g.add(mesh);
  return g;
}

function makeRayFin(span: number, height: number, mat: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(span * 0.5, height, span, height * 0.3);
  shape.lineTo(span * 0.2, 0);
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  const m = new THREE.Mesh(geo, mat);
  m.rotation.y = Math.PI / 2;
  return m;
}

function makePectoral(L: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(L * 0.08, -L * 0.02, L * 0.14, -L * 0.06);
  shape.lineTo(L * 0.02, -L * 0.04);
  shape.closePath();
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat);
  g.add(mesh);
  return g;
}
