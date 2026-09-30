import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, decode, encode, isHello, type CourtMsg } from '../../src/net';

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
});
