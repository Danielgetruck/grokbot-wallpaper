// Reassembly of one encrypted snapshot that ntfy had to carry in pieces.
// A part is {"type":"snapshot_part","id","i","n","data"}. `data` slices are
// concatenated in order into the snapshot JSON. The key never comes through here.
export const SNAPSHOT_BYTES = 65536;
export const PART_TTL_MS = 10 * 60 * 1000;
export const MAX_PARTS = 256;
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const enc = new TextEncoder();

export function utf8Bytes(text) {
  return enc.encode(String(text)).length;
}

/** A v1 snapshot object, or null when the shape is not one we will apply. */
export function normalizeSnapshot(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  if (obj.type !== 'snapshot' || obj.v !== 1) return null;
  if (typeof obj.captured_at !== 'string' || !Number.isFinite(Date.parse(obj.captured_at))) return null;
  if (!Array.isArray(obj.bots) || obj.bots.length > 400) return null;
  if (utf8Bytes(JSON.stringify(obj)) > SNAPSHOT_BYTES) return null;
  return obj;
}

export class PartBuffer {
  constructor(now = Date.now) {
    this.now = now;
    this.sets = new Map();
    this.poison = new Set();
  }

  sweep() {
    const t = this.now();
    for (const [id, set] of this.sets) {
      if (t - set.t0 >= PART_TTL_MS) this.sets.delete(id);
    }
  }

  /**
   * Remember one part. Returns the parsed snapshot once every index of that id
   * is present, otherwise null. An incomplete id is forgotten 10 minutes after
   * its first part. A conflicting slice poisons the id.
   */
  push(rec) {
    this.sweep();
    if (!rec || rec.type !== 'snapshot_part') return null;
    const id = typeof rec.id === 'string' ? rec.id : '';
    if (!ID_RE.test(id) || this.poison.has(id)) return null;
    const n = rec.n;
    const i = rec.i;
    if (!Number.isInteger(n) || n < 1 || n > MAX_PARTS) return null;
    if (!Number.isInteger(i) || i < 0 || i >= n) return null;
    if (typeof rec.data !== 'string' || utf8Bytes(rec.data) > 3500) return null;
    let set = this.sets.get(id);
    if (!set) {
      set = { n, t0: this.now(), parts: new Map() };
      this.sets.set(id, set);
    }
    if (set.n !== n) return this.poisonId(id);
    const prev = set.parts.get(i);
    if (prev !== undefined && prev !== rec.data) return this.poisonId(id);
    set.parts.set(i, rec.data);
    if (set.parts.size < n) return null;
    let total = 0;
    const chunks = [];
    for (let k = 0; k < n; k++) {
      const data = set.parts.get(k);
      if (typeof data !== 'string') return null;
      total += utf8Bytes(data);
      if (total > SNAPSHOT_BYTES) return this.poisonId(id);
      chunks.push(data);
    }
    this.sets.delete(id);
    let obj;
    try { obj = JSON.parse(chunks.join('')); } catch { return null; }
    return normalizeSnapshot(obj);
  }

  poisonId(id) {
    this.sets.delete(id);
    this.poison.add(id);
    if (this.poison.size > 200) this.poison.clear();
    return null;
  }
}
