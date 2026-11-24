# Share, adopt, prove: tasks

Branches `core/SH-...`, `ui/SH-...`, `docs/SH-...`.

## Lane A
- [x] **SH-C1 Badge and scorecard.** `haunt badge`, SVG and HTML generators (deterministic), MCP tool `haunt_badge`, tests (same run same bytes).
- [x] **SH-C2 GitHub Action.** Composite action, example workflow, optional demo repo; PR comment with the Markdown report and badge; exit codes. Decision on CI policy in `docs/DECISIONS.md`.
- [x] **SH-C3 Workflow Lab engine.** Generic bot built from declared stages and parts; in-page sweep (browser engine); suggestions from reviewer rules; `inpage` functions `labRun(model)`.
- [x] **SH-C4 Real loop proof.** Run the live loop, get wave 2 to A on the stated plan, fix the Phoenix lost-order and `updates` crash cases if they appear, save everything in `docs/proof/`; label recorded fixes.
- [x] **SH-C5 LLM reviewer and hook.** `reviewer --llm`, fallback to rules, hook at wave end.
- [x] **SH-C6 Inbox live in the arena.** Spawn the Python inbox through the runner for real (not only the CLI sweep) so Night 6 and the app switcher use a live second app. (Judge panel noted this was not done.)
- [x] **SH-K1 Trace generator and hook.** `tools/trace.ts`, `docs/TRACE.md`, `.kiro/hooks/trace-on-merge`, `// covers:` comments in tests.
- [x] **SH-K3 Install proof.** (local handshake and screenshots done; IDE and Crew installs are owner-only, see `docs/proof/installed/README.md`) Install the Power and the Crew app, capture screenshots and clips, update docs.
- [x] **SH-K4 MCP scene.** Script and capture notes in `docs/proof/mcp-scene.md` (six tools, seven steps, setup and fallback).
- [x] **SH-K5 Steering files.** `tech.md`, `contract.md`, `art.md` in `.kiro/steering/`.

## Lane B
- [x] **SH-U1 Workflow Lab UI.** Form, presets, protections toggles, run view, report, export of `haunt.yaml`, badge, scorecard, honest "model-based" label.
- [x] **SH-U2 Share button.** In the report viewer: download badge and scorecard, copy README snippet.
- [ ] **SH-U3 Architecture diagram page.** In the hosted demo footer ("How it works").

## Docs and owner
- [x] **SH-D1 Architecture diagram.** Mermaid in README and `docs/img/architecture.svg`.
- [x] **SH-K2 Kiro write-up.** `docs/KIRO-WRITEUP.md` in rubric order with the candid section; rewrite `docs/KIRO-LOG.md` entries from PR bookkeeping into real notes. (owner reviews wording)

## Cut line
SH-C4 (real proof), SH-K2, SH-C1, SH-U2, SH-K3 first (they fix the red flags and feed Social Blitz). Then SH-C2, SH-C3 plus SH-U1 (Workflow Lab), SH-K1, SH-C6. Then the rest.
