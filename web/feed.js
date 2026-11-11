// Bots-only mode: the office reads the user's bots from ntfy.sh. The link is …/#<topic>.<key>. The key never leaves
// the hash: each message body is `gbwenc1:` + AES-256-GCM, and a body that does not decrypt is dropped. The topic is
// not a secret. Decrypted lines are cached for this tab only (sessionStorage, keyed by the topic). A `working` bot
// that stays silent for 20 minutes counts as idle (it forgot its closing line).
//
// Lines on the channel (one JSON object per message, at most 4 KB, anything else is dropped):
//   {"bot":"…","status":"working|idle|waiting_user|error|done","step":"…"}     a status change
//   {"roster":["Bot A","Bot B"]}                                                every bot appears, idle until it posts
//   {"looks":{"Bot A":{"shape":"sphere","color":"#RRGGBB","accessory":"none"}}} how each bot's blob looks
//   {"type":"usage","total_used_pct":37,"resets_at":"…","bots":{"Bot A":4.1}}  the weekly limit meter
//   {"groups":{"Bot A":"Content"}}                                            teams, one floor each
//   {"chat":{"Bot A":"grokbot://app/v1/agent?id=…"}}                         each bot's chat, for «Open chat»
//   {"routines":{"bot":"Bot A","items":[{"name":"…","schedule":"…","next_run":"ISO"}]}}   a bot's routines
//   {"check":{"bots":["Bot A","Bot B"]}}                                     the setup bot starts a status check
// On top of the server's state the office gets state.finished (done lines of the last 24 h, newest first),
// state.routines (every bot's routines, soonest first) and state.check (the latest status check: who has answered), for
// the «Finished», «Routines» and «Status check» panels.
import { StateStore, botIdFor } from './lib/state.js?v=19';
import { FEED_BASE, feedFromLink } from './lib/feedbase.js?v=19';
import { openFeedMessage } from './lib/feedcrypt.js?v=19';

const NTFY = 'https://ntfy.sh';
const MAX_LINE = 4096, KEEP = 600, TICK_MS = 30e3, DAY_MS = 24 * 3600e3;
const QUIET_MS = 20 * 60e3, CHECK_MS = 6 * 3600e3;    // a silent worker turns idle; a status check stays up this long
// Everyone's bots, ours included, are built from their look (the app's 14 avatars and 11 colours, read from a
// screenshot), so a bot in the office is the bot in the app. The hand-made GLBs in assets/blobs/ stay for the local server.
const HANDMADE = new Set();

/** The page's hash and query -> { topic }, or null without a topic. The encrypted office reads ntfy.sh only. */
export function feedFromHash(hash, search = '') {
  const f = feedFromLink({ hash: hash || '', search });
  if (!f || f.base !== FEED_BASE) return null;
  return { topic: f.topic, servers: [NTFY] };
}

/** Rebuild from cache + each mailbox's last 12 h, then follow them live. Calls onState(state) on every change.
 *  `key` is a non-extractable CryptoKey. Without it nothing is read. */
export async function connectFeed({ topic, key }, onState) {
  if (!key || typeof topic !== 'string') return;
  const sources = [{ tag: 'ntfy', base: `${NTFY}/${encodeURIComponent(topic)}`, lastId: null }];
  const cacheKey = `bothq.feed.s1.${topic}`;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Sofia';
  const store = new StateStore({ tz, quietIdleMs: QUIET_MS, hasAvatar: (id) => HANDMADE.has(id) });   // no GLB probe: every bot is generated from its look
  const cfg = {};                                        // per bot name: { look, chat_url } -> the store's bots config
  const routines = new Map();                            // bot id -> { name, items }
  const ticker = [];                                     // chat links and routines, newest first (status lines live on state.feed)
  const pushTicker = (item) => { ticker.unshift(item); if (ticker.length > 30) ticker.pop(); };
  let check = null;                                      // the latest status check: { ms, names }
  let lines = [], saveTimer = 0;
  const seen = new Set();

  lines = cached(cacheKey).map((l) => ({ ...l, src: l.src || sources[0].tag }));
  await Promise.all(sources.map(async (s) => {
    try {
      const text = await (await fetch(`${s.base}/json?poll=1&since=12h`, { cache: 'no-store' })).text();
      for (const row of text.split('\n')) if (row) {
        try { await keep(s, JSON.parse(row)); } catch { /* junk row */ }
      }
    } catch { /* offline or down: the session cache still shows the office */ }
  }));
  lines = lines.filter(fresh).sort((a, b) => a.time - b.time);   // stable: lines of one second keep the mailbox's order
  for (const l of lines) ingest(l, true);
  save();
  publish();

  for (const s of sources) follow(s);
  setInterval(() => { const v = store.version, s = store.snapshot(); if (store.version !== v) onState(extras(s)); }, TICK_MS);

  function cached(key) {
    try { return JSON.parse(sessionStorage.getItem(key)) || []; } catch { return []; }
  }
  function fresh(l) {                                    // once per mailbox id, and once per (time, text) across mailboxes
    const a = `${l.src} ${l.id}`, b = `${l.time} ${l.message}`;
    if (seen.has(a) || seen.has(b)) return false;
    seen.add(a).add(b);
    return true;
  }
  async function reveal(body) {
    const text = await openFeedMessage(body, key);
    return typeof text === 'string' && text.length <= MAX_LINE ? text : null;
  }
  async function keep(s, m) {                            // a history message, stored only after it decrypts
    if (m?.event !== 'message' || typeof m.id !== 'string') return;
    s.lastId = m.id;                                     // advance even when the body is dropped, so catch-up does not spin
    const message = await reveal(m.message);
    if (message == null) return;
    lines.push({ id: m.id, time: Number(m.time) || 0, message, src: s.tag });
  }
  async function take(s, m) {                            // a live message: new -> ingest; true if the office changed
    if (m?.event !== 'message' || typeof m.id !== 'string') return false;
    s.lastId = m.id;
    const message = await reveal(m.message);
    if (message == null) return false;
    const l = { id: m.id, time: Number(m.time) || Date.now() / 1000, message, src: s.tag };
    if (!fresh(l)) return false;
    lines.push(l);
    if (lines.length > KEEP * 1.5) lines = lines.slice(-KEEP);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 2000);
    return ingest(l, false);
  }
  function follow(s) {
    const on = (data) => {
      let m;
      try { m = JSON.parse(data); } catch { return; }
      take(s, m).then((changed) => { if (changed) publish(); }).catch(() => {});
    };
    const live = new EventSource(`${s.base}/sse`);
    live.onopen = () => catchUp(s);                      // also after a reconnect: fetch what was missed
    live.onmessage = (e) => on(e.data);
  }
  async function catchUp(s) {
    try {
      const text = await (await fetch(`${s.base}/json?poll=1&since=${s.lastId ?? '12h'}`, { cache: 'no-store' })).text();
      let changed = false;
      for (const row of text.split('\n')) {
        if (!row) continue;
        try { if (await take(s, JSON.parse(row))) changed = true; } catch { /* junk row */ }
      }
      if (changed) publish();
    } catch { /* the stream retries by itself */ }
  }
  function parseRecord(message) {
    if (typeof message !== 'string') return null;
    let text = message.trim().replace(/^\uFEFF/, '');
    const fenced = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(text);
    if (fenced) text = fenced[1].trim();
    if (text.startsWith('{')) {
      try {
        const rec = JSON.parse(text);
        if (rec && typeof rec === 'object' && !Array.isArray(rec)) return rec;
      } catch { return null; }
    }
    // post_status.py sometimes posts "Name|working|what it is doing"
    const parts = text.split('|').map((s) => s.trim());
    if (parts.length >= 2 && parts.length <= 4 && parts[0] && parts[0].length <= 80 && parts[1].length <= 40) {
      return { bot: parts[0], status: parts[1], step: parts[2] || '' };
    }
    return null;
  }
  function ingest({ message, time }, replay) {
    if (typeof message !== 'string' || message.length > MAX_LINE) return false;
    const rec = parseRecord(message);
    if (!rec) return false;
    const t = typeof rec.t === 'string' ? rec.t : new Date(time * 1000).toISOString();
    if (Array.isArray(rec.roster)) {
      for (const name of rec.roster.slice(0, 400)) {
        if (typeof name === 'string' && name.trim() && !store.bots.has(botIdFor(name))) store.apply({ t, bot: name, status: 'idle', step: '', listed: true }, { replay });
      }
      return true;
    }
    if (isMap(rec.looks)) {
      for (const [name, look] of Object.entries(rec.looks).slice(0, 400)) (cfg[name] ||= {}).look = look;
      store.setBotsConfig(cfg);
      return true;
    }
    if (isMap(rec.groups)) return true;                  // one office: team tags never become separate floors
    if (isMap(rec.chat)) {                               // only app deep links and web pages (the store refuses scripts)
      for (const [name, url] of Object.entries(rec.chat).slice(0, 400)) {
        const chat = safeChatUrl(url);
        if (chat) (cfg[name] ||= {}).chat_url = chat;
      }
      store.setBotsConfig(cfg);
      return true;
    }
    if (isMap(rec.routines)) {
      const name = typeof rec.routines.bot === 'string' ? rec.routines.bot.trim().slice(0, 80) : '';
      if (!name || !Array.isArray(rec.routines.items)) return false;
      const items = rec.routines.items.slice(0, 50).filter(isMap).map((r) => ({
        routine: String(r.name ?? '').slice(0, 80), schedule: String(r.schedule ?? '').slice(0, 80),
        next_run: Number.isFinite(Date.parse(r.next_run)) ? new Date(r.next_run).toISOString() : null,
      })).filter((r) => r.routine);
      routines.set(botIdFor(name), { name, items });      // a bot's latest list replaces its previous one
      if (items[0]) pushTicker({ t, name, kind: 'routine', text: items[0].routine });
      return true;
    }
    if (isMap(rec.check)) {                              // the setup bot asks every bot for a status line: who answers?
      const names = (Array.isArray(rec.check.bots) ? rec.check.bots : []).filter((n) => typeof n === 'string' && n.trim())
        .slice(0, 400).map((n) => n.trim().slice(0, 80));
      if (!names.length) return false;
      const ms = Number.isFinite(Date.parse(t)) ? Date.parse(t) : time * 1000;
      if (!check || ms >= check.ms) check = { ms, names };
      return true;
    }
    store.apply({ ...rec, t }, { replay });
    return true;
  }
  function extras(s) {                                   // the panels' data on top of the server-shaped state
    const since = Date.now() - DAY_MS, finished = [];
    for (let i = lines.length - 1; i >= 0 && finished.length < 100; i--) {
      const l = lines[i];
      if (l.time * 1000 < since) break;
      if (typeof l.message !== 'string' || l.message.length > MAX_LINE || !l.message.includes('"done"')) continue;
      let rec;
      try { rec = JSON.parse(l.message); } catch { continue; }
      if (rec?.status !== 'done' || typeof rec.bot !== 'string') continue;
      finished.push({ t: typeof rec.t === 'string' ? rec.t : new Date(l.time * 1000).toISOString(), bot: botIdFor(rec.bot), name: rec.bot.slice(0, 80), step: String(rec.step ?? '').slice(0, 80) });
    }
    s.finished = finished;
    s.routines = [...routines].flatMap(([bot, { name, items }]) => items.map((r) => ({ bot, name, ...r })))
      .sort((a, b) => (a.next_run ? Date.parse(a.next_run) : Infinity) - (b.next_run ? Date.parse(b.next_run) : Infinity));
    s.ticker = ticker.slice(0, 12);
    s.check = check && Date.now() - check.ms < CHECK_MS ? {
      t: new Date(check.ms).toISOString(),
      bots: check.names.map((name) => {                  // answered = a status line of its own at or after the check
        const id = botIdFor(name), seen = Date.parse(s.bots[id]?.last_seen ?? '');
        return { id, name, at: seen >= check.ms ? new Date(seen).toISOString() : null };
      }),
    } : null;
    return s;
  }
  function publish() { store.commit(); onState(extras(store.snapshot())); }
  function save() { try { sessionStorage.setItem(cacheKey, JSON.stringify(lines.slice(-KEEP))); } catch { /* private mode: memory only */ } }
}

function isMap(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

/** App deep links and https pages only. Control characters and markup are dropped so a feed line cannot become a script URL. */
function safeChatUrl(url) {
  if (typeof url !== 'string') return null;
  const u = url.trim();
  if (!u || /[\u0000-\u001f\s<>"']/.test(u) || !/^(grokbot|https):\/\//i.test(u)) return null;
  return u;
}
