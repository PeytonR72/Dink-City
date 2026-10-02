// The missing-input policy, shared so the Court's fill and a client's prediction of it step alike.
import type { Intent } from '../sim';

/** With no Intent coming, a Side's last move fades to standing still over this many Ticks. */
export const DECAY_TICKS = 6;

/** Standing still: what a Side with no Intent yet steps with. */
export function stillIntent(): Intent {
  return { move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, shot: null };
}

/**
 * The Intent a Tick with none is stepped with, `missing` Ticks (1 or more) after the last real one: the same aim, no
 * shot and no Contact, and the move scaled down to nothing by the `DECAY_TICKS`th missing Tick.
 */
export function fadeIntent(last: Intent, missing: number): Intent {
  const k = Math.max(0, 1 - (missing - 1) / DECAY_TICKS);
  return { move: { x: last.move.x * k, y: last.move.y * k }, aim: last.aim, shot: null };
}
