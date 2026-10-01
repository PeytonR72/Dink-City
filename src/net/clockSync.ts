// The client's estimate of the Court's clock, from ping and pong samples. Pure: the caller passes its own clock
// (ms), so tests and the netcode harness run it on a virtual one.
import { TICK } from '../sim';
import type { PingMsg, PongMsg } from './protocol';

/** The input lead never goes past this many Ticks, however slow the link. */
export const MAX_LEAD_TICKS = 15;

const TICK_MS = TICK * 1000;
/** The first few pings go out quickly, so the estimate settles in half a second; then twice a second. */
const FAST_PINGS = 5;
const FAST_PING_MS = 100;
const PING_MS = 500;
/** The samples kept: 8 s of them once pings slow down. */
const WINDOW = 16;
/** The lead covers the median round trip's half plus this many times its median deviation, and one Tick. */
const JITTER_K = 2;
/** How far, in Ticks, a sample may disagree with the estimate beyond its own uncertainty before it counts as a step. */
const STEP_SLACK = 0.5;

/** One sample: its round trip (ms) and the Court's Tick minus the client's clock in Ticks, at its midpoint. */
interface Sample {
  rtt: number;
  offset: number;
}

/** What the client knows about the Court's clock. */
export interface ClockSync {
  /** The ping to send now, or null if none is due. */
  ping(now: number): PingMsg | null;
  /** Takes the Court's answer, received at `now`. */
  pong(msg: PongMsg, now: number): void;
  /** True after the first sample. Until then the Court's Tick is unknown. */
  readonly ready: boolean;
  /** The median round trip, ms. */
  readonly rtt: number;
  /** The median deviation from `rtt`, ms. */
  readonly jitter: number;
  /** How many Ticks ahead of the Court input is stamped. */
  readonly lead: number;
  /** The Court's Tick at `now`, fractional, or null before the first sample. */
  courtTick(now: number): number | null;
  /** The Tick to stamp input sampled at `now` with, so it reaches the Court before that Tick is stepped. */
  inputTick(now: number): number | null;
}

/**
 * Estimates the Court's Tick from pings. Each sample brackets the Court's clock within half its round trip, so the
 * estimate averages the samples with the fastest round trips. A sample that rules the estimate out (the Court
 * dropped a stall, or the client's clock jumped) starts over from it.
 */
export function createClockSync(): ClockSync {
  let samples: Sample[] = [];
  let estimate: number | null = null;
  let pings = 0;
  let lastPing = -Infinity;
  let rtt = 0;
  let jitter = 0;
  let lead = 0;

  const courtTick = (now: number) => (estimate === null ? null : now / TICK_MS + estimate);

  return {
    ping(now) {
      if (now - lastPing < (pings < FAST_PINGS ? FAST_PING_MS : PING_MS)) return null;
      lastPing = now;
      return { t: 'ping', id: ++pings, clientTime: now };
    },
    pong(msg, now) {
      const r = now - msg.clientTime;
      if (!(r >= 0)) return;
      const offset = msg.courtTick - (msg.clientTime + now) / 2 / TICK_MS;
      if (estimate !== null && Math.abs(offset - estimate) > r / 2 / TICK_MS + STEP_SLACK) samples = [];
      samples.push({ rtt: r, offset });
      if (samples.length > WINDOW) samples.shift();

      const fastest = Math.min(...samples.map((s) => s.rtt));
      const best = samples.filter((s) => s.rtt <= fastest + TICK_MS);
      estimate = best.reduce((sum, s) => sum + s.offset, 0) / best.length;
      rtt = median(samples.map((s) => s.rtt));
      jitter = median(samples.map((s) => Math.abs(s.rtt - rtt)));
      lead = Math.min(MAX_LEAD_TICKS, (rtt / 2 + JITTER_K * jitter) / TICK_MS + 1);
    },
    get ready() {
      return estimate !== null;
    },
    get rtt() {
      return rtt;
    },
    get jitter() {
      return jitter;
    },
    get lead() {
      return lead;
    },
    courtTick,
    inputTick(now) {
      const t = courtTick(now);
      return t === null ? null : Math.ceil(t + lead);
    },
  };
}

function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
