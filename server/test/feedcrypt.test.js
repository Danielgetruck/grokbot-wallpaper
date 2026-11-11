import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseFeedHash, importFeedKey, openFeedMessage } from '../../web/lib/feedcrypt.js';

function b64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

const doc = readFileSync(new URL('../../docs/FEED-ENCRYPTION.md', import.meta.url), 'utf8');
const snippet = doc.match(/```python\r?\n([\s\S]*?)```/);
assert.ok(snippet, 'docs/FEED-ENCRYPTION.md is missing the Python encryptor');

function encrypt(key, payload) {
  const run = spawnSync('python3', ['-c', `
import sys, json
${snippet[1]}
raw = sys.stdin.buffer.readline().decode().strip()
raw += '=' * ((4 - len(raw) % 4) % 4)
key = base64.urlsafe_b64decode(raw)
payload = json.loads(sys.stdin.buffer.readline().decode())
sys.stdout.write(encrypt_status(key, payload))
`], { input: `${b64url(key)}\n${JSON.stringify(payload)}\n`, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim();
}

test('hash keeps the topic and a 32-byte key, and a bare topic stays locked', () => {
  const key = b64url(Buffer.alloc(32, 7));
  assert.equal(key.length, 43);
  assert.deepEqual(parseFeedHash(`#gbw-office.${key}`), { topic: 'gbw-office', keyB64: key });
  assert.deepEqual(parseFeedHash('#gbw-office'), { topic: 'gbw-office', keyB64: null });
  assert.equal(parseFeedHash('#short'), null);
  assert.equal(parseFeedHash(''), null);
  assert.equal(parseFeedHash(`#gbw-office.${key.slice(0, 10)}`).keyB64, null);
});

test('a Python AES-GCM body decrypts, and plaintext or garbage is dropped', async () => {
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const payload = { bot: 'Master', status: 'working', step: 'checking the queue — café' };
  const body = encrypt(keyBytes, payload);
  assert.match(body, /^gbwenc1:[A-Za-z0-9_-]+$/);
  assert.equal(body.includes('='), false);
  const key = await importFeedKey(b64url(keyBytes));
  assert.equal(key.extractable, false);
  assert.deepEqual(key.usages, ['decrypt']);
  const text = await openFeedMessage(body, key);
  assert.deepEqual(JSON.parse(text), payload);
  assert.equal(await openFeedMessage(JSON.stringify(payload), key), null);
  assert.equal(await openFeedMessage('{"bot":"A"}', key), null);
  assert.equal(await openFeedMessage('gbwenc1:aaaa', key), null);
  const flipped = body.slice(0, 20) + (body[20] === 'A' ? 'B' : 'A') + body.slice(21);
  assert.equal(await openFeedMessage(flipped, key), null);
  const other = await importFeedKey(b64url(Buffer.alloc(32, 9)));
  assert.equal(await openFeedMessage(body, other), null);
});
