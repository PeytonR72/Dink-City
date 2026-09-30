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
