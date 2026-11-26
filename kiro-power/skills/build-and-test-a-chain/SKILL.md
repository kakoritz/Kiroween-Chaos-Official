---
name: build-and-test-a-chain
description: Compose a workflow from reusable blocks, test each block alone, then test the chain and find which block broke it. Use when the user wants to design or review a workflow's resilience before writing code, or asks "which step is the weak one".
---

# Build and test a chain

Goal: pick the steps, see how each one holds up alone, then see how the whole chain holds up and which step is to blame.

1. Call `haunt_blocks` (no arguments) to see the 22 blocks and their roles: `input` reads, `work` thinks, `effect` changes the outside world, `poll` waits, `final` closes the loop. Choose blocks that match the user's workflow, in order.
2. Call `haunt_blocks` with `tier: "rookie"` for the chosen blocks, one call per block. A block that fails alone at `rookie` is expected; note which faults it fails.
3. Call `haunt_chain` with `blocks: [...]` and `tier: "rookie"`. Read `grade`, `failed`, the `blame` table (which stage and block caused which share of the failures) and `warnings` (problems a chain can have although each block passed alone).
4. Call `haunt_chain` again with `tier: "phoenix"`. The drop in `failed` is what the five protections buy: retry, journal, idempotency key, breaker, offline queue. Say which protection matters most for the top blamed block.
5. If the user has a `haunt.yaml`, call `haunt_lab` with its path for a model-based what-if with the findings and the parts to add. A stage may say `use: <block>`.
6. To get a spec the developer agent can apply, hand the result to the `reviewer` agent. It writes `.kiro/specs/hardening-<run>/`.

Rules:
- Results from `haunt_blocks`, `haunt_chain` and `haunt_lab` are model-based what-ifs, not runs of the user's code. Say so every time. A real run (`haunt_sweep`) needs a Kiroween Chaos checkout (`HAUNT_ROOT`).
- Never weaken a check to get a better grade. Fix the workflow.
- No real keys, no network.
