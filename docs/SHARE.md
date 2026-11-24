# Share: badge, scorecard, CI, optional LLM reviewer

## Badge and scorecard
`npm run haunt -- badge <run-id|report.json> [--out dir]` writes `haunt-badge.svg` (shields style, "Chaos Haunt" and a value like `A 94`, coloured by grade), `haunt-scorecard.svg` and `haunt-scorecard.html` (1200x630). Pure code, no fonts or images, same report gives the same bytes. The MCP tool `haunt_badge` does the same (`run`, `out`).

`npm run haunt -- badge --improve <improve-report.json> [--out dir]` (MCP: `haunt_badge` with `improve`) renders the improve loop result (report shape in `contract/V1_2.md`, C13) as a before and after card, "closed 5 of 9, C to B", to `haunt-improve.svg` and `.html`.

Samples made from the saved reports are in `docs/proof/badge/`. Note `wave1-report.json` and `wave2-report.json` carry a letter for `reliability`, so their score is the grade default, not a percentage.

## GitHub Action (opt-in)
`.github/actions/haunt-sweep/action.yml` (inputs `config`, `tiers`, `fail-on`, `comment`) sweeps, uploads report.html, report.json and the badge, comments on the pull request with `gh` (the body comes from the tested pure function in `packages/haunt/src/share/comment.ts`) and exits non-zero when a target fails. Examples: `docs/examples/haunt-ci.yml`, `docs/examples/haunt-action.yml`. This repo does not use it as a required check (see `docs/DECISIONS.md`).

## Optional LLM reviewer
The rules reviewer always runs. `node tools/run-ts.mjs tools/haunt-review.ts <run> --llm` adds a drafted diff inside the spec (`design.md`), never edits source. It is off by default and makes a network call only when `--llm` is given AND `ANTHROPIC_API_KEY` is set (or `HAUNT_REVIEWER_LLM=kiro` with the Kiro CLI). With the flag but no key, or on any error or timeout, it falls back to the rules result and says so on the console and in the postmortem. Tests mock all providers; there is no network in tests.
