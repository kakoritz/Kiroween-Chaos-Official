# Open effect kinds (proposal, needs owner approval: contract change)

## What changes in plain words
Today a stage can only declare ten kinds of effect (charge, email, store, and so on). Any other kind is saved as `store` and the real name is lost. This change lets a stage use any kind name, for example `ledger_entry` or `sms`, and the arena and the ledger show that name.

## The one contract edit (v1.4, additive)
`contract/events.schema.json`, `$defs/effect/.../detail/properties/kind`: the closed list of ten names becomes
`{ "type": "string", "pattern": "^[a-z][a-z0-9_]{1,31}$" }`.
All ten current names match the pattern, so every recorded stream and fixture stays valid. No field is added or removed. `contract/V1_4.md` would say so, like V1_3.

## Code that follows (not contract)
| Part | Change |
|---|---|
| Provider | one new route `POST /effects/<kind>`; a kind is any name; the row keeps it; the ten old routes stay |
| `PROVIDER_KINDS`, `providerKind()`, `KIND_PATH` | an unknown kind is passed through instead of mapped to `store` |
| Generic bot and `bot:new` starter | send the declared kind |
| Arena | ledger lanes and effect chips show any kind (the default list is only a fallback) |
| Repeat detector | already keyed by kind, order, index: no change |

## Risk
- Old clients: none. The ten names and routes still work.
- A typo in a kind makes a new kind instead of an error. The manifest check already prints the kinds it sees.

## Tests that prove it
A manifest with `kind: sms`: the bot sends it, the ledger row says `sms`, a double send is flagged as a repeat, the event stream passes `validate:events`, the old fixtures still pass.

## Decision
Approved by the owner on 2026-11-26. Built: `contract/V1_4.md`, `packages/haunt/test/open-effect-kinds.test.ts`. Run end to end on the live engine with a manifest effect `kind: sms`: the events, the ledger and the arena column say `sms`.
