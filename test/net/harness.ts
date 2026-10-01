// The netcode harness: the pure Court Match and two clients, joined by a fake network with latency, jitter and loss,
// all on one virtual clock. The clients use the same clock sync and input stream as `OnlineMatch`, and every message
// crosses the wire encoded and is re-guarded on arrival, as on the real Court. Deterministic for a given seed.
import { DIFFICULTY, createBot } from '../../src/bot/bot';
import { observe } from '../../src/bot/observe';
import {
  PRESETS,
  createClockSync,
  createInputStream,
  decode,
  dequantizeIntent,
  inputFrame,
  encode,
  isCourtMsg,
  isIn,
  isPing,
  quantizeIntent,
  type ClientMsg,
  type ClockSync,
  type CourtMsg,
  type InputStream,
  type PresetId,
} from '../../src/net';
import { TICK, createInitialState, type Intent, type ShotType, type SideIndex, type SimState } from '../../src/sim';
import { simTuning } from '../../src/tuning';
import { createCourtMatch, type CourtMatch } from '../../party/src/courtMatch';
import { createTickLoop, type TickLoop } from '../../party/src/tickLoop';

const TICK_MS = TICK * 1000;

/** One direction of the link: each packet takes `latency` plus up to `jitter` ms, or is lost with odds `loss`. */
export interface LinkSpec {
  latency: number;
  jitter: number;
  loss: number;
}

/** Decides a client's Intent for a Tick it stamps, from the latest Snapshot it has. */
export type Drive = (tick: number, latest: SimState) => Intent;

export interface HarnessOptions {
  /** Seeds the network's randomness. */
  seed: number;
  /** The Match's seed and Preset. */
  matchSeed?: number;
  preset?: PresetId;
  /** Client → Court and Court → client. */
  up: LinkSpec;
  down: LinkSpec;
  /** Each Side's driver. An easy Bot by default, thinking once per Tick stamped. */
  drive?: [Drive?, Drive?];
}

/** A shot press: the Tick it was stamped for (by a client) or stepped on (by the Court). */
export interface Press {
  tick: number;
  shot: ShotType;
}

export interface FakeClient {
  readonly side: SideIndex;
  readonly sync: ClockSync;
  readonly stream: InputStream;
  /** This client's clock, which is skewed from the Court's. */
  clock(): number;
  /** Every Intent stamped, by Tick, as the Court would step it. */
  readonly stamped: Map<number, Intent>;
  readonly presses: Press[];
  latest: SimState;
  /** A stopped client runs no frames: no pings, no input. It still receives. */
  stopped: boolean;
}

export interface Harness {
  /** Virtual time, ms. */
  readonly now: number;
  readonly match: CourtMatch;
  /** The Court's Tick at this instant, fractional: what a pong would say. */
  courtTick(): number;
  readonly clients: [FakeClient, FakeClient];
  /** Each Side's Intents as the Court stepped them, by Tick. */
  readonly applied: [Map<number, Intent>, Map<number, Intent>];
  /** Each Side's shot presses as the Court stepped them. */
  readonly appliedPresses: [Press[], Press[]];
  /** Runs `ms` of virtual time, calling `each` at every client frame. */
  run(ms: number, each?: () => void): void;
}

/** mulberry32: a seeded uniform 0..1. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Starts a Match on the Court with both clients seated and their first frame due. */
export function createHarness(opts: HarnessOptions): Harness {
  const rng = seeded(opts.seed);
  const matchSeed = opts.matchSeed ?? 77;
  const preset = opts.preset ?? 'quick';
  let now = 0;
  let seq = 0;
  /** Pending events: deliveries, Court callbacks and client frames, run in time order. */
  const queue: { at: number; seq: number; run: () => void }[] = [];
  const at = (time: number, run: () => void) => {
    queue.push({ at: time, seq: seq++, run });
  };

  const applied: Harness['applied'] = [new Map(), new Map()];
  const appliedPresses: Harness['appliedPresses'] = [[], []];
  const match = createCourtMatch({
    seed: matchSeed,
    preset,
    tuning: simTuning,
    onStep(tick, intents) {
      for (const side of [0, 1] as const) {
        applied[side].set(tick, intents[side]);
        const shot = intents[side].shot;
        if (shot) appliedPresses[side].push({ tick, shot });
      }
    },
  });
  const loop: TickLoop = createTickLoop({ hz: 60, maxCatchUp: 8 });
  loop.advance(now);
  const courtTick = () => match.state.tick + (match.over ? 0 : loop.phase(now));

  /** Sends `msg` one way, maybe losing it, and hands the guarded copy to `deliver`. */
  const send = <T>(link: LinkSpec, msg: ClientMsg | CourtMsg, guard: (v: unknown) => v is T, deliver: (m: T) => void) => {
    if (rng() < link.loss) return;
    const wire = encode(msg);
    at(now + link.latency + rng() * link.jitter, () => {
      const m = decode(wire);
      if (guard(m)) deliver(m);
    });
  };
  const toCourt = (side: SideIndex, msg: ClientMsg) =>
    send(opts.up, msg, (v): v is ClientMsg => isIn(v) || isPing(v), (m) => {
      if (m.t === 'in') match.receive(side, m);
      else if (m.t === 'ping') toClient(side, { t: 'pong', id: m.id, clientTime: m.clientTime, courtTick: courtTick() });
    });
  const toClient = (side: SideIndex, msg: CourtMsg) =>
    send(opts.down, msg, isCourtMsg, (m) => {
      const c = clients[side];
      if (m.t === 'snap') {
        c.latest = m.state;
        c.stream.ack(m.ack);
      } else if (m.t === 'pong') c.sync.pong(m, c.clock());
    });

  const start = createInitialState(matchSeed, PRESETS[preset].config);
  const client = (side: SideIndex, skew: number): FakeClient => ({
    side,
    sync: createClockSync(),
    stream: createInputStream(),
    clock: () => now + skew,
    stamped: new Map(),
    presses: [],
    latest: start,
    stopped: false,
  });
  const clients: [FakeClient, FakeClient] = [client(0, 123_456.7), client(1, -4_321.2)];
  const drives = clients.map((c): Drive => {
    const bot = createBot(c.side, matchSeed + 1 + c.side, DIFFICULTY.easy, simTuning);
    return opts.drive?.[c.side] ?? ((tick, latest) => bot.think({ ...observe(latest, c.side), tick }));
  });

  let each: (() => void) | undefined;
  /** One client frame, sending input as `OnlineMatch` does. */
  const frame = (c: FakeClient) => {
    each?.();
    if (c.stopped) return;
    const msgs = inputFrame(c.sync, c.stream, c.clock(), (tick) => {
      const intent = drives[c.side]!(tick, c.latest);
      // What the Court will step: the Intent after the wire.
      const wire = dequantizeIntent(quantizeIntent(intent));
      c.stamped.set(tick, wire);
      if (wire.shot) c.presses.push({ tick, shot: wire.shot });
      return intent;
    });
    for (const msg of msgs) toCourt(c.side, msg);
  };

  // The Court's interval fires on whole milliseconds, like a Worker's; the clients' frames at 60 Hz, a little apart.
  let courtCalls = 1;
  const courtCallback = () => {
    const ticks = loop.advance(now);
    for (const { side, msg } of match.advance(ticks)) toClient(side, msg);
    at(Math.round(++courtCalls * TICK_MS), courtCallback);
  };
  at(Math.round(TICK_MS), courtCallback);
  clients.forEach((c, i) => {
    let frames = 0;
    const offset = 3.3 + i * 7.1;
    const next = () => {
      frame(c);
      at(offset + ++frames * TICK_MS, next);
    };
    at(offset, next);
  });

  return {
    get now() {
      return now;
    },
    match,
    courtTick,
    clients,
    applied,
    appliedPresses,
    run(ms, cb) {
      each = cb;
      const end = now + ms;
      for (;;) {
        queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
        const next = queue[0];
        if (next === undefined || next.at > end) break;
        queue.shift();
        now = next.at;
        next.run();
      }
      now = end;
      each = undefined;
    },
  };
}
