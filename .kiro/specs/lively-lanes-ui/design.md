# Design: lively lanes and header fixes

## Root cause (R1)
`DialChaos.tick` in show mode draws one Bernoulli trial per lane per second with p = (1 + rate x 0.8) / (7.35 x 3.5), about 0.06 at the default dial. That is one creature per roughly 16 s of lane time, memoryless, so first-creature times and gaps of 20 to 39 s are normal. On top of that, an armed fault that never fires stays on the lane's stack until the order ends. At the default dial the depth cap is 1, so one unfired fault leaves the lane creature-free for the rest of its order (about 25 s).

## Fix (R1)
- `SHOW_MAX_GAP_MS = 6000` in `packages/haunt/src/runner/intensity.ts`. In show mode `DialChaos` remembers when each lane was first ticked (`since`) and when it last got a press (`last`). When a working lane is `SHOW_MAX_GAP_MS` past the later of the two it is overdue: the probability is forced to 1 and the depth room is the director's `MAX_DEPTH` instead of the dial's cap.
- 6 s leaves two seconds of margin under the 8 s requirement for tick granularity and a lane between stages.
- `show` is only set by the live `WaveClock`, and the live runtime only ticks it while `directorOn()` holds, so demos, nights and tournament rounds never reach it.

## Header (R2, R3)
- `body.tour-on` already hides the wave label and the app switcher. It now also hides `.hdr > .tagline` and `#demo-open`, which frees about 230 design px; measured overflow before was 1958 of 1920 px.
- `packTabLabel(choice, appLabels)` in `packs.ts` appends ` pack` when the name collides with `APP_TAB_LABELS`.

## CSS (R4)
`display: none; grid;` parsed as `display: none` plus a bare `grid` token that esbuild warns about. The bars were hidden by TV3-U4's half-size card, so the fix is `display: none;` and the grid columns stay for a later reveal.

## Tests
- `packages/core/test/lively-lanes-ui.test.ts`: per-lane first-creature time and max gap over 40 s at the default dial, four seeds; the director stays deterministic; the dial still raises the count.
- `packages/arena-ui/test/lively-lanes-ui.test.ts`: CSS text checks for R2 and R4, `packTabLabel` for R3.
