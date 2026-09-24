# 01: Graybox Sim

Status: ready-for-agent

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
