// The ntfy body is `gbwenc1:` + base64url(12-byte IV || AES-256-GCM ciphertext and tag).
// The key lives only in the URL hash (`#<topic>.<key>`). It is never stored or sent.

function clearLegacyFeedCache() {
  try {
    const drop = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('bothq.feed')) drop.push(k);
    }
    for (const k of drop) localStorage.removeItem(k);
  } catch { /* private mode, or no localStorage */ }
}
clearLegacyFeedCache();
const PREFIX = 'gbwenc1:';
const TOPIC = /^[A-Za-z0-9_-]{6,64}$/;
const KEY_B64 = /^[A-Za-z0-9_-]{43}$/;
export const MAX_JSON = 4096;
const MAX_BODY = 4096;

export function b64urlToBytes(s) {
  const src = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = src.length % 4 === 0 ? '' : '='.repeat(4 - (src.length % 4));
  const bin = atob(src + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** `#topic.key` -> { topic, keyB64 } or { topic, keyB64: null } when the link has no usable key. */
export function parseFeedHash(hash) {
  const raw = String(hash || '');
  if (!raw.startsWith('#')) return null;
  let body = raw.slice(1);
  const at = body.indexOf('@');
  const amp = body.indexOf('&');
  if (at > 0) body = body.slice(0, at);
  else if (amp > 0) body = body.slice(0, amp);
  const dot = body.indexOf('.');
  const topic = dot === -1 ? body : body.slice(0, dot);
  const keyB64 = dot === -1 ? '' : body.slice(dot + 1);
  if (!TOPIC.test(topic)) return null;
  if (!keyB64) return { topic, keyB64: null };
  if (!KEY_B64.test(keyB64)) return { topic, keyB64: null };
  try {
    if (b64urlToBytes(keyB64).byteLength !== 32) return { topic, keyB64: null };
  } catch {
    return { topic, keyB64: null };
  }
  return { topic, keyB64 };
}

/** Non-extractable AES-GCM key. Decrypt only. */
export function importFeedKey(keyB64) {
  const raw = b64urlToBytes(keyB64);
  if (raw.byteLength !== 32) return Promise.reject(new Error('bad key'));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
}

/**
 * Decrypt one ntfy body. Returns the JSON text, or null when the body is not
 * `gbwenc1:` or the key does not open it. Callers must drop null and must not
 * fall back to the ciphertext.
 */
export async function openFeedMessage(body, key) {
  if (typeof body !== 'string' || !body.startsWith(PREFIX) || body.length > MAX_BODY) return null;
  let packed;
  try { packed = b64urlToBytes(body.slice(PREFIX.length)); } catch { return null; }
  if (packed.byteLength < 12 + 16) return null;
  try {
    const clear = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: packed.slice(0, 12) },
      key,
      packed.slice(12),
    );
    const text = new TextDecoder('utf-8', { fatal: true }).decode(clear);
    if (!text || text.length > MAX_JSON) return null;
    return text;
  } catch {
    return null;
  }
}
