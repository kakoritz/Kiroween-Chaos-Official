"""Campaign Crew for the Haunted Inbox (CP-C2). The parts come from HAUNT_PARTS, not from a tier.

Stub until CP-C5: it registers a `crew` tier with the parts of the environment and runs the normal inbox bot.
`HAUNT_PARTS` is a list of part ids or gear letters (R J I B Q), separated by commas, spaces, `+` or `|`.
`python crew.py --parts` prints the parts the Crew uses and exits.
"""
from __future__ import annotations

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import haunt_py as hp  # noqa: E402

BADGES = {"R": "retry", "J": "journal", "I": "idempotency", "B": "breaker", "Q": "offline_queue"}


def parse_parts(raw: str | None) -> tuple[str, ...]:
    """Unique parts in the canonical order. Raises ValueError on an unknown token. Same rules as crew.ts."""
    found: set[str] = set()
    for tok in re.split(r"[\s,+|]+", (raw or "").strip()):
        if not tok:
            continue
        if tok in hp.PARTS:
            found.add(tok)
        elif all(c in BADGES for c in tok.upper()):
            found.update(BADGES[c] for c in tok.upper())
        else:
            raise ValueError(f"unknown part {tok!r}")
    return tuple(p for p in hp.PARTS if p in found)


def main() -> None:
    hp.TIERS["crew"] = parse_parts(os.environ.get("HAUNT_PARTS"))
    os.environ["HAUNT_TIER"] = "crew"
    import run  # noqa: E402  (the inbox bot reads HAUNT_TIER and the tier table)

    run.main()


if __name__ == "__main__":
    main()
