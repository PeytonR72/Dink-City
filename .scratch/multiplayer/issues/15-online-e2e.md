# 15: Two-browser e2e against `wrangler dev`

Status: ready-for-agent
Blocked by: 14

Spec: `docs/MULTIPLAYER.md` Phase 6 (first bullet); Part 1 §7 (tests and tooling).

## Read first

- `docs/MULTIPLAYER.md`, and the comments of issues 06–14 (how each was checked in Playwright; reuse those scripts).
- `playwright.config.ts` and `e2e/*.e2e.ts`: SwiftShader, port 5174, reference screenshots and the perf budget.

## Goal

Online play has a permanent regression test that runs with `npm run e2e`, as offline play does.

## Scope

**Playwright:**
- A second `webServer` for `wrangler dev` on a fixed port.
- Point the client at it through `VITE_PARTY_HOST`.
- Keep `reuseExistingServer`.
- Keep the offline tests as they are, and make sure they still pass whether or not the party server is up.

**`e2e/online.e2e.ts`**, with two browser contexts:
- Create a Court with a name and a Preset, see the row in the other context's list, and join by click.
- Play a scripted Rally through `window.dink`, driving both Players (Bots through the online driver, or scripted Intents), and assert that a point is scored the same on both screens.
- Join by `?court=` link.
- A reload rejoins the seat.
- A Fault shows the banner with no Replay.
- Rematch after a Quick Match. Shorten it if the scripting allows, or leave it to the harness and say so.

**Stability:**
- Run it 5 times in a row, and fix any flakiness at its cause: wait on messages or state, never on sleeps.
- It must finish in under about 60 s.

## Acceptance

- `npm run e2e` runs the offline and online tests green, 5 times in a row.
- No reference screenshots are re-accepted.
- Document in `party/README.md` how to run just the online e2e.

## Out of scope

Deploying (16).

## Comments
