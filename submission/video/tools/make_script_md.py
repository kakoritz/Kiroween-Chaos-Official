#!/usr/bin/env python3
"""Write script.md and captions.srt from scenes.json + OUT/timeline_final.json. Usage: make_script_md.py OUT_DIR"""
import json, sys, shutil
from pathlib import Path
here = Path(__file__).parent; out = Path(sys.argv[1]); root = here.parent
sc = {s["id"]: s for s in json.loads((here / "scenes.json").read_text())["scenes"]}
fin = json.loads((out / "timeline_final.json").read_text())
tc = lambda x: f"{int(x//60)}:{x%60:05.2f}"
words = sum(len(s["text"].split()) for s in sc.values())
L = ["# Kiroween Chaos: 3-minute demo video (first draft)", "",
 f"Total {tc(fin['total_s'])} (limit 3:00), {words} narration words, Kokoro-82M voice `af_heart` at speed 1.0. Generated from `tools/scenes.json`; do not edit the table by hand, edit the JSON and rebuild.", "",
 "Tagline: Chaos engineering for AI agents, played as a haunted house.", "",
 "Honesty rules: every capture is recorded footage and says so in the caption or voice-over. The tournament, Casebook and Patterns scenes come from the hosted build, which replays recorded runs of the real engine and shows its own Recorded run banner. The fix is recorded, not applied live (`docs/proof/live-fix.md`). No streaming app and no 11-stage Ticket Desk claim.", "",
 "| # | Time | Dur | Source | On-screen action | Caption (burned in) |", "|---|---|---|---|---|---|"]
for i, r in enumerate(fin["scenes"], 1):
    s = sc[r["id"]]
    L.append(f"| {i} {r['id']} | {tc(r['t0'])} | {r['dur']:.1f}s | {s['source']} | {s['action']} | {s['caption']} |")
L += ["", "## Narration (exact text)", ""]
for i, r in enumerate(fin["scenes"], 1):
    L += [f"**{i}. {r['id']}** ({tc(r['t0'])}, voice {r['audio_s']:.1f}s)", "", sc[r["id"]]["text"], ""]
(root / "script.md").write_text("\n".join(L))
shutil.copy(out / "captions.srt", root / "captions.srt")
print("script.md", words, "words")
