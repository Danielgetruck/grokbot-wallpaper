// Per-desk life on top of the purple office: status lamps, nameplates, laptop screens, one cat,
// and the occasional envelope. Feed text is drawn with canvas fillText or textContent, never HTML.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { REDUCED } from './spring.js?v=19';
import { sharpTexture } from './tex.js?v=19';
import { spawnRipple } from './packets.js?v=19';

const LIGHT = {
  working: { hex: 0xb7dcff, em: 2.1 },
  idle: { hex: 0x5c5670, em: 0.16 },
  waiting_user: { hex: 0xff9f0a, em: 2.5, pulse: true },
  error: { hex: 0xff3b30, em: 1.9 },
  stuck: { hex: 0x8d7358, em: 0.4 },
  done: { hex: 0x6f93ff, em: 0.5 },
};
const EMPTY = { hex: 0x3a2458, em: 0.06 };

const mail = [];
let cat = null, catWay = 0, catHearts = [];
const heartTex = heartTexture();

function clip(s, n) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  sharpTexture(tex);
  return { c, g: c.getContext('2d'), tex };
}

function bind(inst) {
  if (inst.life) return inst.life;
  const desks = [];
  for (let i = 0; i < 20; i++) {
    const nn = String(i + 1).padStart(2, '0');
    const plate = inst.obj.getObjectByName(`nameplate_${nn}`);
    const bulb = inst.obj.getObjectByName(`status_lamp_${nn}`)?.getObjectByName('status_bulb');
    const screen = inst.obj.getObjectByName(`laptop_screen_${nn}`);
    const screenCv = screen ? canvas(768, 432) : null;
    let label = null;
    if (plate) {
      plate.material.opacity = 0;
      const el = document.createElement('div');
      el.className = 'hq-nameplate';
      el.hidden = true;
      const name = document.createElement('b');
      const sub = document.createElement('span');
      el.append(name, sub);
      const obj = new CSS2DObject(el);
      obj.center.set(0.5, 1);
      plate.add(obj);
      label = { el, name, sub };
    }
    if (screen && screenCv && screen.material) {
      const m = screen.material;
      m.userData.lifeOwned = true;
      m.map = screenCv.tex;
      m.emissiveMap = screenCv.tex;
      m.color.set(0xffffff);
      m.needsUpdate = true;
    }
    desks.push({ plate, label, bulb, screen, screenCv, key: '' });
  }
  inst.life = { desks };
  return inst.life;
}

function drawScreen(cv, mode, step) {
  const g = cv.g, w = cv.c.width, h = cv.c.height;
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, mode === 'work' ? '#1a2744' : '#1a1030');
  bg.addColorStop(1, mode === 'work' ? '#0e1830' : '#120a22');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  if (mode === 'work' && step) {
    g.fillStyle = '#D7E8FF';
    g.font = '600 28px Inter, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const lines = wrap(g, clip(step, 64), w - 28);
    lines.forEach((ln, i) => g.fillText(ln, w / 2, h / 2 + (i - (lines.length - 1) / 2) * 32));
  } else {
    g.fillStyle = 'rgba(180, 150, 255, 0.35)';
    g.fillRect(28, h / 2 - 6, w * 0.42, 8);
    g.fillStyle = 'rgba(180, 150, 255, 0.18)';
    g.fillRect(28, h / 2 + 14, w * 0.28, 6);
  }
  cv.tex.needsUpdate = true;
}

function wrap(g, text, max) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (g.measureText(t).width > max && line) { lines.push(line); line = w; }
    else line = t;
    if (lines.length === 2) break;
  }
  if (lines.length < 2 && line) lines.push(line);
  return lines.slice(0, 2);
}

/** desks: 20 entries of { name, step, status, routine } or null. */
export function applyDesks(inst, desks) {
  if (!inst) return;
  const life = bind(inst);
  life.desks.forEach((d, i) => {
    const bot = desks[i];
    const status = bot?.status || '';
    const key = bot ? `${status}|${bot.step || ''}|${bot.name || ''}|${bot.routine || ''}` : '';
    if (d.plate && d.label) {
      const loud = status === 'working' || status === 'waiting_user' || status === 'error';
      d.plate.visible = !!bot?.name;
      d.label.el.hidden = !loud;
      d.priority = status === 'waiting_user' || status === 'error' ? 3 : status === 'working' ? 2 : 0;
      if (bot?.name && key !== d.key) {
        d.label.name.textContent = clip(bot.name, 22);
        d.label.sub.textContent = '';
      }
    }
    if (d.screenCv && key !== d.key) drawScreen(d.screenCv, status === 'working' ? 'work' : 'ambient', bot?.step);
    d.key = key;
    const look = LIGHT[status] || EMPTY;
    if (d.bulb?.material) {
      d.bulb.material.emissive.setHex(look.hex);
      d.bulb.userData.em = look.em;
      d.bulb.userData.pulse = !!look.pulse;
    }
    if (d.screen?.material && status) {
      d.screen.material.emissive.setHex(status === 'working' ? 0xc5e2ff : look.hex);
      d.screenEm = status === 'working' ? 1.35 : Math.min(look.em, 0.45);
      d.screenPulse = !!look.pulse;
    } else if (d.screen?.material) {
      d.screen.material.emissive.setHex(0x6a5a88);
      d.screenEm = 0.08;
      d.screenPulse = false;
    }
  });
}

/** Drop lower-priority labels that would sit on top of each other in screen space. */
export function cullLabels(camera, inst) {
  const life = inst?.life;
  if (!life || !camera) return;
  const shown = [];
  const v = new THREE.Vector3();
  for (const d of life.desks) {
    const el = d.label?.el;
    if (!el || el.hidden || !d.plate) continue;
    d.plate.getWorldPosition(v).project(camera);
    shown.push({ el, x: v.x, y: v.y, pri: d.priority || 0 });
  }
  shown.sort((a, b) => b.pri - a.pri);
  const kept = [];
  for (const p of shown) {
    const hit = kept.some((k) => Math.hypot(k.x - p.x, k.y - p.y) < 0.11);
    p.el.style.opacity = hit ? '0' : '1';
    if (!hit) kept.push(p);
  }
}

export function tick(inst, dt, t) {
  if (!inst) return;
  const life = inst.life;
  if (life) {
    const pulse = REDUCED ? 1 : 0.62 + 0.38 * Math.sin(t * 5);
    for (const d of life.desks) {
      if (!d.bulb?.material) continue;
      const em = d.bulb.userData.em ?? 0.05;
      d.bulb.material.emissiveIntensity = d.bulb.userData.pulse ? em * pulse : em;
      if (d.screen?.material) {
        const se = d.screenEm ?? 0.08;
        d.screen.material.emissiveIntensity = d.screenPulse ? se * pulse : se;
      }
    }
  }
  tickCat(inst, dt, t);
  tickMail(dt);
  tickHearts(dt);
}

export function ensureCat(inst, pickables) {
  if (!cat) cat = makeCat();
  if (cat.parent !== inst.root) inst.root.add(cat);
  cat.traverse((o) => { if (o.isMesh && pickables) pickables.add(o); });
}

export function petCat() {
  if (!cat) return;
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: heartTex, transparent: true, depthWrite: false }));
    s.position.copy(cat.position);
    s.position.y += 0.45;
    s.scale.setScalar(0.18);
    s.userData.v = new THREE.Vector3((i - 1) * 0.15, 0.55, 0);
    s.userData.t = 0;
    cat.parent.add(s);
    catHearts.push(s);
  }
}

export function sendMail(from, to, parent) {
  if (!from || !to || from === to || REDUCED) return;
  if (mail.length > 2) return;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(0.2, 0.13),
    new THREE.MeshBasicMaterial({ color: 0xe7f3ff, side: THREE.DoubleSide }),
  );
  m.position.copy(from);
  m.position.y = 1.05;
  parent.add(m);
  mail.push({ m, from: from.clone(), to: to.clone(), t: 0 });
}

function tickMail(dt) {
  for (let i = mail.length - 1; i >= 0; i--) {
    const e = mail[i];
    e.t += dt;
    const k = Math.min(1, e.t / 1.15);
    e.m.position.lerpVectors(e.from, e.to, k);
    e.m.position.y = 1.05 + Math.sin(k * Math.PI) * 0.85;
    e.m.rotation.y += dt * 3;
    if (k >= 1) {
      spawnRipple(e.m.parent, e.to);
      e.m.removeFromParent();
      e.m.material.dispose();
      mail.splice(i, 1);
    }
  }
}

function tickHearts(dt) {
  for (let i = catHearts.length - 1; i >= 0; i--) {
    const s = catHearts[i];
    s.userData.t += dt;
    s.position.addScaledVector(s.userData.v, dt);
    s.material.opacity = Math.max(0, 1 - s.userData.t / 0.9);
    if (s.userData.t > 0.9) { s.removeFromParent(); s.material.dispose(); catHearts.splice(i, 1); }
  }
}

const WAYS = [[-4.2, -0.4], [-1.2, -0.5], [1.4, 0.2], [4.6, 1.6], [6.2, 3.2], [3.2, 3.4], [-2.4, 1.2]];
function tickCat(inst, dt, t) {
  if (!cat || cat.parent !== inst.root) return;
  if (REDUCED) { cat.position.set(-2, 0, 1); return; }
  const target = WAYS[catWay];
  const dx = target[0] - cat.position.x, dz = target[1] - cat.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.08) catWay = (catWay + 1) % WAYS.length;
  else {
    const step = Math.min(dist, dt * 0.42);
    cat.position.x += (dx / dist) * step;
    cat.position.z += (dz / dist) * step;
    cat.rotation.y = Math.atan2(dx, dz);
  }
  cat.position.y = Math.abs(Math.sin(t * 8)) * 0.03;
}

function makeCat() {
  const fur = new THREE.MeshStandardMaterial({ color: 0x3a4454, roughness: 0.72 });
  const g = new THREE.Group();
  g.name = 'office_cat';
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), fur);
  body.scale.set(1.35, 0.8, 0.85);
  body.position.y = 0.16;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10), fur);
  head.position.set(0.14, 0.28, 0);
  const earGeo = new THREE.ConeGeometry(0.035, 0.07, 6);
  const earL = new THREE.Mesh(earGeo, fur); earL.position.set(0.1, 0.38, 0.05);
  const earR = new THREE.Mesh(earGeo, fur); earR.position.set(0.1, 0.38, -0.05);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.22, 6), fur);
  tail.position.set(-0.2, 0.24, 0);
  tail.rotation.z = 0.8;
  g.add(body, head, earL, earR, tail);
  g.traverse((o) => { if (o.isMesh) o.userData.cat = true; });
  g.position.set(-2, 0, 1);
  g.scale.setScalar(1.7);
  return g;
}

function heartTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#ff6b8a';
  g.beginPath();
  g.moveTo(32, 54);
  g.bezierCurveTo(4, 34, 8, 10, 32, 22);
  g.bezierCurveTo(56, 10, 60, 34, 32, 54);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Another bot's name inside a step counts as a note from this bot to that one. Names under 3 letters are skipped. */
export function addressedTo(step, bots, selfId) {
  const text = String(step || '');
  if (text.length < 3) return null;
  let found = null;
  for (const b of bots) {
    if (!b || b.id === selfId) continue;
    const name = String(b.name || '').trim();
    if (name.length < 3) continue;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}\\p{N}]|$)`, 'u');
    if (re.test(text) && (!found || name.length > found.name.length)) found = b;
  }
  return found;
}
