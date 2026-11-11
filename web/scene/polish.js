// Room dressing and the quality switch. Decor is static geometry. Dust drifts only while the tab is drawing.
import * as THREE from 'three';
import { REDUCED } from './spring.js?v=18';
import { sharpTexture } from './tex.js?v=18';

const KEY = 'bothq.quality';
let level = 'high';
let softGpu = false;
let dust = null, dustN = 0;

export function initQuality(renderer) {
  const q = new URLSearchParams(location.search).get('quality');
  if (q === 'low' || q === 'high') { level = q; return level; }
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'low' || saved === 'high') { level = saved; return level; }
  } catch { /* private mode */ }
  let soft = false;
  try {
    const gl = renderer.getContext();
    const name = gl.getParameter(gl.RENDERER) || '';
    soft = /SwiftShader|llvmpipe|Software/i.test(name);
  } catch { /* ignore */ }
  softGpu = soft;
  level = 'high';
  return level;
}
let tier = 'high';
let slowAcc = 0;
let watchStart = 0;
let onChange = () => {};

export function getQuality() { return level; }
export function isSoftGpu() { return softGpu; }
export function renderTier() { return level === 'low' ? 'fallback' : tier; }
export function onQualityChange(fn) { onChange = fn; }

/** Drop to the lighter renderer when frames stay slower than 25ms for 3 seconds. */
export function noteFrame(dtSec) {
  if (level === 'low' || tier === 'fallback') return false;
  const now = performance.now();
  if (!watchStart) watchStart = now;
  if (now - watchStart < 2000) return false;
  const ms = dtSec * 1000;
  if (ms > 25) slowAcc += ms;
  else slowAcc = Math.max(0, slowAcc - ms);
  if (slowAcc < 3000) return false;
  tier = 'fallback';
  slowAcc = 0;
  onChange();
  return true;
}

export function toggleQuality() {
  level = level === 'high' ? 'low' : 'high';
  if (level === 'high') { tier = 'high'; watchStart = performance.now(); slowAcc = 0; }
  try { localStorage.setItem(KEY, level); } catch { /* private mode */ }
  onChange();
  return level;
}

function signTexture() {
  const c = document.createElement('canvas');
  c.width = 1536; c.height = 384;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 1536, 384);
  g.strokeStyle = '#E7D2FF';
  g.lineWidth = 24;
  g.strokeRect(24, 24, 1488, 336);
  g.fillStyle = '#F4E9FF';
  g.font = '700 192px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('Daniel HQ', 768, 204);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return sharpTexture(t);
}

function posterTexture(hue) {
  const c = document.createElement('canvas');
  c.width = 384; c.height = 540;
  const g = c.getContext('2d');
  g.scale(3, 3);
  g.fillStyle = `hsl(${hue} 40% 18%)`;
  g.fillRect(0, 0, 128, 180);
  g.fillStyle = `hsl(${hue} 70% 62%)`;
  g.fillRect(16, 20, 96, 70);
  g.fillStyle = 'rgba(255,255,255,.75)';
  g.fillRect(16, 110, 70, 8);
  g.fillRect(16, 128, 48, 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return sharpTexture(t);
}

function skylineTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#070614';
  g.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 28; i++) {
    const w = 10 + (i * 17) % 24, h = 30 + (i * 29) % 80, x = (i * 18) % 500;
    g.fillStyle = (i % 4 === 0) ? '#3a2a66' : '#1a1430';
    g.fillRect(x, 128 - h, w, h);
    if (i % 3 === 0) { g.fillStyle = '#ffd27a'; g.fillRect(x + 3, 128 - h + 8, 3, 3); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Static dressing on the open-floor template: sign, posters, shelves, shafts, night strips, skyline. */
export function installDecor(root) {
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.45), new THREE.MeshBasicMaterial({ map: signTexture(), transparent: true, side: THREE.DoubleSide }));
  sign.position.set(-7.55, 2.15, -1.2);
  sign.rotation.y = Math.PI / 2;
  sign.material = new THREE.MeshBasicMaterial({ map: sign.material.map, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  sign.scale.set(2.4, 2.2, 1);
  sign.name = 'daniel-hq-sign';
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.95, 0.58), new THREE.MeshBasicMaterial({ color: 0x14081c, side: THREE.DoubleSide }));
  plate.position.set(sign.position.x - 0.06, sign.position.y, sign.position.z);
  plate.rotation.y = sign.rotation.y;
  plate.scale.copy(sign.scale);
  plate.name = 'daniel-hq-plate';
  root.add(plate, sign);

  [40, 200].forEach((hue, i) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.78), new THREE.MeshBasicMaterial({ map: posterTexture(hue) }));
    p.position.set(-7.7, 1.45, 1.2 + i * 0.9);
    p.rotation.y = Math.PI / 2;
    root.add(p);
  });

  const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 1.4), new THREE.MeshStandardMaterial({ color: 0x4a3b2a, roughness: 0.6 }));
  shelf.position.set(-7.75, 1.05, 2.4);
  root.add(shelf);
  for (let i = 0; i < 4; i++) {
    const book = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.12), new THREE.MeshStandardMaterial({ color: [0xc4b5fd, 0xf0c8ee, 0x9fd0ff, 0xffd27a][i] }));
    book.position.set(-7.68, 1.16, 1.9 + i * 0.28);
    root.add(book);
  }

  const shaftMat = new THREE.MeshBasicMaterial({ color: 0xfff2d8, transparent: true, opacity: 0.08, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  for (const x of [-4, -1, 2]) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 3.2), shaftMat);
    s.position.set(x, 1.5, -4.2);
    s.rotation.x = -0.5;
    s.userData.dayShaft = true;
    root.add(s);
  }

  const stripMat = new THREE.MeshBasicMaterial({ color: 0xb388ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const [w, d, x, z] of [[8, 0.04, -2, -5.7], [8, 0.04, -2, 4.6], [0.04, 8, -7.6, -0.5]]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), stripMat);
    s.position.set(x, 0.03, z);
    s.userData.nightStrip = true;
    root.add(s);
  }

  const sky = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.2), new THREE.MeshBasicMaterial({ map: skylineTexture(), transparent: true, opacity: 0 }));
  sky.position.set(0, 1.3, -6.35);
  sky.userData.skyline = true;
  root.add(sky);

  const sheen = new THREE.Mesh(
    new THREE.PlaneGeometry(15.2, 11.2),
    new THREE.MeshPhysicalMaterial({ color: 0x2a1840, roughness: 0.18, metalness: 0.08, transparent: true, opacity: 0.14, envMapIntensity: 1, depthWrite: false }),
  );
  sheen.rotation.x = -Math.PI / 2;
  sheen.position.y = 0.012;
  sheen.name = 'floor-sheen';
  root.add(sheen);

  for (const [x, z] of [[-5.2, -2.6], [-0.4, 1.2]]) {
    const cable = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.012, 0.03), new THREE.MeshStandardMaterial({ color: 0x1a1224 }));
    cable.position.set(x, 0.02, z);
    cable.rotation.y = 0.4;
    root.add(cable);
  }
}

export function accentFor(name, mod) {
  if (mod) return new THREE.Color(0xc4a0ff);
  let h = 0;
  for (const c of String(name || 'floor')) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  return new THREE.Color().setHSL((h % 360) / 360, 0.5, 0.46);
}

export function syncRug(inst, color) {
  let rug = inst.root.getObjectByName('team-rug');
  if (!rug) {
    rug = new THREE.Mesh(new THREE.CircleGeometry(1.6, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.y = 0.015;
    rug.name = 'team-rug';
    inst.root.add(rug);
  }
  rug.material.color.copy(color);
  rug.position.x = -2;
  rug.position.z = -0.4;
}

export function tickPolish(root, night) {
  if (!root) return;
  const day = 1 - Math.min(1, Math.max(0, night));
  const n = Math.min(1, Math.max(0, night));
  root.traverse((o) => {
    if (!o.material) return;
    if (o.userData.dayShaft) o.material.opacity = 0.012 * day;
    if (o.userData.nightStrip) o.material.opacity = 0.9;
    if (o.userData.skyline) o.material.opacity = 0.9 * n;
  });
}

export function ensureDust(parent) {
  const n = level === 'high' && !REDUCED ? 36 : 0;
  if (n === 0) { if (dust) dust.visible = false; return; }
  if (!dust) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(36 * 3);
    for (let i = 0; i < 36; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 12;
      pos[i * 3 + 1] = 0.4 + Math.random() * 2.2;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 10;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    dust = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xefe6ff, size: 0.035, transparent: true, opacity: 0.45, depthWrite: false }));
    dust.name = 'dust';
    dust.frustumCulled = false;
  }
  if (dust.parent !== parent) parent.add(dust);
  dust.visible = true;
  dustN = n;
  dust.geometry.setDrawRange(0, n);
}

export function tickDust(dt) {
  if (!dust || !dust.visible || REDUCED) return;
  const arr = dust.geometry.attributes.position.array;
  for (let i = 0; i < dustN; i++) {
    arr[i * 3 + 1] += dt * 0.05;
    if (arr[i * 3 + 1] > 2.6) arr[i * 3 + 1] = 0.3;
  }
  dust.geometry.attributes.position.needsUpdate = true;
}
