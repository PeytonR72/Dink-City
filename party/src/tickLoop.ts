// The Court's fixed-rate clock, pure. Workers' clocks only move between I/O events, so the Court passes the
// timestamp taken at the start of each interval callback and never times work inside one.

/** Counts the Ticks due at each callback. */
export interface TickLoop {
  /** The Ticks to run now. The first call only sets the clock and returns 0. */
  advance(now: number): number;
  /** How many Ticks' worth of time at `now` hasn't run yet, fractional, up to what the next callback would run. */
  phase(now: number): number;
}

/**
 * An accumulator at `hz` Ticks a second. A late callback catches up, but at most `maxCatchUp` Ticks at once; the
 * rest of a longer stall is dropped rather than run in a burst.
 */
export function createTickLoop(opts: { hz: number; maxCatchUp: number }): TickLoop {
  // Counted in ms × hz, so whole-millisecond timestamps add up exactly: one Tick is 1000.
  let acc = 0;
  let last: number | null = null;
  return {
    advance(now) {
      if (last === null) {
        last = now;
        return 0;
      }
      acc += Math.max(0, now - last) * opts.hz;
      last = now;
      const due = Math.floor(acc / 1000);
      if (due > opts.maxCatchUp) {
        acc = 0;
        return opts.maxCatchUp;
      }
      acc -= due * 1000;
      return due;
    },
    phase(now) {
      if (last === null) return 0;
      return Math.min(opts.maxCatchUp, (acc + Math.max(0, now - last) * opts.hz) / 1000);
    },
  };
}
