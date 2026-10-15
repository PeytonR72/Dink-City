import { describe, expect, it } from 'vitest';
import { createControllerRelay } from '../party/src/controllerRelay';
import { makePairCode, isPairCode, readControllerMsg, createControllerClock } from '../src/net/controller';
import { isCourtCode } from '../src/net/courtCode';
import { isAllowedOrigin } from '../party/src/origin';
const hello = JSON.stringify({ t: 'hello', version: 1 });
const swing = JSON.stringify({ t: 'swing', type: 'drive', aim: { x: 0, y: 0 }, strength: 0.5, at: 1000 });
describe('Controller wire and relay', () => {
  it('uses a separate unbiased Pair code namespace', () => { const code = makePairCode(n => new Uint8Array(n).fill(5)); expect(isPairCode(code)).toBe(true); expect(isCourtCode(code)).toBe(false); expect(isPairCode('P-../../etc')).toBe(false); });
  it('rejects oversized, malformed, nonfinite, wrong-version and out-of-range messages', () => {
    for (const raw of ['{', 'x'.repeat(1025), '{"t":"hello","version":99}', '{"t":"pong","at":-1,"phoneAt":0}', swing.replace('0.5', '2'), swing.replace('"drive"', '"smash"'), swing.replace('"x":0', '"x":2')]) expect(readControllerMsg(raw)).toBeNull();
    expect(readControllerMsg(swing)?.t).toBe('swing');
  });
  it('requires a screen and handshake, latest phone wins, old close cannot disconnect its replacement', () => {
    const r = createControllerRelay(); expect(r.connect('p0', 'phone')).toContainEqual({ kind: 'close', id: 'p0', reason: 'expired' });
    r.connect('s', 'screen'); expect(r.connect('s2', 'screen')[0]).toMatchObject({ kind: 'close' });
    r.connect('p', 'phone'); expect(r.message('p', swing, 0)).toEqual([]); r.message('p', hello, 0);
    expect(r.message('p', swing, 1)[0]).toMatchObject({ kind: 'send', id: 's', msg: { t: 'swing' } });
    expect(r.connect('new', 'phone')).toContainEqual({ kind: 'close', id: 'p', reason: 'replaced' });
    expect(r.disconnect('p')).toEqual([]); r.message('new', hello, 2);
    expect(r.message('p', swing, 2)).toEqual([]); expect(r.message('new', swing, 2)).toHaveLength(1);
    expect(r.disconnect('s')).toContainEqual({ kind: 'close', id: 'new', reason: 'expired' });
    expect(r.connect('again', 'screen')[0]).toMatchObject({ reason: 'expired' });
  });
  it('enforces role direction and rate limits, including malformed attempts', () => {
    const r = createControllerRelay(); r.connect('s', 'screen'); r.connect('p', 'phone'); r.message('p', hello, 0);
    expect(r.message('s', swing, 0)).toEqual([]); expect(r.message('p', '{"t":"status","connected":true}', 0)).toEqual([]);
    for (let i = 0; i < 80; i++) r.message('p', '{bad', 0);
    expect(r.message('p', swing, 0)).toEqual([]); expect(r.message('p', swing, 1001)).toHaveLength(1);
  });
  it('keeps preview origins opt-in and exact, with production defaults unchanged', () => {
    const origin = 'https://example.test'; expect(isAllowedOrigin(origin)).toBe(false);
    expect(isAllowedOrigin(origin, { EXTRA_ORIGINS: origin })).toBe(false);
    expect(isAllowedOrigin(origin, { CONTROLLER_DEV: 'true', EXTRA_ORIGINS: origin })).toBe(true);
    expect(isAllowedOrigin(origin + '.evil', { CONTROLLER_DEV: 'true', EXTRA_ORIGINS: origin })).toBe(false);
  });
  it('maps phone timestamps with midpoint clock offset and measured round trip', () => {
    const clock = createControllerClock(); expect(clock.rtt).toBeNull();
    expect(clock.pong(1000, 6020, 1040)).toBe(true); expect(clock.rtt).toBe(40); expect(clock.screenTime(6100)).toBe(1100);
    expect(clock.pong(1000, 0, 999)).toBe(false);
  });
});
