// Who is working right now, for the green marker, the working count, and the green streaks.
// A posted working/active/busy/running line counts, and so does any non-rest update from the last 15 minutes.
// done, idle, waiting_user and offline stay red.

export const RECENT_MS = 15 * 60 * 1000;

const LIVE = new Set(['working', 'active', 'busy', 'running', 'in_progress', 'processing', 'work']);
const REST = new Set([
  'idle', 'done', 'waiting_user', 'waiting', 'offline', 'off', 'error', 'stuck',
  'sleeping', 'paused', 'stopped', 'resting', 'away',
]);

const MAP = {
  working: 'working', active: 'working', busy: 'working', running: 'working', in_progress: 'working', processing: 'working', work: 'working',
  idle: 'idle', offline: 'idle', off: 'idle', sleeping: 'idle', paused: 'idle', stopped: 'idle', resting: 'idle', away: 'idle',
  waiting: 'waiting_user', waiting_user: 'waiting_user', waiting_for_user: 'waiting_user',
  done: 'done', finished: 'done', complete: 'done', completed: 'done',
  error: 'error', failed: 'error',
  stuck: 'stuck',
};

function key(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function mapped(value) {
  const k = key(value);
  return MAP[k] || k;
}

function ageMs(bot, now) {
  const t = Date.parse(bot.last_event || bot.last_seen || bot.since || '');
  if (!Number.isFinite(t)) return null;
  return Math.max(0, now - t);
}

/** True when this bot should show a green marker and a green streak toward Master. */
export function isWorking(bot, now = Date.now()) {
  if (!bot || typeof bot !== 'object') return false;
  const posted = mapped(bot.status);
  const eff = mapped(bot.effective_status);
  if (REST.has(posted) || REST.has(key(bot.status))) return false;
  if (eff === 'working' || posted === 'working' || LIVE.has(key(bot.status)) || LIVE.has(key(bot.effective_status))) {
    if (eff === 'working') return true;
    const age = ageMs(bot, now);
    return age == null || age <= RECENT_MS;
  }
  const age = ageMs(bot, now);
  return age != null && age <= RECENT_MS;
}
