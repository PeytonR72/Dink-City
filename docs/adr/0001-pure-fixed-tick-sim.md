# ADR-0001: Pure, fixed-tick, deterministic Sim

Status: accepted (2026-09-23)

## Context

v1 is single-player against Bots. Online multiplayer with an authoritative server is a likely later phase. We also want Replays of Faults, headless physics tests, and live Tuning.

## Decision

- All game logic and ball physics live in `src/sim/` as a pure function: `step(state, intents) → state`.
- The Sim runs at a fixed 60 Hz Tick, separate from the render frame rate. The renderer interpolates between the last two states.
- State is plain serializable data. No three.js objects, no classes with hidden state, no `Date.now()` or `Math.random()`.
- All randomness comes from a seeded RNG whose state is stored inside the Sim state.
- `src/sim/` never imports three.js, the DOM, or the render/input layers.
- Physics is custom (gravity, drag, bounce, and spin as a fixed property of each Shot type) with no physics engine. State has a `spin` field so a real Magnus model can be added later.
- The Sim uses real units (meters, seconds) and real court dimensions. A global Game speed factor lives in Tuning.
- Rules are the core set: diagonal serve, two-bounce rule, Kitchen faults, in/out. Serve technique and momentum faults are not modeled.

## Consequences

- The Sim can be tested headless in Vitest, including golden tests of whole Rallies replayed from Intents.
- A Replay is just recorded Intents plus a start state.
- A future server can run the same `step` with any transport. Colyseus is not required. Vercel cannot host persistent WebSockets, so multiplayer will need separate hosting.
- Floating-point determinism across different browsers is not guaranteed. The server will stay authoritative instead of relying on lockstep.
