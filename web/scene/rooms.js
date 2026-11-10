// One walled room per team, all of them in the same hall. Group names are drawn with canvas text.
import * as THREE from 'three';
import { isFamilyName, isLeadName } from './modteam.js';

const ACCENT = [0xc084fc, 0x22d3ee, 0xf0abfc, 0xa78bfa, 0x67e8f9, 0xe9d5ff, 0xfbbf24, 0x818cf8];

export function useHall(floors) {
  return Array.isArray(floors) && floors.length > 0 && floors.length <= 8;
}

function accent(i, mod) { return mod ? 0xe9d5ff : ACCENT[i % ACCENT.length]; }

function roomSize(n, mod) {
  const cols = Math.max(2, Math.ceil(Math.sqrt(Math.max(n, 1))));
  const rows = Math.max(1, Math.ceil(Math.max(n, 1) / cols));
  const w = Math.max(mod ? 20 : 14, cols * 3.6 + 6);
  const d = Math.max(mod ? 18 : 12, rows * 3.4 + 6);
  return { w, d, cols, rows };
}

function seatsIn(room, bots) {
  const map = new Map();
  const cx = room.x, cz = room.z;
  const lead = bots.find((b) => isLeadName(b.name));
  const rest = bots.filter((b) => b !== lead);
  if (room.mod && lead) {
    map.set(lead.id, { pos: new THREE.Vector3(cx, 0.42, cz), yaw: 0.2, lead: true });
    const n = rest.length;
    rest.forEach((b, i) => {
      const a = n <= 1 ? 0.4 : -2.5 + (5 * i) / (n - 1);
      const r = Math.min(room.w, room.d) * 0.32;
      const x = cx + Math.sin(a) * r;
      const z = cz + Math.cos(a) * r * 0.85;
      map.set(b.id, { pos: new THREE.Vector3(x, 0.42, z), yaw: Math.atan2(cx - x, cz - z) });
    });
    return map;
  }
  const { cols } = roomSize(bots.length, false);
  bots.forEach((b, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    const x = cx - room.w * 0.28 + c * 3.5;
    const z = cz - room.d * 0.22 + r * 3.3;
    map.set(b.id, { pos: new THREE.Vector3(x, 0.42, z), yaw: 0 });
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
  const cols = groups.length > 3 ? Math.ceil(groups.length / 2) : groups.length;
  const gap = 7;
  const rowH = [];
  for (let r = 0; r < Math.ceil(groups.length / cols); r++) {
    let h = 0;
    for (let c = 0; c < cols; c++) h = Math.max(h, groups[r * cols + c]?.d || 0);
    rowH.push(h);
  }
  const rowW = [];
  for (let r = 0; r < rowH.length; r++) {
    let w = 0;
    for (let c = 0; c < cols; c++) w += (groups[r * cols + c]?.w || 0) + (c ? gap : 0);
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
    : { x: 0, z: rowZ[0] + rowH[0] / 2 + 5 };
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
      links.push({ a: local.get(ids[k]).pos, b: local.get(ids[(k + 1) % ids.length]).pos, wide: false, lift: 1.05 });
    }
    const lead = g.members.find((b) => isLeadName(b.name));
    if (lead && local.get(lead.id)) {
      for (const m of g.members) {
        if (m === lead || !isFamilyName(m.name)) continue;
        const s = local.get(m.id);
        if (s) links.push({ a: local.get(lead.id).pos, b: s.pos, wide: true, lift: 1.45 });
      }
    }
  });
  const mod = groups.find((g) => g.mod);
  const hub = mod?.members.find((b) => isLeadName(b.name)) || mod?.members[0];
  if (hub && spots.get(hub.id)) {
    for (const g of groups) {
      if (g === mod || !g.members[0]) continue;
      const other = spots.get(g.members[0].id);
      if (other) links.push({ a: spots.get(hub.id).pos, b: other.pos, wide: true, lift: 1.15, via: [mod.door, g.door] });
    }
  }
  return { rooms: groups, spots, links, lounge };
}

function signTexture(name, color) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 1024, 256);
  const hex = '#' + color.toString(16).padStart(6, '0');
  g.strokeStyle = hex;
  g.lineWidth = 10;
  g.strokeRect(12, 16, 1000, 224);
  g.fillStyle = '#F8F1FF';
  g.font = '600 108px "DejaVu Sans", sans-serif';
  g.textBaseline = 'middle';
  const hebrew = /[\u0590-\u05FF]/.test(name);
  g.direction = hebrew ? 'rtl' : 'ltr';
  g.textAlign = 'center';
  const label = String(name || '').slice(0, 22);
  let size = 108;
  g.font = `600 ${size}px "DejaVu Sans", sans-serif`;
  while (size > 52 && g.measureText(label).width > 920) {
    size -= 6;
    g.font = `600 ${size}px "DejaVu Sans", sans-serif`;
  }
  g.lineWidth = 14;
  g.strokeText(label, 512, 132);
  g.fillText(label, 512, 132);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function addWall(g, x, z, w, d, mat, neon) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 1.35, d), mat);
  wall.position.set(x, 0.68, z);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.16, Math.max(d, 0.16)), neon);
  strip.position.set(x, 1.4, z);
  g.add(wall, strip);
}

function addLounge(root, at) {
  const g = new THREE.Group();
  g.name = 'hall-lounge';
  g.position.set(at.x, 0, at.z);
  const rug = new THREE.Mesh(
    new THREE.CircleGeometry(2.4, 32),
    new THREE.MeshBasicMaterial({ color: 0x3b1764, transparent: true, opacity: 0.55, depthWrite: false }),
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.y = 0.045;
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x241833, roughness: 0.86 });
  const edge = new THREE.MeshBasicMaterial({ color: 0xc084fc, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const [x, z, yaw] of [[-1.3, 0.2, 0.4], [1.3, -0.15, -0.5]]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.32, 0.55), seatMat);
    seat.position.set(x, 0.28, z);
    seat.rotation.y = yaw;
    const lip = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.03, 0.6), edge);
    lip.position.set(x, 0.46, z);
    lip.rotation.y = yaw;
    g.add(seat, lip);
  }
  const plant = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.7, 7), new THREE.MeshStandardMaterial({ color: 0x1f6b45, roughness: 0.8 }));
  plant.position.set(0, 0.55, 1.15);
  g.add(rug, plant);
  root.add(g);
}

export function buildHall(parent, layout) {
  const old = parent.getObjectByName('team-hall');
  if (old) old.removeFromParent();
  const root = new THREE.Group();
  root.name = 'team-hall';
  const veil = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 90),
    new THREE.MeshBasicMaterial({ color: 0x1a1028 }),
  );
  veil.rotation.x = -Math.PI / 2;
  veil.position.y = 0.02;
  veil.name = 'hall-veil';
  root.add(veil);
  const deskMat = new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 0.58, metalness: 0.04 });
  const chairMat = new THREE.MeshStandardMaterial({ color: 0x2a2440, roughness: 0.9 });
  for (const room of layout.rooms) {
    const g = new THREE.Group();
    g.position.set(room.x, 0, room.z);
    const glass = new THREE.MeshPhysicalMaterial({
      color: room.color, transparent: true, opacity: 0.34, roughness: 0.08, metalness: 0.04, side: THREE.DoubleSide, depthWrite: false,
    });
    const neon = new THREE.MeshBasicMaterial({ color: room.color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const hw = room.w / 2, hd = room.d / 2, door = 2.4;
    addWall(g, 0, -hd, room.w, 0.12, glass, neon);
    addWall(g, -hw, 0, 0.12, room.d, glass, neon);
    addWall(g, hw, 0, 0.12, room.d, glass, neon);
    const side = Math.max(0.4, (room.w - door) / 2);
    addWall(g, -hw + side / 2, hd, side, 0.12, glass, neon);
    addWall(g, hw - side / 2, hd, side, 0.12, glass, neon);
    const arch = new THREE.Mesh(new THREE.BoxGeometry(door + 0.2, 0.14, 0.2), neon);
    arch.position.set(0, 1.48, hd);
    g.add(arch);
    const wash = new THREE.Mesh(
      new THREE.PlaneGeometry(room.w - 0.5, room.d - 0.5),
      new THREE.MeshBasicMaterial({ color: room.color, transparent: true, opacity: 0.16, depthWrite: false }),
    );
    wash.rotation.x = -Math.PI / 2;
    wash.position.y = 0.03;
    g.add(wash);
    const sw = Math.min(room.w * 0.78, 12);
    const sh = 2.2;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), new THREE.MeshBasicMaterial({
      color: 0x14081c, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false,
    }));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(sw * 0.96, sh * 0.86), new THREE.MeshBasicMaterial({
      map: signTexture(room.name, room.color), transparent: true, side: THREE.DoubleSide, depthWrite: false,
    }));
    plate.position.set(0, 2.7, hd + 0.28);
    sign.position.set(0, 2.7, hd + 0.4);
    plate.rotation.y = sign.rotation.y = Math.PI / 4;
    plate.userData.roomId = sign.userData.roomId = room.id;
    g.add(plate, sign);
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(room.w - 1, room.d - 1), new THREE.MeshBasicMaterial({ visible: false }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.02;
    pad.userData.roomId = room.id;
    g.add(pad);
    root.add(g);
  }
  if (layout.lounge) addLounge(root, layout.lounge);
  for (const [id, s] of layout.spots) {
    const desk = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.06, 0.62), deskMat);
    top.position.set(0, 0.74, 0.45);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.025, 0.72), new THREE.MeshBasicMaterial({
      color: 0xc084fc, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    edge.position.set(0, 0.7, 0.45);
    const chair = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.08, 0.46), chairMat);
    chair.position.set(0, 0.42, 0);
    desk.add(top, edge, chair);
    desk.position.copy(s.pos);
    desk.position.y = 0;
    desk.rotation.y = s.yaw || 0;
    if (s.lead) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.85, 48), new THREE.MeshBasicMaterial({
        color: 0xe9d5ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.06;
      desk.add(ring);
    }
    desk.userData.botSeat = id;
    root.add(desk);
  }
  parent.add(root);
  return root;
}

export function clearHall(parent) {
  parent.getObjectByName('team-hall')?.removeFromParent();
}
