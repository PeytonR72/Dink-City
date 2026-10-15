# 04: Phone controller page

Status: ready-for-human
Blocked by: 03

This needs a real phone, so a human must test it on iPhone Safari and Android Chrome.

Spec: `.scratch/motion-controls/spec.md`, "Swing recognition" and "Dev setup".

## Goal

Scanning the QR code opens a light phone page. The page gets motion permission, calibrates and connects, then sends placeholder Swings: any swing over the speed threshold counts as a Drive, with tilt as Aim.

## Scope

- **A second Vite entry**, `controller.html` plus `src/controller/phone.ts`. Add a `vite.config.ts` with multi-page `build.rollupOptions.input`. Its bundle must not include three.js, tweakpane or the game (check the build output).
- **Flow**: open with `?pair=` → "Tap to enable motion" (calls `DeviceMotionEvent.requestPermission()` where it exists) → calibration ("hold like a paddle, tap Ready", and pick left or right hand) → connected screen.
  - The connected screen shows: status, the last Swing, and a big "Recalibrate" button.
  - Keep the screen awake with the Wake Lock API where it's supported.
- **Placeholder detection**: a peak in gyroscope rotation speed over a threshold, then a cooldown, sends `swing { type: 'drive', aim, strength, at }`. `tilt` is sent at about 20 Hz.
- **On `hit`**, vibrate briefly where supported.
- **`?debug` on the phone**:
  - live charts of `rotationRate` and acceleration
  - the last detected peak
  - live `motionTuning` sliders
  - a **Record** button that saves a labeled trace (`soft`/`drive`/`lob`/`miss`) as JSON for the issue 05 fixtures
- **Errors**: clear messages for permission denied, an insecure context, a missing gyroscope, and a bad or expired Pair code.

## Acceptance

- On a real iPhone and a real Android phone, over the HTTPS preview or tunnel: pair, calibrate, and hit the ball in Motion mode on a laptop.
- The bundle check passes.
- Record at least 20 traces of each Shot type, plus 10 non-swings (walking, putting the phone down), from at least two people. Commit them under `test/fixtures/motion/`.

## Out of scope

- Telling Soft, Drive and Lob apart (issue 05).

## Comments

### 2026-10-15 implementation

Software implemented: standalone phone entry, tap-scoped motion/orientation permission, denial/retry, handed calibration, reconnect/recalibrate, missing gyro and insecure/expired-code errors, wake lock, sensor plots, live tuning and labeled JSON export. Build checks prohibit three.js, tweakpane and game code in the phone dependency graph. Browser tests inject explicitly synthetic sensor events and mock permission/haptics. Real iPhone Safari and Android Chrome acceptance and the 70+ recorded-human traces from two people remain pending. No synthetic download is committed as a human fixture.

See [verification and runbook](../../../docs/MOTION-CONTROLS.md) for final evidence and remaining gates.
