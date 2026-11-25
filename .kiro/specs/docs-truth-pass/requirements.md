# Docs truth pass: requirements

Source: a read of the docs against the repo found claims that are no longer true or never were. This spec makes the docs say only what the repo does.

## R1. Hook claims match the hooks
1. No doc says the hooks "guard the contract" or "guard the seams". The only contract-related hook, `fixtures-on-contract-save`, runs `npm run validate:events` when a file under `contract/` or `fixtures/` is saved. It reports; it does not block an edit or a merge.
2. Docs that describe hooks say what each one runs and when.

## R2. The hosted link is present
1. The hosted build URL (`https://kakoritz.github.io/Kiroween-Chaos-Official/`) is in `README.md`, `docs/JUDGES.md` and the Try it section of `submission/project-story.md`.

## R3. One name per app, one count
1. The product is Kiroween Chaos. The three apps are Orders, Ticket Desk and Stream, in README, docs and the story. The arena switcher label text (`Haunted Orders`, `Haunted Inbox`, `Haunted Stream`) is named once as a UI label and nowhere else in prose.
2. The docs say three apps (Node, Python, Node), not two. The Ticket Desk has 11 stages, Orders 11, Stream 5.
3. `Chaos Haunt`, `Chaos Monkey` and `haunt-crew-app` appear nowhere in the live docs or the story.
4. The story and gallery captions match the repo (spec count, task count, number of campaign nights).

## R4. A judges start page
1. `docs/START-HERE.md` exists, is linked from the top of `README.md`, and says in one page: what it is, the two-command start, the hosted link, where specs, steering, hooks and agents live, the three apps, how to read `docs/TRACE.md`, and where the Kiro Crew app and Power live.

## R5. The truth test guards the fixes
1. `packages/haunt/test/docs-truth.test.ts` fails if a linked doc file is missing, a stale name returns, the app count is wrong, the hosted link is absent, or a doc claims hooks guard the contract.
