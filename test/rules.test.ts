import { describe, expect, it } from 'vitest';
import {
  HALF_LENGTH,
  HALF_WIDTH,
  KITCHEN_DEPTH,
  createInitialState,
  endOf,
  facing,
  step,
  type Intent,
  type MatchConfig,
  type SideIndex,
  type SimEvent,
  type SimState,
  type Vec3,
  localToWorld,
  worldToLocal,
} from '../src/sim';
import { simTuning as t } from '../src/tuning';

const idle: Intent = { move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, shot: null };

function other(side: SideIndex): SideIndex {
  return side === 0 ? 1 : 0;
}

/** A Rally in progress: `hitter` just hit the ball, which is at `pos` moving at `vel`. */
function midRally(s: SimState, hitter: SideIndex, pos: Vec3, vel: Vec3, shots = 4, bounces = 0): SimState {
  s = structuredClone(s);
  s.phase = 'rally';
  s.phaseTick = s.tick;
  s.shots = shots;
  s.ball = { pos, vel, spin: 0, lastHitBy: hitter, bouncesSinceHit: bounces };
  return s;
}

/** World z at `depth` meters from the net inside `side`'s End. */
function zIn(s: SimState, side: SideIndex, depth: number): number {
  return -facing(endOf(s, side)) * depth;
}

/** A ball about to bounce, straight down, at (x, depth into `side`'s End). */
function dropAt(s: SimState, hitter: SideIndex, side: SideIndex, x: number, depth: number, shots = 4): SimState {
  return midRally(s, hitter, { x, y: 0.05, z: zIn(s, side, depth) }, { x: 0, y: -3, z: 0 }, shots);
}

/** Step until a `dead` event (or the tick limit), collecting every event. */
function playOut(s: SimState, ticks = 10, intents: (s: SimState) => [Intent, Intent] = () => [idle, idle]) {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    s = step(s, intents(s), t);
    events.push(...s.events);
    if (s.events.some((e) => e.kind === 'dead')) break;
  }
  return { s, events, dead: events.find((e) => e.kind === 'dead') };
}

/** `loser` hits the ball out, ending the Rally against them. */
function loseRally(s: SimState, loser: SideIndex): SimState {
  const r = playOut(dropAt(s, loser, other(loser), HALF_WIDTH + 1, 3));
  expect(r.dead).toMatchObject({ reason: 'out', loser });
  return r.s;
}

/** Let the dead pause run out so the next Serve is set up. */
function toNextServe(s: SimState): SimState {
  for (let i = 0; i < t.deadTicks + 1 && s.phase === 'dead'; i++) s = step(s, [idle, idle], t);
  return s;
}

describe('Side-out scoring', () => {
  it('gives the server a point when the server wins the Rally', () => {
    let s = createInitialState(1);
    s = loseRally(s, 1);
    expect(s.match.points).toEqual([1, 0]);
    expect(s.server).toBe(0);
  });

  it('passes the serve without a point when the receiver wins the Rally (Side-out)', () => {
    let s = createInitialState(1);
    s = loseRally(s, 0);
    expect(s.match.points).toEqual([0, 0]);
    expect(s.server).toBe(1);
  });
});

describe('Rally scoring flag', () => {
  it('gives the receiver the point and the serve when the receiver wins', () => {
    let s = createInitialState(1, { pointsToWin: 11, winBy: 2, rallyScoring: true, bestOf: 1 });
    s = loseRally(s, 0);
    expect(s.match.points).toEqual([0, 1]);
    expect(s.server).toBe(1);
  });
});

describe('Games and Matches', () => {
  const bestOf3: MatchConfig = { pointsToWin: 11, winBy: 2, rallyScoring: false, bestOf: 3 };

  /** Side 0 serving at the given score. */
  function at(points: [number, number], config?: MatchConfig): SimState {
    const s = structuredClone(createInitialState(1, config));
    s.match.points = points;
    return s;
  }

  it('does not end the Game at 11–10', () => {
    const s = loseRally(at([10, 10]), 1);
    expect(s.match.points).toEqual([11, 10]);
    expect(s.match.games).toEqual([0, 0]);
  });

  it('ends the Game when the server reaches 11 with a 2-point lead', () => {
    const s = loseRally(at([11, 10]), 1);
    expect(s.match.games).toEqual([1, 0]);
    expect(s.events).toContainEqual({ kind: 'game', winner: 0 });
  });

  it('ends a single-Game Match after one Game', () => {
    const s = loseRally(at([10, 3]), 1);
    expect(s.match.winner).toBe(0);
    expect(s.events).toContainEqual({ kind: 'match', winner: 0 });
    expect(toNextServe(s).phase).toBe('over');
  });

  it('starts Game 2 of a best-of-3 at 0–0, with Ends switched and the other Side serving first', () => {
    let s = loseRally(at([10, 3], bestOf3), 1);
    expect(s.match.winner).toBeNull();
    s = toNextServe(s);
    expect(s.phase).toBe('serve');
    expect(s.match.points).toEqual([0, 0]);
    expect(s.match.ends).toEqual([1, 0]);
    expect(s.server).toBe(1);
    // Side 0 now stands in the -z End.
    expect(s.sides[0].players[0].pos.z).toBeLessThan(-HALF_LENGTH);
  });

  it('wins a best-of-3 Match at two Games', () => {
    let s = at([10, 3], bestOf3);
    s.match.games = [1, 0];
    s = loseRally(s, 1);
    expect(s.match.winner).toBe(0);
  });
});

describe('Serve', () => {
  /** The server's local x (+ = their right) once the next Serve is set up. */
  function serverLocalX(s: SimState): number {
    const p = s.sides[s.server].players[0];
    return worldToLocal(endOf(s, s.server), p.pos.x, p.pos.z).x;
  }

  it("serves from the right court on the server's even score and the left on odd", () => {
    let s = createInitialState(1);
    expect(serverLocalX(s)).toBeGreaterThan(0);
    s = toNextServe(loseRally(s, 1)); // 1–0
    expect(serverLocalX(s)).toBeLessThan(0);
    s = toNextServe(loseRally(s, 1)); // 2–0
    expect(serverLocalX(s)).toBeGreaterThan(0);
  });

  it("uses the new server's own score after a Side-out", () => {
    let s = structuredClone(createInitialState(1));
    s.match.points = [4, 3];
    s = toNextServe(loseRally(s, 0)); // Side-out: Side 1 serves at 3
    expect(s.server).toBe(1);
    expect(serverLocalX(s)).toBeLessThan(0);
  });

  it('places the receiver diagonally opposite the server', () => {
    const s = createInitialState(1);
    const server = s.sides[0].players[0].pos;
    const receiver = s.sides[1].players[0].pos;
    expect(Math.sign(receiver.x)).toBe(-Math.sign(server.x));
    expect(Math.sign(receiver.z)).toBe(-Math.sign(server.z));
  });
});

describe('Serve landing', () => {
  // Side 0 serves at 0–0 from their right court (world x > 0), so the diagonal
  // Service court is world x < 0 in Side 1's End.
  const serveLandsAt = (x: number, depth: number) => playOut(dropAt(createInitialState(1), 0, 1, x, depth, 1), 3);

  it('is in play when it lands in the diagonal Service court', () => {
    expect(serveLandsAt(-1.5, 4).dead).toBeUndefined();
  });

  it('is a Fault when it lands in the Kitchen', () => {
    expect(serveLandsAt(-1.5, 1).dead).toMatchObject({ reason: 'service-kitchen', loser: 0 });
  });

  it('is a Fault when it lands on the Kitchen line', () => {
    expect(serveLandsAt(-1.5, KITCHEN_DEPTH).dead).toMatchObject({ reason: 'service-kitchen', loser: 0 });
  });

  it('is a Fault when it lands in the wrong Service court', () => {
    expect(serveLandsAt(1.5, 4).dead).toMatchObject({ reason: 'service-court', loser: 0 });
  });

  it('counts the centerline, sideline and baseline as in', () => {
    expect(serveLandsAt(0.02, 4).dead).toBeUndefined();
    expect(serveLandsAt(-HALF_WIDTH, 4).dead).toBeUndefined();
    expect(serveLandsAt(-1.5, HALF_LENGTH).dead).toBeUndefined();
  });

  it('is out past the baseline', () => {
    expect(serveLandsAt(-1.5, HALF_LENGTH + 0.1).dead).toMatchObject({ reason: 'out', loser: 0 });
  });

  it('stays in play after clipping the net cord if it lands in the Service court', () => {
    const s = midRally(createInitialState(1), 0, { x: -0.5, y: 0.87, z: 0.1 }, { x: -1, y: 3, z: -12 }, 1);
    const r = playOut(s, 120);
    expect(r.events.find((e) => e.kind === 'net')).toMatchObject({ cord: true });
    const bounce = r.events.find((e) => e.kind === 'bounce');
    expect(bounce?.kind === 'bounce' && -bounce.pos.z).toBeGreaterThan(KITCHEN_DEPTH);
    expect(r.events.slice(0, r.events.indexOf(bounce!) + 1).some((e) => e.kind === 'dead')).toBe(false);
  });
});

describe('Volley faults', () => {
  /**
   * `hitter` just hit a ball that is now at `side`'s sweet spot, with that
   * Player `depth` meters behind the net. `side` commits a Drive.
   */
  function contactAt(side: SideIndex, depth: number, shots: number, bounces: number) {
    let s = createInitialState(1);
    const end = endOf(s, side);
    const player = { x: 0, y: 0, z: zIn(s, side, depth) };
    const sweet = localToWorld(end, t.sweetSpotSide, t.sweetSpotForward);
    const ball = { x: player.x + sweet.x, y: 0.9, z: player.z + sweet.z };
    s = midRally(s, other(side), ball, { x: 0, y: 0, z: 0 }, shots, bounces);
    s.sides[side].players[0].pos = player;
    const commit: [Intent, Intent] = [idle, idle];
    commit[side] = { ...idle, shot: 'drive' };
    const first = step(s, commit, t);
    const events = [...first.events, ...playOut(first, 2).events];
    return { hit: events.find((e) => e.kind === 'hit'), dead: events.find((e) => e.kind === 'dead') };
  }

  it('faults the receiver for volleying the Serve', () => {
    const r = contactAt(1, 5, 1, 0);
    expect(r.hit).toBeDefined();
    expect(r.dead).toMatchObject({ reason: 'two-bounce', loser: 1 });
  });

  it('lets the receiver hit the Serve after it bounces', () => {
    expect(contactAt(1, 5, 1, 1).dead).toBeUndefined();
  });

  it('faults the server for volleying the return of serve', () => {
    expect(contactAt(0, 5, 2, 0).dead).toMatchObject({ reason: 'two-bounce', loser: 0 });
  });

  it('allows volleys from the third shot on', () => {
    expect(contactAt(1, 5, 3, 0).dead).toBeUndefined();
  });

  it('faults a Volley while standing in the Kitchen', () => {
    expect(contactAt(0, 1.5, 4, 0).dead).toMatchObject({ reason: 'kitchen', loser: 0 });
  });

  it('faults a Volley with a foot on the Kitchen line', () => {
    expect(contactAt(0, KITCHEN_DEPTH + t.footRadius - 0.02, 4, 0).dead).toMatchObject({ reason: 'kitchen' });
  });

  it('allows a Volley just behind the Kitchen line', () => {
    expect(contactAt(0, KITCHEN_DEPTH + t.footRadius + 0.02, 4, 0).dead).toBeUndefined();
  });

  it('allows hitting a bounced ball from inside the Kitchen', () => {
    expect(contactAt(0, 1.5, 4, 1).dead).toBeUndefined();
  });
});

describe('Rally endings', () => {
  it('is out, against the hitter, when the ball lands outside the court', () => {
    const r = playOut(dropAt(createInitialState(1), 1, 0, 0, HALF_LENGTH + 0.2));
    expect(r.dead).toMatchObject({ reason: 'out', loser: 1 });
  });

  it('is in when the ball lands on the baseline', () => {
    expect(playOut(dropAt(createInitialState(1), 1, 0, 0, HALF_LENGTH), 3).dead).toBeUndefined();
  });

  it('is a net, against the hitter, when the ball does not clear the net', () => {
    const s = createInitialState(1);
    const r = playOut(midRally(s, 0, { x: 0, y: 0.5, z: zIn(s, 0, 1) }, { x: 0, y: 0, z: -facing(endOf(s, 0)) * -10 }), 120);
    expect(r.events.some((e) => e.kind === 'net')).toBe(true);
    expect(r.dead).toMatchObject({ reason: 'net', loser: 0 });
  });

  it('is a point against the defender when a ball bounces in and then flies away', () => {
    const s = createInitialState(1);
    const r = playOut(midRally(s, 0, { x: 0, y: 1, z: zIn(s, 1, HALF_LENGTH + 9.9) }, { x: 0, y: 3, z: facing(endOf(s, 0)) * 20 }, 4, 1), 5);
    expect(r.dead).toMatchObject({ reason: 'double-bounce', loser: 1 });
  });

  it('is a point against the Side that lets the ball bounce twice', () => {
    const s = createInitialState(1);
    const r = playOut(midRally(s, 0, { x: 0, y: 1, z: zIn(s, 1, 3) }, { x: 0, y: 0, z: 0 }, 4, 1), 240);
    expect(r.dead).toMatchObject({ reason: 'double-bounce', loser: 1 });
  });
});

describe('Contact assist and the Kitchen', () => {
  it('does not carry a Player into the Kitchen to reach a volley', () => {
    let s = createInitialState(1);
    // Side 0 waits just behind the Kitchen line; a ball floats in short, before bouncing.
    const depth = KITCHEN_DEPTH + t.footRadius + 0.05;
    s = midRally(s, 1, { x: 0.3, y: 1.1, z: zIn(s, 0, 0.3) }, { x: 0, y: 0.5, z: facing(endOf(s, 0)) * -2 });
    s.sides[0].players[0].pos = { x: 0, y: 0, z: zIn(s, 0, depth) };
    s = step(s, [{ ...idle, shot: 'drive' }, idle], t);
    let minDepth = Infinity;
    // Until the ball bounces (after which stepping in is legal).
    for (let i = 0; i < 40 && s.ball.bouncesSinceHit === 0; i++) {
      s = step(s, [idle, idle], t);
      minDepth = Math.min(minDepth, Math.abs(s.sides[0].players[0].pos.z));
    }
    expect(minDepth).toBeGreaterThanOrEqual(KITCHEN_DEPTH + t.footRadius);
  });
});
