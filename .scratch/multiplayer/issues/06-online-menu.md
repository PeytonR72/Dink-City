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
