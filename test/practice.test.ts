import { describe, expect, it, vi } from 'vitest';
import { DIFFICULTY, createBot } from '../src/bot/bot';
import { observe } from '../src/bot/observe';
import { PRACTICE_STEPS, Practice, createMachine } from '../src/practice/practice';
import { createInitialState, step, type SimEvent, type SimState } from '../src/sim';
import { simTuning as t } from '../src/tuning';

vi.setConfig({ testTimeout: 30_000 });

type Hit = Extract<SimEvent, { kind: 'hit' }>;

function hit(side: 0 | 1, change: Partial<Hit> = {}): Hit {
  return {
    kind: 'hit',
    side,
    type: 'drive',
    variant: 'drive',
    volley: false,
    quality: 1,
    factors: { set: 1, timing: 1, height: 1, pace: 1 },
    pos: { x: 0, y: 1, z: 0 },
    speed: 10,
    ...change,
  };
}
const serve = (side: 0 | 1) => hit(side, { variant: 'serve', type: 'soft' });
const dead = (loser: 0 | 1, reason: Extract<SimEvent, { kind: 'dead' }>['reason'] = 'double-bounce'): SimEvent => ({ kind: 'dead', reason, loser });

/** A Practice on step `index` (0-based). */
function at(index: number) {
  const p = new Practice();
  p.skipTo(index);
  return p;
}

describe('Practice steps', () => {
  it('teach the Two-bounce rule and Kitchen faults in order, then free play', () => {
    expect(PRACTICE_STEPS.map((s) => s.id)).toEqual(['return', 'third', 'volley', 'dink', 'free']);
  });

  it('count a clean return of serve as a good rep', () => {
    const p = at(0);
    expect(p.onEvents([serve(1), hit(0), dead(1)])).toMatchObject({ kind: 'good' });
    expect(p.reps).toBe(1);
  });

  it('explain a volleyed serve as a Two-bounce fault', () => {
    const p = at(0);
    const outcome = p.onEvents([serve(1), hit(0, { volley: true }), dead(0, 'two-bounce')]);
    expect(outcome).toMatchObject({ kind: 'fault', title: 'TWO-BOUNCE FAULT' });
    expect(outcome!.detail).toMatch(/bounce/);
    expect(p.reps).toBe(0);
  });

  it('pass a step after three good reps, and move on to the next', () => {
    const p = at(0);
    p.onEvents([serve(1), hit(0), dead(1)]);
    p.onEvents([serve(1), hit(0), dead(1)]);
    const third = p.onEvents([serve(1), hit(0), dead(1)]);
    expect(third).toMatchObject({ kind: 'good', passed: true });
    expect(p.step.id).toBe('third');
    expect(p.reps).toBe(0);
  });

  it('judge the third shot, which must bounce before it is hit', () => {
    const p = at(1);
    expect(p.step.server).toBe(0);
    expect(p.onEvents([serve(0), hit(1), hit(0), dead(1)])).toMatchObject({ kind: 'good' });
    expect(p.onEvents([serve(0), hit(1), hit(0, { volley: true }), dead(0, 'two-bounce')])).toMatchObject({ kind: 'fault' });
  });

  it("don't count a rep when the machine misses before the Player's shot", () => {
    const p = at(1);
    expect(p.onEvents([serve(0), hit(1), dead(1, 'out')])).toMatchObject({ kind: 'miss' });
    expect(p.reps).toBe(0);
  });

  it('want a volley from behind the Kitchen line in the volley step', () => {
    const p = at(2);
    expect(p.onEvents([serve(1), hit(0), hit(1), hit(0, { volley: true }), dead(1)])).toMatchObject({ kind: 'good' });
    expect(p.onEvents([serve(1), hit(0), hit(1), hit(0), dead(1)])).toMatchObject({ kind: 'miss', detail: expect.stringMatching(/before it bounces/) });
    expect(p.onEvents([serve(1), hit(0), hit(1), hit(0, { volley: true }), dead(0, 'kitchen')])).toMatchObject({ kind: 'fault', title: 'KITCHEN FAULT' });
  });

  it('want a Dink after the bounce in the dink step', () => {
    const p = at(3);
    expect(p.onEvents([serve(1), hit(0), hit(1, { type: 'soft', variant: 'drop' }), hit(0, { type: 'soft', variant: 'dink' }), dead(1)])).toMatchObject({ kind: 'good' });
    expect(p.onEvents([serve(1), hit(0), hit(1), hit(0, { variant: 'drive' }), dead(1)])).toMatchObject({ kind: 'miss', detail: expect.stringMatching(/Soft/) });
  });

  it('never ends free play', () => {
    const p = at(4);
    for (let i = 0; i < 5; i++) expect(p.onEvents([serve(1), hit(0), hit(1), dead(0, 'out')])?.passed).toBeFalsy();
    expect(p.step.id).toBe('free');
  });

  it('ignore events until a Rally ends', () => {
    const p = at(0);
    expect(p.onEvents([serve(1)])).toBeNull();
    expect(p.onEvents([hit(0)])).toBeNull();
    expect(p.onEvents([dead(1)])).toMatchObject({ kind: 'good' });
  });
});

describe('The ball machine', () => {
  /** One rep of `stepIndex`: the machine against a Bot standing in for the Player. */
  function rep(stepIndex: number, seed = 3) {
    const practice = at(stepIndex);
    const machine = createMachine(seed, t, () => practice.step);
    const player = createBot(0, seed + 1, DIFFICULTY.hard, t);
    let s: SimState = createInitialState(seed, undefined, practice.step.server);
    const events: SimEvent[] = [];
    while (!events.some((e) => e.kind === 'dead') && s.tick < 60 * 40) {
      s = step(s, [player.think(observe(s, 0)), machine.think(observe(s, 1))], t);
      events.push(...s.events);
    }
    return { events, hits: events.filter((e): e is Hit => e.kind === 'hit') };
  }

  it('serves in the return step, then lets the return go', () => {
    const { hits, events } = rep(0);
    expect(hits[0]).toMatchObject({ side: 1, variant: 'serve' });
    expect(hits.filter((h) => h.side === 1)).toHaveLength(1);
    expect(events.find((e) => e.kind === 'dead')).toMatchObject({ loser: 1, reason: 'double-bounce' });
  });

  it('returns the serve in the third-shot step, and no more', () => {
    const { hits } = rep(1);
    expect(hits[0]).toMatchObject({ side: 0, variant: 'serve' });
    expect(hits[1]).toMatchObject({ side: 1 });
    expect(hits.filter((h) => h.side === 1)).toHaveLength(1);
  });

  it('feeds a Drive to volley, and a Soft shot to dink', () => {
    expect(rep(2).hits[2]).toMatchObject({ side: 1, type: 'drive' });
    expect(rep(3).hits[2]).toMatchObject({ side: 1, type: 'soft' });
  });

  it('keeps rallying in free play', () => {
    const { hits } = rep(4, 5);
    expect(hits.filter((h) => h.side === 1).length).toBeGreaterThanOrEqual(1);
  });
});
