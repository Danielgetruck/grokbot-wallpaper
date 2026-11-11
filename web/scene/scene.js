// Isometric 3D building (CONTRACT §6, v2): renderer, camera on springs, floor stack, actors, picking, post.
// Public API (unchanged): initScene, renderScene, zoom, focusBot.
import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { loadOfficeAssets } from './office.js?v=16';
import { Building } from './building.js?v=16';
import { createDaylight } from './daylight.js?v=16';
import { createPost } from './post.js?v=16';
import { studioCss } from './studio.js?v=16';
import { Actor } from './actor.js?v=16';
import { generateBlob } from './blobgen.js?v=16';
import { Spring, clamp, REDUCED } from './spring.js?v=16';
import { sofiaHour, fontsPromise } from './walls.js?v=16';
import { applyDesks, tick as tickLife, ensureCat, petCat, sendMail, addressedTo, cullLabels } from './life.js?v=16';
import { syncTeam, tickTeam, blockedDesk } from './modteam.js?v=16';
import { spawnBeam, spawnTrail, tickPackets, setNetwork, tickNetwork, setFlowPace } from './packets.js?v=16';
import { useHall, layoutHall, buildHall, faceSign, tickFloor } from './rooms.js?v=16';
import { initQuality, getQuality, isSoftGpu, tickPolish, ensureDust, tickDust, syncRug, accentFor } from './polish.js?v=16';
import { installCity } from './city.js?v=16';
import { isWorking, RECENT_MS } from '../lib/live.js?v=16';

// Relative to the page (not the site root), so the office also works when it is published in a sub-folder, e.g.
// https://bodila51.github.io/grokbot-wallpaper/office/ -> ../assets. Locally the page is at `/`, where this is /assets.
const ASSETS = '../assets';
const ISO_DIR = new THREE.Vector3(1, 1, 1).normalize();
const HOME = { x: 0, y: 0.6, z: 0 };
const PITCH = 32 * Math.PI / 180;                   // look down into the rooms, with garden and horizon at the edge
const DIST = { min: 6, max: 110, phone: 11, hall: 28 };
const VIEW_SPAN = { w: 28, h: 18 };
const UI_LEFT = 230, UI_RIGHT = 360;                   // glass panels the building must not hide behind
const SIN_E = Math.sin(Math.atan(1 / Math.SQRT2));      // sin(35.264°) = ground foreshortening
// Server desk numbers fill 1..20 in arrival order; seat them on the far side of the tables first (odd desks face
// the camera), neighbours alternating so tags never collide.
const DESK_ORDER = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20];

let renderer, labels, camera, scene, container, callbacks, daylight, building, post, city;
let assets = null;
let hallLayout = null;
let lastState = null, lastView = { currentFloor: null, selectedBot: null };
const actors = new Map();
const retiring = new Set();
const pickables = new Set();
const models = new Map();            // avatar id -> Promise<Object3D|null>
const effects = [];
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const cursor = { active: false, x: 0, z: 0 };
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const tmp = new THREE.Vector3();
const clock = new THREE.Clock();
const cam = {
  x: new Spring(HOME.x, 0.45), y: new Spring(HOME.y, 0.55), z: new Spring(HOME.z, 0.45),
  dist: new Spring(DIST.hall, 0.4), yaw: new Spring(Math.PI / 4, 0.32),
};
let hoveredId = null, pointerDirty = false, drag = null;
const touches = new Map();
let pinch = null;
let introDone = false, switchedAt = 0, nowSec = 0, settledOnce = false;
let loadingEl = null;
// Debug/test switches: ?floor=<id> forces the active floor, ?from=<id> starts there first, ?intro=0 skips the load
// animation, ?hold=<s> fast-forwards that long after the (last) switch and freezes time, ?cam=x,z,zoom snaps the camera.
// Wallpaper mode (?mode=wallpaper, for Lively): no panel offset, hover only (no pan / zoom / select), <= 30 fps, no
// in-scene tags unless &tags=1. app.js owns ?floor= there (pin / cycle), so the scene's own debug switch is off.
const WALLPAPER = new URLSearchParams(location.search).get('mode') === 'wallpaper';
const WALLPAPER_TAGS = new URLSearchParams(location.search).get('tags') === '1';
const WALLPAPER_FRAME_MS = 1000 / 30;
const WALLPAPER_FRAMING = 0.9;                        // < 1 = closer: the side panels' space is not needed, so the tower fills more
const TEST = (() => {
  const q = new URLSearchParams(location.search);
  return { floor: WALLPAPER ? null : q.get('floor'), from: q.get('from'), intro: q.get('intro'), hold: q.has('hold') ? Number(q.get('hold')) : null, cam: q.get('cam'), cursor: q.get('cursor') };
})();
let frozen = false, pinCursor = false;

// The office GLB is the biggest download: start it the moment this module runs (index.html may have preloaded it
// already; the loader then reuses that response), not after the renderer and the UI are set up.
const officeAssets = loadOfficeAssets(`${ASSETS}/office`);

export function initScene(el, cbs = {}) {
  container = el;
  callbacks = cbs;
  container.classList.add('hq-scene');
  ensureAssets();

  // Loader: index.html may already carry it (visible from the first paint). It stays until the first floor drops in,
  // so nobody sees a half-built office (the elevator shaft alone) while the bots are still on their way.
  loadingEl = container.querySelector('.hq-loading');
  if (!loadingEl) {
    loadingEl = document.createElement('div');
    loadingEl.className = 'hq-loading';
    loadingEl.setAttribute('role', 'status');
    loadingEl.innerHTML = '<span class="hq-loading-label">Building the office</span><span class="hq-loading-track"><i></i></span>';
    container.append(loadingEl);
  }

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(pixelRatio());
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.className = 'hq-canvas';
  container.append(renderer.domElement);

  labels = new CSS2DRenderer();
  labels.domElement.className = 'hq-labels';
  container.append(labels.domElement);

  scene = new THREE.Scene();
  city = installCity(scene);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.2;
  // Poly Haven "studio_small_03" 1k, CC0. Replaces the procedural room once it arrives.
  new RGBELoader().load(`${ASSETS}/office/studio_small_03_1k.hdr`, (tex) => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const env = pmrem.fromEquirectangular(tex).texture;
    scene.environment = env;
    tex.dispose();
  }, undefined, () => { /* keep the procedural room if the file is missing */ });

  daylight = createDaylight({ scene, renderer });
  initQuality(renderer);
  document.documentElement.dataset.sky = 'studio';        // backdrop is the studio pass; the glass UI stays on its own tokens (web/styles.css)
  container.style.background = studioCss();               // the same backdrop as the post pass draws, for the first moments

  camera = new THREE.PerspectiveCamera(38, 1, 0.15, 520);
  camera.position.set(12, 10, 12);
  camera.lookAt(0, 0.6, 0);

  officeAssets.then((a) => {
    assets = a;
    building = new Building({ scene, daylight, assets: a, baseUrl: `${ASSETS}/office`, renderer });
    daylight.setBuilding(building);                        // sun stripes on the active floor, ambient tint of the baked surfaces
    a.spots.lounges.forEach((s) => { if (s) s.lounge = true; });
    window.bothq = Object.assign(window.bothq || {}, { source: a.source });
    resize();
    const go = () => { if (lastState) sync(); };
    Promise.race([fontsPromise, new Promise((r) => setTimeout(r, 1500))]).then(go, go);
  });

  post = createPost(renderer, scene, camera);

  addPointerHandlers();
  new ResizeObserver(resize).observe(container);
  resize();
  renderer.setAnimationLoop(frame);

  window.bothq = Object.assign(window.bothq || {}, {
    scene: { get camera() { return camera; }, get building() { return building; }, cam, actors, get daylight() { return daylight; }, switchFloor: (id) => building && switchFloor(id, false), settle },
  });
}

// The page may not load Inter / scene.css itself (older index.html): make sure both are there.
function ensureAssets() {
  if (!document.querySelector('link[href*="scene.css"]')) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = new URL('./scene.css', import.meta.url).href;
    document.head.append(l);
  }
  if (!document.querySelector('link[href*="family=Inter"]')) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;650;700&display=swap';
    document.head.append(l);
  }
}

export function renderScene(state, view) {
  lastState = state;
  lastView = { ...view };
  if (building) sync();
}

function sync() {
  const state = lastState, view = lastView;
  const floors = [...state.floors].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const hall = useHall(floors);
  window.bothq = Object.assign(window.bothq || {}, { hall, focusRoom });
  let want = view.currentFloor && floors.some((f) => f.id === view.currentFloor) ? view.currentFloor : (floors[0]?.id ?? '_');
  if (TEST.floor && floors.some((f) => f.id === TEST.floor)) want = TEST.from && !introDone && floors.some((f) => f.id === TEST.from) ? TEST.from : TEST.floor;
  if (hall) {
    building.setFloors([{ id: '_hall', name: 'Hall', order: 1 }]);
    if (building.activeId !== '_hall' || !building.activeOpen()) switchFloor('_hall', !introDone);
  } else {
    building.setFloors(floors);
    if (building.activeId !== want) switchFloor(want, !introDone);
  }
  introDone = true;

  const inst = building.activeOpen();
  if (!inst) return;
  const floorBots = hall ? Object.values(state.bots) : Object.values(state.bots).filter((b) => b.floor === building.activeId);
  const ids = new Set(floorBots.map((b) => b.id));

  for (const [id, actor] of actors) if (!ids.has(id)) { actor.retire(); retiring.add(actor); actors.delete(id); }

  const floor = hall ? { id: '_hall', name: 'Hall' } : floors.find((f) => f.id === building.activeId);
  let hallPlan = null;
  if (hall) {
    const key = floorBots.map((b) => `${b.id}:${b.name || ''}`).sort().join('|');
    if (inst.hallKey !== key) {
      inst.hallKey = key;
      hallPlan = layoutHall(floors, floorBots);
      buildHall(inst.root, hallPlan);
      inst.hallPlan = hallPlan;
      inst.obj.visible = false;
      for (const o of [...pickables]) if (o.userData?.roomId) pickables.delete(o);
      inst.root.getObjectByName('team-hall')?.traverse((o) => { if (o.userData?.roomId && o.isMesh) pickables.add(o); });
    } else hallPlan = inst.hallPlan;
    hallLayout = hallPlan;
    setNetwork(inst.root, hallPlan?.links || []);
    const frameKey = `${key}|${isPortraitPhone() ? 'p' : 'd'}`;
    if (inst.framedKey !== frameKey) {
      inst.framedKey = frameKey;
      frameDefault(true);
    }
  }
  const team = hall ? null : syncTeam(inst, floor, floorBots, assets.spots.desks);
  syncRug(inst, accentFor(floor?.name || floor?.id, !!team));
  const rug = inst.root.getObjectByName('team-rug');
  if (rug) rug.visible = !hall;
  const maxShare = Math.max(0.0001, ...floorBots.map((b) => b.usage_share || 0));
  const lounge = hall ? new Map() : assignLounge(floorBots);
  const flags = new Array(20).fill(0);
  const desks = new Array(20).fill(null);
  const delay = Math.max(0, switchedAt + 0.55 - nowSec);
  const routineFor = routineIndex(state);
  const used = new Set();
  const claim = (prefer) => {
    if (prefer >= 0 && !used.has(prefer) && !(team && blockedDesk(prefer, assets.spots.desks, team)) && assets.spots.desks[prefer]) {
      used.add(prefer);
      return prefer;
    }
    for (let i = 0; i < 20; i++) {
      if (used.has(i) || (team && blockedDesk(i, assets.spots.desks, team)) || !assets.spots.desks[i]) continue;
      used.add(i);
      return i;
    }
    return 0;
  };
  for (const bot of floorBots) {
    let actor = actors.get(bot.id);
    if (!actor) {
      actor = new Actor(bot, { parent: inst.root, inst, pickables, confetti, cursor, dropDelay: delay, now: nowSec });
      actors.set(bot.id, actor);
      if (!hall) attachModel(actor, bot);
    }
    if (hall) actor.setWorker(bot);
    actor.ctx.now = nowSec;
    const family = !hall && team && team.has(bot.id);
    const seated = hall && hallPlan?.spots.get(bot.id);
    const prefer = (DESK_ORDER[(bot.desk || 1) - 1] || 1) - 1;
    const deskIdx = family || seated ? -1 : claim(prefer);
    const spot = seated || (family ? team.get(bot.id) : (assets.spots.desks[deskIdx] || assets.spots.desks[0]));
    const status = bot.effective_status || bot.status;
    if (status === 'working' && !lounge.has(bot.id) && deskIdx >= 0) flags[deskIdx] = 1;
    const prevStep = actor.bot?.step;
    const prevStatus = actor.status;
    actor.update(bot, lounge.get(bot.id) || spot, { maxShare, selectedBot: view.selectedBot, now: nowSec });
    if (deskIdx >= 0) desks[deskIdx] = { name: bot.name || '', step: bot.step || '', status, routine: routineFor.get(bot.id) || '' };
    if (prevStatus && prevStatus !== status) spawnTrail(inst.root, actor.root.position, status === 'waiting_user' ? 0xff9f0a : 0xffd27a);
    if (prevStep && bot.step && bot.step !== prevStep) {
      const other = addressedTo(bot.step, floorBots, bot.id);
      const to = other && actors.get(other.id);
      if (to) {
        sendMail(actor.root.position, to.root.position, inst.root);
        spawnTrail(inst.root, actor.root.position, 0x7dd3fc);
      }
    }
  }
  applyDesks(inst, desks);
  const talked = tickTeam(inst, floorBots, 0, nowSec);
  if (talked) actors.get(talked.speaker.id)?.speak(talked.step, 1.6, nowSec);
  ensureCat(inst, pickables);
  building.setScreens(flags);
  building.setDisplayData({ floorName: floor ? floor.name : '', bots: floorBots, hour: sofiaHour(state.now) });
  if (hoveredId && !actors.has(hoveredId)) hoveredId = null;
  if (!settledOnce) {
    settledOnce = true;
    if (TEST.intro === '0') settle(3.5);
    if (TEST.from && TEST.floor) sync();                 // second pass: ride from `from` to `floor`
    if (TEST.hold !== null) { settle(TEST.hold); frozen = true; }
    if (TEST.cursor) {                                   // debug: ?cursor=x,z pins the cursor ground point
      const [x, z] = TEST.cursor.split(',').map(Number);
      cursor.active = true; cursor.x = x; cursor.z = z; pinCursor = true;
      settle(1.2);
    }
    if (TEST.cam) {
      const [x, z, zm] = TEST.cam.split(',').map(Number);
      cam.x.snap(x); cam.z.snap(z); if (zm) cam.dist.snap(zm);
    }
  }
}

// Fast-forward all springs/animations (used by ?intro=0 and window.bothq.settle() for tests and screenshots).
function settle(seconds = 3) {
  const step = 1 / 30;
  for (let t = 0; t < seconds; t += step) {
    nowSec += step;
    stepCamera(step);
    building.update(step, performance.now());
    for (const a of actors.values()) { a.hostAlpha = building.activeOpen()?.alpha ?? 1; a.tick(step, nowSec); }
    for (const a of retiring) { a.tick(step, nowSec); if (a.dead) retiring.delete(a); }
  }
}

function routineIndex(state) {
  const map = new Map();
  for (const r of state.routines || []) {
    if (!r || !r.bot || map.has(r.bot)) continue;
    map.set(r.bot, r.routine || '');
  }
  return map;
}

// Idle bots go to the lounge while seats last; the rest nap at their desks.
function assignLounge(bots) {
  const map = new Map();
  const seats = assets.spots.lounges.filter(Boolean);
  const idle = bots.filter((b) => (b.effective_status || b.status) === 'idle').sort((a, b) => (a.desk || 0) - (b.desk || 0));
  idle.slice(0, seats.length).forEach((b, i) => map.set(b.id, seats[i]));
  return map;
}

// Avatar chain (docs/AVATARS.md): 1. hand-made GLB assets/blobs/<avatar>.glb, 2. generated blob from bot.look
// (shape / colour / accessory written by Grok Bot from a screenshot), 3. generated blob from a hash of the id.
// A look that changes later (data/bots.json is hot-reloaded) re-dresses the actor on the next state poll.
function attachModel(actor, bot) {
  let current = null;
  const apply = (b) => {
    const key = `${b.avatar || b.id}|${b.color || ''}|${JSON.stringify(b.look || null)}`;
    if (key === current) return;
    current = key;
    (b.has_glb === false ? Promise.resolve(null) : loadModel(b.avatar || b.id)).then((m) => {   // has_glb: server knows the file is missing, no probe
      if (actor.dead || current !== key) return;
      if (m) return actor.setModel(m.clone(true));
      const look = b.look || {};
      actor.setModel(generateBlob({ shape: look.shape, color: look.color || b.color, accessory: look.accessory, seed: b.id }));
    });
  };
  apply(bot);
  const update = actor.update.bind(actor);
  actor.update = (b, spot, view) => { apply(b); return update(b, spot, view); };
}

function loadModel(id) {
  if (!models.has(id)) {
    models.set(id, new GLTFLoader().loadAsync(`${ASSETS}/blobs/${encodeURIComponent(id)}.glb`)
      .then((g) => g.scene)
      .catch(() => null));
  }
  return models.get(id);
}

// ---------- floor switch = elevator ride ----------

function switchFloor(id, first) {
  for (const a of actors.values()) { a.retire(); retiring.add(a); }
  actors.clear();
  hoveredId = null;
  building.setActive(id, { intro: first });
  if (id !== '_hall') {
    cam.x.to(HOME.x); cam.z.to(HOME.z); cam.y.to(0.8); cam.dist.to(DIST.hall);
    if (first) {
      cam.x.snap(HOME.x); cam.z.snap(HOME.z);
      cam.y.snap(0.8); cam.dist.snap(DIST.hall);
    }
  }
  switchedAt = nowSec;
  if (first) { building.prewarm(camera); hideLoader(); }
}

function hideLoader() {
  const el = loadingEl;
  if (!el) return;
  loadingEl = null;
  el.classList.add('is-done');
  setTimeout(() => el.remove(), 450);
}

// ---------- camera (all on springs) ----------

function pixelRatio() {
  const cap = getQuality() === 'low' ? 1.25 : 2;
  return Math.min(window.devicePixelRatio || 1, cap);
}

function isPortraitPhone() {
  const w = window.innerWidth || container?.clientWidth || 0;
  const h = window.innerHeight || container?.clientHeight || 0;
  return w > 0 && h > 0 && w <= 900 && h >= w;
}

function distanceFor(width, depth) {
  const aspect = Math.max(0.3, camera.aspect || 1);
  const vFov = camera.fov * Math.PI / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  const distW = (width * 0.55) / Math.tan(hFov / 2);
  const distD = (depth * 0.55) / Math.tan(vFov / 2) * Math.sin(PITCH);
  const close = isPortraitPhone() ? 0.96 : 0.88;
  return clamp(Math.max(distW, distD) * close, DIST.min, DIST.max);
}

function floorY() {
  return building?.activeOpen()?.root.position.y || building?.activeY || 0;
}

function aim(x, yOff, z, distance, snap) {
  const go = snap ? 'snap' : 'to';
  cam.x[go](x); cam.y[go](yOff); cam.z[go](z);
  cam.dist[go](clamp(distance, DIST.min, DIST.max));
}

function frameAll(snap) {
  const rooms = hallLayout?.rooms || [];
  if (!rooms.length) { aim(HOME.x, building?.activeY || 0.6, HOME.z, DIST.hall, snap); return; }
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const r of rooms) {
    minX = Math.min(minX, r.x - r.w / 2); maxX = Math.max(maxX, r.x + r.w / 2);
    minZ = Math.min(minZ, r.z - r.d / 2); maxZ = Math.max(maxZ, r.z + r.d / 2);
  }
  const rim = isPortraitPhone() ? 1.2 : 2.6;
  const fit = distanceFor(maxX - minX + rim, maxZ - minZ + rim);
  aim((minX + maxX) / 2, 0.8, (minZ + maxZ) / 2, isPortraitPhone() ? Math.min(fit, 22) : fit, snap);
}

function frameDefault(snap) {
  frameAll(snap);
}

export function zoom(dir) {
  if (!building) return;
  if (dir === 'reset') { frameDefault(false); return; }
  const next = cam.dist.target * (dir === 'in' ? 1 / 1.22 : 1.22);
  cam.dist.to(clamp(next, DIST.min, DIST.max));
}

function focusRoom(id, snap = false) {
  const room = hallLayout?.rooms?.find((r) => r.id === id);
  if (!room || !building) return;
  const dist = distanceFor(room.w + 2, room.d + 2);
  aim(room.x, 0.9, room.z, dist, snap);
}

export function focusBot(id) {
  const a = actors.get(id);
  if (!a || !building) return;
  aim(a.root.position.x, 0.9, a.root.position.z, Math.min(cam.dist.target, 8.5), false);
}

function stepCamera(dt) {
  clampTarget();
  cam.x.step(dt); cam.y.step(dt); cam.z.step(dt); cam.dist.step(dt); cam.yaw.step(dt);
  const yaw = cam.yaw.x;
  const dist = cam.dist.x;
  const cp = Math.cos(PITCH), sp = Math.sin(PITCH);
  const tx = cam.x.x, ty = floorY() + cam.y.x, tz = cam.z.x;
  camera.position.set(tx + Math.sin(yaw) * cp * dist, ty + sp * dist, tz + Math.cos(yaw) * cp * dist);
  camera.lookAt(tx, ty, tz);
  camera.updateMatrixWorld();
  const hallMesh = building?.activeOpen()?.root.getObjectByName('team-hall');
  if (hallMesh) hallMesh.traverse((o) => { if (o.userData?.billboard) faceSign(o, camera); });
}

function clampTarget() {
  cam.x.target = clamp(cam.x.target, -40, 40);
  cam.z.target = clamp(cam.z.target, -40, 40);
  cam.dist.target = clamp(cam.dist.target, DIST.min, DIST.max);
}

function resize() {
  if (!renderer) return;
  const w = container.clientWidth || 1, h = container.clientHeight || 1;
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(w, h, false);
  labels.setSize(w, h);
  post?.setSize(w, h);
  camera.aspect = w / h;
  camera.clearViewOffset();
  if (isPortraitPhone()) {
    const sheet = 0.18;
    camera.setViewOffset(w, h, 0, h * sheet * 0.45, w, h);
  }
  camera.updateProjectionMatrix();
  if (hallLayout && building?.activeOpen()) {
    const inst = building.activeOpen();
    const key = `${inst.hallKey || ''}|${isPortraitPhone() ? 'p' : 'd'}`;
    if (inst.framedKey !== key) { inst.framedKey = key; frameDefault(false); }
  }
}

const pxPerMeter = () => renderer.domElement.clientHeight / ((camera.top - camera.bottom) / camera.zoom);

// ---------- pointer: pan, zoom, hover, click ----------

function addPointerHandlers() {
  const el = renderer.domElement;
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerleave', () => { cursor.active = false; setHover(null); });
  if (WALLPAPER) return;                              // a desktop background: bots follow the cursor, nothing else
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', (e) => { touches.delete(e.pointerId); drag = null; pinch = null; });
  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

function setPointer(e) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
}

function onDown(e) {
  renderer.domElement.setPointerCapture?.(e.pointerId);
  setPointer(e);
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 2) {
    const [a, b] = [...touches.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: cam.dist.target };
    drag = null;
    return;
  }
  drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lx: e.clientX, ly: e.clientY, lt: performance.now(), panning: false, swipe: false };
}

function onMove(e) {
  setPointer(e);
  cursor.active = true;
  pointerDirty = true;
  if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && touches.size === 2) {
    const [a, b] = [...touches.values()];
    const span = Math.max(12, Math.hypot(a.x - b.x, a.y - b.y));
    cam.dist.to(clamp(pinch.dist * (pinch.d / span), DIST.min, DIST.max));
    return;
  }
  if (!drag || drag.id !== e.pointerId) return;
  if (!drag.panning && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 6) drag.panning = true;
  if (!drag.panning) return;
  const dx = e.clientX - drag.lx, dy = e.clientY - drag.ly;
  drag.lx = e.clientX; drag.ly = e.clientY;
  const swipe = isPortraitPhone() && Math.abs(e.clientX - drag.x0) > Math.abs(e.clientY - drag.y0) * 1.3;
  drag.swipe = swipe;
  if (swipe) return;
  cam.yaw.snap(cam.yaw.x - dx * 0.006);
  cam.dist.snap(clamp(cam.dist.x + dy * 0.02, DIST.min, DIST.max));
}

function onUp(e) {
  touches.delete(e.pointerId);
  if (pinch) { if (touches.size < 2) pinch = null; drag = null; return; }
  if (!drag || drag.id !== e.pointerId) return;
  const d = drag;
  drag = null;
  if (d.panning) {
    if (d.swipe && Math.abs(d.lx - d.x0) > 48) stepRoom(d.lx < d.x0 ? 1 : -1);
    return;
  }
  setPointer(e);
  const obj = pickObject();
  if (obj?.userData.cat) { petCat(); return; }
  if (obj?.userData.roomId) { focusRoom(obj.userData.roomId); return; }
  callbacks.onSelectBot?.(obj ? obj.userData.actorId : null);
}

function stepRoom(dir) {
  const rooms = hallLayout?.rooms || [];
  if (rooms.length < 2) return;
  const cur = rooms.findIndex((r) => r.id === lastView?.currentFloor);
  const i = cur >= 0 ? cur : 0;
  const next = rooms[(i + dir + rooms.length) % rooms.length];
  callbacks.onSelectFloor?.(next.id);
  focusRoom(next.id);
}

function onWheel(e) {
  e.preventDefault();
  const next = cam.dist.target * Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0014));
  cam.dist.to(clamp(next, DIST.min, DIST.max));
}

function pickObject() {
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObjects([...pickables], false)[0]?.object || null;
}

function pick() {
  const obj = pickObject();
  if (obj?.userData.cat) return null;
  return obj ? obj.userData.actorId : null;
}

function setHover(id) {
  if (id === hoveredId) return;
  if (hoveredId) actors.get(hoveredId)?.setHovered(false);
  hoveredId = id;
  if (id) actors.get(id)?.setHovered(true);
  container.classList.toggle('is-hovering', !!id);
  callbacks.onHoverBot?.(id);
}

// ---------- effects ----------

const CONFETTI_COLORS = [0x34C759, 0x0A84FF, 0xFF9F0A, 0xFF4FA0, 0xFF6A13, 0x14B8A6];
const confettiGeo = new THREE.PlaneGeometry(0.07, 0.035);

function confetti(at) {
  const group = new THREE.Group();
  group.position.copy(at);
  const parts = [];
  for (let i = 0; i < 36; i++) {
    const m = new THREE.Mesh(confettiGeo, new THREE.MeshBasicMaterial({ color: CONFETTI_COLORS[i % CONFETTI_COLORS.length], side: THREE.DoubleSide, transparent: true }));
    const a = Math.random() * Math.PI * 2, up = 2.2 + Math.random() * 1.6, out = 0.8 + Math.random() * 1.2;
    parts.push({ m, v: new THREE.Vector3(Math.cos(a) * out, up, Math.sin(a) * out), spin: new THREE.Vector3(Math.random() * 9, Math.random() * 9, 0) });
    group.add(m);
  }
  scene.add(group);
  effects.push({ group, parts, t: 0, life: 1.6 });
}

function stepEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const fx = effects[i];
    fx.t += dt;
    for (const p of fx.parts) {
      p.v.y -= 6.5 * dt;
      p.v.multiplyScalar(1 - 1.4 * dt);
      p.m.position.addScaledVector(p.v, dt);
      p.m.rotation.x += p.spin.x * dt; p.m.rotation.y += p.spin.y * dt;
      p.m.material.opacity = Math.max(0, 1 - fx.t / fx.life);
    }
    if (fx.t >= fx.life) {
      fx.group.removeFromParent();
      fx.parts.forEach((p) => p.m.material.dispose());
      effects.splice(i, 1);
    }
  }
}

// ---------- share image (web/share/share.js) ----------

// One still of the current floor for the share card, framed like a product shot: the floor, the stack under it and the
// elevator fitted into `box` (fractions of the frame, y down: the caption gets the rest), on the same white studio
// through the same post chain, at width x height, supersampled by `scale` when the GPU allows it.
// Nothing private gets in: the in-scene tags are DOM and are never drawn into the canvas; the wall screen and the task
// board are redrawn for this one frame without the floor's name, bot names or tasks; selection / hover rings, bots on
// their way out and confetti are hidden. The live canvas is resized, drawn, copied out and restored inside this one
// task, then the live view is drawn again before the browser paints, so nothing flickers.
// Returns a <canvas> of width x height, or null while the office is still loading.
export function captureScene({ width = 1600, height = 900, scale = 1, box = { x: 0.06, y: 0.06, w: 0.88, h: 0.76 } } = {}) {
  const inst = building?.activeOpen();
  if (!inst || !post) return null;
  const pr = renderer.getPixelRatio();
  const maxPx = Math.min(renderer.capabilities.maxTextureSize, renderer.capabilities.maxRenderbufferSize || Infinity);
  const ss = Math.max(1, Math.min(scale, maxPx / width, maxPx / height));
  const zoom0 = camera.zoom, pos0 = camera.position.clone();
  const hidden = [];
  const hide = (o) => { if (o?.visible) { o.visible = false; hidden.push(o); } };
  for (const a of actors.values()) hide(a.ring);
  for (const a of retiring) hide(a.root);
  for (const fx of effects) hide(fx.group);
  const walls = inst.walls, live = walls?.data;
  try {
    if (live) {
      const anon = { ...live, floorName: `Floor ${building.activeIndex + 1}`, bots: live.bots.map((b) => ({ ...b, name: '', task: '', step: '' })) };
      if (walls.screen) walls.drawScreen(anon);
      if (walls.board) walls.drawBoard(anon);
    }
    renderer.setPixelRatio(ss);
    renderer.setSize(width, height, false);
    post.setSize(width, height);
    frameShot(width / height, box);
    focusV.set(0, building.cabinY.x + 0.7, 0).project(camera);
    post.render(clamp(focusV.y * 0.5 + 0.5, 0, 1), 0, 1);
    const out = document.createElement('canvas');
    out.width = width; out.height = height;
    const g = out.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(renderer.domElement, 0, 0, width, height);
    return out;
  } finally {
    hidden.forEach((o) => { o.visible = true; });
    if (live) {
      if (walls.screen) walls.drawScreen(live);
      if (walls.board) walls.drawBoard(live);
    }
    renderer.setPixelRatio(pr);
    resize();
    camera.zoom = zoom0;
    camera.position.copy(pos0);
    camera.updateProjectionMatrix();
    focusV.set(0, building.cabinY.x + 0.7, 0).project(camera);
    post.render(clamp(focusV.y * 0.5 + 0.5, 0, 1), 0, clamp(1.5 / camera.zoom, 0.25, 1));
  }
}

// The camera at its home spot over the active floor, the frustum fitted to every visible building mesh (in view space,
// so the iso silhouette is measured, not a world box) and placed so that silhouette is centred in `box`.
const shotBox = new THREE.Box3();
const shotCorner = new THREE.Vector3();
function frameShot(aspect, box) {
  camera.clearViewOffset();
  camera.zoom = 1;
  camera.position.set(HOME.x, building.activeY + HOME.y, HOME.z).addScaledVector(ISO_DIR, 80);
  camera.updateMatrixWorld(true);
  building.group.updateMatrixWorld(true);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const walk = (o) => {
    if (!o.visible) return;
    if (o.isMesh && o.geometry) {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      shotBox.copy(o.geometry.boundingBox);
      for (let i = 0; i < 8; i++) {
        shotCorner.set(i & 1 ? shotBox.max.x : shotBox.min.x, i & 2 ? shotBox.max.y : shotBox.min.y, i & 4 ? shotBox.max.z : shotBox.min.z)
          .applyMatrix4(o.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
        x0 = Math.min(x0, shotCorner.x); x1 = Math.max(x1, shotCorner.x);
        y0 = Math.min(y0, shotCorner.y); y1 = Math.max(y1, shotCorner.y);
      }
    }
    for (const c of o.children) walk(c);
  };
  walk(building.group);
  if (!Number.isFinite(x0)) { x0 = -VIEW_SPAN.w / 2; x1 = VIEW_SPAN.w / 2; y0 = -VIEW_SPAN.h / 2; y1 = VIEW_SPAN.h / 2; }
  const fh = Math.max((y1 - y0) / box.h, (x1 - x0) / (box.w * aspect)), fw = fh * aspect;
  camera.left = (x0 + x1) / 2 - (box.x + box.w / 2) * fw;
  camera.right = camera.left + fw;
  camera.top = (y0 + y1) / 2 + (box.y + box.h / 2) * fh;
  camera.bottom = camera.top - fh;
  camera.updateProjectionMatrix();
}

// ---------- loop ----------

function updateCursorGround() {
  if (pinCursor || !cursor.active || !building) return;
  raycaster.setFromCamera(pointer, camera);
  groundPlane.constant = -building.activeY;
  if (raycaster.ray.intersectPlane(groundPlane, tmp)) { cursor.x = tmp.x; cursor.z = tmp.z; } else cursor.active = false;
}

const focusV = new THREE.Vector3();

let lastDraw = 0;

function frame(t) {
  if (document.hidden) { clock.getDelta(); return; }       // no work in a background tab
  if (WALLPAPER) {                                          // <= 30 fps: skip the in-between vsyncs; dt keeps real time
    const since = t - lastDraw;
    if (since < WALLPAPER_FRAME_MS - 2) return;
    lastDraw += Math.max(1, Math.round(since / WALLPAPER_FRAME_MS)) * WALLPAPER_FRAME_MS;  // stay on the 33 ms grid (100+ Hz displays)
    if (t - lastDraw > WALLPAPER_FRAME_MS / 2) lastDraw = t;                                // fell behind (hidden, hitch): resync, no bursts
  }
  const dt = frozen ? 0 : Math.min(clock.getDelta(), 0.05);
  if (frozen) clock.getDelta();
  nowSec = clock.elapsedTime;
  const nowMs = performance.now();

  daylight.update(dt, nowMs);
  stepCamera(dt);
  if (building) building.update(dt, nowMs);
  if (pointerDirty && !drag?.panning) { pointerDirty = false; setHover(pick()); }
  updateCursorGround();

  const hostAlpha = building?.activeOpen()?.alpha ?? 1;
  const open = building?.activeOpen();
  if (open) {
    tickLife(open, dt, nowSec);
    const talked = lastState ? tickTeam(open, Object.values(lastState.bots).filter((b) => b.floor === building.activeId), dt, nowSec) : null;
    if (talked) actors.get(talked.speaker.id)?.speak(talked.step, 1.6, nowSec);
    if (!REDUCED && getQuality() === 'high' && lastState) {
      for (const b of Object.values(lastState.bots)) {
        if (b.floor !== building.activeId || (b.effective_status || b.status) !== 'working') continue;
        if (Math.random() < dt * 0.45) {
          const a = actors.get(b.id);
          if (a) spawnBeam(open.root, a.root.position);
        }
      }
    }
    tickPackets(dt, REDUCED || getQuality() === 'low');
    const pace = new Map();
    if (lastState) {
      const now = Date.now();
      for (const b of Object.values(lastState.bots)) pace.set(b.id, isWorking(b, now));
      for (const f of lastState.feed || []) {
        const at = Date.parse(f.t);
        if (!f.bot || !Number.isFinite(at) || now - at > RECENT_MS) continue;
        const row = { status: f.status, effective_status: f.status, last_event: f.t };
        if (f.to && isWorking(row, now)) pace.set(f.bot, true);
      }
    }
    setFlowPace(pace);
    tickNetwork(REDUCED ? 0 : dt);
    tickPolish(open.obj, daylight?.state?.night || 0);
    tickFloor(nowSec);
    city.tick(nowSec);
    const hallMesh = open.root.getObjectByName('team-hall');
    if (hallMesh) {
      hallMesh.updateMatrixWorld(true);
      hallMesh.traverse((o) => { if (o.userData?.billboard) faceSign(o, camera); });
    }
    cullLabels(camera, open);
    ensureDust(open.root);
    tickDust(dt);
  }
  const hi = getQuality() === 'high' && !REDUCED && !isSoftGpu();
  if (post?.setBloom) post.setBloom(getQuality() !== 'low');
  if (post?.setAo) post.setAo(hi);
  if (post?.setDof) {
    const sel = lastView.selectedBot && actors.get(lastView.selectedBot);
    if (hi && sel) {
      sel.root.getWorldPosition(tmp);
      tmp.applyMatrix4(camera.matrixWorldInverse);
      post.setDof(Math.max(0.5, -tmp.z));
    } else post.setDof(0);
  }
  for (const a of actors.values()) { a.ctx.now = nowSec; a.hostAlpha = hostAlpha; a.tick(dt, nowSec); }
  for (const a of retiring) {
    a.hostAlpha = a.ctx.inst.alpha;
    a.tick(dt, nowSec);
    if (a.dead) retiring.delete(a);
  }
  stepEffects(dt);

  if (post) {
    focusV.set(0, (building ? building.cabinY.x : 0) + 0.7, 0).project(camera);
    post.render(clamp(focusV.y * 0.5 + 0.5, 0, 1), dt, 0);
  } else renderer.render(scene, camera);
  updateLabels();
  if (!WALLPAPER || WALLPAPER_TAGS) labels.render(scene, camera);
}

const labelPoint = new THREE.Vector3();
function updateLabels() {
  const close = cam.dist.x < (isPortraitPhone() ? 14 : 16);
  const ranked = [];
  for (const a of actors.values()) {
    const attn = a.status === 'waiting_user' || a.status === 'error' || a.status === 'stuck';
    a.ctx.labelMode = (a.selected || a.hovered || attn) ? 'name' : close ? 'name' : 'dot';
    a.renderTag();
    const on = a.tagEl.dataset.mode !== 'off' && a.hostAlpha > 0.5 && !a.retiring;
    a.tag.visible = on;
    if (!on) continue;
    labelPoint.copy(a.root.position);
    labelPoint.y += 1.45;
    labelPoint.project(camera);
    const onScreen = labelPoint.z > 0 && labelPoint.z < 1 && Math.abs(labelPoint.x) < 1.05 && Math.abs(labelPoint.y) < 1.05;
    if (!onScreen) { a.tag.visible = false; a.tagEl.style.opacity = '0'; continue; }
    ranked.push({
      a, x: labelPoint.x, y: labelPoint.y,
      pri: a.selected ? 4 : a.hovered ? 3 : attn ? 2 : 1,
      named: a.tagEl.dataset.mode !== 'dot',
    });
  }
  ranked.sort((p, q) => q.pri - p.pri);
  const kept = [];
  for (const p of ranked) {
    const limit = p.named ? 0.22 : 0.05;
    const hit = kept.some((k) => Math.hypot(k.x - p.x, k.y - p.y) < limit);
    p.a.tagEl.style.opacity = hit ? '0' : '1';
    if (!hit) kept.push(p);
  }
}
