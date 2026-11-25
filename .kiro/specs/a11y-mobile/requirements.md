# Accessibility and mobile: requirements

The arena UI already scales to a phone and has focus rings on most controls. This spec closes the gaps and makes each claim checkable.

## R1. Keyboard focus
1. Every interactive control (button, input, select, link, summary, `[tabindex]`) shows a visible focus ring of at least 3 px.
2. Tab order follows the visual order: header controls, then the arena, then rank board, ledger, ticker. No positive `tabindex` is used.

## R2. Names and roles
1. Every icon-only or symbol-only button (`?`, the keys glyph, the gear, the speaker) has an `aria-label`.
2. The stage has `role="main"`, the canvas `role="img"`, and each bottom panel is a labelled `section`.

## R3. Canvas fallback and live summary
1. The canvas carries fallback text inside the element for browsers that do not draw it.
2. A polite live region says the wave state (wave number, lane count, leader, active chaos). It updates only when the text changes.

## R4. Contrast
1. Every text colour token used on the stone and stone-2 panel backgrounds meets WCAG AA (4.5:1). White text on the pill and active tab backgrounds meets 4.5:1.

## R5. Reduced motion
1. With `prefers-reduced-motion: reduce`, all CSS animation and transition is off and the canvas scene runs in its reduced mode.
2. The in-app motion setting adds the same `reduced-motion` body class.

## R6. Narrow screens
1. At 360 to 430 px wide (phone) and 768 px wide (tablet), the layout is the narrow flow: no horizontal page scroll and the header wraps instead of clipping.
2. Header children can shrink (`min-width: 0`) and the logo wraps rather than pushing the header wider than the viewport.

## R7. Stale text
1. "How it works" says three apps (Orders, Ticket Desk, Stream) and `docs/img/architecture.svg` draws three app boxes.
