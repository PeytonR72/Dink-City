// The Court's seat rules, pure, with the time passed in. The Court DO holds a `Seats` and swaps it for each result.
import type { SideIndex } from '../../src/sim';
import type { CourtErrorCode, CourtPlayer, PeerStatus } from '../../src/net';

/** How long a disconnected Player keeps their seat. */
export const GRACE_MS = 30_000;
/** A Host who leaves before the start gets only this long to reload before the Court closes. */
export const HOST_RELOAD_MS = 15_000;
/** A Court that waits this long for a Guest closes. */
export const IDLE_MS = 30 * 60_000;
/** Once a Match is over, a Court with no rematch by then closes. */
export const REMATCH_MS = 2 * 60_000;

/** `grace`: disconnected, or never connected, until `until`. `gone`: the grace ran out after the Match started. */
export type Seat = { name: string; token: string } & SeatStatus;

type SeatStatus = { status: 'connected' } | { status: 'grace'; until: number } | { status: 'gone' };

/**
 * Seat 0 is the Host's, seat 1 the Guest's. A closed Court takes no one. `waitingSince`: when seat 1 was last free
 * before the start, for the idle close; null while a Guest holds it and after the start. `rematch`: once a Match is
 * over, when it ended and which Players have asked for another; null before the start and while a Match is on.
 */
export interface Seats {
  seats: [Seat | null, Seat | null];
  started: boolean;
  closed: boolean;
  waitingSince: number | null;
  rematch: { since: number; asked: [boolean, boolean] } | null;
}

export type JoinResult = { ok: true; side: SideIndex; token: string } | { ok: false; code: Extract<CourtErrorCode, 'full' | 'not_found'> };

/** The Host holds seat 0 from the start, with a grace period to connect. */
export function provision(hostName: string, hostToken: string, now: number): Seats {
  return {
    seats: [{ name: hostName, token: hostToken, status: 'grace', until: now + GRACE_MS }, null],
    started: false,
    closed: false,
    waitingSince: now,
    rematch: null,
  };
}

/**
 * Seats a valid `hello`. A token reclaims its seat, even from a connection still open (the Court drops that one),
 * and the seat keeps its name. Otherwise the Player takes seat 1 with `newToken`, if it's free.
 */
export function join(s: Seats, hello: { name: string; token?: string }, newToken: string): { seats: Seats; result: JoinResult } {
  if (s.closed) return { seats: s, result: { ok: false, code: 'not_found' } };
  const side = s.seats.findIndex((seat) => seat !== null && seat.token === hello.token);
  if (hello.token !== undefined && side !== -1) {
    const seat = s.seats[side]!;
    if (seat.status === 'gone') return { seats: s, result: { ok: false, code: 'full' } };
    return { seats: withSeat(s, side as SideIndex, withStatus(seat, { status: 'connected' })), result: { ok: true, side: side as SideIndex, token: seat.token } };
  }
  if (s.seats[1] !== null) return { seats: s, result: { ok: false, code: 'full' } };
  const seats = { ...withSeat(s, 1, { name: hello.name, token: newToken, status: 'connected' }), waitingSince: null };
  return { seats, result: { ok: true, side: 1, token: newToken } };
}

/** Starts the grace period of a connected seat: the Host's is shorter before the start. */
export function disconnect(s: Seats, side: SideIndex, now: number): Seats {
  const seat = s.seats[side];
  if (seat?.status !== 'connected') return s;
  const grace = side === 0 && !s.started ? HOST_RELOAD_MS : GRACE_MS;
  return withSeat(s, side, withStatus(seat, { status: 'grace', until: now + grace }));
}

/**
 * The Player leaves for good. During the Match their grace starts, as for a disconnect; once it's over, they're
 * `gone` at once and the Court closes, since there will be no rematch.
 */
export function leave(s: Seats, side: SideIndex, now: number): Seats {
  const seat = s.seats[side];
  if (s.rematch === null || seat === null || seat.status === 'gone') return disconnect(s, side, now);
  return { ...withSeat(s, side, withStatus(seat, { status: 'gone' })), closed: true };
}

/**
 * Ends every grace period that ran out by `now`. Before the start, a Guest's seat is freed and a Host's closes
 * the Court, as does waiting `IDLE_MS` with no Guest. After the start, the seat is `gone`, and the Court closes once
 * both are. Once a Match is over, it closes when either is gone, or after `REMATCH_MS` with no rematch.
 */
export function expire(s: Seats, now: number): Seats {
  if (s.closed) return s;
  const closed: Seats = { seats: [null, null], started: s.started, closed: true, waitingSince: null, rematch: null };
  let next = s;
  for (const side of [0, 1] as const) {
    const seat = next.seats[side];
    if (seat?.status !== 'grace' || seat.until > now) continue;
    if (next.started) next = withSeat(next, side, withStatus(seat, { status: 'gone' }));
    else if (side === 1) next = { ...withSeat(next, 1, null), waitingSince: seat.until };
    else return closed;
  }
  if (next.started && next.seats.every((seat) => seat?.status === 'gone')) return { ...next, closed: true };
  if (next.rematch !== null && (next.seats.some((seat) => seat?.status === 'gone') || rematchTimedOut(next, now))) {
    return { ...next, closed: true };
  }
  if (next.waitingSince !== null && now >= next.waitingSince + IDLE_MS) return closed;
  return next;
}

/** The Match has begun: from now on an expired seat is `gone`, not freed. */
export function start(s: Seats): Seats {
  return { ...s, started: true, waitingSince: null };
}

/** Whether the wait for a rematch has run out by `now`. */
export function rematchTimedOut(s: Seats, now: number): boolean {
  return s.rematch !== null && now >= s.rematch.since + REMATCH_MS;
}

/** The Match is over at `now`: the Players have `REMATCH_MS` to both ask for another. */
export function over(s: Seats, now: number): Seats {
  return { ...s, rematch: { since: now, asked: [false, false] } };
}

/**
 * The Player on `side` asks for a rematch, once the Match is over and while they're connected. `start` once both
 * have: the waiting ends, and the Court starts the next Match. An ask that changes nothing returns `s` itself.
 */
export function askRematch(s: Seats, side: SideIndex): { seats: Seats; start: boolean } {
  if (s.closed || s.rematch === null || s.rematch.asked[side] || s.seats[side]?.status !== 'connected') return { seats: s, start: false };
  const asked: [boolean, boolean] = [...s.rematch.asked];
  asked[side] = true;
  if (asked[0] && asked[1]) return { seats: { ...s, rematch: null }, start: true };
  return { seats: { ...s, rematch: { ...s.rematch, asked } }, start: false };
}

/** When the earliest grace period, the idle wait or the rematch wait ends, for the Court's timer; null if none is running. */
export function nextExpiry(s: Seats): number | null {
  if (s.closed) return null;
  const ends = s.seats.flatMap((seat) => (seat?.status === 'grace' ? [seat.until] : []));
  if (s.waitingSince !== null) ends.push(s.waitingSince + IDLE_MS);
  if (s.rematch !== null) ends.push(s.rematch.since + REMATCH_MS);
  return ends.length > 0 ? Math.min(...ends) : null;
}

/**
 * Each Player whose status went from `before` to `after`, once the Match has started, for their opponent's `peer`.
 * Before the start, the waiting panel has nothing to show.
 */
export function changes(before: Seats, after: Seats): { side: SideIndex; status: PeerStatus }[] {
  if (!after.started) return [];
  return ([0, 1] as const).flatMap((side) => {
    const status = after.seats[side]?.status;
    return status !== undefined && status !== before.seats[side]?.status ? [{ side, status }] : [];
  });
}

/** The seated Players, by Side, as the welcome lists them. */
export function players(s: Seats): [CourtPlayer | null, CourtPlayer | null] {
  const player = (seat: Seat | null) => (seat === null ? null : { name: seat.name, connected: seat.status === 'connected' });
  return [player(s.seats[0]), player(s.seats[1])];
}

function withSeat(s: Seats, side: SideIndex, seat: Seat | null): Seats {
  const seats: Seats['seats'] = [...s.seats];
  seats[side] = seat;
  return { ...s, seats };
}

/** The same Player in a new status. */
function withStatus(seat: Seat, status: SeatStatus): Seat {
  return { name: seat.name, token: seat.token, ...status };
}
