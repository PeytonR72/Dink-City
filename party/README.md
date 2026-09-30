# party

The online server: a Cloudflare Worker, one `Court` Durable Object per Match and a singleton `Lobby`, built on [partyserver](https://github.com/cloudflare/partykit/tree/main/packages/partyserver). The design is in `docs/MULTIPLAYER.md` and `docs/adr/0004-online-play.md`.

## Files

- `src/worker.ts`: the Worker. `POST /create` validates the Host's Display name and Preset, picks a Court code, and provisions that Court over DO RPC. WebSocket upgrades go to a Court (`/parties/court/CODE`) or the Lobby (`/parties/lobby/global`) through `routePartykitRequest`, behind the Origin allowlist. Plain HTTP to a Durable Object gets 404.
- `src/court.ts`: the `Court` DO, a thin shell over the pure modules. It checks each `hello` and seats the Player, starts the Match on `ready` (or 10 s after the Guest is seated), then steps it on a `setInterval` and sends each Player their Snapshots. The interval stops when the Match is over or both Players are gone. It reports its lifecycle to the Lobby over RPC, best-effort (`open`, a `heartbeat` every 30 s until the start, `join`/`leave` for the Guest, `start`, `end`, `close`). Before the start it closes when the Host has been gone 15 s (a seated Guest gets `host_left`) or after 30 minutes with no Guest.
- `src/lobby.ts`: the `Lobby` DO, named `global`. It takes the Courts' reports over RPC (`report`), and pushes `{ t: 'courts', courts }` to every menu client on connect and after every change, at most 4 times a second. While anyone is subscribed it sweeps expired entries every 15 s.
- `src/courtSeats.ts`, `src/courtStart.ts`, `src/courtMatch.ts`, `src/tickLoop.ts`, `src/courtDirectory.ts`, `src/origin.ts`: pure modules with no Workers types. Their tests live in the root `test/net/`.
  - `courtDirectory`: the Lobby's entries. Every report refreshes a 90 s expiry, a Court with a Guest is hidden, and a removed Court stays removed. Reports carry the Court's own sequence number, so late or reordered ones change nothing.
  - `courtStart`: when the Match starts.
  - `courtMatch`: the Match engine. It takes `in` messages, steps the Sim, and returns the Snapshots and `over` to send.
  - `tickLoop`: how many Ticks each interval callback runs, from its timestamp.
- `src/env.ts`: the bindings, and the dev-only `LOBBY_TTL_MS`.
- `scripts/smoke.ts`: a scripted client for a local Court.

The server imports `src/sim` and `src/net` from the game by relative path. The smoke script also imports `src/bot`.

## Commands

Install once with `npm --prefix party install`. The root `npm run typecheck` needs it, because it also runs `tsc -p party`.

- `npm run party` (from the root) runs `wrangler dev` on http://localhost:8787. It hot-reloads on every edit, which wipes the Courts in memory.
- `npm --prefix party run smoke` runs the smoke client against `wrangler dev`. It checks that `/create` refuses a foreign Origin and a bad name, answers with a code, a Host token and CORS headers, and that plain HTTP to a Court is refused. Then it seats the Host on Side 0 and a Guest on Side 1, gets `full` for a third client, reconnects the Guest with its token, and gets `version`, `bad_name` and `not_found` for a bad Sim hash, a bad name and an unprovisioned Court. Every line should say `ok`. Pass another base URL as an argument to aim it elsewhere, e.g. `npm --prefix party run smoke -- http://localhost:8788`. `npm --prefix party run smoke -- --match` has two easy Bots play a Quick Match over real sockets instead, each thinking on its latest Snapshot. It prints progress every 15 s, then the winner, the score, the final Tick and the wall time, and checks that no Snapshot follows `over`. It takes a few minutes, because online Game speed is always 1. Don't edit `party/` or `src/` while it runs: the hot reload wipes the Court. `npm --prefix party run smoke -- --lobby` (about 50 s) subscribes to the Lobby like the menu does, and checks that a new Court is listed within 1 s, leaves the list when a Guest joins, comes back when the Guest's seat is freed (after the 30 s grace), and stays off once the Match starts. Then it checks that a lone Host leaving removes the row after the 15 s reload grace, and that a seated Guest gets `host_left`.

`--expire` shows that an entry dies on its own when its Court stops reporting. You can't kill one Court under `wrangler dev`, so shorten the entries' life below the 30 s heartbeat instead: between heartbeats, an entry gets no reports, just like a dead Court's. Run the server with `cd party && npx wrangler dev --var LOBBY_TTL_MS:5000`, then `npm --prefix party run smoke -- --expire`. The entry should drop within the TTL plus one 15 s sweep.

`wrangler dev` logs `Uncaught Error: Network connection lost.` whenever a client closes its socket, to a Court or to the Lobby. It's workerd's teardown noise and harmless.

Every mode runs on `tsx`, a dev dependency of this package only, because Node can't strip types for the game's extensionless imports.

To play a Match in the browser, run `npm run party` and `npm run dev`, open http://localhost:5173 in two windows (or two browser profiles), and pick **Play online** in each. One creates a Court, and the other clicks it in the list, types its code, or opens its `?court=CODE` link. Reloading either window rejoins its seat. The client reaches the Worker at `VITE_PARTY_HOST`, `localhost:8787` by default; a build offers online play only in dev or when `VITE_PARTY_HOST` is set.

Nothing is deployed yet. Issue 16 sets up `wrangler deploy` with the user.
