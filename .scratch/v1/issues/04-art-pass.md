# 04: Art pass and first Venue

Status: ready-for-agent
Blocked by: 03

## Goal

Replace the graybox art with final-style models for one Venue (Park).

## Acceptance

- `art/scripts/*.py` generate:
  - the Player (1:3 proportions, rigid parts, beveled, vertex colors)
  - the paddle, net and posts
  - the court
  - Park props
- The exported `.glb` files are committed.
- Each model is checked with a Blender viewport screenshot before export.
- The in-game result matches the spec's art style. Screenshots are compared with Playwright.
- Performance budget met, measured on the Park Venue.
- Park ambience (CC0) in place.
