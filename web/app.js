// Glue: polls /api/state (CONTRACT §4), keeps the view (floor, selection), feeds the scene and the UI.
// With #<topic> in the link it reads the user's bots from their channel instead (feed.js, lib/feedbase.js): no server.
// Without either (static preview) it runs on web/data/demo-state.json with a local simulation.
import { initScene, renderScene, zoom, focusBot } from './scene/scene.js?v=12';
import { sfx } from './audio/sound.js?v=12';
import { initHud, renderHud } from './scene/hud.js?v=12';

const POLL_MS = 1000;
const view = { currentFloor: null, selectedBot: null };
let state = null;
let ui = { initUI() {}, renderUI() {} };
let demoTimer = null;

// Wallpaper mode (?mode=wallpaper, for Lively): office full screen + one status line, no interaction except hover.
//   &floor=<id>   pin the floor (default: the floor with the most bots)
//   &cycle=<sec>  go to the next floor every <sec> seconds through the normal elevator switch
const params = new URLSearchParams(location.search);
const WALLPAPER = params.get('mode') === 'wallpaper';
if (WALLPAPER) document.documentElement.classList.add('wallpaper');
document.documentElement.classList.add('hq-quiet');

try {
  ui = await import(WALLPAPER ? './wallpaper.js?v=12' : './ui/ui.js?v=12');
} catch (err) {
  console.warn('[app] UI module not available yet:', err.message);
}

initScene(document.getElementById('scene'), {
  onSelectBot: (id) => select(id),
  onHoverBot: (id) => sfx.hover(id),
  onSelectFloor: (id) => setFloor(id),
});

ui.initUI({
  onSelectBot: (id) => select(id),
  onSelectFloor: (id) => setFloor(id),
  onZoom: (dir) => { zoom(dir); sfx.zoom(dir); },
  onOpenChat: (id, url) => { if (url) location.href = url; },
});
if (!WALLPAPER) initHud({ onFocus: (id) => select(id), onFloor: (id) => setFloor(id) });

addEventListener('keydown', (e) => { if (e.key === 'Escape') select(null); });

function select(id) {
  const before = view.selectedBot;
  view.selectedBot = id && state?.bots[id] ? id : null;
  if (view.selectedBot !== before) sfx.select(!!view.selectedBot);
  if (view.selectedBot) {
    const bot = state.bots[view.selectedBot];
    if (bot.floor !== view.currentFloor) setFloor(bot.floor, true);
    render();
    requestAnimationFrame(() => focusBot(view.selectedBot));
  } else {
    render();
  }
}

function setFloor(id, keepSelection = false) {
  if (!state?.floors.some((f) => f.id === id)) return;
  if (window.bothq?.hall && window.bothq.focusRoom) {
    view.currentFloor = id;
    if (!keepSelection) view.selectedBot = null;
    window.bothq.focusRoom(id);
    render();
    return;
  }
  if (id !== view.currentFloor) {                        // the elevator's chime rings higher on higher floors
    const order = [...state.floors].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).findIndex((f) => f.id === id);
    sfx.floor(order);
  }
  view.currentFloor = id;
  if (!keepSelection) view.selectedBot = null;
  if (!WALLPAPER) { try { localStorage.setItem('bothq.floor', id); } catch {} }
  zoom('reset');
  render();
}

function pickDefaultFloor() {
  const fullest = () => [...state.floors].sort((a, b) => b.bots.length - a.bots.length)[0]?.id ?? null;
  if (WALLPAPER) {
    const pinned = params.get('floor');
    return pinned && state.floors.some((f) => f.id === pinned) ? pinned : fullest();
  }
  let saved = null;
  try { saved = localStorage.getItem('bothq.floor'); } catch {}
  if (saved && state.floors.some((f) => f.id === saved)) return saved;
  return fullest();
}

// &cycle=<sec>: rotate through the floors (by `order`) with the usual elevator ride; paused while the page is hidden.
const cycleSec = WALLPAPER ? Number(params.get('cycle')) : 0;
if (cycleSec >= 5) {
  setInterval(() => {
    if (document.hidden || !state || state.floors.length < 2) return;
    const floors = [...state.floors].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const i = floors.findIndex((f) => f.id === view.currentFloor);
    setFloor(floors[(i + 1) % floors.length].id);
  }, cycleSec * 1000);
}

function asOneOffice(s) {
  if (!s?.bots) return s;
  const ids = Object.keys(s.bots);
  if (!ids.length) return s;
  const bots = {};
  for (const id of ids) bots[id] = { ...s.bots[id], floor: 'office' };
  return { ...s, bots, floors: [{ id: 'office', name: 'הצוות', order: 1, bots: ids }] };
}

function render() {
  if (!state) return;
  const office = asOneOffice(state);
  if (!view.currentFloor || !office.floors.some((f) => f.id === view.currentFloor)) view.currentFloor = office.floors[0]?.id ?? null;
  if (view.selectedBot && !office.bots[view.selectedBot]) view.selectedBot = null;
  renderScene(office, view);
  ui.renderUI(office, view);
  if (!WALLPAPER) renderHud(office, view);
  if (!WALLPAPER) soundStatusChanges();
}

// A bot that just started waiting for you, failed or finished gets a short sound (one per batch, the most urgent).
// The first state is the baseline, so opening the page or replaying the channel's history stays quiet.
let lastStatus = null;
function soundStatusChanges() {
  const now = {};
  for (const [id, b] of Object.entries(state.bots)) now[id] = b.effective_status;
  if (lastStatus) {
    const fresh = new Set();
    for (const [id, s] of Object.entries(now)) if (lastStatus[id] && lastStatus[id] !== s) fresh.add(s);
    const kind = ['waiting_user', 'error', 'done'].find((k) => fresh.has(k));
    if (kind) sfx.status(kind);
  }
  lastStatus = now;
}

// ---------- live polling ----------

async function poll() {
  try {
    const since = state && !state.demoLocal ? `?since=${state.version}` : '';
    const res = await fetch(`api/state${since}`, { cache: 'no-store', credentials: 'same-origin' });   // relative: works under a sub-path too
    if (res.status === 401) { location.href = 'login'; return; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (demoTimer) { clearInterval(demoTimer); demoTimer = null; }
    if (!data.unchanged) { state = data; render(); }
  } catch {
    if (!state) await startLocalDemo();
    if (state?.demoLocal) return;          // static preview: no server, stop polling
  }
  setTimeout(poll, POLL_MS);
}

// ---------- the user's own bots: #<topic> ----------

const DEMO = params.get('demo') === '1';
const { feedFromLink } = await import('./lib/feedbase.js?v=12');
if (DEMO) startModDemo();
else if (feedFromLink(location)) {                              // #<topic>, #<topic>@<host>, ?feed=<host>#<topic>
  const { feedFromHash, connectFeed } = await import('./feed.js?v=12');
  connectFeed(feedFromHash(location.hash, location.search), (data) => { state = data; render(); });
  addEventListener('hashchange', () => location.reload());   // another channel: start over
} else {
  poll();
}

// ---------- static preview: local simulation ----------

function startModDemo() {
  document.documentElement.dataset.demo = '1';
  const banner = document.createElement('div');
  banner.className = 'hq-demo';
  banner.textContent = 'Demo · fake data, not the live feed';
  document.body.append(banner);
  const groups = [
    ['הצוות', ['Master', 'MoD', 'MoD1', 'MoD2', 'MoD3', 'Mod5', 'MoD6', 'MoD7', 'Mod8']],
    ['Logistic Care', ['Lane', 'Porter', 'Cargo', 'Route']],
    ['עוזרים אישיים', ['Noa', 'Amit', 'Yael', 'Dana']],
    ['QA ותמיכה', ['QA1', 'QA2', 'QA3', 'QA4', 'QA5']],
    ['פרויקטים', ['Atlas', 'Nimbus', 'Harbor', 'Field']],
  ];
  const bots = {};
  const floors = groups.map(([name, members], gi) => {
    const id = `g${gi}`;
    members.forEach((name2, i) => {
      const bid = `${id}-${i}`;
      const status = (gi + i) % 5 === 0 ? 'working' : (gi === 0 && i === 3) ? 'waiting_user' : 'idle';
      bots[bid] = {
        id: bid, name: name2, floor: id, desk: i + 1,
        status, effective_status: status,
        step: status === 'working' ? 'demo: checking the queue' : status === 'waiting_user' ? 'demo: need a look' : '',
        since: new Date(Date.now() - (gi * 5 + i) * 60000).toISOString(),
        last_event: new Date().toISOString(), color: '#C4B5FD', look: null, history: [],
      };
    });
    return { id, name, order: gi + 1, bots: members.map((_, i) => `${id}-${i}`) };
  });
  state = {
    demo: true, demoLocal: true, now: new Date().toISOString(), version: 1,
    floors, bots,
    feed: [{ t: new Date().toISOString(), bot: 'g0-0', name: 'MoD', status: 'working', step: 'demo: checking the queue' }],
    ticker: [], summary: {}, routines: [],
  };
  render();
  demoTimer = setInterval(() => {
    const list = Object.values(state.bots);
    const b = list[Math.floor(Math.random() * list.length)];
    const next = b.effective_status === 'working' ? 'idle' : 'working';
    b.status = b.effective_status = next;
    b.step = next === 'working' ? 'demo: passing a note to MoD' : '';
    b.since = new Date().toISOString();
    state.feed.unshift({ t: b.since, bot: b.id, name: b.name, status: next, step: b.step });
    state.feed = state.feed.slice(0, 12);
    state.now = b.since;
    render();
  }, 2200);
}

async function startLocalDemo() {
  const res = await fetch('./data/demo-state.json', { cache: 'no-store' });
  state = await res.json();
  state.demoLocal = true;
  render();
  demoTimer = setInterval(simulate, 1600);
}

const STEPS = {
  working: ['scanning X, 7 searches', 'reading 40 fresh posts', 'drafting a thread', 'checking the numbers', 'compiling the report', 'drawing the cover', 'cross-checking sources'],
  waiting_user: ['waiting for your answer: publish?', 'need a budget OK', 'which option should we pick?'],
  error: ['X rate limit 429, retry in 15 min', "couldn't open the report file"],
  done: ['done: report sent', 'draft ready', 'task closed'],
  idle: ['waiting for a new task'],
};
const TASKS = ['Thread about AI agents for Monday', 'Covers for the post series', 'Weekly reach report',
  'Competitor post breakdown', 'Summary across all floors', 'Plan for the week'];
const NEXT = {
  working: [['working', 5], ['done', 3], ['waiting_user', 1], ['error', 0.5]],
  done: [['idle', 3], ['working', 2]],
  idle: [['working', 3], ['idle', 2]],
  waiting_user: [['working', 2], ['waiting_user', 2]],
  error: [['working', 2], ['error', 1]],
  stuck: [['working', 2], ['stuck', 2]],
};

function simulate() {
  const bots = Object.values(state.bots);
  const bot = bots[Math.floor(Math.random() * bots.length)];
  const cur = bot.effective_status;
  const next = weighted(NEXT[cur] || NEXT.idle);
  const step = pickOne(STEPS[next] || STEPS.working);
  const now = new Date().toISOString();
  if (next !== cur) bot.since = now;
  bot.status = next;
  bot.effective_status = next;
  bot.step = step;
  bot.last_event = now;
  if (next === 'idle') bot.task = null;
  else if (!bot.task || /^tsk-/.test(bot.task)) bot.task = pickOne(TASKS);
  const today = (bot.today ||= { working_min: 0, events: 0, tasks_done: 0 });
  today.events++;
  if (next === 'done') today.tasks_done++;
  (today.hourly ||= new Array(24).fill(0))[new Date().getHours()]++;
  bot.history.unshift({ t: now, status: next, step });
  bot.history.length = Math.min(bot.history.length, 20);
  state.feed.unshift({ t: now, bot: bot.id, name: bot.name, status: next, step });
  state.feed.length = Math.min(state.feed.length, 100);
  recount();
  state.now = now;
  state.version++;
  render();
}

function recount() {
  const zero = () => ({ working: 0, idle: 0, waiting_user: 0, error: 0, stuck: 0, done: 0 });
  state.summary = { ...zero(), total: 0 };
  for (const f of state.floors) f.counts = zero();
  for (const b of Object.values(state.bots)) {
    state.summary[b.effective_status]++;
    state.summary.total++;
    const f = state.floors.find((x) => x.id === b.floor);
    if (f) f.counts[b.effective_status]++;
  }
}

function weighted(list) {
  let r = Math.random() * list.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of list) if ((r -= w) <= 0) return v;
  return list[0][0];
}

function pickOne(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
