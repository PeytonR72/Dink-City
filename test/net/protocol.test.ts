import { describe, expect, it } from 'vitest';
import { MAX_IN_INTENTS, PROTOCOL_VERSION, decode, encode, isCourtMsg, isHello, isIn, isLeave, isLobbyMsg, isPing, isReady, type CourtMsg, type LobbyMsg } from '../../src/net';
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

  it('guards a leave', () => {
    expect(isLeave({ t: 'leave' })).toBe(true);
    expect(isLeave({ t: 'ready' })).toBe(false);
    expect(isLeave(null)).toBe(false);
  });

  it('guards an in', () => {
    expect(isIn({ t: 'in', from: 0, intents: [[0, 0, 0, 0, 0]] })).toBe(true);
    expect(isIn({ t: 'in', from: 1234, intents: [[127, -127, 64, -1, 7], [0, 0, 0, 0, 0]] })).toBe(true);
    expect(isIn({ t: 'in', from: 9, intents: Array.from({ length: MAX_IN_INTENTS }, () => [0, 0, 0, 0, 1]) })).toBe(true);
  });

  it('refuses an in with a bad first Tick, too few or too many Intents, or a malformed one', () => {
    const ok = [0, 0, 0, 0, 0];
    const bad: unknown[] = [
      { t: 'in', from: -1, intents: [ok] },
      { t: 'in', from: 1.5, intents: [ok] },
      { t: 'in', from: '3', intents: [ok] },
      { t: 'in', from: 3 },
      { t: 'in', from: 3, intents: [] },
      { t: 'in', from: 3, intents: Array.from({ length: MAX_IN_INTENTS + 1 }, () => ok) },
      { t: 'in', from: 3, intents: ok },
      { t: 'in', from: 3, intents: [[0, 0, 0, 0]] },
      { t: 'in', from: 3, intents: [ok, [0, 0, 0, 0, 0, 0]] },
      { t: 'in', from: 3, intents: [[128, 0, 0, 0, 0]] },
      { t: 'in', from: 3, intents: [[0, 0, 0.5, 0, 0]] },
      { t: 'in', from: 3, intents: [[0, 0, 0, 0, 8]] },
      { t: 'in', from: 3, intents: [[0, 0, 0, 0, -1]] },
      { t: 'in', from: 3, intents: [[0, 0, 0, '0', 0]] },
      { t: 'in', from: 3, intents: [{ 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, length: 5 }] },
    ];
    for (const msg of bad) expect(isIn(msg), JSON.stringify(msg)).toBe(false);
  });

  it('guards a ping', () => {
    expect(isPing({ t: 'ping', id: 3, clientTime: 1234.5 })).toBe(true);
    for (const msg of [{ t: 'ping', id: 1.5, clientTime: 0 }, { t: 'ping', id: 1 }, { t: 'ping', id: 1, clientTime: 'x' }, { t: 'in', id: 1, clientTime: 0 }])
      expect(isPing(msg), JSON.stringify(msg)).toBe(false);
  });

  it('guards every Court message', () => {
    const players = [{ name: 'A', connected: true }, null];
    const good: CourtMsg[] = [
      { t: 'welcome', side: 1, token: 'tok', preset: 'quick', players: [{ name: 'A', connected: true }, null] },
      { t: 'error', code: 'full' },
      { t: 'error', code: 'host_left' },
      { t: 'start', seed: 7, preset: 'long', players: [{ name: 'A', connected: true }, { name: 'B', connected: false }] },
      { t: 'snap', tick: 4, ack: -1, state: createInitialState(1), last: [[0, 0, 0, 0, 0], [127, -127, 64, 0, 6]], events: [{ kind: 'match', winner: 1, tick: 3 }] },
      { t: 'over', winner: 0 },
      { t: 'pong', id: 2, clientTime: 1000.25, courtTick: 412.5 },
      { t: 'peer', side: 1, status: 'grace' },
      { t: 'peer', side: 0, status: 'connected' },
      { t: 'peer', side: 1, status: 'gone' },
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
      { t: 'snap', tick: 4, ack: -1, state: null, last: [[0, 0, 0, 0, 0], [127, -127, 64, 0, 6]], events: [] },
      { t: 'snap', tick: 4, ack: -1, state: {}, last: [[0, 0, 0, 0, 0], [127, -127, 64, 0, 6]], events: {} },
      { t: 'snap', tick: '4', ack: -1, state: {}, last: [[0, 0, 0, 0, 0], [127, -127, 64, 0, 6]], events: [] },
      { t: 'snap', tick: 4, ack: -1, state: {}, events: [] },
      { t: 'snap', tick: 4, ack: -1, state: {}, last: [[0, 0, 0, 0, 0]], events: [] },
      { t: 'snap', tick: 4, ack: -1, state: {}, last: [[0, 0, 0, 0, 0], [128, 0, 0, 0, 0]], events: [] },
      { t: 'over', winner: -1 },
      { t: 'pong', id: 2, clientTime: 1000 },
      { t: 'pong', id: 2, clientTime: 1000, courtTick: null },
      { t: 'peer', side: 2, status: 'gone' },
      { t: 'peer', side: 0, status: 'away' },
      { t: 'peer', side: 0 },
    ];
    for (const msg of bad) expect(isCourtMsg(msg), JSON.stringify(msg)).toBe(false);
  });

  it('guards a Lobby list', () => {
    const court = { code: 'AB2CD', hostName: 'Ana', preset: 'quick', players: 1, createdAt: 5 } as const;
    const good: LobbyMsg[] = [
      { t: 'courts', courts: [] },
      { t: 'courts', courts: [court, { ...court, code: 'XY3ZW' }] },
    ];
    for (const msg of good) expect(isLobbyMsg(decode(encode(msg)))).toBe(true);

    const bad: unknown[] = [
      null,
      { t: 'courts' },
      { t: 'courts', courts: {} },
      { t: 'snap', courts: [] },
      { t: 'courts', courts: [null] },
      { t: 'courts', courts: [{ ...court, players: 2 }] },
      { t: 'courts', courts: [{ ...court, preset: 'blitz' }] },
      { t: 'courts', courts: [{ ...court, hostName: 3 }] },
      { t: 'courts', courts: [{ ...court, createdAt: '5' }] },
    ];
    for (const msg of bad) expect(isLobbyMsg(msg), JSON.stringify(msg)).toBe(false);
  });
});
