import { describe, expect, it } from 'vitest';
import {
  GRACE_MS,
  disconnect,
  expire,
  join,
  nextExpiry,
  players,
  provision,
  start,
  type Seats,
} from '../../party/src/courtSeats';

const T0 = 1_000_000;

/** A Court whose Host has connected. */
function hosted(): Seats {
  return join(provision('Host', 'host-tok', T0), { name: 'Host', token: 'host-tok' }, 'unused').seats;
}

/** A Court with the Host and a Guest seated. */
function full(): Seats {
  return join(hosted(), { name: 'Guest' }, 'guest-tok').seats;
}

describe('Court seats', () => {
  it('gives the Host seat 0 from provision, waiting for them to connect', () => {
    const s = provision('Host', 'host-tok', T0);
    expect(s.seats[0]).toEqual({ name: 'Host', token: 'host-tok', status: 'grace', until: T0 + GRACE_MS });
    expect(s.seats[1]).toBeNull();
    expect(nextExpiry(s)).toBe(T0 + GRACE_MS);
  });

  it('seats the Host by their token', () => {
    const { seats, result } = join(provision('Host', 'host-tok', T0), { name: 'Host', token: 'host-tok' }, 'unused');
    expect(result).toEqual({ ok: true, side: 0, token: 'host-tok' });
    expect(seats.seats[0]?.status).toBe('connected');
    expect(nextExpiry(seats)).toBeNull();
  });

  it('gives the first tokenless hello seat 1, with the new token', () => {
    const { seats, result } = join(hosted(), { name: 'Guest' }, 'guest-tok');
    expect(result).toEqual({ ok: true, side: 1, token: 'guest-tok' });
    expect(seats.seats[1]).toEqual({ name: 'Guest', token: 'guest-tok', status: 'connected' });
  });

  it('answers a third Player with full', () => {
    const { seats, result } = join(full(), { name: 'Third' }, 'third-tok');
    expect(result).toEqual({ ok: false, code: 'full' });
    expect(seats).toEqual(full());
  });

  it('seats only one of two joins racing for seat 1', () => {
    const first = join(hosted(), { name: 'A' }, 'a-tok');
    const second = join(first.seats, { name: 'B' }, 'b-tok');
    expect(first.result).toEqual({ ok: true, side: 1, token: 'a-tok' });
    expect(second.result).toEqual({ ok: false, code: 'full' });
    expect(second.seats.seats[1]?.name).toBe('A');
  });

  it('treats an unknown token as a new join', () => {
    expect(join(hosted(), { name: 'G', token: 'stale' }, 'new-tok').result).toEqual({ ok: true, side: 1, token: 'new-tok' });
    expect(join(full(), { name: 'G', token: 'stale' }, 'new-tok').result).toEqual({ ok: false, code: 'full' });
  });

  it('lets a token reclaim its seat during the grace period, keeping the seated name', () => {
    const left = disconnect(full(), 1, T0 + 5_000);
    expect(left.seats[1]).toMatchObject({ status: 'grace', until: T0 + 5_000 + GRACE_MS });
    const back = join(left, { name: 'Renamed', token: 'guest-tok' }, 'unused');
    expect(back.result).toEqual({ ok: true, side: 1, token: 'guest-tok' });
    expect(back.seats.seats[1]).toEqual({ name: 'Guest', token: 'guest-tok', status: 'connected' });
  });

  it('lets a token take over a seat that is still connected (a second tab)', () => {
    const { seats, result } = join(full(), { name: 'Guest', token: 'guest-tok' }, 'unused');
    expect(result).toEqual({ ok: true, side: 1, token: 'guest-tok' });
    expect(seats.seats[1]?.status).toBe('connected');
  });

  it('keeps a seat through its whole grace period', () => {
    const left = disconnect(full(), 1, T0);
    expect(expire(left, T0 + GRACE_MS - 1)).toEqual(left);
  });

  it('ignores a disconnect of a seat that is not connected', () => {
    const left = disconnect(full(), 1, T0);
    expect(disconnect(left, 1, T0 + 10_000)).toEqual(left);
    expect(disconnect(hosted(), 1, T0)).toEqual(hosted());
  });

  it('frees the seat of a Guest who left before start', () => {
    const freed = expire(disconnect(full(), 1, T0), T0 + GRACE_MS);
    expect(freed.seats[1]).toBeNull();
    expect(freed.closed).toBe(false);
    // The freed seat goes to the next tokenless hello, and the old token no longer reclaims it.
    expect(join(freed, { name: 'Next' }, 'next-tok').result).toEqual({ ok: true, side: 1, token: 'next-tok' });
    expect(join(freed, { name: 'Guest', token: 'guest-tok' }, 'fresh').result).toEqual({ ok: true, side: 1, token: 'fresh' });
  });

  it('closes the Court once a Host who left before start runs out of grace', () => {
    const left = disconnect(full(), 0, T0);
    expect(expire(left, T0 + GRACE_MS - 1).closed).toBe(false);
    const closed = expire(left, T0 + GRACE_MS);
    expect(closed.closed).toBe(true);
    expect(nextExpiry(closed)).toBeNull();
    expect(join(closed, { name: 'Late' }, 'late-tok').result).toEqual({ ok: false, code: 'not_found' });
    expect(join(closed, { name: 'Host', token: 'host-tok' }, 'x').result).toEqual({ ok: false, code: 'not_found' });
  });

  it('closes the Court when the Host never connects', () => {
    expect(expire(provision('Host', 'host-tok', T0), T0 + GRACE_MS).closed).toBe(true);
  });

  it('keeps the Court open when a Host reloads within the grace', () => {
    const back = join(disconnect(full(), 0, T0), { name: 'Host', token: 'host-tok' }, 'x');
    expect(back.result).toEqual({ ok: true, side: 0, token: 'host-tok' });
    expect(expire(back.seats, T0 + GRACE_MS).closed).toBe(false);
  });

  it('after start, keeps an expired seat as gone rather than freeing it or closing', () => {
    const started = start(full());
    for (const side of [0, 1] as const) {
      const gone = expire(disconnect(started, side, T0), T0 + GRACE_MS);
      expect(gone.closed).toBe(false);
      expect(gone.seats[side]).toMatchObject({ status: 'gone' });
      expect(join(gone, { name: 'X', token: side === 0 ? 'host-tok' : 'guest-tok' }, 'x').result).toEqual({ ok: false, code: 'full' });
    }
  });

  it('closes the Court once both Players are gone', () => {
    const started = start(full());
    const one = expire(disconnect(started, 0, T0), T0 + GRACE_MS);
    expect(one.closed).toBe(false);
    const both = expire(disconnect(one, 1, T0 + 1_000), T0 + 1_000 + GRACE_MS);
    expect(both.closed).toBe(true);
    expect(nextExpiry(both)).toBeNull();
  });

  it('reports the earliest grace end to schedule the timer', () => {
    const both = disconnect(disconnect(full(), 1, T0 + 2_000), 0, T0 + 1_000);
    expect(nextExpiry(both)).toBe(T0 + 1_000 + GRACE_MS);
    expect(nextExpiry(full())).toBeNull();
  });

  it('lists the Players for the welcome', () => {
    expect(players(disconnect(full(), 1, T0))).toEqual([
      { name: 'Host', connected: true },
      { name: 'Guest', connected: false },
    ]);
    expect(players(hosted())).toEqual([{ name: 'Host', connected: true }, null]);
  });
});
