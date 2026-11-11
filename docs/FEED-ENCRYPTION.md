# Encrypted status feed

The office reads ntfy at `https://ntfy.sh/<topic>`. The topic is not a secret. The key is.

The link is:

```text
https://<this-site>/office/#<topic>.<key>
```

`<topic>` is 6–64 characters, `A–Z a–z 0–9 _ -`. `<key>` is a random 32-byte AES-256-GCM key, base64url, no padding (43 characters). The hash is not sent to any server. Do not log it, and do not put it in localStorage.

Each ntfy message body is the original JSON, sealed as:

```text
gbwenc1:<base64url(12-byte IV || ciphertext || 16-byte tag)>
```

There is no padding on the base64url. The office drops a body that does not start with `gbwenc1:` or that does not decrypt. A link with no key shows a locked office and does not read the feed. `?demo=1` still uses local demo data.

## Publisher

```python
import os, json, base64
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")

def encrypt_status(key: bytes, payload: dict) -> str:
    iv = os.urandom(12)
    blob = iv + AESGCM(key).encrypt(iv, json.dumps(payload, separators=(",", ":")).encode(), None)
    return "gbwenc1:" + b64url(blob)
```

`key` is the raw 32 bytes. Post `encrypt_status(key, payload)` as the ntfy message body, and nothing else.
