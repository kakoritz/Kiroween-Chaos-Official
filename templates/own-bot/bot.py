# Own-bot template (Python 3.11+, standard library only). Run: npm run own-bot -- templates/own-bot/bot.py
# It is naive on purpose: no retry, no idempotency key, no journal. Chaos will break it. docs/OWN-BOT.md shows how to harden it.
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

lane = os.environ.get("HAUNT_LANE", "1")
provider = os.environ.get("HAUNT_PROVIDER", "http://127.0.0.1:7071")
orders_dir = os.environ.get("HAUNT_ORDERS_DIR")
speed = float(os.environ.get("HAUNT_SPEED", "1") or 1) or 1.0
if not orders_dir:
    raise SystemExit("HAUNT_ORDERS_DIR is not set: start this bot with npm run own-bot")
orders = Path(orders_dir)
lane_root = orders.parent
for d in ("done", "failed"):
    (lane_root / d).mkdir(parents=True, exist_ok=True)


def send(m: dict) -> None:
    sys.stdout.write(json.dumps(m) + "\n")
    sys.stdout.flush()


def sleep(ms: float) -> None:
    time.sleep(max(1.0, ms / speed) / 1000)


# The arena's Stream app has these five stage ids, in this order; `classify` is pure work and calls nothing.
# `path` is the provider call the stage makes. The provider is fake, nothing leaves your machine.
STAGES = [
    {"id": "fetch", "path": "/store", "body": {"index": 1}},
    {"id": "classify", "path": None, "body": {}},
    {"id": "draft", "path": "/shipments", "body": {}},
    {"id": "reply", "path": "/notifications", "body": {"index": 1}},
    {"id": "archive", "path": "/store", "body": {"index": 2}},
]


def call_provider(path: str, body: dict, key: str | None) -> dict:
    headers = {"content-type": "application/json"}
    # HARDEN (idempotency): send a stable key per effect, for example f"{order}:{stage}", so a retry does not charge twice.
    if key:
        headers["idempotency-key"] = key
    req = urllib.request.Request(provider + path, data=json.dumps(body).encode(), headers=headers, method="POST")
    # HARDEN (timeout): a slow provider stalls the whole lane. 1.5 s mirrors the built-in bots.
    with urllib.request.urlopen(req, timeout=1.5) as res:
        return json.loads(res.read() or b"{}")


def run_stage(order: str, stage: dict) -> None:
    send({"type": "stage_start", "order": order, "stage": stage["id"]})
    # The progress heartbeat keeps the arena animated while the stage works.
    for pct in range(20, 100, 20):
        send({"type": "stage_progress", "order": order, "stage": stage["id"], "detail": {"pct": pct, "label": stage["id"]}})
        sleep(120)
    t0 = time.time()
    try:
        # HARDEN (retry): wrap this call in a loop with backoff for 429, 500 and timeouts.
        if stage["path"]:
            call_provider(stage["path"], {"lane": lane, "order": order, **stage["body"]}, None)
    except Exception as e:  # urllib raises HTTPError for 4xx and 5xx
        reason = f"provider answered {e.code}" if isinstance(e, urllib.error.HTTPError) else str(e)
        send({"type": "stage_fail", "order": order, "stage": stage["id"], "detail": {"error": reason, "retryable": True, "attempt": 1}})
        raise RuntimeError(reason) from e
    send({"type": "stage_done", "order": order, "stage": stage["id"], "detail": {"ms": int((time.time() - t0) * 1000), "skipped": False}})


def run_order(name: str) -> str:
    order = name.removesuffix(".json")
    # HARDEN (input): the file may be missing or corrupt. Read and validate it before the first stage.
    send({"type": "order_start", "order": order, "detail": {}})
    t0 = time.time()
    try:
        for stage in STAGES:
            run_stage(order, stage)
    except RuntimeError as e:
        send({"type": "order_failed", "order": order, "detail": {"stage": "unknown", "error": str(e)}})
        return "failed"
    send({"type": "order_done", "order": order, "detail": {"clean": True, "ms": int((time.time() - t0) * 1000), "repeats": 0}})
    return "done"


send({"k": "ready"})
for line in sys.stdin:  # the runner answers `ready` with `go`
    try:
        if json.loads(line).get("k") == "go":
            break
    except ValueError:
        pass

# After a crash the runner starts this file again. Orders still in the folder run again from stage 1: that is what a bot with no journal does.
while True:
    names = sorted(f.name for f in orders.iterdir() if re.fullmatch(r"ord-\d{4}\.json", f.name))
    if not names:
        break
    result = run_order(names[0])
    if (orders / names[0]).exists():
        (orders / names[0]).rename(lane_root / result / names[0])

send({"k": "idle"})
for line in sys.stdin:  # the runner answers `idle` with `shutdown`
    try:
        if json.loads(line).get("k") == "shutdown":
            break
    except ValueError:
        pass
sys.exit(0)
