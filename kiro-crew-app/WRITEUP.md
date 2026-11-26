# Kiroween Chaos for Kiro Crew: write-up

## The problem

Agents that call real services fail in boring ways: a retry that charges twice, a crash that redoes finished work, a poll that waits forever. You find these in production. This app finds them first, and says which step to fix.

## What it is

A Kiro Crew app (`app.json`) with one MCP server, two skills, one reviewer agent and one page. It is the Crew front door of [Kiroween Chaos](https://github.com/kakoritz/Kiroween-Chaos-Official). It was made during the Kiroween 2026 period.

The idea it rests on: a workflow is a list of steps, and every step has one of five roles (`input`, `work`, `effect`, `poll`, `final`). Chaos is attached by role, not by name, so any workflow gets attacked with no engine change. Steps come from a library of 22 reusable blocks, or are written inline.

## How Kiro Crew features are used

| Crew feature | Used for |
|---|---|
| MCP server | `server/haunt-mcp.mjs`, one bundled file started with `node`. Nine tools. Read-only ones (`haunt_define`, `haunt_blocks`, `haunt_chain`, `haunt_lab`, `haunt_report`) are auto-approved; the two that start local mock servers (`haunt_sweep`, `haunt_ramp`) ask first |
| Skills | `build-and-test-a-chain` (design a workflow, find the weak block) and `stress-test-my-workflow` (grade one, hand over to the reviewer) |
| Custom agent | `reviewer` reads a result and writes a postmortem and a hardening spec. Its `fs_write` is limited to `.kiro/specs/hardening-*/**`, `.haunt/runs/**` and `.tmp/**`, so it cannot change code |
| App page | `/apps/haunt` is the Chain Wizard as a static page, no server |
| Permissions | `network: false`, `storage: true`, requires `node`. Nothing enables itself |

## The flow

1. Ask for a chain. The skill calls `haunt_blocks` to see what exists.
2. Each chosen block is tested alone at a tier. A card says how many attacks it survived and which faults broke it.
3. `haunt_chain` tests the whole chain, then the blame table says which block caused which share of the failures.
4. Warnings catch what block-by-block misses: two effects with the same key, a wait right after an effect, no input stage.
5. The same chain at the `phoenix` tier shows what the five protections buy.
6. The reviewer writes a spec for the top blamed block. A person or a developer agent applies it. Nothing applies it for you.

## How it was built

Spec first. The modular engine behind it has requirements, a design and a task list in the main repo (`.kiro/specs/modular-engine/`, `.kiro/specs/crew-app-bonus/`). The MCP tools are covered by tests (`packages/haunt/test/mcp-modular.test.ts`), the server bundle is started from an empty folder in a test, and the page was loaded in headless Chrome.

## Limits, plainly

- The what-if results are model-based. They show how a tier's protections should behave. They are not a run of your code.
- `haunt_sweep` and `haunt_ramp` need a checkout (`HAUNT_ROOT`).
- Installing needs your own terminal: Kiro Crew refuses installs started from an agent's shell. No screenshot of the app inside a Crew window is included yet.
- Effect kinds map to a fixed list of kinds in the fake provider.
