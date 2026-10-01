// An online Match: the Court steps the Sim, and this screen sends its Player's Intents, stamped ahead of the Court's
// clock so they arrive before their Tick is stepped, and draws the Court's Snapshots a little in the past. Until
// prediction (issue 09) that Interpolated timeline draws both Players and the ball, not just the remote Player, so the
// local Player feels a round trip late. No Fault Replay, no hit-stop, and Game speed is always 1: none of them may bend
// the Court's clock (ADR-0004).
import { createClockSync, createInputStream, inputFrame, type ClientMsg, type PongMsg, type SnapEvent } from '../net';
import { TICK, type Intent, type SideIndex, type SimState } from '../sim';
import type { MatchDriver, MatchView } from './driver';

/** Snapshots are drawn this many Ticks behind the newest: 100 ms, three Snapshots' worth of slack. */
export const INTERP_DELAY_TICKS = 6;
/** Further than this from where it should be, the render clock jumps there (a rejoin, a hidden tab). */
const JUMP_TICKS = 30;
/** How fast the render clock eases toward where it should be, per second. */
const EASE_RATE = 3;

export interface OnlineMatchOptions {
  /** The seat the Court gave this screen. */
  local: SideIndex;
  /** The Match's first state, from `start`: drawn until the first Snapshot. */
  start: SimState;
  view: MatchView;
  /** Samples the local Player's Intent, once per Tick stamped. */
  input: () => Intent;
  send: (msg: ClientMsg) => void;
  /** This screen's clock, ms. `performance.now` unless a test fakes it. */
  now?: () => number;
}

/** A Snapshot waiting to be drawn, with its events not yet told to the view. */
interface Buffered {
  tick: number;
  state: SimState;
  events: SnapEvent[];
}

/** Drives an online Match from the Court's Snapshots. */
export class OnlineMatch implements MatchDriver {
  readonly local: SideIndex;
  /** The two Snapshots around the Tick drawn. */
  prev: SimState;
  curr: SimState;
  /** Snapshots, oldest first. The oldest is the one drawn from. */
  private snaps: Buffered[] = [];
  /** The Tick drawn, fractional. It runs at 1 Tick per Tick of real time, eased toward 100 ms behind the newest. */
  private drawTick = 0;
  /** The Court's clock as this screen knows it, and the Intents it hasn't acknowledged. */
  private sync = createClockSync();
  private stream = createInputStream();
  private now: () => number;

  constructor(private opts: OnlineMatchOptions) {
    this.local = opts.local;
    this.prev = this.curr = opts.start;
    this.now = opts.now ?? (() => performance.now());
  }

  /** The link as this screen measures it: round trip and jitter (ms), and the input lead and backlog (Ticks). */
  get net() {
    const { sync, stream } = this;
    return { rtt: sync.rtt, jitter: sync.jitter, lead: sync.lead, courtTick: sync.courtTick(this.now()), unacked: stream.unacked };
  }

  /** The newest Snapshot's state: the Match as the Court last told it. */
  get latest(): SimState {
    return this.snaps.at(-1)?.state ?? this.opts.start;
  }

  /** A Snapshot from the Court. One older than the newest is dropped. */
  receive(snap: { tick: number; ack: number; state: SimState; events: SnapEvent[] }) {
    this.stream.ack(snap.ack);
    const newest = this.snaps.at(-1);
    if (newest && snap.tick <= newest.tick) return;
    if (!newest) this.drawTick = snap.tick - INTERP_DELAY_TICKS;
    this.snaps.push({ tick: snap.tick, state: snap.state, events: snap.events.slice() });
  }

  /** The Court's answer to a ping. */
  pong(msg: PongMsg) {
    this.sync.pong(msg, this.now());
  }

  frame(dt: number) {
    this.sendInput();

    const { view } = this.opts;
    const newest = this.snaps.at(-1);
    if (!newest) return view.draw(this.curr, this.curr, 1, this.curr, dt);
    this.drawTick += dt / TICK;
    const behind = newest.tick - INTERP_DELAY_TICKS - this.drawTick;
    this.drawTick += Math.abs(behind) > JUMP_TICKS ? behind : behind * (1 - Math.exp(-EASE_RATE * dt));
    this.drawTick = Math.min(this.drawTick, newest.tick);

    this.tellEvents();
    // Drop the Snapshots wholly behind the Tick drawn; their events have all been told.
    while (this.snaps.length > 1 && this.snaps[1]!.tick <= this.drawTick) this.snaps.shift();
    const a = this.snaps[0]!;
    // Before the oldest Snapshot (just after the first arrives) or at the newest, it stands still.
    const b = this.drawTick < a.tick ? a : (this.snaps[1] ?? a);
    this.prev = a.state;
    this.curr = b.state;
    view.draw(a.state, b.state, b === a ? 1 : (this.drawTick - a.tick) / (b.tick - a.tick), b.state, dt);
  }

  /** Pings when one is due and sends the input due, until the Match is over (`inputFrame`). */
  private sendInput() {
    if (this.latest.phase === 'over') return;
    for (const msg of inputFrame(this.sync, this.stream, this.now(), () => this.opts.input())) this.opts.send(msg);
  }

  /** Tells the view each event whose Tick is now drawn, once, with the Snapshot it came in. */
  private tellEvents() {
    for (const snap of this.snaps) {
      // A Snapshot's events are in Tick order.
      const due = snap.events.filter((e) => e.tick <= this.drawTick);
      if (due.length === 0) continue;
      snap.events = snap.events.slice(due.length);
      this.opts.view.tick(snap.state, due);
    }
  }
}
