import { describe, expect, it, vi } from 'vitest';
import { DIFFICULTY, createBot } from '../../src/bot/bot';
import { observe } from '../../src/bot/observe';
import { quantizeIntent, type CourtMsg, type InMsg, type QIntent, type SnapEvent } from '../../src/net';
import { PRESETS } from '../../src/net/presets';
import { createInitialState, step, type Intent, type SideIndex } from '../../src/sim';
import { simTuning } from '../../src/tuning';
import { createCourtMatch, type Outgoing } from '../../party/src/courtMatch';

// A whole Match headlessly takes a few seconds.
vi.setConfig({ testTimeout: 60_000 });

const SEED = 4242;
const ZERO: Intent = { move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, shot: null };

function court() {
  return createCourtMatch({ seed: SEED, preset: 'quick', tuning: simTuning });
}

function input(tick: number, intent: Intent): InMsg {
  return { t: 'in', tick, intent: quantizeIntent(intent) };
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

  it('keeps the latest move and aim for every Tick until the next input', () => {
    const m = court();
    m.receive(0, input(0, RIGHT));
    m.advance(5);
    expect(m.state).toEqual(reference(Array.from({ length: 5 }, () => [RIGHT, ZERO])));
  });

  it('sends a Snapshot to each Side every 2 Ticks, with its own ack', () => {
    const m = court();
    m.receive(1, input(7, ZERO));
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

  it('latches a shot pressed between Ticks and uses it on the next step only', () => {
    const m = court();
    // Wait out the serve delay, then press once. The Host serves first.
    m.advance(120);
    const pairs: [Intent, Intent][] = Array.from({ length: 120 }, () => [ZERO, ZERO]);
    m.receive(0, input(120, { ...ZERO, shot: 'drive' }));
    // A move after the press doesn't drop it.
    m.receive(0, input(121, ZERO));
    m.advance(3);
    pairs.push([{ ...ZERO, shot: 'drive' }, ZERO], [ZERO, ZERO], [ZERO, ZERO]);
    expect(m.state).toEqual(reference(pairs));
    expect(m.state.phase).toBe('rally');
  });

  it('drops a latched shot when the Player disconnects, but keeps their move', () => {
    const m = court();
    m.advance(120);
    m.receive(0, input(120, { ...RIGHT, shot: 'drive' }));
    m.disconnect(0);
    m.advance(2);
    const pairs: [Intent, Intent][] = Array.from({ length: 120 }, () => [ZERO, ZERO]);
    pairs.push([RIGHT, ZERO], [RIGHT, ZERO]);
    expect(m.state).toEqual(reference(pairs));
    expect(m.state.phase).toBe('serve');
  });

  it('stands a gone Side still and ignores its input from then on', () => {
    const m = court();
    m.receive(0, input(0, RIGHT));
    m.gone(0);
    m.receive(0, input(1, RIGHT));
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
        m.receive(0, { t: 'in', tick: m.state.tick, intent: q[0] });
        m.receive(1, { t: 'in', tick: m.state.tick, intent: q[1] });
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
