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

### 2026-09-29: implemented

One commit, "Online play: a Court on wrangler dev that two Players can join" (the one that adds this comment).

**What was built:**
- **`src/net/protocol.ts`**, exported from `src/net/index.ts`. It has `PROTOCOL_VERSION`, `CourtErrorCode`, `CourtPlayer`, `HelloMsg`, `ClientMsg`, `CourtMsg` (`welcome`, `error`), `encode`, `decode` (checks the tag only) and `isHello`. Nothing else under `src/` changed.
- **`party/`**:
  - `package.json`: partyserver, wrangler, workers-types and tsx.
  - `tsconfig.json`: Workers types, covering `src`.
  - `wrangler.jsonc`: `COURT` and `LOBBY` bindings, the `v1` `new_sqlite_classes` migration, and `compatibility_date` 2026-09-26. No routes.
  - `README.md`.
  - Pure modules `courtCode.ts`, `courtSeats.ts` (`GRACE_MS = 30_000`) and `origin.ts`. Their tests are under `test/net/`.
  - `court.ts`: a thin shell with `hibernate: false`.
  - `worker.ts`: `/create` with RPC `provision` and 5 code attempts, `routePartykitRequest`, the Origin allowlist and CORS.
  - `lobby.ts`: an empty stub.
  - `scripts/smoke.ts`.
- **Root:**
  - `typecheck` also runs `tsc -p party`, and there's a new `npm run party` script.
  - `tsconfig.json` includes `party/scripts`, so the smoke script is checked with DOM and node types.
  - `.gitignore` has `.wrangler/`.

**Results:**
- Tests: 26 files and 229 tests pass. That's 201 before, plus 28 new (protocol, courtCode, origin, courtSeats). The seat tests cover the race for seat 1, a Host who never connects, and a Host leaving before start.
- Checks: typecheck (root and `party/`), build and e2e (16) all pass.
- The golden result `{ points: [11, 13], tick: 39353 }` is unchanged.
- Smoke (`npm run party`, then `npm --prefix party run smoke`). This run was on :8788, because a stale `wrangler dev` held :8787 until it was stopped:
  ```
  ok   create refuses a foreign Origin
  ok   create refuses a bad name
  ok   create answers with a code (W483H) and a Host token
  ok   create sends CORS headers
  ok   plain HTTP to the Court is refused
  ok   the Host is seated on Side 0
  ok   a Guest is seated on Side 1
  ok   the welcome lists both Players
  ok   a third client gets full
  ok   the Guest reconnects with its token and gets Side 1 back
  ok   a Sim hash mismatch gets version
  ok   a bad Display name gets bad_name
  ok   an unprovisioned Court gets not_found
  ```

**Decisions (accepted by the user) where the issue left room:**
- `provision()` makes the Host token with `crypto.randomUUID()`. Only the first call provisions; later calls are refused and change nothing. After 5 refused codes, `/create` answers 503 `busy`.
- The Host holds seat 0 in `grace` from `provision`, so a Host who never connects closes the Court when the grace ends.
- **Tokens:** an unknown token is treated as a tokenless join. A known token reclaims its seat even from a connection that's still open (a second tab), which gets closed with `4000 'replaced'`. The seat keeps its original name.
- **Before the start,** a Guest's seat is freed when their grace ends. **After the start** (`start()`, for 03), an expired seat becomes `gone` and can't be reclaimed (`full`). This leaves room for the Takeover Bot (14).
- **Closes:** every error except `bad_message` closes with 4000. `bad_message` covers more than 2048 chars, not JSON, or failing the guard; it's answered and the socket stays open. A second `hello` on a seated socket is ignored.
- **Origin:** `https://dink-city.vercel.app`, plus `http://localhost` and `http://127.0.0.1` on any port. A missing Origin is refused. `onBeforeConnect` routes on `className`, the binding name, because partyserver's `party` is deprecated.
- **Smoke runner:** `tsx`, a dev dependency of `party/` only. The root gets no new dependencies, because Node 22 can't strip types for the game's extensionless imports.

**Review fixes (`/code-review`):**
- `onError` frees the seat before closing the socket, since closing can throw.
- `hello` ignores sockets that aren't open, so a closing socket can't take a seat.
- Lobby upgrades get 404 until 05.
- `/create` rejects a Content-Length over 1024 before reading the body.
- Doc comments on the remaining exports.
- `JoinResult`'s codes derive from `CourtErrorCode`.
- A `withStatus` helper in `courtSeats`.

**Gotchas and notes for later issues:**
- **partyserver doesn't answer a client close with no code** (1005), so Node's `ws.close()` hangs. `Court.onClose` calls `conn.close(1000)` inside a try/catch.
- **A refused socket can still deliver its `hello`.** `send` after `close` throws in workerd, so `send` checks `readyState`.
- **`wrangler dev` hot-reloads on every edit and wipes the Courts.** A smoke run that overlaps an edit fails with `not_found`.
- **Left for later:**
  - 04 needs a typed guard for Court→client messages, because `decode` only checks the tag.
  - 04 must handle the `4000 'closed'` close reason from a Court that closed (no `error` message is sent first).
  - 03 or 05 might add a timeout for sockets that never say hello.
  - An exception from `provision` over RPC answers 500 without CORS headers.
  - `/create` uses the `bad_preset` and `busy` error strings, which are HTTP-only and aren't in `CourtErrorCode`.
