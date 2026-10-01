import { describe, expect, it } from 'vitest';
import type { ClientMsg, InMsg, PingMsg, SnapEvent } from '../src/net';
import type { MatchView } from '../src/match/driver';
import { INTERP_DELAY_TICKS, OnlineMatch } from '../src/match/online';
import { localView } from '../src/render/localView';
import { TICK, createInitialState, type Intent, type SideIndex, type SimState } from '../src/sim';

/** A state labeled with Tick `tick`, told apart by its ball's x. */
function at(tick: number): SimState {
  const s = createInitialState(1);
  s.tick = tick;
  s.ball.pos.x = tick;
  return s;
}

/** An online Match with a fake connection and view, logging what the view is told. */
function online(local: SideIndex = 0, input: () => Intent = idle) {
  const sent: ClientMsg[] = [];
  /** This screen's clock, ms: one Tick per Tick-long frame. */
  let clock = 0;
  const told: { tick: number; events: string[] }[] = [];
  const drawn: { prev: number; curr: number; alpha: number; live: number }[] = [];
  const view: MatchView = {
    tick: (s, events) => told.push({ tick: s.tick, events: events.map((e) => `${(e as SnapEvent).tick} ${e.kind}`) }),
    replay: () => {
      throw new Error('no Replays online');
    },
    replayed: () => {
      throw new Error('no Replays online');
    },
    draw: (prev, curr, alpha, live) => drawn.push({ prev: prev.tick, curr: curr.tick, alpha, live: live.tick }),
  };
  const match = new OnlineMatch({ local, start: at(0), view, input, send: (m) => sent.push(m), now: () => clock });
  const snap = (tick: number, events: SnapEvent[] = [], ack = -1) => match.receive({ tick, ack, state: at(tick), events });
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
  const ins = () => sent.filter((m): m is InMsg => m.t === 'in');
  return { match, sent, ins, told, drawn, snap, frame, frames, pong, last: () => drawn[drawn.length - 1]! };
}

function idle(): Intent {
  return { move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, shot: null };
}

const net = (tick: number): SnapEvent => ({ kind: 'net', pos: { x: 0, y: 0, z: 0 }, cord: false, tick });

describe('OnlineMatch', () => {
  it('plays the given Side', () => {
    expect(online(1).match.local).toBe(1);
  });

  it('draws the Guest on Side 1 mirrored, at the bottom, as the renderer is told', () => {
    const { match, snap, frames } = online(1);
    frames(1);
    // Side 1 starts at End 1.
    expect(localView(match.curr, match.local)).toMatchObject({ mirrored: true, ring: 1, landingFrom: 0 });
    snap(2);
    frames(10);
    expect(localView(match.curr, match.local).mirrored).toBe(true);
    expect(localView(match.curr, 0).mirrored).toBe(false);
  });

  it('draws the start state until the first Snapshot', () => {
    const { match, frames, last } = online();
    frames(3);
    expect(last()).toEqual({ prev: 0, curr: 0, alpha: 1, live: 0 });
    expect(match.curr.tick).toBe(0);
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
    const { ins, frame, frames, pong, snap } = online();
    frame(TICK);
    // Half a Tick off the frames, so no input Tick lands on a rounding edge.
    pong(0.5);
    frames(5);
    expect(ins().at(-1)).toMatchObject({ from: 3, intents: { length: 5 } });
    snap(2, [], 5);
    frames(1);
    expect(ins().at(-1)).toMatchObject({ from: 6, intents: { length: 3 } });
  });

  it('stops sending once a Snapshot says the Match is over', () => {
    const { match, sent, frame, frames, pong } = online();
    frame(TICK);
    pong(0.5);
    frames(3);
    const over = at(4);
    over.phase = 'over';
    match.receive({ tick: 4, ack: -1, state: over, events: [] });
    const before = sent.length;
    frames(120);
    expect(sent.length).toBe(before);
  });

  it('draws about 100 ms behind the newest Snapshot, between the two around that time', () => {
    const { snap, frames, last } = online();
    // Snapshots every 2 Ticks, a frame every Tick, for a second.
    for (let t = 2; t <= 60; t += 2) {
      snap(t);
      frames(2);
    }
    const { prev, curr, alpha } = last();
    const drawnAt = prev + alpha * (curr - prev);
    expect(curr - prev).toBe(2);
    expect(drawnAt).toBeGreaterThan(prev - 1e-9);
    expect(drawnAt).toBeLessThanOrEqual(curr);
    expect(60 - drawnAt).toBeGreaterThanOrEqual(INTERP_DELAY_TICKS - 3);
    expect(60 - drawnAt).toBeLessThan(INTERP_DELAY_TICKS + 2);
  });

  it('interpolates between the states it draws: the view gets the pair and how far along', () => {
    const { match, snap, frames, last } = online();
    snap(100);
    snap(102);
    snap(104);
    frames(1);
    const { prev, curr, alpha } = last();
    expect(match.prev.ball.pos.x).toBe(prev);
    expect(match.curr.ball.pos.x).toBe(curr);
    expect(alpha).toBeGreaterThanOrEqual(0);
    expect(alpha).toBeLessThanOrEqual(1);
  });

  it('never draws past the newest Snapshot when they stop coming', () => {
    const { snap, frames, last } = online();
    for (let t = 2; t <= 20; t += 2) {
      snap(t);
      frames(2);
    }
    frames(120);
    expect(last()).toMatchObject({ prev: 20, curr: 20, alpha: 1, live: 20 });
  });

  it('jumps to the newest Snapshots after a long stall instead of crawling through them', () => {
    const { snap, frames, last } = online();
    snap(2);
    frames(2);
    // Say a rejoin, or a hidden tab: ten seconds of Snapshots arrive at once.
    for (let t = 4; t <= 600; t += 2) snap(t);
    frames(1);
    expect(last().curr).toBeGreaterThan(600 - INTERP_DELAY_TICKS - 4);
  });

  it('ignores a Snapshot older than one it has', () => {
    const { match, snap, frames } = online();
    snap(10);
    snap(8);
    frames(30);
    expect(match.curr.tick).toBe(10);
  });

  it('tells the view each event once, as its Tick is drawn, with the Snapshot it came in', () => {
    const { snap, frames, told } = online();
    snap(2, [net(1)]);
    snap(4, [net(3), net(4)]);
    frames(1);
    // Tick 1 is still 100 ms in the future of what's drawn.
    expect(told).toEqual([]);
    for (let t = 6; t <= 30; t += 2) {
      snap(t);
      frames(2);
    }
    expect(told).toEqual([
      { tick: 2, events: ['1 net'] },
      { tick: 4, events: ['3 net'] },
      { tick: 4, events: ['4 net'] },
    ]);
    frames(60);
    expect(told.length).toBe(3);
  });

  it('tells the view skipped-over events too, once, when it jumps', () => {
    const { snap, frames, told } = online();
    snap(2);
    frames(1);
    for (let t = 4; t <= 600; t += 2) snap(t, t === 300 ? [net(299)] : []);
    frames(1);
    frames(1);
    expect(told).toEqual([{ tick: 300, events: ['299 net'] }]);
  });
});
