// Waiting list, feed ticker, and tab title. Every string from the feed goes through textContent.
// There is no audio: no chime, no typing sound, no AudioContext.
import { getQuality, toggleQuality } from './polish.js?v=7';

const BASE_TITLE = document.title || 'Grok Bot Dashboard';

let onFocus = () => {};
let root, list, ticker, qualBtn;

function el(tag, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

let onFloor = () => {};
let tools, floorPill, needsBtn, teamBtn, menuBtn;

export function initHud({ onFocus: focus, onFloor: floor } = {}) {
  if (root) return;
  onFocus = focus || onFocus;
  onFloor = floor || onFloor;
  root = el('aside', 'hq-wait');
  root.setAttribute('aria-label', 'Bots waiting for you');
  const head = el('div', 'hq-wait-head');
  const title = el('b');
  title.textContent = 'Waiting';
  qualBtn = el('button', 'hq-wait-tog');
  qualBtn.type = 'button';
  qualBtn.title = 'High draws bloom and dust. Low keeps the office lighter on a weak GPU.';
  qualBtn.addEventListener('click', () => { toggleQuality(); paintQuality(); });
  head.append(title, qualBtn);
  paintQuality();
  list = el('ol', 'hq-wait-list');
  root.append(head, list);
  ticker = el('div', 'hq-ticker');
  ticker.setAttribute('aria-live', 'polite');
  tools = el('div', 'hq-tools');
  floorPill = el('div', 'hq-floors');
  floorPill.setAttribute('role', 'tablist');
  needsBtn = el('button', 'hq-tool');
  needsBtn.type = 'button';
  needsBtn.hidden = true;
  needsBtn.addEventListener('click', () => document.documentElement.classList.toggle('hq-show-needs'));
  teamBtn = el('button', 'hq-tool');
  teamBtn.type = 'button';
  teamBtn.textContent = 'Team';
  teamBtn.addEventListener('click', () => {
    const on = document.documentElement.classList.toggle('hq-show-team');
    teamBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  menuBtn = el('button', 'hq-tool');
  menuBtn.type = 'button';
  menuBtn.textContent = 'Menu';
  menuBtn.addEventListener('click', () => {
    const on = document.documentElement.classList.toggle('hq-show-more');
    menuBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  tools.append(floorPill, needsBtn, teamBtn, menuBtn);
  document.body.append(tools, root, ticker);
}

function paintQuality() { if (qualBtn) qualBtn.textContent = getQuality() === 'high' ? 'High' : 'Low'; }

export function renderHud(state, view) {
  if (!state) return;
  const bots = Object.values(state.bots || {});
  const waiting = bots
    .filter((b) => (b.effective_status || b.status) === 'waiting_user')
    .sort((a, b) => (Date.parse(a.since) || 0) - (Date.parse(b.since) || 0) || String(a.name).localeCompare(String(b.name)));
  document.title = waiting.length ? `(${waiting.length}) waiting` : BASE_TITLE;
  if (needsBtn) {
    needsBtn.hidden = waiting.length === 0;
    needsBtn.textContent = waiting.length === 1 ? '1 needs you' : `${waiting.length} need you`;
  }
  if (floorPill && state.floors) {
    floorPill.replaceChildren();
    const floors = [...state.floors].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    floors.forEach((f, i) => {
      const b = el('button');
      b.type = 'button';
      const label = String(f.name || `Room ${i + 1}`);
      b.textContent = label.length > 18 ? `${label.slice(0, 17)}…` : label;
      b.title = label;
      b.setAttribute('aria-label', label);
      b.dir = 'auto';
      if (view && f.id === view.currentFloor) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', () => onFloor(f.id));
      floorPill.append(b);
    });
  }
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
}

function renderTicker(state) {
  const rows = [];
  for (const f of state.feed || []) rows.push({ t: Date.parse(f.t) || 0, name: f.name || f.bot || '', text: [label(f.status), f.step].filter(Boolean).join(' · ') });
  for (const t of state.ticker || []) if (t.kind !== 'chat') rows.push({ t: Date.parse(t.t) || 0, name: t.name || '', text: t.text || '' });
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
  ticker.hidden = slice.length === 0;
  ticker.append(track);
}

function label(status) {
  return { working: 'working', idle: 'resting', waiting_user: 'waiting', error: 'error', stuck: 'stuck', done: 'done' }[status] || '';
}

