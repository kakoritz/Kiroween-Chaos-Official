"""Writes a lane's input folder: ord-0001.json ... ord-<N>.json from the fixed 12-message corpus.

Usage: python make_inbox.py <folder> <count>      write the mailbox
       python make_inbox.py --check               verify the classifier against the corpus
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CORPUS = os.path.join(HERE, "..", "data", "emails.json")


def load() -> list[dict]:
    with open(CORPUS, "r", encoding="utf-8") as f:
        return json.load(f)


def main() -> int:
    corpus = load()
    if sys.argv[1:2] == ["--check"]:
        from run import classify

        bad = [m["id"] for m in corpus if classify(m["subject"], m["body"]) != m["class_expected"]]
        print(json.dumps({"emails": len(corpus), "mismatches": bad}))
        return 1 if bad else 0
    folder, count = sys.argv[1], int(sys.argv[2])
    os.makedirs(folder, exist_ok=True)
    for i in range(1, count + 1):
        mail = dict(corpus[(i - 1) % len(corpus)])
        with open(os.path.join(folder, f"ord-{i:04d}.json"), "w", encoding="utf-8") as f:
            json.dump(mail, f)
    return 0


if __name__ == "__main__":
    sys.exit(main())
