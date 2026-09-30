// When the Court starts the Match, pure, with the time passed in: once both Players are ready, or 10 s after the
// Guest is seated. Either way only while both are connected.
import type { SideIndex } from '../../src/sim';
import type { Seats } from './courtSeats';

/** How long after the Guest is seated the Match starts, even if a client never says `ready`. */
export const START_CAP_MS = 10_000;

/** Who has said `ready` since connecting, and when the current Guest (by token) was first seated. */
export interface StartGate {
  ready: [boolean, boolean];
  guest: { token: string; since: number } | null;
}

/** A new Court's gate: no one ready, no Guest yet. */
export const NO_ONE_READY: StartGate = { ready: [false, false], guest: null };

/** A Player was seated. The Guest's cap runs from the first time their token was seated. */
export function seated(g: StartGate, side: SideIndex, token: string, now: number): StartGate {
  if (side === 0 || g.guest?.token === token) return g;
  return { ...g, guest: { token, since: now } };
}

/** The Player on `side` loaded their Venue. */
export function ready(g: StartGate, side: SideIndex): StartGate {
  return { ...g, ready: withSide(g.ready, side, true) };
}

/** The Player left; they say `ready` again after they reconnect. */
export function unready(g: StartGate, side: SideIndex): StartGate {
  return { ...g, ready: withSide(g.ready, side, false) };
}

/** Whether the Match should start now. */
export function due(s: Seats, g: StartGate, now: number): boolean {
  const [host, guest] = s.seats;
  if (s.started || s.closed || host?.status !== 'connected' || guest?.status !== 'connected') return false;
  if (g.ready[0] && g.ready[1]) return true;
  const cap = capAt(s, g);
  return cap !== null && now >= cap;
}

/** When the cap runs out, for the Court's timer, if that's still ahead of `now`. */
export function nextDue(s: Seats, g: StartGate, now: number): number | null {
  const cap = s.started || s.closed ? null : capAt(s, g);
  return cap !== null && cap > now ? cap : null;
}

/** The current Guest's cap, if the gate knows them. */
function capAt(s: Seats, g: StartGate): number | null {
  const guest = s.seats[1];
  return guest !== null && g.guest?.token === guest.token ? g.guest.since + START_CAP_MS : null;
}

function withSide(r: [boolean, boolean], side: SideIndex, v: boolean): [boolean, boolean] {
  const next: [boolean, boolean] = [...r];
  next[side] = v;
  return next;
}
