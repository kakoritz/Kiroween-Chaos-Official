# Grade your own app in GitHub Actions

Copy `docs/github-action/haunt-chaos.yml` to `.github/workflows/haunt-chaos.yml` in your repo.
It needs a `haunt.yaml` in your repo (see [INTEGRATE.md](INTEGRATE.md)). Set three values at the top:

| Value | Meaning |
|---|---|
| `HAUNT_YAML` | where your manifest is |
| `TIER` | protections your bot claims: `rookie`, `retrier`, `journaler`, `reconciler`, `phoenix` |
| `MIN_GRADE` | `A` to `D`; the job fails below it |

Every run uploads `chaos-report.html` (one page: grade, who failed, your chain) and `chaos-badge.svg` as the `chaos-report` artifact.

## Same check on your own machine

```
npm run chain:grade -- examples/pizza-shop/haunt.yaml --min B
```

Real output for the pizza shop example: grade F with `rookie` (29 of 29 attacks did not end clean), exit 1.
With `--tier phoenix --min A`: grade A, exit 0.

## Job 2: your real bot

The second job runs your own bot on every stage against 22 creatures. It needs this in your `haunt.yaml`:

```yaml
adapter: process
start: node bot/bot.mjs   # any command; relative to the folder of haunt.yaml
```

`npm run bot:new -- haunt.yaml` writes such a bot. Set `BUILD_BOT` if your bot needs a build first.
It fails when the grade is below `MIN_GRADE` (`--min-grade`).

Real output, the pizza shop's naive bot (`examples/pizza-shop`, 2 orders, 87 seconds):

```
grade D (reliability 68.42105263157895), seed 1, tier rookie
```

Six creatures failed it on every stage: banshee, gargoyle, ghost, goblin, imp and zombie. That is the first thing to harden.
Check it on your machine first:

```
npm run haunt -- sweep --config examples/pizza-shop/haunt.yaml --tier rookie --orders 2 --speed 8 --min-grade C
```

## What it is, and what it is not

- It is the same model as the Chain Wizard and the Workflow Lab: your chain's stages against the attack list, with the protections you claim.
- Job 1 does **not** run your code. A claim of `phoenix` is believed.
- Job 2 runs your code, but each cell is two orders at speed 8: a short, strict check, not a long soak. Watch the arena (`npm run own-bot -- <bot> --app <folder>`) for the full show.
