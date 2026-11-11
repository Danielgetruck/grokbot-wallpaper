// The MoD floor: one lead desk in the aisle, family bots in an arc facing it, and the talk between them.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { REDUCED } from './spring.js?v=17';
import { spawnArc, spawnRipple, setStaticLinks } from './packets.js?v=17';

const LEAD = new THREE.Vector3(2.4, 0.42, -1.2);
const FAMILY = /^mod/i;
const NUMBERED = /^mod\d+$/i;

export function isLeadName(name) { return /^mod$/i.test(String(name || '').trim()); }
export function isFamilyName(name) { return FAMILY.test(String(name || '').trim()); }
export function isMasterName(name) { return /^master$/i.test(String(name || '').trim()); }
/** MoD2, Mod5, MOD7: "mod" and then only a number. Not the head, and not a name that merely starts with mod. */
export function isNumberedModName(name) { return NUMBERED.test(String(name || '').trim()); }

export function isModFloor(floor, bots) {
  const label = `${floor?.name || ''} ${floor?.id || ''}`;
  if (label.includes('MoD') || label.includes('ותפעול')) return true;
  return (bots || []).some((b) => isLeadName(b.name));
}

function spotFor(i, n) {
  const a = n <= 1 ? 0.2 : -2.4 + (4.8 * i) / (n - 1);
  const r = 3.6;
  const x = LEAD.x + Math.sin(a) * r;
  const z = LEAD.z + Math.cos(a) * r;
  const yaw = Math.atan2(LEAD.x - x, LEAD.z - z);
  return { pos: new THREE.Vector3(x, 0.42, z), yaw };
}

export function teamSpots(bots) {
  const map = new Map();
  const members = bots.filter((b) => isFamilyName(b.name) && !isLeadName(b.name))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const lead = bots.find((b) => isLeadName(b.name));
  if (lead) map.set(lead.id, { pos: LEAD.clone(), yaw: 0.15, lead: true });
  members.forEach((b, i) => map.set(b.id, { ...spotFor(i, members.length), lead: false }));
  return map;
}

function near(pos, spots) {
  for (const s of spots.values()) {
    const dx = pos.x - s.pos.x, dz = pos.z - s.pos.z;
    if (dx * dx + dz * dz < 2.4 * 2.4) return true;
  }
  return false;
}

const HIDE = (nn) => [`table_${nn}`, `chair_${nn}`, `status_lamp_${nn}`, `desk_plant_${nn}`, `nameplate_${nn}`, `desk_glow_${nn}`, `laptop_base_${nn}`, `laptop_screen_${nn}`, `desk_props_${nn}`];

function clearBuilt(inst) {
  const gone = [];
  inst.root.traverse((o) => { if (o.userData.modTeam) gone.push(o); });
  for (const o of gone) o.removeFromParent();
  for (const o of inst.modHidden || []) o.visible = true;
  inst.modHidden = [];
}

function bulbMat() {
  return new THREE.MeshStandardMaterial({ color: 0x241833, emissive: 0xc4b5fd, emissiveIntensity: 0.4, roughness: 0.35 });
}

function nameplate(text) {
  const el = document.createElement('div');
  el.className = 'hq-nameplate';
  const b = document.createElement('b');
  b.textContent = text;
  el.append(b);
  const obj = new CSS2DObject(el);
  obj.center.set(0.5, 1);
  obj.position.y = 0.55;
  return obj;
}

function buildLead(parent) {
  const g = new THREE.Group();
  g.name = 'mod-lead';
  g.userData.modTeam = true;
  g.position.copy(LEAD);
  g.position.y = 0;
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.07, 0.95), new THREE.MeshStandardMaterial({ color: 0x6b452c, roughness: 0.5, metalness: 0.06 }));
  top.position.y = 0.74;
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.32, 48), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  const glow = new THREE.Mesh(new THREE.RingGeometry(0.7, 1.15, 40), new THREE.MeshBasicMaterial({ color: 0xb388ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.021;
  const holoCv = document.createElement('canvas');
  holoCv.width = 256; holoCv.height = 160;
  const tex = new THREE.CanvasTexture(holoCv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const holo = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.45), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.92, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  holo.position.set(0, 1.45, 0.15);
  g.add(top, ring, glow, holo);
  g.userData.holo = { cv: holoCv, tex, key: '' };
  parent.add(g);
  return g;
}

function buildMember(parent, spot, bot) {
  const g = new THREE.Group();
  g.userData.modTeam = true;
  g.position.copy(spot.pos);
  g.position.y = 0;
  g.rotation.y = spot.yaw;
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.05, 0.5), new THREE.MeshStandardMaterial({ color: 0x5c3d28, roughness: 0.58, metalness: 0.04 }));
  top.position.set(0, 0.72, 0.42);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), bulbMat());
  bulb.position.set(0, 1.05, 0.62);
  bulb.userData.modBulb = true;
  const tag = nameplate(String(bot.name || '').slice(0, 22));
  tag.position.set(0, 0.95, 0.2);
  g.add(top, bulb, tag);
  g.userData.bulb = bulb;
  g.userData.tag = tag;
  g.userData.botId = bot.id;
  parent.add(g);
  return g;
}

function paintHolo(rec, working, waiting) {
  const key = `${working}|${waiting}`;
  if (rec.key === key) return;
  rec.key = key;
  const g = rec.cv.getContext('2d');
  g.clearRect(0, 0, 256, 160);
  g.fillStyle = 'rgba(40, 16, 70, 0.2)';
  g.fillRect(0, 0, 256, 160);
  g.strokeStyle = 'rgba(196, 160, 255, 0.35)';
  for (let y = 8; y < 160; y += 10) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
  g.fillStyle = '#F6E7FF';
  g.font = '600 28px sans-serif';
  g.textAlign = 'center';
  g.fillText('MoD', 128, 40);
  g.font = '500 22px sans-serif';
  g.fillStyle = '#B7DCFF';
  g.fillText(`working ${working}`, 128, 84);
  g.fillStyle = '#FFB020';
  g.fillText(`waiting ${waiting}`, 128, 122);
  rec.tex.needsUpdate = true;
}

/** Returns a Map of bot id -> spot, or null when this floor is not the MoD team. */
export function syncTeam(inst, floor, bots, deskSpots) {
  const on = isModFloor(floor, bots);
  const family = bots.filter((b) => isFamilyName(b.name)).map((b) => b.id).sort().join('|');
  const key = on ? family : '';
  if (inst.modKey === key) return inst.modSpots || null;
  clearBuilt(inst);
  inst.modKey = key;
  inst.modSpots = null;
  if (!on) return null;
  const spots = teamSpots(bots);
  inst.modSpots = spots;
  inst.modHidden = [];
  (deskSpots || []).forEach((d, i) => {
    if (!d || !near(d.pos, spots)) return;
    const nn = String(i + 1).padStart(2, '0');
    for (const name of HIDE(nn)) {
      const o = inst.obj.getObjectByName(name);
      if (o && o.visible) { o.visible = false; inst.modHidden.push(o); }
    }
  });
  const lead = buildLead(inst.root);
  inst.modLead = lead;
  inst.modMembers = [];
  for (const b of bots) {
    const s = spots.get(b.id);
    if (!s || s.lead) continue;
    inst.modMembers.push(buildMember(inst.root, s, b));
  }
  return spots;
}

const COLORS = { working: 0xb7dcff, waiting_user: 0xff9f0a, error: 0xff3b30, idle: 0x6a5a88, done: 0x8fb0ff, stuck: 0x8d7358 };

export function tickTeam(inst, bots, dt, now) {
  if (!inst?.modSpots) {
    setStaticLinks(inst?.root, []);
    return;
  }
  const family = bots.filter((b) => inst.modSpots.has(b.id));
  const byId = new Map(family.map((b) => [b.id, b]));
  let working = 0, waiting = 0;
  for (const b of family) {
    const s = b.effective_status || b.status;
    if (s === 'working') working++;
    if (s === 'waiting_user') waiting++;
  }
  if (inst.modLead?.userData.holo) paintHolo(inst.modLead.userData.holo, working, waiting);
  const pulse = REDUCED ? 1 : 0.65 + 0.35 * Math.sin(now * 3);
  for (const g of inst.modMembers || []) {
    const b = byId.get(g.userData.botId);
    const st = b ? (b.effective_status || b.status) : 'idle';
    const look = COLORS[st] || COLORS.idle;
    if (g.userData.bulb) {
      g.userData.bulb.material.emissive.setHex(look);
      g.userData.bulb.material.emissiveIntensity = st === 'working' ? 1.8 : st === 'waiting_user' ? 1.6 * pulse : 0.2;
    }
    if (g.userData.tag) g.userData.tag.element.hidden = !(st === 'working' || st === 'waiting_user' || st === 'error');
  }
  const leadSpot = [...inst.modSpots.values()].find((s) => s.lead);
  const pairs = [];
  if (leadSpot) {
    for (const s of inst.modSpots.values()) {
      if (s.lead) continue;
      pairs.push({ a: leadSpot.pos, b: s.pos });
    }
  }
  setStaticLinks(inst.root, pairs);

  inst.talkT = (inst.talkT || 0) + dt;
  const idle = working === 0;
  const every = idle ? 7.5 : Math.max(0.7, 2.2 - working * 0.25);
  if (inst.talkT < every || family.length < 2) return;
  inst.talkT = 0;
  const a = family[Math.floor(Math.random() * family.length)];
  let b = family.find((x) => isLeadName(x.name) && x !== a) || family.find((x) => x !== a);
  if (!a || !b) return;
  const sa = inst.modSpots.get(a.id), sb = inst.modSpots.get(b.id);
  if (!sa || !sb) return;
  if (!REDUCED && !idle) spawnArc(inst.root, sa.pos, sb.pos, working ? 0xc4b5fd : 0x6a5a88);
  else if (!REDUCED && idle && Math.random() < 0.5) spawnArc(inst.root, sa.pos, sb.pos, 0x5a4878);
  return { speaker: a, step: (a.effective_status || a.status) === 'working' && a.step ? String(a.step).slice(0, 80) : '…' };
}

export function blockedDesk(index, deskSpots, spots) {
  if (!spots) return false;
  const d = deskSpots[index];
  return !!(d && near(d.pos, spots));
}

export { spawnRipple };
