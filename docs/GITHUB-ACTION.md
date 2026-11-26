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

## What it is, and what it is not

- It is the same model as the Chain Wizard and the Workflow Lab: your chain's stages against the attack list, with the protections you claim.
- It does **not** run your code. A claim of `phoenix` is believed. To test the real bot, run `npm run own-bot -- <bot> --app <folder>` and watch the arena, or `npm run haunt -- sweep --config <haunt.yaml>` (runs your `start` line against the attacks; needs the tool cloned and `npm run build:bots`).
