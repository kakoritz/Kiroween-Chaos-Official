# Lively lanes and header fixes: requirements

Goal: four defects found while retaking screenshots. Nothing in `contract/` changes. Demo scripts, campaign nights and tournament rounds behave as before.

## R1. Every live lane gets creatures on a plain wave
1. In a plain wave (random chaos mode, default dial, no demo, no campaign night, no tournament round) each live lane meets its first creature within 8 seconds of the clock starting.
2. No live lane that is working goes longer than 8 seconds without a new creature.
3. The guarantee is part of the seeded show director (`DialChaos` with `show` on). It is deterministic: the same seed and call timing give the same plan.
4. The dial still scales the plan: a higher level gives at least as many creatures. The guarantee is a floor, never a ceiling.
5. Demo scripts, campaign nights, tournament rounds, manual mode and the non-show dial are unchanged.

## R2. Next round is never clipped
1. In the tournament round-review state the header keeps every control inside the 1920 px design width, so `Next round` is fully visible at any viewport width, including about 1500 px.
2. The tagline and the Play demo button give way while a tournament is on. Nothing else is hidden.

## R3. One "Stream" in the header
1. The app tab keeps `Stream`. A pack tab whose name equals an app tab gets the suffix ` pack` (`Stream pack`), so the header never shows two identical labels.
2. Pack tabs with no matching app tab (`Default`, `Desk`) keep their names.

## R4. Valid review-card CSS
1. `.rc-bars` in `review-card.css` has a valid declaration list. The bars stay hidden in the half-size card, as they were.
2. `npm run ui:build` prints no CSS warning.
