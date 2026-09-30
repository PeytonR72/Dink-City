import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, decode, encode, isCourtMsg, isHello, isIn, isReady, type CourtMsg } from '../../src/net';
import { createInitialState } from '../../src/sim';

const hello = { t: 'hello', name: 'Pat', protocolVersion: PROTOCOL_VERSION, simHash: '0123abcd' };

describe('the Court protocol', () => {
  it('round-trips a message through encode and decode', () => {
    const msg: CourtMsg = { t: 'welcome', side: 1, token: 'tok', preset: 'quick', players: [{ name: 'A', connected: true }, null] };
    expect(decode(encode(msg))).toEqual(msg);
  });

  it('decodes anything with a string tag, and nothing else', () => {
    expect(decode('{"t":"whatever","x":1}')).toEqual({ t: 'whatever', x: 1 });
    for (const raw of ['', 'not json', 'null', '42', '"hello"', '[]', '{}', '{"t":3}']) expect(decode(raw), raw).toBeNull();
  });

  it('guards a hello', () => {
    expect(isHello(hello)).toBe(true);
    expect(isHello({ ...hello, token: 'abc' })).toBe(true);
  });

  it('refuses a hello with a wrong or missing field', () => {
    const bad: unknown[] = [
      null,
      { ...hello, t: 'welcome' },
      { ...hello, name: 7 },
      { ...hello, token: 7 },
      { ...hello, token: null },
      { ...hello, protocolVersion: '1' },
      { ...hello, simHash: undefined },
      { t: 'hello' },
    ];
    for (const msg of bad) expect(isHello(msg), JSON.stringify(msg)).toBe(false);
  });

  it('guards a ready', () => {
    expect(isReady({ t: 'ready' })).toBe(true);
    expect(isReady({ t: 'hello' })).toBe(false);
    expect(isReady(null)).toBe(false);
  });

  it('guards an in', () => {
    expect(isIn({ t: 'in', tick: 0, intent: [0, 0, 0, 0, 0] })).toBe(true);
    expect(isIn({ t: 'in', tick: 1234, intent: [127, -127, 64, -1, 7] })).toBe(true);
  });

  it('refuses an in with a bad Tick or a malformed Intent', () => {
    const bad: unknown[] = [
      { t: 'in', tick: -1, intent: [0, 0, 0, 0, 0] },
      { t: 'in', tick: 1.5, intent: [0, 0, 0, 0, 0] },
      { t: 'in', tick: '3', intent: [0, 0, 0, 0, 0] },
      { t: 'in', tick: 3 },
      { t: 'in', tick: 3, intent: [0, 0, 0, 0] },
      { t: 'in', tick: 3, intent: [0, 0, 0, 0, 0, 0] },
      { t: 'in', tick: 3, intent: [128, 0, 0, 0, 0] },
      { t: 'in', tick: 3, intent: [0, 0, 0.5, 0, 0] },
      { t: 'in', tick: 3, intent: [0, 0, 0, 0, 8] },
      { t: 'in', tick: 3, intent: [0, 0, 0, 0, -1] },
      { t: 'in', tick: 3, intent: [0, 0, 0, '0', 0] },
      { t: 'in', tick: 3, intent: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, length: 5 } },
    ];
    for (const msg of bad) expect(isIn(msg), JSON.stringify(msg)).toBe(false);
  });

  it('guards every Court message', () => {
    const players = [{ name: 'A', connected: true }, null];
    const good: CourtMsg[] = [
      { t: 'welcome', side: 1, token: 'tok', preset: 'quick', players: [{ name: 'A', connected: true }, null] },
      { t: 'error', code: 'full' },
      { t: 'start', seed: 7, preset: 'long', players: [{ name: 'A', connected: true }, { name: 'B', connected: false }] },
      { t: 'snap', tick: 4, ack: -1, state: createInitialState(1), events: [{ kind: 'match', winner: 1, tick: 3 }] },
      { t: 'over', winner: 0 },
    ];
    for (const msg of good) expect(isCourtMsg(decode(encode(msg))), msg.t).toBe(true);

    const bad: unknown[] = [
      null,
      { t: 'hello' },
      { t: 'welcome', side: 2, token: 'tok', preset: 'quick', players },
      { t: 'welcome', side: 0, token: 'tok', preset: 'blitz', players },
      { t: 'welcome', side: 0, token: 'tok', preset: 'quick', players: [] },
      { t: 'error', code: 3 },
      { t: 'error', code: 'toString' },
      { t: 'start', seed: 1.5, preset: 'quick', players },
      { t: 'start', seed: 1, preset: 'quick' },
      { t: 'snap', tick: 4, ack: -1, state: null, events: [] },
      { t: 'snap', tick: 4, ack: -1, state: {}, events: {} },
      { t: 'snap', tick: '4', ack: -1, state: {}, events: [] },
      { t: 'over', winner: -1 },
    ];
    for (const msg of bad) expect(isCourtMsg(msg), JSON.stringify(msg)).toBe(false);
  });
});
