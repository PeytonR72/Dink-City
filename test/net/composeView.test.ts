import { describe, expect, it } from 'vitest';
import { DIFFICULTY, createBot } from '../../src/bot/bot';
import { observe } from '../../src/bot/observe';
import { BLEND_CAP_TICKS, INTERP_DELAY_TICKS, PRESETS, composeView, extendTrack, type BallClock, type ComposedView } from '../../src/net';
import { TICK, createInitialState, step, type SideIndex, type SimState, type Vec3 } from '../../src/sim';
import { simTuning } from '../../src/tuning';

/** A Bot Match's first few Rallies, one state per Tick: what a client knows of every Tick, in the end. */
function botStates(ticks: number): SimState[] {
  const bots = [createBot(0, 5, DIFFICULTY.hard, simTuning), createBot(1, 6, DIFFICULTY.hard, simTuning)] as const;
  const states = [createInitialState(41, PRESETS.quick.config)];
  while (states.length < ticks) {
    const s = states.at(-1)!;
    states.push(step(s, [bots[0].think(observe(s, 0)), bots[1].think(observe(s, 1))], simTuning));
  }
  return states;
}
const STATES = botStates(2400);
/** A Side's Rally hits, but for any too near the ends to be drawn at every latency. */
const rallyHits = (side: SideIndex) =>
  STATES.flatMap((s) =>
    s.events.flatMap((e) => (e.kind === 'hit' && e.side === side && e.variant !== 'serve' && s.tick > 80 && s.tick < STATES.length - 80 ? [s.tick] : [])),
  );

const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const lerpAt = (t: number, of: (s: SimState) => Vec3, step = 1): Vec3 => {
  const t0 = Math.floor(t / step) * step;
  const [a, b] = [of(STATES[t0]!), of(STATES[Math.min(t0 + step, STATES.length - 1)]!)];
  const f = (t - t0) / step;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f };
};

interface Frame {
  now: number;
  remote: number;
  view: ComposedView;
}

/**
 * One screen playing `local` through the Match at a round trip of `rtt` ms, a frame per Tick: it predicts half a round
 * trip and a Tick ahead of the Court, and draws the Court's Snapshots (every other Tick) 100 ms behind the newest.
 */
function play(local: SideIndex, rtt: number): Frame[] {
  const half = rtt / 2 / 1000 / TICK;
  const frames: Frame[] = [];
  let last: BallClock | null = null;
  for (let court = 40; court < STATES.length - 40; court++) {
    // Frames don't fall on Ticks.
    const c = court + 0.37;
    const now = c + half + 1;
    const newest = Math.floor((c - half) / 2) * 2;
    const remote = c - half - INTERP_DELAY_TICKS;
    const track = STATES.slice(Math.max(0, Math.floor(remote) - 40), Math.ceil(now) + 1);
    const snaps = track.filter((s) => s.tick % 2 === 0 && s.tick <= newest);
    const view = composeView({ local, now, remote, track, snaps }, last);
    last = view.ball;
    frames.push({ now, remote, view });
  }
  return frames;
}

/** How many frames after `clock` the ball's clock passes Tick `tick`. */
const framesApart = (frames: Frame[], clock: (f: Frame) => number, tick: number) =>
  frames.findIndex((f) => f.view.clock.ball >= tick) - frames.findIndex((f) => clock(f) >= tick);

/** Whether the states either side of `t` (`step` apart) are a teleport, a reset between points. */
const teleport = (t: number, of: (s: SimState) => Vec3, step = 1) => {
  const t0 = Math.floor(t / step) * step;
  return dist(of(STATES[t0]!), of(STATES[t0 + step]!)) > 2;
};

describe('composeView', () => {
  const hits = [rallyHits(0), rallyHits(1)] as const;
  it('has Rallies to play: hits both ways across the net', () => {
    expect(hits[0].length).toBeGreaterThan(8);
    expect(hits[1].length).toBeGreaterThan(8);
  });

  for (const rtt of [0, 100, 150, 300]) {
    describe(`at ${rtt} ms`, () => {
      for (const local of [0, 1] as const) {
        const remote = local === 0 ? 1 : 0;
        const frames = play(local, rtt);
        const gap = frames[frames.length >> 1]!.now - frames[frames.length >> 1]!.remote;
        /**
         * The local hits whose ball came too fast to catch up with: the ball must make up the gap during its flight
         * from the remote racket, and at four times speed it makes up three Ticks a Tick. So a flight shorter than 4/3
         * of the gap (and a Tick or two, for reckoning its arrival from its speed) can't be both seen leaving the
         * remote racket and met on local time.
         */
        const tooFast = hits[local].filter((hit) => hits[remote].some((h) => h < hit && hit - h < (Math.min(gap, BLEND_CAP_TICKS) * 4) / 3 + 2));

        it(`draws Side ${local}'s own Player predicted, and the other from the Snapshots`, () => {
          const pos = (side: SideIndex) => (s: SimState) => s.sides[side].players[0].pos;
          for (const f of frames) {
            if (!teleport(f.now, pos(local))) expect(dist(f.view.curr.sides[local].players[0].pos, lerpAt(f.now, pos(local)))).toBeLessThan(1e-9);
            if (!teleport(f.remote, pos(remote), 2)) expect(dist(f.view.curr.sides[remote].players[0].pos, lerpAt(f.remote, pos(remote), 2))).toBeLessThan(1e-9);
            expect(f.view.clock.sides[local]).toBe(f.now);
            expect(f.view.clock.sides[remote]).toBe(f.remote);
          }
        });

        it('draws the ball where its clock says, a clock between the two, capped', () => {
          for (const f of frames) {
            const lag = f.now - f.view.clock.ball;
            expect(lag).toBeGreaterThanOrEqual(0);
            expect(lag).toBeLessThanOrEqual(Math.min(BLEND_CAP_TICKS, f.now - f.remote) + 1e-9);
            if (!teleport(f.view.clock.ball, (s) => s.ball.pos)) expect(dist(f.view.curr.ball.pos, lerpAt(f.view.clock.ball, (s) => s.ball.pos))).toBeLessThan(1e-9);
          }
          if (gap > BLEND_CAP_TICKS) expect(Math.max(...frames.map((f) => f.now - f.view.clock.ball))).toBeCloseTo(BLEND_CAP_TICKS, 9);
        });

        it('runs the ball between a quarter and four times speed, jumping only to meet a shot too fast for that', () => {
          for (let i = 1; i < frames.length; i++) {
            const [a, b] = [frames[i - 1]!, frames[i]!];
            // A frame is a Tick.
            const ran = b.view.clock.ball - a.view.clock.ball;
            expect(ran).toBeGreaterThanOrEqual(0.25 - 1e-9);
            if (ran <= 4 + 1e-9) continue;
            // The jump lands the ball on the local racket, as the local Player hits it.
            const hit = tooFast.find((h) => Math.abs(b.view.clock.ball - h) < 1);
            expect(hit, `a jump of ${ran} Ticks at ${b.now}`).toBeDefined();
          }
        });

        it('meets the local hit on local time', () => {
          for (const hit of hits[local]) expect(Math.abs(framesApart(frames, (f) => f.now, hit))).toBeLessThanOrEqual(1);
        });

        // A remote hit that came back too fast is met on local time, so isn't seen leaving the remote racket.
        const seen = hits[remote].filter((h) => !tooFast.some((hit) => hit > h && hits[remote].every((r) => r <= h || r > hit)));
        if (gap <= BLEND_CAP_TICKS) {
          it('leaves the remote racket on the remote swing', () => {
            expect(seen.length).toBeGreaterThan(hits[remote].length * 0.8);
            for (const hit of seen) expect(Math.abs(framesApart(frames, (f) => f.remote, hit))).toBeLessThanOrEqual(1);
          });
        } else {
          it('caps the blend: the ball leaves the remote racket a little before the remote swing', () => {
            // Launched the frames the timelines are apart past the cap before the swing, or less.
            for (const hit of seen) {
              const apart = framesApart(frames, (f) => f.remote, hit);
              expect(apart).toBeLessThanOrEqual(0);
              expect(apart).toBeGreaterThanOrEqual(-Math.ceil(gap - BLEND_CAP_TICKS) - 1);
            }
          });
        }
      }
    });
  }
});

describe('extendTrack', () => {
  // A remote hit on an odd Tick, between two Snapshots.
  const hit = rallyHits(1).find((t) => t % 2 === 1)!;
  const withBall = (s: SimState, hitTick: number): SimState => ({ ...s, ball: { ...s.ball, hitTick } });

  it('takes the newest prediction in place of the old, and drops what is too old', () => {
    const track = STATES.slice(100, 110);
    const predicted = STATES.slice(106, 112);
    expect(extendTrack(track, predicted, 103).map((s) => s.tick)).toEqual([103, 104, 105, 106, 107, 108, 109, 110, 111]);
    expect(extendTrack(track, predicted, 0)[6]).toBe(predicted[0]);
  });

  it('drops an old prediction the Snapshot shows was wrong about the last hit', () => {
    const before = STATES[hit - 1]!;
    // Predicted the remote hit right, missed it, or guessed it on another Tick.
    const right = STATES[hit]!;
    const missed = withBall(STATES[hit]!, before.ball.hitTick);
    const early = withBall(STATES[hit]!, hit - 1);
    const snap = [STATES[hit + 1]!];
    expect(extendTrack([before, right], snap, 0)).toEqual([before, right, snap[0]]);
    expect(extendTrack([before, missed], snap, 0)).toEqual([before, snap[0]]);
    expect(extendTrack([before, early], snap, 0)).toEqual([before, snap[0]]);
  });
});
