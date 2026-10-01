// The Court's Match engine, pure: everything the Court does per Tick, with no Durable Object and no clock. The
// Court decides when to step (`tickLoop`) and who to send to. Each Side's Intents wait here for their Tick; later
// issues grow the input handling (rewind, Reported Contact, the Takeover Bot) behind the same interface.
import { PRESETS, dequantizeIntent, type CourtMsg, type InMsg, type PresetId, type SnapEvent } from '../../src/net';
import { createInitialState, step, type Intent, type ShotType, type SideIndex, type SimState, type SimTuning } from '../../src/sim';

/** A Snapshot goes out once this many Ticks have run since the last one: 30 Hz. */
const SNAP_TICKS = 2;
/** Intents labeled further ahead of the Court than this are refused. A client leads by at most 15. */
export const MAX_AHEAD_TICKS = 30;
/** With no Intent coming, a Side's last move fades to standing still over this many Ticks. */
export const DECAY_TICKS = 6;

/** A message for the Player on `side`. */
export interface Outgoing {
  side: SideIndex;
  msg: CourtMsg;
}

/** One Match on the Court. */
export interface CourtMatch {
  /** The authoritative state after the last step. */
  readonly state: SimState;
  /** True once the Match has a winner. Nothing steps after that. */
  readonly over: boolean;
  /** An `in` from the Player on `side`. */
  receive(side: SideIndex, msg: InMsg): void;
  /** The Player left: the Intents they sent for later Ticks are dropped, so their Side fades to standing still. */
  disconnect(side: SideIndex): void;
  /** The Player's grace ran out: their Side stands still for the rest of the Match. */
  gone(side: SideIndex): void;
  /** Runs `ticks` steps. Returns a Snapshot for each Side if one is due, then `over` if the Match ended. */
  advance(ticks: number): Outgoing[];
  /** For a Player who reloads: a Snapshot of the current state with no events, then `over` if the Match ended. */
  current(side: SideIndex): CourtMsg[];
}

/** One Side's incoming Intents. */
interface Feed {
  /** Intents for Ticks not stepped yet, by Tick. */
  ahead: Map<number, Intent>;
  /** The last Tick up to which every Intent has arrived (or been given up by the client); -1 before any. */
  ack: number;
  /** The last Intent stepped that came from the client, and how many Ticks since have had none. */
  last: Intent;
  missing: number;
  /** Shot presses that arrived after their Tick was stepped, waiting for the next. */
  lateShots: ShotType[];
  gone: boolean;
}

/**
 * Each Side steps Tick T with the Intent its client labeled T. An `in` carries a run of Ticks from the oldest the
 * client hasn't had acknowledged, so a run starting past `ack + 1` means the client gave up the Ticks between, and
 * `ack` jumps over them. A Tick with no Intent repeats the last move and aim with no shot and no Contact, the move
 * fading to nothing over `DECAY_TICKS`, so a stalled or hidden tab stops. An Intent for a Tick already stepped is
 * dropped, but its shot press is applied on the next Tick (issue 08 rewinds instead). A Side with no input yet
 * stands still. Human Sides are `auto` until issue 10, so `contact` has no effect.
 */
export function createCourtMatch(opts: {
  seed: number;
  preset: PresetId;
  tuning: SimTuning;
  /** Watches each step: the Tick stepped from and both Sides' Intents. */
  onStep?: (tick: number, intents: readonly [Intent, Intent]) => void;
}): CourtMatch {
  let state = createInitialState(opts.seed, PRESETS[opts.preset].config);
  const feeds: [Feed, Feed] = [feed(), feed()];
  /** Every event since the last Snapshot. Both Sides get the same list. */
  let events: SnapEvent[] = [];
  let snapTick = 0;
  const over = () => state.phase === 'over';
  /** A Snapshot for `side`, followed by `over` once the Match has a winner. */
  const snapFor = (side: SideIndex, evs: SnapEvent[]): CourtMsg[] => {
    const snap: CourtMsg = { t: 'snap', tick: state.tick, ack: feeds[side].ack, state, events: evs };
    const winner = state.match.winner;
    return over() && winner !== null ? [snap, { t: 'over', winner }] : [snap];
  };

  return {
    get state() {
      return state;
    },
    get over() {
      return over();
    },
    receive(side, msg) {
      const f = feeds[side];
      const limit = state.tick + MAX_AHEAD_TICKS;
      if (f.gone || msg.from > limit) return;
      f.ack = Math.max(f.ack, msg.from - 1);
      msg.intents.forEach((q, i) => {
        const tick = msg.from + i;
        if (tick <= f.ack || tick > limit) return;
        f.ack = tick;
        const intent = dequantizeIntent(q);
        if (tick >= state.tick) f.ahead.set(tick, intent);
        else if (intent.shot) f.lateShots.push(intent.shot);
      });
    },
    disconnect(side) {
      feeds[side] = { ...feed(), last: feeds[side].last, missing: feeds[side].missing };
    },
    gone(side) {
      feeds[side] = { ...feed(), gone: true };
    },
    advance(ticks) {
      if (over()) return [];
      for (let i = 0; i < ticks && !over(); i++) {
        const intents = [intentFor(feeds[0], state.tick), intentFor(feeds[1], state.tick)] as const;
        opts.onStep?.(state.tick, intents);
        state = step(state, intents, opts.tuning);
        for (const e of state.events) events.push({ ...e, tick: state.tick });
      }
      if (state.tick - snapTick < SNAP_TICKS && !over()) return [];
      snapTick = state.tick;
      const out = ([0, 1] as const).flatMap((side) => snapFor(side, events).map((msg) => ({ side, msg })));
      events = [];
      return out;
    },
    current(side) {
      return snapFor(side, []);
    },
  };
}

/** The Intent a Side steps Tick `tick` with: its client's, or the missing-input fill, plus any late shot press. */
function intentFor(f: Feed, tick: number): Intent {
  if (f.gone) return idle();
  let intent = f.ahead.get(tick);
  if (intent) {
    f.ahead.delete(tick);
    f.last = intent;
    f.missing = 0;
  } else {
    f.missing++;
    const k = Math.max(0, 1 - (f.missing - 1) / DECAY_TICKS);
    intent = { move: { x: f.last.move.x * k, y: f.last.move.y * k }, aim: f.last.aim, shot: null };
  }
  const late = f.lateShots.shift();
  if (late === undefined) return intent;
  // Its own press waits for the next Tick.
  if (intent.shot) f.lateShots.push(intent.shot);
  return { ...intent, shot: late };
}

function feed(): Feed {
  return { ahead: new Map(), ack: -1, last: idle(), missing: 0, lateShots: [], gone: false };
}

function idle(): Intent {
  return { move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, shot: null };
}
