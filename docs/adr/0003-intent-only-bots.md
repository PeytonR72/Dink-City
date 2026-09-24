# ADR-0003: Bots produce Intents only

Status: accepted (2026-09-23)

## Context

Bots could either change Sim state directly or act through the same input path as humans.

## Decision

A Bot is a function `(observedState, botMemory) → Intent`. It cannot write to Sim state, and it sees only what a player could see: ball position and velocity, and Player positions. Its prediction of the ball's path uses its own noisy estimate, not the Sim's exact trajectory.

- **Difficulty** comes from reaction delay, prediction error, aim noise, shot-choice accuracy, and kitchen discipline.
- **Personality** is a weighting over Shot types and targets (Banger, Dinker, Lobber), set per Venue.
- The Practice mode ball machine uses the same interface.

## Consequences

- Bots are fair by construction, and they exercise the same code path as human input.
- Bots can later fill empty seats in multiplayer without any changes.
- Bot behavior is fully deterministic given the RNG seed, so Bot Rallies make useful golden tests.
