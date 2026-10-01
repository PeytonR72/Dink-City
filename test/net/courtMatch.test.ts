import { describe, expect, it, vi } from 'vitest';
import { DIFFICULTY, createBot } from '../../src/bot/bot';
import { observe } from '../../src/bot/observe';
import { quantizeIntent, type CourtMsg, type InMsg, type QIntent, type SnapEvent } from '../../src/net';
import { PRESETS } from '../../src/net/presets';
import { createInitialState, step, type Intent, type SideIndex } from '../../src/sim';
import { simTuning } from '../../src/tuning';
import { DECAY_TICKS, MAX_AHEAD_TICKS, createCourtMatch, type Outgoing } from '../../party/src/courtMatch';

// A whole Match headlessly takes a few seconds.
vi.setConfig({ testTimeout: 60_000 });

const SEED = 4242;
const ZERO: Intent = { move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, shot: null };

/** A Court Match that logs the Intents it steps each Tick with. */
function court() {
  const stepped: [number, Intent, Intent][] = [];
  const m = createCourtMatch({ seed: SEED, preset: 'quick', tuning: simTuning, onStep: (tick, [a, b]) => stepped.push([tick, a, b]) });
  return Object.assign(m, { stepped });
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
    expect(m.current(0)).toEqual([{ t: 'snap', tick: 5, ack: 3, state: m.state, events: [] }]);
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

  it('drops a late Intent but applies its shot press on the next Tick', () => {
    const m = court();
    m.advance(120);
    m.receive(0, input(118, RIGHT, { ...RIGHT, shot: 'drive' }, RIGHT));
    m.advance(2);
    // Ticks 118 and 119 were stepped before they came: the move is lost, the press lands on 120 with 120's move.
    expect(m.stepped.slice(-2).map(([t, a]) => [t, a.move.x, a.shot])).toEqual([
      [120, 1, 'drive'],
      [121, 1, null],
    ]);
    expect(m.state.phase).toBe('rally');
  });

  it('keeps a late press for the Tick after when that Tick has a press of its own', () => {
    const m = court();
    m.advance(120);
    m.receive(0, input(119, { ...ZERO, shot: 'lob' }, { ...ZERO, shot: 'soft' }));
    m.advance(2);
    expect(m.stepped.slice(-2).map(([, a]) => a.shot)).toEqual(['lob', 'soft']);
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
    expect(events.map((e) => e.tick)).toEqual([...events.map((e) => e.tick)].sort((x, y) => x - y));

    // Nothing more once it's over, but a Player who reloads still gets the end.
    expect(a.m.advance(10)).toEqual([]);
    expect(a.m.current(1)).toEqual([
      { t: 'snap', tick: a.m.state.tick, ack: a.inputs.length - 1, state: a.m.state, events: [] },
      { t: 'over', winner },
    ]);
  });
});
