# 02: Rules and basic Bot

Status: ready-for-agent
Blocked by: 01
Handoff: `.scratch/v1/handoff-02.md` (read this before starting)

## Goal

A full singles Game against a Bot, with correct scoring and Faults.

## Acceptance

- Serve flow:
  - Players placed automatically after each point
  - server can adjust along the baseline
  - diagonal Serve checked for Service court
- Two-bounce rule, Kitchen faults, in/out, net. Each has Sim tests.
- Side-out scoring to 11, win by 2. Rally scoring and best-of-3 flags.
- Ends switch between Games, and the renderer mirrors the court.
- A Bot that produces Intents only (ADR-0003), with Difficulty parameters.
- A golden test: a seeded Bot-vs-Bot Game is reproducible from its Intents.
- A plain HUD showing score, server and Fault banner text.
