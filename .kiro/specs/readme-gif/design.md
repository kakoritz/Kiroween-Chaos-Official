# README GIF: design

Assets and tools only. No `contract/` file, no `packages/arena-ui` source.

- **Capture.** `tools/make-readme-gif.mjs` serves `dist/hosted` on a random loopback port and runs `tools/make-readme-gif.py` (Playwright chromium, 960x600, video recording) on `?demo=hero` for 30 s. Run `npm run build:hosted` first.
- **Encode.** ffmpeg cuts 9 s starting at 10 s (the lanes are busy by then), 8 fps, 960 px, a 32-colour diff palette and bayer dither. These settings keep the GIF near 2.8 MB. More colours or fps pushes it past 3 MB.
- **Image 06.** `tools/make-gallery-06.py` renders an HTML card layout with Playwright, in the style of the other gallery images. Sprites for the skeleton and the Ticket Desk imp are in `submission/gallery-src/`; the Stream ghost is inline SVG.
- **Test.** A block in `packages/haunt/test/docs-truth.test.ts` carries `// covers: readme-gif/R1 ...`. `npm run trace` regenerates `docs/TRACE.md`.
