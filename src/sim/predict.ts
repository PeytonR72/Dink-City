// Pure look-ahead queries for presentation: the landing marker and the swing
// animation (ADR-0002: the swing is driven by the predicted Contact tick).
// Bots must not use these; they keep their own noisy estimate (ADR-0003).
import { endOfZ, localToWorld } from './court';
import { integrateBall } from './physics';
import { TICK } from './solver';
import { endOf, sweetSpotDistance, variantOf } from './step';
import type { Ball, ShotVariant, SideIndex, SimState, SimTuning, Vec3 } from './types';

const MAX_TICKS = 240;
/** Net-cord deflections are random; predictions assume the middle case. */
const noRandom = () => 0.5;

/** Where the ball will first bounce, or null if it already has. Exact unless it clips the net cord. */
export function predictLanding(ball: Ball, t: SimTuning): Vec3 | null {
  if (ball.bouncesSinceHit > 0 || ball.lastHitBy === null) return null;
  const b = structuredClone(ball);
  for (let k = 0; k < MAX_TICKS; k++) {
    const bounce = integrateBall(b, TICK, t, noRandom).find((e) => e.kind === 'bounce');
    if (bounce) return bounce.pos;
  }
  return null;
}

/**
 * When and where a committed Player will meet the ball, assuming they only
 * move under the contact assist. Mirrors the Contact rule in `step`: the
 * ball's closest point to the sweet spot, or its last point in reach.
 */
export function predictContact(
  s: SimState,
  side: SideIndex,
  t: SimTuning,
): { ticks: number; pos: Vec3; variant: ShotVariant } | null {
  if (!s.sides[side].players[0].commit || s.phase !== 'rally' || s.ball.lastHitBy === side) return null;
  const player = structuredClone(s.sides[side].players[0]);
  const end = endOf(s, side);
  const sweet = localToWorld(end, t.sweetSpotSide, t.sweetSpotForward);
  const ball = structuredClone(s.ball);
  let bounces = ball.bouncesSinceHit;
  let best: number | null = null;
  for (let k = 1; k <= MAX_TICKS; k++) {
    // The assist (see movePlayer) steers so the ball passes through the sweet spot.
    const near = Math.hypot(ball.pos.x - player.pos.x, ball.pos.z - player.pos.z) < t.reachForward + t.assistRange;
    if (near && ball.pos.y < t.reachHeight + 0.5) {
      const dx = ball.pos.x - sweet.x - player.pos.x;
      const dz = ball.pos.z - sweet.z - player.pos.z;
      const d = Math.hypot(dx, dz);
      const move = Math.min(t.assistSpeed * TICK, d);
      if (d > 0.02) {
        player.pos.x += (dx / d) * move;
        player.pos.z += (dz / d) * move;
      }
    }
    if (integrateBall(ball, TICK, t, noRandom).some((e) => e.kind === 'bounce')) bounces++;
    if (bounces > 1) return null;
    if (endOfZ(ball.pos.z) !== end) {
      best = null;
      continue;
    }
    const d = sweetSpotDistance(player, end, ball.pos, t);
    if (d === null) continue;
    const { pos, vel } = ball;
    const leaving = sweetSpotDistance(player, end, { x: pos.x + vel.x * TICK, y: pos.y + vel.y * TICK, z: pos.z + vel.z * TICK }, t) === null;
    if (d > t.sweetRadius && !leaving && (best === null || d < best)) {
      best = d;
      continue;
    }
    const base = variantOf(player.commit!.type, pos, Math.hypot(vel.x, vel.y, vel.z), t);
    // Close enough for animation: a Smash that falls back to a Drive isn't predicted.
    const variant: ShotVariant = base === 'drive' && pos.y >= t.smashHeight ? 'smash' : base;
    return { ticks: k, pos: { ...pos }, variant };
  }
  return null;
}
