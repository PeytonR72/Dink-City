# 05: The Lobby: a live directory of open Courts

Status: ready-for-agent
Blocked by: 03

Spec: `docs/MULTIPLAYER.md` Part 3 "Court and Lobby" (the report table, "Stale entries", "Menu clients", "The Host leaves before a Guest arrives"), Part 2 (`liveMatches.ts`), "Full Courts in the list"; ADR-0004, "Rooms and discovery".

## Read first

- `CONTEXT.md` Online play, ADR-0004, `docs/MULTIPLAYER.md`.
- Issues 02–03 and their comments.
- PokerElo `party/src/lobby.ts` and `party/src/liveMatches.ts` (with its test), for patterns only.

## Goal

Courts report their lifecycle to a singleton `Lobby` DO, which pushes the list of open Courts live to every subscribed menu client. Entries heal themselves: a Court that dies drops off within 90 s.

## Scope

**`party/src/courtDirectory.ts` (pure, `now` passed in, tests under `test/net/`):**
- Ops: `open`, `heartbeat`, `join`, `leave`, `start`, `end`, `close`, with the effects in the Part 3 table.
- Every report sets `expiresAt = now + 90 s`.
- `sweep(now)` returns whether anything was removed.
- `list(now)` returns open, visible entries only, newest first, at most 50: `{ code, hostName, preset, players: 1, createdAt }`.
- `join` hides an entry without deleting it, and `leave` shows it again.
- `end` is idempotent.
- Tests cover every op, expiry with no reports, hide and re-show, the cap and sort, and reports arriving out of order (e.g. `join` after `start`).

**The `Lobby` DO** (singleton, named `global`), a thin shell:
- **RPC** methods for the reports. Not `onRequest`; see Part 2, "Changed on purpose".
- WebSocket subscribers:
  - On connect, send `{ t: 'courts', courts }`.
  - After every change, send it again, throttled to at most 4 per second.
- A 15 s sweep interval, only while someone is subscribed. It broadcasts when something was removed.

**The Court reports**, best-effort over RPC:
- `open` on provision.
- `heartbeat` every 30 s until start.
- `join`/`leave` for the Guest, `start`, `end`, and `close`.
- Failures are logged and ignored.

**Close rules** in the Court, using `courtSeats` from 02:
- The Host leaving before start closes the Court after the reload grace (15 s). A seated Guest gets `error { code: 'host_left' }`.
- A Court open 30 minutes with no Guest closes.
- Both report `close`.

**Protocol:** add the Lobby messages and the `host_left` code to `src/net/protocol.ts`.

**Smoke:**
- A subscriber sees a new Court within 1 s, sees it vanish on join and come back on leave, and sees it removed on start.
- A test mode shortens the TTL (a `wrangler dev --var`, for example) to show that a Court whose process was killed expires. Document how.

## Acceptance

- The pure directory tests are green, and all root checks pass.
- The smoke script passes against `npm run party`. Paste the output.
- `onRequest` isn't used for any internal channel.

## Out of scope

The menu UI (06).

## Comments
