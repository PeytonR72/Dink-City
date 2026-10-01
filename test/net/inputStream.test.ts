import { describe, expect, it } from 'vitest';
import { INPUT_REDUNDANCY, MAX_IN_INTENTS, createInputStream, quantizeIntent } from '../../src/net';
import type { Intent, ShotType } from '../../src/sim';

const still = (shot: ShotType | null = null): Intent => ({ move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, shot });
/** An Intent that records its Tick in move.x, so a message shows which Tick each Intent was sampled for. */
const marked = (tick: number): Intent => ({ move: { x: (tick % 100) / 100, y: 0 }, aim: { x: 0, y: 0 }, shot: null });

describe('the input stream', () => {
  it('starts at the first Tick it is asked for, without filling in the past', () => {
    const s = createInputStream();
    const ticks: number[] = [];
    const msg = s.stampTo(40, (t) => (ticks.push(t), still()));
    expect(ticks).toEqual([40]);
    expect(msg).toEqual({ t: 'in', from: 40, intents: [quantizeIntent(still())] });
  });

  it('samples each Tick once, in order, and resends everything unacknowledged', () => {
    const s = createInputStream();
    s.stampTo(10, marked);
    const msg = s.stampTo(13, marked)!;
    expect(msg.from).toBe(10);
    expect(msg.intents).toEqual([10, 11, 12, 13].map((t) => quantizeIntent(marked(t))));
    expect(s.last).toBe(13);
  });

  it('resends on a call that stamps nothing, such as a clock that went back, and sends nothing once all is acknowledged', () => {
    const s = createInputStream();
    s.stampTo(10, marked);
    const ticks: number[] = [];
    expect(s.stampTo(7, (t) => (ticks.push(t), still()))).toEqual({ t: 'in', from: 10, intents: [quantizeIntent(marked(10))] });
    expect(ticks).toEqual([]);
    expect(s.stampTo(11, marked)!.intents.length).toBe(2);
    s.ack(11);
    expect(s.stampTo(11, marked)).toBeNull();
  });

  it('drops what the Court acknowledged', () => {
    const s = createInputStream();
    s.stampTo(10, marked);
    s.stampTo(14, marked);
    s.ack(12);
    expect(s.unacked).toBe(2);
    expect(s.stampTo(15, marked)).toEqual({ t: 'in', from: 13, intents: [13, 14, 15].map((t) => quantizeIntent(marked(t))) });
    // An old ack changes nothing.
    s.ack(5);
    expect(s.unacked).toBe(3);
  });

  it(`keeps the last ${INPUT_REDUNDANCY} Ticks, dropping the oldest`, () => {
    const s = createInputStream();
    s.stampTo(0, marked);
    let msg = null;
    for (let t = 1; t <= 30; t++) msg = s.stampTo(t, marked);
    expect(msg!.from).toBe(30 - INPUT_REDUNDANCY + 1);
    expect(msg!.intents).toEqual(Array.from({ length: INPUT_REDUNDANCY }, (_, i) => quantizeIntent(marked(16 + i))));
  });

  it('holds on to a shot press until the Court acknowledges it', () => {
    const s = createInputStream();
    s.stampTo(0, (t) => still(t === 0 ? 'lob' : null));
    let msg = null;
    for (let t = 1; t <= 20; t++) msg = s.stampTo(t, () => still());
    expect(msg!.from).toBe(0);
    expect(msg!.intents.length).toBe(21);
    s.ack(0);
    msg = s.stampTo(21, () => still());
    expect(msg!.from).toBe(21 - INPUT_REDUNDANCY + 1);
  });

  it(`drops even a shot press past ${MAX_IN_INTENTS} Ticks`, () => {
    const s = createInputStream();
    s.stampTo(0, (t) => still(t === 0 ? 'lob' : null));
    let msg = null;
    for (let t = 1; t <= MAX_IN_INTENTS; t++) msg = s.stampTo(t, () => still());
    expect(msg!.from).toBe(MAX_IN_INTENTS + 1 - INPUT_REDUNDANCY);
  });

  it('skips ahead instead of sampling a long gap Tick by Tick', () => {
    const s = createInputStream();
    s.stampTo(10, marked);
    const ticks: number[] = [];
    const msg = s.stampTo(500, (t) => (ticks.push(t), still()));
    expect(ticks).toEqual([493, 494, 495, 496, 497, 498, 499, 500]);
    // A message is one unbroken run, so what was stamped before the gap is given up.
    expect(msg).toMatchObject({ from: 493, intents: { length: 8 } });
  });
});
