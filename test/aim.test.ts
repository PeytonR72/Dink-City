import { describe, expect, it } from 'vitest';
import {
  HALF_WIDTH,
  KITCHEN_DEPTH,
  createInitialState,
  endOf,
  localToWorld,
  step,
  type Intent,
  type ShotType,
  type SimState,
  type Vec2,
} from '../src/sim';
import { simTuning as t } from '../src/tuning';

const idle: Intent = { move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, shot: null };

interface Contact {
  seed: number;
  type: ShotType;
  /** Player's distance behind the net. */
  depth: number;
  aim?: Vec2;
  /** Player's velocity at Contact, in m/s along world x. */
  running?: number;
  /** Ball offset from the sweet spot, as a fraction of the reach to the Player's right. */
  offCenter?: number;
}

/** Side 0 hits a ball sitting at (or near) its sweet spot; returns where the shot first lands, in Side 1's frame. */
function landing(c: Contact): { x: number; depth: number } {
  let s: SimState = structuredClone(createInitialState(c.seed));
  s.phase = 'rally';
  s.shots = 4;
  s.tick = 100;
  const player = { x: 0, y: 0, z: c.depth };
  const sweet = localToWorld(endOf(s, 0), t.sweetSpotSide + (c.offCenter ?? 0) * t.reachSide, t.sweetSpotForward);
  s.sides[0].players[0].pos = player;
  s.sides[0].players[0].vel = { x: c.running ?? 0, y: 0, z: 0 };
  // Committed early in the ball's flight, so timing is perfect.
  s.sides[0].players[0].commit = { type: c.type, tick: 50, bestDistance: null };
  s.ball = { pos: { x: player.x + sweet.x, y: 0.7, z: player.z + sweet.z }, vel: { x: 0, y: 0, z: 0 }, spin: 0, lastHitBy: 1, bouncesSinceHit: 1, hitTick: 40 };
  s = step(s, [{ ...idle, aim: c.aim ?? { x: 0, y: 0 } }, idle], t);
  expect(s.events.some((e) => e.kind === 'hit')).toBe(true);
  for (let i = 0; i < 400; i++) {
    s = step(s, [idle, idle], t);
    const bounce = s.events.find((e) => e.kind === 'bounce');
    if (bounce?.kind === 'bounce') return { x: bounce.pos.x, depth: -bounce.pos.z };
  }
  throw new Error('never landed');
}

const seeds = Array.from({ length: 40 }, (_, i) => i + 1);

describe('Aim error from moving at Contact', () => {
  it('lands a set, clean Drive on its target every time', () => {
    const spots = seeds.map((seed) => landing({ seed, type: 'drive', depth: 5 }));
    for (const p of spots) {
      expect(Math.abs(p.x)).toBeLessThan(0.1);
      expect(Math.abs(p.depth - t.shots.drive.depth)).toBeLessThan(0.1);
    }
  });

  it('scatters a Drive hit on the run, differently each time', () => {
    const spots = seeds.map((seed) => landing({ seed, type: 'drive', depth: 5, running: t.playerSpeed }));
    const misses = spots.map((p) => Math.hypot(p.x, p.depth - t.shots.drive.depth));
    const mean = misses.reduce((a, b) => a + b, 0) / misses.length;
    expect(mean).toBeGreaterThan(0.3);
    expect(new Set(misses.map((m) => m.toFixed(2))).size).toBeGreaterThan(20);
  });

  it('can push a Drive aimed at the corner out while running', () => {
    const aim = { x: 1, y: 1 };
    const outs = seeds.filter((seed) => {
      const p = landing({ seed, type: 'drive', depth: 5, aim, running: t.playerSpeed });
      return Math.abs(p.x) > HALF_WIDTH || p.depth > 6.706;
    });
    expect(outs.length).toBeGreaterThan(0);
    expect(outs.length).toBeLessThan(seeds.length);
  });
});

describe('Soft shots from deep', () => {
  const dinkDepth = t.shots.dink.depth;

  it('lands a dead-center Soft from the baseline short', () => {
    const p = landing({ seed: 1, type: 'soft', depth: 6.5 });
    expect(p.depth).toBeLessThan(dinkDepth + 0.2);
  });

  it('hits an off-center Soft from the baseline too hard', () => {
    const long = seeds.map((seed) => landing({ seed, type: 'soft', depth: 6.5, offCenter: 0.3 }).depth);
    const mean = long.reduce((a, b) => a + b, 0) / long.length;
    expect(mean).toBeGreaterThan(KITCHEN_DEPTH + 0.5);
  });

  it('forgives the same off-center Soft from the Kitchen line', () => {
    const p = landing({ seed: 1, type: 'soft', depth: KITCHEN_DEPTH + 0.3, offCenter: 0.3 });
    expect(p.depth).toBeLessThan(dinkDepth + 0.3);
  });
});
