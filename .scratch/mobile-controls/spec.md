# Dink City mobile touch controls

Status: ready-for-agent

Implementation ticket: [01 Mobile touch controls and verification](issues/01-mobile-touch-controls.md)

## Goal and boundary

When playing Dink City directly in a mobile browser, provide a translucent joystick at bottom left and exactly three shot buttons at bottom right: **Lob**, **Hit**, and **Dink**. They replace the need for a keyboard while retaining the existing game and its movement, aim, shot selection, contact, timing, scoring, and balance. This is an input and presentation change, not a new gameplay mode.

This specification was prepared against `C:\Users\ztwis\Desktop\Dink City`, branch `main`, HEAD `f6f2248fbc6a39b3d3689833db0cf55f5a540a68` (phone motion controls). At inspection on 2026-10-15 there were no tracked modifications or staged changes; pre-existing untracked `.playwright-mcp/` logs, PNGs and YAML files must remain intact. Recheck status before implementation; preserve any changes made since inspection. Follow `CLAUDE.md`, `CONTEXT.md`, `docs/agents/issue-tracker.md`, and applicable ADRs, especially 0002, 0004 and 0005.

The specification task authorizes documentation only. It does not authorize app edits, commits, pushes or deployment. The parent will supply the implementation session's separate commit/push authorization. Cloudflare deployment is waiting on user login: do not touch authentication, deployment, Worker bindings/migrations, live environment variables, domains or origins. Local test servers are sufficient for this feature.

## Existing behavior and exact mapping

| Visible touch label | Existing Intent.shot | Existing equivalent | Behavior retained |
| --- | --- | --- | --- |
| Lob | `lob` | L / gamepad Y | High and deep rally shot. During a serve the existing Sim maps any non-Drive selection, including Lob, to the Soft serve. Do not invent a Lob serve. |
| Hit | `drive` | K / gamepad B or X | Regular Drive; a suitable high ball may become a Smash through the existing solver. |
| Dink | `soft` | J / gamepad A | Soft: Dink near the Kitchen, Drop from deep, Block against pace. The label does not force a Dink variant. Soft serve remains short/safe. |

Source anchors, relative to the repository:

- `src/input/keyboard.ts`: one pending shot, first pending press wins (`??=`); key repeat ignored; analog stick deadzone 0.2; sampled `aim` copies `move`.
- `src/input/input.ts`: manual keyboard/gamepad source, Motion source, fallback selection, `clear/reset`, and `keyboardContact`.
- `src/sim/step.ts`: `press`, `serve`, `movePlayer`, `hit`, `variantOf`, `depthFor`; these define the semantics, and must remain unchanged.
- `src/match/local.ts`: reported local contact via `keyboardContact`, replay skip by shot press, offline rematch by shot press.
- `src/net/prediction.ts`: online quantization followed by automatic contact/recommit calculation when raw `contact` is undefined.
- `src/main.ts`: `sampleLocal`, `setMode`, `setControls`, `refreshControls`, `update`, online input callback and match-over panel.
- `src/hud/hud.ts`, `src/practice/practice.ts`, `index.html`: keyboard-specific hints and prompts.
- `src/style.css`: HUD pointer-events, bottom hint, bottom-right control badge, menus and Practice card.

### Preserve movement and aim

The joystick produces a local-screen vector `{x, y}`. Right is positive x; up/toward the net is positive y. Supply the same vector as both `move` and `aim` on every sampled Tick. Horizontal input affects shot direction; positive y increases target depth within the selected Shot type's existing range, and negative y reduces it. Aim is sampled at Contact (or at the serve press), not frozen when a shot is selected. Releasing or centering the joystick returns both vectors to zero; do not retain a last aim direction.

The local Player is always rendered at the bottom, including online Side 1 and switched ends (`src/render/localView.ts`). Do not invert joystick input a second time for those cases. The Sim already transforms local directions to world coordinates.

The existing assist is significant: near a committed incoming ball, `movePlayer` sets `player.aiming` and lets assist own footwork while the input aims. Preserve this automatic transition, acceleration/deceleration, Kitchen protection and all assist thresholds. At serve, existing movement is lateral only even though the joystick's vertical component still adjusts serve depth. Do not add free aim, a second stick, tap-to-aim, target snapping, new auto-move, camera changes, stronger assist or changed player speed.

### Preserve shots and timing

A fresh button press queues one existing shot Intent on pointer down. It is consumed once at the next input sample, just like J/K/L. Holding a button, dragging across another button, releasing it, or the browser's subsequent click must not repeat a shot. Re-tapping after release is a new press. Keep the first pending press if multiple actions arrive before sampling; discard additional presses instead of building a shot backlog.

No charging, hold-to-hit, extra cooldown, delayed release-to-shoot, auto-repeat, buffered serve through the existing serve delay, or contact window is added. An early tap still Commits early; same-type re-press retains that Commit and a different type normally recommits. The exact-Contact-Tick exception remains the existing keyboard-compatible `recommit` behavior. The touch source returns only `{move, aim, shot}`; **omit `contact` and `recommit`**. Do not set even `contact: false`, because that would suppress the existing automatic contact path. Let the current local driver and online predictor fill those fields at their established boundaries.

## Mobile eligibility and Motion separation

Use capability detection, not viewport width alone or a phone user-agent list: `navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse) and (hover: none)').matches`. This includes touch-primary phones/tablets in either orientation. Desktop mouse/trackpad and fine-primary touchscreen laptops keep their present UI and inputs, even in a narrow window. Do not gate on `any-pointer: coarse`, which would opt ordinary touchscreen laptops in. Listen for capability changes; clear touch state before hiding/disabling it. A primary-input change may re-evaluate eligibility. Width changes alone never enable touch controls.

Do not add a persisted `touch` ControlMode or alter saved settings. Existing `keyboard` remains the internal manual-input mode and the default. On eligible mobile clients, its presentation label may be **Touch** (badge **TOUCH**) so users can select the correct controls without a keyboard. Use this alias consistently in the existing Settings row, pause Controls row, manual-mode callout, pairing fallback button/copy and disconnected fallback note. Desktop strings remain byte-for-byte as they are. This is a display alias; keyboard/gamepad support still works if attached.

`controller.html`, `src/controller/phone.ts`, sensor permission/calibration, relay, QR pairing, Swings, Motion tuning, haptics, protocol and active Motion behavior remain unchanged. Do not import the new touch UI into the controller entry or add a sensor/HTTPS permission requirement to direct touch play.

Match the facade's existing effective-source decision: manual input is used when `input.mode !== 'motion'`, or when there is neither a connected Controller nor debug Motion, or when context is absent. On an eligible mobile game page this manual path can use touch, including unpaired Motion's existing manual fallback. When Motion is actually supplying input, hide/disable joystick and shot controls and pass the existing keyboard manual-override Intent to Motion unchanged. Do not feed touch presses into `MotionSource` or turn a tap into a Swing. Preserve saved Motion preferences, `?motion`, M, controller disconnect rules and pairing lifecycle. While the pairing panel is visibly open, suppress and clear touch gameplay controls; its existing Hide panel or Use Touch action restores the appropriate manual path. Opening/closing the panel must trigger this state update explicitly, including its Hide panel handler.

## Layout and visual design

Keep the full existing canvas, camera, score, Practice content, map, assets and game composition. Add a fixed DOM controls layer above the canvas with transparent surroundings. Its root is `pointer-events: none`; only live controls have `pointer-events: auto`. Hidden controls must have no hit targets or tab stops. Use a mobile data attribute/class shared with the eligibility policy to scope every new style. Do not globally restyle `.overlay button`, the canvas, or the existing desktop hint.

| Element | Geometry and placement |
| --- | --- |
| Joystick | Fixed base at bottom left, 128 CSS px diameter; 56 px thumb. Maximum thumb-center travel is 36 px. Center stays fixed during a gesture. |
| Shot cluster | Bottom right, two 68 px columns with an 8 px gap. Top-right: Lob. Bottom-left: Dink. Bottom-right: Hit. Leave the unused top-left cell transparent and noninteractive. Each button is circular or similarly rounded; full label is visible. Hit may use the game's yellow border as emphasis; do not change action order between orientations. |
| Compact controls | For eligible viewports width <= 360 px **or** height <= 400 px: joystick 112 px, thumb 48 px, travel 32 px; action buttons 60 px, gap 8 px. Do not shrink interactive targets below these sizes. |
| Edge insets | Left/right/bottom clearance = 12 px plus the respective `env(safe-area-inset-*, 0px)`. Controls remain inside the visible viewport, above the home indicator and away from notches. |
| Existing control-mode badge | On mobile manual play, place it above the shot cluster with 8 px separation, right-aligned inside the safe inset. Give it at least 44 px height. Long fallback text may wrap within the cluster width, not over the joystick. Hide the debug latency label or reposition that debug-only text above the joystick on mobile to prevent overlap. |
| Existing-menu access | Add one small mobile-only **Menu** button, minimum 44 x 44 px, at top right with 12 px plus safe-area insets. This invokes the existing pause/menu action; it is not a fourth shot button. |

Use the current HUD navy `rgb(20,30,50)` as the control fill at alpha about **0.32** (base/idle), thumb at **0.46**, pressed action at **0.52**. Use a 2 px pale border around alpha **0.8**, full-opacity white text (16 px, weight 800) with a dark text shadow, and a modest dark edge shadow. Hit may have a yellow border. Alpha belongs on fills, not the whole controls layer, so labels stay readable. Show pressed feedback immediately with fill/border change; no pulsing, new effects, opaque backing panel, backdrop blur or disappearing controls while idle. Court lines, moving ball and Player must remain discernible beneath control fills in daylight and sunset scenes.

Both portrait and landscape are supported without an orientation lock, fullscreen request, rotate-screen interstitial or changed camera framing. Keep at least 8 px between left/right control bounds on the minimum 320 px portrait viewport. On resize/orientation change, cancel touch state, recompute bounds, and require fresh presses. Anchor to the visible viewport and handle mobile browser toolbar resizing without leaving controls below it. If adding `viewport-fit=cover` in `index.html`, do not disable user zoom, and ensure mobile HUD positions also respect the resulting safe area. Prefer a small mobile-only layout adjustment over changing renderer sizing/camera code.

Avoid overlap with score, banners and Practice prompts. Menu stays at top right; apply safe insets to the mobile score/Practice card and reserve the Menu button's width plus an 8 px gap in the Practice card's maximum width. Use border-box sizing for that mobile card. Allow its existing text to wrap; do not reduce type or remove instruction content to make room. This is a necessary local adjustment, not a HUD redesign.

## Pointer behavior and lifecycle

Use Pointer Events and pointer capture on the control that accepts a gesture. Maintain ownership by `pointerId`, not `isPrimary` or a single global touching flag: the shot finger is commonly non-primary. One pointer owns the joystick at a time; another can independently press a shot. A second finger starting on the joystick cannot steal it. A pointer that started on a shot never becomes a joystick pointer, and sliding from one shot to another never fires the second one. Capture allows an owned joystick drag to continue outside its base and clamp at maximum displacement until release/cancel.

Compute joystick displacement from the rendered base center, invert DOM y, divide by thumb travel, then clamp radially to unit length. At magnitude <= 0.2 output zero; above it retain the raw clamped analog magnitude (no deadzone rescaling), matching the existing gamepad's deadzone behavior. Move the thumb immediately, reset it on release, and sample movement every Tick. No directional snapping or frame-rate-dependent accumulation.

Set `touch-action: none`, `user-select: none`, and the needed touch-callout suppression on joystick and shot targets only. Prevent default for accepted control gestures as needed; do not install a document-wide touch blocker. Keep panel scrolling, links, text selection/input, map taps and ordinary buttons functional. Empty space in the overlay must not swallow events. Browser compatibility clicks must not generate a second shot; retain a deliberate accessible/keyboard button-activation path without double dispatch (e.g. distinguish non-pointer activation). Use native buttons with accessible names Lob, Hit and Dink, and a joystick group named **Move and aim** with concise instructions. Avoid a misleading single-axis slider role for the two-axis stick.

Release rules:

- Joystick `pointerup`, `pointercancel`, or unexpected `lostpointercapture`: clear its owner and return move/aim to zero. This means neutral input; existing physical deceleration/assist still applies.
- Shot `pointerup`: clear the held visual/owner, but retain its already queued one-shot until sampled, so a very quick valid tap is not lost.
- Shot `pointercancel` or unexpected capture loss: clear its held visual and any unconsumed shot belonging to that gesture. Never undo a shot/Commit already sampled into the Sim. Expected capture loss following a normal pointerup must not cancel that valid tap.
- Joystick release must not cancel an independent shot finger or its pending press. Conversely, releasing a shot must not stop the held joystick.
- Window blur, hidden `visibilitychange`, pagehide, capability loss, resize/orientation change, `Input.clear/reset`, mode/source transitions, opening a blocking panel, starting a new Match or Practice, and entering online match-over: release all touch owners/captures, center the thumb and discard pending touch presses. Require fresh pointer downs after resume; never replay a held gesture.
- At the start/end of a visible Fault Replay, clear prior touch gestures/queued presses to avoid carrying live input into skip or a skip into the next serve. Keep buttons available during the replay itself: a fresh tap uses `LocalMatch.playReplay`'s existing shot-based skip, and that tap is consumed once.

Implement cleanup idempotently: pointerup/cancel/lostcapture may follow each other. Remove event/media-query listeners if a controls instance is disposed. No touch loop should advance the Sim or schedule shots independently of its existing input sampling.

## Availability, menus and copy

| State | Touch controls |
| --- | --- |
| Local Match or Practice in app `mode === 'match'`, effective manual input | Joystick + three shots + Menu. Serve/dead/rally legality is still decided by the Sim. Do not buffer rejected presses for later. |
| Visible offline Fault Replay | Keep three shots for existing skip; joystick cannot move live state during replay. Clear gestures at replay boundaries. |
| Offline match over | Keep shots: fresh tap starts the existing rematch. Menu follows the current Escape path back to map. No new rematch mechanics. |
| Online match over | Hide/clear joystick and shots; use existing Rematch / Back to map panel, unobstructed. Hide the auxiliary Menu button here because navigation is already supplied. |
| Pause / leave confirmation / map / locker / lobby / waiting / connection status / visible pairing panel | Hide and clear gameplay touch controls. Existing UI takes interaction. |
| Active Motion game | Hide/clear joystick and shots. Mobile Menu remains available when a Match is interactive. Motion and its badge continue existing behavior. |
| `controller.html` or ineligible desktop | No new touch layer, hint or Menu button. |

Menu must call the same decision path as `input.pausePressed()` in `main.update`, ideally extracted into a shared small handler: offline pauses, online opens Leave match? while the Court keeps running and local intent becomes STILL, offline match-over returns to map. Resume/Keep playing restores controls with neutral touch state. Do not synthesize Escape/keydown or change online pause semantics.

In mobile manual play, replace the bottom keyboard legend with a small **Move & aim** caption immediately above the joystick; the three visible labels teach the shots. Do not leave a full-width hint underneath either cluster. Keep the desktop legend unchanged.

Update only input instructions, on mobile, at presentation boundaries:

- Replay: **REPLAY · Tap a shot to skip**.
- Offline result: **Tap a shot to play again, or Menu for the map.** Preserve score/result/unlock text.
- Third-shot Practice prompt: replace **You serve (J or K).** with **You serve (Dink or Hit).**
- Dink Practice prompt and unsuccessful-rep feedback: **Soft (J)** becomes **Dink**; retain the existing instruction to drop the third shot and dink at the Kitchen line.
- Free-play Practice prompt: **Esc to leave.** becomes **Menu to leave.**

Use an explicit presentation helper/table for these known strings or prompt IDs, including Practice outcome feedback. Do not rename internal `soft`/`drive` domain types, rewrite rules, or change Practice's feeds/checks. Keep desktop and active Motion instructions unchanged unless an existing manual-fallback string needs the mobile Touch alias.

Current visual inspection found the map menu clips vertically at 844 x 390: `.overlay` becomes scrollable only below 700 px width. For eligible mobile menus in short landscape, extend the existing top-aligned, vertically scrollable treatment to reach every current button. Keep menu content/order, map camera and styling intact. Scope this to actual full-screen menus, not `#online-over`, and let nested lists/pairing retain their own scrolling. Do not use a full-page touch prevention rule that defeats this fix. Existing narrow-menu pin sizes are not an invitation to redesign the map.

## Implementation shape

Prefer a small `src/input/touch.ts` source with independently testable joystick math and press ownership/queue state, plus `src/input/touchControls.ts` (or similarly scoped UI module) for DOM/pointer handling and eligibility. A small shared presentation helper can supply mobile input labels/prompts. Keep these independent of Three.js and Sim mutation.

Extend the `Input` facade to sample the manual sources and clear/reset touch with its existing lifecycle. When touch is not enabled, return the existing keyboard sample unchanged. When it is enabled: an owned joystick supplies both move and aim, even when centered; otherwise use keyboard/gamepad movement and aim. For a same-sample collision, use `keyboard.shot ?? touch.shot` and consume/discard the losing pending press, so no delayed second action occurs. This is only arbitration for simultaneously attached inputs; standalone touch retains first-pending-press semantics. Active Motion's source path must remain unchanged.

Wire visibility/enablement to existing app state in `main.ts`, including pairing show/hide, `setMode/setControls`, replay callbacks and online-over transitions. UI visibility and source acceptance must use one policy, so hidden controls can never keep producing input. Existing `sampleLocal` should serve offline, Practice and online without parallel game logic. Do not mutate SimState, set `dink.drive`, or dispatch synthetic key events in production.

Expected scope: new touch source/UI/tests; narrow integration in `src/input/input.ts` and `src/main.ts`; mobile-only styles in `src/style.css`; conditional strings in HUD/menu/pairing presentation; optional viewport metadata; documentation. No gameplay changes in `src/sim`, `src/tuning.ts`, Bots, `motionTuning`, replay engine, renderer/camera, `src/net` protocol/codec/prediction, or Worker. No dependency is needed. Existing SIM_VERSION 2 and PROTOCOL_VERSION 9 stay unchanged.

## Verification and acceptance checklist

These are required implementation checks, not claims that the feature has already been built or tested. Run CPU-heavy unit and browser suites sequentially, following `docs/MOTION-CONTROLS.md`.

### Input and integration tests

- [ ] Pure joystick tests: center; exactly 0.2 deadzone; just outside it; partial deflection; all four cardinal directions; diagonal normalization; beyond radius; return to center. Assert `aim === move` by values each sample and independent objects if mutation is possible.
- [ ] Every label emits its exact ShotType once on pointer down; hold/move/up/compatibility click do not repeat. Valid quick down/up before sample survives. Two actions before one sample select the first; a later fresh tap works. Canceled unsampled action is dropped without canceling another gesture.
- [ ] Two distinct pointer IDs move and shoot concurrently, including a non-primary shot finger. Second joystick finger cannot steal; moving a shot finger over another button cannot trigger it. Drag outside and release/cancel/capture loss leave no stuck input.
- [ ] Lifecycle tests cover blur, pagehide, hidden visibility, rotation/resize, capability change, mode toggle, pairing open/hide, pause/resume, quit/re-enter, reset, replay boundaries and online-over. Next sample is neutral with no stale shot; no accidental serve/skip/rematch leaks. Assert neutral Intent rather than instantly zero Player velocity.
- [ ] Equal manual Intent traces produce equal state/events through existing driver/predictor: include an early Commit, same-type repeat, different-type recommit, exact-contact re-press, serve and near-ball aiming/assist. Verify touch raw Intent has no own `contact`/`recommit` field. Reuse meaningful fixtures from `test/motion.test.ts`, `test/contact.test.ts`, `test/localMatch.test.ts` and prediction tests instead of changing expected gameplay numbers.
- [ ] Default desktop path, keyboard repeat behavior, keyboard/gamepad pause and Motion manual override stay unchanged. Unpaired mobile Motion can fall back to touch after hiding pairing; paired/debug Motion disables it; returning to manual is neutral. No new controller connection or permission prompt occurs for normal direct touch play.

### Real browser tests

Add `e2e/mobile-controls.e2e.ts` with touch-capable contexts (`hasTouch`, mobile emulation and appropriate primary-pointer media), not just resized desktop pages. Use the existing `window.dink` deterministic helpers to inspect Intents/state/Commit/events. At least one browser test must use real touch event dispatch with two simultaneous contacts and real pointer capture (Chromium CDP `Input.dispatchTouchEvent` is suitable); synthetic PointerEvents alone cannot prove browser capture/scroll handling. Keep pure logic tests separate from device claims.

- [ ] On `/?play`, default mobile starts with touch without pairing; after the existing serve delay, tap each label in a fresh seeded match and verify the selected type, including the existing Lob-to-Soft serve mapping. During a rally verify Dink -> soft and Hit -> drive, not inferred solely from a serve animation.
- [ ] Hold joystick while tapping each shot; change direction between Commit and Contact and verify the later aim. Release and verify neutral aim. Include diagonal and analog movement; verify near-contact assist behavior, rather than expecting input to always move the Player.
- [ ] Test offline Pause/Resume/Quit using touch only, Practice start and changed instructions/feedback, replay tap-to-skip without next-serve leakage, and offline match-over tap-to-rematch.
- [ ] Local online two-browser test with touch on Host and then on Guest/Side 1: movement is screen-relative, one serve/Commit reaches the other client, normal prediction/contact path works, Leave match? sends STILL while the Court continues, and online match-over/rematch uses existing buttons. No Worker deployment required. Verify switched-end direction with a deterministic existing state fixture if completing best-of-three is too costly.
- [ ] Desktop 1280 x 720 and narrow 390 x 844 with no touch: no controls, no changed labels or layout. Fine/hover-capable touchscreen desktop also stays unchanged. Tablet touch-primary landscape remains eligible. `controller.html` remains a separate unchanged page; run existing Motion e2e coverage.
- [ ] Portrait 320 x 568 and 390 x 844; landscape 568 x 320 and 844 x 390; touch tablet 1024 x 768. Assert control bounding boxes remain on screen, touch targets meet sizes, left/right clusters do not overlap, and no control blocks Menu, score, prompts or results. Rotate during a held gesture and verify reset and working new gestures.
- [ ] Menus/lobby text fields, map taps and vertical scrolling work without moving/serving in the background. Landscape map settings and Locker remain reachable by scroll. Gameplay gestures do not scroll/zoom/select text; menu gestures retain normal browser behavior.

### Visual evidence and regression policy

- [ ] Inspect new mobile screenshots in portrait and landscape: Park daytime and sunset; at least one Rooftop/Beach scene; pressed and resting controls; Practice; replay/result; paused/menu/pairing/online-over states. Show enough underlying court/Player detail to judge transparency. No button label clipping or screenshot-only masking of the new UI.
- [ ] Keep existing seven desktop reference images in `e2e/__screenshots__` unchanged: park, rooftop, beach, their sunset variants, and map. Keep the existing 0.02 image-diff tolerance and performance budgets. The new mobile overlay should cause **no intentional desktop screenshot change**.
- [ ] New mobile references intentionally differ from current UI: joystick/three buttons, local Move & aim caption, Menu button, moved manual-mode badge/Touch alias, applicable prompt text, safe-area/Practice-card spacing, and reachable short-landscape menus. Record each accepted difference and viewport in ticket Comments. These are the only planned visual changes; preserve court rendering.
- [ ] If a pre-existing screenshot fails, compare the same environment at the untouched inspected HEAD using an isolated temporary baseline if necessary, without resetting the user's checkout. Record the actual cause and difference. Do not run global `--update-snapshots`, replace desktop references, mask the UI, loosen tolerances, or accept unrelated rendering drift to get green tests. Add/approve only named mobile baselines after visual review.

### Commands and physical-device boundary

- [ ] `npm run typecheck` (browser and party projects).
- [ ] `npm test` (preserve deterministic/golden expectations; existing recorded-human Motion skip is unrelated and must remain explicit).
- [ ] `npm run build` (including the separate controller-entry dependency guard).
- [ ] Targeted new browser tests, then `npm run e2e` including venues, Practice, online and Motion. Existing Playwright config starts Vite on 5174 and local Wrangler on 8797, serial workers. Confirm any reused server has the matching local `VITE_PARTY_HOST`; do not accidentally test against a live service. No extra repeated full run is needed after a clean unchanged run.
- [ ] Physical iPhone Safari and Android Chrome: simultaneous thumb movement/shots, safe areas/home indicator, both orientations, browser bar resize, edge gestures, tab switch/lock interruption and long press. This validates browser/device delivery, not new game balance. Record device/browser and result; if unavailable, explicitly mark this acceptance unverified rather than claiming emulation proves it. No need to request gyro permission or redo Motion human-trace collection for this feature.
- [ ] Final diff/status includes only intended changes; original `.playwright-mcp/` files and any later user edits preserved. Document results, intentional mobile images and remaining failures in the ticket before handoff. Commit/push only under the implementation session's parent authorization; never deploy Cloudflare as part of this task.

## Inspection evidence and remaining decisions

Source inspection and local Playwright Chromium screenshots were completed against the checked-out source at `http://127.0.0.1:5185`, with fresh browser contexts. Desktop 1280 x 720, mobile 390 x 844 and 844 x 390 gameplay, both mobile menu orientations, and portrait Practice loaded with no page errors. Screenshots confirmed the portrait keyboard legend/badge overlap, full-canvas court composition, Practice card position and short-landscape menu clipping. The stock mobile views have no joystick or shot buttons. Capture evidence is in `C:\Users\ztwis\Documents\Codex\2026-10-15\task-5\ui-inspection\` (`report.json` and six named PNGs); these are inspection artifacts, not new approved test baselines.

No essential product question is unanswered. The choices above are implementation defaults within the requested scope. No feature code or test baselines were changed during specification. Physical device acceptance remains future implementation verification; pending Cloudflare login/deployment is separate and does not block local touch-control implementation.
