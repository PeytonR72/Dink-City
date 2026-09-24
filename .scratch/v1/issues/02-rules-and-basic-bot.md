# 02: Rules and basic Bot

Status: resolved
Blocked by: 01
Handoff: `.scratch/v1/handoff-02.md` (read this before starting)

## Goal

A full singles Game against a Bot, with correct scoring and Faults.

## Acceptance

- Serve flow:
  - Players placed automatically after each point
  - server can adjust along the baseline
  - diagonal Serve checked for Service court
- Two-bounce rule, Kitchen faults, in/out, net. Each has Sim tests.
- Side-out scoring to 11, win by 2. Rally scoring and best-of-3 flags.
- Ends switch between Games, and the renderer mirrors the court.
- A Bot that produces Intents only (ADR-0003), with Difficulty parameters.
- A golden test: a seeded Bot-vs-Bot Game is reproducible from its Intents.
- A plain HUD showing score, server and Fault banner text.

## Comments

**2026-09-23 (Claude):** Done.
- Rules in `src/sim/step.ts`: Side-out scoring to 11 by 2 (no second server), `rallyScoring` and `bestOf` in `MatchConfig` (Sim state, not Tuning), serve court from the server's own score, Service court check (Kitchen and Kitchen line fault; centerline, sideline, baseline in; net-cord serves play on), Two-bounce rule, Kitchen fault (`footRadius` in Tuning), Ends switch between Games.
- Decisions: first server alternates by Game; Ends switch only between Games; serve aim stays clamped, so service Faults become reachable with Aim error in 03.
- Added: the contact assist won't carry a Player across the Kitchen line while a volley is pending (it caused Kitchen faults nobody chose). Own movement is never locked.
- Coordinates are now keyed by **End** (`facing(end)`, `endOfZ`, `endOf(state, side)`). The handoff's "Side 0 plays from +z" holds only in Game 1.
- Bot: `src/bot/bot.ts` takes an `Observation` (`src/bot/observe.ts`), never SimState. Difficulty presets easy/medium/hard; shot choice is a weighting (`ShotWeights`) ready for Personalities. `kitchenDiscipline` covers both the Kitchen and Two-bounce rules.
- HUD: `src/hud/`. Fault text is from the local Player's point of view.
- Playtest flags: `?rally`, `?bo3`, `?bot=easy|medium|hard`. `dink.rally` holds the current Rally's start state + Intents (for 05 Replays).
- Tests: 57 (rules, Bot-vs-Bot golden with a pinned result, fault text). Browser-checked: scoring, banner, Game 2 mirror, input in the mirrored End.
