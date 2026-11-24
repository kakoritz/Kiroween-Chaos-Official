#!/usr/bin/env python3
"""Compose the draft. Usage: compose.py REPO_ROOT OUT_DIR
Needs OUT/timeline.json (tts.py), OUT/clips/*.webm + capture.json (capture.py), OUT/assets/*.png (assets.py).
Each scene lasts audio_s + PAD; video is trimmed/held to match the audio (voice is never sped up).
Writes OUT/draft.mp4, narration.wav, captions.srt, captions.ass, scenes/<id>.mp4, timeline_final.json."""
import json, subprocess, sys, textwrap
from pathlib import Path
import numpy as np, soundfile as sf

repo = Path(sys.argv[1]).resolve(); out = Path(sys.argv[2])
tl = json.loads((out / "timeline.json").read_text())["scenes"]
cap = json.loads((out / "clips" / "capture.json").read_text())
(out / "scenes").mkdir(exist_ok=True)
PAD, LEAD, FPS = 1.7, 0.4, 30
SRC = {  # scene id -> ("clip", name) | ("still", path) | ("kb", path)
    "s01-open": ("clip", "s01"), "s02-tournament": ("clip", "s02"), "s03-dial": ("clip", "s03"),
    "s04-casebook": ("kb", repo / "submission/gallery/11-casebook.png"),
    "s05-patterns": ("clip", "s05"),
    "s06-fix": ("kb", repo / "submission/gallery/12-grade-f-to-a.png"),
    "s07-python": ("clip", "s07"), "s08-lab": ("clip", "s08"),
    "s09-arch": ("kb", out / "assets/architecture.png"), "s10-end": ("kb", out / "assets/endcard.png"),
}
BOX_W, BOX_H = 1778, 1000   # content box; the bottom 80 px is the caption bar
def run(cmd): subprocess.run(cmd, check=True, stderr=subprocess.DEVNULL)

t = 0.0; rows = []
for s in tl:
    D = round(s["audio_s"] + PAD, 3); rows.append({**s, "t0": round(t, 3), "dur": D}); t += D
total = round(t, 3)

# captions
def ts(x): h = int(x // 3600); m = int(x % 3600 // 60); return f"{h:02d}:{m:02d}:{x % 60:06.3f}".replace(".", ",")
srt = []; ass = ["[Script Info]", "ScriptType: v4.00+", "PlayResX: 1920", "PlayResY: 1080", "",
    "[V4+ Styles]", "Format: Name,Fontname,Fontsize,PrimaryColour,OutlineColour,BackColour,Bold,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV",
    "Style: Cap,DejaVu Sans,34,&H00F2EAD2,&H00000000,&H00000000,1,1,2,0,2,60,60,12", "",
    "[Events]", "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text"]
def at(x): return f"{int(x//3600)}:{int(x%3600//60):02d}:{x%60:05.2f}"
for i, r in enumerate(rows, 1):
    a, b = r["t0"] + 0.2, r["t0"] + r["dur"] - 0.1
    srt.append(f"{i}\n{ts(a)} --> {ts(b)}\n{r['caption']}\n")
    lines = "\\N".join(textwrap.wrap(r["caption"], 78))
    ass.append(f"Dialogue: 0,{at(a)},{at(b)},Cap,,0,0,0,,{lines}")
(out / "captions.srt").write_text("\n".join(srt)); (out / "captions.ass").write_text("\n".join(ass) + "\n")

# video segments (no captions yet; burned once on the concatenated video so timing is exact)
for r in rows:
    kind, ref = SRC[r["id"]]; seg = out / "scenes" / f"{r['id']}.mp4"; D = r["dur"]
    pad = f"scale={BOX_W}:{BOX_H}:force_original_aspect_ratio=decrease,pad=1920:1080:(1920-iw)/2:0:color=0x0d0a16,format=yuv420p"
    if kind == "clip":
        c = cap[ref]; ss = c["start"]
        if r["id"] == "s02-tournament": ss = 3.0
        if r["id"] == "s01-open": ss = 1.0
        if r["id"] == "s05-patterns": ss = 98.0
        vf = f"fps={FPS},tpad=stop_mode=clone:stop_duration=30,{pad},trim=duration={D},setpts=PTS-STARTPTS"
        run(["ffmpeg", "-y", "-ss", str(ss), "-i", str(out / "clips" / f"{ref}.webm"), "-vf", vf, "-t", str(D), "-r", str(FPS), "-an", "-c:v", "libx264", "-crf", "18", str(seg)])
    else:
        n = int(D * FPS)
        zp = f"scale=4000:-1,zoompan=z='1+0.06*on/{n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={n}:s={BOX_W}x{BOX_H}:fps={FPS},pad=1920:1080:(1920-iw)/2:0:color=0x0d0a16,format=yuv420p"
        run(["ffmpeg", "-y", "-loop", "1", "-i", str(ref), "-vf", zp, "-t", str(D), "-an", "-c:v", "libx264", "-crf", "18", str(seg)])
(out / "concat.txt").write_text("".join(f"file 'scenes/{r['id']}.mp4'\n" for r in rows))

# audio: narration + quiet generated ambient bed
sr = 24000; voice = np.zeros(int((total + 1) * sr), dtype=np.float32)
for r in rows:
    a, _ = sf.read(out / "audio" / f"{r['id']}.wav", dtype="float32"); i = int((r["t0"] + LEAD) * sr); voice[i:i + len(a)] += a
sf.write(out / "narration.wav", voice[: int(total * sr)], sr)
run(["ffmpeg", "-y", "-f", "lavfi", "-i", f"aevalsrc='0.5*sin(2*PI*55*t)+0.3*sin(2*PI*82.4*t+0.5*sin(2*PI*0.1*t))+0.2*sin(2*PI*110*t)':d={total}:s=48000",
     "-f", "lavfi", "-i", f"anoisesrc=color=brown:amplitude=0.5:d={total}:sample_rate=48000",
     "-filter_complex", f"[0]volume=0.5[a];[1]lowpass=f=400,volume=0.25[b];[a][b]amix=inputs=2:normalize=0,afade=t=in:d=3,afade=t=out:st={total-4}:d=4,volume=0.12[o]",
     "-map", "[o]", str(out / "bed.wav")])
run(["ffmpeg", "-y", "-i", str(out / "narration.wav"), "-i", str(out / "bed.wav"), "-filter_complex",
     "[0]aresample=48000,asplit[v][vs];[1]volume=1.0[b];[b][vs]sidechaincompress=threshold=0.02:ratio=4:attack=20:release=400[bd];[v][bd]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=7[m]",
     "-map", "[m]", "-ar", "48000", str(out / "mix.wav")])

# final: concat + burn captions + mux
vf = f"fade=t=in:d=0.5,fade=t=out:st={total-0.8}:d=0.8,ass={out/'captions.ass'}"
run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(out / "concat.txt"), "-i", str(out / "mix.wav"), "-vf", vf,
     "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", str(FPS),
     "-c:a", "aac", "-b:a", "192k", "-t", str(total), "-movflags", "+faststart", str(out / "draft.mp4")])
(out / "timeline_final.json").write_text(json.dumps({"total_s": total, "scenes": [{k: r[k] for k in ("id", "t0", "dur", "audio_s", "caption")} for r in rows]}, indent=1))
print("total", total)
