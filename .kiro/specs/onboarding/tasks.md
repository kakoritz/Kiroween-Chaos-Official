# Onboarding tasks

Branches `ui/ON-...`, `core/ON-...`, `docs/ON-...`.

- [ ] **ON-C1 Hosted demo.** Finish `harness H6.3` (browser target) and the Pages workflow; fallback to recorded runs labelled "Recorded run"; first paint under 5 s; no external requests. (Lane A)
- [ ] **ON-C2 Captions data.** `packages/core/demo/hero|full|loop.captions.json` and the captions endpoint or bundle (`GET /api/demo/captions/:script`, `inpage getCaptions(script)`). (Lane A)
- [ ] **ON-U1 Title splash.** Logo, typed hook, four buttons, `?splash=0`, skip, reduced motion. (Lane B)
- [ ] **ON-U2 Captions and callouts.** Subtitle line in the safe strip, CC toggle, callout arrows for the hero beat, `?freeze=<beat>` capture mode. (Lane B)
- [ ] **ON-U3 Guided tour.** Six steps with spotlight, `?tour=1`, button, Esc. (Lane B)
- [ ] **ON-U4 First-impression polish.** No MOCK or "Wave 4" noise on first load (quiet state label), rank board not crowning on zero, larger text for the video, one title and one tagline in the header. (Lane B)
- [ ] **ON-D1 README front page.** Per spec section 7; architecture diagram (mermaid and SVG); remove stale sections. (docs)
- [ ] **ON-D2 One story.** Align `docs/DEVPOST-DRAFT.md`, `BLOG-DRAFT.md`, `SOCIAL-DRAFT.md`, `JUDGES.md`, `DEMO-SCRIPT.md` with the story in section 2 and the video v2 structure in section 8. (docs, owner approves wording)
- [ ] **ON-D3 Video.** Record per the v2 script after the hosted demo and the live Kiro fix exist; burned-in captions; upload unlisted first, public at submission. (owner)

## Cut line
ON-C1, ON-U1, ON-D1, ON-D2 first (they decide the first impression). Then ON-U2 (captions), ON-U4, ON-U3.
