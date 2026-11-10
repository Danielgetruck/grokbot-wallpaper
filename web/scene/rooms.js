// One walled room per team, packed into a single hall. Group names are canvas text, drawn so Hebrew stays RTL.
import * as THREE from 'three';
import { isFamilyName, isLeadName } from './modteam.js';
import { buildFurniture } from './furniture.js';

const ACCENT = [0xc084fc, 0x22d3ee, 0xf0abfc, 0xa78bfa, 0x67e8f9, 0xe9d5ff, 0xfbbf24, 0x818cf8];

export function useHall(floors) {
  return Array.isArray(floors) && floors.length > 0 && floors.length <= 8;
}

function accent(i, mod) { return mod ? 0xe9d5ff : ACCENT[i % ACCENT.length]; }

function roomSize(n, mod) {
  const count = Math.max(n, 1);
  const cols = count <= 2 ? 2 : count <= 6 ? 3 : 4;
  const rows = Math.ceil(count / cols);
  let w = cols * 2.2 + 2.4;
  let d = rows * 2.05 + 2.3;
  if (mod) {
    const radius = 2.15 + Math.max(0, count - 1) * 0.16;
    const side = Math.max(8.6, radius * 2 + 3.4);
    w = Math.max(w, side);
    d = Math.max(d, side * 0.92);
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
  const pitchX = 2.15, pitchZ = 2.0;
  const ox = (cols - 1) * pitchX / 2;
  const rows = Math.ceil(bots.length / cols);
  const oz = (rows - 1) * pitchZ / 2;
  bots.forEach((b, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    map.set(b.id, {
      pos: new THREE.Vector3(cx - ox + c * pitchX, 0, cz - oz + r * pitchZ),
      yaw: 0.15,
    });
  });
  return map;
}

export function layoutHall(floors, bots) {
  const groups = floors.map((f, i) => {
    const members = bots.filter((b) => b.floor === f.id);
    const mod = isFamilyName(f.name) || members.some((b) => isLeadName(b.name)) || String(f.name || '').includes('MoD');
    const size = roomSize(members.length, mod);
    return { ...f, members, mod, ...size, color: accent(i, mod) };
  });
  const cols = groups.length > 3 ? Math.ceil(groups.length / 2) : Math.max(1, groups.length);
  const gap = 2.7;
  const rowH = [];
  for (let r = 0; r < Math.ceil(groups.length / cols); r++) {
    let h = 0;
    for (let c = 0; c < cols; c++) h = Math.max(h, groups[r * cols + c]?.d || 0);
    rowH.push(h);
  }
  const rowW = [];
  for (let r = 0; r < rowH.length; r++) {
    let w = 0;
    for (let c = 0; c < cols; c++) {
      const g = groups[r * cols + c];
      if (!g) continue;
      w += g.w + (c ? gap : 0);
    }
    rowW.push(w);
  }
  const totalD = rowH.reduce((s, h) => s + h, 0) + gap * Math.max(0, rowH.length - 1);
  const rowZ = [];
  let zCursor = -totalD / 2;
  for (let r = 0; r < rowH.length; r++) {
    rowZ[r] = zCursor + rowH[r] / 2;
    zCursor += rowH[r] + gap;
  }
  const lounge = rowH.length > 1
    ? { x: 0, z: -totalD / 2 + rowH[0] + gap / 2 }
    : { x: 0, z: rowZ[0] || 0 };
  const spots = new Map();
  const links = [];
  groups.forEach((g, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    let x0 = -rowW[r] / 2;
    for (let k = 0; k < c; k++) x0 += groups[r * cols + k].w + gap;
    g.x = x0 + g.w / 2;
    g.z = rowZ[r];
    g.door = { x: g.x, z: g.z + g.d / 2 };
    const local = seatsIn(g, g.members);
    for (const [id, s] of local) spots.set(id, s);
    const ids = [...local.keys()];
    const nLinks = ids.length > 2 ? ids.length : ids.length === 2 ? 1 : 0;
    for (let k = 0; k < nLinks; k++) {
      links.push({ a: local.get(ids[k]).pos, b: local.get(ids[(k + 1) % ids.length]).pos, wide: false, lift: 0.85 });
    }
    const lead = g.members.find((b) => isLeadName(b.name));
    if (lead && local.get(lead.id)) {
      for (const m of g.members) {
        if (m === lead || !isFamilyName(m.name)) continue;
        const s = local.get(m.id);
        if (s) links.push({ a: local.get(lead.id).pos, b: s.pos, wide: true, lift: 1.15 });
      }
    }
  });
  const mod = groups.find((g) => g.mod);
  const hub = mod?.members.find((b) => isLeadName(b.name)) || mod?.members[0];
  if (hub && spots.get(hub.id)) {
    for (const g of groups) {
      if (g === mod || !g.members[0]) continue;
      const other = spots.get(g.members[0].id);
      if (other) links.push({ a: spots.get(hub.id).pos, b: other.pos, wide: true, lift: 0.9, via: [mod.door, g.door] });
    }
  }
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const g of groups) {
    minX = Math.min(minX, g.x - g.w / 2);
    maxX = Math.max(maxX, g.x + g.w / 2);
    minZ = Math.min(minZ, g.z - g.d / 2);
    maxZ = Math.max(maxZ, g.z + g.d / 2);
  }
  if (!groups.length) { minX = -6; maxX = 6; minZ = -5; maxZ = 5; }
  return { rooms: groups, spots, links, lounge, bounds: { minX, maxX, minZ, maxZ } };
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
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(fw, fd),
    new THREE.MeshStandardMaterial({ color: 0x16101f, roughness: 0.92, metalness: 0.04 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((b.minX + b.maxX) / 2, 0.01, (b.minZ + b.maxZ) / 2);
  floor.receiveShadow = true;
  floor.name = 'hall-floor';
  root.add(floor);
  const lipMat = new THREE.MeshBasicMaterial({ color: 0xc084fc, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const lip = new THREE.Mesh(new THREE.RingGeometry(Math.max(fw, fd) * 0.5 - 0.08, Math.max(fw, fd) * 0.5, 4), lipMat);
  // A thin neon edge is drawn as four bars so it follows the rectangle, not a circle.
  const yLip = 0.03;
  const cx = floor.position.x, cz = floor.position.z;
  for (const [w, d, x, z] of [[fw, 0.06, cx, cz - fd / 2], [fw, 0.06, cx, cz + fd / 2], [0.06, fd, cx - fw / 2, cz], [0.06, fd, cx + fw / 2, cz]]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.025, d), lipMat);
    bar.position.set(x, yLip, z);
    root.add(bar);
  }
  lip.geometry.dispose();

  for (const room of layout.rooms) {
    const g = new THREE.Group();
    g.position.set(room.x, 0, room.z);
    const glass = new THREE.MeshPhysicalMaterial({
      color: room.color, transparent: true, opacity: 0.22, roughness: 0.08, metalness: 0.04,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const neon = new THREE.MeshBasicMaterial({ color: room.color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const hw = room.w / 2, hd = room.d / 2, door = 1.7;
    addWall(g, 0, -hd, room.w, 0.08, glass, neon);
    addWall(g, -hw, 0, 0.08, room.d, glass, neon);
    addWall(g, hw, 0, 0.08, room.d, glass, neon);
    const side = Math.max(0.3, (room.w - door) / 2);
    addWall(g, -hw + side / 2, hd, side, 0.08, glass, neon);
    addWall(g, hw - side / 2, hd, side, 0.08, glass, neon);
    const arch = new THREE.Mesh(new THREE.BoxGeometry(door + 0.15, 0.07, 0.12), neon);
    arch.position.set(0, 1.12, hd);
    g.add(arch);
    const carpet = new THREE.Mesh(
      new THREE.PlaneGeometry(room.w - 0.3, room.d - 0.3),
      carpetMaterial(room.color),
    );
    carpet.rotation.x = -Math.PI / 2;
    carpet.position.y = 0.02;
    carpet.receiveShadow = true;
    g.add(carpet);
    addCeiling(g, room);

    const sw = Math.min(room.w * 0.46, 3.6);
    const sh = 0.52;
    const map = signTexture(room.name, room.color);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), new THREE.MeshBasicMaterial({
      color: 0x14081c, side: THREE.FrontSide,
    }));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(sw * 0.98, sh * 0.9), new THREE.MeshBasicMaterial({
      map, side: THREE.FrontSide, toneMapped: false,
    }));
    plate.position.set(0, 1.85, hd + 0.15);
    sign.position.set(0, 1.85, hd + 0.2);
    plate.userData.billboard = sign.userData.billboard = true;
    plate.userData.roomId = sign.userData.roomId = room.id;
    g.add(plate, sign);
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(room.w - 0.4, room.d - 0.4), new THREE.MeshBasicMaterial({ visible: false }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.04;
    pad.userData.roomId = room.id;
    g.add(pad);
    root.add(g);
  }
  if (layout.lounge) addLounge(root, layout.lounge);
  buildFurniture(root, [...layout.spots.values()]);
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
