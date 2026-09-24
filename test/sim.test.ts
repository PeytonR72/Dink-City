import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BALL_RADIUS,
  HALF_LENGTH,
  createInitialState,
  netHeight,
  simulateFlight,
  solveShot,
  step,
  type Intent,
  type SimState,
} from '../src/sim';
import { integrateBall } from '../src/sim/physics';
import { simTuning as t } from '../src/tuning';

const idle: Intent = { move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, shot: null };

describe('sim boundary', () => {
  it('never imports three.js, the DOM layers, or tuning', () => {
    const dir = join(__dirname, '../src/sim');
    for (const file of readdirSync(dir)) {
      const src = readFileSync(join(dir, file), 'utf8');
      expect(src, file).not.toMatch(/from ['"]three/);
      expect(src, file).not.toMatch(/from ['"]\.\.\//);
      expect(src, file).not.toMatch(/Math\.random|Date\.now|performance\.now/);
    }
  });
});

describe('ball physics', () => {
  it('bounces a drop from 78 in to 30–34 in (USA Pickleball spec)', () => {
    const ball = { pos: { x: 0, y: 1.981, z: 3 }, vel: { x: 0, y: 0, z: 0 }, spin: 0, lastHitBy: null, bouncesSinceHit: 0 };
    let bounced = false;
    let peak = 0;
    for (let i = 0; i < 180; i++) {
      const events = integrateBall(ball, 1 / 60, t, () => 0.5);
      if (events.some((e) => e.kind === 'bounce')) bounced = true;
      if (bounced) peak = Math.max(peak, ball.pos.y + BALL_RADIUS);
    }
    expect(peak).toBeGreaterThan(0.762);
    expect(peak).toBeLessThan(0.864);
  });
});

describe('shot solver', () => {
  const cases = [
    { name: 'dink from the kitchen line', from: { x: 0.5, y: 0.35, z: 2.3 }, type: 'soft' as const, depth: 1.2 },
    { name: 'drop from the baseline', from: { x: -1, y: 0.6, z: 6.5 }, type: 'soft' as const, depth: 1.6 },
    { name: 'drive from the baseline', from: { x: 1.2, y: 0.8, z: 6.6 }, type: 'drive' as const, depth: 5.2 },
    { name: 'drive from midcourt', from: { x: 0, y: 0.9, z: 4 }, type: 'drive' as const, depth: 5.8 },
    { name: 'lob from the kitchen line', from: { x: -0.5, y: 0.5, z: 2.2 }, type: 'lob' as const, depth: 5.6 },
  ];

  for (const c of cases) {
    it(`lands a ${c.name} on target and clears the net`, () => {
      const shot = t.shots[c.type];
      const target = { x: -1.5, z: -c.depth };
      const apex = shot.apex + shot.apexPerMeter * Math.abs(c.from.z);
      const vel = solveShot(c.from, target, apex, shot.spin, t);
      const flight = simulateFlight(c.from, vel, shot.spin, t);

      expect(Math.hypot(flight.landing.x - target.x, flight.landing.z - target.z)).toBeLessThan(0.05);

      const crossing = flight.path.findIndex((p) => p.z < 0);
      const a = flight.path[crossing - 1];
      const b = flight.path[crossing];
      const y = a.y + ((b.y - a.y) * a.z) / (a.z - b.z);
      expect(y).toBeGreaterThan(netHeight(a.x) + BALL_RADIUS);
    });
  }
});

describe('step', () => {
  it('is pure and deterministic', () => {
    const s0 = createInitialState(42);
    const frozen = JSON.stringify(s0);
    const serve: Intent = { ...idle, shot: 'drive' };
    const run = () => {
      let s: SimState = s0;
      for (let i = 0; i < 20; i++) s = step(s, [idle, idle], t);
      s = step(s, [serve, idle], t);
      for (let i = 0; i < 200; i++) s = step(s, [idle, idle], t);
      return s;
    };
    const a = run();
    const b = run();
    expect(JSON.stringify(s0)).toBe(frozen);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('serves diagonally into the opposite service court', () => {
    let s = createInitialState(1);
    for (let i = 0; i < 20; i++) s = step(s, [idle, idle], t);
    const serverX = s.sides[0].players[0].pos.x;
    s = step(s, [{ ...idle, shot: 'soft' }, idle], t);
    expect(s.phase).toBe('rally');
    let bounce;
    for (let i = 0; i < 300 && !bounce; i++) {
      s = step(s, [idle, idle], t);
      bounce = s.events.find((e) => e.kind === 'bounce');
    }
    expect(bounce).toBeDefined();
    if (bounce?.kind !== 'bounce') return;
    expect(Math.sign(bounce.pos.x)).toBe(-Math.sign(serverX));
    expect(bounce.pos.z).toBeLessThan(-2.134);
    expect(bounce.pos.z).toBeGreaterThan(-HALF_LENGTH);
  });

  it('returns a committed ball when it comes within reach', () => {
    let s = createInitialState(7);
    for (let i = 0; i < 20; i++) s = step(s, [idle, idle], t);
    s = step(s, [{ ...idle, shot: 'soft' }, idle], t);
    const receiverCommit: Intent = { ...idle, shot: 'drive' };
    s = step(s, [idle, receiverCommit], t);

    let hitBack = false;
    for (let i = 0; i < 300 && !hitBack; i++) {
      // Receiver walks toward the ball's x so it comes within reach.
      const r = s.sides[1].players[0];
      const dx = s.ball.pos.x - r.pos.x;
      const dz = s.ball.pos.z - r.pos.z - 0.8;
      // Side 1 local frame: right = -x, forward = +z.
      const move = { x: Math.max(-1, Math.min(1, -dx * 2)), y: Math.max(-1, Math.min(1, dz * 2)) };
      s = step(s, [idle, { ...idle, move }], t);
      hitBack = s.events.some((e) => e.kind === 'hit' && e.side === 1);
    }
    expect(hitBack).toBe(true);
  });
});
