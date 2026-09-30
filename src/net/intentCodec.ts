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

export function quantizeIntent(i: Intent): QIntent {
  const bits = SHOTS.indexOf(i.shot) + (i.contact ? CONTACT : 0);
  return [axis(i.move.x), axis(i.move.y), axis(i.aim.x), axis(i.aim.y), bits];
}

export function dequantizeIntent(q: QIntent): Intent {
  const [mx, my, ax, ay, bits] = q;
  const intent: Intent = { move: { x: mx / 127, y: my / 127 }, aim: { x: ax / 127, y: ay / 127 }, shot: SHOTS[bits & 3] };
  if (bits & CONTACT) intent.contact = true;
  return intent;
}

/** -1..1 to int8. `| 0` turns -0 (and NaN) into 0. */
function axis(v: number): number {
  return Math.round(Math.min(1, Math.max(-1, v)) * 127) | 0;
}
