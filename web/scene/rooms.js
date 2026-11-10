// One walled room per team, packed into a single hall. Group names are canvas text, drawn so Hebrew stays RTL.
import * as THREE from 'three';
import { isFamilyName, isLeadName, isMasterName } from './modteam.js?v=8';
import { buildFurniture } from './furniture.js?v=8';

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
    links.push({ a: hub, b: s.pos, wide: isFamilyName(all.find((b) => b.id === id)?.name) || isLeadName(all.find((b) => b.id === id)?.name), lift: 1.05 });
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

function neonFloorMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv * vec2(22.0, 16.0);
        vec2 g = p + vec2(uTime * 0.35, -uTime * 0.12);
        vec2 f = abs(fract(g) - 0.5);
        float grid = smoothstep(0.47, 0.5, max(f.x, f.y));
        float flow = 0.45 + 0.55 * sin(p.x * 1.7 - uTime * 1.6 + p.y);
        vec2 cell = floor(vUv * vec2(90.0, 64.0));
        float n = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
        float tw = step(0.965, n) * (0.35 + 0.65 * sin(uTime * 2.4 + n * 40.0));
        vec3 col = vec3(0.012, 0.008, 0.02);
        col += vec3(0.45, 0.16, 0.85) * grid * flow;
        col += vec3(0.75, 0.65, 1.0) * tw * 0.9;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

function starField(w, d, at) {
  const n = 80;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * w;
    pos[i * 3 + 1] = 3.2 + Math.random() * 4.5;
    pos[i * 3 + 2] = (Math.random() - 0.5) * d;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xe9d5ff, size: 0.06, transparent: true, opacity: 0.85, depthWrite: false }));
  pts.position.set(at.x, 0, at.z);
  pts.name = 'hall-stars';
  pts.userData.stars = true;
  return pts;
}

export function tickFloor(t) {
  if (floorMat) floorMat.uniforms.uTime.value = t;
  const stars = floorMat && floorMat.userData.stars;
  if (stars) stars.material.opacity = 0.45 + 0.4 * (0.5 + 0.5 * Math.sin(t * 2.2));
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
  floorMat = neonFloorMaterial();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((b.minX + b.maxX) / 2, 0.01, (b.minZ + b.maxZ) / 2);
  floor.receiveShadow = true;
  floor.name = 'hall-floor';
  root.add(floor);
  const stars = starField(fw, fd, floor.position);
  floorMat.userData.stars = stars;
  root.add(stars);
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
