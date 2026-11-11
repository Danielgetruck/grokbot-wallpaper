// One walled room per team, packed into a single hall. Group names are canvas text, drawn so Hebrew stays RTL.
import * as THREE from 'three';
import { isFamilyName, isLeadName, isMasterName } from './modteam.js?v=16';
import { buildFurniture } from './furniture.js?v=16';

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

/** One floor. Names decide the seats; feed groups are ignored. */
export function layoutHall(_floors, bots) {
  const all = (bots || []).filter((b) => b && b.id);
  const master = all.find((b) => isMasterName(b.name)) || null;
  const modLead = all.find((b) => isLeadName(b.name)) || null;
  const modFamily = all.filter((b) => b !== master && b !== modLead && isFamilyName(b.name));
  const rest = all.filter((b) => b !== master && b !== modLead && !isFamilyName(b.name));
  const spots = new Map();
  const hub = new THREE.Vector3(0, 0, 0);
  if (master) spots.set(master.id, { pos: hub.clone(), yaw: 0.35, lead: true, hub: true });

  const modCols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(Math.max(modFamily.length, 1)))));
  const modRows = Math.max(1, Math.ceil(modFamily.length / modCols));
  putGrid(spots, modFamily, -6.2 - (modCols - 1) * 2.45, -((modRows - 1) * 2.35) / 2, modCols, 2.45, 2.35);
  if (modLead) {
    const lx = -4.2;
    spots.set(modLead.id, { pos: new THREE.Vector3(lx, 0, 0), yaw: faceOrigin(lx, 0), lead: true });
  }

  const sides = [[], [], []];
  rest.forEach((b, i) => sides[i % 3].push(b));
  const sideCols = 4;
  sides.forEach((people, s) => {
    if (!people.length) return;
    const rows = Math.ceil(people.length / sideCols);
    if (s === 0) putGrid(spots, people, 4.4, -((rows - 1) * 2.35) / 2, sideCols, 2.45, 2.35);
    else if (s === 1) putGrid(spots, people, -((Math.min(sideCols, people.length) - 1) * 2.45) / 2, -5.6 - (rows - 1) * 2.35, sideCols, 2.45, -2.35);
    else putGrid(spots, people, -((Math.min(sideCols, people.length) - 1) * 2.45) / 2, 5.6, sideCols, 2.45, 2.35);
  });

  const links = [];
  for (const [id, s] of spots) {
    if (id === master?.id) continue;
    links.push({ a: s.pos, b: hub, id, lift: 0.22 });
  }
  let minX = -8, maxX = 8, minZ = -8, maxZ = 8;
  for (const s of spots.values()) {
    minX = Math.min(minX, s.pos.x - 1.6);
    maxX = Math.max(maxX, s.pos.x + 1.6);
    minZ = Math.min(minZ, s.pos.z - 1.6);
    maxZ = Math.max(maxZ, s.pos.z + 1.6);
  }
  const modMark = { x: -5.6, z: 0, w: Math.max(6, modCols * 2.45 + 2), d: Math.max(4, modRows * 2.35 + 3) };
  return {
    rooms: [{ id: 'office', name: 'הצוות', x: 0, z: 0, w: maxX - minX, d: maxZ - minZ }],
    spots, links, lounge: null,
    bounds: { minX, maxX, minZ, maxZ },
    modMark, hub,
    furn: master ? [...spots.values()] : [...spots.values(), { pos: hub.clone(), yaw: 0.35, lead: true }],
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
  g.fillStyle = '#120818';
  g.fillRect(0, 0, 2048, 512);
  g.strokeStyle = hex;
  g.lineWidth = 18;
  g.strokeRect(16, 16, 2016, 480);
  g.fillStyle = '#F8F1FF';
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
    g.fillStyle = alt ? '#d9d4cc' : '#c9c3ba';
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
  const fixture = new THREE.MeshStandardMaterial({ color: 0xd9d3c8, emissive: 0xffe7c2, emissiveIntensity: 0.28, roughness: 0.5 });
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
  g.fillStyle = '#2a2a33';
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = '#1c1c24';
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

function addIndoorGreens(root, cx, cz, fw, fd) {
  const n = 8;
  const pots = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.18, 0.14, 0.22, 7),
    new THREE.MeshStandardMaterial({ color: 0xc4784a, roughness: 0.7 }),
    n,
  );
  const leaves = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.28, 7, 5),
    new THREE.MeshStandardMaterial({ color: 0x2f9a4a, roughness: 0.62 }),
    n,
  );
  const o = new THREE.Object3D();
  const hx = Math.max(1.4, fw / 2 - 1.35);
  const hz = Math.max(1.4, fd / 2 - 1.35);
  const spots = [[-hx, -hz], [hx, -hz], [-hx, hz], [hx, hz], [0, -hz], [0, hz], [-hx, 0], [hx, 0]];
  spots.forEach(([x, z], i) => {
    o.position.set(cx + x, 0.12, cz + z);
    o.scale.set(1, 1, 1);
    o.rotation.set(0, 0, 0);
    o.updateMatrix();
    pots.setMatrixAt(i, o.matrix);
    o.position.y = 0.4;
    o.scale.set(1, 0.75, 1);
    o.updateMatrix();
    leaves.setMatrixAt(i, o.matrix);
  });
  root.add(pots, leaves);
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
  const frame = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.55, metalness: 0.04 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xc5cad3, roughness: 0.28, metalness: 0.72 });
  const glass = new THREE.MeshPhysicalMaterial({
    name: 'glass_pane',
    color: 0xb7d4f0, roughness: 0.06, metalness: 0.04, transparent: true, opacity: 0.2,
    emissive: 0x000000, emissiveIntensity: 0, envMapIntensity: 0.7, side: THREE.DoubleSide, depthWrite: false,
  });
  const neon = new THREE.MeshBasicMaterial({ color: 0xc084fc, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
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

export function buildHall(parent, layout) {
  const old = parent.getObjectByName('team-hall');
  if (old) {
    old.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
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
  addIndoorGreens(root, floor.position.x, floor.position.z, fw, fd);
  if (layout.modMark) {
    const m = layout.modMark;
    const neon = new THREE.MeshBasicMaterial({ color: 0xe9d5ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    for (const [w, d, x, z] of [
      [m.w, 0.045, m.x, m.z - m.d / 2], [m.w, 0.045, m.x, m.z + m.d / 2],
      [0.045, m.d, m.x - m.w / 2, m.z], [0.045, m.d, m.x + m.w / 2, m.z],
    ]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(w, 0.015, d), neon);
      line.position.set(x, 0.03, z);
      root.add(line);
    }
    const map = signTexture('MoD', 0xe9d5ff);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.42), new THREE.MeshBasicMaterial({ map, transparent: true, side: THREE.FrontSide, toneMapped: false }));
    sign.position.set(m.x, 1.35, m.z - m.d / 2);
    sign.userData.billboard = true;
    root.add(sign);
  }
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
