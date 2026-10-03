import { describe, expect, it, vi } from 'vitest';
import { DECAY_TICKS, INTERP_DELAY_TICKS, SAME_EVENT_TICKS, isOutcome } from '../../src/net';
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
/** What an event is, but for its Tick: its kind, and the hitter's Side. */
const kindOf = (e: SnapEvent) => `${e.kind} ${e.kind === 'hit' ? e.side : ''}`;

/**
 * The events heard that stand for no event the Court sent: each heard one is matched to a Court one of the same kind
 * within `SAME_EVENT_TICKS`, each Court one used once. So an event heard twice, or one the Court never had, is left over.
 */
function unmatched(heard: SnapEvent[], court: SnapEvent[]): SnapEvent[] {
  const used = new Set<number>();
  return heard.filter((e) => {
    const i = court.findIndex((x, j) => !used.has(j) && kindOf(x) === kindOf(e) && Math.abs(x.tick - e.tick) <= SAME_EVENT_TICKS);
    if (i >= 0) used.add(i);
    return i < 0;
  });
}

/** Heard events that repeat one heard before: the same kind within `SAME_EVENT_TICKS`. */
const repeats = (heard: SnapEvent[]) => heard.filter((e, i) => heard.slice(0, i).some((x) => kindOf(x) === kindOf(e) && Math.abs(x.tick - e.tick) <= SAME_EVENT_TICKS));

/** How many frames after a clock passes Tick `tick` a client's drawn ball passes it. */
function framesApart(c: FakeClient, clock: (sides: [number, number]) => number, tick: number) {
  return c.drawn.findIndex((d) => d.clock.ball >= tick) - c.drawn.findIndex((d) => clock(d.clock.sides) >= tick);
}

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
      // Not even a Tick or two off, and no outcome heard that the Court didn't have.
      expect(repeats(c.heard)).toEqual([]);
      expect(unmatched(c.heard.filter(isOutcome), h.courtEvents)).toEqual([]);
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

describe('a stalled client', () => {
  it('stands still on the Court while hidden for 3 s, then resyncs to the Court on its return rather than catching up', () => {
    const h = createHarness({ seed: 4, up: LOSSY, down: LOSSY, drive: [walk(45)] });
    const c = h.clients[0];
    h.run(5_030);
    c.stopped = true;
    const last = c.stream.last!;
    const heard = c.heard.length;
    h.run(3_000);
    // The Court ran the missing-input fade: the Player stood still for most of the stall.
    const stood = [...h.applied[0]].filter(([tick]) => tick > last + DECAY_TICKS);
    expect(stood.length).toBeGreaterThan(150);
    expect(stood.every(([, i]) => i.move.x === 0 && i.move.y === 0 && i.shot === null)).toBe(true);
    // Nothing but outcomes was heard meanwhile, and only the Snapshots it may still draw were kept.
    expect(c.heard.slice(heard).every(isOutcome)).toBe(true);
    expect(c.interp.states.length).toBeLessThan(25);

    c.stopped = false;
    const back = c.drawn.length;
    const resumed = h.match.state.tick;
    const resumedAt = h.now;
    h.run(3_000);
    // The first frame back draws the remote Player about 100 ms plus a one-way trip behind the Court, not 3 s.
    const first = c.drawn[back]!;
    expect(resumed - first.clock.sides[1]).toBeGreaterThan(INTERP_DELAY_TICKS);
    expect(resumed - first.clock.sides[1]).toBeLessThan(INTERP_DELAY_TICKS + 12);
    // The local Player and the ball pick up from the Court's newest Snapshot, ahead of the Court by the input lead.
    expect(first.clock.sides[0]).toBeGreaterThan(resumed);
    expect(first.clock.sides[0]).toBeLessThan(resumed + 15);
    // Nothing skipped over is heard: every moment event heard after the return is from after it.
    const after = c.heard.filter((e) => e.at > resumedAt && !isOutcome(e));
    expect(after.every((e) => e.tick > resumed - INTERP_DELAY_TICKS - 12)).toBe(true);
    expect(repeats(c.heard)).toEqual([]);
    // A second on, the prediction is exact again.
    const errors = predictionErrors(h, c, 0).filter(([tick]) => tick > resumed + 60);
    expect(errors.length).toBeGreaterThan(30);
    expect(Math.max(...errors.map(([, e]) => e))).toBeLessThan(NOISE);
  });
});

describe('the composed view and the event policy', () => {
  for (const seed of [1, 2, 3]) {
    it(`draws each hit on its hitter's clock, and hears each event once, outcomes only as the Court has them (seed ${seed})`, () => {
      const h = createHarness({ seed, up: LOSSY, down: LOSSY });
      h.run(60_000);
      const end = h.match.state.tick - 60;
      const court = h.courtEvents.filter((e) => e.tick <= end);
      for (const c of h.clients) {
        const remote = (1 - c.side) as SideIndex;
        const heard = c.heard.filter((e) => e.tick <= end);
        expect(heard.length).toBeGreaterThan(80);
        // Every event heard is one the Court had, heard once: no event plays twice, and none is a ghost.
        expect(unmatched(heard, court)).toEqual([]);
        // The outcomes are the Court's exactly, Tick and all, so none is ever shown and then taken back.
        const outcomes = heard.filter(isOutcome);
        expect(outcomes.length).toBeGreaterThan(2);
        expect(outcomes.every((e) => court.some((x) => eventKey(x) === eventKey(e)))).toBe(true);

        // The remote Player's hits are heard as the Interpolated timeline draws them: on the frame its clock passes.
        const remoteHits = heard.filter((e) => e.kind === 'hit' && e.side === remote);
        expect(remoteHits.length).toBeGreaterThan(2);
        for (const e of remoteHits) {
          const frame = c.drawn.find((d) => d.at === e.at)!;
          expect(frame.clock.sides[remote]).toBeGreaterThanOrEqual(e.tick);
          expect(frame.clock.sides[remote]).toBeLessThan(e.tick + 2);
        }

        // The ball meets every local hit on local time, on the very frame. It leaves the remote racket on the remote
        // swing, give or take a frame, but for the odd ball returned too fast to catch up with, which leaves early.
        const rally = court.flatMap((e) => (e.kind === 'hit' && e.variant !== 'serve' && e.tick > 200 ? [e] : []));
        const local = rally.filter((e) => e.side === c.side).map((e) => framesApart(c, (s) => s[c.side], e.tick));
        const far = rally.filter((e) => e.side === remote).map((e) => framesApart(c, (s) => s[remote], e.tick));
        expect(local.length).toBeGreaterThan(2);
        expect(local.every((n) => n === 0)).toBe(true);
        expect(far.every((n) => n <= 1)).toBe(true);
        expect(far.filter((n) => Math.abs(n) <= 1).length).toBeGreaterThanOrEqual(far.length * 0.75);
      }
    });
  }
});

describe('the Takeover Bot', () => {
  it("plays a gone Player's Side from mid-Rally over the network, and the Match finishes", () => {
    // No loss: a lost Snapshot's events are never heard, which isn't what this is about.
    const link: LinkSpec = { ...LOSSY, loss: 0 };
    const h = createHarness({ seed: 8, up: link, down: link });
    const rallying = () => h.match.state.phase === 'rally' && h.match.state.shots >= 2;
    while (!rallying()) h.run(100);
    // Side 1's tab closes, and its grace runs out mid-Rally.
    h.clients[1].stopped = true;
    h.match.disconnect(1);
    h.match.gone(1);
    const from = h.match.state.tick;
    while (!h.match.over && h.now < 20 * 60_000) h.run(10_000);
    expect(h.match.over).toBe(true);
    const hits = h.courtEvents.filter((e) => e.kind === 'hit' && e.side === 1 && e.tick > from);
    expect(hits.filter((e) => e.kind === 'hit' && e.variant !== 'serve').length).toBeGreaterThan(2);
    expect(hits.some((e) => e.kind === 'hit' && e.variant === 'serve')).toBe(true);
    // The Player still in the Match heard every hit of the Bot's, each once.
    const heard = h.clients[0].heard.filter((e) => e.kind === 'hit' && e.side === 1 && e.tick > from);
    expect(heard.map((e) => e.tick)).toEqual(hits.map((e) => e.tick));
    expect(repeats(h.clients[0].heard)).toEqual([]);
  });
});
