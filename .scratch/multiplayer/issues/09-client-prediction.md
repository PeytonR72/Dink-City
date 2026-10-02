# 09: Client prediction and reconciliation

Status: ready-for-agent
Blocked by: 08

Spec: `docs/MULTIPLAYER.md` Part 3, "Netcode model" and "Timelines on each client" (the Predicted timeline), and Phase 3 with its exit criterion; `CONTEXT.md`, **Predicted timeline**.

## Read first

- `CONTEXT.md` Online play, ADR-0004, `docs/MULTIPLAYER.md`.
- Issues 07–08 and their comments.
- Issue 01's `intentCodec.ts` doc comment: **step the prediction with `dequantizeIntent(quantizeIntent(i))`**, never the raw Intent.

## Goal

Online, the local Player moves the moment the key is pressed, even at 150 ms RTT. The client runs a Predicted timeline ahead of the Court and reconciles it on every Snapshot. This is Phase 3's exit criterion.

## Scope

**A pure predictor** (`src/net/prediction.ts`, so the harness can use it):
- Holds the last authoritative state (from a Snapshot), the client's un-acked quantized Intents, and a guess for the remote Player: repeat their last known `move`/`aim`, with no shot.
- On each Snapshot:
  - Re-simulate from `snap.state` through every un-acked Tick up to the client's current Tick (standard reconciliation).
  - Report how far the drawn local Player moved as a result (the correction).
- Each client Tick steps the prediction with the new Intent.
- Uses the real `rng` from the Snapshot, so even net cords predict exactly (Part 1 §6).

**`OnlineMatch`:**
- Draws the **predicted** state for now: local Player, ball and remote Player. Issue 11 moves the remote Player to the Interpolated timeline and blends the ball clock.
- Smooths small local-Player corrections over a few frames, as a presentation offset that decays. Large ones snap, e.g. across a Serve reset.
- **Events:**
  - Local `hit`, local-half `bounce` and net events play immediately from the prediction.
  - Outcome events (`dead`, `rally-won`, `game`, `match`, and the Fault banner) come only from the Court.
  - Nothing plays twice when the Court's copy arrives; key events by Tick and kind.
  - Issue 11 refines this. Write the rule down in the issue comment.

**Harness tests:**
- At 150 ms RTT with jitter and loss, each client's predicted local Player matches the Court's once inputs are acked, apart from float noise.
- Corrections stay under a small bound during steady movement.
- A lost packet causes a bounded correction, not a drift.
- The remote guess is replaced by the truth on reconcile.

## Acceptance

- The harness and unit tests are green, and all root checks pass. Offline play is unchanged.
- **Phase 3's exit:** movement feels local at 150 ms RTT, checked with DevTools throttling. The agent checks it in Playwright (CDP network emulation), and the user confirms by hand.
- Mark Phase 3 done in `docs/MULTIPLAYER.md`.
- Known, expected until issue 10: the Court still finds Contact itself (`auto`), so at high ping a predicted hit can be corrected. Note how often it happens.

## Out of scope

Reported Contact (10) and remote interpolation with the ball clock blend (11).

## Comments

### 2026-10-01: implemented

One commit, "Online play: client prediction and reconciliation" (the one that adds this comment).

**What was built:**
- **`src/net/prediction.ts`** (pure): `createPredictor({ local, start, tuning })`.
  - `stamp(tick, intent)` stores the Intent quantized as the Court will step it, and steps the prediction through that Tick at once. A skipped Tick fades as on the Court.
  - `reconcile(snap)` re-simulates from `snap.state` through every Tick stamped since, and returns the correction (how far the predicted local Player moved, on the ground plane) and the events to tell.
  - The remote Player steps with a guess: their last Intent, with no shot.
  - The Snapshot's `rng` comes along, so net cords predict exactly.
  - More than `MAX_PREDICT_TICKS = 60` ahead of its base, for example after a reload mid-Match, the prediction waits for a Snapshot.
- **`src/net/fade.ts`:** the missing-input fade (`DECAY_TICKS`, `fadeIntent`, `stillIntent`), moved out of `courtMatch` so the Court and the prediction fill a missing Tick alike. The Court's behavior is unchanged.
- **Protocol 5:** `snap` now carries `last`, both Sides' quantized Intents for the Tick before `state`. That's where "their last known `move`/`aim`" comes from; the client had no other way to learn the remote Player's Intent. It costs about 30 bytes per Snapshot.
- **`OnlineMatch`:**
  - Draws the prediction (`prev` at the last Tick stamped, `curr` a Tick on) on the input clock.
  - Passes the newest Snapshot as `live`, so the score comes only from the Court.
  - Smooths a correction as an offset on the local Player that fades at 20/s, to a tenth in about 7 frames.
  - Snaps a correction over `SNAP_DISTANCE = 1 m`, as across a Serve reset.
  - The Interpolated timeline's buffer is gone; issue 11 brings it back for the remote Player.
  - `main.ts` passes `simTuning`.

**The event rule (as asked):**
- **Told from the prediction the moment it's predicted:** the local Player's `hit`, a `bounce` on the local half, and `net`.
- **Told only from the Court, on arrival, with the Snapshot's state:** everything else. That covers the remote Player's hits, bounces on the remote half, and the outcomes (`dead` and the Fault banner, `rally-won`, `game`, `match`), which the Court already holds back 15 Ticks until they're final (issue 08).
- **No repeats:** events are keyed by Tick, kind and the hitter's Side. A Court copy of an event already told, or a re-simulation predicting it again, isn't told twice.
- **The gap, for issue 11:** an event whose Tick moves is a new key, so it plays again. That happens when a re-simulation shifts a predicted hit or bounce, or when the Court's copy lands on another Tick after a rewind. Issue 11 could match by kind within a few Ticks instead.
- **Another edge for issue 11:** a Court bounce's half is judged with the Snapshot's ends, so a bounce in the same Snapshot as an end switch could be misjudged.

**How often a predicted hit is corrected** (both Sides `auto` until issue 10). Harness, easy Bots, 60 s × 3 seeds:
- 150 ms RTT, 30 ms jitter, 5% loss: **0** of 76 local hits corrected.
- 300 ms RTT, 20% loss: **0** of 44.
- 150 ms with a 200 ms uplink stall every 2.5 s: **4** of 68 local hits were phantoms. They were predicted from a Snapshot the Court had stepped with fills before its rewind, and each true hit was heard as well.

**Tests:**
- **prediction.test.ts** (9):
  - stepping with the quantized Intent (a gamepad's 0.3);
  - Side 1;
  - the fade on a skipped Tick;
  - no correction when the Snapshot agrees;
  - a correction when the Court filled;
  - the guess, and the truth replacing it;
  - the 60-Tick wait;
  - the Court's events told once;
  - a whole Bot Match replayed 6 Ticks ahead and 6 late: all 76 local hits heard once, on their Tick, and every outcome heard once, only from the Court.
- **The harness:** each client now runs a predictor. It records where it first drew each Player, every correction, and everything it heard; the Court's positions and events are recorded too.
  - **Three seeds at 150 ms, 30 ms jitter, 5% loss:** the predicted local Player equals the Court's on every Tick checked, to within 1e-9 m. No correction is above 1e-9 m. Its own hits are heard exactly as the Court has them, with no event heard twice.
  - **Both Players walking about:** no corrections. The remote guess is wrong only within 25 Ticks of a turn (under 2 m), and is put right by each Snapshot.
  - **A 200 ms stall every 2.5 s:** corrections happen but stay under `SNAP_DISTANCE` (worst about 0.6 m). The prediction is off only in the second after each stall begins, and is exact again after it, so it never drifts.
- **onlineMatch.test.ts**, rewritten (13): it predicts with no Snapshot yet, draws on the input clock, scores from the Court, smooths a small correction, snaps a large one, and tells events once.
- courtMatch +1 (`last`, including after a rewind), protocol guards.
- **Totals:** 37 files and 354 tests (before: 36 and 343). Typecheck and build pass. The golden Bot result is unchanged.
- **e2e:** 19/19 on one worker. The handshake smoke passes 13/13.

**Phase 3's exit, in Playwright.** Two contexts on `wrangler dev` + Vite, with the real GPU (`--use-angle=d3d11`):
- **Measuring at 150 ms:** as in issue 07, DevTools/CDP throttling doesn't delay WebSocket frames. So each Court socket's sends and messages were delayed 75 ms by an in-page shim: RTT 160–166 ms, lead 6.1–6.5 Ticks.
- **Key-to-move:** holding D or A, the drawn local Player moved on the **first rendered frame** after the keydown in 20 of 20 presses. 17 of them were −6 to 23 ms. The 3 slower ones (64, 75 and 142 ms) were headless Chromium not rendering a frame in that time; each one moved on the first frame that came. Offline, the same probe gives −6 to 8 ms. Before this change, the drawn Player moved a round trip plus 100 ms late.
- **A full Quick Match** between easy Bots: the Host won 11–5 at Tick 5891 in about 100 s. Both screens had identical Rally endings, with no page errors.
  - Most Rallies ended on a double bounce. That's the playtest driver: its Bots see the Snapshot about 13 Ticks late. It isn't the prediction.
  - Driver note: give the Bot the Tick being stamped (`ceil(courtTick + lead)`, then +1 per call), and set it before Tick 40, or the first serve's Tick has passed.
- **Phase 3 is marked done in `docs/MULTIPLAYER.md`, pending the user's own check by hand at 150 ms.**

**Left for later:**
- **Event matching:** keyed by exact Tick (above).
- **A correction only partly the client's fault:** when the first Snapshot lands past every Tick stamped (Snapshots before the clock is known), the Court's own movement is counted as a correction. It snaps if large.
- **The remote guess** is the Intent the Court stepped. During the remote Player's packet gaps that's the fade, not their last real Intent. Arguably the more accurate guess.
