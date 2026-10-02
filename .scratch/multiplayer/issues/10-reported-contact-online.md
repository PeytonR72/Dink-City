# 10: Reported Contact online: the hitter's client calls the hit, and the Court checks it

Status: ready-for-agent
Blocked by: 09

Spec: `docs/MULTIPLAYER.md` Part 3, "Hitter-reported hits (Reported Contact)", and Phase 4; ADR-0004 ("Reported Contact"); `CONTEXT.md`, **Reported Contact**.

## Read first

- `CONTEXT.md` Online play, ADR-0004, `docs/MULTIPLAYER.md`.
- Issue 01's slice 3: `contactMode`, `Intent.contact`, `REACH_SLACK` and `autoContact` in `src/sim/step.ts`, and `test/contact.test.ts`.
- Issues 08–09 and their comments (rewind and prediction).

## Goal

At any latency, the hit the hitter sees is the hit the Court confirms, with no round trip in between.

## Scope

**Court:**
- A Match starts with `contactMode: ['reported', 'reported']`, e.g. `{ ...PRESETS[id].config, contactMode }`.
- The config never changes mid-Match (ADR-0004).

**Client** (in the predictor from 09):
- Each Tick, set the local Intent's `contact` to `autoContact(predicted, intents, local, simTuning)`. The prediction runs the same rule the Court's Sim would in `auto`.
- Then quantize the Intent (`contact` is a flag in `QIntent`), step the prediction with it, and send it.
- The prediction and the Court then agree on the hit Tick.

**Court validation:**
- It comes free from the Sim: a `reported` hit only fires if the Player has a Commit, the ball is eligible and within reach plus `REACH_SLACK`.
- The Court's only extra job is timing. A hit report within the Rewind window rewinds and re-simulates (issue 08). One past the window is dropped, the ball flies on, and the client is corrected on the next Snapshot.
- A missing Intent never carries `contact` (issue 07's policy).

**Client correction:**
- When the Court rejects a predicted hit (the Snapshot shows no hit), the reconcile corrects it once, with no ghost swing sound repeating. Issue 11 polishes how it looks.

**Harness tests:**
- A hit report arriving late but inside the window is accepted, and the result equals an on-time report.
- One past the window is rejected, and the ball flies on.
- A forged out-of-reach report (a modified client) is rejected.
- A forged `contact` without a Commit, and one on the Player's own last hit, are rejected.
- Both clients converge to the Court's state after every hit.
- At 150 ms RTT, predicted hits match the Court's in a Bot-vs-Bot online Match. Count mismatches; expect zero or near zero, and explain any.

## Acceptance

- The tests are green, and all root checks pass.
- Offline play is unchanged: still `auto`, and the golden result holds.
- In a two-window Match at 150 ms (throttled), the hitter's swing and the ball's launch are never corrected in normal play. The agent checks this, and the user confirms by feel.

## Out of scope

The remote Player's presentation and the ball clock blend (11).

## Comments

### 2026-10-02: implemented

One commit, "Online play: Reported Contact" (the one that adds this comment).

**What was built:**
- **`onlineConfig(preset)`** in `src/net/presets.ts`: the Preset's rules with `contactMode: ['reported', 'reported']`. The Court, the client (`main.ts`), the harness and the smoke all start from it. `PRESETS` and offline play are unchanged (`auto`).
- **The predictor calls the hit.** `stamp(tick, intent)` now returns `{ intent, told }`:
  - It first steps up to `tick`, fading any Ticks skipped.
  - It quantizes the Intent and sets `contact` if `autoContact` on the predicted state says the local Player hits on that Tick.
  - Then it stores and steps the prediction with that Intent. `OnlineMatch`, the harness and the smoke send the returned Intent.
  - A `contact` in the sampled input is never passed on; only the prediction calls hits.
  - While the prediction waits for a Snapshot (more than `MAX_PREDICT_TICKS` ahead), it calls no hits.
  - The probe step is skipped for a Player with no Commit and no press, which is `checkContact`'s own precondition.
- **The remote guess calls its hits the same way** (my choice; the issue didn't say). Otherwise, in `reported` mode the prediction would never hit for the remote Player, and their hits would always be corrected late, worse than issue 09's `auto`.
- **The Court:** no logic change. The Sim already validates a report, and a late one rides the Rewind window like any Intent. A filled Tick has no `contact` (`fadeIntent`/`stillIntent`).
- **A rejected hit:** the re-simulation keeps the stamped `contact`, but a `reported` hit fires only on the Tick reported. So once the Snapshot is past that Tick, nothing can hit again. The swing was heard once from the prediction and never repeats (keys by Tick, kind and Side, as in 09).
- **Smoke `--match`:** its Bot clients run a predictor and send what it stamps, as `OnlineMatch` does. Without that, Bots never hit under `reported`.

**Tests** (37 files, 370 tests; before: 354). Typecheck and build pass. The golden Bot result is unchanged.
- **courtMatch** (+6). These replay one on-time Bot Match (hard Bots calling hits by `auto`), with Side 0's Intents late or forged around its first Rally hit:
  - a hit reported exactly `REWIND_TICKS` late is accepted, and the state equals the on-time run's;
  - one Tick later it's dropped: the ball flies on, and no Side 0 hit is ever told;
  - a forged report on every Tick (Committed at once) is refused on every Tick the ball is out of reach plus `REACH_SLACK`. The hit it does get is in reach;
  - a forged report with no Commit is refused all Rally;
  - a forged press and report after the Player's own hit changes nothing until Side 1 hits back.
  - The two existing Bot Match tests now report Contact. Under `reported` they had passed with no Rally hits at all.
  - These tests run on the pure Court rather than the network harness, because exact late and forged timing is easier to set up there. The harness covers the networked path (below).
- **prediction** (+4): Contact is reported on exactly the Court's hit Ticks for a whole Match, for each Side; nothing is reported when there's nothing to hit; the remote guess hits on the Court's Tick; a rejected hit is corrected once, with no swing heard again.
- **The harness** (+4):
  - **At 150 ms, 30 ms jitter and 5% loss, three seeds of 60 s:** every hit a client reported, the Court made, on that Tick. That's zero mismatches.
    - Each client's ball, as first drawn, equals the Court's on every Rally Tick, except within 30 Ticks of a remote hit, which is guessed.
    - The remote guess is sometimes a Tick early, when the remote Player's real movement changed. For example, seed 2 guessed a smash at 2278 that the Court had at 2279.
  - **A 300 ms uplink stall every 2.5 s:** reports held past the window really are dropped (5 in seed 1). No Court hit goes unreported, and no event is heard twice.
- **onlineMatch** (+1): the hit the prediction calls goes on the wire.
- **The net boundary test:** fine. I had to reword a comment that said "window".

**Live checks:**
- **e2e:** 19/19 on one worker.
- **Handshake smoke:** 13/13.
- **Smoke `--match`:** Side 1 won 9–11 at Tick 9349, 4183 Snapshots, 156 s, round trip 1.6 ms, lead 1.10 Ticks.

**Two windows at ~150 ms** (Playwright, real GPU, a 75 ms each-way WebSocket shim as in 07/09; RTT 165–168 ms, lead 6.0–6.3 Ticks):
- A full Quick Match between easy Bots, each thinking on its own screen's prediction. The Host won 12–10 at Tick 11575 in about 200 s, with no page errors.
- Each page logged the Contact bits it sent and the Court's Snapshots, and compared them with the state it drew.
- **98 local Rally hits** (Host 50, Guest 48): every report was confirmed on its Tick, with 0 rejected and 0 unreported.
- The drawn ball never differed from the Court's on any Snapshot Tick in a Rally (3739 and 3680 checked), except near remote hits (137 and 159 Ticks, all within 30 Ticks of one).
- So the hitter's swing and launch were never corrected. **The user's check by feel is still to come.**

**Notes:**
- **Under long stalls** a hit can be lost: a report held past the window is dropped, and the ball flies on. That's ADR-0004's rule, but at a 300 ms freeze it cost 5 hits in a minute (seed 1).
  - Separately, the prediction re-simulates from Snapshots that the Court stepped with fills for this client before its rewind. So it can call a hit on the wrong Tick, the same cause as 09's stall phantoms.
  - A Snapshot whose `ack` is behind its Tick could be treated as provisional for the local Player. Left for later.
- **At a 500 ms freeze every 2.5 s, the harness Bots made no Rally hits at all in 60 s.** I didn't investigate; it may be the Bots or the Serve rather than this change.
- **Phase 4 isn't marked done:** it also needs issue 11.
