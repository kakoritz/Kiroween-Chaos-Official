# Questions a judge may ask

Short answers with the place to check. Honest limits are marked **Limit**.

| Question | Answer | Check it |
|---|---|---|
| What is it? | Chaos engineering for AI agents, played as a haunted house. It crashes and curses your bot, grades it from a separate ledger, and writes a fix spec. | [`START-HERE.md`](START-HERE.md) |
| Why is it a "skeleton"? | One harness runs any app. An app is a `haunt.yaml` (steps by role), no engine code. Three built-in apps (Node, Python, Node), two config-only apps, and yours. | [`MODULAR.md`](MODULAR.md), `examples/coffee-shop/haunt.yaml` |
| Can I plug in my own service? | Yes: write a `haunt.yaml`, run `npm run live -- --app <folder>`, or bring your own bot with its own stage names. | [`INTEGRATE.md`](INTEGRATE.md) |
| How do you know a bot really failed? | The fake provider keeps its own ledger. A repeat is two rows. The bot cannot hide it. | `packages/haunt/test/hero-crash.test.ts` |
| Is the grading real or scripted? | Real engine, real bot processes, seeded randomness. The hosted page replays recorded runs of the real engine and says so. The Lab and Chain Wizard are model-based and say so. | [`HOSTING.md`](HOSTING.md), the banner on the hosted page |
| What did Kiro do? | 22 specs, steering, five hooks, custom agents, a Power and a Crew app. Specs came first; the trace maps every requirement to tests. | [`HOW-KIRO-BUILT-THIS.md`](HOW-KIRO-BUILT-THIS.md), [`TRACE.md`](TRACE.md) |
| Does it auto-fix my code? | No. It writes a fix spec; you apply it. | `docs/proof/sample-hardening-spec/index.md` |
| Is it safe to run on production? | `observe` injects nothing, `staging` is capped, `prod-guarded` needs a window and an allowlist, `haunt stop` is the kill switch. | [`PRODUCTION-MODE.md`](PRODUCTION-MODE.md) |
| Does it work without a mouse or on a phone? | Keyboard focus, contrast and reduced motion are handled. **Limit:** the arena canvas is fixed 1280x720; on a phone use the Workflow Lab or Chain Wizard. | `.kiro/specs/a11y-mobile/requirements.md` |
| What are the limits? | See below. | this page |
| What would you build next? | Real provider kinds beyond the fixed set; the pack creature names in the live arena; Playback and Coffee Shop on the hosted page; a branching chain editor. | [`MODULAR.md`](MODULAR.md) |

## Limits, plainly

- Effect kinds are the fake provider's fixed set. Another kind is recorded as `store`.
- Chain Wizard and Workflow Lab scores are model-based. A real run in the arena is the proof.
- Playback and Coffee Shop run locally. The hosted page lists the three built-in apps.
- The pack creature names (Buffer Wraith...) are in the Lab and Casebook model; the live arena draws the engine's creatures.
- Chains are ordered lists: no branches or loops.
- The three built-in apps' faults are fixed lists (kept exact on purpose, so recorded runs stay valid). New apps get faults by role.
