# Art steering

The full guide is `docs/ART-DIRECTION.md`. Asset licences are in `docs/ASSETS.md`.

- Skeletons, bosses and main creatures are drawn in code (SVG, CSS, Canvas). CC0 packs are allowed only for minor creatures and props, and each must be listed in `docs/ASSETS.md` with licence and URL before it is committed.
- No AI-generated images or audio. Sound is generated in code.
- Outlines are 4 px `#14101f` with rounded joins. Flat fills from the palette in `.kiro/specs/arena/ui-spec.md`, one shade layer and one rim highlight.
- Big heads, small bodies, faces that carry the story. Every creature must read as a silhouette at 56 px.
- Motion has anticipation, overshoot and settle. Respect reduced motion (no shake, no typing effect).
- UI text is plain and short. Every number on screen needs an explanation on hover or in the legend.
