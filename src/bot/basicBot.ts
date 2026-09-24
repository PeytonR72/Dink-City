// A trivial Bot for milestone 01. It produces Intents only (ADR-0003) and
// predicts the ball with its own drag-free estimate, not the Sim's trajectory.
import {
  BALL_RADIUS,
  HALF_LENGTH,
  KITCHEN_DEPTH,
  facing,
  sideOfZ,
  worldToLocal,
  type Intent,
  type ShotType,
  type SideIndex,
  type SimState,
} from '../sim';
import { nextRandom } from '../sim/rng';

const G = 9.81;
const SERVE_WAIT_TICKS = 50;
const REACTION_TICKS = 12;

export interface BasicBot {
  think(state: SimState): Intent;
}

export function createBasicBot(side: SideIndex, seed: number): BasicBot {
  let rng = seed >>> 0;
  const random = () => {
    const [v, n] = nextRandom(rng);
    rng = n;
    return v;
  };
  let wasIncoming = false;
  let reactAt = -1;
  let aim = { x: 0, y: 0 };

  return {
    think(s) {
      const me = s.sides[side].players[0];
      const f = facing(side);
      const idle: Intent = { move: { x: 0, y: 0 }, aim, shot: null };

      if (s.phase === 'serve') {
        if (s.server !== side || s.tick - s.phaseTick < SERVE_WAIT_TICKS) return idle;
        aim = { x: random() * 2 - 1, y: random() * 2 - 1 };
        return { ...idle, aim, shot: random() < 0.5 ? 'soft' : 'drive' };
      }
      if (s.phase !== 'rally') return idle;

      const { ball } = s;
      const incoming = ball.lastHitBy !== null && ball.lastHitBy !== side;
      let target: { x: number; z: number };
      let shot: ShotType | null = null;

      if (incoming && !wasIncoming) reactAt = s.tick + REACTION_TICKS;
      wasIncoming = incoming;

      if (incoming) {
        target = interceptPoint(s, side);
        if (s.tick === reactAt) {
          shot = chooseShot(Math.abs(target.z), random);
          aim = { x: random() * 2 - 1, y: random() * 2 - 1 };
        }
      } else {
        // Recover toward a ready position a little inside the baseline.
        target = { x: 0, z: -f * (HALF_LENGTH - 1.5) };
      }

      const dx = target.x - me.pos.x;
      const dz = target.z - me.pos.z;
      const local = worldToLocal(side, dx, dz);
      const d = Math.hypot(local.x, local.y);
      const move = d < 0.1 ? { x: 0, y: 0 } : { x: local.x / Math.max(d, 0.5), y: local.y / Math.max(d, 0.5) };
      return { move, aim, shot };
    },
  };

  function interceptPoint(s: SimState, mySide: SideIndex): { x: number; z: number } {
    const { pos, vel } = s.ball;
    // Time until the ball next reaches the ground, drag-free.
    const h = pos.y - BALL_RADIUS;
    const tLand = (vel.y + Math.sqrt(Math.max(0, vel.y * vel.y + 2 * G * h))) / G;
    let x = pos.x + vel.x * tLand;
    let z = pos.z + vel.z * tLand;
    // If it lands on our side and hasn't bounced yet, wait a little behind the bounce.
    if (s.ball.bouncesSinceHit === 0 && sideOfZ(z) === mySide) {
      x += vel.x * 0.25;
      z += vel.z * 0.25;
    }
    return { x, z: sideOfZ(z) === mySide ? z : -facing(mySide) * KITCHEN_DEPTH };
  }
}

function chooseShot(distanceFromNet: number, random: () => number): ShotType {
  const r = random();
  if (distanceFromNet < KITCHEN_DEPTH + 1) return r < 0.75 ? 'soft' : 'drive';
  if (r < 0.15) return 'lob';
  return r < 0.55 ? 'soft' : 'drive';
}
