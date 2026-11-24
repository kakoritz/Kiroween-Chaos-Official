"""haunt_py: the Python mini-SDK for Kiroween Chaos bots (Python 3.12, standard library only).

Mirrors packages/haunt/src/sdk and packages/haunt/src/chaos: order(), stage(), effect(), a JSONL journal with
resume, reconcile, retry, breaker and offline-queue parking, the kill rendezvous and the same parts report.
Spec: .kiro/specs/engine/runtime.md sections 1, 2, 3, 5, 6, 7 and .kiro/specs/inbox-app/design.md.
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from typing import Any, Callable

PARTS = ("retry", "journal", "idempotency", "breaker", "offline_queue")
CRASH_POINTS = ("before_effect", "after_effect_before_journal", "after_journal", "mid_stage")
RECOVERY_POINTS = ("during_replay", "during_reconcile", "during_backoff")
PROCESS_FAULTS = ("crash", "out_of_memory", "power_outage")
# Ticket Desk faults the arena arms on the bot; desk.py applies each at its own stage (apps/haunted-inbox/bot/desk.py DESK_FAULTS).
DESK_FAULTS = ("sla_breach", "wrong_queue", "duplicate_storm", "field_mapping_error", "webhook_retry_storm", "assignee_deleted", "rate_limited")
RETRY = {"attempts": 3, "delay_ms": 500}
BREAKER = {"attempts": 5, "base_ms": 500, "open_after": 4, "open_ms": 5000}
PATHS = {"account": "/accounts", "ticket": "/tickets", "reply": "/replies", "notify": "/notifications"}

# Tier table, same five tiers and parts as App 1.
TIERS = {
    "rookie": (),
    "retrier": ("retry",),
    "journaler": ("retry", "journal"),
    "reconciler": ("retry", "journal", "idempotency"),
    "phoenix": ("retry", "journal", "idempotency", "breaker", "offline_queue"),
}


# ---- seeded randomness (runtime.md section 5), identical to packages/haunt/src/shared/rng.ts ----

def fnv1a32(text: str) -> int:
    h = 0x811C9DC5
    for ch in text:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def _imul(a: int, b: int) -> int:
    return (a * b) & 0xFFFFFFFF


def mulberry32(seed: int) -> Callable[[], float]:
    state = [seed & 0xFFFFFFFF]

    def nxt() -> float:
        state[0] = (state[0] + 0x6D2B79F5) & 0xFFFFFFFF
        t = state[0]
        t = _imul(t ^ (t >> 15), t | 1)
        t ^= (t + _imul(t ^ (t >> 7), t | 61)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return nxt


def unit(*parts: Any) -> float:
    return mulberry32(fnv1a32("|".join(str(p) for p in parts)))()


# ---- control-flow signals ----

class ParkSignal(Exception):
    def __init__(self, reason: str):
        super().__init__(f"parked: {reason}")
        self.reason = reason


class QuarantineError(Exception):
    pass


class InputError(Exception):
    def __init__(self, kind: str, msg: str):
        super().__init__(msg)
        self.kind = kind


class LaneHalted(Exception):
    pass


class CallError(Exception):
    def __init__(self, status: int | None, retry_after_ms: float | None, msg: str):
        super().__init__(msg)
        self.status = status
        self.retry_after_ms = retry_after_ms


class JournalWriteError(Exception):
    pass


# ---- journal ----

class Journal:
    """Append-only JSONL, every record written then fsynced."""

    def __init__(self, path: str):
        self.path = path
        self.fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
        self.failures = 0

    def fail_next_write(self) -> None:
        self.failures += 1

    def append(self, rec: dict) -> None:
        if self.failures > 0:
            self.failures -= 1
            raise JournalWriteError("ENOSPC")
        os.write(self.fd, (json.dumps(rec, separators=(",", ":")) + "\n").encode("utf-8"))
        os.fsync(self.fd)

    def close(self) -> None:
        os.close(self.fd)


def read_journal(path: str) -> list[dict]:
    """Records from a JSONL file. A torn last line after a kill is ignored."""
    out: list[dict] = []
    if not os.path.exists(path):
        return out
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            if not line.strip():
                continue
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            if isinstance(rec, dict) and isinstance(rec.get("t"), str) and isinstance(rec.get("order"), str):
                out.append(rec)
    return out


def apply_record(state: dict, r: dict) -> None:
    o = state.setdefault(r["order"], {"outcome": None, "stages": {}})
    t = r["t"]
    if t == "order_done":
        o["outcome"] = "done"
        return
    if t == "order_end":
        o["outcome"] = r.get("outcome")
        return
    s = o["stages"].setdefault(r.get("stage"), {"done": False, "effects": {}})
    if t == "intent":
        e = s["effects"].setdefault(r["eid"], {"intent": False, "result": False, "key": r.get("key"), "payload": None})
        e["intent"] = True
    elif t == "result":
        e = s["effects"].setdefault(r["eid"], {"intent": False, "result": False, "key": r.get("key"), "payload": None})
        e["result"] = True
        e["payload"] = r.get("payload")
    elif t == "stage_done":
        s["done"] = True


def replay(records: list[dict]) -> dict:
    state: dict = {}
    for r in records:
        apply_record(state, r)
    return state


# ---- host: clock, stdout/stdin channel, kill rendezvous ----

class Host:
    def __init__(self, parts: tuple[str, ...], speed: float = 1.0):
        self.parts = parts
        self.speed = speed if speed > 0 else 1.0
        self._anchor_real = time.time() * 1000
        self._anchor_virtual = self._anchor_real
        self._out_lock = threading.Lock()
        self._armed: list[dict] = []
        self._desk: list[dict] = []
        self._lock = threading.Lock()
        self.sdk: Sdk | None = None
        self.go = threading.Event()
        self.proceed = threading.Event()
        self.shutdown = threading.Event()
        self.stdin_closed = False
        recovers = "journal" in parts or "idempotency" in parts
        self._inner = RECOVERY_POINTS if recovers else ("startup", "during_backoff")

    # time runs `speed` times faster than the wall clock, so every ms constant scales
    def now(self) -> float:
        return self._anchor_virtual + (time.time() * 1000 - self._anchor_real) * self.speed

    def sleep(self, ms: float) -> None:
        time.sleep(max(0.0, ms / self.speed / 1000))

    def real_s(self, ms: float) -> float:
        return max(0.001, ms / self.speed / 1000)

    def send(self, msg: dict) -> None:
        line = json.dumps(msg, separators=(",", ":"))
        with self._out_lock:
            sys.stdout.write(line + "\n")
            sys.stdout.flush()

    emit = send

    def start_stdin(self) -> None:
        threading.Thread(target=self._read_stdin, daemon=True).start()

    def _read_stdin(self) -> None:
        for line in sys.stdin:
            try:
                m = json.loads(line)
            except ValueError:
                continue
            if not isinstance(m, dict):
                continue
            k = m.get("k")
            if k == "speed" and isinstance(m.get("speed"), (int, float)) and m["speed"] > 0:
                self._anchor_virtual = self.now()
                self._anchor_real = time.time() * 1000
                self.speed = float(m["speed"])
            elif k == "proceed":
                self.proceed.set()
            elif k == "shutdown":
                self.shutdown.set()
            else:
                self._control(m)
            if k == "go":
                self.go.set()
        self.stdin_closed = True
        self.shutdown.set()

    def _control(self, m: dict) -> None:
        if m.get("k") == "go" and isinstance(m.get("arms"), list):
            for a in m["arms"]:
                self._arm(a)
        elif m.get("k") == "arm":
            self._arm(m)

    def _arm(self, a: dict) -> None:
        fault = a.get("fault")
        if fault == "disk_full":
            if not (self.sdk and self.sdk.arm_disk_full()):
                self.send({"k": "absorbed", "reason": "no journal"})
        elif fault in PROCESS_FAULTS:
            with self._lock:
                self._armed.append(a)
        elif fault in DESK_FAULTS:
            with self._lock:
                self._desk.append(a)

    def take_desk(self, fault: str) -> dict | None:
        """Consume one armed desk fault of this kind (the bot calls it at the stage where the fault lands), or None."""
        with self._lock:
            for i, a in enumerate(self._desk):
                if a.get("fault") == fault:
                    return self._desk.pop(i)
        return None

    def _take(self, point: str) -> dict | None:
        with self._lock:
            for i, a in enumerate(self._armed):
                if a.get("point"):
                    hit = a["point"] == point
                elif a.get("scope") == "inner":
                    hit = point in self._inner
                else:
                    hit = point in CRASH_POINTS
                if hit:
                    return self._armed.pop(i)
        return None

    def hook(self, point: str, ctx: dict | None = None) -> None:
        a = self._take(point)
        if a is None:
            return
        self.send({"k": "at_point", "point": point, "fault": a.get("fault"), **(ctx or {})})
        threading.Event().wait()  # the runner SIGKILLs this process; never busy-wait

    def wait_for(self, ev: threading.Event, ms: float) -> None:
        ev.wait(self.real_s(ms))


# ---- transport ----

class Transport:
    def __init__(self, provider: str, lane: str, host: Host):
        self.provider = provider.rstrip("/")
        self.gate: Callable[[str, dict], None] | None = None
        self.lane = lane
        self.host = host

    def _call(self, path: str, method: str, headers: dict, body: dict | None, timeout_ms: float) -> tuple[int, Any, dict]:
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(self.provider + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=self.host.real_s(timeout_ms)) as res:
                return res.status, _json(res.read()), {k.lower(): v for k, v in res.headers.items()}
        except urllib.error.HTTPError as e:
            return e.code, _json(e.read()), {k.lower(): v for k, v in e.headers.items()}

    def post(self, kind: str, body: dict, key: str | None, recovery: bool) -> tuple[int, Any, dict]:
        path = PATHS.get(kind)
        if path is None:
            raise ValueError(f"unknown effect kind {kind}")
        if self.gate is not None:  # in-process adapter fault (desk.py): fails before anything is sent
            try:
                self.gate(kind, body)
            except CallError as e:
                if e.status is None:
                    raise OSError(str(e)) from e
                return e.status, {}, ({"retry-after": str((e.retry_after_ms or 0) / 1000)} if e.retry_after_ms else {})
        headers = {"content-type": "application/json", "x-haunt-phase": "recovery" if recovery else "normal"}
        if key is not None:
            headers["idempotency-key"] = key
        return self._call(path, "POST", headers, body, 1500)

    def lookup(self, kind: str, key: str) -> dict:
        from urllib.parse import quote
        q = f"lane={quote(self.lane)}&kind={quote(kind)}&key={quote(key)}"
        status, body, _ = self._call(f"/lookup?{q}", "GET", {"x-haunt-phase": "recovery"}, None, 1500)
        if status != 200:
            raise RuntimeError(f"lookup returned {status}")
        return body


def _json(raw: bytes) -> Any:
    try:
        return json.loads(raw.decode("utf-8")) if raw else {}
    except ValueError:
        return {}


# ---- SDK ----

class StageCtx:
    def __init__(self, sdk: "Sdk", order: str, stage: str):
        self.sdk, self.order, self.stage = sdk, order, stage
        self.replayed = 0
        self.ran = 0

    def key(self, name: str) -> str:
        return f"{self.order}:{name}"

    def work(self, ms: float) -> None:
        self.sdk.work(self.order, self.stage, ms)

    def effect(self, kind: str, key: str | None = None, body: dict | None = None, index: int | None = None) -> Any:
        return self.sdk.effect(self, kind, key, body or {}, index)


class Sdk:
    def __init__(self, tier: str, lane: str, use: tuple[str, ...], host: Host, transport: Transport, journal_path: str | None):
        self.tier, self.lane, self.use, self.host, self.transport = tier, lane, set(use), host, transport
        self.journal: Journal | None = None
        if "journal" in self.use:
            if not journal_path:
                raise ValueError("the journal part needs a journal path")
            self.journal = Journal(journal_path)
            self._journal_path = journal_path
        self.state: dict = {}
        self.breakers: dict[str, dict] = {}
        self.slept: set[str] = set()
        self.runs: dict[str, int] = {}
        self.key_used = False
        self.order_id: str | None = None
        self.replaying = False
        self.done_detail: dict | None = None  # facts the bot attaches to its order_done (the desk's CSAT facts)
        host.sdk = self

    def parts(self) -> list[str]:
        p = set(self.use)
        if self.key_used:
            p.add("idempotency")
        return [x for x in PARTS if x in p]

    def start(self) -> None:
        self.host.hook("startup", {})
        if self.journal:
            self.state = replay(read_journal(self._journal_path))
        self.host.send({"k": "hello", "tier": self.tier, "parts": self.parts(), "pid": os.getpid()})

    def arm_disk_full(self) -> bool:
        if not self.journal:
            return False
        self.journal.fail_next_write()
        return True

    def breaker_open_until(self, service: str) -> float | None:
        b = self.breakers.get(service)
        return b["open_until"] if b else None

    def close(self) -> None:
        if self.journal:
            self.journal.close()

    def order(self, oid: str, fn: Callable[["Sdk"], None]) -> str:
        prior = (self.state.get(oid) or {}).get("outcome")
        if self.journal and prior in ("done", "failed", "quarantined"):
            self.host.send({"k": "duplicate_skipped", "order": oid})
            return "skipped"
        self.order_id = oid
        self.replaying = False
        self.done_detail = None
        self._ev("order_start", oid)
        try:
            fn(self)
            outcome = result = "done"
            self._ev("order_done", oid, None, self.done_detail)
        except ParkSignal as e:
            outcome = result = "parked"
            self._ev("order_parked", oid, None, {"reason": e.reason})
        except QuarantineError as e:
            outcome, result = "quarantined", "quarantined"
            self._ev("order_quarantined", oid, None, {"reason": str(e)})
        except Exception as e:  # noqa: BLE001 a failed order never stops the lane
            outcome = result = "failed"
            self._ev("order_failed", oid, None, {"reason": str(e)})
        self._write({"t": "order_end", "order": oid, "outcome": outcome, "ts": self.host.now()})
        self.order_id = None
        return result

    def stage(self, name: str, fn: Callable[[StageCtx], None]) -> None:
        order = self._need()
        if self.journal and ((self.state.get(order) or {}).get("stages", {}).get(name) or {}).get("done"):
            self.host.hook("during_replay", {"order": order, "stage": name})
            if not self.replaying:
                self.replaying = True
                self._ev("recover_start", order, name, {"action": "replay"})
            self._ev("stage_done", order, name, {"skipped": True})
            return
        self._end_replay(order, name)
        rk = f"{order}|{name}"
        attempt = self.runs.get(rk, 0) + 1
        self.runs[rk] = attempt
        self._write({"t": "stage_start", "order": order, "stage": name, "attempt": attempt, "ts": self.host.now()})
        self._ev("stage_start", order, name, {"attempt": attempt})
        ctx = StageCtx(self, order, name)
        fn(ctx)
        self._write({"t": "stage_done", "order": order, "stage": name, "ts": self.host.now()})
        self._ev("stage_done", order, name, {"skipped": True} if ctx.replayed > 0 and ctx.ran == 0 else None)

    def work(self, order: str, stage: str, ms: float) -> None:
        k = f"{order}|{stage}"
        if k in self.slept:
            return
        self.slept.add(k)
        self.host.sleep(ms / 2)
        self.host.hook("mid_stage", {"order": order, "stage": stage})
        self.host.sleep(ms / 2)

    def effect(self, ctx: StageCtx, kind: str, key: str | None, body_in: dict, index: int | None) -> Any:
        host, order, stage = self.host, ctx.order, ctx.stage
        if key is not None:
            self.key_used = True
        eid = kind if index is None else f"{kind}:{index}"
        prior = None
        if self.journal:
            prior = ((self.state.get(order) or {}).get("stages", {}).get(stage) or {}).get("effects", {}).get(eid)
        if prior and prior["result"]:
            host.hook("during_replay", {"order": order, "stage": stage})
            ctx.replayed += 1
            return prior["payload"]
        ctx.ran += 1
        host.hook("before_effect", {"order": order, "stage": stage})
        body = {"lane": self.lane, "order": order, **body_in}
        if index is not None:
            body["index"] = index
        recovery = False
        if prior and prior["intent"]:
            if "idempotency" in self.use and key is not None:
                found = self._reconcile(order, stage, kind, key)
                if found is not None:
                    self._write({"t": "result", "order": order, "stage": stage, "kind": kind, "key": key, "eid": eid, "payload": found, "ts": host.now()})
                    host.hook("after_journal", {"order": order, "stage": stage})
                    return found
            recovery = True
        else:
            self._write({"t": "intent", "order": order, "stage": stage, "kind": kind, "key": key, "eid": eid, "ts": host.now()})
        payload = self._call(order, stage, kind, body, key, recovery)
        host.hook("after_effect_before_journal", {"order": order, "stage": stage})
        self._write({"t": "result", "order": order, "stage": stage, "kind": kind, "key": key, "eid": eid, "payload": payload, "ts": host.now()})
        host.hook("after_journal", {"order": order, "stage": stage})
        return payload

    def _reconcile(self, order: str, stage: str, kind: str, key: str) -> dict | None:
        self._ev("recover_start", order, stage, {"action": "reconcile"})
        self.host.hook("during_reconcile", {"order": order, "stage": stage})
        r = self.transport.lookup(kind, key)
        row = r.get("row") if isinstance(r, dict) else None
        if not (isinstance(r, dict) and r.get("found") and row):
            self._ev("recover_done", order, stage, {"action": "reexecute"})
            return None
        self.host.send({"k": "reconciled", "kind": kind, "key": key})
        self._ev("recover_done", order, stage, {"action": "reconciled"})
        return {"id": row.get("id")}

    def _call(self, order: str, stage: str, kind: str, body: dict, key: str | None, recovery: bool) -> Any:
        breaker = "breaker" in self.use
        mx = BREAKER["attempts"] if breaker else RETRY["attempts"] if "retry" in self.use else 1
        attempt = 0
        while True:
            attempt += 1
            if breaker:
                self._check_breaker(kind)
            try:
                status, rbody, headers = self.transport.post(kind, body, key, recovery)
                if 200 <= status < 300:
                    if breaker:
                        self._breaker(kind)["fails"] = 0
                    return rbody
                ra = headers.get("retry-after")
                try:
                    ra_ms = float(ra) * 1000 if ra is not None else None
                except ValueError:
                    ra_ms = None
                err = CallError(status, ra_ms, f"{kind} returned {status}")
            except (OSError, ValueError) as e:  # timeouts, drops, resets
                err = CallError(None, None, f"{kind} failed: {e}")
            if breaker:
                self._note_failure(kind)
            self._ev("stage_fail", order, stage, {"attempt": attempt, "status": err.status})
            if attempt >= mx:
                raise err
            if breaker and "offline_queue" in self.use and self._is_open(kind):
                raise ParkSignal("breaker_open")
            action = "backoff" if breaker else "retry"
            delay = max(BREAKER["base_ms"] * 2 ** (attempt - 1), err.retry_after_ms or 0) if breaker else RETRY["delay_ms"]
            recovery = True
            self._ev("recover_start", order, stage, {"action": action, "attempt": attempt})
            self.host.hook("during_backoff", {"order": order, "stage": stage})
            self.host.sleep(delay)
            self._ev("recover_done", order, stage, {"action": action, "attempt": attempt})

    def _breaker(self, service: str) -> dict:
        return self.breakers.setdefault(service, {"fails": 0, "open_until": None})

    def _is_open(self, service: str) -> bool:
        b = self._breaker(service)
        return b["open_until"] is not None and self.host.now() < b["open_until"]

    def _check_breaker(self, service: str) -> None:
        b = self._breaker(service)
        if b["open_until"] is None:
            return
        if self.host.now() < b["open_until"]:
            if "offline_queue" in self.use:
                raise ParkSignal("breaker_open")
            raise CallError(None, None, f"breaker open for {service}")
        b["open_until"] = None
        b["fails"] = BREAKER["open_after"] - 1
        self.host.send({"type": "breaker", "order": self.order_id, "detail": {"service": service, "state": "half_open"}})

    def _note_failure(self, service: str) -> None:
        b = self._breaker(service)
        b["fails"] += 1
        if b["fails"] >= BREAKER["open_after"] and b["open_until"] is None:
            b["open_until"] = self.host.now() + BREAKER["open_ms"]
            self.host.send({"type": "breaker", "order": self.order_id, "detail": {"service": service, "state": "open"}})

    def recovery(self, order: str, stage: str, action: str) -> None:
        """A recovery the app did by itself (not a retry): the pair of events that the arena and the casebook read as the mechanism."""
        self._ev("recover_start", order, stage, {"action": action})
        self._ev("recover_done", order, stage, {"action": action})

    def _end_replay(self, order: str, stage: str) -> None:
        if self.replaying:
            self.replaying = False
            self._ev("recover_done", order, stage, {"action": "replay"})

    def _write(self, rec: dict) -> None:
        if not self.journal:
            return
        try:
            self.journal.append(rec)
        except JournalWriteError:
            # `journal` retries a failed write once (covers disk_full).
            self.host.send({"k": "absorbed", "reason": "journal write retried"})
            self.journal.append(rec)
        apply_record(self.state, rec)

    def _ev(self, typ: str, order: str, stage: str | None = None, detail: dict | None = None) -> None:
        msg: dict = {"type": typ, "order": order}
        if stage is not None:
            msg["stage"] = stage
        if detail is not None:
            msg["detail"] = detail
        self.host.send(msg)

    def _need(self) -> str:
        if self.order_id is None:
            raise RuntimeError("stage() called outside order()")
        return self.order_id


__all__ = [n for n in dir() if not n.startswith("_")]