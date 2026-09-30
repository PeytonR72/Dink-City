# 01: Client groundwork for online play (no networking)

Status: ready-for-agent
Blocked by: none. Phase 0 (ADR-0004, the glossary and the plan) is written.

Spec: `docs/MULTIPLAYER.md` (Phase 1 in Part 4, and the design in Part 3) and `docs/adr/0004-online-play.md`. Read `.scratch/multiplayer/handoff-01.md` first.

## Goal

Prepare the client and the Sim so Phase 2 can add a server without touching gameplay code again. **Nothing visible changes and nothing is networked.** Offline Matches and Practice mode behave exactly as they do now. The golden Bot result in `test/bot.test.ts` (`{ points: [11, 13], tick: 39353 }`) must not move.

## Scope

Four slices. Land them as separate commits, in this order.

### 1. The local Side is a parameter, not a constant

The code assumes the local Player is Side 0. Online, the Guest plays Side 1.

- `src/render/renderer.ts:33` `const LOCAL_SIDE = 0` drives the world mirroring, the commit ring, the camera follow and the landing marker (`other(LOCAL_SIDE)`). Replace it with a value set through the constructor or a setter (for example, `renderer.setLocalSide(side)`), defaulting to 0.
- `src/main.ts:25` `const LOCAL = 0` is used for `renderer.setColors`, `new Hud(…, LOCAL)`, `playEvents(…, endOf(curr, LOCAL))`, `onMatchWon`, and the Practice Replay filter. Route all of them through the driver's local Side (slice 2).
- `Hud` already takes `local` in its constructor. Add a setter if the driver needs to change it per Match.
- Pull the local-view math (whether to mirror, the camera's follow x, which Side gets the ring and landing marker) into a small pure function. Unit test it with the local Player on Side 1 at both Ends.
- **Leave these alone:** `src/debug/overlays.ts:66` reads `sides[1]` because that's the offline Bot, and `showVenue` colors Side 1 as the Venue's Bot. Both stay offline-only for now; add a one-line comment saying so.

### 2. A match-driver seam in `main.ts`

- Move the live-Match loop body behind a `LocalMatch` driver (for example, `src/match/local.ts`). That covers:
  - `tick()`, `update()`'s match branch, and the accumulator
  - hit-stop and `gameSpeed`
  - the Fault Replay (`playReplay`, `endReplay`, `skipDeadPause`)
  - rally recording, rematch on a shot press after `over`, and Practice reps
- The driver's per-frame output gives the renderer, Hud and audio what they need: `prev`, `curr`, `alpha` and the new events, plus Replay state.
- Phase 2 adds an `OnlineMatch` with the same frame shape, which will have no Replay and no hit-stop. Design the interface so that's possible, but **don't build `OnlineMatch`**.
- `main.ts` keeps modes, menus, Venue loading, saves and progress, and picks the driver.
- **`window.dink` must keep its whole API and behavior.** The e2e tests and playtests use `state`, `rally`, `replay`, `mode`, `venue`, `eventLog`, `newMatch`, `playVenue`, `startPractice`, `practice`, `progress`, `stats`, `mapStats`, `advance(ticks, drive?)` and `frames(n, dt?)`.
- This is a behavior-preserving refactor. Don't change any timing, event ordering or Replay behavior.

### 3. Sim hook: Reported Contact

This follows ADR-0004 and `docs/MULTIPLAYER.md` Part 3, "Hitter-reported hits".

- **`Intent.contact?: boolean`** (optional, so every existing Intent literal still compiles). In `src/sim/types.ts`, document it as "this Tick is the Player's Contact (online, `reported` Sides only)".
- **`MatchConfig.contactMode?: [ContactMode, ContactMode]`**, with `type ContactMode = 'auto' | 'reported'`. If it's absent, both Sides are `auto`. Keep `DEFAULT_MATCH` and the config literals in `test/rules.test.ts` unchanged.
- **In `checkContact` (`src/sim/step.ts:153`):** a `reported` Side does the same bookkeeping as `auto` (`commit.bestDistance` updates, resets and eligibility checks), so its Commit state stays bit-identical. The only difference is when a hit fires:
  - `auto`: exactly today's rule, the closest point to the sweet spot or the last Tick in reach.
  - `reported`: only when `intents[i].contact` is true, the Player has a Commit, the ball is eligible (not the Player's own last hit, on their End, at most one bounce), and the ball is within reach, allowing a small slack for cross-engine float drift (a documented constant, about 5 cm). If it's within the slack but outside the oval, use `distance = 1` (the edge of reach).
  - Everything after the decision (`hit()`, Aim error from `rng`, the two-bounce and Kitchen faults) is shared code and unchanged.
  - `contact` on a Side in `auto` mode is ignored.
- **A read-only query for the Takeover Bot adapter:** `autoContact(s, intents, side, t): boolean`, meaning "would the `auto` rule make `side` hit on this step with these Intents?" Implement it in the most obviously correct way: run `step` on a copy of the config with that Side forced to `auto`, and look for that Side's `hit` event. Export it from `src/sim/index.ts`. It must stay pure, and it's allowed to be slower.
- **Tests** (a new `test/contact.test.ts`):
  - **Bit-identical:** play a seeded Bot-vs-Bot Game (as the golden test does) twice. The first run is all `auto`. The second run has both Sides `reported`, with each Tick's Intents getting `contact = autoContact(prev, intents, side)`. Every Tick's state must be deep-equal, apart from `match.config.contactMode`.
  - **A false report is ignored:** `contact: true` with the ball out of reach, on the Player's own last hit, on the wrong End, or with no Commit produces no hit, and the Rally goes on.
  - **A reported Side never hits without `contact`**, even on the Tick `auto` would have hit. The ball flies past, and the usual `double-bounce` ends the Rally.
  - **The slack:** a report just outside the oval, within the slack, hits at `distance = 1`. Beyond the slack, it doesn't hit.
  - The golden result and `replays exactly from its recorded Intents` still pass untouched.

### 4. `src/net/`: shared, pure helpers for the client and the future server

The future Worker (`party/`) will import this folder, so it must be pure: no DOM, no three.js, no `Math.random`/`Date.now`/`performance.now`, and imports only from `../sim` (and its own files). Add a boundary test like the Sim's in `test/sim.test.ts`.

- **`intentCodec.ts`:** `quantizeIntent(i) → QIntent` and `dequantizeIntent(q) → Intent`.
  - `move` and `aim` components become int8 via `Math.round(clamp(v, -1, 1) * 127)`.
  - `shot` becomes 0–3, and `contact` becomes a flag.
  - Pick a compact, JSON-friendly shape, such as a 5-number tuple. **Document** that an online client must step its own prediction with `dequantizeIntent(quantizeIntent(i))`, so its prediction and the Court's result match. Gamepad values aren't exact in int8.
  - Tests: keyboard values (-1, 0, 1) round-trip exactly; `quantize ∘ dequantize` is the identity on `QIntent`; every shot value and `contact` round-trip.
- **`snapshot.ts`:** `encodeState(s): string` and `decodeState(raw): SimState` (JSON).
  - Test: across a whole seeded Bot-vs-Bot Game, `step(decodeState(encodeState(s)), …)` equals `step(s, …)` every Tick.
  - Test: add a case with `-0` in a position or velocity. JSON turns `-0` into `0`, and the test shows the next step is still identical. If it isn't, normalize `-0` in `encodeState` and say so in the issue comment.
- **`simHash.ts`:** `simHash(tuning: SimTuning): string`, a synchronous 32-bit FNV-1a over canonical JSON (sorted keys, recursively) plus a `SIM_VERSION` constant exported from `src/net/`.
  - Tests: the hash is stable across key order, changes when any nested value changes, and changes with `SIM_VERSION`.
  - Add a comment in `src/tuning.ts` saying that online Matches use the build's `simTuning` and that live `?debug` edits break the hash on purpose.
- **`presets.ts`:** `PRESETS` with `quick`, `standard` and `long`, each giving a label and a `MatchConfig`:
  - `quick`: 1 Game to 11, win by 2, Rally scoring.
  - `standard`: the same with Side-out scoring. This is the default.
  - `long`: best of 3, Side-out scoring.
  - Add a type guard `isPresetId`.
  - Test that each preset maps to the right config.
- **`name.ts`:** `validateDisplayName(raw: unknown): { ok: true; name: string } | { ok: false; reason: 'empty' | 'too-long' | 'charset' }`.
  - Normalize to NFC, trim, and collapse runs of whitespace to one space.
  - Allow 1–16 characters, counted in code points (`[...s].length`), matching `/^[\p{L}\p{N} \-_.']+$/u`.
  - Tests cover:
    - "  Ana  Lee " → "Ana Lee"
    - accented names in both NFC and NFD
    - "李小龍"
    - rejecting an empty string, 17 characters, an emoji, a control character, `<script>`, and non-strings

## Acceptance

- The four slices above are done as separate commits (trailer as in the handoff).
- `npm run typecheck`, `npm test`, `npm run e2e` and `npm run build` pass. The e2e reference screenshots have **not** been re-accepted; they should match without it.
- The golden Bot result is unchanged. If anything moves it, stop and report it, because it means the refactor changed behavior.
- Offline playtest (the agent does this through `window.dink`/the browser, and the user confirms):
  - a Match at `?play&venue=park`
  - a Fault Replay
  - hit-stop on a Smash
  - rematch after the Match ends
  - Practice (`?practice`)
  - returning to the map
- `CONTEXT.md`: the **Intent** entry mentions the optional `contact` flag (online only), linking to Reported Contact.
- `docs/MULTIPLAYER.md`: mark Phase 1 done and note any deviation from this issue.

## Out of scope

- Anything in `party/`, WebSockets, `src/net/protocol.ts`, the Lobby, or the menu's Online panel. That's Phase 2 and gets its own issue after the user reviews this one.
- Prediction, rewind, the Takeover Bot itself (only its `autoContact` query is in scope), and any change to online presentation.
- Renaming `src/sim/court.ts`. Its name collides with "Court" (the online room); that's noted in the plan and left for the user to decide.

## Comments
