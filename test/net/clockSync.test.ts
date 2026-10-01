import { describe, expect, it } from 'vitest';
import { MAX_LEAD_TICKS, createClockSync, type ClockSync } from '../../src/net';
import { TICK } from '../../src/sim';

const TICK_MS = TICK * 1000;

/** A seeded uniform 0..1, so the jittery samples are the same every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * A Court whose Tick is `(t - t0) / TICK_MS` at true time `t`, and a client whose clock reads `t + skew`. `exchange`
 * plays one ping and pong with the given one-way delays, and returns the client's clock when the pong lands.
 */
function world(opts: { skew?: number; t0?: number } = {}) {
  const skew = opts.skew ?? 123_456;
  let t0 = opts.t0 ?? 1000;
  let t = 5000;
  const sync = createClockSync();
  return {
    sync,
    courtTick: (at = t) => (at - t0) / TICK_MS,
    clock: () => t + skew,
    /** The Court's clock steps back by `ticks`, as when it drops a stall. */
    stepBack(ticks: number) {
      t0 += ticks * TICK_MS;
    },
    exchange(up: number, down: number, gap = 500) {
      t += gap;
      const ping = forcePing(sync, t + skew);
      const courtTick = (t + up - t0) / TICK_MS;
      t += up + down;
      sync.pong({ t: 'pong', id: ping.id, clientTime: ping.clientTime, courtTick }, t + skew);
      return t + skew;
    },
  };
}

/** A ping now, whether or not one is due. */
function forcePing(sync: ClockSync, now: number) {
  return sync.ping(now) ?? sync.ping(now + 60_000)!;
}

/** How far the estimate of the Court's Tick is from the truth, in Ticks. */
function error(w: ReturnType<typeof world>) {
  return w.sync.courtTick(w.clock())! - w.courtTick();
}

describe('clock sync', () => {
  it('knows nothing before its first pong', () => {
    const sync = createClockSync();
    expect(sync.ready).toBe(false);
    expect(sync.courtTick(0)).toBeNull();
    expect(sync.inputTick(0)).toBeNull();
  });

  it('pings at once, then quickly a few times, then twice a second', () => {
    const sync = createClockSync();
    const sent: number[] = [];
    for (let now = 0; now <= 4000; now += 10) if (sync.ping(now)) sent.push(now);
    expect(sent.slice(0, 6)).toEqual([0, 100, 200, 300, 400, 900]);
    expect(sent.at(-1)).toBe(3900);
  });

  it('numbers its pings', () => {
    const sync = createClockSync();
    expect([sync.ping(0)!.id, sync.ping(1000)!.id]).toEqual([1, 2]);
  });

  it('on a steady link, knows the Court Tick and the round trip at once', () => {
    const w = world();
    w.exchange(40, 40);
    expect(w.sync.ready).toBe(true);
    expect(error(w)).toBeCloseTo(0, 6);
    expect(w.sync.rtt).toBe(80);
    expect(w.sync.jitter).toBe(0);
  });

  it('stamps input a half round trip plus a Tick ahead of the Court on a steady link', () => {
    const w = world();
    for (let i = 0; i < 5; i++) w.exchange(40, 40);
    expect(w.sync.lead).toBeCloseTo(40 / TICK_MS + 1, 6);
    const now = w.clock();
    expect(w.sync.inputTick(now)).toBe(Math.ceil(w.sync.courtTick(now)! + w.sync.lead));
  });

  it('on a jittery link, stays within a Tick and leads by more than the slowest one-way trip', () => {
    const w = world();
    const r = rng(7);
    let slowestUp = 0;
    const errors: number[] = [];
    for (let i = 0; i < 40; i++) {
      const up = 60 + r() * 30;
      slowestUp = Math.max(slowestUp, up);
      w.exchange(up, 60 + r() * 30);
      if (i >= 4) errors.push(Math.abs(error(w)));
    }
    expect(Math.max(...errors)).toBeLessThan(1);
    expect(w.sync.rtt).toBeGreaterThan(120);
    expect(w.sync.rtt).toBeLessThan(180);
    expect(w.sync.jitter).toBeGreaterThan(0);
    expect(w.sync.lead * TICK_MS).toBeGreaterThan(slowestUp);
    expect(w.sync.lead).toBeLessThan(MAX_LEAD_TICKS);
  });

  it('shrugs off one slow outlier', () => {
    const w = world();
    for (let i = 0; i < 8; i++) w.exchange(40, 40);
    const lead = w.sync.lead;
    w.exchange(900, 40);
    expect(error(w)).toBeCloseTo(0, 6);
    expect(w.sync.rtt).toBe(80);
    expect(w.sync.lead).toBe(lead);
  });

  it('follows the Court when its clock steps, after one sample', () => {
    const w = world();
    for (let i = 0; i < 8; i++) w.exchange(40, 40);
    // The Court dropped half a second of a stall: its Tick is now 30 behind where it was heading.
    w.stepBack(30);
    expect(error(w)).toBeCloseTo(30, 6);
    w.exchange(70, 10);
    // One sample places it within its own half round trip.
    expect(Math.abs(error(w))).toBeLessThanOrEqual(40 / TICK_MS);
    // The fastest samples are averaged, so the lopsided one fades as better ones come.
    for (let i = 0; i < 4; i++) w.exchange(40, 40);
    expect(Math.abs(error(w))).toBeLessThan(0.5);
  });

  it('caps the lead on a very slow link', () => {
    const w = world();
    for (let i = 0; i < 5; i++) w.exchange(400, 400);
    expect(w.sync.lead).toBe(MAX_LEAD_TICKS);
  });

  it('ignores a pong from before its clock', () => {
    const sync = createClockSync();
    sync.pong({ t: 'pong', id: 1, clientTime: 500, courtTick: 10 }, 400);
    expect(sync.ready).toBe(false);
  });
});
