# Encrypted status feed

The office reads ntfy at `https://ntfy.sh/<topic>`. The topic is not a secret. The key is.

The link is:

```text
https://<this-site>/office/#<topic>.<key>
```

`<topic>` is 6–64 characters, `A–Z a–z 0–9 _ -`. `<key>` is a random 32-byte AES-256-GCM key, base64url, no padding (43 characters). The hash is not sent to any server. Do not log it, and do not put it in localStorage.

Each ntfy message body is JSON, sealed as:

```text
gbwenc1:<base64url(12-byte IV || ciphertext || 16-byte tag)>
```

There is no padding on the base64url. The office drops a body that does not start with `gbwenc1:` or that does not decrypt. A link with no key shows a locked office and does not read the feed. `?demo=1` still uses local demo data. One ntfy message body is at most 4096 bytes; the publisher keeps each encrypted body at or under 3800 bytes.

Per-bot lines still work. Each one is the same JSON as before (`{"bot","status","step"}`, plus `roster`, `looks`, `groups`, `chat`, `routines`, `usage`, `check`), encrypted with `encrypt_status`.

## Snapshot

Prefer one snapshot every 15 minutes instead of a line per bot. The decrypted JSON is:

```json
{
  "type": "snapshot",
  "v": 1,
  "captured_at": "2026-11-11T12:00:00Z",
  "bots": [
    {"bot": "Bot A", "status": "working", "step": "drafting", "group": "Content"}
  ],
  "roster": ["Bot A", "Bot B"],
  "looks": {"Bot A": {"shape": "sphere", "color": "#2D84F5", "accessory": "none"}},
  "groups": {"Bot A": "Content", "Bot B": "Ops"},
  "chat": {"Bot A": "grokbot://app/v1/agent?id=abc"},
  "routines": [
    {"bot": "Bot A", "items": [{"name": "Morning", "schedule": "daily 09:00", "next_run": "2026-11-12T09:00:00Z"}]}
  ],
  "usage": {"total_used_pct": 37, "resets_at": "2026-11-16T00:00:00Z", "bots": {"Bot A": 4.1}},
  "check": {"bots": ["Bot A", "Bot B"]}
}
```

`bots` holds the same per-bot objects a status line would. `roster`, `looks`, `groups`, `chat`, `routines`, `usage` and `check` are the summary and team messages, batched. `routines` is a list of the per-bot routine objects (or one such object). `groups` sets each bot's team. The snapshot JSON is at most 65536 bytes.

The office replaces its bots, looks, teams, routines, usage and check with that snapshot. A newer `captured_at` wins. An older or equal `captured_at` is ignored. A per-bot line that arrives after the snapshot still updates that bot.

## Parts

When `encrypt_status(key, snapshot)` would be longer than 3800 bytes, do not post it as one body. Slice the snapshot JSON string and encrypt each piece on its own:

```json
{"type": "snapshot_part", "id": "<8-64 url-safe chars>", "i": 0, "n": 3, "data": "<exact slice of the snapshot JSON>"}
```

`i` runs from 0 through `n - 1`. `data` slices are concatenated in order and parsed as the snapshot above. The office applies the snapshot only after every index for that `id` has arrived. An unfinished set is dropped 10 minutes after its first part. A part that does not decrypt, or a second slice that disagrees with the first for the same index, drops the set.

## Publisher

```python
import os, json, base64, secrets
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")

def dump(obj) -> str:
    return json.dumps(obj, separators=(",", ":"))

def encrypt_status(key: bytes, payload: dict) -> str:
    iv = os.urandom(12)
    blob = iv + AESGCM(key).encrypt(iv, dump(payload).encode(), None)
    return "gbwenc1:" + b64url(blob)

def snapshot_messages(key: bytes, snapshot: dict, limit: int = 3800) -> list[str]:
    """One encrypted body when it fits, otherwise snapshot_part bodies of <= limit bytes."""
    if snapshot.get("type") != "snapshot" or snapshot.get("v") != 1:
        raise ValueError("not a v1 snapshot")
    raw = dump(snapshot)
    if len(raw.encode()) > 65536:
        raise ValueError("snapshot JSON is over 65536 bytes")
    one = encrypt_status(key, snapshot)
    if len(one.encode()) <= limit:
        return [one]
    part_id = secrets.token_urlsafe(12)
    step = 2400
    while step >= 200:
        slices = [raw[i:i + step] for i in range(0, len(raw), step)]
        if 1 <= len(slices) <= 256:
            bodies = []
            n = len(slices)
            ok = True
            for i, data in enumerate(slices):
                body = encrypt_status(key, {
                    "type": "snapshot_part", "id": part_id, "i": i, "n": n, "data": data,
                })
                if len(body.encode()) > limit:
                    ok = False
                    break
                bodies.append(body)
            if ok:
                return bodies
        if step == 200:
            break
        step = max(200, int(step * 0.75))
    raise ValueError("snapshot does not fit in 256 parts")
```

`key` is the raw 32 bytes. Post each string from `snapshot_messages(key, snapshot)` as its own ntfy message body, and nothing else. A per-bot update between snapshots is still `encrypt_status(key, {"bot", "status", "step"})`.
