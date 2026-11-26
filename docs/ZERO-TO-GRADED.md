# From zero to graded: the pizza shop

One small service, start to finish, with the real commands and the real output. Everything here was run on this repository. Needs Node 20+ and `npm ci`.

## 1. Write the steps (one file)

`examples/pizza-shop/haunt.yaml`:

```yaml
name: pizza
label: Pizza Shop
idPrefix: piz
truth: http://127.0.0.1:7071
stages:
  - { use: read_request, label: Take the order }
  - { use: charge, id: pay }
  - { id: bake, label: Bake, role: work, duration: [800, 1500] }
  - { use: dispatch_job, id: deliver, label: Send the rider }
  - { use: notify, id: tell_customer }
```

Four stages come from the block library ([`BLOCKS.md`](BLOCKS.md)); `bake` is written inline. No code.

## 2. Ask for a quick grade (no bot yet)

This is the model-based what-if. In Kiro it is the tool `haunt_lab`; the result below came from `haunt_lab` and `haunt_chain` called on that file.

| Protections | Grade | Attacks that did not end clean |
|---|---|---|
| none (a Rookie) | **F** | 29 of 29 |
| all five (a Phoenix) | **A** | 0 of 29 |

Who is to blame at Rookie level (failed attacks per stage): `pay` 7, `deliver` 7, `tell_customer` 7, `read_request` 5, `bake` 3.

The what-if also says which protections would fix it: Retry, Idempotency keys, Offline queue and Journal. And one warning that stays even at Phoenix: `loose_effect`, meaning an effect's manifest entry does not require an idempotency key. The bot, not the file, decides whether it sends one.

The same test is a page: open the Chain Wizard (`/chain.html`), paste the file, flip the five switches and watch the grade go from F to A.

## 3. Get a bot to attack

```
npm run bot:new -- examples/pizza-shop/haunt.yaml
```

```
wrote examples/pizza-shop/bot/bot.mjs (5 stages: read_request, pay, bake, deliver, tell_customer)
run it:  npm run own-bot -- examples/pizza-shop/bot/bot.mjs --app examples/pizza-shop
It is naive on purpose. Chaos will break it; the HARDEN comments say where each fix goes.
```

The bot uses your own stage ids and calls the fake provider for each effect. It has no retry, no key and no journal. A `HARDEN` comment sits at each effect.

## 4. Run it in the arena

```
npm run own-bot -- examples/pizza-shop/bot/bot.mjs --app examples/pizza-shop
```

The arena opens on Pizza Shop with its five stages. Start a wave. On a clean wave (3 orders on a lane) the ledger read:

```
charge   3 rows, 0 repeats
dispatch 3 rows, 0 repeats
notify   3 rows, 0 repeats
```

Now press creatures, or drag INTENSITY up, or start a tournament. A crash right after `pay` makes the naive bot charge again. The provider's ledger shows the second row, and the repeat is counted against the bot.

## 5. Harden it, run again

Open `examples/pizza-shop/bot/bot.mjs`. At each `HARDEN` comment, add what it says: a stable idempotency key per effect (for example `<order>:charge:1`), a retry with backoff, a journal of finished stages. Run step 4 again and press the same crash. A bot with a key on the charge should show one row, not two: the ledger tells you.

## 6. Keep what you built

- A stage you wrote inline can become a block: `npm run block:add -- examples/pizza-shop/haunt.yaml bake`, or **Save as block** in the Chain Wizard.
- A chain can be sent to the live arena from the wizard with **Run in the arena**.

What is model-based and what is real: step 2 is a model (rules over the protections). Steps 3 to 5 are real processes against a fake provider, and the ledger decides.
