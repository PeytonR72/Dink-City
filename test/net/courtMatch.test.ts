import { describe, expect, it, vi } from 'vitest';
import { DIFFICULTY, createBot } from '../../src/bot/bot';
import { observe } from '../../src/bot/observe';
import { DECAY_TICKS, fadeIntent, quantizeIntent, type CourtMsg, type InMsg, type PresetId, type QIntent, type SnapEvent } from '../../src/net';
import { PRESETS } from '../../src/net/presets';
import { createInitialState, step, type Intent, type SideIndex } from '../../src/sim';
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
  let s = createInitialState(SEED, PRESETS.quick.config);
  for (const pair of pairs) s = step(s, pair, simTuning);
  return s;
}

/** Serve position with the Host moving right; the serve delay is long enough that nobody can serve yet. */
const RIGHT: Intent = { move: { x: 1, y: 0 }, aim: { x: 0, y: 0 }, shot: null };

describe('the Court Match', () => {
  it('starts from the Preset rules and the seed', () => {
    expect(court().state).toEqual(createInitialState(SEED, PRESETS.quick.config));
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
      const q = [0, 1].map((side) => quantizeIntent(bots[side]!.think(observe(onTime.state, side as SideIndex)))) as [QIntent, QIntent];
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
        const q = [0, 1].map((side) => quantizeIntent(bots[side]!.think(observe(m.state, side as SideIndex)))) as [QIntent, QIntent];
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
