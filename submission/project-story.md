## Inspiration

I'm a principal automation engineer. My whole career comes down to a few beliefs: log everything, handle exceptions on purpose, put a human in the loop when a workflow can't decide, and test until it hurts. I've even built my own human-in-the-loop platform to catch exceptions and steer workflows when they go sideways.

Lately the ground has shifted. Companies are ramping up on Claude, Kiro, agents and skills, and I'm seeing people push things to production faster than I've ever seen. Speed is great. But automations and agents built that fast get far less stress testing, and they fail in ugly ways: a server dies mid-job, a call times out, the bot retries and charges a customer twice. Nobody sees it until it hurts.

One idea has lived in the back of my head for a long time: a chaos-engineering-style way to attack your own processes from the inside. Not a heavy tool. A skeleton you can bolt onto any project, swap apps in and out, and break your own standing environment in a fun way. Then take the data from every failure and feed it to AI, so it writes spec-driven fixes and patches for me to review.

Kiroween was the excuse to finally build it. Chaos engineering has done this for servers for years. I wanted it for bots and AI agents, and I wanted it to be a visual game, a haunted house overlay, so the ideas I'd been carrying around could actually be seen. Break it for fun, learn from it for real.

## What it does

**Kiroween Chaos is chaos engineering for AI agents, played as a haunted house.**

Here is the idea. Every automation and every agent is a worker doing a job: take an order, answer a ticket, move data from one system to another. Chaos engineering asks a simple question about that worker: what happens when something goes wrong in the middle of the job? So you run the worker through a real job, you throw wrenches at it on purpose, and you watch what it does. Does it recover? Does it finish? Does it do the job twice? Does it tell anyone?

Kiroween Chaos wraps that whole loop in a game. You see a haunted house up front. Behind it, a real test is running. A fake but honest system of record keeps score of what the worker actually did, not what it claims it did. Every run produces real data about how your process behaves under pressure.

The wrenches are the fun part. They show up as ghosts, zombies, grim reapers, curses and bosses. A ghost might make a call vanish. A reaper might kill the worker in the middle of a task. A curse might slow everything down or hand back a bad answer. Under the costume it is real fault injection: crashes, timeouts, errors, duplicates, expired logins and bad data.

The workers get rated and graded on how they perform. You can play it as a tournament, where several workers run the same gauntlet side by side and the weakest get knocked out. You can play it as a campaign, where you earn credits and buy better parts for your worker. Or you can just leave it running.

That is the point. **It is a game you can actually play, and it is doing real work in the background.** Put it on a monitor in the TechOps room. Let people joke about the ghosts. Meanwhile it is quietly collecting honest data about where your automations break, and it turns each failure into a written case with a suggested fix. A person reviews those fixes. Nothing is ever applied on its own.

There is also a mode that points the chaos at your own staging service, behind guard rails and a kill switch.

## Skeleton Crew: one skeleton, three apps

The skeleton is the test harness: an event contract, a runner, a fake provider with its own ledger, a scoring engine, and the arena UI. An app is just a process definition plus a bot.

We prove it with three apps from the same foundation, two of them very different:

1. **Orders**, written in **Node/TypeScript**: an 11-stage order pipeline.
2. **Ticket Desk**, written in **Python** (standard library only): an 11-stage support flow: login, ingest, validate, dedupe, triage, assign, SLA clock, notify, escalate, resolve and close.
3. **Stream**, written in **Node/TypeScript**: a 5-stage video pipeline (ingest, transcode, publish, notify, archive) on the same harness.

Same harness. Same creatures. Two languages. Three different jobs.

## How we built it (with Kiro)

Kiro is how this got built, not just where we typed.

- **Specs first.** Twenty-four specs live in `.kiro/specs/`, each with requirements, a design and a task list. Every feature started as a spec, then became tasks, then code. There are over 240 ticked tasks.
- **Steering files** keep every session on the same page: tech choices, the event contract, art direction and product intent.
- **Agent hooks** automate the boring checks: regenerating the traceability table when specs or tests change, running the crash-point property test when the SDK changes, and validating the event fixtures against the contract schema when a contract file is saved. They report on save; they do not block anything.
- **Custom agents** do focused jobs, like the reviewer that reads a run and drafts fix specs.
- **Kiro Crew** is where most of the build happened. It let us run many agents in parallel on separate lanes (core engine, visuals, docs), each on its own branch. The agents behind it ran on Claude Max, which we paid for ourselves. We applied for the Kiro credits and went through ID verification for weeks, and nobody followed up with us, so we funded the build on our own.
- **A Kiro Power and a Kiro Crew app** ship in the repo, so you can stress-test your own workflow from inside Kiro.

The whole thing is checked by over 1,700 automated tests, including property-based tests that crash the bot at every possible point.

## Challenges we ran into

- **Making chaos fair and repeatable.** Random breakage is useless for a game or a benchmark. Everything runs from a seed, so the same run plays out the same way every time.
- **Telling the truth.** The score has to come from what actually happened, not from what the bot says happened. That meant a separate ledger the bot can't touch.
- **A contract between two languages.** Node and Python both speak one event contract. We wrote a validator that checks live runs against it, and drove violations to zero.
- **Races.** Waves that ended too early, travel gaps, replays after a crash. We found and fixed these by watching real runs in a browser.
- **Keeping parallel agents from colliding.** Many agents, one repo: we learned the hard way to keep lanes separate and merge in order.

## Accomplishments that we're proud of

- A real crash test: real process kills, with replay and reconcile, not a simulation of failure.
- Three apps in two languages passing the same contract validator.
- A game that is actually fun to watch, with creatures, bosses and a tournament, on top of a serious engineering idea.
- A hardening loop that suggests fixes without ever changing your code by itself.

## What we learned

Spec-driven work with Kiro kept a big, fast project coherent. The spec was the memory. When agents worked in parallel, the contract and the steering files were what kept them from drifting. Failure is easier to understand when you can see it, so making it a game made the lessons stick.

## What's next

- More packs: ticketing and streaming are in, and more domains are easy to add with a pack file.
- Run it against real agents and real staging systems, with the guard rails we built.
- A shared Casebook so teams can compare failures.

## Try it

Open the hosted build, no install: https://kakoritz.github.io/Kiroween-Chaos-Official/ (the tournament, Casebook and improve loop replay recorded runs of the real engine, and a banner says so). Or run the real engine locally with `npm ci` then `npm run demo`, and watch your bot get haunted. New here? Read `docs/START-HERE.md`.
