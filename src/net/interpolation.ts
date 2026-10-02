// The Interpolated timeline: the Court's Snapshots, drawn a little in the past so there are always two to draw
// between. The remote Player is drawn only from here, so their swings follow hits the Court confirmed, and the Court's
// events this screen didn't predict are told on its clock. Pure, so `OnlineMatch` and the netcode harness both run it.
import { TICK, type SimEvent, type SimState } from '../sim';
import type { Told } from './prediction';
import type { SnapEvent } from './protocol';

/** Snapshots are drawn this many Ticks behind the newest: 100 ms, three Snapshots' worth of slack. */
export const INTERP_DELAY_TICKS = 6;
/** Further than this from where it should be, the clock jumps there (a rejoin, a hidden tab). */
const JUMP_TICKS = 30;
/** How fast the clock eases toward where it should be, per second. */
const EASE_RATE = 3;
/** Snapshots are kept this many Ticks behind the clock, for the frame before the one drawn. */
const KEEP_TICKS = 4;

/** The outcomes: final when the Court sends them (it holds them until no rewind can change them), so told at once. */
export function isOutcome(e: SimEvent): boolean {
  return e.kind === 'dead' || e.kind === 'rally-won' || e.kind === 'game' || e.kind === 'match';
}

export interface Interpolator {
  /** The Tick drawn, fractional: the remote Player's time. It runs with real time, eased toward 100 ms behind. */
  readonly clock: number;
  /** The Snapshots' states around the clock and newer, oldest first. Never empty. */
  readonly states: readonly SimState[];
  /**
   * A Snapshot's state, with the events of it this screen didn't predict. Returns what to tell now: the outcomes, after
   * any event of the same Tick or earlier still waiting. The rest wait for the clock.
   */
  push(state: SimState, events: readonly SnapEvent[]): Told[];
  /** Runs the clock `dt` seconds on, and returns the events it passed, with the Snapshot each came in. */
  advance(dt: number): Told[];
}

/** An Interpolated timeline standing at `start` until the first Snapshot. */
export function createInterpolator(start: SimState): Interpolator {
  let states: SimState[] = [start];
  let clock = start.tick;
  let started = false;
  /** Events waiting for the clock, in Tick order, with the state they came with. */
  let waiting: { state: SimState; event: SnapEvent }[] = [];

  /** Takes the waiting events up to Tick `tick`, grouped by the state they came with. */
  const due = (tick: number): Told[] => {
    const out: Told[] = [];
    while (waiting.length > 0 && waiting[0]!.event.tick <= tick) {
      const { state, event } = waiting.shift()!;
      const last = out.at(-1);
      if (last && last.state === state) last.events.push(event);
      else out.push({ state, events: [event] });
    }
    return out;
  };

  return {
    get clock() {
      return clock;
    },
    get states() {
      return states;
    },
    push(state, events) {
      if (state.tick <= states.at(-1)!.tick) return [];
      if (!started) clock = Math.max(clock, state.tick - INTERP_DELAY_TICKS);
      started = true;
      states.push(state);
      const out: Told[] = [];
      for (const event of events) {
        if (!isOutcome(event)) {
          waiting.push({ state, event });
          continue;
        }
        out.push(...due(event.tick));
        const last = out.at(-1);
        if (last && last.state === state) last.events.push(event);
        else out.push({ state, events: [event] });
      }
      // Each Snapshot's events are in Tick order, and come after the last one's.
      waiting.sort((a, b) => a.event.tick - b.event.tick);
      return out;
    },
    advance(dt) {
      const newest = states.at(-1)!.tick;
      if (started) {
        clock += dt / TICK;
        const behind = newest - INTERP_DELAY_TICKS - clock;
        clock += Math.abs(behind) > JUMP_TICKS ? behind : behind * (1 - Math.exp(-EASE_RATE * dt));
        clock = Math.min(clock, newest);
      }
      // Keep the newest Snapshot at or before `clock - KEEP_TICKS`, and everything after it.
      let keep = 0;
      while (keep + 1 < states.length && states[keep + 1]!.tick <= clock - KEEP_TICKS) keep++;
      if (keep > 0) states = states.slice(keep);
      return due(clock);
    },
  };
}
