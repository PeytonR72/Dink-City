import { describe, expect, it, vi } from 'vitest';
import { DIFFICULTY, createBot } from '../src/bot/bot';
import { observe } from '../src/bot/observe';
import { DEFAULT_MATCH, REACH_SLACK, autoContact, createInitialState, step, type ContactMode, type Intent, type SimEvent, type SimState } from '../src/sim';
import { sweetSpotDistance } from '../src/sim/step';
import { simTuning as t } from '../src/tuning';

vi.setConfig({ testTimeout: 60_000 });

const idle: Intent = { move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, shot: null };
const report: Intent = { ...idle, contact: true };

/** The state without its Contact modes, as JSON: what must match between an `auto` and a `reported` run. */
function withoutModes(s: SimState): string {
  const { contactMode: _, ...config } = s.match.config;
  return JSON.stringify({ ...s, match: { ...s.match, config } });
}

describe('Reported Contact', () => {
  it('reporting Contact on the Ticks `auto` would hit replays a Bot-vs-Bot Game bit for bit', () => {
    const seed = 2026;
    const run = (reported: boolean, onTick: (s: SimState, tick: number) => void) => {
      const bots = [createBot(0, seed + 1, DIFFICULTY.hard, t), createBot(1, seed + 2, DIFFICULTY.hard, t)] as const;
      const modes: [ContactMode, ContactMode] = ['reported', 'reported'];
      let s = createInitialState(seed, reported ? { ...DEFAULT_MATCH, contactMode: modes } : DEFAULT_MATCH);
      let contacts = 0;
      while (s.phase !== 'over' && s.tick < 60 * 60 * 30) {
        const intents: [Intent, Intent] = [bots[0].think(observe(s, 0)), bots[1].think(observe(s, 1))];
        if (reported) {
          const flags = [autoContact(s, intents, 0, t), autoContact(s, intents, 1, t)];
          contacts += flags.filter(Boolean).length;
          intents[0] = { ...intents[0], contact: flags[0] };
          intents[1] = { ...intents[1], contact: flags[1] };
        }
        s = step(s, intents, t);
        onTick(s, s.tick);
      }
      return { end: s, contacts };
    };

    const auto: string[] = [];
    const hits: SimEvent[] = [];
    run(false, (s) => {
      auto.push(withoutModes(s));
      hits.push(...s.events.filter((e) => e.kind === 'hit' && e.variant !== 'serve'));
    });
    let mismatch: number | null = null;
    const { end, contacts } = run(true, (s, tick) => {
      if (mismatch === null && withoutModes(s) !== auto[tick - 1]) mismatch = tick;
    });

    expect(mismatch).toBeNull();
    expect(end.tick).toBe(auto.length);
    expect(end.match.points).toEqual([11, 13]);
    // The query agrees with `auto` on every Rally hit, and never fires otherwise.
    expect(contacts).toBe(hits.length);
  });

  /**
   * Side 0 Player at (0, 4) at End 0 (local right = +x, forward = -z), committed early to a Drive; Side 1 hit the
   * ball a second ago. Side 0 reports its Contact.
   */
  function rallyWithBall(pos: { x: number; y: number; z: number }, vel = { x: 0, y: 0, z: 0 }, player = { x: 0, y: 0, z: 4 }): SimState {
    const s = structuredClone(createInitialState(3, { ...DEFAULT_MATCH, contactMode: ['reported', 'auto'] }));
    s.phase = 'rally';
    s.tick = 100;
    s.sides[0].players[0].pos = player;
    s.sides[0].players[0].commit = { type: 'drive', tick: 50, bestDistance: null };
    s.ball = { pos, vel, spin: 0, lastHitBy: 1, bouncesSinceHit: 1, hitTick: 40 };
    return s;
  }
  const sweet = { x: 0.2, y: 0.9, z: 3.55 };
  const hitOf = (s: SimState) => s.events.find((e) => e.kind === 'hit');

  it('hits a sweet-spot ball when the Player reports it', () => {
    expect(hitOf(step(rallyWithBall(sweet), [report, idle], t))).toMatchObject({ side: 0, quality: 1 });
  });

  describe('ignores a false report', () => {
    const cases: [string, SimState][] = [
      ['out of reach', rallyWithBall({ x: 0, y: 0.9, z: 1.5 })],
      ['on its own last hit', ownHit()],
      ['on the wrong End', rallyWithBall({ x: 0.2, y: 0.9, z: -0.1 }, undefined, { x: 0, y: 0, z: 0.3 })],
      ['with no Commit', noCommit()],
    ];
    function ownHit() {
      const s = rallyWithBall(sweet);
      s.ball.lastHitBy = 0;
      return s;
    }
    function noCommit() {
      const s = rallyWithBall(sweet);
      s.sides[0].players[0].commit = null;
      return s;
    }
    for (const [name, s] of cases) {
      it(name, () => {
        const next = step(s, [report, idle], t);
        expect(hitOf(next)).toBeUndefined();
        expect(next.phase).toBe('rally');
      });
    }
  });

  it('never hits without a report, even on the Tick `auto` would', () => {
    let s = rallyWithBall(sweet);
    expect(autoContact(s, [idle, idle], 0, t)).toBe(true);
    const events: SimEvent[] = [];
    for (let i = 0; i < 120 && s.phase === 'rally'; i++) {
      s = step(s, [idle, idle], t);
      events.push(...s.events);
    }
    expect(events.filter((e) => e.kind === 'hit')).toEqual([]);
    expect(events).toContainEqual({ kind: 'dead', reason: 'double-bounce', loser: 0 });
  });

  it('allows a report just outside reach, within the slack, as a hit at the edge of reach', () => {
    // No contact assist, so the Player stays put and the ball stays where it is put.
    const still = { ...t, assistSpeed: 0 };
    const just = rallyWithBall({ x: t.reachSide + REACH_SLACK / 2, y: 0.9, z: 4 });
    expect(sweetSpotDistance(just.sides[0].players[0], 0, just.ball.pos, t)).toBeNull();
    const hit = hitOf(step(just, [report, idle], still));
    expect(hit).toMatchObject({ side: 0 });
    expect(hit?.kind === 'hit' && hit.factors.set).toBeCloseTo(t.edgeQuality, 12);

    const beyond = rallyWithBall({ x: t.reachSide + REACH_SLACK * 1.5, y: 0.9, z: 4 });
    expect(hitOf(step(beyond, [report, idle], still))).toBeUndefined();
  });

  it('ignores `contact` on an `auto` Side', () => {
    const s = rallyWithBall({ x: 0.85, y: 0.9, z: 3.8 }, { x: -4, y: 0, z: 0 });
    s.match.config.contactMode = ['auto', 'auto'];
    let plain = s;
    let flagged = s;
    for (let i = 0; i < 30; i++) {
      plain = step(plain, [idle, idle], t);
      flagged = step(flagged, [report, report], t);
      expect(flagged).toEqual(plain);
    }
    expect(plain.shots).toBe(1);
  });

  it('autoContact leaves the state alone', () => {
    const s = rallyWithBall(sweet);
    const before = JSON.stringify(s);
    autoContact(s, [idle, idle], 0, t);
    expect(JSON.stringify(s)).toBe(before);
    expect(s.match.config.contactMode).toEqual(['reported', 'auto']);
  });
});
