"""Haunted Inbox bot: triages a support mailbox, six stages, driven by the Haunt runner (no engine change).

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

# id, label, min ms, max ms. Kept in step with apps/haunted-inbox/haunt.yaml (a test checks it).
STAGES = (
    ("fetch", "Fetch mail", 400, 800),
    ("classify", "Classify", 500, 1000),
    ("ticket", "File ticket", 500, 1000),
    ("draft", "Draft reply", 500, 1000),
    ("reply", "Send reply", 500, 1000),
    ("archive", "Archive", 300, 600),
)
CLASSES = ("billing", "bug", "account", "spam")
ORDER_FILE = re.compile(r"^ord-(\d{4})(\.dup)?\.json$")
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
        return int(m.group(1)), 1 if m.group(2) else 0  # type: ignore[union-attr]

    return sorted(files, key=key)


def order_id_of(f: str) -> str:
    return re.sub(r"(\.dup)?\.json$", "", f)


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
        if not isinstance(v, dict) or not all(isinstance(v.get(k), str) for k in ("id", "from", "subject", "body")):
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

    def stages(oid: str) -> None:
        mail: dict = {}
        cls = {"v": ""}

        def fetch(s: hp.StageCtx) -> None:
            s.work(duration("fetch", oid))
            host.hook("input_read", {"order": oid, "stage": "fetch"})
            host.send({"k": "at_point", "point": "input_read", "order": oid, "stage": "fetch"})
            host.proceed.clear()
            host.wait_for(host.proceed, 2000)
            try:
                mail.update(read_mail())
            except Exception as e:  # noqa: BLE001
                raise input_failure(e) from e

        sdk.stage("fetch", fetch)
        if not mail:  # skipped by a journal replay: read the file again for its data only
            try:
                mail.update(read_mail())
            except Exception as e:  # noqa: BLE001
                raise input_failure(e) from e

        def do_classify(s: hp.StageCtx) -> None:
            s.work(duration("classify", oid))
            cls["v"] = classify(mail["subject"], mail["body"])

        def do_ticket(s: hp.StageCtx) -> None:
            s.work(duration("ticket", oid))
            if cls["v"] != "spam":
                s.effect("ticket", key(s, "ticket"), {"class": cls["v"]})

        def do_draft(s: hp.StageCtx) -> None:
            s.work(duration("draft", oid))

        def do_reply(s: hp.StageCtx) -> None:
            s.work(duration("reply", oid))
            if cls["v"] != "spam":
                s.effect("reply", key(s, "reply"), {"text": TEMPLATES.get(cls["v"], TEMPLATES["account"])})

        def do_archive(s: hp.StageCtx) -> None:
            s.work(duration("archive", oid))

        # classification is deterministic and free, so it also re-runs on a journal replay
        sdk.stage("classify", do_classify)
        if not cls["v"]:
            cls["v"] = classify(mail["subject"], mail["body"])
        sdk.stage("ticket", do_ticket)
        sdk.stage("draft", do_draft)
        sdk.stage("reply", do_reply)
        sdk.stage("archive", do_archive)

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
        for svc in ("ticket", "reply"):
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
            if reason != "missing_file" and not breakers_clear():
                continue
            os.replace(os.path.join(dirs["parked"], f), os.path.join(dirs["orders"], f))
            parked.pop(oid, None)
            send({"type": "order_resumed", "order": oid})
            resumed = True
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
