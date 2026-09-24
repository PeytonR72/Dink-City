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
  /** The two states to draw between, as in the live loop: `curr` is the newest, `alpha` the way from `prev` to it. */
  readonly prev: SimState;
  readonly curr: SimState;
  readonly alpha: number;
  /** Events of the Ticks reached by the last `advance`, for sounds and swings. */
  readonly events: readonly SimEvent[];
  readonly done: boolean;
}

/** The last `seconds` of the Rally (or all of it, if shorter), played at `speed`. */
export function createReplay(rally: RecordedRally, t: SimTuning, opts: { seconds: number; speed: number }): Replay {
  const keep = Math.round(opts.seconds / TICK) + 1;
  const frames: SimState[] = [rally.start];
  let s = rally.start;
  for (const intents of rally.intents) {
    s = step(s, intents, t);
    frames.push(s);
    if (frames.length > keep) frames.shift();
  }
  const last = frames.length - 1;

  /** Clip time, in Ticks. */
  let clock = 0;
  let index = 0;
  let events: SimEvent[] = [];

  return {
    advance(dt) {
      clock = Math.min(last, clock + (dt * opts.speed) / TICK);
      const reached = Math.floor(clock);
      events = frames.slice(index + 1, reached + 1).flatMap((f) => f.events);
      index = reached;
    },
    skip() {
      clock = index = last;
      events = [];
    },
    get prev() {
      return frames[Math.max(0, index - 1)];
    },
    get curr() {
      return frames[index];
    },
    get alpha() {
      return clock - index;
    },
    get events() {
      return events;
    },
    get done() {
      return index >= last;
    },
  };
}
