# Motion controls: runbook and acceptance

Implemented in the existing Windows checkout at C:\Users\ztwis\Desktop\Dink City, based on main ea86ee3. The supplied spec and tickets are preserved from the existing motion-controls-spec branch ef4e9a6. No alternate checkout replaced the user's working tree. Pre-existing .playwright-mcp files are untouched.

## Run locally

1. Install root and party dependencies if absent: npm install, then npm --prefix party install.
2. Start the relay in one terminal: npm run party.
3. Start the browser app in another: npm run dev.
4. Open http://localhost:5173/?play&motion&debug. Press Space to inject a synthetic Drive Swing; M switches controls. In dev, window.dink.swing('soft' | 'drive' | 'lob', { x: 0, y: 0 }) is available for scripted play. Keyboard remains active while waiting for a phone.
5. For real hardware, expose BOTH Vite and Wrangler using your existing HTTPS tunnel setup. Set VITE_PARTY_HOST to the relay tunnel hostname (no scheme or path) before starting Vite. Open the HTTPS game URL on the laptop, then scan its Pair code on the phone. A localhost relay address points at the phone itself and will not work remotely.
6. For a tunnel/preview browser origin, start local Wrangler with CONTROLLER_DEV=true and EXTRA_ORIGINS containing the exact HTTPS game origin, comma-separated if needed. Example from party/: npx wrangler dev --var CONTROLLER_DEV:true --var EXTRA_ORIGINS:https://your-game-tunnel.example. These variables are deliberately absent from checked-in production vars. They only affect Controller websocket upgrades; Court/create retain their production/localhost policy. No permissive wildcard, live origin or credential changes are needed for local testing.

Phone motion needs a secure context; plain HTTP on a LAN is insufficient. Tap Enable, hold the phone like a paddle, choose hand, tap Ready. Recalibrate closes the phone session and clears gesture history before recording a new neutral position. Hiding the phone page releases its wake lock and disconnects, requiring an explicit reconnect. Android vibration is optional; absence of vibrate does not block play. Wake lock is best-effort ([browser API reference](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)).

## Verification commands

- npm run typecheck — both browser and worker projects.
- npm test — deterministic unit/netcode tests, synthetic gesture tests, and recorded-human gate.
- npm run build — both Vite entries; build plugin verifies the phone dependency graph excludes three.js, tweakpane and game modules.
- npm run e2e — browser flows and unchanged reference screenshots against local Vite/Wrangler.
- npm --prefix party run smoke:controller — local relay handshake, Swing forwarding, latest-phone replacement and screen expiry (Wrangler must be running). Append a local base URL for a nondefault port.

Run CPU-heavy unit and SwiftShader browser suites sequentially. Running them together caused existing five-second unit timeouts and a camera screenshot stabilization timeout; no test thresholds or screenshot references were loosened.

## Requirement checklist

| Requirement | Implementation and evidence | Acceptance |
|---|---|---|
| Reported type change preserves timing | step.ts, ADR-0005; contact.test.ts | Automated |
| Keyboard remains bit-identical | keyboardContact; per-Tick full golden match and exact-contact re-press regression | Automated |
| Generic recommit compatibility bit | Intent/QIntent bit 8, protocol 9, Sim version 2; codec and prediction tests | Automated; clarification to reconcile two otherwise incompatible requirements |
| Offline Match/Practice local reported, Bots auto | LocalMatch setup; local/practice/replay tests | Automated |
| Auto-move, Auto-Commit, manual override, independent Aim | MotionSource, Neutral hard-speed observation-only Bot, movement tests | Automated; human feel pending |
| Saved setting, M, pause row, callout, HUD, URL flag | settings tests and motion.e2e.ts | Automated |
| Unpaired keyboard fallback / debug Swing | real browser switching test wins a rally and returns to keyboard | Automated |
| Phone pairing, QR/code, replacement, expiry | qrcode-generator, pure relay tests, Wrangler smoke | Automated |
| Protocol size/rate/role/version validation | controller.test.ts, net boundary test | Automated |
| Offline disconnect pause / online keyboard fallback | real relay browser tests | Automated |
| Permission, calibration, recalibration and error recovery | phone.e2e cases in motion.e2e.ts, injected sensors | Automated UI; real devices pending |
| Light separate phone entry | build-time transitive dependency guard | Automated |
| Traces, live tuning, JSON recorder | browser synthetic record/download; fixture README | Automated UI; human recordings pending |
| Soft/Drive/Lob classifier and no duplicate peaks | pure synthetic gesture tests | Mechanics verified; recorded-human accuracy pending |
| Timestamp alignment, RTT, single contact evaluation | clock tests, no-buffer timing tests, browser RTT handshake | Automated mechanics; Wi-Fi/mobile measurements pending |
| Hit haptic response | phone-to-relay-to-Sim-to-phone browser test with vibrate spy | Automated message flow; physical vibration pending |
| Human side-by-side and online Match | ticket 06 | Pending human acceptance |

## Current defaults and intentional choices

Swing contact: one input Tick, with no retained window or lead. Maximum input age: 400 ms (freshness rejection only). Peak threshold: 85 deg/s; Drive threshold: 330 deg/s; Lob rise: 22 degrees. Aim spans 45 degrees; depth is zero. Peak fall ratio: .8, settle ratio: .5, cooldown: 400 ms, sample window: 240 ms, tilt cadence: 50 ms. Auto-move speed: .9, reaction: 14 Ticks. Auto-move uses Neutral Bot positioning without the Bot's random late/off-center/unforced-error handicaps, to keep Auto-Commit early. These modest recognition defaults respond to the user's first physical playtest report; improved hardware accuracy is not yet verified.

Keyboard contact is filled at the driver boundary, once both Intents exist, rather than with a guessed remote Intent inside sample(). Online keyboard autoContact remains after input quantization. Explicit motion contact=false survives prediction; true still passes the Sim's reach/rule checks. The small recommit extension distinguishes keyboard's fresh type press from a Motion Swing at the identical Contact tick. Every flag is logged/replayed and encoded online.

## Human acceptance still required

Use controller.html?pair=CODE&debug to record at least 20 Soft, 20 Drive, 20 Lob and 10 non-swings across at least two people. Record actual iPhone Safari and Android Chrome gestures, including walking and setting the phone down. Label the intended gesture before evaluating it; use a participant alias rather than personal information. Copy the JSON into test/fixtures/motion. The test explicitly skips with no human traces and enforces >=85% correct swings and no false positives once recordings exist. Synthetic unit data and the browser's injected sensor events are not human evidence.

Play the same Venue, seed and medium difficulty in Keyboard and Motion, plus one match with mid-rally M switches. Record points, mean hit quality, early and late misses, misclassifications and feel. Measure RTT on home Wi-Fi and mobile data from the HUD. Play one real online Match with Motion versus Keyboard and record any rejected hits/desyncs. Decide timing strictness, depth and mid-rally switching. Record final tuning in ticket 06; file follow-ups if relay latency calls for WebRTC. No human playtest or network measurements have been invented.

## Release boundary

On 2026-10-16, the user explicitly authorized the Cloudflare deployment and hosted phone-pairing configuration, then personally renewed Wrangler OAuth access. The verified account is Peyton's account (248cbb6f0277b00de4d7482f25affa2c). Cloudflare reported no existing dink-city-party Worker, so this first deployment created the SQLite Court/Lobby (v1) and Controller (v2) classes without deleting or renaming existing data. No paid plan, new credential scope, or origin expansion was applied.

The endpoint is https://dink-city-party.peytonr7272.workers.dev. Worker version d189df0a-4e81-4a79-83c8-d39b9285a2f1, tagged 049e380, serves 100% of traffic and uses protocol 9 / Sim version 2. The remote Controller smoke passed handshake, Swing relay, latest-phone replacement and screen expiry. The frontend uses the same source revision plus the public hostname in .env.production, which Vite embeds in both browser entries; development remains on localhost. Existing Vercel environment overrides, if any, take precedence. Production allows https://dink-city.vercel.app; preview origins are not added to the allowlist.

Hosted synthetic verification is separate from the real iPhone/Android and network/playtest acceptance gates above.

## Verification recorded 2026-10-15

- Baseline: 454 existing tests passed before edits.
- Final unit suite: 42 files passed, 476 tests passed, 1 explicitly skipped recorded-human acceptance test. The final tuning/UI follow-up also passed its 13 affected unit tests with the same explicit skip.
- Typecheck: both root and party projects pass. No separate lint script is configured.
- Build: both entries pass, including the transitive phone-bundle guard. Phone entry JS is 7.84 kB (3.50 kB gzip), plus the 2.28 kB shared motion/protocol chunk. The existing game chunk remains over Vite's advisory size threshold.
- Local Controller smoke: handshake, Swing relay, latest-phone replacement and screen expiry pass under Wrangler.
- Browser: all 30 tests passed in the final complete Playwright run, including nine motion-specific tests. Reference screenshot PNGs were not changed or re-accepted.
- Golden Bots: points [11, 13], Tick 39353 unchanged; full keyboard-vs-auto parity is checked on every Tick. Replays and online prediction/reconciliation tests pass.
- Existing local Wrangler emits transport teardown messages (“Network connection lost”) during both existing Court tests and new Controller tests; close/replacement/reconnect assertions pass. A smoke invocation after the test server had stopped failed to connect, then passed with Wrangler running as documented.
- Before push, the public production menu exposed no Play online button, returned HTTP 200 and had no browser page errors. The live Worker is not configured in that client. Vercel API inspection for the intended team returned 403; use GitHub's Vercel commit/deployment statuses to verify the Git-triggered release. No credentials or permissions were changed.

## No-buffer timing revision, 2026-10-16

Every recognized Swing gets one contact evaluation on the next normal input Tick, then is consumed regardless of reach. Early swings do not stay armed; late swings miss. Multiple events before the same input sample coalesce to the newest rather than building a queue. Duplicate/older timestamps are ignored and clear() cancels a pending event without making its duplicate eligible again. The asynchronous event-to-input handoff is not a future hit window.

Auto-move and provisional Soft setup are retained to position the player and preserve normal shot-quality timing. They always report contact=false unless a fresh Swing is consumed on that Tick; setup cannot hit a ball later on its own. Clock alignment remains for freshness checks. Transport age does not shrink or extend Contact; mildly future timestamps from clock skew are evaluated now, not scheduled, and those over 100 ms ahead are discarded. No Sim, wire-format or Worker changes are needed: protocol 9 / Sim 2 still match.

Detection changes: minimum rotation peak 100 -> 85 deg/s; peak fall .65 -> .8, so recognition needs a 20% slowdown rather than 35%. The quiet rearm sample is kept as the next baseline. Drive/Lob classification thresholds, 400 ms cooldown, settling guard and reach geometry are unchanged.

Retest on the physical phone after reloading BOTH game and controller pages: pair/calibrate, confirm a ready serve, try deliberate early swings (must miss even as the ball later approaches), in-reach swings, and late swings. Try modest swings plus rest, walking and setting the phone down. Confirm one event per swing, then repeat after pausing/reconnecting. Use controller.html?pair=CODE&debug and the trace recorder to distinguish detected gestures from out-of-reach misses and capture failed examples. Record device/browser and displayed RTT; do not infer hardware success from synthetic tests.

Revision verification: all 504 unit tests passed (44 files), with one explicitly skipped recorded-human gate. Both TypeScript checks and the production build pass. The final full Playwright run passed all 46 tests, including real local relay delivery of a synthetic 90 deg/s Soft gesture, one-evaluation early/in-reach/late contact, cancellation, online peer delivery, keyboard/gamepad, touch, replay, and unchanged screenshot references. The first full browser run had two hit-observation failures and a rooftop stabilization timeout; diagnostic motion reruns passed, ready-serve preconditions were made explicit, and the complete final rerun passed without relaxing assertions, timeouts, or image baselines. Worker/Sim/netcode/touch source files are unchanged.
