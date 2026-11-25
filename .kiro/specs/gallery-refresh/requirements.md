# Gallery refresh: requirements

Source: gallery screenshots 03, 04, 05, 07, 08, 09, 10, 11 and 14 predate the lively default (creatures on every lane), the a11y header changes and the third app tab. They no longer match the product.

## R1. Retaken screenshots
1. The nine images keep their filenames in `submission/gallery/`, are 1500x1000 (3:2) PNG and under 5 MB each.
2. Each is captured from the current build (live server, headless Chromium, 127.0.0.1 only, no external call).
3. Arena shots (03, 04, 05, 08, 09) show creatures on every lane or the named moment (boss banner, dial at 11). No empty arena, no clipped header.
4. Every image is looked at before it is kept.

## R2. Captions stay true
1. `submission/gallery-captions.md` is edited only where a caption no longer matches its new image. Captions 4 and 9 are re-read.

## R3. Image 06 is the three-apps image
1. `submission/gallery/06-skeleton-crew.png` is the image from `tools/make-gallery-06.py` (Orders, Ticket Desk, Stream).

## R4. Counts and trace
1. The spec count in `submission/project-story.md` equals the number of folders under `.kiro/specs`.
2. `npm run trace` leaves `docs/TRACE.md` at 100%.
