import { BALL_RADIUS, netHeight } from './court';
import type { Ball, SimTuning, Vec3 } from './types';

export type PhysicsEvent =
  | { kind: 'bounce'; pos: Vec3; speed: number }
  | { kind: 'net'; pos: Vec3; cord: boolean };

const ROLL_SPEED = 0.4;

/**
 * Advance the ball by dt, split into tuning.substeps. Mutates `ball`.
 * `random` is only used for net-cord deflections.
 */
export function integrateBall(
  ball: Ball,
  dt: number,
  t: SimTuning,
  random: () => number,
  withNet = true,
): PhysicsEvent[] {
  const events: PhysicsEvent[] = [];
  const h = dt / t.substeps;
  for (let i = 0; i < t.substeps; i++) {
    const e = substep(ball, h, t, random, withNet);
    if (e) events.push(e);
  }
  return events;
}

function substep(
  ball: Ball,
  h: number,
  t: SimTuning,
  random: () => number,
  withNet: boolean,
): PhysicsEvent | null {
  const { pos, vel } = ball;
  const rolling = pos.y <= BALL_RADIUS + 1e-6 && Math.abs(vel.y) < 1e-6;
  const speed = Math.hypot(vel.x, vel.y, vel.z);

  if (rolling) {
    const decay = Math.max(0, 1 - 2.5 * h);
    vel.x *= decay;
    vel.z *= decay;
  } else {
    vel.x += -t.drag * speed * vel.x * h;
    vel.y += (-t.gravity - t.drag * speed * vel.y - ball.spin * t.magnus * speed) * h;
    vel.z += -t.drag * speed * vel.z * h;
  }

  const prevZ = pos.z;
  pos.x += vel.x * h;
  pos.y += vel.y * h;
  pos.z += vel.z * h;

  let event: PhysicsEvent | null = null;

  if (withNet && Math.sign(prevZ) !== Math.sign(pos.z) && prevZ !== 0) {
    const top = netHeight(pos.x);
    if (pos.y < top + BALL_RADIUS) {
      const cord = pos.y > top - BALL_RADIUS;
      if (cord) {
        // Clipped the tape: keep going over, slowed and popped up.
        vel.z *= 0.45;
        vel.x += (random() - 0.5) * 0.6;
        vel.y = Math.abs(vel.y) * 0.4 + 0.8;
        pos.y = top + BALL_RADIUS;
      } else {
        // Into the net: drop back on the hitter's side.
        vel.z = -vel.z * 0.12;
        vel.x *= 0.3;
        vel.y *= 0.3;
        pos.z = Math.sign(prevZ) * BALL_RADIUS;
      }
      event = { kind: 'net', pos: { ...pos }, cord };
    }
  }

  if (pos.y < BALL_RADIUS && vel.y < 0) {
    const impact = -vel.y;
    pos.y = BALL_RADIUS;
    vel.y = impact * t.restitution;
    const keep = Math.max(0, Math.min(1, t.bounceFriction + ball.spin * t.spinKick));
    vel.x *= keep;
    vel.z *= keep;
    if (vel.y < ROLL_SPEED) vel.y = 0;
    if (impact > ROLL_SPEED) event = { kind: 'bounce', pos: { ...pos }, speed: impact };
  }

  return event;
}
