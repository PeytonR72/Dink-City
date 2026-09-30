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

### 2026-09-30: implemented

One commit, "Online play: the Lobby lists open Courts live" (the one that adds this comment).

**What was built:**
- **`party/src/courtDirectory.ts`** (pure): `createCourtDirectory({ ttlMs })` with `report(r, now)`, `sweep(now)` and `list(now)`.
  - Every report sets `expiresAt = now + 90 s`.
  - `join` hides an entry and `leave` shows it again. `start`, `end` and `close` remove it, and `end` is idempotent.
  - `list` returns only open, visible entries, newest first, at most 50.
  - **Out of order:** each report carries the Court's own rising `seq`, so an older report changes nothing. A removed Court leaves a marker, kept until its own expiry, so a late `join`, `leave`, `heartbeat` or `open` can't bring it back. The live reports (`open`, `heartbeat`, `join`, `leave`) carry the whole entry, and `heartbeat` carries `players`, so a lost `open` (or a restarted Lobby) is rebuilt by the next report.
- **`party/src/lobby.ts`**, the `Lobby` DO (`global`), a thin shell:
  - An RPC method `report`.
  - Menu sockets get `{ t: 'courts', courts }` on connect, and again after every change, at most 4 a second.
  - A 15 s sweep interval, only while someone is subscribed. It broadcasts when the list changed.
  - Sends to a dead socket are swallowed, so a vanished subscriber can't make a Court's report throw. partyserver's `broadcast` would throw.
- **`party/src/court.ts`:**
  - Reports `open` on provision, `heartbeat` every 30 s until the start or close, `join` when a new Guest takes seat 1, `leave` when their seat is freed, `start`, `end` (Match over, or both Players gone) and `close`.
  - Reports are fire-and-forget over RPC; a failure is logged with `console.warn`.
  - Before the start it closes when the Host has been gone 15 s, or after 30 minutes with no Guest. It logs why, reports `close`, and sends `error { code: 'host_left' }` to a seated Guest.
- **`party/src/courtSeats.ts`:**
  - `HOST_RELOAD_MS = 15_000` is the Host's grace for a disconnect before the start. After the start, and for the Guest, it stays `GRACE_MS`.
  - `IDLE_MS` (30 minutes) runs from `waitingSince`: when seat 1 was last free. `nextExpiry` includes it, so the Court's existing timer covers it.
- **`party/src/worker.ts`:** upgrades to `/parties/lobby/global` are allowed, behind the same Origin check. Every other Lobby name gets 404, and `onRequest` is still never reached.
- **Protocol:** `host_left` in `CourtErrorCode`, `LobbyCourt`, `LobbyMsg`, and the `isLobbyMsg` guard for 06. `PROTOCOL_VERSION` is 3, because an old client's `isCourtMsg` would drop `host_left`. `main.ts` got the string "The host left." because the error table is typed on `CourtErrorCode`.
- **Smoke:** new `--lobby` and `--expire` modes. `party/README.md` documents both.

**Results:**
- Tests: 31 files and 290 tests pass. Before: 272. New:
  - courtDirectory: 13
  - courtSeats: 4 (reload grace, idle close, idle clock restart, no idle after start)
  - protocol: 1
- Typecheck (root and `party/`), build and e2e (16/16) pass. The golden result is unchanged. The handshake smoke passes 13/13.
- `npm --prefix party run smoke -- --lobby` against `npm run party`:
  ```
  ok   the Lobby sends the list on connect
  ok   a new Court is listed within 1 s of the create request (55 ms)
  ok   the entry names the host and the Preset, with one Player
  ok   it leaves the list when a Guest joins (220 ms)
       the Guest leaves; their seat is freed after the 30 s grace
  ok   it comes back once the Guest's seat is freed (30012 ms after they left)
  ok   it leaves the list again for the next Guest (248 ms)
  ok   both Players get start
  ok   it stays off the list once the Match has started
       two Hosts leave before the start, one alone and one with a Guest seated (15 s reload grace)
  ok   the lone Host is listed and the full Court is not
  ok   the lone Host's Court leaves the list after the grace (15030 ms)
  ok   the seated Guest gets host_left (15038 ms after the Host left)
  ok   the closed Court refuses a newcomer
  ```
- `--expire`, with the server started as `cd party && npx wrangler dev --var LOBBY_TTL_MS:5000`:
  ```
  ok   the Court is listed
  ok   its entry expires with no reports (14910 ms: the TTL plus up to one 15 s sweep)
  ```
  You can't kill one Court under `wrangler dev`. With the TTL below the 30 s heartbeat, a live Court's entry gets no reports between heartbeats, exactly like a dead Court's.

**Decisions where the issue left room:**
- **`leave` is reported when the Guest's seat is freed** (30 s after they disconnect), not when the socket drops. Until then the token can still reclaim the seat, and a newcomer would get `full`, so listing the Court earlier would offer a row that can't be joined. If the row should come back sooner, the Guest's grace before the start has to shrink too.
- **A Host who never connects** keeps the 30 s provision grace (time to load the Venue). The 15 s grace applies to a Host who connected and left. If they never connected, a seated Guest still gets `host_left`.
- **`sweep` and `report` return whether the *list* changed**, not whether anything was removed. Dropping a hidden entry or a removed-Court marker needs no broadcast.
- **The Lobby also sweeps on every report**, so the directory stays small while no one is subscribed. The 15 s interval still runs only with subscribers.
- **"Removed on start" isn't visible from outside:** a started Court was already hidden by its `join`. The smoke checks that it stays off the list, and courtDirectory's tests cover the removal and a late `join` or `leave` after `start`.

**Review (`/code-review`) fixes:** doc comments on `ReportOp` and `CourtDirectory`; `listed` became a type guard; a `hasSubscribers()` helper in the Lobby; no second `end` from a Court whose Match already ended.

**Left as they are (review smells):**
- The Court works out `join`/`leave` and why it closed by comparing Seats before and after (`seats[1] === null` in a few places). `courtSeats.join` and `expire` could return the lifecycle event instead.
- `CourtInfo` (party) and `LobbyCourt` (src/net) repeat the same four fields.

**Notes for later:**
- `wrangler dev` logs `Uncaught Error: Network connection lost.` whenever a client closes its socket, to a Court as well as to the Lobby. It's workerd teardown noise that was already there before this issue. It's noted in the README.
- 06: the menu subscribes to `/parties/lobby/global` and guards with `isLobbyMsg`. Handle `host_left` by returning to the list with "The host left."
