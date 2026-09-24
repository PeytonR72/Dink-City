import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  endOf,
  localToWorld,
  predictContact,
  predictLanding,
  step,
  type Intent,
  type SimState,
} from '../src/sim';
import { simTuning as t } from '../src/tuning';

const idle: Intent = { move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, shot: null };

/** Just after Side 0 serves. */
function served(seed: number, shot: 'soft' | 'drive'): SimState {
  let s = createInitialState(seed);
  for (let i = 0; i < 20; i++) s = step(s, [idle, idle], t);
  return step(s, [{ ...idle, shot, aim: { x: 0.5, y: -0.3 } }, idle], t);
}

describe('predictLanding', () => {
  it('matches where the ball actually first bounces', () => {
    for (const shot of ['soft', 'drive'] as const) {
      let s = served(3, shot);
      const predicted = predictLanding(s.ball, t);
      let bounce;
      for (let i = 0; i < 300 && !bounce; i++) {
        s = step(s, [idle, idle], t);
        bounce = s.events.find((e) => e.kind === 'bounce');
      }
      expect(bounce?.kind).toBe('bounce');
      if (bounce?.kind !== 'bounce') return;
      expect(predicted!.x).toBeCloseTo(bounce.pos.x, 3);
      expect(predicted!.z).toBeCloseTo(bounce.pos.z, 3);
    }
  });

  it('predicts nothing once the ball has bounced', () => {
    const s = served(3, 'drive');
    expect(predictLanding({ ...s.ball, bouncesSinceHit: 1 }, t)).toBeNull();
  });
});

describe('predictContact', () => {
  it('predicts the Tick a committed, set Player will hit the ball', () => {
    let s = served(5, 'soft');
    // Put the receiver where the serve will meet their sweet spot after the bounce.
    const probe = structuredClone(s);
    let meet = probe.ball.pos;
    for (let i = 0, bounced = false; i < 300; i++) {
      const next = step(probe, [idle, idle], t);
      Object.assign(probe, next);
      if (probe.events.some((e) => e.kind === 'bounce')) bounced = true;
      if (bounced && probe.ball.vel.y < 0 && probe.ball.pos.y < 0.8) {
        meet = probe.ball.pos;
        break;
      }
    }
    const sweet = localToWorld(endOf(s, 1), t.sweetSpotSide, t.sweetSpotForward);
    s = structuredClone(s);
    s.sides[1].players[0].pos = { x: meet.x - sweet.x, y: 0, z: meet.z - sweet.z };
    s = step(s, [idle, { ...idle, shot: 'drive' }], t);

    const predicted = predictContact(s, 1, t);
    expect(predicted).not.toBeNull();
    let ticks = 0;
    while (!s.events.some((e) => e.kind === 'hit') && ticks < 300) {
      s = step(s, [idle, idle], t);
      ticks++;
    }
    expect(Math.abs(predicted!.ticks - ticks)).toBeLessThanOrEqual(3);
  });

  it('predicts nothing for a Player who is not committed', () => {
    expect(predictContact(served(5, 'soft'), 1, t)).toBeNull();
  });
});
