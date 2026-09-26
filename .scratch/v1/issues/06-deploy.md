# 06: Deploy to Vercel

Status: resolved
Blocked by: 05

## Goal

v1 is live on Vercel.

## Acceptance

- Vercel project connected to the GitHub repo. Linking the account and project is the human step.
- The production build excludes the debug panel and overlays.
- Asset size is under the budget, and a smoke test passes against the deployed URL.

## Comments

**2026-09-25 (Claude):** Done. Live at https://dink-city.vercel.app.
- Vercel deploys from `main` on GitHub (`PeytonR72/Dink-City`): pushing 6a6a2df put a new build live in about 30 seconds.
- No debug code in the production bundle; `?debug` shows no panel on the live site (`src/main.ts` gates it on `import.meta.env.DEV`).
- Assets: about 2.9 MB if every Venue is loaded (JS 681 KB, 184 KB compressed; `map.glb` is the largest at 845 KB), under the 5 MB budget.
- Smoke test against the live URL (a throwaway Playwright script, not kept in the repo): the map loads, the Park starts a Match and a Rally plays out, the Practice machine serves, no console errors, no failed requests.
