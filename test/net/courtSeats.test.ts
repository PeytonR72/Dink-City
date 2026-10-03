import { describe, expect, it } from 'vitest';
import {
  GRACE_MS,
  HOST_RELOAD_MS,
  IDLE_MS,
  disconnect,
  expire,
  join,
  nextExpiry,
  players,
  provision,
  changes,
  askRematch,
  leave,
  over,
  REMATCH_MS,
  rematchTimedOut,
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
    expect(nextExpiry(seats)).toBe(T0 + IDLE_MS);
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

  it('closes the Court once a Host who left before start runs out of their shorter reload grace', () => {
    const left = disconnect(full(), 0, T0);
    expect(left.seats[0]).toMatchObject({ status: 'grace', until: T0 + HOST_RELOAD_MS });
    expect(expire(left, T0 + HOST_RELOAD_MS - 1).closed).toBe(false);
    const closed = expire(left, T0 + HOST_RELOAD_MS);
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
    expect(expire(back.seats, T0 + HOST_RELOAD_MS).closed).toBe(false);
  });

  it('gives a Host who leaves after the start the full grace', () => {
    expect(disconnect(start(full()), 0, T0).seats[0]).toMatchObject({ status: 'grace', until: T0 + GRACE_MS });
  });

  it('closes a Court that waits 30 minutes with no Guest', () => {
    const s = hosted();
    expect(expire(s, T0 + IDLE_MS - 1).closed).toBe(false);
    const closed = expire(s, T0 + IDLE_MS);
    expect(closed.closed).toBe(true);
    expect(nextExpiry(closed)).toBeNull();
  });

  it('stops the idle clock while a Guest is seated, and restarts it when their seat is freed', () => {
    expect(nextExpiry(full())).toBeNull();
    expect(expire(full(), T0 + IDLE_MS).closed).toBe(false);
    // The Guest leaves at 20 min; their seat is freed 30 s later, and the Court waits another 30 min from then.
    const freedAt = T0 + 20 * 60_000 + GRACE_MS;
    const freed = expire(disconnect(full(), 1, T0 + 20 * 60_000), freedAt);
    expect(freed.seats[1]).toBeNull();
    expect(nextExpiry(freed)).toBe(freedAt + IDLE_MS);
    expect(expire(freed, T0 + IDLE_MS).closed).toBe(false);
    expect(expire(freed, freedAt + IDLE_MS).closed).toBe(true);
  });

  it('has no idle close once the Match has started', () => {
    const started = start(full());
    expect(nextExpiry(started)).toBeNull();
    expect(expire(started, T0 + 10 * IDLE_MS).closed).toBe(false);
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
    const both = disconnect(disconnect(start(full()), 1, T0 + 2_000), 0, T0 + 1_000);
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

  it('tells what changed for each Player after the start: disconnected, back, or replaced by the Takeover Bot', () => {
    const playing = start(full());
    const away = disconnect(playing, 1, T0);
    expect(changes(playing, away)).toEqual([{ side: 1, status: 'grace' }]);
    const back = join(away, { name: 'Guest', token: 'guest-tok' }, 'unused').seats;
    expect(changes(away, back)).toEqual([{ side: 1, status: 'connected' }]);
    const bothAway = disconnect(away, 0, T0 + 1000);
    const gone = expire(bothAway, T0 + GRACE_MS);
    expect(changes(bothAway, gone)).toEqual([{ side: 1, status: 'bot' }]);
    expect(changes(gone, gone)).toEqual([]);
  });

  it('closes the Court when a Match the Takeover Bot played ends: there is no rematch', () => {
    const gone = expire(disconnect(start(full()), 1, T0), T0 + GRACE_MS);
    const ended = over(gone, T0 + GRACE_MS + 60_000);
    expect(ended.closed).toBe(true);
    expect(askRematch(ended, 0).start).toBe(false);
    expect(over(start(full()), T0).closed).toBe(false);
  });

  it('tells nothing before the start: the waiting panel shows who is seated', () => {
    const s = full();
    expect(changes(s, disconnect(s, 1, T0))).toEqual([]);
  });
});

describe('a rematch', () => {
  /** A Match that ended at T0. */
  const ended = () => over(start(full()), T0);

  it('takes no ask while the Match is on', () => {
    const playing = start(full());
    expect(askRematch(playing, 0)).toEqual({ seats: playing, start: false });
  });

  it('starts once both Players have asked, and the next Match can end again', () => {
    const one = askRematch(ended(), 1);
    expect(one.start).toBe(false);
    expect(one.seats.rematch?.asked).toEqual([false, true]);
    // Asking twice changes nothing.
    expect(askRematch(one.seats, 1)).toEqual({ seats: one.seats, start: false });
    expect(askRematch(one.seats, 1).seats).toBe(one.seats);
    const both = askRematch(one.seats, 0);
    expect(both.start).toBe(true);
    expect(both.seats.rematch).toBeNull();
    expect(both.seats.closed).toBe(false);
    expect(nextExpiry(both.seats)).toBeNull();
    expect(over(both.seats, T0 + 5_000).rematch).toEqual({ since: T0 + 5_000, asked: [false, false] });
  });

  it('takes no ask from a seat that is away', () => {
    const away = disconnect(ended(), 0, T0);
    expect(askRematch(away, 0).seats).toEqual(away);
  });

  it('closes the Court when a Player leaves while the other waits, and tells the other they are gone', () => {
    const waiting = askRematch(ended(), 0).seats;
    const left = leave(waiting, 1, T0 + 1_000);
    expect(left.closed).toBe(true);
    expect(left.seats[1]).toMatchObject({ status: 'gone' });
    expect(changes(waiting, left)).toEqual([{ side: 1, status: 'gone' }]);
    expect(askRematch(left, 0).start).toBe(false);
  });

  it('closes the Court when a Player who closed their tab never comes back', () => {
    const away = disconnect(askRematch(ended(), 0).seats, 1, T0 + 1_000);
    expect(away.closed).toBe(false);
    expect(nextExpiry(away)).toBe(T0 + 1_000 + GRACE_MS);
    const gone = expire(away, T0 + 1_000 + GRACE_MS);
    expect(gone.closed).toBe(true);
    expect(changes(away, gone)).toEqual([{ side: 1, status: 'gone' }]);
  });

  it('keeps a Player who reloads while the other waits', () => {
    const away = disconnect(askRematch(ended(), 0).seats, 1, T0 + 1_000);
    const back = join(away, { name: 'Guest', token: 'guest-tok' }, 'unused');
    expect(back.result).toEqual({ ok: true, side: 1, token: 'guest-tok' });
    expect(askRematch(back.seats, 1).start).toBe(true);
  });

  it('closes the Court when no rematch comes in time', () => {
    const waiting = askRematch(ended(), 0).seats;
    expect(nextExpiry(waiting)).toBe(T0 + REMATCH_MS);
    expect(expire(waiting, T0 + REMATCH_MS - 1).closed).toBe(false);
    expect(expire(waiting, T0 + REMATCH_MS).closed).toBe(true);
    expect(rematchTimedOut(waiting, T0 + REMATCH_MS - 1)).toBe(false);
    expect(rematchTimedOut(waiting, T0 + REMATCH_MS)).toBe(true);
  });

  it('leaving during the Match starts the grace, as a disconnect does', () => {
    const playing = start(full());
    expect(leave(playing, 1, T0)).toEqual(disconnect(playing, 1, T0));
  });
});
