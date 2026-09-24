# 07: Bot difficulty

Status: ready-for-agent
Blocked by: 03

## Goal

Bots are beatable. From the 03 playtest: every Bot is "way too good". It always hits where you are not, gets perfect power, and goes to your shot with no hesitation. The user scored 3 points in 2 Games against medium.

## Acceptance

All knobs live in `Difficulty` (easy, medium, hard) and in the `?debug` panel. Human movement (`playerSpeed`, `playerAccel`) is unchanged.

- **Aim width:** Bots aim less close to the lines. `aimNoise` is larger.
- **Late and off-center hits:** a chance each ball of committing late, and setting up off the sweet spot. The Shot quality model then weakens the shot.
- **Slower first step:** longer `reactionTicks`, and a Bot-only top speed fraction.
- **Unforced errors:** a small chance each ball of going for too much.
- Measured: an easy Bot (a stand-in for a human) scores a real share of points against medium.
- The golden result is re-pinned on purpose.

## Comments

**2026-09-24 (Claude):** Implemented; waiting on the user's playtest.
- New `Difficulty` fields, all with `?debug` sliders (folder "Bot"):
  - `moveSpeed`: Bot top speed as a fraction of `playerSpeed` (0.75 / 0.9 / 0.95). Bots also plan with it.
  - `aimWidth`: Bots aim at 40–100% of this, away from the opponent (0.4 / 0.5 / 0.85). `aimNoise` is up (0.45 / 0.3 / 0.15).
  - `lateCommit`: chance per ball of a late Commit, timed 5–18 Ticks before the ball comes within reach.
  - `offCenter`: chance per ball of setting up 0.5–0.8 m to the backhand side and committing 6 Ticks before reach.
  - `unforcedError`: chance per ball of going for too much (off-center, last moment, aimed at the far corner).
  - `reactionTicks` is up (24 / 14 / 8).
- Measured with Bot-vs-Bot runs (4 Games each, throwaway):
  - A full-speed "human stand-in" (medium with worse reads, aim and timing) vs medium: 31–37 in points. Before: an easy Bot vs medium scored 1 point in 3 Games.
  - Medium mirror: about 8 hits per Rally (9.5 before).
  - Easy vs medium 1–44 and medium vs hard 1–44, so the tiers are still steep.
- Limits found:
  - The contact assist fixes most of an off-center setup during the Commit window (as it does for humans), so `offCenter` mostly weakens shots through the late Commit.
  - Unforced errors roughly double or triple a Bot's out/net rate but are mostly weak, attackable balls, because the Sim clamps the aim target inside the court. Real outright errors would need a Sim change (ADR-0002), which is the user's call.
- Golden result re-pinned on purpose: 11–5 at tick 20188 (was 14–12 at tick 57041).
