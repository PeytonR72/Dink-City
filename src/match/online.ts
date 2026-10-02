// An online Match: the Court steps the Sim, and this screen sends its Player's Intents, stamped ahead of the Court's
// clock so they arrive before their Tick is stepped. It draws its own Predicted timeline, so its Player moves the
// moment a key is pressed, and reconciles it with every Snapshot. For now the prediction draws the ball and the remote
// Player too; issue 11 draws the remote Player from the Interpolated timeline and blends the ball's clock. No Fault
// Replay, no hit-stop, and Game speed is always 1: none of them may bend the Court's clock (ADR-0004).
import { createClockSync, createInputStream, createPredictor, inputFrame, type ClientMsg, type PongMsg, type Predictor, type SnapMsg, type Told } from '../net';
import type { Intent, SideIndex, SimState, SimTuning } from '../sim';
import type { MatchDriver, MatchView } from './driver';

/** A correction of the local Player further than this (m) snaps, as across a Serve reset; a nearer one is smoothed. */
export const SNAP_DISTANCE = 1;
/** How fast a smoothed correction fades, per second: to a tenth in about 7 frames. */
const SMOOTH_RATE = 20;
/** A correction left smaller than this (m) is done. */
const SETTLED = 1e-4;

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
  /**
   * Where the local Player is drawn, less where the prediction has them (m, ground plane): what is left of the
   * corrections, fading.
   */
  private offset = { x: 0, z: 0 };
  private now: () => number;

  constructor(private opts: OnlineMatchOptions) {
    this.local = opts.local;
    this.latest = opts.start;
    this.predictor = createPredictor({ local: opts.local, start: opts.start, tuning: opts.tuning });
    this.now = opts.now ?? (() => performance.now());
  }

  /** The predicted states either side of the newest predicted Tick. */
  get prev(): SimState {
    return this.predictor.prev;
  }
  get curr(): SimState {
    return this.predictor.curr;
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
    const { correction, told } = this.predictor.reconcile(snap);
    const x = this.offset.x - correction.x;
    const z = this.offset.z - correction.z;
    this.offset = Math.hypot(x, z) > SNAP_DISTANCE ? { x: 0, z: 0 } : { x, z };
    this.tell(told);
  }

  /** The Court's answer to a ping. */
  pong(msg: PongMsg) {
    this.sync.pong(msg, this.now());
  }

  frame(dt: number) {
    this.sendInput();
    const fade = Math.exp(-SMOOTH_RATE * dt);
    const { x, z } = this.offset;
    this.offset = Math.hypot(x, z) < SETTLED ? { x: 0, z: 0 } : { x: x * fade, z: z * fade };

    const { prev, curr } = this.predictor;
    // The prediction steps a Tick as each is stamped, so it is drawn on the input clock: `prev` at the last Tick
    // stamped and `curr` a Tick on. Before the clock is known it stands still.
    const at = this.sync.courtTick(this.now());
    const alpha = at === null || prev === curr ? 1 : Math.min(1, Math.max(0, at + this.sync.lead - prev.tick + 1));
    this.opts.view.draw(this.shifted(prev), this.shifted(curr), alpha, this.latest, dt);
  }

  /** Pings when one is due, and stamps and predicts the input due, until the Match is over (`inputFrame`). */
  private sendInput() {
    if (this.latest.phase === 'over') return;
    const told: Told[] = [];
    const msgs = inputFrame(this.sync, this.stream, this.now(), (tick) => {
      const intent = this.opts.input();
      told.push(...this.predictor.stamp(tick, intent));
      return intent;
    });
    for (const msg of msgs) this.opts.send(msg);
    this.tell(told);
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
