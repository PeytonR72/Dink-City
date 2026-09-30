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
