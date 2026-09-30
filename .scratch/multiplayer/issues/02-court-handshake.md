# 02: A Court on `wrangler dev` that two Players can join

Status: ready-for-agent
Blocked by: 01

Spec: `docs/MULTIPLAYER.md` Part 2 (what transfers from PokerElo) and Part 3, "Court and Lobby" and "Wire format"; ADR-0004.

## Read first

1. `CONTEXT.md`, the **Online play** section. Use its terms: Court, Court code, Host, Guest, Preset, Display name, Snapshot.
2. ADR-0004 and `docs/MULTIPLAYER.md` Parts 2–4. **The decisions are settled; don't reopen them.**
3. `.scratch/multiplayer/handoff-01.md`, "Conventions and gotchas specific to 01", and the `## Comments` of issue 01.
4. PokerElo, for patterns only (`C:\Users\ztwis\Desktop\poker elo\`):
   - `party/src/worker.ts`, `party/src/matchRoom.ts` (seats, grace, reconnect), `party/wrangler.jsonc`, `party/package.json`
   - `shared/src/protocol.ts`, `shared/src/roomCode.ts`

## Goal

The server's tracer bullet: a Worker plus a `Court` Durable Object, running under `wrangler dev`.

- A Host creates a Court.
- The Host and a Guest connect over WebSockets and are seated.
- A reload reclaims the seat.

There's no Sim, no Lobby and no UI yet. It's verified by pure Vitest tests and a scripted smoke client.

## Scope

**`party/` package** (mirrors PokerElo):
- `package.json` with `partyserver`, `wrangler` and `@cloudflare/workers-types`, plus `dev` and `deploy` scripts.
- `tsconfig.json` with Workers types.
- `wrangler.jsonc` with:
  - DO binding `COURT` → `Court`. Declare `LOBBY` → `Lobby` now as an empty stub class, so the migration tag doesn't have to change in 05.
  - A `new_sqlite_classes` migration.
  - A current `compatibility_date`. No routes or custom domain; that's issue 16.
- The server imports `src/sim`, `src/net` and later `src/bot` by relative path (Decision 3).
- Add root scripts:
  - `npm run party` for `wrangler dev`.
  - `npm run typecheck`, extended so it also checks `party/` (e.g. `tsc --noEmit -p party`).
- `npm test` must keep collecting every test.

**`src/net/protocol.ts`:**
- `PROTOCOL_VERSION`.
- The Court messages as `{ t: … }` unions, both directions, with `encode` and `decode` that check only the tag.
- A type guard per client→Court message, which the server uses to re-check every payload.
- This issue's messages:
  - Client → Court: `hello { name, token?, protocolVersion, simHash }`.
  - Court → client: `welcome { side, token, preset, players }` and `error { code }`.
- Error codes: `full`, `not_found`, `bad_name`, `version`, `bad_message`.
- Later issues add messages here.
- It must stay pure; the `src/net` boundary test applies.

**Pure modules in `party/src/`** (no Workers types, so root Vitest and root `tsc` can load them; tests go under `test/net/`):
- `courtCode.ts`: a short code from an unambiguous alphabet, taking a `randomBytes` function as a parameter. The Worker passes `crypto.getRandomValues`.
- `courtSeats.ts`: the seat rules as a pure state machine with `now` passed in.
  - The Host holds seat 0 from `provision`. The first valid `hello` without a token takes seat 1. A third gets `full`.
  - A token reclaims its seat.
  - `disconnect(side, now)` starts a grace period and `expire(now)` ends it. Use a named constant, 30 s by default, which later issues reuse.
  - The seat of a Guest who left before start is freed.
  - A Host leaving before start closes the Court once the grace ends.
- Tests cover every rule above, including two joins racing for seat 1.

**The Worker (`party/src/worker.ts`):**
- `POST /create { name, preset }`:
  - Validates with `validateDisplayName` and `isPresetId`.
  - Picks a code and provisions the Court named by it over **DO RPC** (`provision({ hostName, preset, seed })`).
  - If the Court refuses, it retries with a new code.
  - Returns `{ code, hostToken }`.
  - The seed comes from `crypto.getRandomValues`.
- `routePartykitRequest` for WebSockets, with an `onBeforeRequest` that lets only upgrades through. Internal traffic is RPC only (Part 2, "Changed on purpose").
- An Origin allowlist (localhost ports and `https://dink-city.vercel.app`) on both `/create` and upgrades, plus CORS for `/create`.

**The `Court` DO (`party/src/court.ts`), a thin shell:**
- `hibernate: false`.
- `provision()` is idempotent and refuses a code that's already provisioned. An unprovisioned Court refuses connections with `not_found`.
- On `hello` it checks the name, `protocolVersion` and `simHash(simTuning)` (from `src/tuning.ts`), then seats the Player through `courtSeats`.
- It de-duplicates `onClose` and `onError` the way PokerElo does.
- It caps message size and drops malformed payloads.

**`party/scripts/smoke.ts`:**
- Against `wrangler dev`: create, connect the Host, connect a Guest, have a third client get `full`, then close and reconnect the Guest with its token and get seat 1 back.
- Run it with whatever the repo can run with no new root dependencies, or add one dev dependency and say which.
- Document the command in `party/README.md`.

## Acceptance

- `npm run typecheck` (root and `party/`), `npm test`, `npm run build` and `npm run e2e` pass.
- Offline play is untouched. Nothing under `src/` changes except `src/net/protocol.ts` and its tests.
- The smoke script passes against `npm run party`. Paste its output in the issue comment.
- The pure-module tests cover the seat rules, including the race and the Host leaving before start.
- **Nothing is deployed.** Don't run `wrangler login` or `wrangler deploy`; issue 16 does that with the user.

## Out of scope

The Sim loop (03), the client (04), the Lobby (05) and the menu (06).

## Comments
