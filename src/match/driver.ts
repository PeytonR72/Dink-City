// The seam between main.ts and whatever runs the Match: offline (LocalMatch) or, later, online.
import type { Clocks } from '../net';
import type { SideIndex, SimEvent, SimState } from '../sim';

/**
 * What a driver shows, told as it happens so a Tick's events always arrive with the state they came with, in
 * the same order as the frame played out. The Hud, renderer and sounds listen.
 */
export interface MatchView {
  /** A live Tick's events, with the state they arrived in. */
  tick(s: SimState, events: readonly SimEvent[]): void;
  /** A Fault Replay cuts in (true) or back out (false). */
  replay(on: boolean): void;
  /** Events of replayed Ticks: swings and sounds only, never the score. */
  replayed(s: SimState, events: readonly SimEvent[]): void;
  /**
   * Draws a frame between `prev` and `curr`. `live` is the Match state to score from (not the Replay's). Online,
   * `clock` is the Tick each Player and the ball are drawn at, each on its own timeline.
   */
  draw(prev: SimState, curr: SimState, alpha: number, live: SimState, dt: number, clock?: Clocks): void;
}

/** Runs a Match, one frame at a time. */
export interface MatchDriver {
  /** The Side this screen plays. */
  readonly local: SideIndex;
  /** The last two live states. `curr` is the Match as it stands. */
  readonly prev: SimState;
  readonly curr: SimState;
  /** One frame of `dt` real seconds: steps the Match and tells the view. */
  frame(dt: number): void;
}
