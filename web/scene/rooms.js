// One walled room per team, packed into a single hall. Group names are canvas text, drawn so Hebrew stays RTL.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { isLeadName, isMasterName, isNumberedModName } from './modteam.js?v=12';
import { buildFurniture } from './furniture.js?v=12';

const ACCENT = [0xc084fc, 0x22d3ee, 0xf0abfc, 0xa78bfa, 0x67e8f9, 0xe9d5ff, 0xfbbf24, 0x818cf8];

export function useHall(floors) {
  return Array.isArray(floors) && floors.length > 0 && floors.length <= 8;
}

function accent(i, mod) { return mod ? 0xe9d5ff : ACCENT[i % ACCENT.length]; }

const PITCH_X = 2.7;
const PITCH_Z = 2.55;

function roomSize(n, mod) {
  const count = Math.max(n, 1);
  const cols = count <= 4 ? 2 : count <= 9 ? 3 : 4;
  const rows = Math.ceil(count / cols);
  let w = cols * PITCH_X + 1.6;
  let d = rows * PITCH_Z + 1.6;
  if (mod) {
    const radius = 2.2 + Math.max(0, count - 1) * 0.22;
    const side = Math.max(w, radius * 2 + 3.2);
    w = side;
    d = Math.max(d, side * 0.9);
  }
  return { w, d, cols, rows };
}

function seatsIn(room, bots) {
  const map = new Map();
  const cx = room.x, cz = room.z;
  const lead = bots.find((b) => isLeadName(b.name));
  const rest = bots.filter((b) => b !== lead);
  if (room.mod && lead) {
    map.set(lead.id, { pos: new THREE.Vector3(cx, 0, cz), yaw: 0.35, lead: true });
    const n = rest.length;
    const radius = Math.min(room.w, room.d) * 0.34;
    rest.forEach((b, i) => {
      const a = n <= 1 ? 0.5 : -2.4 + (4.8 * i) / (n - 1);
      const x = cx + Math.sin(a) * radius;
      const z = cz + Math.cos(a) * radius * 0.82;
      map.set(b.id, { pos: new THREE.Vector3(x, 0, z), yaw: Math.atan2(cx - x, cz - z) });
    });
    return map;
  }
  const { cols } = roomSize(bots.length, false);
  const ox = (cols - 1) * PITCH_X / 2;
  const rows = Math.ceil(Math.max(bots.length, 1) / cols);
  const oz = (rows - 1) * PITCH_Z / 2;
  bots.forEach((b, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    map.set(b.id, {
      pos: new THREE.Vector3(cx - ox + c * PITCH_X, 0, cz - oz + r * PITCH_Z),
      yaw: 0.15,
    });
  });
  return map;
}

function faceOrigin(x, z) {
  return Math.atan2(-x, -z);
}

function putGrid(spots, people, x0, z0, cols, xStep, zStep) {
  people.forEach((b, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const x = x0 + c * xStep;
    const z = z0 + r * zStep;
    spots.set(b.id, { pos: new THREE.Vector3(x, 0, z), yaw: faceOrigin(x, z), lead: isLeadName(b.name) });
  });
}

const PX = 2.55;
const PZ = 2.45;
const SERVER = new THREE.Vector3(0, 0, 0);

function byName(a, b) {
  return String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * One floor. Names decide the seats; feed groups are ignored.
 * Daniel is the server at the middle (not a bot). Master sits beside it and talks to every bot
 * outside the MOD department. The head MoD sits in that department and talks to MoD2, Mod5, …
 * A missing Master or MoD simply drops the lines that would have started there.
 */
export function layoutHall(_floors, bots) {
  const all = (bots || []).filter((b) => b && b.id);
  const master = all.find((b) => isMasterName(b.name)) || null;
  const modLead = all.find((b) => b !== master && isLeadName(b.name)) || null;
  const modFamily = all.filter((b) => b !== master && b !== modLead && isNumberedModName(b.name)).sort(byName);
  const modIds = new Set(modFamily.map((b) => b.id));
  const rest = all.filter((b) => b !== master && b !== modLead && !modIds.has(b.id)).sort(byName);
  const spots = new Map();

  if (master) {
    const x = 2.75, z = -1.05;
    spots.set(master.id, { pos: new THREE.Vector3(x, 0, z), yaw: Math.atan2(-x, -z), lead: true, role: 'master' });
  }

  const modCols = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(Math.max(modFamily.length, 1)))));
  const modRows = Math.max(1, Math.ceil((modFamily.length || 1) / modCols));
  const headX = -4.4;
  if (modFamily.length) {
    const right = headX - (modLead ? 2.2 : 0);
    const x0 = right - (modCols - 1) * PX;
    const z0 = -((modRows - 1) * PZ) / 2;
    putGrid(spots, modFamily, x0, z0, modCols, PX, PZ);
    const aim = modLead ? new THREE.Vector3(headX, 0, 0) : SERVER;
    for (const b of modFamily) {
      const s = spots.get(b.id);
      s.yaw = Math.atan2(aim.x - s.pos.x, aim.z - s.pos.z);
      s.mod = true;
    }
  }
  if (modLead) {
    spots.set(modLead.id, {
      pos: new THREE.Vector3(headX, 0, 0),
      yaw: Math.atan2(-headX, 0),
      lead: true,
      role: 'mod',
    });
  }

  const sides = [[], [], []];
  rest.forEach((b, i) => sides[i % 3].push(b));
  const sideCols = 4;
  const rightX = master ? 6.15 : 3.5;
  sides.forEach((people, s) => {
    if (!people.length) return;
    const rows = Math.ceil(people.length / sideCols);
    if (s === 0) putGrid(spots, people, rightX, -((rows - 1) * PZ) / 2, sideCols, PX, PZ);
    else if (s === 1) putGrid(spots, people, 1.15, -6.5 - (rows - 1) * PZ, sideCols, PX, -PZ);
    else putGrid(spots, people, 1.15, 6.5, sideCols, PX, PZ);
  });

  const links = [];
  const masterSpot = master ? spots.get(master.id) : null;
  const leadSpot = modLead ? spots.get(modLead.id) : null;
  if (masterSpot) {
    links.push({ a: SERVER.clone(), b: masterSpot.pos.clone(), id: master.id, lift: 0.42, wide: true, ay: 1.35, by: 0.72 });
    for (const b of rest) {
      const s = spots.get(b.id);
      if (s) links.push({ a: masterSpot.pos.clone(), b: s.pos.clone(), id: b.id, lift: 0.36 });
    }
  }
  if (leadSpot) {
    links.push({ a: SERVER.clone(), b: leadSpot.pos.clone(), id: modLead.id, lift: 0.38, wide: true, ay: 1.25, by: 0.72 });
    for (const b of modFamily) {
      const s = spots.get(b.id);
      if (s) links.push({ a: leadSpot.pos.clone(), b: s.pos.clone(), id: b.id, lift: 0.26 });
    }
  }

  let minX = -3.2, maxX = 3.2, minZ = -3.2, maxZ = 3.2;
  const cover = (x, z, p) => {
    minX = Math.min(minX, x - p); maxX = Math.max(maxX, x + p);
    minZ = Math.min(minZ, z - p); maxZ = Math.max(maxZ, z + p);
  };
  cover(0, 0, 2.2);
  for (const s of spots.values()) cover(s.pos.x, s.pos.z, 1.7);

  let modMark = null;
  if (modLead || modFamily.length) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const take = (x, z) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); };
    if (modLead) take(headX, 0);
    for (const b of modFamily) { const s = spots.get(b.id); if (s) take(s.pos.x, s.pos.z); }
    const padX = 1.65, padZ = 1.5;
    modMark = { x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: Math.max(4.4, x1 - x0 + padX * 2), d: Math.max(3.8, z1 - z0 + padZ * 2) };
    cover(modMark.x - modMark.w / 2, modMark.z, 0.3);
    cover(modMark.x + modMark.w / 2, modMark.z, 0.3);
    cover(modMark.x, modMark.z - modMark.d / 2, 0.3);
    cover(modMark.x, modMark.z + modMark.d / 2, 0.3);
  }

  return {
    rooms: [{ id: 'office', name: 'הצוות', x: 0, z: 0, w: maxX - minX, d: maxZ - minZ }],
    spots, links, lounge: null,
    bounds: { minX, maxX, minZ, maxZ },
    modMark,
    hub: SERVER.clone(),
    server: SERVER.clone(),
    furn: [...spots.values()],
  };
}


function signTexture(name, color) {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 512;
  const hebrew = /[\u0590-\u05FF]/.test(name);
  if (hebrew) c.setAttribute('dir', 'rtl');
  const g = c.getContext('2d');
  g.clearRect(0, 0, 2048, 512);
  const hex = '#' + color.toString(16).padStart(6, '0');
  g.fillStyle = '#07111f';
  g.fillRect(0, 0, 2048, 512);
  g.strokeStyle = hex;
  g.lineWidth = 18;
  g.strokeRect(16, 16, 2016, 480);
  g.fillStyle = '#E7F4FF';
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  g.direction = hebrew ? 'rtl' : 'ltr';
  const label = String(name || '').slice(0, 22);
  let size = 220;
  g.font = `700 ${size}px "DejaVu Sans", "Noto Serif Hebrew", sans-serif`;
  while (size > 96 && g.measureText(label).width > 1840) {
    size -= 10;
    g.font = `700 ${size}px "DejaVu Sans", "Noto Serif Hebrew", sans-serif`;
  }
  g.fillText(label, 1024, 268);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  return t;
}

function addWall(g, x, z, w, d, mat, neon) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 1.05, d), mat);
  wall.position.set(x, 0.54, z);
  wall.castShadow = true;
  const strip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.07, Math.max(d, 0.1)), neon);
  strip.position.set(x, 1.1, z);
  g.add(wall, strip);
}

const lit = (color, roughness, metalness, emissive = 0x000000, emissiveIntensity = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive, emissiveIntensity });

let carpetMap = null;
function carpetTiles() {
  if (carpetMap) return carpetMap;
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  const tile = 64;
  for (let y = 0; y < 512; y += tile) for (let x = 0; x < 512; x += tile) {
    const alt = ((x / tile) + (y / tile)) % 2 === 0;
    g.fillStyle = alt ? '#d7e0ea' : '#c5d0dc';
    g.fillRect(x, y, tile, tile);
    g.strokeStyle = 'rgba(80,70,60,0.35)';
    g.strokeRect(x + 0.5, y + 0.5, tile - 1, tile - 1);
  }
  carpetMap = new THREE.CanvasTexture(c);
  carpetMap.wrapS = carpetMap.wrapT = THREE.RepeatWrapping;
  carpetMap.colorSpace = THREE.SRGBColorSpace;
  carpetMap.anisotropy = 8;
  return carpetMap;
}

function carpetMaterial(color) {
  const map = carpetTiles().clone();
  map.repeat.set(4, 3);
  map.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ map, color, roughness: 0.92, metalness: 0.02 });
}

function addCeiling(g, room) {
  const fixture = new THREE.MeshStandardMaterial({ color: 0xd5dee8, emissive: 0xd6e6ff, emissiveIntensity: 0.32, roughness: 0.5 });
  const w = Math.min(room.w * 0.28, 1.4);
  for (const z of [-room.d * 0.16, room.d * 0.16]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.035, 0.22), fixture);
    bar.position.set(0, 2.45, z);
    g.add(bar);
  }
}

function addLounge(root, at) {
  const g = new THREE.Group();
  g.name = 'hall-lounge';
  g.position.set(at.x, 0, at.z);
  const rug = new THREE.Mesh(
    new THREE.CircleGeometry(1.15, 28),
    new THREE.MeshStandardMaterial({ color: 0x3b1764, roughness: 0.9 }),
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.y = 0.025;
  rug.receiveShadow = true;
  const seatMat = lit(0x241833, 0.86, 0.02);
  for (const [x, z, yaw] of [[-0.7, 0.15, 0.5], [0.7, -0.1, -0.4]]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.28, 0.42), seatMat);
    seat.position.set(x, 0.22, z);
    seat.rotation.y = yaw;
    seat.castShadow = true;
    g.add(seat);
  }
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.16, 10), lit(0xd9d3c8, 0.7, 0.02));
  pot.position.set(0, 0.12, 0.85);
  const plant = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.55, 8), lit(0x1f6b45, 0.8, 0));
  plant.position.set(0, 0.46, 0.85);
  g.add(rug, pot, plant);
  root.add(g);
}

let floorMat = null;

function whiteFloorMaterial() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#243044';
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = '#1a2433';
  g.lineWidth = 3;
  const tile = 64;
  for (let i = 0; i <= 512; i += tile) {
    g.beginPath();
    g.moveTo(i, 0); g.lineTo(i, 512); g.stroke();
    g.beginPath();
    g.moveTo(0, i); g.lineTo(512, i); g.stroke();
  }
  const map = new THREE.CanvasTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(6, 5);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return new THREE.MeshStandardMaterial({
    map, color: 0xffffff, roughness: 0.42, metalness: 0.18, envMapIntensity: 0.38,
  });
}

function starField(w, d, at) {
  const n = 70;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * (w + 6);
    pos[i * 3 + 1] = 2.6 + Math.random() * 5;
    pos[i * 3 + 2] = -d * 0.55 - Math.random() * 3;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xf4f0ff, size: 0.07, transparent: true, opacity: 0.9, depthWrite: false }));
  pts.position.set(at.x, 0, at.z);
  pts.name = 'hall-stars';
  return pts;
}

let neonStrips = [];

function addShell(root, cx, cz, fw, fd) {
  const hx = fw / 2, hz = fd / 2;
  const wallH = 2.55;
  const cutH = 0.42;
  const frame = new THREE.MeshStandardMaterial({ color: 0xe7eef6, roughness: 0.55, metalness: 0.04 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xc5cad3, roughness: 0.28, metalness: 0.72 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x1a2744, roughness: 0.15, metalness: 0.04, transparent: true, opacity: 0.22,
    emissive: 0x000000, emissiveIntensity: 0, side: THREE.DoubleSide, depthWrite: false,
  });
  const neon = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  neonStrips = [];

  const base = (w, d, x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, cutH, d), frame);
    m.position.set(cx + x, cutH / 2, cz + z);
    m.castShadow = true;
    const strip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.035, Math.max(d, 0.08)), neon);
    strip.position.set(cx + x, 0.05, cz + z);
    neonStrips.push(strip);
    root.add(m, strip);
  };
  base(fw, 0.16, 0, -hz);
  base(fw, 0.16, 0, hz);
  base(0.16, fd, -hx, 0);
  base(0.16, fd, hx, 0);

  const windowWall = (length, tall, x, z, rotY, skipCenter) => {
    const g = new THREE.Group();
    g.position.set(cx + x, 0, cz + z);
    g.rotation.y = rotY;
    const span = length;
    const winW = Math.min(2.2, span * 0.22);
    const gap = span / 3;
    const panelW = Math.max(0.3, gap - winW - 0.15);
    for (const px of [-gap / 2, gap / 2]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(panelW, tall - cutH, 0.1), frame);
      panel.position.set(px, (tall + cutH) / 2, 0);
      g.add(panel);
    }
    for (const ox of [-gap, 0, gap]) {
      if (skipCenter && ox === 0) continue;
      if (Math.abs(ox) + winW / 2 > span / 2 - 0.3) continue;
      const sill = new THREE.Mesh(new THREE.BoxGeometry(winW + 0.16, 0.12, 0.12), metal);
      sill.position.set(ox, cutH + 0.35, 0);
      const header = new THREE.Mesh(new THREE.BoxGeometry(winW + 0.16, 0.1, 0.12), metal);
      header.position.set(ox, tall - 0.15, 0);
      const left = new THREE.Mesh(new THREE.BoxGeometry(0.06, tall - cutH - 0.5, 0.1), metal);
      left.position.set(ox - winW / 2, (cutH + tall) / 2, 0);
      const right = left.clone();
      right.position.x = ox + winW / 2;
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(winW, tall - cutH - 0.7), glass);
      pane.position.set(ox, (cutH + tall) / 2 + 0.05, 0.02);
      g.add(sill, header, left, right, pane);
    }
    const pierL = new THREE.Mesh(new THREE.BoxGeometry(0.2, tall - cutH, 0.14), frame);
    pierL.position.set(-span / 2 + 0.1, (tall + cutH) / 2, 0);
    const pierR = pierL.clone();
    pierR.position.x = span / 2 - 0.1;
    g.add(pierL, pierR);
    root.add(g);
  };
  windowWall(fw - 1.2, wallH, 0, -hz, 0, true);
  windowWall(fd - 1.2, wallH, -hx, 0, Math.PI / 2, false);

  const door = (x, z, rotY, wide) => {
    const g = new THREE.Group();
    g.position.set(cx + x, 0, cz + z);
    g.rotation.y = rotY;
    const dw = wide ? 1.7 : 1.05;
    const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.15, 0.12), metal);
    const jl = jamb.clone(); jl.position.set(-dw / 2, 1.1, 0);
    const jr = jamb.clone(); jr.position.set(dw / 2, 1.1, 0);
    const head = new THREE.Mesh(new THREE.BoxGeometry(dw + 0.16, 0.1, 0.12), metal);
    head.position.set(0, 2.15, 0);
    const leafW = wide ? dw / 2 - 0.06 : dw - 0.1;
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(leafW, 1.9), glass);
    if (wide) {
      const a = leaf.clone(); a.position.set(-leafW / 2 - 0.02, 1.05, 0.03);
      const b = leaf.clone(); b.position.set(leafW / 2 + 0.02, 1.05, 0.03);
      g.add(a, b);
    } else {
      leaf.position.set(0, 1.05, 0.03);
      g.add(leaf);
    }
    g.add(jl, jr, head);
    root.add(g);
  };
  door(0, -hz, 0, true);
  door(-hx, hz * 0.35, Math.PI / 2, false);
  door(hx, -hz * 0.2, -Math.PI / 2, false);
}

export function tickFloor(t) {
  const pulse = 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(t * 1.6));
  for (const s of neonStrips) if (s.material) s.material.opacity = pulse;
  const stars = floorMat && floorMat.userData.stars;
  if (stars) stars.material.opacity = 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(t * 2.2));
}

function danielLabel() {
  const el = document.createElement('div');
  el.className = 'hqt';
  el.dataset.mode = 'hover';
  el.style.setProperty('--c', '#38bdf8');
  const pill = document.createElement('div');
  pill.className = 'hqt-pill';
  const dot = document.createElement('i');
  dot.className = 'hqt-dot';
  const text = document.createElement('span');
  text.className = 'hqt-text';
  text.textContent = 'Daniel';
  pill.append(dot, text);
  const stem = document.createElement('div');
  stem.className = 'hqt-stem';
  el.append(pill, stem);
  const obj = new CSS2DObject(el);
  obj.center.set(0.5, 1);
  obj.position.set(0, 2.72, 0);
  obj.name = 'daniel-label';
  return obj;
}

function addServer(root, at) {
  const g = new THREE.Group();
  g.name = 'daniel-server';
  g.position.set(at.x, 0, at.z);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x121820, metalness: 0.72, roughness: 0.34 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x243246, metalness: 0.62, roughness: 0.38 });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x67e8f9, toneMapped: false });
  const dimMat = new THREE.MeshBasicMaterial({ color: 0x0e7490, toneMapped: false });
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.38, 0.12, 0.92), trimMat);
  plinth.position.y = 0.06;
  plinth.castShadow = true;
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.05, 2.15, 0.62), bodyMat);
  body.position.y = 1.2;
  body.castShadow = true;
  g.add(plinth, body);
  for (let i = 0; i < 6; i++) {
    const bay = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.07, 0.02), i % 2 ? glowMat : dimMat);
    bay.position.set(0, 0.48 + i * 0.26, 0.32);
    g.add(bay);
  }
  for (let i = 0; i < 5; i++) {
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.38), dimMat);
    vent.position.set(0.535, 0.55 + i * 0.3, 0);
    g.add(vent);
  }
  const cap = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.08, 0.7), trimMat);
  cap.position.y = 2.32;
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.26, 8), trimMat);
  ant.position.y = 2.48;
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), glowMat);
  tip.position.y = 2.64;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.72, 0.9, 40),
    new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  g.add(cap, ant, tip, ring, danielLabel());
  root.add(g);
}

function addModRoom(root, zone) {
  const { x, z, w, d } = zone;
  const h = 1.28;
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x9fd0ff, roughness: 0.08, metalness: 0.05, transparent: true, opacity: 0.2,
    side: THREE.DoubleSide, depthWrite: false, emissive: 0x123048, emissiveIntensity: 0.18,
  });
  const rail = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const postMat = new THREE.MeshStandardMaterial({ color: 0x1b2838, metalness: 0.7, roughness: 0.32 });
  const pad = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.max(0.4, w - 0.12), Math.max(0.4, d - 0.12)),
    new THREE.MeshStandardMaterial({ color: 0xb7c8da, roughness: 0.86, metalness: 0.02 }),
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(x, 0.022, z);
  pad.receiveShadow = true;
  root.add(pad);
  const hx = w / 2, hz = d / 2;
  const panel = (ww, dd, px, pz) => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(ww, h, dd), glass);
    wall.position.set(x + px, h / 2 + 0.04, z + pz);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(ww, 0.045, Math.max(dd, 0.06)), rail);
    lip.position.set(x + px, h + 0.06, z + pz);
    root.add(wall, lip);
  };
  panel(w, 0.05, 0, -hz);
  panel(w, 0.05, 0, hz);
  panel(0.05, d, -hx, 0);
  const gap = Math.min(1.35, Math.max(0.8, d * 0.28));
  const seg = Math.max(0.2, (d - gap) / 2);
  panel(0.05, seg, hx, -(hz - seg / 2));
  panel(0.05, seg, hx, hz - seg / 2);
  for (const [px, pz] of [[-hx, -hz], [hx, -hz], [-hx, hz], [hx, hz]]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, h + 0.08, 0.08), postMat);
    post.position.set(x + px, (h + 0.08) / 2, z + pz);
    root.add(post);
  }
  const map = signTexture('MOD', 0x38bdf8);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.4), new THREE.MeshBasicMaterial({ map, transparent: true, side: THREE.FrontSide, toneMapped: false }));
  sign.position.set(x, 1.72, z + hz + 0.04);
  sign.userData.billboard = true;
  root.add(sign);
}

export function buildHall(parent, layout) {
  const old = parent.getObjectByName('team-hall');
  if (old) {
    old.traverse((o) => {
      if (o.element?.parentNode) o.element.remove();
      if (o.geometry) o.geometry.dispose();
    });
    old.removeFromParent();
  }
  const root = new THREE.Group();
  root.name = 'team-hall';
  const b = layout.bounds;
  const pad = 1.8;
  const fw = (b.maxX - b.minX) + pad * 2;
  const fd = (b.maxZ - b.minZ) + pad * 2;
  floorMat = whiteFloorMaterial();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((b.minX + b.maxX) / 2, 0.01, (b.minZ + b.maxZ) / 2);
  floor.receiveShadow = true;
  floor.name = 'hall-floor';
  root.add(floor);
  addShell(root, floor.position.x, floor.position.z, fw, fd);
  const stars = starField(fw, fd, floor.position);
  floorMat.userData.stars = stars;
  root.add(stars);
  if (layout.modMark) addModRoom(root, layout.modMark);
  addServer(root, layout.server || layout.hub || new THREE.Vector3());
  buildFurniture(root, layout.furn || [...layout.spots.values()]);
  parent.add(root);
  return root;
}

export function clearHall(parent) {
  parent.getObjectByName('team-hall')?.removeFromParent();
}

/** Match the camera so the plane's front (+Z) points back at the lens. Canvas text stays unmirrored. */
export function faceSign(mesh, camera) {
  mesh.quaternion.copy(camera.quaternion);
}
