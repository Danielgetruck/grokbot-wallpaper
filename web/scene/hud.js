// Waiting list, feed ticker, tab title, and the two optional sounds. Every string from the feed
// goes through textContent. Chime and typing are off until the visitor turns them on.
const CHIME_KEY = 'bothq.chime';
const TYPE_KEY = 'bothq.typing';
const BASE_TITLE = document.title || 'Grok Bot Dashboard';

let onFocus = () => {};
let root, list, ticker, chimeBtn, typeBtn;
let prevWait = null;
let audio = null, typing = null;

function pref(key) {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}
function setPref(key, on) {
  try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* private mode */ }
}

function el(tag, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

export function initHud({ onFocus: focus } = {}) {
  if (root) return;
  onFocus = focus || onFocus;
  root = el('aside', 'hq-wait');
  root.setAttribute('aria-label', 'Bots waiting for you');
  const head = el('div', 'hq-wait-head');
  const title = el('b');
  title.textContent = 'Waiting';
  chimeBtn = el('button', 'hq-wait-tog');
  chimeBtn.type = 'button';
  typeBtn = el('button', 'hq-wait-tog');
  typeBtn.type = 'button';
  chimeBtn.textContent = 'Chime';
  typeBtn.textContent = 'Typing';
  chimeBtn.title = 'Chime when a bot starts waiting. Off until you turn it on.';
  typeBtn.title = 'Soft typing while someone is working. Off until you turn it on.';
  head.append(title, chimeBtn, typeBtn);
  list = el('ol', 'hq-wait-list');
  root.append(head, list);
  ticker = el('div', 'hq-ticker');
  ticker.setAttribute('aria-live', 'polite');
  document.body.append(root, ticker);
  paintToggles();
  chimeBtn.addEventListener('click', () => { setPref(CHIME_KEY, !pref(CHIME_KEY)); paintToggles(); if (pref(CHIME_KEY)) unlock(); });
  typeBtn.addEventListener('click', () => { setPref(TYPE_KEY, !pref(TYPE_KEY)); paintToggles(); if (pref(TYPE_KEY)) unlock(); });
}

function paintToggles() {
  const c = pref(CHIME_KEY), t = pref(TYPE_KEY);
  chimeBtn.setAttribute('aria-pressed', c ? 'true' : 'false');
  typeBtn.setAttribute('aria-pressed', t ? 'true' : 'false');
}

function unlock() {
  if (audio) return audio;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  audio = new Ctx();
  return audio;
}

export function renderHud(state) {
  if (!state) return;
  const bots = Object.values(state.bots || {});
  const waiting = bots
    .filter((b) => (b.effective_status || b.status) === 'waiting_user')
    .sort((a, b) => (Date.parse(a.since) || 0) - (Date.parse(b.since) || 0) || String(a.name).localeCompare(String(b.name)));
  document.title = waiting.length ? `(${waiting.length}) waiting` : BASE_TITLE;
  if (!root) return;
  root.hidden = waiting.length === 0;
  list.replaceChildren();
  const now = Date.parse(state.now) || Date.now();
  for (const b of waiting.slice(0, 6)) {
    const li = el('li');
    const btn = el('button');
    btn.type = 'button';
    const name = el('b');
    name.textContent = b.name || b.id || '';
    const wait = el('span');
    const mins = Math.max(0, Math.round((now - (Date.parse(b.since) || now)) / 60000));
    wait.textContent = mins < 1 ? 'just now' : `${mins}m`;
    btn.append(name, wait);
    btn.addEventListener('click', () => onFocus(b.id));
    li.append(btn);
    list.append(li);
  }
  if (waiting.length > 6) {
    const more = el('li', 'hq-wait-more');
    more.textContent = `+${waiting.length - 6}`;
    list.append(more);
  }
  renderTicker(state);
  noteNewWaiting(waiting);
  syncTyping(bots.some((b) => (b.effective_status || b.status) === 'working'));
}

function renderTicker(state) {
  const rows = [];
  for (const f of state.feed || []) rows.push({ t: Date.parse(f.t) || 0, name: f.name || f.bot || '', text: [label(f.status), f.step].filter(Boolean).join(' · ') });
  for (const t of state.ticker || []) rows.push({ t: Date.parse(t.t) || 0, name: t.name || '', text: t.text || '' });
  rows.sort((a, b) => b.t - a.t);
  ticker.replaceChildren();
  const track = el('div', 'hq-ticker-track');
  const slice = rows.slice(0, 8);
  if (!slice.length) { const s = el('span'); s.textContent = 'No activity yet'; track.append(s); }
  for (const r of slice) {
    const s = el('span');
    const b = el('b');
    b.textContent = r.name;
    s.append(b, document.createTextNode(r.text ? ` ${r.text}` : ''));
    track.append(s);
  }
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce && slice.length) for (const n of [...track.children]) track.append(n.cloneNode(true));
  ticker.append(track);
}

function label(status) {
  return { working: 'working', idle: 'resting', waiting_user: 'waiting', error: 'error', stuck: 'stuck', done: 'done' }[status] || '';
}

function noteNewWaiting(waiting) {
  const ids = new Set(waiting.map((b) => b.id));
  if (prevWait) {
    for (const id of ids) if (!prevWait.has(id) && pref(CHIME_KEY)) chime();
  }
  prevWait = ids;
}

function chime() {
  const ctx = unlock();
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(880, t);
  o.frequency.exponentialRampToValueAtTime(660, t + 0.18);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  o.connect(g).connect(ctx.destination);
  o.start(t); o.stop(t + 0.36);
}

function syncTyping(working) {
  const want = working && pref(TYPE_KEY);
  if (!want) { stopTyping(); return; }
  const ctx = unlock();
  if (!ctx || typing) return;
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (Math.random() < 0.08 ? 1 : 0.15);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1800;
  filter.Q.value = 0.7;
  const g = ctx.createGain();
  g.gain.value = 0.015;
  src.connect(filter).connect(g).connect(ctx.destination);
  src.start();
  typing = { src, g };
}

function stopTyping() {
  if (!typing) return;
  try { typing.src.stop(); } catch { /* already stopped */ }
  typing = null;
}
