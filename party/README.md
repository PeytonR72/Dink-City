# party

The online server: a Cloudflare Worker plus one `Court` Durable Object per Match, built on [partyserver](https://github.com/cloudflare/partykit/tree/main/packages/partyserver). The design is in `docs/MULTIPLAYER.md` and `docs/adr/0004-online-play.md`.

## Files

- `src/worker.ts`: the Worker. `POST /create` validates the Host's Display name and Preset, picks a Court code, and provisions that Court over DO RPC. WebSocket upgrades go to the Court through `routePartykitRequest`, behind the Origin allowlist. Plain HTTP to a Durable Object gets 404.
- `src/court.ts`: the `Court` DO, a thin shell over the pure modules. It checks each `hello` and seats the Player, starts the Match on `ready` (or 10 s after the Guest is seated), then steps it on a `setInterval` and sends each Player their Snapshots. The interval stops when the Match is over or both Players are gone.
- `src/lobby.ts`: the `Lobby` DO, an empty stub until issue 05. It's declared now so the migration tag doesn't change.
- `src/courtCode.ts`, `src/courtSeats.ts`, `src/courtStart.ts`, `src/courtMatch.ts`, `src/tickLoop.ts`, `src/origin.ts`: pure modules with no Workers types. Their tests live in the root `test/net/`.
  - `courtStart`: when the Match starts.
  - `courtMatch`: the Match engine. It takes `in` messages, steps the Sim, and returns the Snapshots and `over` to send.
  - `tickLoop`: how many Ticks each interval callback runs, from its timestamp.
- `src/env.ts`: the bindings.
- `scripts/smoke.ts`: a scripted client for a local Court.

The server imports `src/sim` and `src/net` from the game by relative path. The smoke script also imports `src/bot`.

## Commands

Install once with `npm --prefix party install`. The root `npm run typecheck` needs it, because it also runs `tsc -p party`.

- `npm run party` (from the root) runs `wrangler dev` on http://localhost:8787. It hot-reloads on every edit, which wipes the Courts in memory.
- `npm --prefix party run smoke` runs the smoke client against `wrangler dev`. It checks that `/create` refuses a foreign Origin and a bad name, answers with a code, a Host token and CORS headers, and that plain HTTP to a Court is refused. Then it seats the Host on Side 0 and a Guest on Side 1, gets `full` for a third client, reconnects the Guest with its token, and gets `version`, `bad_name` and `not_found` for a bad Sim hash, a bad name and an unprovisioned Court. Every line should say `ok`. Pass another base URL as an argument to aim it elsewhere, e.g. `npm --prefix party run smoke -- http://localhost:8788`. `npm --prefix party run smoke -- --match` has two easy Bots play a Quick Match over real sockets instead, each thinking on its latest Snapshot. It prints progress every 15 s, then the winner, the score, the final Tick and the wall time, and checks that no Snapshot follows `over`. It takes a few minutes, because online Game speed is always 1. Don't edit `party/` or `src/` while it runs: the hot reload wipes the Court. Both modes run on `tsx`, a dev dependency of this package only, because Node can't strip types for the game's extensionless imports.

Nothing is deployed yet. Issue 16 sets up `wrangler deploy` with the user.
