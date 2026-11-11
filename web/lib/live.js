// Green marker and the "working" count.
// The feed refresh marks recent activity as working, but it only arrives every 15 minutes, so the page also
// watches the last-activity time: a bot is green when its state is working/active/busy/running, or its
// last activity is within 15 minutes. Past that, it turns red even if the last payload still says working.

export const RECENT_MS = 15 * 60 * 1000;

const LIVE = new Set(['working', 'active', 'busy', 'running', 'in_progress', 'processing', 'work']);

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

function timeOf(...values) {
  let best = null;
  for (const value of values) {
    const t = typeof value === 'number' ? value : Date.parse(value || '');
    if (Number.isFinite(t) && (best == null || t > best)) best = t;
  }
  return best;
}

/** Milliseconds of the newest activity/update stamp, or null when the bot has none. */
export function activityAt(bot) {
  if (!bot || typeof bot !== 'object') return null;
  return timeOf(bot.last_activity, bot.updated, bot.updated_at, bot.activity_at, bot.lastActivity, bot.last_event, bot.last_seen, bot.since);
}

function liveWord(bot) {
  const raw = bot.state ?? bot.status ?? bot.effective_status;
  const name = mapped(raw);
  return name === 'working' || LIVE.has(key(raw)) || LIVE.has(key(bot.effective_status)) || mapped(bot.effective_status) === 'working';
}

/** True when the marker is green and the bot counts as working. */
export function isWorking(bot, now = Date.now()) {
  if (!bot || typeof bot !== 'object') return false;
  const at = activityAt(bot);
  if (at != null) return now - at <= RECENT_MS;
  return liveWord(bot);
}

/** waiting_user (and stuck, which also needs a person) for the waiting counter. */
export function isWaiting(bot) {
  if (!bot || typeof bot !== 'object') return false;
  const name = mapped(bot.effective_status || bot.status || bot.state);
  return name === 'waiting_user' || name === 'stuck';
}
