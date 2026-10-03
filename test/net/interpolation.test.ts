import { describe, expect, it } from 'vitest';
import { INTERP_DELAY_TICKS, createInterpolator, isOutcome, type SnapEvent, type Told } from '../../src/net';
import { TICK, createInitialState, type SimState } from '../../src/sim';

const START = createInitialState(1);
const at = (tick: number): SimState => ({ ...START, tick });
const hit = (tick: number) =>
  ({ kind: 'hit', side: 1, type: 'drive', variant: 'drive', volley: false, quality: 1, speed: 10, pos: { x: 0, y: 1, z: -6 }, tick }) as SnapEvent;
const bounce = (tick: number): SnapEvent => ({ kind: 'bounce', pos: { x: 0, y: 0, z: -3 }, speed: 5, tick });
const net = (tick: number): SnapEvent => ({ kind: 'net', pos: { x: 0, y: 0, z: 0 }, cord: false, tick });
const dead = (tick: number): SnapEvent => ({ kind: 'dead', reason: 'out', loser: 1, tick });
const won = (tick: number): SnapEvent => ({ kind: 'rally-won', winner: 0, sideOut: false, tick });

describe('the Interpolated timeline', () => {
  it('stands at the start until the first Snapshot, then draws 100 ms behind it', () => {
    const tl = createInterpolator(START);
    tl.advance(TICK * 5);
    expect(tl.clock).toBe(0);
    tl.push(at(20), []);
    expect(tl.clock).toBe(20 - INTERP_DELAY_TICKS);
    expect(tl.states.map((s) => s.tick)).toEqual([0, 20]);
  });

  it('runs with real time, eases toward 100 ms behind the newest, and never passes it', () => {
    const tl = createInterpolator(START);
    tl.push(at(20), []);
    tl.advance(TICK);
    // A Tick on, and eased back toward 14 by a little.
    expect(tl.clock).toBeCloseTo(15 - (1 - Math.exp(-3 * TICK)), 9);
    // No Snapshots for a while: it reaches the newest and waits there.
    for (let i = 0; i < 30; i++) tl.advance(TICK);
    expect(tl.clock).toBe(20);
    // A Snapshot far ahead (a hidden tab): it jumps.
    tl.push(at(100), []);
    expect(tl.clock).toBe(100 - INTERP_DELAY_TICKS);
  });

  it('resyncs on a Snapshot that leaves it over 30 Ticks behind, skipping what it passed over rather than playing it fast', () => {
    const tl = createInterpolator(START);
    tl.push(at(20), [hit(18)]);
    // A hidden tab: Snapshots arrive, but no frame runs the clock.
    for (let t = 22; t <= 50; t += 2) tl.push(at(t), [bounce(t - 1)]);
    expect(tl.clock).toBe(14);
    tl.push(at(52), [hit(51)]);
    expect(tl.clock).toBe(52 - INTERP_DELAY_TICKS);
    // Only the Snapshots it may still draw are kept.
    expect(tl.states[0]!.tick).toBeGreaterThanOrEqual(46 - 4 - 2);
    const told: Told[] = [];
    while (tl.clock < 52) told.push(...tl.advance(TICK));
    expect(told.flatMap((t) => t.events)).toEqual([bounce(47), bounce(49), hit(51)]);
  });

  it('jumps on a frame long enough to leave it over 30 Ticks behind, skipping what it passed over', () => {
    const tl = createInterpolator(START);
    tl.push(at(20), []);
    tl.advance(TICK);
    tl.push(at(40), [bounce(30), bounce(39)]);
    const told = tl.advance(1);
    expect(tl.clock).toBe(40 - INTERP_DELAY_TICKS);
    expect(told).toEqual([]);
    while (tl.clock < 39) told.push(...tl.advance(TICK));
    expect(told.flatMap((t) => t.events)).toEqual([bounce(39)]);
  });

  it('keeps an outcome told across a resync', () => {
    const tl = createInterpolator(START);
    tl.push(at(20), [hit(18)]);
    expect(tl.push(at(80), [dead(79)]).flatMap((t) => t.events)).toEqual([dead(79)]);
  });

  it("ignores a Snapshot that isn't newer", () => {
    const tl = createInterpolator(START);
    tl.push(at(20), []);
    expect(tl.push(at(18), [dead(17)])).toEqual([]);
    expect(tl.states.map((s) => s.tick)).toEqual([0, 20]);
  });

  it('keeps the Snapshots from the last one 4 Ticks behind the clock on', () => {
    const tl = createInterpolator(START);
    for (let t = 2; t <= 40; t += 2) tl.push(at(t), []);
    for (let i = 0; i < 20; i++) tl.advance(TICK);
    expect(tl.states[0]!.tick).toBeLessThanOrEqual(tl.clock - 4);
    expect(tl.states[1]!.tick).toBeGreaterThan(tl.clock - 4);
    expect(tl.states.at(-1)!.tick).toBe(40);
  });

  it('tells the outcomes at once, and the rest when the clock passes them', () => {
    const tl = createInterpolator(START);
    const s = at(30);
    expect(tl.push(s, [hit(28), bounce(29)])).toEqual([]);
    // The clock is on 24.
    const told: Told[] = [];
    for (let i = 0; i < 3; i++) told.push(...tl.advance(TICK));
    expect(tl.clock).toBeLessThan(28);
    expect(told).toEqual([]);
    while (tl.clock < 28) told.push(...tl.advance(TICK));
    expect(told).toEqual([{ state: s, events: [hit(28)] }]);
    while (tl.clock < 29) told.push(...tl.advance(TICK));
    expect(told).toEqual([
      { state: s, events: [hit(28)] },
      { state: s, events: [bounce(29)] },
    ]);
    expect(tl.push(at(46), [dead(31)])).toEqual([{ state: at(46), events: [dead(31)] }]);
  });

  it('tells any event waiting from before an outcome first, so they come in order', () => {
    const tl = createInterpolator(START);
    const a = at(30);
    const b = at(46);
    tl.push(a, [hit(28)]);
    expect(tl.push(b, [dead(30), bounce(44), won(45), net(46)])).toEqual([
      { state: a, events: [hit(28)] },
      { state: b, events: [dead(30)] },
      { state: b, events: [bounce(44), won(45)] },
    ]);
    // The net waits for the clock.
    const told: Told[] = [];
    while (tl.clock < 46) told.push(...tl.advance(TICK));
    expect(told).toEqual([{ state: b, events: [net(46)] }]);
  });

  it('knows the outcomes', () => {
    for (const e of [dead(1), won(1), { kind: 'game', winner: 0, tick: 1 }, { kind: 'match', winner: 0, tick: 1 }]) expect(isOutcome(e as SnapEvent)).toBe(true);
    for (const e of [hit(1), bounce(1), net(1)]) expect(isOutcome(e)).toBe(false);
  });
});
