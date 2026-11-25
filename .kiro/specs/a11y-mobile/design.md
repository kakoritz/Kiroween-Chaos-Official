# Accessibility and mobile: design

Arena UI only. No `contract/` file, no engine code.

- **Pure model.** `packages/arena-ui/src/a11y.ts` holds `contrastRatio`, `meetsAA`, the token pairs to check, `waveStateText` and `fallbackText`. Tests read them without a browser.
- **Tokens.** `--muted` lightens to `#a89fc2`, `--fail` to `#ff6673`; a new `--hex-text` (`#b794ff`) is used where purple is text, and `--hex-bg` (`#7a4fe0`) where white text sits on purple.
- **CSS.** `src/a11y.css` adds a global `:focus-visible` ring and narrow-header shrink rules (`@media (max-width: 430px)` and the existing `body.narrow` flow, which already covers 768 px because width under 820 is narrow).
- **DOM.** `app/main.ts` adds `aria-label` to the symbol buttons, a `#wave-state` polite region and fallback text in the canvas, refreshed with the existing 2 s summary timer.
- **Reduced motion.** Already global in `styles.css`; the test pins it so it cannot be removed.
- **Stale text.** `HOW_CAPTION` and the SVG are edited by hand; `docs-truth` is unchanged because it already forbids "two apps".
- **Proof.** Model and structure tests (vitest) read the CSS and `main.ts` source. Optional screenshots at 390 and 1280 px go in `docs/proof/a11y-mobile/`.
