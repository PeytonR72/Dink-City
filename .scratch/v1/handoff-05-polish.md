# Handoff: more polish after the 05 playtest (before issue 06)

Written 2026-09-24, after the six playtest fixes in `handoff-05-fixes.md` landed (commits `874f121` … `72f63e9`; the user confirmed they "landed smoothly"). The user has five more requests. **Do all five, then move on to issue 06** (`.scratch/v1/issues/06-deploy.md`) unless the user says otherwise. Nothing below has been started.

## Read first

1. `CONTEXT.md`: the glossary. Use its terms (Side, End, Rally, Fault, Replay, Venue, Difficulty).
2. `docs/adr/0001`–`0003`:
   - The Sim is pure and fixed-tick; presentation (HUD, animation, sounds) never goes inside it.
   - Bots produce Intents only.
   - Shot quality and Commit timing work as ADR-0002 describes.
3. `.scratch/v1/issues/05-dink-city-shell.md`, including all of `## Comments`: what 05 built, and the notes on the playtest fixes.
4. `.scratch/v1/handoff-05-fixes.md`, the "Conventions and gotchas" section, plus `.scratch/v1/handoff-05.md`, the "Tooling and environment gotchas" and "Working with this user" sections. They all still apply.
5. `.scratch/v1/handoff-03.md`, "Conventions and gotchas": coordinates, End-keyed helpers, the golden test.

## State of the repo

- **Branch:** `main`, clean. The playtest-fix commits (`874f121` … `72f63e9`) are local only. **Ask before pushing.**
- **Tests:** 149 Vitest tests (`npm test`) and 11 Playwright checks (`npm run e2e`, which runs its own dev server on port 5174). All green.
- **Golden test:** `test/bot.test.ts` pins `{ points: [11, 6], tick: 30485 }` with hard Bots (hard is the old medium). A Sim tuning change (item 4) will move it. Update it deliberately and tell the user.
- **The user's dev server** is on port 5173, with their own settings and progress in localStorage. Don't clear them.
- **Art:** `npm run art -- <name>` runs headless Blender 5.2. The build script only echoes lines that contain `[art]` or `Error`, so raise a `RuntimeError` to make a failure visible. Previews go to `art/previews/`.
- **e2e references:** after any visible change, re-accept them with `npx playwright test --update-snapshots=all -g <venue>`. Use `=all`: plain `--update-snapshots` skips images within the 2% tolerance and leaves stale references (this happened with `rooftop-sunset.png`). Look at every new PNG.

## The requests

Suggested order: 3, 2, 4, 1, 5. The small, sure fixes come first and the big one last. Commit each concern separately; the user likes small commits.

### 1. Beach: props overlap (towels inside trees)

> "there are overlapping assets on the beach. for example, beach towels inside of trees. fix those instances."

- **Where:** `art/scripts/beach.py`, `build()`: the palms, umbrellas with their towels, grass, rocks and the lifeguard towers. Props come in turned pairs: `turned(x, z)` gives (x, z) and (−x, −z).
- **Found while writing this (these are hand calculations, so verify them):**
  - The umbrella at (−8.2, −3.0) puts its towel at about (−9.1, −2.4), running z −3.3…−1.5. The palm at `turned(9.0, 1.5)`, which is (−9.0, −1.5), stands on that towel.
  - The umbrella at `turned(8.8, -4.5)`, which is (−8.8, 4.5), puts its towel at about (−9.7, 5.1). The palm at (−9.3, 5.5) stands in it.
  - The umbrella at `turned(-9.6, 1.0)`, which is (9.6, −1.0), sits under the fronds of the palm at (9.0, 1.5).
  - Also check the grass tufts (`turned(9.0, -2.0)`, spread ±1.4 × ±5 m) against the towels and umbrellas, and the rocks and lifeguard towers against the palms.
- **Fix:** move whatever clashes. Then add the same guard the Rooftop got in `17ac95a`: record every footprint, including turned partners, and fail the build on any overlap. See `check_footprints` and `props()` in `art/scripts/rooftop.py`.
  - Better still, move `turned()` and the footprint check into `art/scripts/lib.py` so both Venues share them. This also removes a smell left over from the 05 review: `turned()` is duplicated in both scripts.
  - Footprints:
    - a palm's trunk needs only a small footprint, but its fronds reach about 1.7 × scale
    - a towel is 0.9 × 1.8 m, rotated slightly
    - an umbrella canopy has a radius of about 1.15
  - Decide whether a canopy may overhang a towel. Under its own umbrella it's meant to; under a palm it isn't.
  - Keep the `rng` draw order unchanged if you can, or everything drawn after (frond angles, grass jitter, towel angles) shifts.
- **Check:** `npm run art -- beach`, then look at `art/previews/beach.png` and `beach-wide.png`. Re-accept the Beach references and look at them.

### 2. "NET CITY" for net Faults

> "when either you or the opponent hits the net, the text that pops up on screen should be "NET CITY" with one word coming in at a time for emphasis ("NET" pops in first then "CITY), and after that double animation, text should rollout under using a typing animation that says "The ball actually needs to go OVER the net." This adds a bit of humor, it is an inside joke my friends and I have"

- **Where:**
  - `src/hud/faultText.ts`: the `net` entry is `{ title: 'NET', detail: "Your/Their shot didn't clear the net." }`.
  - `src/hud/hud.ts`: `onEvents` shows the banner (`#banner` holds `#callout` for the title and `#detail`) through `show()`.
  - `src/style.css` holds the banner styles and the `#shout` pop keyframes; reuse that feel.
- **Behaviour wanted:**
  - This applies to any Rally that ends with `reason: 'net'`, whoever lost. Serves into the net should also end as `net`; confirm in `src/sim/step.ts`.
  - The title shows "NET" first, then "CITY", as two separate pops.
  - After both pops, the detail line types out "The ball actually needs to go OVER the net." Keep "OVER" in capitals, exactly as the user wrote it. The same line is used whichever Side hit the net.
- **Watch for:**
  - **Replay:** a net Fault gets a Fault Replay. The banner stays up during the Replay (`setReplay`), and `hud.update` returns early meanwhile. The animation must not restart when the Replay starts or ends, and the typing mustn't freeze or be cut off. Test it with a forced net Fault (see "Checks" below).
  - **Banner timing:** `BANNER_SECONDS` is 2.2 s. The two pops plus typing will probably need longer; make the banner last until the typing ends plus a beat.
  - **Side out:** `appendDetail` adds "Side out." and similar to the detail line on the same Tick. Decide how that combines with the typed line. For example, append it after the typing finishes, or show it on its own line.
  - **Practice:** Practice mode also uses `faultText` for the Player's Faults (`practice.ts` → `hud.banner`). Recommend using NET CITY there too, and tell the user.
  - **Animation only:** this is presentation only, so drive it from CSS and DOM timers in the HUD, never from the Sim. Respect `prefers-reduced-motion` by showing the final text without the animation.
- **Tests:** `faultText` is plain data; update any test that pins the `net` text (search `test/` for `didn't clear`). The animation needs a manual or browser check.

### 3. A stray "WINNER" when a Match starts

> "The "winner" text appears when you start a game before anything happens. Remove that."

- **Where:** `src/hud/callout.ts` (`calloutFor` returns 'WINNER' or 'SMASH!'), `src/hud/hud.ts` `shout()`, and the `#shout.pop` animation in `src/style.css`.
- **Cause (hypothesis, strongly suspected; confirm before fixing):**
  1. `shout()` leaves the last call-out's text in `#shout` and the `pop` class on it.
  2. On the map, `body[data-mode='menu'] #hud { display: none }` hides the HUD.
  3. When the next Match starts, `display` comes back, and the browser restarts the CSS animation.
  4. So the previous Match's last call-out pops again at the start of the new one. That is usually "WINNER", since most Rallies end on one.
- **To confirm:** play a Rally that ends on a winner, press Esc and quit to the map, then start any Venue. "WINNER" should pop with no event. A first Match after a fresh page load should not show it.
- **Fix:** `Hud.reset()` (already called from `newMatch` and `startPractice`) should clear `#shout`: empty its text and remove `pop`. Also consider clearing it when the mode leaves `match`, since pause and resume toggle the scoreboard only, not `#hud`.
- **Check:** in a browser, with `window.dink.frames(n)` if the tab is hidden. Add a Playwright check if it's cheap: finish a Rally, go to the menu, start a Match, and assert `#shout` is empty.

### 4. Lob error: more off smashes and mis-timed hits

> "Lob error should be increased about 20% from now on opponent smashes and about 10% on mis-timed hits"

- **Where:** `hit()` in `src/sim/step.ts`. The aim error is:

  ```
  spread = moveAimError * running + qualityAimError * weak²
  ```

  Here `weak = 1 − quality`, and quality is the product of the factors `set`, `timing`, `height` and `pace` (see `qualityFactors`). `spread` jitters both `target.x` and `depth`. The tuning is in `src/tuning.ts` (`simTuning`) and the types in `src/sim/types.ts`. The debug panel exposes `simTuning` live.
- **Ask the user first; it's ambiguous.** Suggested reading, as options with a recommendation:
  - **A (recommended):** when the Player hits a **Lob**, its `spread` is ×1.2 if the incoming ball was the opponent's **Smash**, and ×1.1 if the Commit was **mis-timed** (`factors.timing < 1`). If both apply, multiply to about ×1.32. Lobs only.
  - **B:** raise every Lob's error by 20% or 10% in those cases, but apply it to other shot types too.
  - Also ask whether "error" means aim spread (the recommendation) or should also lower depth (`weakDepth`) or apex.
  - Ask too whether it applies to Bots. It will, since both Sides share the Sim, which is fair.
- **Knowing the incoming shot was a Smash:** the Sim keeps it on the hitter's `player.swing` (see `observe.ts`, `lastVariant: hitter?.swing?.variant`). Read it from the opponent's player in `hit()`. Keep it pure: no new randomness beyond the existing `random()` draws, or the golden test's replay breaks.
- **Tuning:** add named fields (for example `lobSmashError: 1.2` and `lobRushedError: 1.1`) to `SimTuning`, `simTuning` and the debug panel, rather than magic numbers.
- **Tests:**
  - Extend `test/aim.test.ts`, which already covers the aim error model: a Lob off a Smash spreads more than the same Lob off a Drive, and a rushed Lob spreads more than a well-timed one.
  - The golden pin will move; update it deliberately and tell the user.
  - Re-run `test/bot.test.ts` and `test/personality.test.ts`; the Lobber's win rate may drop. The rates are in the comment in `src/bot/personality.ts`, so re-measure them.

### 5. The home-page map as a tilted tabletop Dink City

> "regarding the map on the home page: Have Claude build a small tilted tabletop version of Dink City: a few low-poly buildings with a rooftop court on one, a park with the same trees as your background, and a strip of beach and water. Kenney's CC0 City Kit and Nature Kit (GLB) give you matching buildings and props, so Claude only has to model the three venues. Then you choose between two approaches. You can render it live in three.js, so it idles with swaying trees and water and a camera that slides to each venue on hover. Or you can bake it to a PNG in Blender, which is cheaper and simpler. Live is more fun and looks more professional. Baked is fine if performance on the menu matters."

- **Ask the user first: live or baked?** The request leaves the choice open. Recommend **live**. The user's own words lean that way, and the menu isn't performance-critical: it only has to stay within the spec budget of about 150 draw calls and 50k triangles. Mention the cost: a second small scene, a slightly bigger first load, and new idle animation. Settle this before building, and agree slices, for example: 1) diorama model, 2) the map scene with pins, 3) idle animation and hover camera.
- **What's there now:** `src/menu/map.ts` is an SVG city (`CITY_SVG`) with DOM `<button class="pin">` per Venue, placed by percentages in `PINS`. It shows lock state, stars per Difficulty (`refresh(progress)`) and a blurb; `focusFirst()` gives keyboard focus. `src/menu/menu.ts` mounts it, and `main.ts` `setMode('menu')` shows it while the renderer draws the court behind (`renderer.render(prev, curr, 1, dt)` in `update`). Keep all of this: the pins, locked state, stars, blurbs, keyboard focus and the e2e test "the map opens first, with only the Park open…" (`e2e/venues.e2e.ts`). The pins can stay DOM buttons positioned over the 3D Venues (project each Venue's world position to the screen every frame), which keeps accessibility and the tests.
- **Assets:**
  - **Kenney City Kit and Nature Kit.** They're CC0, from kenney.nl; there are City Kit variants (Commercial, Suburban, Roads), so pick what fits.
    - Download them yourself, and ask the user if the network is blocked.
    - Keep only the GLBs you use, under something like `art/vendor/kenney/`, with the license text and a note of which pack and version they came from.
    - Check that their palette sits with the game's flat-shaded vertex-color style (`art/palette.json`). Kenney kits use a texture atlas or materials, so you may need to recolor them or accept the difference; ask the user if it clashes.
  - **Model the three Venues in miniature** in Blender (a new `art/scripts/map.py`, wired into `art/build.mjs`'s list after the Venues), reusing `lib.Builder`:
    - the Rooftop court on one building (the chain-link fence, the AC units)
    - the Park with "the same trees as your background": reuse the tree builder in `art/scripts/park.py`
    - a strip of beach and water: reuse `Builder.strip` and the shoreline bands from `beach.py`
  - Export as one mesh where you can, as the Venues do.
- **If live:**
  - Render with its own small scene, or reuse `Renderer` and swap the scene in menu mode. Don't also draw the court behind it.
  - Use a tilted perspective or orthographic camera.
  - Hovering or focusing a pin (mouse, keyboard or gamepad) eases the camera toward that Venue.
  - Idle animation: swaying trees and gently moving water. The renderer has no vertex animation yet. Keep it cheap (a few rotating tree groups, or a small shader offset on the water), and have it stop when the menu is hidden.
  - Lazy-load the map scene like the other Venues (`src/venue/assets.ts`). Check the first-load size in `npm run build`. It's about 1.1 MB now, three.js being most of it.
- **If baked:** render the diorama in Blender to a PNG (see `preview_from` in `lib.py`) at 1280×720 and 2×. Use it as the map background in place of `CITY_SVG`, and move `PINS` to match.
- **Checks:**
  - A Playwright reference screenshot of the map. It will need re-accepting, and the existing "map opens first" test must still pass.
  - Add the map to the performance budget test.
  - Test sunset or not? The map probably ignores sunset; ask if unsure.

## Checks for the whole batch

- `npm run typecheck`, the single test files as you go, then `npm test` and `npm run e2e` once at the end. `npm run build`, then check that `dist/assets/*` has no `tweakpane`.
- **To force a net Fault:** drive Side 0 with a Bot (see handoff-03), or aim a Soft shot low from deep. Watch the banner through the Replay with `window.dink.frames(n)`.

## When done

- Append a `## Comments` entry to `.scratch/v1/issues/05-dink-city-shell.md` with the changes and commits.
- Give the user a short list of what to playtest, each item with its URL flag:
  - `?play&venue=beach` for the props
  - a net Fault in any Match, for NET CITY, including during the Replay
  - finishing a Rally, going back to the map and starting again, for the stray WINNER
  - lobbing off a Smash, and a rushed lob, for the lob error (the debug panel shows the new tuning)
  - the map on `/`
- Then move on to issue 06.
