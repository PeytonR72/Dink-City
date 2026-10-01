import { describe, expect, it, vi } from 'vitest';
import { DECAY_TICKS } from '../../party/src/courtMatch';
import type { Intent } from '../../src/sim';
import { createHarness, type Harness, type LinkSpec } from './harness';

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

describe('the netcode harness', () => {
  for (const seed of [1, 2, 3]) {
    it(`loses no shot press at 150 ms, 30 ms jitter and 5% loss (seed ${seed})`, () => {
      const h = createHarness({ seed, up: LOSSY, down: LOSSY });
      h.run(30_000);
      for (const { pressed, applied } of settled(h)) {
        expect(pressed.length).toBeGreaterThan(10);
        // Each press lands once, in order, on its own Tick or a later one.
        expect(applied.map((p) => p.shot)).toEqual(pressed.map((p) => p.shot));
        applied.forEach((p, i) => expect(p.tick).toBeGreaterThanOrEqual(pressed[i]!.tick));
      }
      // The lead covers the jitter: nearly every Intent arrives before its Tick.
      expect(onTime(h, 0)).toBeGreaterThan(0.98);
      expect(onTime(h, 1)).toBeGreaterThan(0.98);
    });
  }

  it('loses no shot press even at 20% loss and a 300 ms round trip', () => {
    const link: LinkSpec = { latency: 120, jitter: 60, loss: 0.2 };
    const h = createHarness({ seed: 9, up: link, down: link });
    h.run(30_000);
    for (const { pressed, applied } of settled(h)) {
      expect(pressed.length).toBeGreaterThan(10);
      expect(applied.map((p) => p.shot)).toEqual(pressed.map((p) => p.shot));
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
