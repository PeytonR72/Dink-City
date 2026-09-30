// Intents on the wire: small, exact, and JSON-friendly.
import type { Intent, ShotType } from '../sim';

/**
 * A quantized Intent: `[moveX, moveY, aimX, aimY, bits]`. The four axes are int8 (-127..127, for -1..1);
 * `bits` is the shot (0 none, 1 Soft, 2 Drive, 3 Lob) plus 4 for `contact`.
 *
 * Gamepad values aren't exact in int8, so an online client must step its own prediction with
 * `dequantizeIntent(quantizeIntent(i))`, never the raw Intent, or its prediction and the Court's result drift
 * apart. Keyboard values (-1, 0, 1) are exact. Offline play keeps raw Intents.
 */
export type QIntent = [number, number, number, number, number];

const SHOTS: readonly (ShotType | null)[] = [null, 'soft', 'drive', 'lob'];
const CONTACT = 4;
const AXIS = 127;

/** An Intent for the wire. */
export function quantizeIntent(i: Intent): QIntent {
  const bits = SHOTS.indexOf(i.shot) + (i.contact ? CONTACT : 0);
  return [axis(i.move.x), axis(i.move.y), axis(i.aim.x), axis(i.aim.y), bits];
}

/** The Intent both ends step with: the same on the client and the Court. */
export function dequantizeIntent(q: QIntent): Intent {
  const [mx, my, ax, ay, bits] = q;
  const intent: Intent = { move: { x: mx / AXIS, y: my / AXIS }, aim: { x: ax / AXIS, y: ay / AXIS }, shot: SHOTS[bits & 3] };
  if (bits & CONTACT) intent.contact = true;
  return intent;
}

/** Guards a quantized Intent from the wire: four int8 axes and the shot and `contact` bits. */
export function isQIntent(v: unknown): v is QIntent {
  if (!Array.isArray(v) || v.length !== 5 || !v.every((n) => Number.isInteger(n))) return false;
  const bits = v[4] as number;
  return v.slice(0, 4).every((a: number) => Math.abs(a) <= AXIS) && bits >= 0 && bits <= (SHOTS.length - 1) + CONTACT;
}

/** -1..1 to int8. `| 0` turns -0 (and NaN) into 0. */
function axis(v: number): number {
  return Math.round(Math.min(1, Math.max(-1, v)) * AXIS) | 0;
}
