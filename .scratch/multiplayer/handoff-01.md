# Handoff: starting online multiplayer, issue 01 (client groundwork)

Written 2026-09-29 at the end of the session that audited the codebase for online play and wrote the plan. The ticket is `.scratch/multiplayer/issues/01-client-groundwork.md`. This file is the context the ticket doesn't have.

## Read first, in this order

1. `CONTEXT.md`: the glossary, including the new **Online play** section (Court, Lobby, Host, Guest, Preset, Snapshot, Predicted and Interpolated timeline, Reported Contact, Rewind window, Takeover Bot). Use these terms in code, tests and UI.
2. `docs/adr/0001`–`0004`. ADR-0001 (pure, fixed-tick Sim), ADR-0003 (Bots produce Intents only) and **ADR-0004 (online play)** govern this work.
3. `docs/MULTIPLAYER.md`: the audit (Part 1), the PokerElo comparison (Part 2), the design (Part 3) and the phases (Part 4). **Its decisions are settled; don't reopen them.** This issue is Phase 1.
4. `.scratch/v1/handoff-03.md`, "Conventions and gotchas". It still applies (coordinates, Ends, local-frame Intents, `step` purity, Contact, the golden test, `window.dink`).

## State of the repo

- Branch `main`, clean at `4126498`, except for the Phase 0 docs, which are **not committed**:
  - `docs/MULTIPLAYER.md` (new)
  - `docs/adr/0004-online-play.md` (new)
  - `CONTEXT.md` (the Online play section, plus two small edits)
  - `.scratch/multiplayer/` (this file and issue 01)

  **Ask the user** whether to commit them as their own "Phase 0" commit before you start.
- **Vercel deploys `main` to production on every push** (https://dink-city.vercel.app). **Never push without asking.**
- Tests at the start: 18 Vitest files and 167 tests, all passing (`npm test`, about 20 s; the Bot-vs-Bot Games are the slow part). There are two Playwright files (`npm run e2e`) with reference screenshots and a perf budget. They start their own dev server on port 5174 and use SwiftShader.
- The golden Bot result is `{ points: [11, 13], tick: 39353 }` (`test/bot.test.ts:110`). Issue 01 must not move it.
- Tooling: TypeScript 7 (`typescript@^7`, strict, `noUnusedLocals`/`noUnusedParameters`), Vite 8 (no config file), Vitest 5, Playwright. `tsconfig.json` includes `src`, `test`, `e2e`.

## What the audit found (the parts that matter for 01)

- **The Sim is already clean.** `SimState` is plain JSON-safe data. `step` is `structuredClone` plus mutation. All randomness comes from `state.rng`. `test/sim.test.ts` forbids three.js, imports from outside the Sim, and wall-clock or random calls inside `src/sim/`. Nothing in `render/`, `hud/`, `debug/` or `practice/` writes Sim state.
- **Everything online-hostile is in `src/main.ts`:**
  - the rAF loop with a `MAX_FRAME = 0.25` cap
  - `acc += dt * gameSpeed`
  - hit-stop, which skips stepping for 40 ms
  - the Fault Replay, which pauses the Match, followed by `skipDeadPause`, which fast-forwards the dead phase
  - rematch on a shot press after `over`, seeded with `Date.now()`
  - Practice's `newRep`, which replaces the state at each Serve

  Slice 2 moves all of it, unchanged, behind `LocalMatch`. Online, Phase 5 turns off Replays and hit-stop and fixes Game speed at 1; that's not your job now.
- **Local Side 0 is hard-coded** in `renderer.ts:33` and `main.ts:25` (see the issue for every use). `Hud` already takes `local`.
- **Bots live in a closure** (`createBot`), so they can't be cloned or rewound. That's why the Takeover Bot needs `autoContact`: its Contact is recomputed during a rewind, while its move, aim and shot are replayed from a log (ADR-0004). In 01 you only build the query.
- **Contact today** (`checkContact`, `step.ts:153`): a committed Player hits when the ball is closest to the sweet spot, or on the last Tick before it leaves reach. `commit.bestDistance` tracks the closest distance so far. A `reported` Side must keep that bookkeeping identical, or the bit-identical test fails.
- **JSON and `-0`:** `JSON.stringify(-0)` is `"0"`. Every `Math.sign` use in the Sim guards against zero or treats it the same way, so it should be harmless. The snapshot test proves it either way.
- **Cross-engine floats:** `Math.hypot` isn't guaranteed bit-identical across browser engines. That's why reported Contact has a small reach slack. Tests run in Node (V8), so they'll be exact.

## Conventions and gotchas specific to 01

- **Why the `contact` and `contactMode` fields are optional:** so no Intent literal, `MatchConfig` literal or `DEFAULT_MATCH` has to change. Absent means today's behavior.
- **`autoContact` implementation:** implement it by running `step` on a copy with that Side forced to `auto`. Don't write a second copy of the Contact rule; two copies would drift apart.
- **Quantized Intents:** an online client must step its prediction with `dequantizeIntent(quantizeIntent(i))`, not the raw gamepad Intent, or it will diverge from the Court. Offline play keeps raw Intents. Put this in the codec's doc comment.
- **`src/net/` will be bundled into a Cloudflare Worker in Phase 2.** Keep it free of the DOM and three.js, and import only from `../sim`. Take `simTuning` as a parameter; don't import `src/tuning.ts` inside `src/net/`.
- **The `main.ts` refactor:** e2e depends on `window.dink` and on exact frame behavior (`frames(n, dt)` runs `update` just as rAF would). Keep `update(dt)` as the single per-frame entry point, and have the driver do the work inside it.
- **Comment style:** match the existing code. Short `/** */` doc comments on exports, glossary capitalization (Tick, Side, Rally, Commit, Contact), no banner comments.
- **Commit trailer:** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit subjects in this repo look like "Practice: free play rallies with a gentle easy Bot, Soft shots only". Use one commit per slice.

## Useful commands

- `npm run typecheck`, `npx vitest run test/<file>` while working, then `npm test`, `npm run e2e` and `npm run build` at the end.
- To run a Match in the browser: `npm run dev`, then `http://localhost:5173/?play&venue=park`. Add `?debug` for the Tuning panel. `?practice` starts Practice.
- To drive Side 0 with a Bot in the page (to force Faults, Smashes and a Match end):
  ```js
  const {createBot, DIFFICULTY} = await import('/src/bot/bot.ts');
  const {observe} = await import('/src/bot/observe.ts');
  const bot = createBot(0, 1, DIFFICULTY.hard, dink.simTuning);
  dink.advance(3000, s => bot.think(observe(s, 0)));
  ```
  `dink.frames(n)` runs whole frames (Replays and hit-stop included). Use it to check that the Replay still plays after a Fault.

## Looking ahead (don't build yet)

- **Phase 2** adds `party/`: a Worker, a `Court` DO per Match, and a singleton `Lobby` DO with the public Court list. It follows PokerElo at `C:\Users\ztwis\Desktop\poker elo\party\` (`matchRoom.ts`, `lobby.ts`, `liveMatches.ts`, `wrangler.jsonc`).
  - One deliberate difference: internal Court→Lobby reports and provisioning use **DO RPC**, not `onRequest`, because partyserver routes public HTTP to `onRequest`.
  - The user will have a separate issue written for it after reviewing 01.
- Phase 2's `OnlineMatch` driver plugs into the seam you build in slice 2. Its frames come from Snapshots, the local Side can be 1, and it has no Replay and no hit-stop.

## Working with this user

- They gate each phase: plan, then approval, then implementation, and they say "stop and wait" explicitly. Finish 01, report, and **don't start Phase 2**.
- They want concise reports: what changed, test results, and anything that deviated from the issue, with reasons.
- They playtest by hand and confirm ("testing results are clean"). Give them a short checklist with URL flags.
- Ask before pushing, before re-accepting screenshots, and before anything outside the issue's scope.

## When done

- Append a `## Comments` entry to the issue: the commits, what each slice did, test counts, whether the golden result held, and any deviations.
- Mark Phase 1 done in `docs/MULTIPLAYER.md`.
- Give the user a playtest checklist:
  - `?play&venue=park` for a full Match, then press a shot button for a rematch
  - a Fault, to see the Replay
  - a hard Drive or Smash, for hit-stop
  - `?practice`
  - Esc back to the map, then start again
- Then stop and wait.
