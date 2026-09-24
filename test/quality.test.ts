import { describe, expect, it } from 'vitest';
import {
  KITCHEN_DEPTH,
  TICK,
  createInitialState,
  endOf,
  localToWorld,
  step,
  type Intent,
  type ShotType,
  type SimEvent,
  type SimState,
} from '../src/sim';
import { simTuning as t } from '../src/tuning';

const idle: Intent = { move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, shot: null };
const FLIGHT = 60;

interface Setup {
  type: ShotType;
  /** When the Commit was pressed, as a fraction of the incoming ball's flight (0 = as it was hit, 1 = at Contact). */
  commitAt?: number;
  /** Contact height. */
  ballY?: number;
  /** Incoming speed toward the Player, in m/s. */
  pace?: number;
  /** Player's distance behind the net. */
  depth?: number;
  /** Ball offset from the sweet spot, as a fraction of the reach to the Player's right. */
  offCenter?: number;
  bounced?: boolean;
  seed?: number;
}

type Hit = Extract<SimEvent, { kind: 'hit' }>;

/** Side 0 (End 0, facing -z) meets a ball at its sweet spot. Returns the hit and where it first lands, in Side 1's frame. */
function contact(c: Setup): { hit: Hit; landing: { x: number; depth: number } } {
  let s: SimState = structuredClone(createInitialState(c.seed ?? 1));
  s.phase = 'rally';
  s.shots = 4;
  s.tick = 100;
  const player = { x: 0, y: 0, z: c.depth ?? 5 };
  const sweet = localToWorld(endOf(s, 0), t.sweetSpotSide + (c.offCenter ?? 0) * t.reachSide, t.sweetSpotForward);
  const pace = c.pace ?? 0;
  const hitTick = s.tick + 1 - FLIGHT;
  s.sides[0].players[0].pos = player;
  s.sides[0].players[0].commit = { type: c.type, tick: hitTick + Math.round((c.commitAt ?? 0.2) * FLIGHT), bestDistance: null };
  // Placed one Tick short of the sweet spot, so it arrives there on the next step.
  s.ball = {
    pos: { x: player.x + sweet.x, y: c.ballY ?? 0.7, z: player.z + sweet.z - pace * TICK },
    vel: { x: 0, y: 0, z: pace },
    spin: 0,
    lastHitBy: 1,
    bouncesSinceHit: c.bounced === false ? 0 : 1,
    hitTick,
  };
  let hit: Hit | undefined;
  for (let i = 0; i < 5 && !hit; i++) {
    s = step(s, [idle, idle], t);
    hit = s.events.find((e): e is Hit => e.kind === 'hit');
  }
  if (!hit) throw new Error('no contact');
  for (let i = 0; i < 400; i++) {
    s = step(s, [idle, idle], t);
    const bounce = s.events.find((e) => e.kind === 'bounce');
    if (bounce?.kind === 'bounce') return { hit, landing: { x: bounce.pos.x, depth: -bounce.pos.z } };
  }
  throw new Error('never landed');
}

describe('Commit timing', () => {
  it('gives full quality to a Commit in the first half of the flight', () => {
    expect(contact({ type: 'drive', commitAt: 0.1 }).hit.quality).toBe(1);
    expect(contact({ type: 'drive', commitAt: 0.5 }).hit.quality).toBe(1);
  });

  it('counts a Commit pressed before the opponent hit as early', () => {
    expect(contact({ type: 'drive', commitAt: -0.5 }).hit.quality).toBe(1);
  });

  it('rushes a Commit in the last part of the flight', () => {
    const rushed = contact({ type: 'drive', commitAt: 0.95 }).hit;
    expect(rushed.factors.timing).toBeCloseTo(t.rushedQuality);
    expect(rushed.quality).toBeCloseTo(t.rushedQuality);
  });

  it('keeps an early Commit’s timing when the same button is pressed again', () => {
    let s: SimState = structuredClone(createInitialState(1));
    s.phase = 'rally';
    s.tick = 100;
    s.sides[0].players[0].commit = { type: 'drive', tick: 50, bestDistance: null };
    s.ball = { pos: { x: 0, y: 1, z: -3 }, vel: { x: 0, y: 0, z: 5 }, spin: 0, lastHitBy: 1, bouncesSinceHit: 0, hitTick: 40 };
    s = step(s, [{ ...idle, shot: 'drive' }, idle], t);
    expect(s.sides[0].players[0].commit?.tick).toBe(50);
    s = step(s, [{ ...idle, shot: 'soft' }, idle], t);
    expect(s.sides[0].players[0].commit).toMatchObject({ type: 'soft', tick: s.tick });
  });

  it('ramps between early and rushed', () => {
    const q = contact({ type: 'drive', commitAt: 0.7 }).hit.quality;
    expect(q).toBeLessThan(1);
    expect(q).toBeGreaterThan(t.rushedQuality);
  });

  it('weakens a rushed shot: shorter and slower', () => {
    const early = contact({ type: 'drive', commitAt: 0.2 });
    const rushed = contact({ type: 'drive', commitAt: 0.95 });
    expect(rushed.landing.depth).toBeLessThan(early.landing.depth - 0.3);
    expect(rushed.hit.speed).toBeLessThan(early.hit.speed);
  });
});

describe('Shot quality inputs', () => {
  it('lowers quality for a very low contact', () => {
    const low = contact({ type: 'drive', ballY: 0.1 }).hit;
    expect(low.factors.height).toBeLessThan(1);
    expect(contact({ type: 'drive', ballY: 0.7 }).hit.factors.height).toBe(1);
  });

  it('lowers quality against a fast incoming ball', () => {
    const slow = contact({ type: 'drive', pace: 5 }).hit;
    const fast = contact({ type: 'drive', pace: 16 }).hit;
    expect(slow.factors.pace).toBe(1);
    expect(fast.factors.pace).toBeLessThan(0.8);
    expect(fast.quality).toBeLessThan(slow.quality);
  });

  it('multiplies the inputs, so several poor ones compound', () => {
    const one = contact({ type: 'drive', commitAt: 0.95 }).hit.quality;
    const two = contact({ type: 'drive', commitAt: 0.95, pace: 16 }).hit.quality;
    expect(two).toBeLessThan(one * 0.85);
  });
});

describe('Aim error from Shot quality', () => {
  const seeds = Array.from({ length: 40 }, (_, i) => i + 1);
  const spread = (c: Omit<Setup, 'seed'>) => {
    const xs = seeds.map((seed) => contact({ ...c, seed }).landing.x);
    return xs.reduce((a, x) => a + Math.abs(x), 0) / xs.length;
  };

  it('keeps a full-quality shot on target', () => {
    expect(spread({ type: 'drive' })).toBeLessThan(0.05);
  });

  it('barely widens for one poor input, and sprays when several are poor', () => {
    const one = spread({ type: 'drive', commitAt: 0.95 });
    const several = spread({ type: 'drive', commitAt: 0.95, pace: 17, offCenter: 0.55 });
    expect(one).toBeLessThan(0.1);
    expect(several).toBeGreaterThan(0.1);
    expect(several).toBeGreaterThan(one * 1.5);
  });
});

describe('Context variants', () => {
  it('makes a Soft from the Kitchen line a Dink', () => {
    expect(contact({ type: 'soft', depth: KITCHEN_DEPTH + 0.3, pace: 4 }).hit.variant).toBe('dink');
  });

  it('makes a Soft from deep a Drop', () => {
    expect(contact({ type: 'soft', depth: 6.3, pace: 8 }).hit.variant).toBe('drop');
  });

  it('makes a Soft against a very fast ball a Block that absorbs the pace and lands short', () => {
    const { hit, landing } = contact({ type: 'soft', depth: KITCHEN_DEPTH + 0.3, pace: t.blockSpeed + 3, bounced: false });
    expect(hit.variant).toBe('block');
    expect(hit.volley).toBe(true);
    expect(hit.factors.pace).toBe(1);
    // Short: into the Kitchen, shorter than a Dink aimed the same way.
    expect(landing.depth).toBeLessThan(KITCHEN_DEPTH);
    expect(landing.depth).toBeLessThan(contact({ type: 'soft', depth: KITCHEN_DEPTH + 0.3, pace: 4 }).landing.depth);
  });

  it('makes a Drive on a high ball a Smash', () => {
    expect(contact({ type: 'drive', ballY: 2.0 }).hit.variant).toBe('smash');
    expect(contact({ type: 'drive', ballY: 0.9 }).hit.variant).toBe('drive');
  });

  it('marks contact before the bounce as a Volley', () => {
    expect(contact({ type: 'drive', bounced: false }).hit.volley).toBe(true);
    expect(contact({ type: 'drive' }).hit.volley).toBe(false);
  });
});
