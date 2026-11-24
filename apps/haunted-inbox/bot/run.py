"""Haunted Inbox bot, the Ticket Desk: triages a support mailbox, eleven stages, driven by the Kiroween Chaos runner (no engine change).

Reads the standard HAUNT_* environment (.kiro/specs/engine/runtime.md section 1). The tier decides the parts.
`python run.py --parts` prints the parts the tier uses and exits.
"""
from __future__ import annotations

import json
import os
import re
import sys
import tempfile
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import haunt_py as hp  # noqa: E402
import desk  # noqa: E402

# id, label, min ms, max ms. Kept in step with apps/haunted-inbox/haunt.yaml (a test checks it).
STAGES = (
    ("login", "SSO login", 300, 600),
    ("ingest", "Ingest request", 400, 700),
    ("validate", "Validate", 300, 600),
    ("dedupe", "Deduplicate", 300, 600),
    ("triage", "Triage", 400, 800),
    ("assign", "Assign ticket", 500, 900),
    ("sla", "SLA clock", 200, 400),
    ("notify", "Notify requester", 400, 800),
    ("escalate", "Escalate", 300, 600),
    ("resolve", "Resolve", 300, 600),
    ("close", "Close and survey", 300, 500),
)
CLASSES = ("billing", "bug", "account", "spam")
ORDER_FILE = re.compile(r"^ord-(\d{4})(\.dup\d?)?\.json$")
TEMPLATES = {
    "billing": "Thanks for contacting billing. We are reviewing your invoice and will reply within one business day.",
    "bug": "Thanks for the report. Our engineers have a ticket open and will follow up with a fix or workaround.",
    "account": "Thanks for reaching out. We have started the account change and will confirm when it is done.",
}
RULES = (
    ("spam", ("winner", "free money", "unsubscribe", "crypto", "lottery", "click here")),
    ("billing", ("invoice", "charge", "refund", "payment", "billing")),
    ("bug", ("error", "crash", "bug", "broken", "not working", "exception")),
    ("account", ("password", "login", "account", "email address", "username")),
)


def classify(subject: str, body: str) -> str:
    """Deterministic stub that imitates an LLM: keyword rules, no model, no key, no cost."""
    text = f"{subject} {body}".lower()
    for cls, words in RULES:
        if any(w in text for w in words):
            return cls
    return "account"


def stage_def(sid: str) -> tuple:
    return next(s for s in STAGES if s[0] == sid)


def list_orders(d: str) -> list[str]:
    files = [f for f in os.listdir(d) if ORDER_FILE.match(f)]

    def key(f: str) -> tuple[int, int]:
        m = ORDER_FILE.match(f)
        n = m.group(2)  # type: ignore[union-attr]
        return int(m.group(1)), (int(n[4:] or 1) if n else 0)  # type: ignore[union-attr]

    return sorted(files, key=key)


def order_id_of(f: str) -> str:
    return re.sub(r"(\.dup\d?)?\.json$", "", f)


def main() -> None:
    tier = os.environ.get("HAUNT_TIER", "rookie")
    if tier not in hp.TIERS:
        raise SystemExit(f"unknown tier {tier}")
    use = hp.TIERS[tier]
    if "--parts" in sys.argv:
        print(json.dumps({"parts": list(use)}))
        return

    env = os.environ
    lane = env.get("HAUNT_LANE", "1")
    seed = env.get("HAUNT_SEED", "1")
    provider = env.get("HAUNT_PROVIDER", "http://127.0.0.1:7071")
    orders_dir = env.get("HAUNT_ORDERS_DIR")
    if not orders_dir:
        raise SystemExit("HAUNT_ORDERS_DIR is not set")
    lane_root = os.path.dirname(os.path.abspath(orders_dir))
    dirs = {
        "orders": orders_dir,
        "done": os.path.join(lane_root, "done"),
        "failed": os.path.join(lane_root, "failed"),
        "parked": os.path.join(lane_root, "parked"),
        "quarantine": os.path.join(lane_root, "quarantine"),
    }
    for d in dirs.values():
        os.makedirs(d, exist_ok=True)
    run_dir = env.get("HAUNT_RUN_DIR") or os.path.join(tempfile.gettempdir(), "haunt", "standalone")
    scratch = os.path.join(run_dir, f"lane-{lane}")
    os.makedirs(scratch, exist_ok=True)
    attempt0 = int(env.get("HAUNT_ATTEMPT", "1") or 1)
    work_scale = float(env.get("HAUNT_WORKSCALE", "1") or 1)
    speed = float(env.get("HAUNT_SPEED", "1") or 1)

    host = hp.Host(use, speed)
    cur: dict = {"order": None, "stage": None, "at": 0.0}
    last_park = {"reason": "breaker_open"}
    raw_send = host.send

    def send(m: dict) -> None:
        t = m.get("type")
        if t == "progress":
            m = {**m, "type": "stage_progress"}
        if t == "stage_start":
            cur.update(order=m.get("order"), stage=m.get("stage"), at=host.now())
        elif t in ("stage_done", "order_done", "order_failed", "order_parked"):
            cur.update(order=None, stage=None)
        if t == "order_parked":
            last_park["reason"] = str((m.get("detail") or {}).get("reason", "breaker_open"))
        raw_send(m)

    host.send = send  # type: ignore[method-assign]
    host.emit = send  # type: ignore[method-assign]

    def heartbeat() -> None:
        while True:
            host.sleep(300)
            order, stage = cur["order"], cur["stage"]
            if order is None or stage is None:
                continue
            d = stage_def(stage)
            pct = min(95, int((host.now() - cur["at"]) / d[3] * 100))
            send({"type": "stage_progress", "order": order, "stage": stage, "detail": {"pct": pct, "label": d[1]}})

    threading.Thread(target=heartbeat, daemon=True).start()
    host.start_stdin()

    transport = hp.Transport(provider, lane, host)
    sdk = hp.Sdk(tier, lane, use, host, transport, os.path.join(scratch, "journal.jsonl"))
    queue = "offline_queue" in use
    retry = "retry" in use
    idem = "idempotency" in use
    runs: dict[str, int] = {}
    state = {"file": "", "order": ""}

    def duration(sid: str, order: str) -> float:
        k = f"{order}|{sid}"
        runs[k] = runs.get(k, 0) + 1
        d = stage_def(sid)
        u = hp.unit(seed, lane, order, sid, attempt0, runs[k])
        return (d[2] + u * (d[3] - d[2])) * work_scale

    def read_mail() -> dict:
        try:
            with open(os.path.join(dirs["orders"], state["file"]), "r", encoding="utf-8") as f:
                text = f.read()
        except OSError as e:
            raise hp.InputError("missing", f"cannot read {state['file']}: {e.__class__.__name__}") from e
        try:
            v = json.loads(text)
        except ValueError as e:
            raise hp.InputError("malformed", f"{state['file']} is not valid JSON") from e
        if not isinstance(v, dict) or not isinstance(v.get("id"), str):
            raise hp.InputError("malformed", f"{state['file']} is not an email")
        return v

    def input_failure(e: Exception) -> Exception:
        if not isinstance(e, hp.InputError):
            return e
        if queue:
            return hp.QuarantineError(str(e)) if e.kind == "malformed" else hp.ParkSignal("missing_file")
        if retry:
            return e
        return hp.LaneHalted(str(e))

    def key(s: hp.StageCtx, name: str) -> str | None:
        return s.key(name) if idem else None

    journal = "journal" in use
    desk_fake = desk.Desk(seed, lane, lambda mode, order, prov: send({"type": "desk_fault", "order": order, "detail": {"mode": mode, "provider": prov}}), host.take_desk)
    transport.gate = lambda kind, body: desk_fake.gate(body.get("provider", ""), body.get("order", ""), body) if kind == "ticket" else None
    sla = desk.SlaClock(lambda: host.speed, os.path.join(scratch, "sla.json") if journal else None)
    dedupe = desk.Dedupe(journal, os.path.join(scratch, "dedupe.json"))
    audit_path = os.path.join(scratch, "audit.jsonl")
    repaired: set[str] = set()  # orders whose drifted field was mapped back from an alias (a parked order resumes with it)

    def audit(rec: dict) -> None:
        """The audit trail of a journaled desk: every reclassification is written down."""
        try:
            with open(audit_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(rec, separators=(",", ":")) + "\n")
        except OSError:
            pass

    def note(oid: str, stage: str, label: str, pct: int = 90) -> None:
        send({"type": "stage_progress", "order": oid, "stage": stage, "detail": {"pct": pct, "label": label}})

    def stages(oid: str) -> None:
        mail: dict = {}
        info: dict = {"cls": "", "queue": "", "dedupe": {"duplicate": False, "master": None, "children": []}, "reclass": 0, "faults": []}
        path = os.path.join(dirs["orders"], state["file"])
        sla.start(oid)  # the SLA clock starts when the request is received, not when a ticket exists

        def load() -> None:
            try:
                mail.update(read_mail())
            except Exception as e:  # noqa: BLE001
                raise input_failure(e) from e

        def do_login(s: hp.StageCtx) -> None:
            s.work(duration("login", oid))
            # SSO: one session record (an account) per request. A second one for the same request is a visible repeat in the ledger.
            s.effect("account", key(s, "login"), {"sso": f"desk-{lane}", "session": True})

        def ingest(s: hp.StageCtx) -> None:
            s.work(duration("ingest", oid))
            host.hook("input_read", {"order": oid, "stage": "ingest"})
            host.send({"k": "at_point", "point": "input_read", "order": oid, "stage": "ingest"})
            host.proceed.clear()
            host.wait_for(host.proceed, 2000)
            load()
            if host.take_desk("webhook_retry_storm"):
                # the sender's webhook retries the same payload (same external id) three more times
                n = len(desk.write_retries(dirs["orders"], state["file"], 3))
                info["faults"].append("webhook_retry_storm")
                note(oid, "ingest", f"Webhook retry storm: {n} more deliveries of {mail['id']}")

        sdk.stage("login", do_login)
        sdk.stage("ingest", ingest)
        if not mail:  # skipped by a journal replay: read the file again for its data only
            load()

        def do_validate(s: hp.StageCtx) -> None:
            s.work(duration("validate", oid))
            if host.take_desk("field_mapping_error"):
                alias = desk.drift_field(mail, "subject")
                desk.persist_mail(path, mail)
                info["faults"].append("field_mapping_error")
                note(oid, "validate", f"Field mapping drift: subject now arrives as {alias}", 60)
            missing = desk.missing_fields(mail)
            if not missing or oid in repaired:
                return
            field = missing[0]
            if not any(a in mail for a in desk.ALIASES.get(field, ())):
                raise input_failure(hp.InputError("malformed", f"{state['file']} has no {field}"))
            reason = f"field_mapping_error: {field}"
            if queue:  # park with the field named; the ticket is not dropped, it resumes once the field is mapped
                repaired.add(oid)
                raise hp.ParkSignal(reason)
            raise input_failure(hp.InputError("field_mapping", f"{reason} (the source sends it under another name)"))

        def do_dedupe(s: hp.StageCtx) -> None:
            s.work(duration("dedupe", oid))
            if host.take_desk("duplicate_storm"):
                ids = desk.add_siblings(mail, 2)
                desk.persist_mail(path, mail)
                info["faults"].append("duplicate_storm")
                note(oid, "dedupe", f"Duplicate storm: {len(ids)} more messages about the same problem", 60)

        def do_triage(s: hp.StageCtx) -> None:
            s.work(duration("triage", oid))
            if host.take_desk("wrong_queue"):
                mail["queue"] = desk.wrong_queue_for(classify(mail["subject"], mail["body"]))
                desk.persist_mail(path, mail)
                info["faults"].append("wrong_queue")
                note(oid, "triage", f"Requester picked the {mail['queue']} queue", 60)

        def prov() -> str:
            return desk.provider_for(mail["id"])

        def do_assign(s: hp.StageCtx) -> None:
            s.work(duration("assign", oid))
            if info["cls"] == "spam" or info["dedupe"]["duplicate"]:
                return
            body = desk.map_ticket(prov(), mail, info["cls"], info["dedupe"]["master"], info["queue"], info["dedupe"]["children"])
            s.effect("ticket", key(s, "ticket"), body)
            if not journal:  # no dedupe memory: every message of a storm gets its own ticket
                for sib in mail.get("siblings", []):
                    s.effect("ticket", key(s, "ticket"), {**body, "externalId": sib.get("id"), "children": []})

        def do_sla(s: hp.StageCtx) -> None:
            s.work(duration("sla", oid))
            if info["cls"] == "spam":
                return
            target = sla.set_target(oid, info["cls"])
            if host.take_desk("sla_breach"):
                sla.force_breach(oid)
                info["faults"].append("sla_breach")
            left = sla.left(oid)
            note(oid, "sla", f"SLA {target / 1000:.0f}s, " + ("BREACHED" if sla.breached(oid) else f"{max(0.0, (left or 0) / 1000):.1f}s left"))

        def do_notify(s: hp.StageCtx) -> None:
            s.work(duration("notify", oid))
            if info["cls"] != "spam" and not info["dedupe"]["duplicate"]:
                s.effect("reply", key(s, "reply"), {"text": TEMPLATES.get(info["cls"], TEMPLATES["account"])})
                sla.mark(oid, "first_response")

        def do_escalate(s: hp.StageCtx) -> None:
            s.work(duration("escalate", oid))
            if info["cls"] == "spam" or info["dedupe"]["duplicate"]:
                return
            breached = sla.breached(oid)
            if info["cls"] == "bug" or breached:
                # Once per ticket: the key is the ticket, not the minute. A breached ticket stays unacknowledged, so the monitor fires on
                # every tick; with the ticket's key (or a journal) the repeats are replays, without them each tick is another notice.
                ticks = desk.BREACH_TICKS if breached else 1
                for t in range(ticks):
                    s.effect("notify", key(s, "escalate"), {"queue": "engineering", "provider": prov(), "reason": "sla_breach" if breached else "bug", "tick": t + 1})
                    if t + 1 < ticks:
                        host.sleep(desk.TICK_MS)

        def do_resolve(s: hp.StageCtx) -> None:
            s.work(duration("resolve", oid))

        def do_close(s: hp.StageCtx) -> None:
            s.work(duration("close", oid))

        # validation, dedupe and triage are deterministic and free, so they also re-run on a journal replay
        sdk.stage("validate", do_validate)
        desk.repair_mail(mail)
        sdk.stage("dedupe", do_dedupe)
        info["dedupe"] = dedupe.check(mail, oid)
        sdk.stage("triage", do_triage)
        info["cls"] = classify(mail["subject"], mail["body"])
        declared = mail.get("queue")
        info["queue"] = info["cls"]
        if isinstance(declared, str) and declared != info["cls"]:
            if journal:  # the audit trail: reclassify, and write down why
                audit({"order": oid, "event": "reclassify", "from": declared, "to": info["cls"], "ts": host.now()})
                info["reclass"] += 1
                note(oid, "triage", f"Reclassified {declared} to {info['cls']} (audited)")
                sdk.recovery(oid, "triage", "replay")
            else:  # trusts the requester's queue
                info["queue"] = declared
        sdk.stage("assign", do_assign)
        sdk.stage("sla", do_sla)
        sdk.stage("notify", do_notify)
        sdk.stage("escalate", do_escalate)
        sdk.stage("resolve", do_resolve)
        sdk.stage("close", do_close)

        # the requester's side of the story, for the CSAT review (the arena computes the stars from these facts)
        spam = info["cls"] == "spam"
        total = sla.elapsed(oid)
        first = sla.marked(oid, "first_response")
        sdk.done_detail = {"desk": {
            "cls": info["cls"], "queue": info["queue"], "provider": prov(), "spam": spam,
            "firstResponseMs": round(first if first is not None else total), "resolveMs": round(total),
            "reassignments": info["reclass"] + desk_fake.reassignments(oid),
            "slaMs": sla.target(oid), "slaBreached": sla.breached(oid) and not spam,
            "master": info["dedupe"]["master"], "children": len(info["dedupe"]["children"]), "faults": info["faults"],
        }}
        dedupe.finish(mail, oid)

    def run_order(oid: str) -> str:
        halted = {"v": False}

        def body(_: hp.Sdk) -> None:
            try:
                stages(oid)
            except hp.LaneHalted:
                halted["v"] = True
                raise

        res = sdk.order(oid, body)
        if halted["v"]:
            raise hp.LaneHalted(f"lane {lane} halted on {oid}")
        return res

    send({"k": "ready"})
    host.wait_for(host.go, 2000)
    sdk.start()

    def move(f: str, to: str) -> None:
        src = os.path.join(dirs["orders"], f)
        if os.path.exists(src):  # renamed to .haunted by missing_file: the runner restores it
            os.replace(src, os.path.join(dirs[to], f))

    parked: dict[str, str] = {}

    def breakers_clear() -> bool:
        for svc in ("ticket", "reply", "notify"):
            until = sdk.breaker_open_until(svc)
            if (until or 0) > host.now():
                return False
        return True

    def parked_files() -> list[str]:
        return sorted(f for f in os.listdir(dirs["parked"]) if ORDER_FILE.match(f))

    def resume_parked() -> bool:
        if not queue:
            return False
        resumed = False
        for f in parked_files():
            oid = order_id_of(f)
            reason = parked.get(oid, "breaker_open")
            mapped = reason.startswith("field_mapping_error")
            if reason != "missing_file" and not mapped and not breakers_clear():
                continue
            if mapped:
                host.sleep(600)  # the mapping is applied, then the ticket goes on where it stopped
            os.replace(os.path.join(dirs["parked"], f), os.path.join(dirs["orders"], f))
            parked.pop(oid, None)
            send({"type": "order_resumed", "order": oid})
            resumed = True
            break  # one at a time: its order_start must follow at once (PROTOCOL.md rule 23)
        return resumed

    halted = False
    while True:
        files = list_orders(dirs["orders"])
        if not files:
            if resume_parked():
                continue
            if queue and (parked or parked_files()):
                host.sleep(1000)
                continue
            break
        f = files[0]
        state["file"] = f
        state["order"] = order_id_of(f)
        try:
            result = run_order(state["order"])
        except hp.LaneHalted as e:
            send({"type": "lane_halted", "detail": {"reason": str(e)}})
            halted = True
            break
        if result in ("done", "skipped"):
            move(f, "done")
        elif result == "failed":
            move(f, "failed")
        elif result == "quarantined":
            move(f, "quarantine")
        else:
            parked[state["order"]] = last_park["reason"]
            move(f, "parked")
        host.sleep(1)

    if not halted:
        send({"k": "idle"})
    sdk.close()
    if not host.stdin_closed:
        host.shutdown.wait()
    sys.stdout.flush()
    os._exit(0)


if __name__ == "__main__":
    main()
