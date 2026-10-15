# 01: ADR-0005 and the Sim rule for Swing-at-Contact

Status: ready-for-agent
Blocked by: none

Spec: `.scratch/motion-controls/spec.md`, "How a Motion-mode hit works".

## Goal

Make the one Sim change Motion mode needs, and write it down as ADR-0005. Nothing visible changes yet. Offline play, Bots and online play behave exactly as they do now.

## Scope

- **Write `docs/adr/0005-motion-controls.md`.** It should say:
  - Control mode is a client-only concept, and the Sim never sees it.
  - Offline Matches and Practice start the local Side as `reported`, with Keyboard mode filling `contact` from `autoContact`.
  - The new type-change-at-Contact rule (below).
  - Alternatives rejected:
    - a backswing-as-Commit gesture (indirect)
    - switching `contactMode` mid-Match (breaks re-simulation, ADR-0004)
    - a separate Motion-only quality curve in the Sim
- **The Sim rule.** In `src/sim/step.ts:152`, a Side in `reported` mode whose Intent on this Tick has `contact: true` **and** a `shot` that differs from its existing Commit's type changes `commit.type` but keeps `commit.tick` and `commit.bestDistance`. Every other case is unchanged: `auto` Sides, Ticks without `contact`, and having no Commit yet.
- **Tests** (extend `test/contact.test.ts`):
  - A reported Side Commits Soft early, then sends `{ shot: 'drive', contact: true }` in reach. The hit is a Drive, and its timing factor matches the early Commit.
  - The same sequence without `contact` (a plain re-press) still resets the tick, as today.
  - An `auto` Side ignores the new rule.
  - The existing bit-identical `auto` vs `reported` + `autoContact` test still passes.
  - The golden Bot result and the replay test are unchanged.

## Acceptance

- `npm run typecheck`, `npm test` and `npm run build` pass.
- The golden result `{ points: [11, 13], tick: 39353 }` doesn't move.
- `SIM_VERSION` in `src/net/` is bumped, because the Sim's rules changed.

## Out of scope

- Any input, UI or networking change.

## Comments

### 2026-10-15 implementation

Implemented ADR-0005 and SIM_VERSION 2. Contact-time type changes preserve the early Commit; plain presses and auto Sides retain their semantics. Compatibility clarification: keyboard re-press on the contact tick otherwise has identical input to a Motion Swing but must reset timing. A generic recommit bit preserves that behavior, with PROTOCOL_VERSION 9. It does not expose Control mode to the Sim. Tests cover the edge case, codecs, golden Bots, and replays.

See [verification and runbook](../../../docs/MOTION-CONTROLS.md) for final evidence and remaining gates.
