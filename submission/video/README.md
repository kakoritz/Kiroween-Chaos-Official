# Demo video (first draft)

A 2:50 narrated walkthrough of Kiroween Chaos, rebuilt from scripts. Large files (mp4, wav, webm) are not in git; they are written to an output directory you choose.

- `script.md`: scene table with timecodes, exact narration, on-screen action, captions (generated).
- `captions.srt`: the burned-in lower-third captions as SRT.
- `tools/scenes.json`: single source for narration text, captions and actions.

## Rebuild

Needs Node 20+, Python 3.12, ffmpeg with libass, about 5 GB of disk (torch). The first TTS run downloads the Kokoro-82M weights from Hugging Face.

```
npm ci && npm run build:bots && npm run ui:build && npm run build:hosted
python3 -m venv .venv && .venv/bin/pip install kokoro soundfile numpy playwright
.venv/bin/python -m playwright install chromium
OUT=/path/to/out
.venv/bin/python submission/video/tools/tts.py $OUT af_heart 1.0        # one wav per scene + timeline.json (measured)
.venv/bin/python submission/video/tools/capture.py . $OUT               # screen capture
.venv/bin/python submission/video/tools/assets.py . $OUT                # architecture + end card PNGs
.venv/bin/python submission/video/tools/compose.py . $OUT               # draft.mp4, narration.wav, captions
.venv/bin/python submission/video/tools/make_script_md.py $OUT          # refresh script.md and captions.srt
```

`capture.py` starts the live server on `HAUNT_PORT=17270` (provider 17271) and the hosted build on 17280, and terminates only the processes it started. Pass scene names (`s01 s02 s03 s05 s07 s08`) to recapture a subset.

## How timing is made to match

`tts.py` writes one wav per scene and measures each with ffprobe. `compose.py` sets each scene length to the audio length plus 1.7 s and trims or holds (last frame) the video clip to fit. The voice is never time-stretched. Stills get a slow zoom. Audio is the narration over a quiet generated ambient bed (sine and filtered brown noise, ducked under the voice), normalised to about -16 LUFS. No third-party music.

## Layout

Content is scaled into a 1778x1000 box on a 1920x1080 frame; the bottom 80 px carries the caption. Captions are burned in with ASS (`captions.ass`) and also written as `captions.srt`.
