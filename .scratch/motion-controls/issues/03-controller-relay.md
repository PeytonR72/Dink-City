# 03: Controller relay and the screen's pairing panel

Status: ready-for-agent
Blocked by: 02

Spec: `.scratch/motion-controls/spec.md`, "Pairing and transport".

## Goal

A screen can open a Controller pairing and show a QR code, and a WebSocket client playing the phone can connect and exchange messages through it. No phone UI yet.

## Scope

- **`src/net/controller.ts`** (pure, no DOM):
  - Pair code generation and validation. Reuse the approach in `courtCode.ts`, with a separate prefix or alphabet so a Pair code can never be mistaken for a Court code.
  - Message types and validators for `hello`, `swing`, `tilt`, `hit`, `ping` and `pong`, plus a `CONTROLLER_VERSION`.
  - Unit tests, plus the boundary test that `src/net/` already has.
- **`party/src/controller.ts`**: a `Controller` DO with roles `screen` and `phone`.
  - Put its rules in a pure module tested in Vitest (one screen, latest phone wins, close when the screen leaves, drop invalid or oversized messages, rate limits).
  - The DO class is a thin shell.
  - Add the binding and a `v2` migration in `wrangler.jsonc`, and route `CONTROLLER` in `worker.ts`'s `onBeforeConnect` with Pair code validation.
- **Origins**: decide how preview or tunnel origins are allowed for phone testing, for example a dev-only `EXTRA_ORIGINS` var. Write the decision in the comments.
- **Screen side**:
  - `src/controller/screen.ts` opens the pairing and exposes `onSwing`, `onTilt`, `status` and `rtt`.
  - The pairing panel overlay shows a QR code and the code. Pick a small QR dependency, or vendor a tiny encoder, and say which.
  - Switching to Motion mode with no Controller opens the panel.
- **Smoke test**: extend `party/scripts/smoke.ts` (or add one) so a fake phone sends `swing` and the screen receives it.

## Acceptance

- `npm run typecheck` (both projects), `npm test` and `npm run build` pass.
- The smoke test passes under `wrangler dev`.
- In the browser, Motion mode with no phone shows the panel. A fake phone script connects, the HUD shows "Controller connected" with a round-trip time, and its Swings hit the ball through the issue 02 Motion source.

## Out of scope

- The phone page and real sensor data.

## Comments
