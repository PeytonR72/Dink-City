// Shot solver (ADR-0002): find a launch velocity that lands on a target with a
// given apex, under the same drag/spin physics the Sim uses.
import { BALL_RADIUS, netHeight } from './court';
import { integrateBall } from './physics';
import type { Ball, SimTuning, Vec3 } from './types';

export const TICK = 1 / 60;

export interface Flight {
  landing: { x: number; z: number };
  apex: number;
  /** Ticks from launch to first bounce. */
  ticks: number;
  /** Positions at each Tick, launch included. */
  path: Vec3[];
}

const noRandom = () => 0.5;
const MAX_TICKS = 600;

/** Fly a ball (no net) until its first bounce. */
export function simulateFlight(from: Vec3, vel: Vec3, spin: number, t: SimTuning): Flight {
  const ball: Ball = {
    pos: { ...from },
    vel: { ...vel },
    spin,
    lastHitBy: null,
    bouncesSinceHit: 0,
  };
  const path: Vec3[] = [{ ...ball.pos }];
  let apex = ball.pos.y;
  for (let i = 1; i <= MAX_TICKS; i++) {
    const events = integrateBall(ball, TICK, t, noRandom, false);
    path.push({ ...ball.pos });
    apex = Math.max(apex, ball.pos.y);
    const bounce = events.find((e) => e.kind === 'bounce');
    if (bounce) return { landing: { x: bounce.pos.x, z: bounce.pos.z }, apex, ticks: i, path };
  }
  return { landing: { x: ball.pos.x, z: ball.pos.z }, apex, ticks: MAX_TICKS, path };
}

/** Drag-free launch velocity for a given aim point and apex. */
function ballistic(from: Vec3, aim: { x: number; z: number }, apex: number, g: number): Vec3 {
  const top = Math.max(apex, from.y + 0.02, BALL_RADIUS + 0.05);
  const vy = Math.sqrt(2 * g * (top - from.y));
  const flightTime = vy / g + Math.sqrt((2 * (top - BALL_RADIUS)) / g);
  return {
    x: (aim.x - from.x) / flightTime,
    y: vy,
    z: (aim.z - from.z) / flightTime,
  };
}

/** Drag-free launch velocity that reaches the aim point in the time `speed` implies. Allows downward launches. */
function timed(from: Vec3, aim: { x: number; z: number }, speed: number, g: number): Vec3 {
  const dx = aim.x - from.x;
  const dz = aim.z - from.z;
  const T = Math.max(Math.hypot(dx, dz) / speed, 0.15);
  return { x: dx / T, y: (BALL_RADIUS - from.y + 0.5 * g * T * T) / T, z: dz / T };
}

/** Like solveShot, but fixes horizontal speed instead of apex. Used for Smashes. */
export function solveTimedShot(
  from: Vec3,
  target: { x: number; z: number },
  speed: number,
  spin: number,
  t: SimTuning,
): Vec3 {
  const aim = { ...target };
  let vel = timed(from, aim, speed, t.gravity);
  for (let i = 0; i < 12; i++) {
    const flight = simulateFlight(from, vel, spin, t);
    const ex = target.x - flight.landing.x;
    const ez = target.z - flight.landing.z;
    if (Math.hypot(ex, ez) < 0.01) break;
    aim.x += ex;
    aim.z += ez;
    vel = timed(from, aim, speed, t.gravity);
  }
  return vel;
}

/** Height above the net tape where a flight crosses z = 0 (negative = into the net). */
export function netClearance(flight: Flight): number {
  for (let i = 1; i < flight.path.length; i++) {
    const a = flight.path[i - 1];
    const b = flight.path[i];
    if (Math.sign(a.z) === Math.sign(b.z)) continue;
    const k = a.z / (a.z - b.z);
    const x = a.x + (b.x - a.x) * k;
    const y = a.y + (b.y - a.y) * k;
    return y - BALL_RADIUS - netHeight(x);
  }
  return Infinity;
}

export function solveShot(
  from: Vec3,
  target: { x: number; z: number },
  apex: number,
  spin: number,
  t: SimTuning,
): Vec3 {
  const aim = { ...target };
  let aimApex = apex;
  let vel = ballistic(from, aim, aimApex, t.gravity);
  for (let i = 0; i < 12; i++) {
    const flight = simulateFlight(from, vel, spin, t);
    const ex = target.x - flight.landing.x;
    const ez = target.z - flight.landing.z;
    const eApex = apex - flight.apex;
    if (Math.hypot(ex, ez) < 0.01 && Math.abs(eApex) < 0.01) break;
    aim.x += ex;
    aim.z += ez;
    aimApex = Math.max(BALL_RADIUS + 0.05, aimApex + eApex);
    vel = ballistic(from, aim, aimApex, t.gravity);
  }
  return vel;
}
