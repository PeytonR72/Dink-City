# 16: Ship online play: deploy the Worker and point the live client at it

Status: ready-for-human
Blocked by: 15

Spec: `docs/MULTIPLAYER.md` Phase 6, Decision 2 (a custom domain was deferred to here); ADR-0004.

**Why `ready-for-human`:** the Cloudflare account login, the deploy, a domain choice, Vercel environment variables and the push to `main` (which Vercel deploys to production) are the user's steps and decisions. An agent running `/implement` does the code and config, then walks the user through the rest (`/wizard` fits) and **asks before each outward step**.

## Read first

- `docs/MULTIPLAYER.md`, and the comments of issues 02–15.
- PokerElo `party/wrangler.jsonc` (its `routes` custom domain), for the pattern.

## Goal

Anyone at https://dink-city.vercel.app can play online.

## Scope

**The user decides first:**
- The custom domain, if any: for example `party.<domain>`, or stay on `*.workers.dev`.
- Whether to add a per-IP limit on `POST /create` for v1.

**The agent prepares:**
- `wrangler.jsonc`: the production name, the domain route if chosen, and the Origin allowlist tightened to the production origins plus localhost for dev.
- `VITE_PARTY_HOST` read at build time. Online play shows in production only when it's set (the gate from 06).
- Abuse basics:
  - Message size and rate caps per socket, if not already done.
  - The `/create` limit, if the user chose one.
  - Double-check that the only public routes are `/create` and WebSocket upgrades (Part 2, "Changed on purpose").
- A smoke script against the live URLs:
  - Create, list, join, play a Rally with two headless clients, and end.
  - Check the Lobby empties afterwards.

**The user does (the agent guides and waits for each):**
1. `wrangler login`.
2. `wrangler deploy` from `party/`.
3. Attach the domain, if one was chosen.
4. Set `VITE_PARTY_HOST` in Vercel.
5. Push to `main`.

**After deploy:**
- Run the smoke script against production.
- Check Worker logs for errors, and DO duration over a test Match (the Tick interval stops when Courts empty).
- Record approximate costs.

## Acceptance

- The live smoke test passes. The user plays a Match between two devices on the live site.
- Offline play on the live site is unchanged.
- `docs/MULTIPLAYER.md`:
  - Phase 6 marked done.
  - The deployed URLs and how to redeploy recorded.
  - The domain decision recorded.
- `CONTEXT.md` still matches what shipped. Update the Online play glossary if anything changed along the way.

## Comments
