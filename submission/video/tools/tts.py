#!/usr/bin/env python3
"""Kokoro-82M narration: one wav per scene into OUT/audio, plus timeline.json with measured durations.
Usage: tts.py OUT_DIR [voice] [speed]"""
import json, sys, subprocess
from pathlib import Path
import numpy as np, soundfile as sf
from kokoro import KPipeline

here = Path(__file__).parent
out = Path(sys.argv[1]); voice = sys.argv[2] if len(sys.argv) > 2 else "af_heart"
speed = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
(out / "audio").mkdir(parents=True, exist_ok=True)
scenes = json.loads((here / "scenes.json").read_text())["scenes"]
pipe = KPipeline(lang_code="a", device="cpu")
for s in scenes:
    parts = [a for _, _, a in pipe(s["text"], voice=voice, speed=speed, split_pattern=r"\n+")]
    audio = np.concatenate([np.asarray(p) for p in parts])
    sf.write(out / "audio" / f"{s['id']}.wav", audio, 24000)
    d = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(out / "audio" / f"{s['id']}.wav")]))
    s["audio_s"] = round(d, 3)
    print(s["id"], s["audio_s"], len(s["text"].split()), "words")
(out / "timeline.json").write_text(json.dumps({"voice": voice, "speed": speed, "scenes": scenes}, indent=1))
print("total audio", round(sum(s["audio_s"] for s in scenes), 2))
