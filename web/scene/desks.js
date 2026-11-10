// One desk and one chair per bot seat. The office GLB (and the procedural placeholder) models the work
// area as two long communal tables plus one merged pouf mesh. Those are hidden and a separate station
// is built on every desk_NN empty, in that empty's local space, so each bot sits at its own desk.
import * as THREE from 'three';

const HIDE_NAME = /^(table_[12]|poufs|laptops|mugs)$/;
const DESK_W = 1.02;
const DESK_D = 0.56;
const DESK_CENTER = 0.66;   // metres in front of the seat, along the direction the bot faces
const SCREEN_FWD = 0.84;    // laptop, on the far half of that desk (slid in from the old shared table)

function lit(color, roughness, metalness, emissive = 0x000000, emissiveIntensity = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive, emissiveIntensity });
}

/** Hide the shared benches and add a private desk + chair at every seat. Mutates the floor_open template. */
export function installPrivateDesks(root, spots) {
  root.traverse((o) => {
    if (HIDE_NAME.test(o.name) || o.userData.sharedBench) o.visible = false;
  });
  const desks = spots?.desks || [];
  const geo = {
    top: new THREE.BoxGeometry(DESK_W, 0.05, DESK_D),
    glow: new THREE.BoxGeometry(DESK_W + 0.08, 0.018, DESK_D + 0.08),
    leg: new THREE.CylinderGeometry(0.02, 0.018, 0.71, 10),
    seat: new THREE.BoxGeometry(0.46, 0.07, 0.42),
    back: new THREE.BoxGeometry(0.44, 0.3, 0.046),
    chairLeg: new THREE.CylinderGeometry(0.015, 0.013, 0.35, 8),
    base: new THREE.BoxGeometry(0.34, 0.016, 0.24),
  };
  const mat = {
    top: lit(0x2a1848, 0.48, 0.14),
    glow: lit(0x5b21b6, 0.4, 0.18, 0xc4b5fd, 0.9),
    leg: lit(0x140e1e, 0.34, 0.72),
    chair: lit(0x4a2c74, 0.74, 0.05),
    laptop: lit(0x1a1228, 0.4, 0.55),
    pot: lit(0xe8e0f4, 0.6, 0.05),
    leaf: lit(0x3d8f62, 0.7, 0.02),
  };
  geo.pot = new THREE.CylinderGeometry(0.055, 0.04, 0.07, 10);
  geo.leaf = new THREE.SphereGeometry(0.07, 10, 8);
  geo.plate = new THREE.PlaneGeometry(0.46, 0.13);
  for (let i = 0; i < desks.length; i++) if (desks[i]) addStation(root, desks[i], i, geo, mat);
  addCooler(root, mat.leg);
}

function addStation(root, desk, index, geo, mat) {
  const nn = String(index + 1).padStart(2, '0');
  const yaw = desk.yaw || 0;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);     // local +Z (facing) in the floor plane
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);    // local +X

  const top = new THREE.Mesh(geo.top, mat.top);
  top.name = `table_${nn}`;
  top.position.set(desk.pos.x + fx * DESK_CENTER, 0.74, desk.pos.z + fz * DESK_CENTER);
  top.rotation.y = yaw;
  root.add(top);

  const glow = new THREE.Mesh(geo.glow, mat.glow);
  glow.name = `desk_glow_${nn}`;
  glow.position.set(top.position.x, 0.706, top.position.z);
  glow.rotation.y = yaw;
  glow.userData.noShadow = true;
  root.add(glow);

  const hx = DESK_W / 2 - 0.08, hz = DESK_D / 2 - 0.07;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(geo.leg, mat.leg);
    const lx = sx * hx, lz = sz * hz;
    leg.position.set(top.position.x + rx * lx + fx * lz, 0.355, top.position.z + rz * lx + fz * lz);
    root.add(leg);
  }

  const chair = new THREE.Group();
  chair.name = `chair_${nn}`;
  chair.position.set(desk.pos.x, 0, desk.pos.z);
  chair.rotation.y = yaw;
  const seat = new THREE.Mesh(geo.seat, mat.chair);
  seat.position.set(0, 0.385, -0.02);                 // cushion top at the seat empty (y = 0.42)
  const back = new THREE.Mesh(geo.back, mat.chair);
  back.position.set(0, 0.58, -0.22);
  chair.add(seat, back);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(geo.chairLeg, mat.leg);
    leg.position.set(sx * 0.17, 0.175, -0.02 + sz * 0.14);
    chair.add(leg);
  }
  root.add(chair);

  // Slide the existing laptop screen onto this desk (same tilt) and give it a base, so it is not left
  // floating where the shared table used to be.
  const screen = root.getObjectByName(`laptop_screen_${nn}`);
  if (screen) {
    root.attach(screen);
    screen.position.x = desk.pos.x + fx * SCREEN_FWD;
    screen.position.z = desk.pos.z + fz * SCREEN_FWD;
  }
  const base = new THREE.Mesh(geo.base, mat.laptop);
  base.name = `laptop_base_${nn}`;
  base.position.set(desk.pos.x + fx * (SCREEN_FWD - 0.04), 0.778, desk.pos.z + fz * (SCREEN_FWD - 0.04));
  base.rotation.y = yaw;
  root.add(base);

  // Status lamp: its bulb is recolored per bot. A plant and a blank nameplate sit on the desk.
  const lamp = new THREE.Group();
  lamp.name = `status_lamp_${nn}`;
  lamp.position.set(desk.pos.x + fx * (DESK_CENTER + 0.18), 0, desk.pos.z + fz * (DESK_CENTER + 0.18));
  lamp.rotation.y = yaw;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.46, 8), mat.leg);
  pole.position.y = 0.97;
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 0.07, 12), mat.leg);
  shade.position.y = 1.2;
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), lit(0x241833, 0.35, 0.1, 0x6a5a88, 0.15));
  bulb.name = 'status_bulb';
  bulb.position.y = 1.14;
  bulb.userData.noShadow = true;
  lamp.add(pole, shade, bulb);
  root.add(lamp);

  const plant = new THREE.Group();
  plant.name = `desk_plant_${nn}`;
  const px = -0.36, pz = 0.12;
  plant.position.set(desk.pos.x + rx * px + fx * (DESK_CENTER + pz), 0.765, desk.pos.z + rz * px + fz * (DESK_CENTER + pz));
  const pot = new THREE.Mesh(geo.pot, mat.pot);
  pot.position.y = 0.035;
  const leaf = new THREE.Mesh(geo.leaf, mat.leaf);
  leaf.position.y = 0.12;
  plant.add(pot, leaf);
  root.add(plant);

  const plate = new THREE.Mesh(geo.plate, new THREE.MeshBasicMaterial({ color: 0x1a1028, transparent: true, opacity: 0 }));
  plate.name = `nameplate_${nn}`;
  plate.position.set(desk.pos.x + fx * (DESK_CENTER - 0.06), 0.86, desk.pos.z + fz * (DESK_CENTER - 0.06));
  plate.rotation.order = 'YXZ';
  plate.rotation.y = yaw;
  plate.rotation.x = -1.05;
  plate.visible = false;
  root.add(plate);
}

// A water cooler beside the lounge, so an idle corner reads as a place to sit, not only a sofa.
function addCooler(root, metal) {
  const g = new THREE.Group();
  g.name = 'water_cooler';
  g.position.set(7.15, 0, 4.35);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.72, 0.34), metal);
  body.position.y = 0.56;
  const water = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.02), lit(0x8fd0ff, 0.2, 0.1, 0x6ec8ff, 0.35));
  water.position.set(0, 0.72, 0.17);
  const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.28, 12), lit(0xb9e4ff, 0.15, 0.05, 0x9fd8ff, 0.2));
  bottle.position.y = 1.06;
  g.add(body, water, bottle);
  root.add(g);
}
