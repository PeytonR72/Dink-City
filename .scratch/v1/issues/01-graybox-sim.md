# 01: Graybox Sim

Status: resolved

## Goal

A box Player on a real-size court can hit a ball back and forth against a wall or a trivial Bot. The Sim is pure and tested headless.

## Acceptance

- Vite + TypeScript + three.js project scaffolded. Vitest configured. Playwright MCP available for screenshots.
- `src/sim/` exports `step(state, intents)`, runs at a fixed 60 Hz Tick with a seeded RNG in state, and has no three.js imports (enforced by a lint rule or a test).
- Court, Kitchen and net have real dimensions.
- Ball physics: gravity, drag and bounce, with each Shot type's spin applied as a fixed property.
- Shot solver: Soft, Drive and Lob land at their targets within tolerance (tested).
- Keyboard and gamepad map to Intents. Free movement, with the contact assist.
- Renderer interpolates between states.
- Camera matches the spec, including the ball's drop shadow.
- `tuning.ts` exists, and the `?debug` Tweakpane panel is wired to it.

## Comments

**2026-09-23 (Claude):** Done.
- Sim in `src/sim/` (`step`, physics, shot solver, seeded RNG).
- 10 Vitest tests, including a boundary test that fails if the Sim imports three.js or uses non-deterministic APIs.
- Renderer: `src/render/renderer.ts`. Input: `src/input/input.ts`. Trivial Intent-only Bot: `src/bot/basicBot.ts`.
- `?debug` Tweakpane panel is dev-only and verified absent from the production bundle.
- Playtested in Chrome: a scripted 15-shot rally with drives, soft shots, lobs and volleys.
- Dev hook for playtests: `window.dink.advance(ticks, drive?)` steps the loop synchronously (rAF pauses in hidden tabs).
- Not verified: gamepad (no device available). Playwright MCP is configured but needs a Claude Code restart to load, so Claude-in-Chrome was used for playtesting.
- Serve rotation is a placeholder (alternates every point). Real scoring and Faults are issue 02.
