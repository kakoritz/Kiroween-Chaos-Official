"""haunt_bot_lib: four small helpers that harden a bot (standard library only). Written next to your bot by `npm run bot:new`.

    from haunt_bot_lib import idempotency_key, hardened_call, Journal
    key = idempotency_key(order, "pay")                                    # same text every try, so a retry never charges twice
    hardened_call(provider, "/charges", {"lane": lane, "order": order}, key=key)  # timeout, retry with backoff, honors Retry-After
    j = Journal(directory)                                                 # survives a crash: the next start skips what is done
    if not j.has(key): ...; j.mark(key)
"""
import base64
import json
import os
import time
import urllib.error
import urllib.request


def idempotency_key(order, stage, n=0):
    """A stable key for one effect of one order. `n` numbers the effects of a stage (0 for the first)."""
    return f"{order}:{stage}:{n}"


def _retryable(status):
    return status == 429 or status >= 500


def hardened_call(provider, path, body, key=None, timeout=1.5, tries=4, base=0.1):
    """POST `body` with an idempotency key, a timeout and retries (timeout, network error, 429, 5xx). Other 4xx fail at once. Returns parsed JSON."""
    last = None
    for i in range(tries):
        headers = {"content-type": "application/json"}
        if key:
            headers["idempotency-key"] = key
        req = urllib.request.Request(provider + path, data=json.dumps(body).encode(), headers=headers, method="POST")
        delay = base * 2 ** i
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                return json.loads(res.read() or b"{}")
        except urllib.error.HTTPError as e:
            last = e
            if not _retryable(e.code):
                raise
            try:
                ra = float(e.headers.get("Retry-After") or 0)
            except ValueError:
                ra = 0
            if ra > 0:
                delay = min(ra, 5)
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last = e
        if i < tries - 1:
            time.sleep(delay)
    raise last


class Journal:
    """A tiny journal on disk: `mark(key)` after an effect is done, `has(key)` before doing it again after a restart."""

    def __init__(self, directory):
        self.dir = directory
        os.makedirs(directory, exist_ok=True)

    def _file(self, key):
        return os.path.join(self.dir, base64.urlsafe_b64encode(key.encode()).decode().rstrip("=") + ".done")

    def has(self, key):
        return os.path.exists(self._file(key))

    def mark(self, key):
        open(self._file(key), "w").close()
