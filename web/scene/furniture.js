// Static office furniture for the hall, baked into one mesh per material so a full floor stays cheap to draw.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const mat = {
  top: new THREE.MeshStandardMaterial({ color: 0xc4b49a, roughness: 0.45, metalness: 0.02 }),
  edge: new THREE.MeshStandardMaterial({ color: 0x8d7b66, roughness: 0.55, metalness: 0.04 }),
  metal: new THREE.MeshStandardMaterial({ color: 0xb7bcc6, roughness: 0.32, metalness: 0.85 }),
  modesty: new THREE.MeshStandardMaterial({ color: 0x4a463f, roughness: 0.7, metalness: 0.08 }),
  mesh: new THREE.MeshStandardMaterial({ color: 0x2a3140, roughness: 0.85, metalness: 0.05 }),
  screen: new THREE.MeshStandardMaterial({ color: 0xd7ecff, roughness: 0.35, metalness: 0.02, emissive: 0x9fd0ff, emissiveIntensity: 0.22 }),
  bezel: new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.4, metalness: 0.5 }),
  plant: new THREE.MeshStandardMaterial({ color: 0x2f7a45, roughness: 0.75 }),
  pot: new THREE.MeshStandardMaterial({ color: 0xe7e2d8, roughness: 0.55 }),
  mug: new THREE.MeshStandardMaterial({ color: 0xf3f0ea, roughness: 0.28, metalness: 0.04 }),
  paper: new THREE.MeshStandardMaterial({ color: 0xf7f4ee, roughness: 0.8 }),
  lamp: new THREE.MeshStandardMaterial({ color: 0xffe6b0, roughness: 0.55, metalness: 0.02, emissive: 0x000000, emissiveIntensity: 0 }),
  panel: new THREE.MeshStandardMaterial({ color: 0xd8dde6, roughness: 0.55, metalness: 0.04, transparent: true, opacity: 0.72 }),
  frost: new THREE.MeshPhysicalMaterial({ color: 0xb7c3d4, roughness: 0.28, metalness: 0.02, transparent: true, opacity: 0.72, depthWrite: false }),
  glow: new THREE.MeshBasicMaterial({ color: 0xc4b5fd, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
};

function roundedSlab(w, d, thick, radius) {
  const hw = w / 2, hd = d / 2, r = radius;
  const shape = new THREE.Shape();
  shape.moveTo(-hw + r, -hd);
  shape.lineTo(hw - r, -hd);
  shape.absarc(hw - r, -hd + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(hw, hd - r);
  shape.absarc(hw - r, hd - r, r, 0, Math.PI / 2, false);
  shape.lineTo(-hw + r, hd);
  shape.absarc(-hw + r, hd - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(-hw, -hd + r);
  shape.absarc(-hw + r, -hd + r, r, Math.PI, Math.PI * 1.5, false);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 2 });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function part(geo, key, x, y, z, rx = 0, ry = 0, rz = 0, flags = {}) {
  const mesh = new THREE.Mesh(geo, mat[key]);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  mesh.userData.mat = key;
  Object.assign(mesh.userData, flags);
  return mesh;
}

function workstationTemplate() {
  const g = new THREE.Group();
  const top = roundedSlab(1.4, 0.72, 0.035, 0.06);
  g.add(part(top, 'top', 0, 0.74, 0.82));
  g.add(part(new THREE.BoxGeometry(1.28, 0.012, 0.6), 'edge', 0, 0.718, 0.82));
  // metal frame and modesty panel
  g.add(part(new THREE.BoxGeometry(1.22, 0.03, 0.5), 'metal', 0, 0.69, 0.82));
  g.add(part(new THREE.BoxGeometry(1.16, 0.32, 0.02), 'modesty', 0, 0.52, 1.12));
  g.add(part(new THREE.BoxGeometry(0.9, 0.04, 0.1), 'metal', 0, 0.62, 0.7));
  for (const x of [-0.58, 0.58]) {
    g.add(part(new THREE.BoxGeometry(0.05, 0.68, 0.5), 'metal', x, 0.36, 0.82));
    g.add(part(new THREE.BoxGeometry(0.42, 0.03, 0.06), 'metal', x, 0.04, 0.64));
    g.add(part(new THREE.BoxGeometry(0.42, 0.03, 0.06), 'metal', x, 0.04, 1.0));
  }
  // dual monitors on one arm
  g.add(part(new THREE.CylinderGeometry(0.018, 0.022, 0.16, 8), 'metal', 0, 0.84, 1.05));
  g.add(part(new THREE.BoxGeometry(0.7, 0.02, 0.02), 'metal', 0, 0.96, 1.02));
  for (const x of [-0.28, 0.28]) {
    g.add(part(new THREE.BoxGeometry(0.46, 0.28, 0.02), 'bezel', x, 1.12, 1.02, -0.12, x < 0 ? 0.18 : -0.18, 0));
    g.add(part(new THREE.PlaneGeometry(0.4, 0.22), 'screen', x, 1.12, 1.035, -0.12, x < 0 ? 0.18 : -0.18, 0));
  }
  g.add(part(new THREE.BoxGeometry(0.36, 0.012, 0.22), 'paper', -0.05, 0.762, 0.62));
  g.add(part(new THREE.BoxGeometry(0.34, 0.016, 0.12), 'bezel', -0.05, 0.772, 0.62));
  g.add(part(new THREE.BoxGeometry(0.16, 0.006, 0.2), 'paper', 0.28, 0.762, 0.66));
  g.add(part(new THREE.BoxGeometry(0.05, 0.016, 0.08), 'bezel', 0.3, 0.772, 0.64));
  g.add(part(new THREE.BoxGeometry(0.18, 0.008, 0.24), 'paper', -0.42, 0.762, 0.78));
  g.add(part(new THREE.CylinderGeometry(0.035, 0.032, 0.07, 10), 'mug', 0.48, 0.81, 0.7));
  g.add(part(new THREE.CylinderGeometry(0.045, 0.04, 0.05, 8), 'pot', -0.52, 0.79, 0.95));
  g.add(part(new THREE.ConeGeometry(0.07, 0.16, 6), 'plant', -0.52, 0.9, 0.95));
  g.add(part(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 6), 'metal', 0.5, 0.86, 0.95));
  g.add(part(new THREE.SphereGeometry(0.045, 8, 6), 'lamp', 0.5, 1.0, 0.95));
  // waist-height frosted divider so each desk reads as its own spot
  g.add(part(new THREE.BoxGeometry(0.03, 0.62, 0.78), 'frost', 0.78, 1.08, 0.55, 0, 0, 0, { skipLead: true }));
  g.add(part(new THREE.BoxGeometry(0.045, 0.04, 0.8), 'metal', 0.78, 1.4, 0.55, 0, 0, 0, { skipLead: true }));
  g.add(part(new THREE.BoxGeometry(0.04, 0.7, 0.03), 'metal', 0.78, 1.05, 0.16, 0, 0, 0, { skipLead: true }));

  // ergonomic mesh chair, origin at the sitter's feet
  g.add(part(new THREE.CylinderGeometry(0.035, 0.04, 0.28, 10), 'metal', 0, 0.28, 0));
  g.add(part(new THREE.CylinderGeometry(0.07, 0.07, 0.025, 10), 'metal', 0, 0.12, 0));
  g.add(part(new THREE.BoxGeometry(0.46, 0.05, 0.46), 'mesh', 0, 0.48, 0.02));
  g.add(part(new THREE.BoxGeometry(0.42, 0.48, 0.025), 'mesh', 0, 0.78, -0.2));
  g.add(part(new THREE.BoxGeometry(0.04, 0.5, 0.03), 'metal', -0.2, 0.76, -0.19));
  g.add(part(new THREE.BoxGeometry(0.04, 0.5, 0.03), 'metal', 0.2, 0.76, -0.19));
  g.add(part(new THREE.BoxGeometry(0.16, 0.08, 0.03), 'mesh', 0, 1.08, -0.18));
  for (const x of [-0.24, 0.24]) {
    g.add(part(new THREE.BoxGeometry(0.06, 0.16, 0.04), 'metal', x, 0.58, 0.02));
    g.add(part(new THREE.BoxGeometry(0.08, 0.025, 0.22), 'mesh', x, 0.66, 0.06));
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.add(part(new THREE.BoxGeometry(0.2, 0.02, 0.035), 'metal', Math.cos(a) * 0.12, 0.07, Math.sin(a) * 0.12, 0, -a, 0));
    g.add(part(new THREE.SphereGeometry(0.028, 8, 6), 'bezel', Math.cos(a) * 0.22, 0.03, Math.sin(a) * 0.22));
  }
  g.add(part(new THREE.RingGeometry(0.72, 0.86, 40), 'glow', 0, 0.03, 0, -Math.PI / 2, 0, 0, { onlyLead: true }));
  g.updateMatrixWorld(true);
  return g;
}

/** Bake every seat into a handful of merged meshes parented under `parent`. */
export function buildFurniture(parent, spots) {
  const template = workstationTemplate();
  const buckets = new Map();
  const seat = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (const spot of spots) {
    q.setFromAxisAngle(up, spot.yaw || 0);
    seat.compose(spot.pos, q, new THREE.Vector3(1, 1, 1));
    template.traverse((mesh) => {
      if (!mesh.isMesh) return;
      if (mesh.userData.skipLead && spot.lead) return;
      if (mesh.userData.onlyLead && !spot.lead) return;
      const g = mesh.geometry.clone();
      g.applyMatrix4(mesh.matrixWorld);
      g.applyMatrix4(seat);
      const key = mesh.userData.mat;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(g);
    });
  }
  const group = new THREE.Group();
  group.name = 'office-furniture';
  for (const [key, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat[key]);
    mesh.castShadow = key === 'top' || key === 'mesh';
    mesh.receiveShadow = key === 'top' || key === 'mesh' || key === 'panel';
    mesh.name = `furn-${key}`;
    group.add(mesh);
  }
  template.traverse((o) => { if (o.geometry && o.userData.mat === 'top') o.geometry.dispose(); });
  parent.add(group);
  return group;
}
