// Pooled lights for desk-to-desk packets, laptop-to-cloud beams, ripples and status trails.
// One InstancedMesh, a fixed ripple pool, and static lines when motion is reduced.
import * as THREE from 'three';

const MAX = 64;
const RINGS = 6;
const slots = [];
let mesh = null, dummy = new THREE.Object3D(), parentOf = null;
let rings = [], cloud = null, lines = null, linePos = null;

function slot() { return slots.find((s) => !s.alive); }

export function ensureFx(parent) {
  if (!parent) return;
  if (mesh && mesh.parent !== parent) parent.add(mesh);
  if (cloud && cloud.parent !== parent) parent.add(cloud);
  if (lines && lines.parent !== parent) parent.add(lines);
  parentOf = parent;
  if (mesh) return;
  const geo = new THREE.SphereGeometry(0.05, 6, 5);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  mesh = new THREE.InstancedMesh(geo, mat, MAX);
  mesh.name = 'fx-packets';
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < MAX; i++) {
    slots.push({ alive: false, t: 0, dur: 1, lift: 0.8, a: new THREE.Vector3(), b: new THREE.Vector3(), color: new THREE.Color(1, 1, 1), ripple: false });
    mesh.setColorAt(i, new THREE.Color(0, 0, 0));
    dummy.scale.set(0, 0, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  parent.add(mesh);

  const ringGeo = new THREE.RingGeometry(0.15, 0.22, 24);
  for (let i = 0; i < RINGS; i++) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    m.userData.t = 0;
    m.name = 'fx-ripple';
    parent.add(m);
    rings.push(m);
  }

  linePos = new Float32Array(24 * 2 * 3);
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
  lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.55 }));
  lines.name = 'fx-links';
  lines.frustumCulled = false;
  parent.add(lines);

  cloud = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.85 }));
  cloud.name = 'fx-cloud';
  cloud.position.set(-1.2, 3.8, -0.4);
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8), new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
  cloud.add(halo);
  parent.add(cloud);
}

function launch(parent, a, b, color, lift, dur, ripple) {
  ensureFx(parent);
  const s = slot();
  if (!s) return false;
  s.alive = true;
  s.t = 0;
  s.dur = dur;
  s.lift = lift;
  s.a.copy(a);
  s.b.copy(b);
  s.ripple = !!ripple;
  s.color.set(color);
  return true;
}

export function spawnArc(parent, a, b, color = 0x7dd3fc) {
  const from = a.clone(); from.y = Math.max(from.y, 0.9);
  const to = b.clone(); to.y = Math.max(to.y, 0.9);
  launch(parent, from, to, color, 0.85, 1.15, false);
}

export function spawnBeam(parent, from, color = 0xb7dcff) {
  if (!cloud) ensureFx(parent);
  const a = from.clone(); a.y = Math.max(a.y, 0.85);
  launch(parent, a, cloud.position, color, 0.15, 0.9, false);
}

export function spawnTrail(parent, at, color = 0xffd27a) {
  const a = at.clone(); a.y = 0.7;
  const b = a.clone(); b.y = 1.6;
  launch(parent, a, b, color, 0.05, 0.55, false);
}

export function spawnRipple(parent, at) {
  ensureFx(parent);
  const m = rings.find((r) => !r.visible);
  if (!m) return;
  m.visible = true;
  m.userData.t = 0;
  m.position.set(at.x, 0.03, at.z);
  m.scale.setScalar(0.4);
  m.material.opacity = 0.8;
}

/** pairs: [{a, b}] world/floor-local positions. Empty list hides the lines. */
export function setStaticLinks(parent, pairs) {
  ensureFx(parent);
  const attr = lines.geometry.attributes.position;
  let n = 0;
  for (const p of pairs.slice(0, 24)) {
    linePos[n++] = p.a.x; linePos[n++] = 0.35; linePos[n++] = p.a.z;
    linePos[n++] = p.b.x; linePos[n++] = 0.35; linePos[n++] = p.b.z;
  }
  attr.needsUpdate = true;
  lines.geometry.setDrawRange(0, n / 3);
  lines.material.color.set(0x67e8f9);
  lines.material.opacity = 0.9;
}

let netGroup = null, netKey = '', flows = [];

function arcCurve(a, b, lift, via) {
  const stops = [a];
  for (const v of via || []) stops.push(new THREE.Vector3(v.x, 0.45, v.z));
  stops.push(b);
  const pts = [];
  const n = 8 * (stops.length - 1);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const seg = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)));
    const u = t * (stops.length - 1) - seg;
    const p = new THREE.Vector3().lerpVectors(stops[seg], stops[seg + 1], u);
    p.y += Math.sin(u * Math.PI) * lift;
    pts.push(p);
  }
  return new THREE.CatmullRomCurve3(pts);
}

/** Always-on neon links. Rebuilt only when the set of endpoints changes. */
export function setNetwork(parent, pairs) {
  ensureFx(parent);
  const key = pairs.map((p) => `${p.a.x.toFixed(1)},${p.a.z.toFixed(1)}>${p.b.x.toFixed(1)},${p.b.z.toFixed(1)}:${p.lift || 0}:${p.ay || 0}:${p.by || 0}:${(p.via || []).map((v) => `${v.x.toFixed(1)},${v.z.toFixed(1)}`).join(';')}`).join('|');
  if (key === netKey && netGroup?.parent === parent) return;
  netKey = key;
  if (netGroup) {
    const mats = new Set();
    netGroup.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) mats.add(o.material);
    });
    for (const m of mats) m.dispose();
    netGroup.removeFromParent();
  }
  netGroup = new THREE.Group();
  netGroup.name = 'fx-network';
  flows = [];
  const glow = new THREE.MeshBasicMaterial({ color: 0xc084fc, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false });
  const core = new THREE.MeshBasicMaterial({ color: 0xe9d5ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const p of pairs.slice(0, 96)) {
    const a = p.a.clone(); a.y = p.ay ?? 0.48;
    const b = p.b.clone(); b.y = p.by ?? 0.48;
    const curve = arcCurve(a, b, p.lift || 0.4, p.via);
    const thick = p.wide ? 0.075 : 0.032;
    const dash = dashMaterial();
    netGroup.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 18, thick, 5, false), glow));
    netGroup.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 18, thick * 0.38, 5, false), core));
    netGroup.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, thick * 0.5, 5, false), dash));
    flows.push({ curve, k: Math.random(), id: p.id || '', speed: 0.22, color: 0x7c3aed, scale: 2.4, dash, on: false });
  }
  parent.add(netGroup);
}

/** Per-link pace. A live bot gets green dashes inside the purple tube, moving toward Master. */
export function setFlowPace(pace) {
  for (const f of flows) {
    const on = !!(pace && pace.get(f.id));
    f.on = on;
    f.speed = on ? 0.9 : 0;
    f.color = on ? 0x22c55e : 0x6d28d9;
    f.scale = on ? 0 : 0;
    if (f.dash) f.dash.uniforms.uOn.value = on ? 1 : 0;
  }
}

let netTime = 0;

function dashMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uOn: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uOn;
      varying vec2 vUv;
      void main() {
        if (uOn < 0.5) discard;
        float dash = fract(vUv.x * 16.0 - uTime * 0.55);
        float on = step(dash, 0.34);
        gl_FragColor = vec4(0.25, 1.0, 0.48, on * 0.95);
      }
    `,
  });
}

export function tickNetwork(dt) {
  if (!mesh || !flows.length) return;
  netTime += dt;
  flows.forEach((f, i) => {
    if (f.dash) f.dash.uniforms.uTime.value = netTime;
    if (i >= MAX) return;
    f.k = (f.k + dt * (f.speed || 0.2)) % 1;
    const p = f.curve.getPoint(f.k);
    dummy.position.copy(p);
    dummy.scale.setScalar(f.scale || 2.4);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, new THREE.Color(f.color));
    slots[i].alive = true;
  });
  for (let i = flows.length; i < MAX; i++) {
    if (!slots[i].alive) continue;
    dummy.scale.set(0, 0, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

export function tickPackets(dt, reduced) {
  if (!mesh) return;
  for (let i = 0; i < MAX; i++) {
    const s = slots[i];
    if (!s.alive || reduced) {
      dummy.scale.set(0, 0, 0);
    } else {
      s.t += dt;
      const k = s.t / s.dur;
      if (k >= 1) {
        s.alive = false;
        if (s.ripple) spawnRipple(parentOf, s.b);
        dummy.scale.set(0, 0, 0);
      } else {
        dummy.position.lerpVectors(s.a, s.b, k);
        dummy.position.y += Math.sin(k * Math.PI) * s.lift;
        dummy.scale.setScalar(0.7 + 0.3 * Math.sin(k * Math.PI));
      }
    }
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, s.alive && !reduced ? s.color : new THREE.Color(0, 0, 0));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  if (cloud) cloud.rotation.y += reduced ? 0 : dt * 0.4;
  for (const m of rings) {
    if (!m.visible) continue;
    m.userData.t += dt;
    const k = m.userData.t / 0.7;
    m.scale.setScalar(0.4 + k * 2.4);
    m.material.opacity = Math.max(0, 0.75 * (1 - k));
    if (k >= 1) m.visible = false;
  }
}

export function cloudPoint() { return cloud ? cloud.position : null; }
