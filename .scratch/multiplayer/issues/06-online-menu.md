# 06: The menu's Online panel: name, live Court list, create, join by code or link

Status: ready-for-agent
Blocked by: 04, 05

Spec: `docs/MULTIPLAYER.md` Phase 2 ("Client") and its exit criteria, Part 3 ("Court and Lobby", "Display name"); ADR-0004.

## Read first

- `CONTEXT.md` Online play, ADR-0004, `docs/MULTIPLAYER.md`.
- Issues 04–05 and their comments.
- `src/menu/menu.ts` (`Overlay`, `SettingsPanel`), `src/menu/map.ts`, `src/style.css`, and `src/save/store.ts` / `settings.ts` for how saves work.

## Goal

A Player finds and joins online Matches from the menu. This finishes Phase 2: its exit criteria are this issue's acceptance.

## Scope

**Play online** button on the menu opens an Online panel:
- **Display name** field:
  - Validated live with `validateDisplayName`, with a message for each failure reason.
  - Saved under `dink.name` through the existing store, and tested like the other saves.
  - Defaults to "Guest NNNN".
- **Court list:** live from the Lobby socket, which is open only while the panel is open. Each row shows the host name, Preset and "1/2"; click to join. It has an empty state.
- **Create Court:** pick Quick, Standard or Long (default Standard). A waiting view then shows the code and a copyable `…?court=CODE` link, with Cancel.
- **Join by code** field.
- **Errors** in plain words:
  - `full`
  - `not_found`
  - `bad_name`
  - `version`: "Please reload for the latest version."
  - `host_left`: "The host left."
- Opening `?court=CODE` goes straight to joining. It asks for a name first if none is saved.
- **Loading:** the client loads the Venue on show (the Venue isn't part of a Preset), sends `ready`, and shows "Waiting for opponent…" until `start`.

**Gate:** online play shows only when `VITE_PARTY_HOST` is set, or in dev. Vercel deploys `main` on every push, and production has no server until issue 16.

**Tidy-up:** remove issue 04's dev entry flags, or keep them dev-only if they're still useful for tests (say which).

**Match end:** "Back to map" (rematch is issue 13). Esc during an online Match opens the pause overlay as it does offline for now; issue 12 changes it.

**e2e:** a Playwright test that opens the panel and checks name validation and the gate. The full two-context e2e is issue 15.

## Acceptance (the Phase 2 exit criteria)

On `npm run party` plus `npm run dev`, checked by the agent with two Playwright browser contexts:
- One creates a Court, and it appears in the other's list within 1 s.
- The second joins by clicking, the row disappears, and they play a full Match.
- Joining by code works, and so does joining by link.
- The Host closing the tab before anyone joins removes the row after the grace period.
- Killing the Court process makes its row expire within 90 s. Use the shortened TTL from 05 if it helps, and say so.
- A reload mid-Match rejoins the same seat.

Also:
- All pure-module tests are green. Offline play and e2e are unchanged, with no screenshots re-accepted.
- Mark Phase 2 done in `docs/MULTIPLAYER.md`.
- Give the user a two-window playtest checklist.

## Out of scope

Prediction (07–09), rematch (13), and the online pause (12).

## Comments

### 2026-09-30: implemented

One commit, "Online play: the menu's Online panel finds, creates and joins Courts" (the one that adds this comment). Phase 2 is marked done in `docs/MULTIPLAYER.md`.

**What was built:**
- **`src/menu/online.ts`, `OnlinePanel`:** DOM only. It reports clicks to `main.ts` and holds no sockets.
  - A Display name field, checked on every keystroke with a message per reason. Create, Join and the list rows stay disabled until the name is valid.
  - The live Court list: host, Preset and "1/2", built with `textContent` because names come from other Players. It has an empty state and a "Connecting to the Lobby…" state.
  - Create Court with Quick, Standard or Long (default Standard).
  - Join by code. It accepts a code in any case, or a pasted `?court=` link.
  - The waiting view: the code, the link, Copy link, and Cancel.
- **`src/save/name.ts`:** `loadName` (null when nothing valid is saved), `saveName` under `dink.name`, and `guestName()` ("Guest NNNN"). A valid name is saved as it's typed, and again when it's used to create or join.
- **`src/online/connection.ts`:** `watchLobby` subscribes to `/parties/lobby/global`, guards with `isLobbyMsg`, and reconnects every 3 s while the list is open. `CourtLink.close()` leaves a Court without calling `onClose`.
- **`src/online/gate.ts`:** `onlineOffered(env)` is `DEV || VITE_PARTY_HOST`.
- **`src/net/courtCode.ts`:** moved from `party/src/` so the client can check a code before connecting (the Worker 404s a bad one, which would read as a lost connection). It adds `readCourtCode`.
- **`src/input/input.ts`:** keys typed into a text field are ignored. Without this, typing "P" in a name paused, or closed the panel.
- **`main.ts`:**
  - New modes: `lobby` (the list) and `waiting`.
  - `goOnline(name, { preset } | { code })` creates or joins. It puts `?court=CODE` in the URL for both Players, so a reload rejoins the same seat, then sends `ready` on `welcome`.
  - Before the start, every failure goes back to the list with the reason: Court errors, a create that fails, a lost socket, a replaced seat, a closed Court. After the start, the old status overlay stays.
  - An attempt counter stops a cancelled attempt that is still waiting on the network.
  - "Back to map" shows when an online Match is over. It reloads offline, like Esc.
  - `?court=CODE` on load joins straight away if a name is saved. Otherwise it opens the panel, with the code filled in and the name field focused.
- **Errors:** `version` says "Please reload for the latest version." and `host_left` says "The host left."
- **Tidy-up:** issue 04's `?host=` and `?name=` flags are **removed**. The panel does what they did, and the Playwright runs drive the UI. `window.dink.drive` and `window.dink.online` stay.

**Results:**
- Tests: 33 files and 300 tests pass. Before: 290. New:
  - name: 7
  - onlineGate: 2
  - courtCode `readCourtCode`: 1
- The golden result is unchanged.
- Typecheck (root and `party/`) and build pass. e2e passes 19/19 (16 before, plus 3 in `e2e/online.e2e.ts`), and no screenshots were re-accepted. One run timed out once on the beach screenshot under load; it then passed 3/3, and the full run is green.
- The handshake smoke passes 13/13.
- **Gate:** e2e checks the dev side. `test/onlineGate.test.ts` covers the rule. A `vite preview` of the production build (no `VITE_PARTY_HOST`) shows no Play online button, ignores `?court=`, and opens no sockets. The button text and a connection chunk are still in `dist` (the gate is a runtime check), but nothing reaches them.

**Acceptance: Playwright browser contexts on `npm run party` + `npm run dev`:**
- **Listed:** a Court created in one context appeared in the other's list 295 ms after the Create click.
- **Join by clicking:** the second context clicked the row. It left a third observer's list in 227 ms, and both screens started.
- **A full Quick Match:** played with an easy Bot on each side through `dink.drive`. It ended **13–11 at Tick 20762**. The Host showed "YOU 11 / BEA 13" and "BEA WINS"; the Guest showed "YOU WIN". Both showed "Back to map", and clicking it returned to the offline menu with a clean URL.
  - The driver thinks once per Court Tick. A Bot's serve waits for an exact Tick, and a Bot created mid-Serve never serves, so the harness presses Soft for the server.
- **Reload mid-Match:** the Guest reloaded at Tick 2952 and came back on Side 1 at Tick 2993. Later, a Vite hot reload reloaded both screens at 5–4, and both rejoined their seats.
- **Join by link** with no saved name: "Pick a Display name, then join Court STR6K.", with the code filled in. Typing "Dee" and pressing Join seated them on Side 1 and saved the name. The same link in a new tab got "That Court is full." and a clean URL.
- **Join by code**, typed in lower case: seated on Side 1. A made-up code got "There is no Court with that code."
- **The Host leaves before a join:** closing the tab removed the row after 15.3 s. Cancel removed it after 15.3 s and dropped `?court=`.
- **`host_left`:** the Host closed the tab and a Guest joined the still-listed row. The Guest got "The host left." 15.5 s later, back on the list.
- **A Court that stops reporting:** I used the shortened TTL from 05. With `cd party && npx wrangler dev --var LOBBY_TTL_MS:5000`, a Court whose Host was still waiting dropped off an observer's list 12.7 s after the create (the TTL plus up to one 15 s sweep). `wrangler dev` can't kill one Court.
- **Not driven through the UI:** `version` and `bad_name` from the Court. They take the same path as the others, and the handshake smoke covers the server side.

**Decisions where the issue left room:**
- **The Lobby socket is open only while the list is on show.** The waiting view closes it.
- **Only the Host sees the code and link** in the waiting view. A Guest sees "Waiting for opponent…" until `start`, which comes at once.
- **Cancel closes the socket.** The Court closes after the Host's 15 s reload grace, so the row lingers that long, and the Host could click their own row and rejoin as Host (the token stays).
- **A create that resolves after Cancel** leaves a provisioned Court the Host never joins. It stays listed until the 30 s provision grace closes it. This is rare, and it's the Court's existing rule.
- **The default "Guest NNNN" isn't saved until it's used,** so a `?court=` link still asks for a name on a first visit.

**Left as they are (review smells):**
- `createCourt` carries the Worker's error code in `Error.message`, and `main.ts` matches on it.
- `main.ts` now holds the online session: the Court, the attempt counter and the Lobby subscription. An `online/session.ts` could own it if 07–13 grow it further.
