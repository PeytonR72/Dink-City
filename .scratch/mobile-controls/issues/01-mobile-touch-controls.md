# 01 Mobile touch controls and verification

Status: ready-for-human
Type: task
Blocked by: none

Spec: [Dink City mobile touch controls](../spec.md)

## Goal

Make direct mobile-browser play usable with a translucent bottom-left joystick and bottom-right Lob, Hit and Dink buttons, preserving all existing mechanics and desktop behavior. Follow the spec's exact mapping, input semantics, lifecycle, layout and acceptance matrix. This is separate from phone-as-controller Motion mode.

## Implementation checklist

- [x] Re-read repository instructions and current git status. Starting inspection HEAD was `f6f2248fbc6a39b3d3689833db0cf55f5a540a68` on main, with only pre-existing untracked `.playwright-mcp/` files. Preserve all current work, including changes since inspection.
- [x] Implement touch source/joystick math and independent pointer ownership. One-shot first-pending queue, no repeat, no explicit contact/recommit fields, no new Sim settings.
- [x] Integrate through Input/manual source path; retain keyboard/gamepad and active Motion semantics. Clear/reset input at every specified lifecycle boundary.
- [x] Add coarse-primary/no-hover/touch capability gate. Keep desktop and controller.html unaffected; no persisted third ControlMode.
- [x] Add specified translucent controls, safe insets, compact sizes, multitouch capture and scoped gesture prevention. Provide existing Menu action by touch; preserve pause/leave semantics.
- [x] Integrate visibility with match/menu/pairing/replay/online-over, including pairing Hide panel and source changes. No hidden input leaks.
- [x] Apply only necessary mobile hint/label/Practice feedback translations, badge placement, card spacing and short-landscape menu scrolling. No broad menu/camera redesign.
- [x] Add input and integration tests covering semantic parity, exact-contact recommit, simultaneous fingers and cleanup. Add genuine browser touch/capture coverage alongside pure tests.
- [x] Run specified typecheck, unit, build, targeted browser and full e2e checks sequentially. Record results and any pre-existing failure, without changing thresholds/golden values.
- [x] Inspect required mobile screenshots and document each intentional difference. Add named mobile references only; preserve all existing desktop references. No blind screenshot update.
- [x] Record physical iPhone/Android verification or explicitly identify it as unavailable. Existing Motion human-recording gaps remain separate.
- [x] Review final diff/status and update the Comments below. Follow parent authorization for implementation commit/push. Cloudflare login/deployment and live configuration remain out of scope.

## Acceptance

All spec checkboxes relevant to automated implementation pass; any physical-device limitation is named. A touch-only user can move/aim, select all three existing Shot types, serve, play Practice, pause/resume/quit, skip replay and start an offline rematch; online play uses the same prediction and contact pipeline and its existing match-over buttons. Desktop behavior/screenshots, active Motion, controller.html, Sim/balance/timing, protocol and golden results are preserved.

## Comments

### 2026-10-15 specification

Inspected source, ADRs, input routing, Sim mapping, local/online drivers, HUD/menu/Practice copy, Motion integration, tests and current rendered UI. Product details are resolved in the spec; no essential question needs to block implementation. No app code, commits, pushes or deployments were performed for this specification. Local UI capture evidence is identified in the spec and is not an approved screenshot baseline.

Implementation session: append changed files, command outcomes, reviewed mobile screenshots/intentional differences, physical-device results and any remaining blockers here.


### 2026-10-15 implementation and verification

Implemented in the requested checkout on main, starting at f6f2248fbc6a39b3d3689833db0cf55f5a540a68. The saved spec is included unchanged. Existing untracked .playwright-mcp files were not edited or staged. Peyton's implementation-session authorization permits the normal commit/push; no force push, Worker deployment, Wrangler login, credential, origin, binding, migration or live configuration change was performed.

Implemented:

- TouchSource owns independent joystick/shot pointers, radial clamp and the existing 0.2 raw deadzone; samples equal move/aim vectors and one first-pending shot. Hit maps to drive, Dink to soft and Lob to lob. No contact/recommit fields or Sim mutations are introduced.
- Input merges only the effective manual path, retains attached keyboard/gamepad behavior and keyboard-shot priority, and consumes losing touch presses. Active Motion still receives the unchanged keyboard override. Clear/reset clear captured touch gestures as well.
- Pointer capture, cancellation/lost capture, quick-tap retention, keyboard/AT button activation, blur/pagehide/hidden visibility, resize/orientation/visual viewport and capability changes are handled. Mode/pairing/replay/new-match/Practice/online-result boundaries reset input. Hide panel explicitly refreshes availability.
- Capability-gated translucent fixed controls, compact sizes, safe insets, mobile Menu through the existing pause/leave path, Touch aliases, the local Move & aim caption, mobile Practice/outcome/replay/result text, reachable short-landscape menus, and mobile pairing sizing. Practice card reserves the full Menu width plus 8 px; rep feedback follows the card's measured height so wrapped instructions cannot cover it.
- No changes to Sim, balance, Bots, camera/rendering, network protocol/prediction, Motion tuning, controller.html or phone entry. SIM_VERSION 2 and PROTOCOL_VERSION 9 are unchanged. The built controller JS remains 7.84 kB with the same dependency guard.

Verification:

- npm run typecheck: browser and party pass.
- npm test: 44 files, 495 passing tests, 1 existing recorded-human Motion test explicitly skipped. Added source/ownership/deadzone/arbitration/lifecycle tests, manual Input coverage, driver/predictor exact-contact parity, early/same/different Commit traces and switched-end cases, plus presentation-table tests.
- npm run build: passes, including the controller-entry dependency guard. Existing large game-bundle advisory remains; no new dependency.
- npm run e2e: all 45 tests pass, including 15 new mobile tests and all existing Motion, online, Practice, venue, desktop-reference and performance tests. Full run: 3.9 minutes. CPU-heavy unit and browser suites ran sequentially. Test servers were started by the existing config with VITE_PARTY_HOST=localhost:8797, Vite 5174 and local Wrangler 8797; no reused live backend.
- After the final mobile Practice-feedback spacing fix, typecheck/build and the 8 affected Practice/viewport/landscape browser tests pass. No extra full rerun was needed for this confined layout change.
- Real Chromium CDP multi-contact events verify independent browser pointer capture, move+shot, drag outside, release/cancel/capture loss, neutral lifecycle samples and capability loss. Browser tests also cover served and rally mappings, accessible activation, mobile Motion separation/fallback, pause/resume/quit, Practice copy, replay skip without serve leakage, offline rematch, both online sides, Leave while ticks continue, and real online result/rematch panels.
- Desktop 1280x720, narrow non-touch 390x844 and a fine-primary touchscreen retain desktop controls. Mobile geometry checked at 320x568, 390x844, 568x320, 844x390 and 1024x768. Existing seven desktop PNGs are unchanged, with original 0.02 image tolerance and performance budgets. Park: 40 calls/18472 triangles; Rooftop: 41/28444; Beach: 41/20156; map: 3/35396.
- Initial new-test failures were corrected fixture expectations (CDP release contact, pointer dispatch/capture timing, signed zero, exact waiting punctuation and scoring setup). Missing mobile-reference failures produced candidates that were then visually inspected; no desktop baseline was replaced, masked or loosened. Existing local Wrangler websocket teardown messages occurred while assertions passed, as already documented in the Motion runbook.

Visual review and accepted mobile-only differences:

- New named references: e2e/__screenshots__/touch-390x844.png and touch-844x390.png. Reviewed full images before accepting: bottom-left joystick, Lob top-right/Dink bottom-left/Hit bottom-right, pale outlines and yellow Hit border, transparent fills, local Move & aim caption, raised TOUCH badge and top-right Menu. Court/camera/art remain unchanged.
- Reviewed the other three geometry sizes, pressed/resting controls, Park daylight and sunset in both orientations, Beach landscape, mobile Practice including the long Dink instruction in both orientations, replay and offline result, paused/menu/pairing and online-over states. Menu/Practice safe spacing, scroll-reachable landscape settings/Locker and unobstructed result buttons are intentional mobile differences. Mobile pairing uses border-box sizing to stay on screen. Full labels remain readable and the scene remains visible through the controls.
- Actual desktop 1280x720 and narrow 390x844 screenshots were inspected; desktop legend and labels remain unchanged. All seven existing reference comparisons passed.
- Evidence is preserved in C:\Users\ztwis\Documents\Codex\2026-10-15\task-6\verification-full and verification-layout, with final-e2e.log and final-layout.log alongside them. These are local inspection artifacts, not additional approved baselines.

Coverage limits and release handoff:

- Physical iPhone Safari and Android Chrome testing was unavailable and is explicitly UNRUN. Chromium emulation is not evidence for real safe-area values, mobile browser bars, OS edge gestures, lock/tab interruption, long press or device touch delivery. Peyton should run the physical-device matrix in the spec. Native WebKit/mobile hardware and real Motion human-trace acceptance remain unverified.
- Local automated online tests pass; hosted online/Motion compatibility still depends on the separately pending matching Worker deployment. Cloudflare deployment and login remain on hold until Peyton returns home.
- Commit/push and the Git-triggered Vercel deployment are verified in the final handoff using the resulting exact commit SHA. No manual deployment or production configuration change is part of this ticket. The checklist above marks the specified automated work and explicit recording of physical-device limits, not physical-device acceptance.
