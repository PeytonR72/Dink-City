import { describe, expect, it } from 'vitest';
import { disconnect, expire, GRACE_MS, join, provision, start, type Seats } from '../../party/src/courtSeats';
import { START_CAP_MS, NO_ONE_READY, due, nextDue, ready, seated, unready, type StartGate } from '../../party/src/courtStart';

const T0 = 1_000_000;

/** The Host and a Guest seated at T0, as the Court records it. */
function both(): { seats: Seats; gate: StartGate } {
  const hosted = join(provision('Host', 'host-tok', T0), { name: 'Host', token: 'host-tok' }, 'x').seats;
  const seats = join(hosted, { name: 'Guest' }, 'guest-tok').seats;
  return { seats, gate: seated(seated(NO_ONE_READY, 0, 'host-tok', T0), 1, 'guest-tok', T0) };
}

describe('the Match start', () => {
  it('waits while only one Player is ready', () => {
    const { seats, gate } = both();
    expect(due(seats, ready(gate, 0), T0 + 1)).toBe(false);
    expect(due(seats, ready(gate, 1), T0 + 1)).toBe(false);
  });

  it('starts as soon as both Players are ready', () => {
    const { seats, gate } = both();
    expect(due(seats, ready(ready(gate, 0), 1), T0 + 1)).toBe(true);
  });

  it('starts 10 s after the Guest is seated, ready or not', () => {
    const { seats, gate } = both();
    expect(due(seats, gate, T0 + START_CAP_MS - 1)).toBe(false);
    expect(due(seats, gate, T0 + START_CAP_MS)).toBe(true);
    expect(nextDue(seats, gate, T0 + 1)).toBe(T0 + START_CAP_MS);
  });

  it('has no cap before a Guest is seated', () => {
    const hosted = join(provision('Host', 'host-tok', T0), { name: 'Host', token: 'host-tok' }, 'x').seats;
    const gate = ready(seated(NO_ONE_READY, 0, 'host-tok', T0), 0);
    expect(due(hosted, gate, T0 + 60_000)).toBe(false);
    expect(nextDue(hosted, gate, T0)).toBeNull();
  });

  it('only starts while both Players are connected', () => {
    const { seats, gate } = both();
    const left = disconnect(seats, 1, T0 + 5_000);
    expect(due(left, ready(ready(gate, 0), 1), T0 + 5_001)).toBe(false);
    expect(due(left, gate, T0 + START_CAP_MS)).toBe(false);
  });

  it('starts at once when a Guest reconnects after the cap ran out', () => {
    const { seats, gate } = both();
    const left = disconnect(seats, 1, T0 + 5_000);
    const back = join(left, { name: 'Guest', token: 'guest-tok' }, 'x').seats;
    const again = seated(unready(gate, 1), 1, 'guest-tok', T0 + 12_000);
    expect(due(back, again, T0 + 12_000)).toBe(true);
    // No timer to wait for: the cap is already behind us.
    expect(nextDue(back, again, T0 + 12_000)).toBeNull();
  });

  it('forgets a ready when the Player leaves, so a reload loads its Venue again first', () => {
    const { seats, gate } = both();
    const g = unready(ready(ready(gate, 0), 1), 1);
    const back = join(disconnect(seats, 1, T0 + 1), { name: 'Guest', token: 'guest-tok' }, 'x').seats;
    expect(due(back, seated(g, 1, 'guest-tok', T0 + 2), T0 + 2)).toBe(false);
  });

  it('restarts the cap for a new Guest after the first one was freed', () => {
    const { seats, gate } = both();
    const freed = expire(disconnect(seats, 1, T0 + 1), T0 + 1 + GRACE_MS);
    const now = T0 + 1 + GRACE_MS + 100;
    const next = join(freed, { name: 'Next' }, 'next-tok').seats;
    const g = seated(unready(gate, 1), 1, 'next-tok', now);
    expect(due(next, g, now + START_CAP_MS - 1)).toBe(false);
    expect(due(next, g, now + START_CAP_MS)).toBe(true);
  });

  it('never starts twice', () => {
    const { seats, gate } = both();
    expect(due(start(seats), ready(ready(gate, 0), 1), T0 + START_CAP_MS)).toBe(false);
    expect(nextDue(start(seats), gate, T0)).toBeNull();
  });
});
