# 05: Dink City shell

Status: ready-for-agent
Blocked by: 04
Handoff: `.scratch/v1/handoff-05.md` (read this before starting)

## Goal

The complete v1 meta-game around matches.

## Acceptance

- A Dink City map menu (DOM/SVG) with 3 Venues (Park, Rooftop, Beach). They unlock in order, and progress is saved in localStorage (reads and writes wrapped in try/catch).
- Each Venue has a Bot Personality (Banger, Dinker, Lobber), a lighting setup with a sunset option, and its own ambience.
- Player color customization is saved in localStorage.
- Practice mode: a ball machine that feeds shots through the Intent interface, with step-by-step prompts that teach the Two-bounce rule and Kitchen faults.
- Fault Replay: a short playback from recorded Intents after each Fault.
- Settings: rally scoring, best-of-3, and the Bot Difficulty.
