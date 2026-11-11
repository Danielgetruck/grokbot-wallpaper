import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { importFeedKey, openFeedMessage } from '../../web/lib/feedcrypt.js';
import { PartBuffer, PART_TTL_MS } from '../../web/lib/snapshot.js';
import { StateStore } from '../../web/lib/state.js';
import { createChannel } from '../../web/feed.js';

function b64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

const doc = readFileSync(new URL('../../docs/FEED-ENCRYPTION.md', import.meta.url), 'utf8');
const snippet = doc.match(/```python\r?\n([\s\S]*?)```/);
assert.ok(snippet, 'docs/FEED-ENCRYPTION.md is missing the Python publisher');
assert.match(snippet[1], /def snapshot_messages/);

function runPython(key, payload, mode) {
  const run = spawnSync('python3', ['-c', `
import sys, json
${snippet[1]}
raw = sys.stdin.buffer.readline().decode().strip()
raw += '=' * ((4 - len(raw) % 4) % 4)
key = base64.urlsafe_b64decode(raw)
payload = json.loads(sys.stdin.buffer.readline().decode())
if ${JSON.stringify(mode)} == 'parts':
    sys.stdout.write(json.dumps(snapshot_messages(key, payload)))
else:
    sys.stdout.write(encrypt_status(key, payload))
`], { input: `${b64url(key)}\n${JSON.stringify(payload)}\n`, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout;
}

function office() {
  const now = Date.parse('2026-11-11T12:00:00Z');
  const store = new StateStore({ now: () => now, tz: 'UTC', quietIdleMs: 20 * 60e3 });
  return { store, channel: createChannel(store) };
}

function ingest(channel, obj, time = 1_700_000_000) {
  return channel.ingest({ message: JSON.stringify(obj), time }, false);
}

test('a small snapshot is one encrypted body and replaces the office', async () => {
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const snapshot = {
    type: 'snapshot', v: 1, captured_at: '2026-11-11T12:00:00Z',
    bots: [
      { bot: 'Master', status: 'working', step: 'checking the queue' },
      { bot: 'Lane', status: 'idle', step: '' },
    ],
    roster: ['Master', 'Lane', 'Quiet'],
    looks: { Master: { shape: 'sphere', color: '#2D84F5', accessory: 'none' } },
    groups: { Master: 'Ops', Lane: 'Content' },
    chat: { Master: 'grokbot://app/v1/agent?id=abc' },
    routines: [{ bot: 'Master', items: [{ name: 'Morning', schedule: 'daily 09:00', next_run: '2026-11-12T09:00:00Z' }] }],
    usage: { total_used_pct: 37, resets_at: '2026-11-16T00:00:00Z', bots: { Master: 4.1 } },
    check: { bots: ['Master', 'Lane'] },
  };
  const bodies = JSON.parse(runPython(keyBytes, snapshot, 'parts'));
  assert.equal(bodies.length, 1);
  assert.ok(Buffer.byteLength(bodies[0]) <= 3800);
  const key = await importFeedKey(b64url(keyBytes));
  const text = await openFeedMessage(bodies[0], key);
  assert.deepEqual(JSON.parse(text), snapshot);
  assert.equal(await openFeedMessage(JSON.stringify(snapshot), key), null);

  const { store, channel } = office();
  channel.ingest({ message: JSON.stringify({ bot: 'Old', status: 'working', step: 'gone' }), time: 1 }, false);
  assert.equal(ingest(channel, JSON.parse(text)), true);
  const state = store.snapshot();
  assert.equal(state.bots.master.status, 'working');
  assert.equal(state.bots.master.group, 'Ops');
  assert.equal(state.bots.lane.group, 'Content');
  assert.equal(state.bots.quiet.status, 'idle');
  assert.equal(state.bots.old, undefined);
  assert.equal(state.bots.master.look.shape, 'sphere');
  assert.equal(state.bots.master.chat_url, 'grokbot://app/v1/agent?id=abc');
  assert.equal(state.usage.total_used_pct, 37);
  const view = channel.extras(state, []);
  assert.equal(view.routines[0].routine, 'Morning');
  assert.deepEqual(view.check.bots.map((b) => b.name), ['Master', 'Lane']);

  assert.equal(ingest(channel, {
    type: 'snapshot', v: 1, captured_at: '2026-11-11T11:00:00Z',
    bots: [{ bot: 'Master', status: 'error', step: 'stale' }],
  }), false);
  assert.equal(store.snapshot().bots.master.status, 'working');
  assert.equal(ingest(channel, { bot: 'Master', status: 'waiting_user', step: 'need a look' }), true);
  assert.equal(store.snapshot().bots.master.status, 'waiting_user');
  assert.equal(store.snapshot().bots.lane.status, 'idle');
});

test('a large snapshot is chunked under 3800 bytes and reassembled out of order', async () => {
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const bots = Array.from({ length: 28 }, (_, i) => ({
    bot: `Bot ${i}`, status: i % 2 ? 'idle' : 'working', step: `step ${i} ${'x'.repeat(1400)}`, group: 'Content',
  }));
  const snapshot = {
    type: 'snapshot', v: 1, captured_at: '2026-11-11T12:00:00Z',
    bots, roster: bots.map((b) => b.bot),
    groups: Object.fromEntries(bots.map((b) => [b.bot, 'Content'])),
    usage: { total_used_pct: 12, resets_at: '2026-11-16T00:00:00Z', bots: { 'Bot 0': 2 } },
  };
  const raw = JSON.stringify(snapshot);
  assert.ok(Buffer.byteLength(raw) > 3800);
  assert.ok(Buffer.byteLength(raw) <= 65536);
  const bodies = JSON.parse(runPython(keyBytes, snapshot, 'parts'));
  assert.ok(bodies.length > 1);
  const key = await importFeedKey(b64url(keyBytes));
  const opened = [];
  for (const body of bodies) {
    assert.ok(Buffer.byteLength(body) <= 3800);
    assert.match(body, /^gbwenc1:[A-Za-z0-9_-]+$/);
    const text = await openFeedMessage(body, key);
    assert.ok(text);
    opened.push(JSON.parse(text));
  }
  assert.equal(await openFeedMessage(bodies[0].slice(0, -4) + 'xxxx', key), null);
  const order = opened.map((_, i) => i).reverse();
  const { store, channel } = office();
  let applied = false;
  for (const i of order) applied = ingest(channel, opened[i]) || applied;
  assert.equal(applied, true);
  const state = store.snapshot();
  assert.equal(state.bots['bot-0'].status, 'working');
  assert.equal(state.bots['bot-0'].group, 'Content');
  assert.equal(state.bots['bot-1'].status, 'idle');
  assert.equal(state.usage.total_used_pct, 12);
  assert.equal(Object.keys(state.bots).length, 28);
});

test('incomplete snapshot parts expire after 10 minutes and a conflicting slice is dropped', () => {
  let now = 1_000;
  const buf = new PartBuffer(() => now);
  const part = (i, data, n = 2) => ({ type: 'snapshot_part', id: 'abcdEF12', i, n, data });
  assert.equal(buf.push(part(0, '{"type":"snapshot"')), null);
  now += PART_TTL_MS;
  assert.equal(buf.push(part(1, '}')), null);
  assert.equal(buf.sets.size, 1);

  const bad = new PartBuffer(() => 0);
  const whole = JSON.stringify({
    type: 'snapshot', v: 1, captured_at: '2026-11-11T12:00:00Z', bots: [{ bot: 'Master', status: 'idle', step: '' }],
  });
  const mid = Math.floor(whole.length / 2);
  assert.equal(bad.push(part(0, whole.slice(0, mid))), null);
  assert.equal(bad.push(part(0, `${whole.slice(0, mid)} `)), null);
  assert.equal(bad.push(part(1, whole.slice(mid))), null);
  assert.equal(bad.sets.size, 0);
});
