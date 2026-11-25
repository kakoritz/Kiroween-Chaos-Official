# README GIF: requirements

Source: the README opens with a still image. A short looping clip of the real hosted demo shows the product in motion in the first screen. The gallery image "One skeleton" also said two apps; there are three.

## R1. A looping demo clip at the top of the README
1. `docs/img/demo.gif` exists, loops, is about 9 s long and 960 px wide, and shows the hosted demo (`?demo=hero`) with creatures attacking the lanes.
2. `README.md` embeds it directly under the title, with alt text that says what it shows.
3. The GIF is under 3 MB so the README loads fast.

## R2. The clip is reproducible
1. `tools/make-readme-gif.mjs` rebuilds the GIF from `dist/hosted` (serve, record headless, ffmpeg palette pass). It makes no external network call.
2. Its options (`--demo`, `--start`, `--len`, `--fps`, `--colors`, `--width`) are documented in the script header.

## R3. Gallery image 06 shows three apps
1. `submission/gallery/06-skeleton-crew.png` is 1500x1000 (3:2), under 5 MB, and reads "One skeleton, three apps": Orders, Ticket Desk, Stream.
2. `tools/make-gallery-06.py` regenerates it.
3. `submission/README.md` and `submission/gallery-captions.md` say three apps.

## R4. A test guards the README clip
1. A docs-truth test fails if `README.md` does not reference `docs/img/demo.gif`, the file is missing, or it is 3 MB or more.
