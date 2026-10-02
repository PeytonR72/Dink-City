// What an online screen draws: each thing on its own timeline (Part 3 of docs/MULTIPLAYER.md). The local Player comes
// from the Predicted timeline, so they move the moment a key is pressed; the remote Player from the Interpolated
// timeline, so their swings follow hits the Court confirmed; and the ball on a clock that slides between the two, so it
// leaves the remote racket on the remote swing and arrives on local time for the local hit. Pure, so it's tested
// without a renderer.
//
// What the renderer reads across timelines: the wind-up (`predictContact`) meets a Player with the ball, counted from
// the ball's clock to the Player's (`Clocks`), which agree at Contact. The marker and trail read only the ball. Phase,
// score and ends come with the ball, but `phase` is `over` exactly when the Court's newest Snapshot says so.
import { TICK, other, type Player, type SideIndex, type SimState, type Vec3 } from '../sim';

/**
 * The most the ball's clock trails local "now", in Ticks: the gap between the timelines at about 250 ms round trip
 * (half of it ahead, half of it plus the 100 ms of interpolation behind). Further apart, the remote swing and the ball
 * part a little instead of the ball running faster still.
 */
export const BLEND_CAP_TICKS = 24;
/** How fast the ball's clock may catch up with local now: up to four times speed, for a fast drive... */
const CATCH_UP = 3;
/** ...and fall back toward remote time: down to a quarter speed. */
const FALL_BACK = 0.75;
/** A ball this near a Player's line (m, along the court) has reached them. */
const REACH = 1;
/** A ball's clock this far behind in a frame jumps (a rejoin, a hidden tab). */
const JUMP_TICKS = 30;
/** Further apart than this (m) in one step is a teleport (a reset between points), not a move. */
const TELEPORT = 2;

/** The Tick each thing is drawn at, fractional. */
export interface Clocks {
  sides: [number, number];
  ball: number;
}

/** The ball's clock as it stood last frame: local now, and how far the ball trailed it (Ticks). */
export interface BallClock {
  now: number;
  lag: number;
}

/** What a frame is composed from: the two timelines, where each one is now, and which Player is this screen's. */
export interface ViewInput {
  local: SideIndex;
  /** Local now: the Predicted timeline's Tick, fractional. */
  now: number;
  /** The Interpolated timeline's Tick, fractional. */
  remote: number;
  /** Every Tick known, oldest first: the Court's Snapshots, and the prediction from the newest on. */
  track: readonly SimState[];
  /** The Court's Snapshots only, oldest first: the Interpolated timeline. */
  snaps: readonly SimState[];
}

/** A frame to draw. */
export interface ComposedView {
  /** The view a Tick ago and now: draw `curr`, at alpha 1. `prev` is there for how fast things are moving. */
  prev: SimState;
  curr: SimState;
  clock: Clocks;
  /** Pass back in next frame. */
  ball: BallClock;
}

/**
 * Composes the frame. `last` is the ball's clock from the frame before (null on the first): the ball's clock runs
 * smoothly from it toward where the blend wants it, never jumping, so the ball only ever looks faster or slower.
 */
export function composeView(input: ViewInput, last: BallClock | null): ComposedView {
  const ball = ballClock(input, last);
  const remote = other(input.local);
  const clock: Clocks = { sides: [0, 0], ball: input.now - ball.lag };
  clock.sides[input.local] = input.now;
  clock.sides[remote] = input.remote;
  const at = (back: number) => compose(input, { sides: [clock.sides[0] - back, clock.sides[1] - back], ball: clock.ball - back });
  return { prev: at(1), curr: at(0), clock, ball };
}

/**
 * How far the ball trails local now: the whole gap between the timelines (capped) as the remote Player hits it, none as
 * the local Player does, changing steadily in between, at most `CATCH_UP`/`FALL_BACK` per Tick.
 */
export function ballClock(input: ViewInput, last: BallClock | null): BallClock {
  const gap = Math.min(BLEND_CAP_TICKS, Math.max(0, input.now - input.remote));
  const dt = last ? input.now - last.now : -1;
  const smooth = last !== null && dt >= 0 && dt <= JUMP_TICKS;
  const lag = smooth ? last.lag : gap;
  const drawn = sample(input.track, input.now - lag).a;
  const latest = sample(input.track, input.now).a;
  const target = targetLag(drawn, latest, input.local, input.now, gap);
  let moved = smooth ? lag + Math.min(FALL_BACK * dt, Math.max(-CATCH_UP * dt, target - lag)) : target;
  // A shot too fast to catch up with in time: the ball jumps to the local Player's racket as they hit it.
  if (latest.ball.lastHitBy === input.local) moved = Math.min(moved, input.now - latest.ball.hitTick);
  return { now: input.now, lag: Math.min(gap, Math.max(0, moved)) };
}

/**
 * Where the ball's lag should be, for the ball as drawn and as it is at local now (`latest`): linear in time from its
 * launch to when it's met, which is in the track once local now has passed it, or reckoned from the ball's speed.
 */
function targetLag(drawn: SimState, latest: SimState, local: SideIndex, now: number, gap: number): number {
  const { ball } = drawn;
  if (ball.lastHitBy === null) return drawn.server === local ? 0 : gap;
  const met = latest.ball.hitTick > ball.hitTick ? latest.ball.hitTick : now + arrival(latest);
  const lag =
    ball.lastHitBy === local
      ? (gap * (now - ball.hitTick)) / (met + gap - ball.hitTick)
      : met - ball.hitTick - gap > 0
        ? (gap * (met - now)) / (met - ball.hitTick - gap)
        : 0;
  return Math.min(gap, Math.max(0, lag));
}

/** Ticks until the ball in `s` comes within reach of the Player it's heading for, at its speed along the court. */
export function arrival(s: SimState): number {
  const { ball } = s;
  if (ball.lastHitBy === null) return 0;
  const to = s.sides[other(ball.lastHitBy)].players[0].pos.z - ball.pos.z;
  const speed = ball.vel.z * Math.sign(to);
  return speed > 0 ? Math.max(0, Math.abs(to) - REACH) / speed / TICK : 0;
}

/** The view at `clock`: the local Player and the ball from the track, the remote Player from the Snapshots. */
function compose(input: ViewInput, clock: Clocks): SimState {
  const remote = other(input.local);
  const ball = sample(input.track, clock.ball);
  const players: [Player, Player] = [ball.a.sides[0].players[0], ball.a.sides[1].players[0]];
  players[input.local] = playerAt(sample(input.track, clock.sides[input.local]), input.local);
  players[remote] = playerAt(sample(input.snaps, clock.sides[remote]), remote);
  // The Match is over when the Court says so, never on the prediction's say.
  const over = input.snaps.at(-1)?.phase === 'over';
  return {
    ...ball.a,
    tick: Math.floor(clock.ball),
    phase: over ? 'over' : ball.a.phase === 'over' ? 'dead' : ball.a.phase,
    ball: { ...ball.a.ball, pos: lerp(ball.a.ball.pos, ball.b.ball.pos, ball.f) },
    sides: [{ players: [players[0]] }, { players: [players[1]] }],
    events: [],
  };
}

/**
 * The track with the prediction's newest states (`predicted`, one per Tick from the last Snapshot's) taken in, in place
 * of what it predicted for those Ticks before, and the states before Tick `oldest` dropped. So is an older prediction
 * the Snapshot shows was wrong about the last hit (the remote Player's, guessed between two Snapshots): the ball is
 * drawn between the Snapshots there instead. (A hit guessed earlier than the true one isn't caught: telling
 * it from the hit before needs the Snapshot before. It's off for a Tick or so.)
 */
export function extendTrack(track: readonly SimState[], predicted: readonly SimState[], oldest: number): SimState[] {
  const base = predicted[0]!;
  const hit = base.ball.hitTick;
  const wrong = (s: SimState) => s.ball.hitTick !== hit && (hit <= s.tick || s.ball.hitTick > hit);
  return track.filter((s) => s.tick < base.tick && s.tick >= oldest && !wrong(s)).concat(predicted);
}

/** The states either side of Tick `t` in `timeline`, and how far between them it is. Outside, the nearest end. */
export function sample(timeline: readonly SimState[], t: number): { a: SimState; b: SimState; f: number } {
  let lo = 0;
  let hi = timeline.length - 1;
  if (t <= timeline[lo]!.tick) return { a: timeline[lo]!, b: timeline[lo]!, f: 0 };
  if (t >= timeline[hi]!.tick) return { a: timeline[hi]!, b: timeline[hi]!, f: 0 };
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (timeline[mid]!.tick <= t) lo = mid;
    else hi = mid;
  }
  const a = timeline[lo]!;
  const b = timeline[hi]!;
  return { a, b, f: (t - a.tick) / (b.tick - a.tick) };
}

function playerAt({ a, b, f }: ReturnType<typeof sample>, side: SideIndex): Player {
  const player = a.sides[side].players[0];
  return { ...player, pos: lerp(player.pos, b.sides[side].players[0].pos, f) };
}

function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  if (Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) > TELEPORT) return t < 0.5 ? a : b;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}
