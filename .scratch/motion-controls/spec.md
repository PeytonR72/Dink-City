# Motion controls spec

Drafted on 2026-10-13. Terms follow `CONTEXT.md`. Builds on ADR-0002 (Commit-early timing), ADR-0003 (Bots only produce Intents) and ADR-0004 (Reported Contact). This feature needs one new ADR (ADR-0005, see issue 01).

## Goal

Let a Player swing their phone like a Wii remote to hit the ball, while the game runs on a laptop or TV browser.

Motion controls ship **alongside** the current controls, not instead of them:

- **Keyboard mode** is today's game: WASD/arrows + J/K/L, or a gamepad. It stays the default, and it must play bit-identically to today.
- **Motion mode** is the new option: the phone's swing chooses the Shot type, Aim and the moment of Contact, and **Auto-move** handles footwork.
- The Player can **toggle between the two at any time**, including in the middle of a Match or Practice, without restarting anything. That is how we test Motion mode against Keyboard mode side by side.

## Glossary additions (add to `CONTEXT.md` in issue 02)

- **Control mode**: how the local Player's Intents are produced: **Keyboard mode** (keyboard or gamepad, today's controls) or **Motion mode** (a paired phone). A client setting; the Sim never sees it.
- **Controller**: a phone paired to a game screen, sending Swings.
- **Pair code**: the short code (shown as a QR code) that joins a Controller to a screen.
- **Swing**: one recognized phone swing: a Shot type, an Aim and a timestamp.
- **Auto-move**: in Motion mode, the Player's footwork comes from Bot positioning logic instead of the stick or keys.
- **Swing window**: the few Ticks after a Swing during which its `contact` flag stays on (see below).

## How a Motion-mode hit works

The core problem: in Keyboard mode the Player presses early (Commit) and the swing happens automatically at Contact. With a phone, people swing **when the ball arrives**. Under today's rules that is a maximally late Commit, which gives a rushed, weak shot. So Motion mode moves the timing skill from "when you Commit" to "when you swing":

1. **Auto-Commit.** When the opponent's shot is on its way to the local Player, the Motion input source Commits a provisional Shot type (Soft) on its own, at the usual early point. This keeps the existing set-up behavior working: the contact assist, the commit ring and the timing factor of Shot quality.
2. **Swing = Contact.** The local Side uses Reported Contact (ADR-0004) offline too. A Swing sets `shot` to the Swing's Shot type and sets `contact` on every Tick of its **Swing window** (tunable, starting at about 100 ms). The Sim hits on the first Tick in that window where the ball is in reach. Its existing reach checks make the timing skill:
   - swing **early** → hit at the near edge of reach (lower Shot quality) or a miss if it never comes into reach
   - swing **on time** → hit near the sweet spot
   - swing **late** → the ball has gone past; it's a miss, like Wii Sports.
3. **The type changes, the timing stays (Sim change, ADR-0005).** Today a new shot press with a different type resets the Commit's `tick` (`src/sim/step.ts:152`). New rule, for `reported` Sides only: on a Tick whose Intent has `contact` and a Commit already exists, a different `shot` changes the Commit's type but keeps its `tick`. Without this, every Motion-mode shot that isn't Soft would be scored as rushed.
4. **Serves.** A Swing during the serve phase is a plain shot press, so it serves exactly as a key press does today. No `contact` is needed.

## Switching modes with no restart

The Sim's `MatchConfig.contactMode` is fixed for the whole Match (ADR-0004). To allow switching mid-Match without breaking that rule:

- **Offline Matches and Practice start the local Side as `reported`** whenever motion controls are built in, no matter which mode is active.
- **Keyboard mode** fills in `contact` with `autoContact(prev, intents, side)`, the same query the online Takeover Bot uses. `test/contact.test.ts` already shows that this plays bit-identically to `auto`. So Keyboard mode is unchanged, and Fault Replays still work because `contact` is recorded with the Intents.
- **Motion mode** fills in `contact` from Swings.
- **Online**, human Sides are already `reported`, so both modes work with no config change at all.
- Switching changes only which client-side input source builds the next Intent. The switch clears queued presses (the same as `Input.clear()`) so a stale key press can't Commit.

Bot Sides stay `auto`, so the golden Bot test (`{ points: [11, 13], tick: 39353 }`) can't move.

## Auto-move

- In Motion mode, `move` comes from a Bot's positioning for the local Side (`createBot` in `src/bot/bot.ts`, at `hard` move speed, Neutral Personality). Only its `move` is used: its `shot` and `aim` are discarded, and it only ever sees an `Observation` (ADR-0003 is unchanged).
- **Keyboard or stick movement overrides Auto-move** while it is held, so a tester can mix both.
- In Motion mode, `aim` comes from the latest Swing (or the Controller's live tilt between Swings, see issue 05), not from `move`.

## Pairing and transport

- **The screen** (the laptop running the game) opens a WebSocket to a new `Controller` Durable Object in `party/`, named by a fresh Pair code. It shows a QR code of `<site>/controller.html?pair=<code>` and the code in text.
- **The phone** opens that URL. It shows a "Tap to enable motion" button, which is required on iPhone (`DeviceMotionEvent.requestPermission()` must be called from a tap, and only over HTTPS). Then it connects to the same `Controller` as the phone.
- The `Controller` DO is a thin relay between exactly one screen and one phone, following the Court's pattern of pure rules plus a thin DO shell. A second phone replaces the first. The pairing ends when the screen leaves.
- **Messages** (shared types and validation in `src/net/controller.ts`, pure, imported by `party/`):
  - phone → screen: `swing { type, aim, strength, at }`, `tilt { aim }` at about 20 Hz, `hello { version }`
  - screen → phone: `hit` (the phone vibrates where supported; iPhones don't support `navigator.vibrate`), `ping`/`pong` for round-trip time
- **Latency** is the main feel risk. The screen measures the round-trip time and shows it in the pairing panel and the `?debug` panel. The Swing window and a `swingLeadMs` setting in the motion tuning absorb it. If a DO relay proves too slow in the playtests, a follow-up can add a WebRTC data channel with the DO acting only as signaling. That is out of scope for this spec.
- **The phone page is its own Vite entry** (`controller.html`) and must not load three.js or the game.

## Swing recognition (on the phone)

- **Calibration**: "Hold your phone like a paddle and tap Ready." This records a neutral orientation and handedness.
- **Detection**: a Swing is a peak in gyroscope rotation speed above a threshold, followed by a cooldown so one swing never counts twice.
- **Classification**, a pure function over a short window of samples:
  - **Drive**: fast and flat
  - **Soft**: slow or gentle (above the swing threshold, below Drive speed)
  - **Lob**: a clearly rising, upward path
- **Aim**: x comes from the phone's roll or yaw at the peak, relative to calibration. y (depth) comes from strength within the type's range and starts at 0 until the playtests say otherwise.
- **Tuning**: every threshold lives in a `motionTuning` object, kept separate from `simTuning` so `simHash` and online play are unaffected. It is adjustable live under `?debug` on the phone page.
- **A debug view on the phone** shows live sensor traces and the last classification, and can record a trace as JSON. Recorded traces become test fixtures (`test/fixtures/motion/`).

## UI

- **Settings** gain `controls: 'keyboard' | 'motion'` (default `keyboard`), saved like the other settings. It shows in the menu's settings rows and in the pause menu, and works with a `?motion` URL flag.
- **The hotkey `M`** toggles the mode at any time during play. That's the "switch seamlessly" path for testing. A short callout shows "KEYBOARD" or "MOTION".
- **Switching to Motion mode with no Controller paired** opens the pairing panel (QR code + code). Keyboard input keeps working until a phone connects.
- **The HUD** shows a small Control mode badge, plus Controller status (connected, round-trip time) in Motion mode.
- **If the Controller disconnects mid-Rally**, an offline Match pauses with "Controller disconnected". The Player can reconnect or press `M` to continue on the keyboard. Online, the game never pauses: it drops to Keyboard mode with a toast.
- **A debug Swing key (Space)** in Motion mode, available only under `?debug` and in e2e, sends a fake Drive Swing. That lets agents and e2e tests drive Motion mode without a phone.

## Dev setup

- Motion events need a secure context. Test on a phone with the deployed Vercel preview, or with an HTTPS tunnel to `npm run dev`. `vite --host` over plain http on the LAN won't fire motion events on iPhone.
- `party/src/origin.ts` only allows the production site and localhost. Tunnel or preview origins need an allowlist entry (a dev-only env var), decided in issue 03.

## Out of scope (for now)

- Making Motion mode the default, or removing Keyboard mode
- Two phones for local two-player
- Moving with the phone
- A WebRTC data channel
- Gyro-only aiming on the screen with no phone
- Online ranked fairness (a modified Controller could send perfect Swings; Reported Contact already limits a cheat to picking an in-reach Tick)

## Issues

1. `issues/01-sim-swing-contact.md`: ADR-0005, and the Sim rule that lets a Swing change the Shot type at Contact.
2. `issues/02-control-mode-toggle.md`: the Control mode setting, the input-source seam, Auto-move and the debug Swing key. Playable with no phone.
3. `issues/03-controller-relay.md`: the `Controller` DO, the protocol and the screen's pairing panel.
4. `issues/04-phone-controller-page.md`: the phone page, permissions, calibration, the sensor debug view and the trace recorder.
5. `issues/05-swing-recognition.md`: the pure Swing classifier with fixtures, wired into Motion mode, plus latency handling and haptics.
6. `issues/06-playtest-and-tune.md`: the side-by-side playtest of Keyboard and Motion mode, tuning, and an online check.

## Open questions for the user

- Should Motion mode's timing curve be as strict as Wii Sports, or more forgiving (a longer Swing window by default)?
- Should a Motion-mode Player be able to aim depth at all in the first version?
- Mid-Match switching offline: should it be allowed during a Rally, or only between Rallies? The spec allows it any time, since it's cheap.
