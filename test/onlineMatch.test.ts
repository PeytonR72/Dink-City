import { describe, expect, it } from 'vitest';
import { INTERP_DELAY_TICKS, onlineConfig, quantizeIntent, type ClientMsg, type Clocks, type InMsg, type PingMsg, type SnapEvent } from '../src/net';
import type { MatchView } from '../src/match/driver';
import { OnlineMatch, SNAP_DISTANCE } from '../src/match/online';
import { localView } from '../src/render/localView';
import { TICK, createInitialState, step, type Intent, type SideIndex, type SimState } from '../src/sim';
import { simTuning, viewTuning } from '../src/tuning';

const START = createInitialState(1);
const STILL: Intent = { move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, shot: null };
const RIGHT: Intent = { move: { x: 1, y: 0 }, aim: { x: 0, y: 0 }, shot: null };
const Q_STILL = quantizeIntent(STILL);

/** The Court's state after `ticks` Ticks of both Players standing still, then each of `then` for Side 0. */
function court(ticks: number, ...then: Intent[]): SimState {
  let s = START;
  for (let t = 0; t < ticks; t++) s = step(s, [STILL, STILL], simTuning);
  for (const i of then) s = step(s, [i, STILL], simTuning);
  return s;
}

/** The Court's states, Tick by Tick, with Side 1 walking right and Side 0 standing still. */
const WALK = [START];
for (let t = 0; t < 40; t++) WALK.push(step(WALK.at(-1)!, [STILL, RIGHT], simTuning));

/** The Court's states, Tick by Tick, with both Players standing still. */
const STANDING = [START];
for (let t = 0; t < 240; t++) STANDING.push(step(STANDING.at(-1)!, [STILL, STILL], simTuning));

const x = (s: SimState, side: SideIndex = 0) => s.sides[side].players[0].pos.x;

/** An online Match with a fake connection and view, logging what the view is told. */
function online(local: SideIndex = 0, input: () => Intent = () => STILL, start = START) {
  const sent: ClientMsg[] = [];
  /** This screen's clock, ms: one Tick per Tick-long frame. */
  let clock = 0;
  const told: { state: SimState; events: string[] }[] = [];
  const drawn: { prev: SimState; curr: SimState; alpha: number; live: SimState; clock?: Clocks }[] = [];
  const view: MatchView = {
    tick: (state, events) => told.push({ state, events: events.map((e) => `${(e as SnapEvent).tick} ${e.kind}`) }),
    replay: () => {
      throw new Error('no Replays online');
    },
    replayed: () => {
      throw new Error('no Replays online');
    },
    draw: (prev, curr, alpha, live, _dt, clock) => drawn.push({ prev, curr, alpha, live, clock }),
  };
  const match = new OnlineMatch({ local, start, view, input, send: (m) => sent.push(m), tuning: simTuning, now: () => clock });
  const snap = (state: SimState, events: SnapEvent[] = [], ack = -1) =>
    match.receive({ t: 'snap', tick: state.tick, ack, state, last: [Q_STILL, Q_STILL], events });
  /** A frame of `dt` seconds. */
  const frame = (dt: number) => {
    clock += dt * 1000;
    match.frame(dt);
  };
  /** Frames adding up to `ticks` Ticks. */
  const frames = (ticks: number) => {
    for (let i = 0; i < ticks; i++) frame(TICK);
  };
  /** Answers the last ping as a Court on Tick `courtTick` would, over a link with no delay. */
  const pong = (courtTick: number) => {
    const ping = sent.filter((m): m is PingMsg => m.t === 'ping').at(-1)!;
    match.pong({ t: 'pong', id: ping.id, clientTime: ping.clientTime, courtTick });
  };
  /** Learns the Court's clock: on Tick 0.5 now, half a Tick off the frames so no input Tick lands on a rounding edge. */
  const synced = () => {
    frame(TICK);
    pong(0.5);
  };
  /** A frame after `ms` with none, told only `dt` seconds passed, as `main.ts` caps a long frame. */
  const stall = (ms: number, dt: number) => {
    clock += ms;
    match.frame(dt);
  };
  const ins = () => sent.filter((m): m is InMsg => m.t === 'in');
  return { match, sent, ins, told, drawn, snap, frame, frames, stall, pong, synced, last: () => drawn[drawn.length - 1]! };
}

const net = (tick: number): SnapEvent => ({ kind: 'net', pos: { x: 0, y: 0, z: 0 }, cord: false, tick });
const dead = (tick: number): SnapEvent => ({ kind: 'dead', reason: 'net', loser: 0, tick });
const remoteHit = (tick: number) =>
  ({ kind: 'hit', side: 1, type: 'drive', variant: 'drive', volley: false, quality: 1, speed: 10, pos: { x: 0, y: 1, z: -6 }, tick }) as SnapEvent;

describe('OnlineMatch', () => {
  it('plays the given Side', () => {
    expect(online(1).match.local).toBe(1);
  });

  it('sends the hit its prediction calls, as Reported Contact', () => {
    // A Rally on Tick 100: Side 0 Committed, the ball just hit by Side 1 and hanging at Side 0's sweet spot.
    const start = structuredClone(createInitialState(1, onlineConfig('quick')));
    start.phase = 'rally';
    start.tick = 100;
    start.sides[0].players[0].pos = { x: 0, y: 0, z: 4 };
    start.sides[0].players[0].commit = { type: 'drive', tick: 90, bestDistance: null };
    start.ball = { pos: { x: 0.2, y: 0.9, z: 3.55 }, vel: { x: 0, y: 0, z: 0 }, spin: 0, lastHitBy: 1, bouncesSinceHit: 1, hitTick: 80 };
    const { match, ins, frame, pong } = online(0, () => STILL, start);
    frame(TICK);
    pong(99.2);
    frame(TICK);
    // The Court is on 100.2, so the first Tick stamped is 102; the prediction steps to it, Ticks 100 and 101 filled.
    // The input sampled has no Contact; the prediction calls the hit, and sends it.
    expect(ins()).toEqual([{ t: 'in', from: 102, intents: [[0, 0, 0, 0, 4]] }]);
    expect(match.predicted.curr.ball.lastHitBy).toBe(0);
  });

  it('draws the Guest on Side 1 mirrored, at the bottom, as the renderer is told', () => {
    const { match, synced, frames } = online(1);
    synced();
    frames(10);
    // Side 1 starts at End 1.
    expect(localView(match.curr, match.local)).toMatchObject({ mirrored: true, ring: 1, landingFrom: 0 });
    expect(localView(match.curr, 0).mirrored).toBe(false);
  });

  it("draws the start state until it knows the Court's clock", () => {
    const { match, frames, last } = online();
    frames(3);
    expect(last()).toMatchObject({ curr: START, alpha: 1, live: START, clock: { sides: [0, 0], ball: 0 } });
    expect(last().prev.sides).toEqual(START.sides);
    expect(match.predicted.curr).toBe(START);
  });

  it("pings the Court, and sends no input until it knows the Court's clock", () => {
    const { sent, frames } = online();
    frames(3);
    expect(sent).toEqual([{ t: 'ping', id: 1, clientTime: 1000 / 60 }]);
  });

  it("stamps one quantized Intent per Tick of the Court's clock, a Tick ahead on a perfect link", () => {
    let n = 0;
    const { match, ins, frame, pong } = online(0, () => ({ move: { x: 1, y: -1 }, aim: { x: 0.5, y: 0 }, shot: n++ === 1 ? 'drive' : null }));
    frame(TICK);
    pong(100);
    expect(match.net.lead).toBe(1);
    // The Court is on 102.5, then 103.1: Ticks 104 and 105 are stamped, and the second message resends 104.
    frame(TICK * 2.5);
    frame(TICK * 0.6);
    expect(ins()).toEqual([
      { t: 'in', from: 104, intents: [[127, -127, 64, 0, 0]] },
      { t: 'in', from: 104, intents: [[127, -127, 64, 0, 0], [127, -127, 64, 0, 2]] },
    ]);
  });

  it('resends what the Court has not acknowledged, and drops what it has', () => {
    const { ins, synced, frames, snap } = online();
    synced();
    frames(5);
    expect(ins().at(-1)).toMatchObject({ from: 3, intents: { length: 5 } });
    snap(court(2), [], 5);
    frames(1);
    expect(ins().at(-1)).toMatchObject({ from: 6, intents: { length: 3 } });
  });

  it('stops sending once a Snapshot says the Match is over', () => {
    const { match, sent, synced, frames } = online();
    synced();
    frames(3);
    const over = court(4);
    over.phase = 'over';
    match.receive({ t: 'snap', tick: 4, ack: -1, state: over, last: [Q_STILL, Q_STILL], events: [] });
    const before = sent.length;
    frames(120);
    expect(sent.length).toBe(before);
  });

  it('moves the local Player the frame the key goes down, with no Snapshot yet', () => {
    let key = STILL;
    const { match, synced, frames, last } = online(0, () => key);
    synced();
    frames(3);
    const still = x(last().curr);
    key = RIGHT;
    frames(1);
    expect(x(last().curr)).toBeGreaterThan(still);
    // Ahead of the Court: the prediction has stepped every Tick stamped.
    expect(match.predicted.curr.tick).toBe(match.net.unacked + 3);
  });

  it('draws the local Player between the last two predicted Ticks on the input clock, and scores from the Court', () => {
    let key = RIGHT;
    const { match, synced, frames, snap, last } = online(0, () => key);
    synced();
    frames(4);
    const { prev, curr } = match.predicted;
    expect(curr.tick - prev.tick).toBe(1);
    const now = last().clock!.sides[0];
    expect(now).toBeGreaterThan(prev.tick);
    expect(now).toBeLessThanOrEqual(curr.tick);
    expect(x(last().curr)).toBeCloseTo(x(prev) + (x(curr) - x(prev)) * (now - prev.tick), 12);
    expect(last().alpha).toBe(1);
    expect(last().live).toBe(START);
    key = STILL;
    const told = court(2);
    snap(told);
    frames(1);
    expect(last().live).toBe(told);
  });

  it('draws the remote Player from the Snapshots, 100 ms behind the newest', () => {
    const { synced, frames, snap, last } = online();
    synced();
    for (let t = 2; t <= 30; t += 2) {
      snap(WALK[t]!);
      frames(2);
    }
    const remote = last().clock!.sides[1];
    // It runs on with real time between Snapshots, two Ticks apart.
    expect(remote).toBeGreaterThan(30 - INTERP_DELAY_TICKS - 2);
    expect(remote).toBeLessThan(30 - INTERP_DELAY_TICKS + 2);
    const t0 = Math.floor(remote / 2) * 2;
    const between = x(WALK[t0]!, 1) + ((x(WALK[t0 + 2]!, 1) - x(WALK[t0]!, 1)) * (remote - t0)) / 2;
    expect(x(last().curr, 1)).toBeCloseTo(between, 12);
  });

  it('is over only once the Court says so', () => {
    const { match, synced, frames, snap } = online();
    synced();
    frames(4);
    expect(match.curr.phase).not.toBe('over');
    const over = court(4);
    over.phase = 'over';
    snap(over);
    frames(1);
    expect(match.curr.phase).toBe('over');
  });

  it('ignores a Snapshot older than one it has', () => {
    const { match, synced, frames, snap } = online();
    synced();
    frames(8);
    snap(court(6));
    snap(court(4));
    expect(match.latest.tick).toBe(6);
    expect(match.remoteTick).toBe(6 - INTERP_DELAY_TICKS);
  });

  it('smooths a small correction of the local Player over a few frames', () => {
    let key = STILL;
    const { match, synced, frames, snap, last } = online(0, () => key);
    synced();
    key = RIGHT;
    frames(8);
    const before = x(match.predicted.curr);
    // Input starts at Tick 3, and the Court never got Ticks 3 and 4, so it stood the Player still for them.
    snap(court(3, STILL, STILL));
    const jump = x(match.predicted.curr) - before;
    expect(Math.abs(jump)).toBeGreaterThan(0.005);
    expect(Math.abs(jump)).toBeLessThan(SNAP_DISTANCE);
    key = STILL;
    frames(1);
    // Drawn near where it was, not where the correction put it; then it settles on the prediction.
    expect(Math.abs(x(last().curr) - x(match.predicted.curr))).toBeGreaterThan(Math.abs(jump) / 2);
    frames(30);
    expect(x(last().curr)).toBe(x(match.predicted.curr));
  });

  it('snaps a large correction at once', () => {
    const { match, synced, frames, snap, last } = online();
    synced();
    frames(4);
    const moved = court(2);
    moved.sides[0].players[0].pos.x += SNAP_DISTANCE * 2;
    snap(moved);
    frames(1);
    expect(x(last().curr)).toBe(x(match.predicted.curr));
  });

  it("tells the Court's outcome events as they come, with its state, and a predictable one only once", () => {
    const { synced, frames, snap, told } = online();
    synced();
    frames(8);
    const s = court(4);
    snap(s, [net(3), dead(4)]);
    expect(told).toEqual([
      { state: s, events: ['3 net'] },
      { state: s, events: ['4 dead'] },
    ]);
    // The same net again, from a Snapshot that repeats it, isn't told twice.
    snap(court(6), [net(3)]);
    expect(told.length).toBe(2);
  });

  it("tells the remote Player's hit when the Interpolated timeline draws it", () => {
    const { match, synced, frames, snap, told } = online();
    synced();
    frames(12);
    const s = court(12);
    snap(s, [remoteHit(11)]);
    while (match.remoteTick < 11) {
      expect(told).toEqual([]);
      frames(1);
    }
    expect(told).toEqual([{ state: s, events: ['11 hit'] }]);
  });
});

describe("OnlineMatch keeps the Court's time", () => {
  it('shows a Fault with no Replay and a hard hit with no hit-stop, and ignores Game speed', () => {
    const speed = viewTuning.gameSpeed;
    viewTuning.gameSpeed = 0.5;
    try {
      // The fake view throws if a Replay is asked for.
      const { synced, frames, snap, told, last } = online();
      synced();
      frames(8);
      const smash = { ...remoteHit(5), variant: 'smash', speed: 30 } as SnapEvent;
      snap(STANDING[6]!, [smash, dead(6)]);
      // The hit waiting before the Fault is told first.
      expect(told.flatMap((t) => t.events)).toEqual(['5 hit', '6 dead']);
      const from = last().clock!;
      for (let t = 8; t < 38; t += 2) {
        frames(2);
        snap(STANDING[t]!);
      }
      // A Tick drawn per Tick of real time: no pause and no slow motion. The remote clock eases, so only about.
      expect(last().clock!.sides[0] - from.sides[0]).toBeCloseTo(30, 9);
      expect(last().clock!.sides[1] - from.sides[1]).toBeCloseTo(30, -1);
    } finally {
      viewTuning.gameSpeed = speed;
    }
  });

  it('resyncs after a hidden tab: the Interpolated clock jumps to the newest Snapshot, and nothing it skipped is told', () => {
    const { match, synced, frames, snap, stall, told } = online();
    synced();
    for (let t = 2; t <= 30; t += 2) {
      snap(STANDING[t]!);
      frames(2);
    }
    // Hidden for 3 s: no frames, but the Snapshots still arrive.
    for (let t = 32; t <= 210; t += 2) snap(STANDING[t]!, t === 100 ? [remoteHit(99)] : []);
    expect(match.remoteTick).toBeGreaterThan(210 - INTERP_DELAY_TICKS - 31);
    // The first frame back is capped at 0.25 s, as `main.ts` caps it, but the clock it reads isn't.
    stall(3000, 0.25);
    expect(match.remoteTick).toBeGreaterThan(210 - INTERP_DELAY_TICKS - 2);
    frames(2);
    expect(told).toEqual([]);
  });

  it('resyncs after a stall with no Snapshots (a debugger pause): it waits for the next one, then predicts on from it', () => {
    const { match, synced, frames, snap, stall, ins } = online();
    synced();
    for (let t = 2; t <= 30; t += 2) {
      snap(STANDING[t]!, [], t);
      frames(2);
    }
    const stamped = match.predicted.curr.tick;
    stall(3000, 0.25);
    // About 180 Ticks were missed. The input skips them, and the prediction doesn't step them.
    const sent = ins().at(-1)!;
    expect(sent.from).toBeGreaterThan(stamped + 150);
    expect(sent.intents.length).toBeLessThanOrEqual(8);
    expect(match.predicted.curr.tick).toBe(stamped);
    // The Court's newest Snapshot: the prediction starts from it, and steps only the Ticks stamped since.
    snap(STANDING[210]!, [], 30);
    expect(match.predicted.curr.tick).toBe(sent.from + sent.intents.length);
    frames(1);
    expect(match.remoteTick).toBeGreaterThan(210 - INTERP_DELAY_TICKS - 2);
  });
});
