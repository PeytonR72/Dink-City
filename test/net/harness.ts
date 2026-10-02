// The netcode harness: the pure Court Match and two clients, joined by a fake network with latency, jitter and loss,
// all on one virtual clock. The clients use the same clock sync, input stream and predictor as `OnlineMatch`, and every
// message crosses the wire encoded and is re-guarded on arrival, as on the real Court. Deterministic for a given seed.
import { DIFFICULTY, createBot } from '../../src/bot/bot';
import { observe } from '../../src/bot/observe';
import {
  composeView,
  createClockSync,
  createInputStream,
  createInterpolator,
  createPredictor,
  extendTrack,
  decode,
  inputFrame,
  encode,
  isCourtMsg,
  isIn,
  isPing,
  onlineConfig,
  type BallClock,
  type ClientMsg,
  type ClockSync,
  type Clocks,
  type CourtMsg,
  type InputStream,
  type Interpolator,
  type Predictor,
  type PresetId,
  type SnapEvent,
  type Told,
} from '../../src/net';
import { TICK, createInitialState, type Intent, type ShotType, type SideIndex, type SimState, type Vec3 } from '../../src/sim';
import { simTuning } from '../../src/tuning';
import { createCourtMatch, type CourtMatch } from '../../party/src/courtMatch';
import { createTickLoop, type TickLoop } from '../../party/src/tickLoop';

const TICK_MS = TICK * 1000;

/**
 * One direction of the link: each packet takes `latency` plus up to `jitter` ms, or is lost with odds `loss`. With
 * `stall`, the link also freezes for `ms` out of every `every` ms, as a WebSocket does behind a lost segment: packets
 * sent meanwhile wait and go out together when it clears.
 */
export interface LinkSpec {
  latency: number;
  jitter: number;
  loss: number;
  stall?: { every: number; ms: number };
}

/** A frame as a client drew it: the Tick each thing was drawn at. */
export interface DrawnFrame {
  /** Virtual time, ms. */
  at: number;
  clock: Clocks;
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
  /** Every Intent stamped, by Tick, as sent: as the Court would step it, `contact` included. */
  readonly stamped: Map<number, Intent>;
  readonly presses: Press[];
  latest: SimState;
  /** The Predicted timeline, stamped and reconciled as `OnlineMatch` does. */
  readonly predictor: Predictor;
  /**
   * Where the prediction first put each Side's Player at each Tick (by the state's Tick): as the screen drew it when
   * that Tick was stamped.
   */
  readonly predicted: Map<number, [Vec3, Vec3]>;
  /** Where the prediction first put the ball, likewise. */
  readonly predictedBall: Map<number, Vec3>;
  /** How far each Snapshot moved the predicted local Player (m, ground plane), in order. */
  readonly corrections: number[];
  /** The Interpolated timeline, fed and run as `OnlineMatch` does. */
  readonly interp: Interpolator;
  /** Every frame drawn, composed as `OnlineMatch` does. */
  readonly drawn: DrawnFrame[];
  /** Every event the client told its view, from its prediction or the Court, in order, with the frame's time (ms). */
  readonly heard: (SnapEvent & { at: number })[];
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
  /** Each Side's Intents as the Court last stepped them, by Tick: a rewind's re-steps replace what came before. */
  readonly applied: [Map<number, Intent>, Map<number, Intent>];
  /** Each Side's Player's position in the Court's states as last stepped, by the state's Tick. */
  readonly courtPos: [Map<number, Vec3>, Map<number, Vec3>];
  /** The Court's states as last stepped, by Tick. */
  readonly courtStates: Map<number, SimState>;
  /** Every event the Court sent, in order. */
  readonly courtEvents: SnapEvent[];
  /** Each Side's shot presses as the Court last stepped them, in Tick order. */
  readonly appliedPresses: [Press[], Press[]];
  /** How many steps re-stepped a Tick for a rewind. */
  readonly resteps: number;
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
  const courtPos: Harness['courtPos'] = [new Map(), new Map()];
  const courtStates: Harness['courtStates'] = new Map();
  const courtEvents: SnapEvent[] = [];
  let resteps = 0;
  const presses = (side: SideIndex): Press[] =>
    // A re-step keeps its Tick's place in the map, so this is in Tick order.
    [...applied[side]].flatMap(([tick, i]) => (i.shot ? [{ tick, shot: i.shot }] : []));
  const match = createCourtMatch({
    seed: matchSeed,
    preset,
    tuning: simTuning,
    onStep(tick, intents) {
      if (applied[0].has(tick)) resteps++;
      applied[0].set(tick, intents[0]);
      applied[1].set(tick, intents[1]);
      // `onStep` comes just before the step, so the Court's state is still the one at `tick`.
      for (const side of [0, 1] as const) courtPos[side].set(tick, { ...match.state.sides[side].players[0].pos });
      courtStates.set(tick, match.state);
    },
  });
  const loop: TickLoop = createTickLoop({ hz: 60, maxCatchUp: 8 });
  loop.advance(now);
  const courtTick = () => match.state.tick + (match.over ? 0 : loop.phase(now));

  /** Sends `msg` one way, maybe losing it, and hands the guarded copy to `deliver`. */
  const send = <T>(link: LinkSpec, msg: ClientMsg | CourtMsg, guard: (v: unknown) => v is T, deliver: (m: T) => void) => {
    if (rng() < link.loss) return;
    const wire = encode(msg);
    const { stall } = link;
    const into = stall ? now % stall.every : 0;
    const leaves = stall && into < stall.ms ? now - into + stall.ms : now;
    at(leaves + link.latency + rng() * link.jitter, () => {
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
        c.stream.ack(m.ack);
        // Snapshots can pass each other on this network; an older one is stale.
        if (m.tick <= c.latest.tick) return;
        c.latest = m.state;
        const { correction, told, court } = c.predictor.reconcile(m);
        c.corrections.push(Math.hypot(correction.x, correction.z));
        hear(c, told);
        hear(c, c.interp.push(m.state, court));
        retrack(c);
      } else if (m.t === 'pong') c.sync.pong(m, c.clock());
    });

  const start = createInitialState(matchSeed, onlineConfig(preset));
  /** Each client's track for the ball (every Tick known) and its ball clock, as `OnlineMatch` keeps them. */
  const tracks = new Map<SideIndex, { track: SimState[]; ball: BallClock | null }>();
  const retrack = (c: FakeClient) => {
    const t = tracks.get(c.side)!;
    t.track = extendTrack(t.track, c.predictor.states, c.interp.clock - 30);
  };
  const client = (side: SideIndex, skew: number): FakeClient => ({
    side,
    sync: createClockSync(),
    stream: createInputStream(),
    clock: () => now + skew,
    stamped: new Map(),
    presses: [],
    latest: start,
    predictor: createPredictor({ local: side, start, tuning: simTuning }),
    predicted: new Map(),
    predictedBall: new Map(),
    corrections: [],
    interp: createInterpolator(start),
    drawn: [],
    heard: [],
    stopped: false,
  });
  const clients: [FakeClient, FakeClient] = [client(0, 123_456.7), client(1, -4_321.2)];
  for (const c of clients) tracks.set(c.side, { track: [start], ball: null });
  const drives = clients.map((c): Drive => {
    const bot = createBot(c.side, matchSeed + 1 + c.side, DIFFICULTY.easy, simTuning);
    return opts.drive?.[c.side] ?? ((tick, latest) => bot.think({ ...observe(latest, c.side), tick }));
  });

  const hear = (c: FakeClient, told: Told[]) => {
    for (const t of told) c.heard.push(...t.events.map((e) => ({ ...e, at: now })));
  };
  let each: (() => void) | undefined;
  /** One client frame, sending input as `OnlineMatch` does. */
  const frame = (c: FakeClient) => {
    each?.();
    if (c.stopped) return;
    const msgs = inputFrame(c.sync, c.stream, c.clock(), (tick) => {
      // The prediction calls the hit, and returns the Intent as the Court will step it.
      const { intent, told } = c.predictor.stamp(tick, drives[c.side]!(tick, c.latest));
      c.stamped.set(tick, intent);
      if (intent.shot) c.presses.push({ tick, shot: intent.shot });
      hear(c, told);
      const { curr } = c.predictor;
      if (!c.predicted.has(curr.tick)) {
        c.predicted.set(curr.tick, [{ ...curr.sides[0].players[0].pos }, { ...curr.sides[1].players[0].pos }]);
        c.predictedBall.set(curr.tick, { ...curr.ball.pos });
      }
      return intent;
    });
    for (const msg of msgs) toCourt(c.side, msg);
    retrack(c);

    // Draws the frame, as `OnlineMatch.frame` does.
    hear(c, c.interp.advance(TICK));
    const { prev, curr } = c.predictor;
    const courtNow = c.sync.courtTick(c.clock());
    const alpha = courtNow === null || prev === curr ? 1 : Math.min(1, Math.max(0, courtNow + c.sync.lead - prev.tick + 1));
    const t = tracks.get(c.side)!;
    const view = composeView(
      { local: c.side, now: prev.tick + alpha * (curr.tick - prev.tick), remote: c.interp.clock, track: t.track, snaps: c.interp.states },
      t.ball,
    );
    t.ball = view.ball;
    c.drawn.push({ at: now, clock: view.clock });
  };

  // The Court's interval fires on whole milliseconds, like a Worker's; the clients' frames at 60 Hz, a little apart.
  let courtCalls = 1;
  const courtCallback = () => {
    const ticks = loop.advance(now);
    for (const { side, msg } of match.advance(ticks)) {
      if (side === 0 && msg.t === 'snap') courtEvents.push(...msg.events);
      toClient(side, msg);
    }
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
    courtPos,
    courtStates,
    courtEvents,
    get appliedPresses(): [Press[], Press[]] {
      return [presses(0), presses(1)];
    },
    get resteps() {
      return resteps;
    },
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
