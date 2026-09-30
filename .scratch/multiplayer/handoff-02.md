# Handoff: finishing issue 02 (a Court on `wrangler dev`)

Written 2026-09-29. The previous session built everything in issue 02 and got the smoke script passing, then stopped because the permission checker for tool calls stopped responding. The work is **uncommitted** on `main`. Your job is to finish issue 02: steps 1–7 below. **The user has accepted every choice listed under "Decisions made", so don't reopen them.**

## Read first

1. `.scratch/multiplayer/issues/02-court-handshake.md`: the ticket.
2. `.scratch/multiplayer/handoff-01.md`, "Conventions and gotchas specific to 01" and "Working with this user". They still apply: comment style, commit trailer, and never pushing without asking.
3. `CONTEXT.md`, the Online play section. Use its terms: Court, Court code, Host, Guest, Preset, Display name.

## What's on disk (uncommitted)

- **`src/net/protocol.ts`** (new), exported from `src/net/index.ts`. It has `PROTOCOL_VERSION`, `CourtErrorCode`, `CourtPlayer`, `HelloMsg`, `ClientMsg`, `CourtMsg` (`welcome` and `error`), `encode`, a `decode` that returns `{ t } | null`, and `isHello`.
- **`party/`**:
  - `package.json`: partyserver ^0.5.10, wrangler ^4.144, `@cloudflare/workers-types`, and `tsx`. The scripts are `dev`, `deploy` and `smoke`.
  - `tsconfig.json`: Workers types only, covering `src`.
  - `wrangler.jsonc`: `COURT` and `LOBBY` bindings, and a `v1` `new_sqlite_classes` migration. `compatibility_date` is `2026-09-26`, which matches the installed workerd.
  - `node_modules`: installed, and ignored by git.
  - `src/courtCode.ts`, `src/courtSeats.ts` and `src/origin.ts`: the pure modules.
  - `src/env.ts`, `src/lobby.ts` (an empty stub), `src/court.ts` and `src/worker.ts`.
  - `scripts/smoke.ts`.
- **Tests**: `test/net/protocol.test.ts`, `courtCode.test.ts`, `origin.test.ts` and `courtSeats.test.ts` (17 tests), all green.
- **Root changes**:
  - `package.json` has `typecheck` = `tsc --noEmit && tsc --noEmit -p party`, and `party` = `npm --prefix party run dev`.
  - `tsconfig.json` includes `party/scripts`, so the root tsc, which has DOM and node types, checks the smoke script. The party tsconfig checks only `src`, with Workers types.
  - `.gitignore` has `.wrangler/`.
- `.playwright-mcp/` was untracked before this work started. Don't commit it.
- **`party/README.md` has NOT been written yet.** The tool failed on it. The content is in step 1.
- A `wrangler dev` from the last session may still be running on port 8787. If port 8787 is busy, stop it, or reuse it.

## Decisions made (accepted by the user)

- **Host token:** the Court's `provision()` generates it with `crypto.randomUUID()` and returns `{ ok: true, hostToken } | { ok: false }`.
- **What "idempotent" means:** only the first `provision` call does anything. Every later call is refused and changes nothing. The Worker retries up to 5 fresh codes, then answers 503 `busy`.
- **A Host who never connects** holds seat 0 in `grace` from `provision`, so the Court closes when that grace ends.
- **An unknown token** is treated as a tokenless join. A token reclaims its seat even from a connection that's still open (a second tab). The Court closes the old socket with `4000 'replaced'`. A reclaimed seat keeps its original name.
- **A Guest who leaves before start** is freed when the grace ends, not immediately.
- **After the Match starts,** an expired seat becomes `gone` and can't be reclaimed (`full`). This leaves room for the Takeover Bot in issue 14. `start()` exists for issue 03.
- **Errors:** every error except `bad_message` closes the socket with code 4000. `bad_message` (too big, meaning more than 2048 chars, not JSON, or failing the guard) is answered and the socket stays open. A second `hello` on a socket that's already seated is ignored.
- **Origin rule:** only `https://dink-city.vercel.app`, plus `http://localhost` and `http://127.0.0.1` on any port. A missing Origin is refused.
  - `/create` handles the OPTIONS preflight and sends CORS headers.
  - `onBeforeRequest` answers 404 to all non-upgrade requests to the DOs.
  - `onBeforeConnect` checks Origin, and checks `isCourtCode(name)` when `className === 'COURT'`.
  - `className` is the binding name. partyserver's `party` field is deprecated.
- **`tsx`** is the smoke runner. It's added to `party/` only; the root gets no new dependencies. Node 22 can't strip types for the game's extensionless imports.

## Gotchas found

- **partyserver doesn't answer a client close that carries no code** (1005): `closeQuietly` skips reserved codes, so Node's `ws.close()` hangs. `Court.onClose` calls `conn.close(1000)` in a try/catch to complete the handshake.
- **A refused socket can still deliver its `hello`.** `send()` after `close()` throws in workerd, so `Court.send` checks `readyState === WebSocket.READY_STATE_OPEN`.
- **`wrangler dev` hot-reloads on every edit and wipes the Court's memory.** A smoke run that overlaps an edit fails with `not_found`. Wait a few seconds after editing before running it again.
- **`onClose` and `onError` de-duplicate through `holders`:** the first one to fire clears the seat's connection id, and the second finds nothing.

## Steps to finish

1. **Write `party/README.md`.** Cover:
   - What the package is: a Worker plus one `Court` DO per Match, on partyserver. Point to `docs/MULTIPLAYER.md` and ADR-0004.
   - The file roles: `worker.ts` (`/create` and upgrade routing, RPC provisioning), `court.ts` (a thin shell), `lobby.ts` (a stub until 05), and the pure modules, which are tested under `test/net/`.
   - Install once with `npm --prefix party install`. The root typecheck needs it.
   - `npm run party` runs `wrangler dev` on :8787.
   - `npm --prefix party run smoke`: what it checks, the optional base-URL argument, and that it runs on `tsx`.
   - Nothing is deployed until issue 16.
2. **Run the checks:**
   - `npm run typecheck`, then `npm test`. Expect 201 earlier tests plus the new ones, and the golden result `{ points: [11, 13], tick: 39353 }` unchanged.
   - `npm run build`.
   - `npm run e2e`. Stop the wrangler server first if the ports clash, although e2e uses 5174.
3. **Run the smoke:** `npm run party` in the background, then `npm --prefix party run smoke`. All 13 lines should say `ok`. Keep the output for the issue comment.
4. **Check that `src/` only gained `src/net/protocol.ts` and the index export:** run `git status` and `git diff src/`.
5. **Run `/code-review`** (the mattpocock-skills one) against `HEAD`, and fix what it finds.
6. **Append a `## Comments` entry to issue 02.** Include the commit(s), what was built, test counts, the smoke output, and the "Decisions made" and "Gotchas found" above as deviations and notes.
7. **Commit** to `main`, one commit, with a subject like "Online play: a Court on wrangler dev that two Players can join", ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
   - Don't commit `.playwright-mcp/`.
   - **Don't push, and don't run `wrangler login` or `wrangler deploy`.**

Then report to the user briefly and stop. Issue 03 is next, and the user starts it.
