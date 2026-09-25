// A Fault Replay: the end of a recorded Rally, re-stepped from its start state and Intents. `step` is pure,
// so this reproduces the Rally exactly. The replayed states are for the renderer only and never go back into
// the Match (ADR-0001). The Replay has its own clock, separate from hit-stop and Game speed.
import { TICK, step, type Intent, type SimEvent, type SimState, type SimTuning } from '../sim';

/** A Rally's start state and every Tick's Intents since. */
export interface RecordedRally {
  start: SimState;
  intents: readonly (readonly [Intent, Intent])[];
}

export interface Replay {
  /** Moves the Replay's clock on by `dt` real seconds (scaled by its speed). */
  advance(dt: number): void;
  skip(): void;
  /**
   * The two states to draw between, as in the live loop: `curr` is the newest Tick reached, `alpha` the way from
   * `prev` to it. The clip draws from its first frame exactly to the Fault.
   */
  readonly prev: SimState;
  readonly curr: SimState;
  readonly alpha: number;
  /** Events of the Ticks reached by the last `advance` (they arrive with `curr`), for sounds and swings. */
  readonly events: readonly SimEvent[];
  readonly done: boolean;
}

/**
 * The last `seconds` of the Rally (or all of it, if shorter), played at `speed`, then held on the Fault for
 * `hold` real seconds so it reads before the cut away.
 */
export function createReplay(rally: RecordedRally, t: SimTuning, opts: { seconds: number; speed: number; hold: number }): Replay {
  const keep = Math.round(opts.seconds / TICK) + 1;
  const frames: SimState[] = [rally.start];
  let s = rally.start;
  for (const intents of rally.intents) {
    s = step(s, intents, t);
    frames.push(s);
    if (frames.length > keep) frames.shift();
  }
  const last = frames.length - 1;

  /** Clip time, in Ticks: the drawn moment, from 0 (the first frame) to `last` (the Fault). */
  let clock = 0;
  /** The newest frame whose events have been emitted. */
  let reached = 0;
  let holdLeft = opts.hold;
  let events: SimEvent[] = [];
  /** Draw between frames `i` and `i + 1`. */
  const i = () => Math.max(0, Math.min(Math.floor(clock), last - 1));

  return {
    advance(dt) {
      if (clock >= last) holdLeft -= dt;
      clock = Math.min(last, clock + (dt * opts.speed) / TICK);
      const newest = Math.min(last, i() + 1);
      events = frames.slice(reached + 1, newest + 1).flatMap((f) => f.events);
      reached = Math.max(reached, newest);
    },
    skip() {
      clock = reached = last;
      holdLeft = 0;
      events = [];
    },
    get prev() {
      return frames[i()];
    },
    get curr() {
      return frames[Math.min(last, i() + 1)];
    },
    get alpha() {
      return last === 0 ? 1 : clock - i();
    },
    get events() {
      return events;
    },
    get done() {
      return clock >= last && holdLeft <= 0;
    },
  };
}
