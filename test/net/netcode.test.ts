import { describe, expect, it, vi } from 'vitest';
import { DECAY_TICKS } from '../../src/net';
import { SNAP_DISTANCE } from '../../src/match/online';
import type { SnapEvent } from '../../src/net';
import type { Intent, SideIndex } from '../../src/sim';
import { createHarness, type FakeClient, type Harness, type LinkSpec } from './harness';

// Each run plays half a minute of a Match.
vi.setConfig({ testTimeout: 60_000 });

/** 150 ms round trip on average, each way 60–90 ms, and 5% of packets lost each way. */
const LOSSY: LinkSpec = { latency: 60, jitter: 30, loss: 0.05 };

/** The presses each client made and the Court stepped, up to a second before the end, so none is still in flight. */
function settled(h: Harness) {
  const end = h.match.state.tick - 60;
  return h.clients.map((c) => ({
    pressed: c.presses.filter((p) => p.tick <= end),
    applied: h.appliedPresses[c.side].filter((p) => p.tick <= end + 1),
  }));
}

/** The share of a client's stamped Ticks the Court stepped with that very Intent, rather than a fill. */
function onTime(h: Harness, side: 0 | 1) {
  const end = h.match.state.tick - 60;
  let hit = 0;
  let total = 0;
  for (const [tick, intent] of h.clients[side].stamped) {
    if (tick > end) continue;
    total++;
    const a = h.applied[side].get(tick);
    if (a && a.move.x === intent.move.x && a.move.y === intent.move.y) hit++;
  }
  return hit / total;
}

/**
 * How far a client's prediction first put a Side's Player from where the Court finally had them, by Tick: from 2 s in
 * (once the clock has settled) to a second before the end (so every input has landed).
 */
function predictionErrors(h: Harness, c: FakeClient, side: SideIndex): [number, number][] {
  const end = h.match.state.tick - 60;
  return [...c.predicted].flatMap(([tick, pos]) => {
    const court = h.courtPos[side].get(tick);
    if (!court || tick < 120 || tick > end) return [];
    return [[tick, Math.hypot(pos[side].x - court.x, pos[side].z - court.z)]];
  });
}

/** Walks one way and back every `period` Ticks, and forward and back every 1.7 periods, never pressing. */
function walk(period: number) {
  return (tick: number): Intent => ({
    move: { x: Math.floor(tick / period) % 2 ? -1 : 1, y: Math.floor(tick / (period * 1.7)) % 2 ? -1 : 1 },
    aim: { x: 0, y: 0 },
    shot: null,
  });
}

const eventKey = (e: SnapEvent) => `${e.tick} ${e.kind} ${e.kind === 'hit' ? e.side : ''}`;

/** Float noise: the client and the Court run the same steps, so their states should agree to the last bit. */
const NOISE = 1e-9;

describe('the netcode harness', () => {
  for (const seed of [1, 2, 3]) {
    it(`loses no shot press at 150 ms, 30 ms jitter and 5% loss (seed ${seed})`, () => {
      const h = createHarness({ seed, up: LOSSY, down: LOSSY });
      h.run(30_000);
      for (const { pressed, applied } of settled(h)) {
        expect(pressed.length).toBeGreaterThan(10);
        // Each press lands once, on its own Tick.
        expect(applied).toEqual(pressed);
      }
      // The lead covers the jitter: nearly every Intent arrives before its Tick.
      expect(onTime(h, 0)).toBeGreaterThan(0.98);
      expect(onTime(h, 1)).toBeGreaterThan(0.98);
      // So each client's Player is drawn, when its input is stamped, exactly where the Court will step them, and no
      // Snapshot ever corrects them.
      for (const c of h.clients) {
        const errors = predictionErrors(h, c, c.side);
        expect(errors.length).toBeGreaterThan(1_000);
        expect(errors.every(([, e]) => e < NOISE)).toBe(true);
        expect(Math.max(...c.corrections)).toBeLessThan(NOISE);
        // Its own hits are heard from the prediction, each the Court's, and nothing is heard twice.
        const settledTick = h.match.state.tick - 60;
        const own = (es: SnapEvent[]) => es.filter((e) => e.kind === 'hit' && e.side === c.side && e.tick <= settledTick).map(eventKey);
        expect(own(h.courtEvents).length).toBeGreaterThan(2);
        expect(own(c.heard)).toEqual(own(h.courtEvents));
        expect(new Set(c.heard.map(eventKey)).size).toBe(c.heard.length);
      }
    });
  }

  for (const seed of [1, 2, 3]) {
    it(`has the Court confirm every hit a client calls, at 150 ms, 30 ms jitter and 5% loss (seed ${seed})`, () => {
      const h = createHarness({ seed, up: LOSSY, down: LOSSY });
      h.run(60_000);
      const end = h.match.state.tick - 60;
      const hits = h.courtEvents.flatMap((e) => (e.kind === 'hit' && e.tick <= end ? [e] : []));
      for (const c of h.clients) {
        // A report on Tick T is a hit on the state Tick T steps to. Every one the client sent, the Court made.
        const reported = [...c.stamped].flatMap(([tick, i]) => (i.contact && tick < end ? [tick + 1] : []));
        const confirmed = hits.filter((e) => e.side === c.side && e.variant !== 'serve').map((e) => e.tick);
        expect(confirmed.length).toBeGreaterThan(3);
        expect(reported).toEqual(confirmed);
      }

      // In a Rally, each client's ball is the Court's, as first drawn. It's off only where the remote Player's hit is
      // guessed (a Tick early or late, or not at all), and back within half a second, once that hit's Snapshot comes.
      for (const c of h.clients) {
        const remoteHits = hits.filter((e) => e.side !== c.side).map((e) => e.tick);
        let checked = 0;
        const off: number[] = [];
        for (const [tick, p] of c.predictedBall) {
          const court = h.courtStates.get(tick);
          if (!court || court.phase !== 'rally' || tick < 120 || tick > end) continue;
          checked++;
          const { x, y, z } = court.ball.pos;
          if (Math.hypot(p.x - x, p.y - y, p.z - z) >= NOISE && !remoteHits.some((t) => Math.abs(tick - t) <= 30)) off.push(tick);
        }
        expect(checked).toBeGreaterThan(500);
        expect(off).toEqual([]);
      }
    });
  }

  it('drops hits reported past the window behind a long stall, and corrects each once, with nothing heard twice', () => {
    // A 300 ms uplink freeze every 2.5 s holds some reports past the Rewind window. Those hits never happen on the
    // Court; the client heard its swing once, from the prediction, and a Snapshot takes it back without a repeat.
    const h = createHarness({ seed: 1, up: { ...LOSSY, stall: { every: 2_500, ms: 300 } }, down: LOSSY });
    h.run(60_000);
    const end = h.match.state.tick - 60;
    let rejected = 0;
    for (const c of h.clients) {
      const confirmed = h.courtEvents.filter((e) => e.kind === 'hit' && e.side === c.side && e.variant !== 'serve' && e.tick <= end).map((e) => e.tick);
      const reported = [...c.stamped].flatMap(([tick, i]) => (i.contact && tick < end ? [tick + 1] : []));
      // Every hit the Court made, the client called; some it called, the Court dropped.
      expect(confirmed.every((t) => reported.includes(t))).toBe(true);
      rejected += reported.filter((t) => !confirmed.includes(t)).length;
      expect(new Set(c.heard.map(eventKey)).size).toBe(c.heard.length);
    }
    expect(rejected).toBeGreaterThan(2);
  });

  it('loses no shot press even at 20% loss and a 300 ms round trip', () => {
    const link: LinkSpec = { latency: 120, jitter: 60, loss: 0.2 };
    const h = createHarness({ seed: 9, up: link, down: link });
    h.run(30_000);
    for (const { pressed, applied } of settled(h)) {
      expect(pressed.length).toBeGreaterThan(10);
      expect(applied).toEqual(pressed);
    }
  });

  it('rewinds for Intents a stalled link delivers late, so every one still lands on its Tick', () => {
    // A 200 ms freeze every 2.5 s holds the client's input up to 12 Ticks, past its lead of about 6.
    const up: LinkSpec = { ...LOSSY, stall: { every: 2_500, ms: 200 } };
    const h = createHarness({ seed: 10, up, down: LOSSY });
    h.run(30_000);
    expect(h.resteps).toBeGreaterThan(50);
    for (const { pressed, applied } of settled(h)) {
      expect(pressed.length).toBeGreaterThan(10);
      expect(applied).toEqual(pressed);
    }
    expect(onTime(h, 0)).toBe(1);
    expect(onTime(h, 1)).toBe(1);
  });

  it('needs no correction while both Players run about, and guesses the remote one from their last Intent', () => {
    const periods = [40, 55];
    const h = createHarness({ seed: 2, up: LOSSY, down: LOSSY, drive: [walk(periods[0]!), walk(periods[1]!)] });
    h.run(20_000);
    for (const c of h.clients) {
      expect(Math.max(...c.corrections)).toBeLessThan(NOISE);
      expect(predictionErrors(h, c, c.side).every(([, e]) => e < NOISE)).toBe(true);

      // The remote Player is guessed to keep doing what they last did. That's wrong only for the few Ticks after they
      // turn (the lead plus the half round trip plus a Snapshot's wait, about 15), and each Snapshot puts them right.
      const remote = (1 - c.side) as SideIndex;
      const period = periods[remote]!;
      const turnedAgo = (tick: number) => {
        for (let k = tick; k >= 0; k--) if (k % period === 0 || Math.floor(k / (period * 1.7)) !== Math.floor((k - 1) / (period * 1.7))) return tick - k;
        return Infinity;
      };
      const wrong = predictionErrors(h, c, remote).filter(([, e]) => e >= NOISE);
      expect(wrong.length).toBeGreaterThan(50);
      expect(wrong.every(([tick]) => turnedAgo(tick) <= 25)).toBe(true);
      expect(Math.max(...wrong.map(([, e]) => e))).toBeLessThan(2);
    }
  });

  it('corrects for a stall by a bounded amount, and is exact again after it', () => {
    // The uplink freezes for 200 ms every 2.5 s (150 Ticks). The Court fills the Intents it's missing and its
    // Snapshots say so, until the rewind puts them right: two corrections each time, never a drift.
    const up: LinkSpec = { ...LOSSY, stall: { every: 2_500, ms: 200 } };
    const h = createHarness({ seed: 3, up, down: LOSSY, drive: [walk(40), walk(55)] });
    h.run(20_000);
    for (const c of h.clients) {
      const corrected = c.corrections.filter((d) => d >= NOISE);
      expect(corrected.length).toBeGreaterThan(5);
      expect(Math.max(...corrected)).toBeLessThan(SNAP_DISTANCE);
      const wrong = predictionErrors(h, c, c.side).filter(([, e]) => e >= NOISE);
      expect(wrong.length).toBeGreaterThan(0);
      // Only in the second after each stall begins.
      expect(wrong.every(([tick]) => tick % 150 < 60)).toBe(true);
    }
  });

  it("knows the Court's Tick within a Tick a second in, and leads by a half round trip plus margin", () => {
    const h = createHarness({ seed: 4, up: LOSSY, down: LOSSY });
    h.run(1_000);
    let worst = 0;
    h.run(20_000, () => {
      for (const c of h.clients) worst = Math.max(worst, Math.abs(c.sync.courtTick(c.clock())! - h.courtTick()));
    });
    expect(worst).toBeLessThan(1);
    for (const c of h.clients) {
      expect(c.sync.rtt).toBeGreaterThan(130);
      expect(c.sync.rtt).toBeLessThan(170);
      // A one-way trip is at most 90 ms, 5.4 Ticks.
      expect(c.sync.lead).toBeGreaterThan(5.4);
      expect(c.sync.lead).toBeLessThan(9);
    }
  });

  it('is ready to send within a few pings', () => {
    const h = createHarness({ seed: 5, up: LOSSY, down: LOSSY });
    h.run(400);
    expect(h.clients.every((c) => c.sync.ready && c.stream.last !== null)).toBe(true);
  });

  it('stands a client that stops sending still, its move fading out', () => {
    // Side 0 walks left and right, a second each way, and never presses.
    const walk = (tick: number): Intent => ({ move: { x: Math.floor(tick / 60) % 2 ? -1 : 1, y: 0 }, aim: { x: 0, y: 0 }, shot: null });
    const h = createHarness({ seed: 6, up: LOSSY, down: LOSSY, drive: [walk] });
    h.run(5_030);
    h.clients[0].stopped = true;
    const last = h.clients[0].stream.last!;
    h.run(3_000);
    const after = [...h.applied[0]].filter(([tick]) => tick > last);
    // Up to its last Tick it was still walking; the fill fades from there and holds at zero.
    expect(after.slice(0, DECAY_TICKS).some(([, i]) => i.move.x !== 0)).toBe(true);
    expect(after.slice(DECAY_TICKS).every(([, i]) => i.move.x === 0 && i.move.y === 0 && i.shot === null)).toBe(true);
    const pos = () => ({ ...h.match.state.sides[0].players[0].pos });
    const before = pos();
    h.run(1_000);
    expect(pos()).toEqual(before);
  });
});
