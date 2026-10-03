// An online Match: the Court steps the Sim, and this screen sends its Player's Intents, stamped ahead of the Court's
// clock so they arrive before their Tick is stepped. Its own Player is drawn from its Predicted timeline, so they move
// the moment a key is pressed, reconciled with every Snapshot; the remote Player from the Interpolated timeline, 100 ms
// behind the newest Snapshot; and the ball on a clock that slides between the two (`composeView`). No Fault Replay, no
// hit-stop, and Game speed is always 1: none of them may bend the Court's clock (ADR-0004).
import {
  composeView,
  createClockSync,
  createInputStream,
  createInterpolator,
  createPredictor,
  extendTrack,
  inputFrame,
  type ClientMsg,
  type Clocks,
  type ComposedView,
  type Interpolator,
  type PongMsg,
  type Predictor,
  type SnapMsg,
  type Told,
} from '../net';
import type { Intent, SideIndex, SimState, SimTuning } from '../sim';
import type { MatchDriver, MatchView } from './driver';

/** A correction of the local Player further than this (m) snaps, as across a Serve reset; a nearer one is smoothed. */
export const SNAP_DISTANCE = 1;
/** How fast a smoothed correction fades, per second: to a tenth in about 7 frames. */
const SMOOTH_RATE = 20;
/** A correction left smaller than this (m) is done. */
const SETTLED = 1e-4;
/** States are kept this many Ticks behind the Interpolated timeline, for the ball's clock, which never trails it. */
const TRACK_TICKS = 30;

export interface OnlineMatchOptions {
  /** The seat the Court gave this screen. */
  local: SideIndex;
  /** The Match's first state, from `start`: drawn until the prediction starts. */
  start: SimState;
  view: MatchView;
  /** Samples the local Player's Intent, once per Tick stamped. */
  input: () => Intent;
  send: (msg: ClientMsg) => void;
  /** The Sim tuning the Court steps with, so the prediction steps alike. */
  tuning: SimTuning;
  /** This screen's clock, ms. `performance.now` unless a test fakes it. */
  now?: () => number;
}

/** Drives an online Match: predicts it here and reconciles with the Court's Snapshots. */
export class OnlineMatch implements MatchDriver {
  readonly local: SideIndex;
  /** The newest Snapshot's state: the Match as the Court last told it. */
  latest: SimState;
  /** The Court's clock as this screen knows it, and the Intents it hasn't acknowledged. */
  private sync = createClockSync();
  private stream = createInputStream();
  private predictor: Predictor;
  private interp: Interpolator;
  /** Every Tick known, oldest first: the Court's Snapshots, and the prediction from the newest on. */
  private track: SimState[];
  /** The view drawn last frame, or null before the first. */
  private last: ComposedView | null = null;
  /**
   * Where the local Player is drawn, less where the prediction has them (m, ground plane): what is left of the
   * corrections, fading.
   */
  private offset = { x: 0, z: 0 };
  private now: () => number;
  /** This screen's clock at the last frame, or null before the first. */
  private lastFrame: number | null = null;

  constructor(private opts: OnlineMatchOptions) {
    this.local = opts.local;
    this.latest = opts.start;
    this.predictor = createPredictor({ local: opts.local, start: opts.start, tuning: opts.tuning });
    this.interp = createInterpolator(opts.start);
    this.track = [opts.start];
    this.now = opts.now ?? (() => performance.now());
  }

  /** The view last drawn, a Tick apart: each thing on its own timeline. Over only when the Court says so. */
  get prev(): SimState {
    return this.last?.prev ?? this.opts.start;
  }
  get curr(): SimState {
    return this.last?.curr ?? this.opts.start;
  }

  /** The Predicted timeline: its states either side of the newest predicted Tick. */
  get predicted(): { prev: SimState; curr: SimState } {
    return this.predictor;
  }

  /** The Interpolated timeline's Tick, fractional: the remote Player's time. */
  get remoteTick(): number {
    return this.interp.clock;
  }

  /** The Tick each Player and the ball were last drawn at, or null before the first frame. */
  get clock(): Clocks | null {
    return this.last?.clock ?? null;
  }

  /** The link as this screen measures it: round trip and jitter (ms), and the input lead and backlog (Ticks). */
  get net() {
    const { sync, stream } = this;
    return { rtt: sync.rtt, jitter: sync.jitter, lead: sync.lead, courtTick: sync.courtTick(this.now()), unacked: stream.unacked };
  }

  /** A Snapshot from the Court. One older than the newest is only an acknowledgment. */
  receive(snap: SnapMsg) {
    this.stream.ack(snap.ack);
    if (snap.tick <= this.latest.tick) return;
    this.latest = snap.state;
    const { correction, told, court } = this.predictor.reconcile(snap);
    const x = this.offset.x - correction.x;
    const z = this.offset.z - correction.z;
    this.offset = Math.hypot(x, z) > SNAP_DISTANCE ? { x: 0, z: 0 } : { x, z };
    this.tell(told);
    this.tell(this.interp.push(snap.state, court));
    this.retrack();
  }

  /** The Court's answer to a ping. */
  pong(msg: PongMsg) {
    this.sync.pong(msg, this.now());
  }

  /**
   * `dt` is capped for a long frame (`MAX_FRAME`), but the Court's clock isn't, so the timelines run on this screen's
   * clock instead: a stall, a hidden tab or a debugger pause drops no time. Each resyncs rather than catching up.
   */
  frame(dt: number) {
    const time = this.now();
    const elapsed = this.lastFrame === null ? dt : Math.max(0, time - this.lastFrame) / 1000;
    this.lastFrame = time;
    this.sendInput();
    const fade = Math.exp(-SMOOTH_RATE * elapsed);
    const { x, z } = this.offset;
    this.offset = Math.hypot(x, z) < SETTLED ? { x: 0, z: 0 } : { x: x * fade, z: z * fade };
    // The remote Player's hits and bounces, as their time comes.
    this.tell(this.interp.advance(elapsed));

    const { prev, curr } = this.predictor;
    // The prediction steps a Tick as each is stamped, so local now runs on the input clock: from `prev` at the last
    // Tick stamped to `curr` a Tick on. Before the clock is known it stands still.
    const at = this.sync.courtTick(time);
    const alpha = at === null || prev === curr ? 1 : Math.min(1, Math.max(0, at + this.sync.lead - prev.tick + 1));
    const now = prev.tick + alpha * (curr.tick - prev.tick);
    const view = composeView({ local: this.local, now, remote: this.interp.clock, track: this.track, snaps: this.interp.states }, this.last?.ball ?? null);
    this.last = view;
    this.opts.view.draw(this.shifted(view.prev), this.shifted(view.curr), 1, this.latest, dt, view.clock);
  }

  /** Pings when one is due, and stamps and predicts the input due, until the Match is over (`inputFrame`). */
  private sendInput() {
    if (this.latest.phase === 'over') return;
    const told: Told[] = [];
    const msgs = inputFrame(this.sync, this.stream, this.now(), (tick) => {
      // The prediction calls the hit (Reported Contact), and the Court steps what it sends.
      const stamped = this.predictor.stamp(tick, this.opts.input());
      told.push(...stamped.told);
      return stamped.intent;
    });
    for (const msg of msgs) this.opts.send(msg);
    this.tell(told);
    this.retrack();
  }

  /** Takes the prediction into the track, replacing what it predicted before, and drops what's too old to draw. */
  private retrack() {
    this.track = extendTrack(this.track, this.predictor.states, this.interp.clock - TRACK_TICKS);
  }

  private tell(told: Told[]) {
    for (const { state, events } of told) this.opts.view.tick(state, events);
  }

  /** `s` with the local Player moved by the correction still fading. */
  private shifted(s: SimState): SimState {
    const { x, z } = this.offset;
    if (x === 0 && z === 0) return s;
    const sides = s.sides.slice() as SimState['sides'];
    const player = sides[this.local].players[0]!;
    const players = sides[this.local].players.slice();
    players[0] = { ...player, pos: { ...player.pos, x: player.pos.x + x, z: player.pos.z + z } };
    sides[this.local] = { ...sides[this.local], players };
    return { ...s, sides };
  }
}
