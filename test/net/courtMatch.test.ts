import { describe, expect, it, vi } from 'vitest';
import { DIFFICULTY, createBot, type Bot } from '../../src/bot/bot';
import { observe } from '../../src/bot/observe';
import { DECAY_TICKS, dequantizeIntent, fadeIntent, quantizeIntent, type CourtMsg, type InMsg, type PresetId, type QIntent, type SnapEvent } from '../../src/net';
import { onlineConfig } from '../../src/net/presets';
import { REACH_SLACK, autoContact, createInitialState, endOf, endOfZ, step, type Intent, type ShotType, type SideIndex, type SimState } from '../../src/sim';
import { sweetSpotDistance } from '../../src/sim/step';
import { simTuning } from '../../src/tuning';
import { MAX_AHEAD_TICKS, REWIND_TICKS, createCourtMatch, type Outgoing } from '../../party/src/courtMatch';

// A whole Match headlessly takes a few seconds.
vi.setConfig({ testTimeout: 60_000 });

const SEED = 4242;
const ZERO: Intent = { move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, shot: null };

/** A Court Match that logs every step, re-steps included, and the Intents each Tick was last stepped with. */
function court(preset: PresetId = 'quick') {
  const stepped: [number, Intent, Intent][] = [];
  const byTick = new Map<number, readonly [Intent, Intent]>();
  const m = createCourtMatch({
    seed: SEED,
    preset,
    tuning: simTuning,
    onStep: (tick, [a, b]) => {
      stepped.push([tick, a, b]);
      byTick.set(tick, [a, b]);
    },
  });
  return Object.assign(m, { stepped, byTick });
}

/** An `in` with Intents for the Ticks from `from` on. */
function input(from: number, ...intents: Intent[]): InMsg {
  return { t: 'in', from, intents: intents.map(quantizeIntent) };
}

function snaps(out: Outgoing[], side: SideIndex) {
  return out.flatMap((o) => (o.side === side && o.msg.t === 'snap' ? [o.msg] : []));
}

/** Steps the plain Sim the way the Court should, for comparison. */
function reference(pairs: [Intent, Intent][]) {
  let s = createInitialState(SEED, onlineConfig('quick'));
  for (const pair of pairs) s = step(s, pair, simTuning);
  return s;
}

/** Both Bots' Intents for the step from `s`, quantized, each calling its hit as its client would: by `auto`. */
function botIntents(s: SimState, bots: readonly [Bot, Bot]): [QIntent, QIntent] {
  const pair = [bots[0].think(observe(s, 0)), bots[1].think(observe(s, 1))].map((i) => dequantizeIntent(quantizeIntent(i))) as [Intent, Intent];
  return [0, 1].map((side) => quantizeIntent({ ...pair[side]!, contact: autoContact(s, pair, side as SideIndex, simTuning) })) as [QIntent, QIntent];
}

/** Serve position with the Host moving right; the serve delay is long enough that nobody can serve yet. */
const RIGHT: Intent = { move: { x: 1, y: 0 }, aim: { x: 0, y: 0 }, shot: null };

describe('the Court Match', () => {
  it('starts from the Preset rules and the seed', () => {
    expect(court().state).toEqual(createInitialState(SEED, onlineConfig('quick')));
  });

  it('steps a Side with no input yet with a zero Intent', () => {
    const m = court();
    m.advance(10);
    expect(m.state).toEqual(reference(Array.from({ length: 10 }, () => [ZERO, ZERO])));
  });

  it('steps each Tick with the Intent labeled for it, however early it came', () => {
    const m = court();
    m.receive(0, input(0, RIGHT, ZERO, RIGHT));
    m.receive(1, input(2, RIGHT));
    m.advance(3);
    expect(m.state).toEqual(reference([[RIGHT, ZERO], [ZERO, ZERO], [RIGHT, RIGHT]]));
  });

  it('repeats the last move and aim on a Tick with no Intent, fading the move to nothing', () => {
    const m = court();
    const aimed: Intent = { move: { x: 1, y: 0 }, aim: { x: 0, y: 1 }, shot: null };
    m.receive(0, input(0, aimed));
    m.advance(DECAY_TICKS + 3);
    expect(m.stepped.map(([, a]) => +a.move.x.toFixed(3))).toEqual([1, 1, 0.833, 0.667, 0.5, 0.333, 0.167, 0, 0]);
    expect(m.stepped.every(([, a]) => a.aim.y === 1 && a.shot === null && !a.contact)).toBe(true);
    // A Side that never sent anything stands still.
    expect(m.stepped.every(([, , b]) => b.move.x === 0 && b.move.y === 0)).toBe(true);
  });

  it('starts the fade over when Intents come again', () => {
    const m = court();
    m.receive(0, input(0, RIGHT));
    m.advance(5);
    m.receive(0, input(5, RIGHT));
    m.advance(2);
    expect(m.stepped.map(([, a]) => +a.move.x.toFixed(3))).toEqual([1, 1, 0.833, 0.667, 0.5, 1, 1]);
  });

  it('sends a Snapshot to each Side every 2 Ticks, with its own ack', () => {
    const m = court();
    m.receive(1, input(6, ZERO, ZERO));
    const out = [1, 2, 3, 4].flatMap(() => m.advance(1));
    expect(snaps(out, 0).map((s) => [s.tick, s.ack])).toEqual([[2, -1], [4, -1]]);
    expect(snaps(out, 1).map((s) => [s.tick, s.ack])).toEqual([[2, 7], [4, 7]]);
    expect(snaps(out, 0)[1]!.state).toEqual(m.state);
  });

  it('gives a Player who reloads mid-Match the current state at once', () => {
    const m = court();
    m.receive(0, input(3, ZERO));
    m.advance(5);
    expect(m.current(0)).toEqual([{ t: 'snap', tick: 5, ack: 3, state: m.state, last: [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]], events: [] }]);
  });

  it("tells each Snapshot the Intents its last Tick was stepped with, a late one's too once it lands", () => {
    const m = court();
    const aimed: Intent = { move: { x: 1, y: 0 }, aim: { x: 0, y: 1 }, shot: null };
    m.receive(1, input(0, RIGHT, RIGHT, aimed));
    expect(snaps(m.advance(3), 0)[0]!.last).toEqual([[0, 0, 0, 0, 0], [127, 0, 0, 127, 0]]);
    // Side 0's Intent for Tick 2 comes a Tick late. The rewind steps Tick 2 with it, so Tick 4's fill fades from it.
    const left: Intent = { move: { x: -1, y: 0 }, aim: { x: 0, y: 0 }, shot: null };
    m.receive(0, input(2, left));
    expect(snaps(m.advance(2), 0)[0]!.last).toEqual([quantizeIntent(fadeIntent(left, 2)), quantizeIntent(fadeIntent(aimed, 2))]);
  });

  it('sends at most one Snapshot per advance, however many Ticks it runs', () => {
    const m = court();
    expect(snaps(m.advance(1), 0)).toEqual([]);
    expect(snaps(m.advance(7), 0).map((s) => s.tick)).toEqual([8]);
    expect(snaps(m.advance(1), 0)).toEqual([]);
    expect(snaps(m.advance(1), 0).map((s) => s.tick)).toEqual([10]);
  });

  it('acknowledges the last Tick up to which it has every Intent', () => {
    const m = court();
    const ack = () => snaps(m.advance(2), 0).at(-1)!.ack;
    m.receive(0, input(0, ZERO, ZERO, ZERO));
    expect(ack()).toBe(2);
    // A resend overlapping what arrived adds the rest.
    m.receive(0, input(1, ZERO, ZERO, ZERO, ZERO, ZERO));
    expect(ack()).toBe(5);
    // A run starting past the next Tick means the client gave up the ones between.
    m.receive(0, input(9, ZERO));
    expect(ack()).toBe(9);
  });

  it('applies each Intent once, however often it is resent', () => {
    const m = court();
    m.advance(120);
    const press = { ...ZERO, shot: 'drive' as const };
    m.receive(0, input(120, press));
    m.receive(0, input(120, press, ZERO));
    m.advance(1);
    m.receive(0, input(120, press, ZERO, ZERO));
    m.advance(3);
    expect(m.stepped.filter(([, a]) => a.shot !== null).map(([t]) => t)).toEqual([120]);
  });

  it(`refuses Intents more than ${MAX_AHEAD_TICKS} Ticks ahead`, () => {
    const m = court();
    m.receive(0, input(MAX_AHEAD_TICKS - 1, RIGHT, RIGHT, RIGHT));
    m.receive(1, input(MAX_AHEAD_TICKS + 1, RIGHT));
    expect(m.current(0)[0]).toMatchObject({ ack: MAX_AHEAD_TICKS });
    expect(m.current(1)[0]).toMatchObject({ ack: -1 });
  });

  it('rewinds for a late Intent inside the window, so the Match comes out as if it came on time', () => {
    const moves = Array.from({ length: 10 }, (_, i): Intent => ({ move: { x: i % 3 ? -1 : 1, y: 0.5 }, aim: { x: 0, y: 1 }, shot: null }));
    const onTime = court();
    onTime.advance(100);
    onTime.receive(0, input(100, ...moves));
    onTime.advance(20);
    const late = court();
    late.advance(100 + REWIND_TICKS);
    late.receive(0, input(100, ...moves));
    late.advance(20 - REWIND_TICKS);
    expect(late.state).toEqual(onTime.state);
    // The Ticks after the late run are filled from it, fading out, as they would have been.
    expect([...late.byTick].filter(([t]) => t >= 110).map(([, [a]]) => +a.move.x.toFixed(3)).slice(0, 8)).toEqual([
      1, 0.833, 0.667, 0.5, 0.333, 0.167, 0, 0,
    ]);
  });

  it('drops an Intent older than the window, but still acknowledges it', () => {
    const m = court();
    m.advance(100 + REWIND_TICKS + 1);
    m.receive(0, input(100, RIGHT));
    m.advance(1);
    expect(m.state).toEqual(reference(Array.from({ length: 100 + REWIND_TICKS + 2 }, () => [ZERO, ZERO])));
    expect(m.current(0)[0]).toMatchObject({ ack: 100 });
  });

  it('lands a late shot press inside the window on the Tick it was meant for', () => {
    const m = court();
    m.advance(130);
    m.receive(0, input(119, RIGHT, { ...RIGHT, shot: 'drive' }, RIGHT));
    m.advance(1);
    expect([119, 120, 121].map((t) => m.byTick.get(t)![0].shot)).toEqual([null, 'drive', null]);
    const onTime = court();
    onTime.advance(110);
    onTime.receive(0, input(119, RIGHT, { ...RIGHT, shot: 'drive' }, RIGHT));
    onTime.advance(21);
    expect(m.state).toEqual(onTime.state);
    expect(m.state.phase).toBe('rally');
  });

  it('re-simulates the Ticks a rewind covers from buffered states and Intents alone', () => {
    const m = court();
    m.receive(0, input(100, RIGHT));
    m.advance(110);
    const steps = m.stepped.length;
    m.receive(0, input(101, RIGHT, RIGHT));
    m.receive(1, input(103, RIGHT));
    m.advance(0);
    // One rewind from the oldest late Tick, however many Intents came.
    expect(m.stepped.slice(steps).map(([t]) => t)).toEqual([101, 102, 103, 104, 105, 106, 107, 108, 109]);
  });

  it('sends a hit a rewind adds once, and a hit a rewind keeps never again', () => {
    const m = court();
    m.advance(120);
    m.receive(0, input(120, { ...ZERO, shot: 'drive' }));
    const first = [1, 2, 3, 4].flatMap(() => m.advance(1));
    expect(snaps(first, 0).flatMap((s) => s.events).filter((e) => e.kind === 'hit')).toHaveLength(1);
    // Side 1's late Intents rewind past the Serve; the re-simulation hits again, which was already sent.
    m.receive(1, input(119, ZERO, ZERO, ZERO));
    const later = [1, 2, 3, 4].flatMap(() => m.advance(1));
    expect(m.stepped.filter(([t, a]) => t === 120 && a.shot).length).toBe(2);
    expect(snaps(later, 0).flatMap((s) => s.events).filter((e) => e.kind === 'hit')).toEqual([]);
  });

  it('holds outcome events until they are older than the window, then sends each once', () => {
    const m = court();
    m.advance(120);
    m.receive(0, input(120, { ...ZERO, shot: 'drive' }));
    const out: Outgoing[] = [];
    while (m.state.phase !== 'dead') out.push(...m.advance(1));
    const dead = m.state.events.find((e) => e.kind === 'dead')!;
    const deadTick = m.state.tick;
    for (let i = 0; i < 40; i++) out.push(...m.advance(1));
    const told = snaps(out, 0).flatMap((s) => s.events.map((e) => ({ ...e, at: s.tick })));
    const outcomes = told.filter((e) => e.kind === 'dead' || e.kind === 'rally-won');
    expect(outcomes.map((e) => [e.kind, e.tick])).toEqual([
      ['dead', deadTick],
      ['rally-won', deadTick],
    ]);
    expect(outcomes[0]).toMatchObject(dead);
    expect(outcomes.every((e) => e.at >= e.tick + REWIND_TICKS && e.at < e.tick + REWIND_TICKS + 2)).toBe(true);
    // Each Snapshot's events are in Tick order, whatever was held back.
    for (const s of snaps(out, 0)) expect(s.events.map((e) => e.tick)).toEqual([...s.events.map((e) => e.tick)].sort((a, b) => a - b));
  });

  it('comes out the same with one Side always late, across Serves, hits, Rallies won and a Game switch', () => {
    // An on-time Match on Bot Intents, to just past the first Game.
    const onTime = court('long');
    const bots = [createBot(0, 1, DIFFICULTY.hard, simTuning), createBot(1, 2, DIFFICULTY.hard, simTuning)] as const;
    const inputs: [QIntent, QIntent][] = [];
    const onTimeOut: Outgoing[] = [];
    let end = Infinity;
    while (onTime.state.tick < end) {
      const q = botIntents(onTime.state, bots);
      inputs.push(q);
      onTime.receive(0, { t: 'in', from: onTime.state.tick, intents: [q[0]] });
      onTime.receive(1, { t: 'in', from: onTime.state.tick, intents: [q[1]] });
      onTimeOut.push(...onTime.advance(1));
      if (end === Infinity && onTime.state.events.some((e) => e.kind === 'game')) end = onTime.state.tick + 120;
    }

    // The same Intents, with Side 0's arriving in batches up to 12 Ticks after their Tick.
    const late = court('long');
    const lateOut: Outgoing[] = [];
    let sentTo = 0;
    for (let tick = 0; tick < end; tick++) {
      late.receive(1, { t: 'in', from: tick, intents: [inputs[tick]![1]] });
      if (tick % 13 === 12) {
        late.receive(0, { t: 'in', from: sentTo, intents: inputs.slice(sentTo, tick).map((q) => q[0]) });
        sentTo = tick;
      }
      lateOut.push(...late.advance(1));
    }
    late.receive(0, { t: 'in', from: sentTo, intents: inputs.slice(sentTo, end).map((q) => q[0]) });
    lateOut.push(...late.advance(0));
    expect(late.state).toEqual(onTime.state);

    const told = (out: Outgoing[]) => snaps(out, 0).flatMap((s) => s.events);
    const kinds = told(onTimeOut).map((e) => e.kind);
    for (const kind of ['hit', 'rally-won', 'game'] as const) expect(kinds).toContain(kind);
    expect(told(onTimeOut).some((e) => e.kind === 'hit' && e.variant === 'serve')).toBe(true);
    // Outcomes go out once they're final, so the late Match tells exactly the same ones.
    const outcomes = (out: Outgoing[]) => told(out).filter((e) => ['dead', 'rally-won', 'game', 'match'].includes(e.kind));
    expect(outcomes(lateOut)).toEqual(outcomes(onTimeOut).filter((e) => e.tick <= end - REWIND_TICKS));
    // Each true hit is told once, though most of Side 0's were stepped more than once: either on its Tick, or up to
    // a window early, when a timeline with filled-in Intents hit first. A few hits told from such timelines never
    // happened (the real Intents moved the Player out of reach), but they're rare.
    const hits = (out: Outgoing[]) => told(out).flatMap((e) => (e.kind === 'hit' ? [e] : []));
    const pool = hits(lateOut);
    for (const h of hits(onTimeOut)) {
      const i = pool.findIndex((l) => l.side === h.side && l.tick <= h.tick && l.tick > h.tick - REWIND_TICKS);
      expect(i, `hit by Side ${h.side} on Tick ${h.tick}`).toBeGreaterThanOrEqual(0);
      pool.splice(i, 1);
    }
    expect(pool.length).toBeLessThan(hits(onTimeOut).length / 50);
    const keys = told(lateOut).map((e) => `${e.kind}:${'side' in e ? e.side : ''}:${e.tick}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('drops what a Player sent for later Ticks when they disconnect, so their Side fades to a stop', () => {
    const m = court();
    m.advance(120);
    m.receive(0, input(120, RIGHT, RIGHT, { ...RIGHT, shot: 'drive' }, RIGHT));
    m.advance(2);
    m.disconnect(0);
    m.advance(DECAY_TICKS + 1);
    const after = m.stepped.slice(122);
    expect(after.every(([, a]) => a.shot === null)).toBe(true);
    expect(after.map(([, a]) => +a.move.x.toFixed(3))).toEqual([1, 0.833, 0.667, 0.5, 0.333, 0.167, 0]);
    expect(m.state.phase).toBe('serve');
  });

  it("takes a reconnected Player's Intents from wherever their new client starts", () => {
    const m = court();
    m.receive(0, input(0, ZERO, ZERO, ZERO, ZERO, ZERO, ZERO));
    m.advance(2);
    m.disconnect(0);
    m.receive(0, input(3, RIGHT));
    m.advance(2);
    expect(m.stepped.map(([, a]) => a.move.x)).toEqual([0, 0, 0, 1]);
    expect(m.current(0)[0]).toMatchObject({ ack: 3 });
  });

  it('stands a gone Side still and ignores its input from then on', () => {
    const m = court();
    m.receive(0, input(0, RIGHT, RIGHT));
    m.gone(0);
    m.receive(0, input(2, RIGHT));
    m.advance(4);
    expect(m.state).toEqual(reference(Array.from({ length: 4 }, () => [ZERO, ZERO])));
  });

  it('keeps a gone Side still from when it first went, however often the Court says so, across a rewind', () => {
    const m = court();
    m.receive(0, input(0, ...Array.from({ length: 10 }, () => RIGHT)));
    m.advance(10);
    m.gone(0);
    m.advance(5);
    m.gone(0);
    m.receive(1, input(5, RIGHT));
    m.advance(1);
    expect([...m.byTick].filter(([t]) => t >= 10).every(([, [a]]) => a.move.x === 0)).toBe(true);
  });

  it('collects every event since the previous Snapshot, each with its Tick', () => {
    const m = court();
    m.advance(120);
    m.receive(0, input(120, { ...ZERO, shot: 'drive' }));
    const out = m.advance(1).concat(m.advance(1));
    const events = snaps(out, 0).flatMap((s) => s.events);
    // The Serve is a hit on the first of these two Ticks, which the second Tick's step would overwrite in the state.
    expect(events).toContainEqual(expect.objectContaining({ kind: 'hit', side: 0, tick: 121 }));
    expect(m.state.events.some((e) => e.kind === 'hit')).toBe(false);
    expect(snaps(out, 1).flatMap((s) => s.events)).toEqual(events);
  });

  it('plays a Match to the end on Bot Intents, and the result depends only on the seed and the inputs', () => {
    const play = () => {
      const m = court();
      const bots = [createBot(0, 1, DIFFICULTY.hard, simTuning), createBot(1, 2, DIFFICULTY.hard, simTuning)] as const;
      const out: Outgoing[] = [];
      const inputs: [QIntent, QIntent][] = [];
      while (!m.over && m.state.tick < 60 * 60 * 30) {
        const q = botIntents(m.state, bots);
        inputs.push(q);
        m.receive(0, { t: 'in', from: m.state.tick, intents: [q[0]] });
        m.receive(1, { t: 'in', from: m.state.tick, intents: [q[1]] });
        out.push(...m.advance(1));
      }
      return { m, out, inputs };
    };
    const a = play();
    const b = play();
    expect(a.m.over).toBe(true);
    expect(a.m.state).toEqual(b.m.state);
    expect(a.inputs).toEqual(b.inputs);

    const winner = a.m.state.match.winner!;
    const last = (side: SideIndex) => a.out.filter((o) => o.side === side).slice(-2).map((o) => o.msg);
    for (const side of [0, 1] as const) {
      const [snap, over] = last(side) as [Extract<CourtMsg, { t: 'snap' }>, CourtMsg];
      expect(snap.t).toBe('snap');
      expect(snap.state).toEqual(a.m.state);
      expect(over).toEqual({ t: 'over', winner });
    }
    // The Snapshots carry the whole Match's events, in order. The Match event comes at the last Rally's end, before
    // the dead phase runs out and the phase turns to `over`.
    const events: SnapEvent[] = snaps(a.out, 0).flatMap((s) => s.events);
    expect(events.filter((e) => e.kind === 'match')).toEqual([expect.objectContaining({ winner })]);
    expect(events.filter((e) => e.kind === 'rally-won').length).toBe(a.m.state.match.points[0] + a.m.state.match.points[1]);
    for (const s of snaps(a.out, 0)) expect(s.events.map((e) => e.tick)).toEqual([...s.events.map((e) => e.tick)].sort((x, y) => x - y));

    // Nothing more once it's over, but a Player who reloads still gets the end.
    expect(a.m.advance(10)).toEqual([]);
    expect(a.m.current(1)).toEqual([
      { t: 'snap', tick: a.m.state.tick, ack: a.inputs.length - 1, state: a.m.state, last: expect.any(Array), events: [] },
      { t: 'over', winner },
    ]);
  });
});

/**
 * Reported Contact: a hitter's client calls each hit, and the Court checks it. Each test replays one on-time Bot
 * Match, with Side 0's Intents late or forged around its first Rally hit.
 */
describe('Reported Contact on the Court', () => {
  const reports = (q: QIntent) => dequantizeIntent(q).contact === true;
  /** `q` as a modified client sends it: reporting Contact, and pressing `shot` if given (null keeps no press). */
  const forged = (q: QIntent, shot?: ShotType | null) => {
    const i = dequantizeIntent(q);
    return quantizeIntent({ ...i, shot: shot === undefined ? i.shot : shot, contact: true });
  };
  const isHit = (e: SnapEvent, side: SideIndex) => e.kind === 'hit' && e.side === side && e.variant !== 'serve';

  /** On time, to 2 s past Side 0's first Rally hit: the Intents stepped, the state on every Tick, the events told. */
  const ON_TIME = (() => {
    const m = court();
    const bots = [createBot(0, 1, DIFFICULTY.hard, simTuning), createBot(1, 2, DIFFICULTY.hard, simTuning)] as const;
    const inputs: [QIntent, QIntent][] = [];
    const states: SimState[] = [m.state];
    const events: SnapEvent[] = [];
    let end = Infinity;
    while (m.state.tick < end) {
      const q = botIntents(m.state, bots);
      inputs.push(q);
      m.receive(0, { t: 'in', from: m.state.tick, intents: [q[0]] });
      m.receive(1, { t: 'in', from: m.state.tick, intents: [q[1]] });
      events.push(...snaps(m.advance(1), 0).flatMap((s) => s.events));
      states.push(m.state);
      if (end === Infinity && m.state.events.some((e) => e.kind === 'hit' && e.side === 0 && e.variant !== 'serve')) end = m.state.tick + 120;
    }
    return { inputs, states, events };
  })();
  /** Side 0's first Rally hit is on Tick `HIT`, stepped from `T` with `contact`. */
  const HIT = ON_TIME.events.find((e) => isHit(e, 0))!.tick;
  const T = HIT - 1;
  /** Side 1's hit before it, and the Serve that began the Rally. */
  const BEFORE = ON_TIME.events.filter((e) => isHit(e, 1) && e.tick < HIT).at(-1)!.tick;
  const SERVE = ON_TIME.events.filter((e) => e.kind === 'hit' && e.variant === 'serve' && e.tick < HIT).at(-1)!.tick;

  /**
   * The on-time Match again to Tick `to`, Side 1 on time and Side 0's Intents through `edit`. With `late`, Side 0's
   * Intents from Tick `from` on wait until the Court is on Tick `at`, then come together.
   */
  function replay(to: number, opts: { edit?: (tick: number, q: QIntent) => QIntent; late?: { from: number; at: number } } = {}) {
    const m = court();
    const side0 = ON_TIME.inputs.map((q, tick) => opts.edit?.(tick, q[0]) ?? q[0]);
    const states: SimState[] = [m.state];
    const events: SnapEvent[] = [];
    const { from, at } = opts.late ?? { from: Infinity, at: Infinity };
    for (let tick = 0; tick < to; tick++) {
      m.receive(1, { t: 'in', from: tick, intents: [ON_TIME.inputs[tick]![1]] });
      if (tick < from) m.receive(0, { t: 'in', from: tick, intents: [side0[tick]!] });
      else if (tick >= at) m.receive(0, { t: 'in', from: Math.min(from, tick), intents: side0.slice(Math.min(from, tick), tick + 1) });
      events.push(...snaps(m.advance(1), 0).flatMap((s) => s.events));
      states.push(m.state);
    }
    return { m, states, events };
  }

  it('is on for both Sides, and the on-time Match hits by it', () => {
    expect(court().state.match.config.contactMode).toEqual(['reported', 'reported']);
    expect(reports(ON_TIME.inputs[T]![0])).toBe(true);
    expect(SERVE).toBeLessThan(BEFORE);
  });

  it(`accepts a hit reported up to ${REWIND_TICKS} Ticks late, and comes out as if it came on time`, () => {
    const r = replay(HIT + 60, { late: { from: T, at: T + REWIND_TICKS } });
    expect(r.m.byTick.get(T)![0].contact).toBe(true);
    expect(r.m.state).toEqual(ON_TIME.states[HIT + 60]);
    // Until the report came, the Court's ball flew on; the rewind put the hit back, and it's told once.
    expect(r.states[T + REWIND_TICKS - 1]!.ball.lastHitBy).toBe(1);
    expect(r.events.filter((e) => isHit(e, 0))).toEqual([expect.objectContaining({ tick: HIT })]);
  });

  it('drops a hit reported past the window, and the ball flies on', () => {
    const r = replay(HIT + 30, { late: { from: T, at: T + REWIND_TICKS + 1 } });
    // The Intents after it land, but none of them reports a hit.
    expect(r.m.byTick.get(T)![0].contact).toBeUndefined();
    expect(r.m.byTick.get(T + 1)).toEqual([dequantizeIntent(ON_TIME.inputs[T + 1]![0]), dequantizeIntent(ON_TIME.inputs[T + 1]![1])]);
    expect(r.events.some((e) => isHit(e, 0))).toBe(false);
    expect(r.m.state.ball.lastHitBy).toBe(1);
    expect(r.m.state.ball).not.toEqual(ON_TIME.states[HIT + 30]!.ball);
  });

  it('rejects a forged report while the ball is out of reach', () => {
    // A modified client: Committed the moment Side 1 hit, and reporting a hit on every Tick after.
    const r = replay(HIT + 10, { edit: (tick, q) => (tick === BEFORE ? forged(q, 'drive') : tick > BEFORE ? forged(q) : q) });
    const hit = r.events.find((e) => isHit(e, 0))!;
    if (hit.kind !== 'hit') throw new Error('no hit');
    // The Sim checks Contact after the step's movement, so on the state each Tick stepped to: reach plus `REACH_SLACK`.
    const inReach = (s: SimState, ball = s.ball.pos) => sweetSpotDistance(s.sides[0].players[0], endOf(s, 0), ball, simTuning, REACH_SLACK) !== null;
    const eligible = (s: SimState) => s.ball.lastHitBy === 1 && endOfZ(s.ball.pos.z) === endOf(s, 0) && s.ball.bouncesSinceHit <= 1;
    const refused = r.states.slice(BEFORE + 1, hit.tick).filter((s) => s.sides[0].players[0].commit !== null && eligible(s));
    expect(refused.length).toBeGreaterThan(5);
    expect(refused.every((s) => !inReach(s))).toBe(true);
    // The hit it did get was in reach: an early swing is the Player's call, a long-armed one isn't.
    expect(inReach(r.states[hit.tick]!, hit.pos)).toBe(true);
    expect(hit.tick).toBeLessThanOrEqual(HIT);
  });

  it('rejects a forged report from a Player with no Commit', () => {
    // A modified client that never presses in this Rally, but reports a hit on every Tick.
    const r = replay(HIT + 10, { edit: (tick, q) => (tick >= SERVE ? forged(q, null) : q) });
    expect(r.states.slice(SERVE, HIT + 10).every((s) => s.sides[0].players[0].commit === null)).toBe(true);
    expect(r.events.some((e) => isHit(e, 0))).toBe(false);
    expect(r.m.state.ball.lastHitBy).toBe(1);
  });

  it("rejects a forged report on the Player's own last hit", () => {
    // Right after its hit, a modified client presses and reports on every Tick until Side 1 hits back.
    const back = ON_TIME.events.find((e) => isHit(e, 1) && e.tick > HIT)?.tick ?? HIT + 60;
    const to = Math.min(back - 1, HIT + 60);
    const r = replay(to, { edit: (tick, q) => (tick >= HIT ? forged(q, 'drive') : q) });
    expect(to - HIT).toBeGreaterThan(20);
    expect(r.events.filter((e) => isHit(e, 0)).map((e) => e.tick)).toEqual([HIT]);
    expect(r.m.state.ball).toEqual(ON_TIME.states[to]!.ball);
  });
});
