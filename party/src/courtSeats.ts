// The Court's seat rules, pure, with the time passed in. The Court DO holds a `Seats` and swaps it for each result.
import type { SideIndex } from '../../src/sim';
import type { CourtErrorCode, CourtPlayer } from '../../src/net';

/** How long a disconnected Player keeps their seat. */
export const GRACE_MS = 30_000;

/** `grace`: disconnected, or never connected, until `until`. `gone`: the grace ran out after the Match started. */
export type Seat = { name: string; token: string } & SeatStatus;

type SeatStatus = { status: 'connected' } | { status: 'grace'; until: number } | { status: 'gone' };

/** Seat 0 is the Host's, seat 1 the Guest's. A closed Court takes no one. */
export interface Seats {
  seats: [Seat | null, Seat | null];
  started: boolean;
  closed: boolean;
}

export type JoinResult = { ok: true; side: SideIndex; token: string } | { ok: false; code: Extract<CourtErrorCode, 'full' | 'not_found'> };

/** The Host holds seat 0 from the start, with a grace period to connect. */
export function provision(hostName: string, hostToken: string, now: number): Seats {
  return { seats: [{ name: hostName, token: hostToken, status: 'grace', until: now + GRACE_MS }, null], started: false, closed: false };
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
  return { seats: withSeat(s, 1, { name: hello.name, token: newToken, status: 'connected' }), result: { ok: true, side: 1, token: newToken } };
}

/** Starts the grace period of a connected seat. */
export function disconnect(s: Seats, side: SideIndex, now: number): Seats {
  const seat = s.seats[side];
  if (seat?.status !== 'connected') return s;
  return withSeat(s, side, withStatus(seat, { status: 'grace', until: now + GRACE_MS }));
}

/**
 * Ends every grace period that ran out by `now`. Before the start, a Guest's seat is freed and a Host's closes
 * the Court. After it, the seat is `gone`.
 */
export function expire(s: Seats, now: number): Seats {
  let next = s;
  for (const side of [0, 1] as const) {
    const seat = next.seats[side];
    if (seat?.status !== 'grace' || seat.until > now) continue;
    if (next.started) next = withSeat(next, side, withStatus(seat, { status: 'gone' }));
    else if (side === 1) next = withSeat(next, 1, null);
    else return { seats: [null, null], started: false, closed: true };
  }
  return next;
}

/** The Match has begun: from now on an expired seat is `gone`, not freed. */
export function start(s: Seats): Seats {
  return { ...s, started: true };
}

/** When the earliest grace period ends, for the Court's timer; null if none is running. */
export function nextExpiry(s: Seats): number | null {
  const ends = s.seats.flatMap((seat) => (seat?.status === 'grace' ? [seat.until] : []));
  return ends.length > 0 ? Math.min(...ends) : null;
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
