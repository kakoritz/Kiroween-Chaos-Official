"""Ticket Desk logic: in-process fakes of `jira`, `asana`, `kace` and a generic `webhook`, the SLA clock, the dedupe
index, field-mapping drift and the CSAT facts. No network.

Each adapter maps the same mail to a different ticket shape and fails in its own way. The adapter faults are transient and
raise BEFORE anything is sent to the provider, so they never add a ledger row; they cost a retry, or a failed order for a bot
with no retry. The random adapter faults are off unless HAUNT_DESK_FAULTS=1 or the live arena runs the app (HAUNT_APP=inbox).
The armed desk faults (`DESK_FAULTS`, pressed by the arena) work whenever the runner sends the arm.
Spec: .kiro/specs/packs/spec.md section 4.
"""
from __future__ import annotations

import json
import os
import time
from typing import Any, Callable

import haunt_py as hp

PROVIDERS = ("jira", "asana", "kace", "webhook")
PRIORITY = {"bug": "high", "billing": "medium", "account": "low", "spam": "none"}
QUEUE_OWNER = "queue-owner"

# Faults the arena arms on the bot (haunt_py.Host.take_desk). The bot applies each at its own stage.
DESK_FAULTS = ("sla_breach", "wrong_queue", "duplicate_storm", "field_mapping_error", "webhook_retry_storm", "assignee_deleted", "rate_limited")

# SLA target per class in virtual ms (the clock follows the arena speed, so a target means the same at any speed).
SLA_TARGET_MS = {"bug": 9000, "billing": 12000, "account": 15000, "spam": 15000}
# How often the breach monitor fires while a breached ticket is unacknowledged (the naive monitor fires every tick).
BREACH_TICKS = 3
TICK_MS = 300

# A requester picks the wrong queue: the next one over.
WRONG_QUEUE = {"bug": "billing", "billing": "account", "account": "bug", "spam": "billing"}
# The required mail fields and the names a drifting source calls them.
REQUIRED = ("id", "from", "subject", "body")
ALIASES = {"subject": ("summary", "title", "name"), "body": ("description", "text"), "from": ("requester", "sender")}


def provider_for(mail_id: str) -> str:
    """Stable per message: the same mail always goes to the same fake tracker."""
    return PROVIDERS[hp.fnv1a32(mail_id) % len(PROVIDERS)]


def faults_enabled() -> bool:
    return os.environ.get("HAUNT_DESK_FAULTS") == "1" or os.environ.get("HAUNT_APP") == "inbox"


def map_ticket(provider: str, mail: dict, cls: str, dup_of: str | None, queue: str | None = None, children: list[str] | None = None) -> dict:
    """The provider-specific field mapping. The external id is the idempotency anchor in every shape."""
    ext = mail["id"]
    pri = PRIORITY.get(cls, "low")
    if provider == "jira":
        body: dict[str, Any] = {"fields": {"summary": mail["subject"], "issuetype": "Bug" if cls == "bug" else "Task", "priority": pri}, "externalId": ext}
    elif provider == "asana":
        body = {"name": mail["subject"], "notes": mail["body"][:80], "assignee": "agent-1", "externalId": ext}
    elif provider == "kace":
        body = {"title": mail["subject"], "impact": pri, "queue": "helpdesk", "externalId": ext}
    else:
        body = {"event": "ticket.create", "data": {"subject": mail["subject"], "from": mail["from"]}, "externalId": ext}
    body["provider"] = provider
    body["class"] = cls
    body["routedQueue"] = queue or cls
    if dup_of:
        body["linkedTo"] = dup_of
    if children:
        body["children"] = list(children)
    return body


# ---- mail drift and persistence ----

def persist_mail(path: str, mail: dict) -> None:
    """Rewrite the mail file the way the source now sends it (drift, a wrong queue, a storm). Best effort."""
    try:
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(mail, f)
        os.replace(tmp, path)
    except OSError:
        pass


def missing_fields(mail: dict) -> list[str]:
    return [k for k in REQUIRED if not isinstance(mail.get(k), str) or not mail.get(k)]


def drift_field(mail: dict, field: str = "subject") -> str:
    """The source renamed a field (`subject` becomes `summary`): the mail keeps the value under the new name. Returns the new name."""
    alias = ALIASES[field][0]
    if field in mail:
        mail[alias] = mail.pop(field)
    return alias


def repair_mail(mail: dict) -> list[str]:
    """Map a drifted field back from a known alias. Returns the fields repaired."""
    fixed: list[str] = []
    for field in missing_fields(mail):
        for alias in ALIASES.get(field, ()):
            if isinstance(mail.get(alias), str) and mail.get(alias):
                mail[field] = mail.pop(alias)
                fixed.append(field)
                break
    return fixed


def wrong_queue_for(cls: str) -> str:
    return WRONG_QUEUE.get(cls, "billing")


def add_siblings(mail: dict, n: int = 2) -> list[str]:
    """A duplicate storm: n more messages from the same sender with the same subject, each with its own external id."""
    mail["siblings"] = [{"id": f"{mail['id']}-s{i}", "from": mail["from"], "subject": mail["subject"]} for i in range(1, n + 1)]
    return [s["id"] for s in mail["siblings"]]


def write_retries(orders_dir: str, file: str, n: int = 3) -> list[str]:
    """A webhook retry storm: the sender delivers the same payload (same external id) n more times."""
    out: list[str] = []
    src = os.path.join(orders_dir, file)
    for i in range(1, n + 1):
        name = file.replace(".json", ".dup.json" if i == 1 else f".dup{i}.json")
        dst = os.path.join(orders_dir, name)
        if os.path.exists(dst):
            continue
        try:
            with open(src, "rb") as a, open(dst, "wb") as b:
                b.write(a.read())
            out.append(name)
        except OSError:
            break
    return out


# ---- SLA clock ----

class SlaClock:
    """A real SLA clock per ticket. Time is real wall time scaled by the arena speed (virtual ms), so it keeps running while the
    bot retries, waits out a breaker or is dead. A bot with a journal keeps the clock on disk and survives a restart; one without
    starts the clock again, which hides the breach (that is the naive bot's pitfall)."""

    def __init__(self, speed: Callable[[], float], path: str | None) -> None:
        self.speed, self.path = speed, path
        self.t: dict[str, dict] = {}
        if path and os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    v = json.load(f)
                if isinstance(v, dict):
                    self.t = v
            except (OSError, ValueError):
                self.t = {}

    def _save(self) -> None:
        if not self.path:
            return
        try:
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self.t, f)
            os.replace(tmp, self.path)
        except OSError:
            pass

    def start(self, order: str) -> None:
        if order not in self.t:
            self.t[order] = {"start": time.time() * 1000, "target": None, "marks": {}}
            self._save()

    def _rec(self, order: str) -> dict:
        self.start(order)
        return self.t[order]

    def set_target(self, order: str, cls: str) -> int:
        r = self._rec(order)
        r["target"] = SLA_TARGET_MS.get(cls, SLA_TARGET_MS["account"])
        self._save()
        return int(r["target"])

    def elapsed(self, order: str) -> float:
        r = self._rec(order)
        return max(0.0, (time.time() * 1000 - float(r["start"])) * self.speed())

    def target(self, order: str) -> int | None:
        t = self._rec(order).get("target")
        return int(t) if t else None

    def left(self, order: str) -> float | None:
        t = self.target(order)
        return None if t is None else t - self.elapsed(order)

    def breached(self, order: str) -> bool:
        left = self.left(order)
        return left is not None and left < 0

    def force_breach(self, order: str) -> None:
        """The sla_breach fault: the ticket sat unseen past its deadline (the clock ran while nobody looked)."""
        r = self._rec(order)
        t = r.get("target") or SLA_TARGET_MS["account"]
        r["target"] = t
        r["start"] = min(float(r["start"]), time.time() * 1000 - (t + 500) / max(self.speed(), 0.001))
        self._save()

    def mark(self, order: str, name: str) -> None:
        r = self._rec(order)
        r["marks"].setdefault(name, round(self.elapsed(order)))
        self._save()

    def marked(self, order: str, name: str) -> float | None:
        v = self._rec(order)["marks"].get(name)
        return None if v is None else float(v)


# ---- dedupe index ----

class Dedupe:
    """External id plus sender and subject. The index is the bot's memory, so only a bot with a journal has one (it is kept on
    disk and survives a restart). Without it every message looks new: a retried webhook files a second ticket and a storm of
    messages about one problem files one ticket each."""

    def __init__(self, memory: bool, path: str | None) -> None:
        self.memory, self.path = memory, path
        self.done: dict[str, str] = {}   # external id -> order that finished it
        self.masters: dict[str, str] = {}  # sender|subject -> master order
        if memory and path and os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    v = json.load(f)
                self.done, self.masters = dict(v.get("done", {})), dict(v.get("masters", {}))
            except (OSError, ValueError):
                pass

    def _save(self) -> None:
        if not (self.memory and self.path):
            return
        try:
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump({"done": self.done, "masters": self.masters}, f)
            os.replace(tmp, self.path)
        except OSError:
            pass

    def check(self, mail: dict, order: str) -> dict:
        """-> {"duplicate": bool, "master": str|None, "children": [ids]}"""
        if not self.memory:
            return {"duplicate": False, "master": None, "children": []}
        key = f"{mail['from']}|{mail['subject']}"
        first = self.masters.setdefault(key, order)
        self._save()
        return {
            "duplicate": mail["id"] in self.done,
            "master": None if first == order else first,
            "children": [s["id"] for s in mail.get("siblings", []) if isinstance(s, dict) and isinstance(s.get("id"), str)],
        }

    def finish(self, mail: dict, order: str) -> None:
        if self.memory:
            self.done[mail["id"]] = order
            self._save()


# ---- adapters ----

class Desk:
    """One per bot process. `gate` fails the adapter's way before anything is sent: a queue mismatch is bounced, an armed
    assignee_deleted or rate_limited fault hits the next ticket call once, and roughly one ticket in six meets a random adapter fault."""

    def __init__(self, seed: str, lane: str, notify, take: Callable[[str], dict | None] | None = None) -> None:
        self.seed, self.lane, self.notify = seed, lane, notify
        self.take = take or (lambda _f: None)
        self.tripped: set[str] = set()
        self.reassigned: dict[str, int] = {}

    def reassignments(self, order: str) -> int:
        return self.reassigned.get(order, 0)

    def gate(self, provider: str, order: str, body: dict) -> None:
        # A ticket routed to a queue that does not handle its class is bounced by the helpdesk: retrying the same ticket cannot help.
        if body.get("class") not in (None, "spam") and body.get("routedQueue") != body.get("class"):
            self.notify("queue_mismatch", order, provider)
            raise hp.CallError(422, None, f"{provider} rejected the ticket: queue {body.get('routedQueue')} does not take {body.get('class')}")
        if order in self.reassigned:  # the deleted assignee was replaced by the queue owner on the first attempt
            body["assignee"] = QUEUE_OWNER
        if self.take("assignee_deleted"):
            self.reassigned[order] = self.reassigned.get(order, 0) + 1
            self.notify("assignee_deleted", order, provider)
            raise hp.CallError(404, None, f"{provider} assignee deleted")
        if self.take("rate_limited"):
            self.notify("rate_limited", order, provider)
            raise hp.CallError(429, 1000, f"{provider} rate limited")
        if not faults_enabled() or order in self.tripped:
            return
        if hp.unit(self.seed, self.lane, order, "desk") >= 1 / 6:
            return
        self.tripped.add(order)
        if provider == "asana":  # assignee_deleted: the adapter reassigns to the queue owner, the ticket still files
            body["assignee"] = QUEUE_OWNER
            self.reassigned[order] = self.reassigned.get(order, 0) + 1
            self.notify("assignee_deleted", order, provider)
            return
        if provider == "jira":  # rate_limited: 429 with Retry-After
            self.notify("rate_limited", order, provider)
            raise hp.CallError(429, 1000, "jira rate limited")
        if provider == "kace":  # a busy appliance: 503
            self.notify("kace_busy", order, provider)
            raise hp.CallError(503, None, "kace appliance busy")
        self.notify("webhook_timeout", order, provider)  # webhook: the receiver never answers
        raise hp.CallError(None, None, "webhook receiver timed out")
