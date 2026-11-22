"""Ticket Desk adapters (PK-C3): in-process fakes of `jira`, `asana`, `kace` and a generic `webhook`. No network.

Each adapter maps the same mail to a different ticket shape and fails in its own way. The faults are transient and
raise BEFORE anything is sent to the provider, so they never add a ledger row; they cost a retry, or a failed order
for a bot with no retry. Faults are off unless HAUNT_DESK_FAULTS=1 or the live arena runs the app (HAUNT_APP=inbox).
Spec: .kiro/specs/packs/spec.md section 4.
"""
from __future__ import annotations

import os
from typing import Any

import haunt_py as hp

PROVIDERS = ("jira", "asana", "kace", "webhook")
PRIORITY = {"bug": "high", "billing": "medium", "account": "low", "spam": "none"}
QUEUE_OWNER = "queue-owner"


def provider_for(mail_id: str) -> str:
    """Stable per message: the same mail always goes to the same fake tracker."""
    return PROVIDERS[hp.fnv1a32(mail_id) % len(PROVIDERS)]


def faults_enabled() -> bool:
    return os.environ.get("HAUNT_DESK_FAULTS") == "1" or os.environ.get("HAUNT_APP") == "inbox"


def map_ticket(provider: str, mail: dict, cls: str, dup_of: str | None) -> dict:
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
    if dup_of:
        body["linkedTo"] = dup_of
    return body


class Desk:
    """One per bot process. `gate` raises the adapter's failure mode for roughly one ticket in six, once per order."""

    def __init__(self, seed: str, lane: str, notify) -> None:
        self.seed, self.lane, self.notify = seed, lane, notify
        self.tripped: set[str] = set()
        self.seen: dict[str, str] = {}

    def dedupe(self, mail: dict, order: str) -> str | None:
        """The first order with a given sender and subject is the master; later ones link to it."""
        k = f"{mail['from']}|{mail['subject']}"
        first = self.seen.setdefault(k, order)
        return None if first == order else first

    def gate(self, provider: str, order: str, body: dict) -> None:
        if not faults_enabled() or order in self.tripped:
            return
        if hp.unit(self.seed, self.lane, order, "desk") >= 1 / 6:
            return
        self.tripped.add(order)
        if provider == "asana":  # assignee_deleted: the adapter reassigns to the queue owner, the ticket still files
            body["assignee"] = QUEUE_OWNER
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
