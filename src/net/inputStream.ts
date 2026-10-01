// The client's outgoing Intents: each stamped with the Court Tick it's meant for, and resent until the Court
// acknowledges it. Pure; `OnlineMatch` and the netcode harness both drive it.
import type { Intent } from '../sim';
import type { ClockSync } from './clockSync';
import { hasShot, quantizeIntent, type QIntent } from './intentCodec';
import { MAX_IN_INTENTS, type ClientMsg, type InMsg } from './protocol';

/** How many unacknowledged Ticks each `in` carries, beyond any held for a shot press. */
export const INPUT_REDUNDANCY = 15;
/** A gap longer than this (a hidden tab, a clock step) is skipped rather than sampled Tick by Tick. */
const MAX_CATCH_UP = 8;

/** The Intents this client has stamped and the Court hasn't acknowledged. */
export interface InputStream {
  /**
   * Samples one Intent for each Tick after the last one stamped, up to `target`, and returns the `in` carrying every
   * unacknowledged one, or null once the Court has them all. The first call stamps `target` alone.
   */
  stampTo(target: number, sample: (tick: number) => Intent): InMsg | null;
  /** The Court has every Intent up to `tick`. */
  ack(tick: number): void;
  /** The last Tick stamped, or null before the first. */
  readonly last: number | null;
  readonly unacked: number;
}

/**
 * Keeps the last `INPUT_REDUNDANCY` unacknowledged Ticks, dropping older ones, except that a Tick with a shot press is
 * kept until the Court acknowledges it, so a press survives a long run of lost packets. `MAX_IN_INTENTS` caps even
 * that.
 */
export function createInputStream(): InputStream {
  let pending: { tick: number; q: QIntent }[] = [];
  let last: number | null = null;
  return {
    stampTo(target, sample) {
      if (last === null || target > last) {
        let tick = last === null ? target : Math.max(last + 1, target - MAX_CATCH_UP + 1);
        // An `in` is one unbroken run of Ticks, so a skipped gap gives up everything before it.
        if (last !== null && tick > last + 1) pending = [];
        for (; tick <= target; tick++) pending.push({ tick, q: quantizeIntent(sample(tick)) });
        while (pending.length > MAX_IN_INTENTS || (pending.length > INPUT_REDUNDANCY && !hasShot(pending[0]!.q))) pending.shift();
        last = target;
      }
      return pending.length === 0 ? null : { t: 'in', from: pending[0]!.tick, intents: pending.map((p) => p.q) };
    },
    ack(tick) {
      pending = pending.filter((p) => p.tick > tick);
    },
    get last() {
      return last;
    },
    get unacked() {
      return pending.length;
    },
  };
}

/**
 * One client frame, as `OnlineMatch` sends input: a ping if one is due, then, once the Court's clock is known, the
 * Intents stamped up to the input Tick with every unacknowledged one. `now` is the client's clock, ms.
 */
export function inputFrame(sync: ClockSync, stream: InputStream, now: number, sample: (tick: number) => Intent): ClientMsg[] {
  const out: ClientMsg[] = [];
  const ping = sync.ping(now);
  if (ping) out.push(ping);
  const target = sync.inputTick(now);
  const msg = target === null ? null : stream.stampTo(target, sample);
  if (msg) out.push(msg);
  return out;
}
