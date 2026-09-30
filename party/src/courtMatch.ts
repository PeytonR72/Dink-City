// The Court's Match engine, pure: everything the Court does per Tick, with no Durable Object and no clock. The
// Court decides when to step (`tickLoop`) and who to send to; later issues grow the input handling in here (jitter
// buffer, rewind, Reported Contact, the Takeover Bot) behind the same interface.
import { PRESETS, dequantizeIntent, type CourtMsg, type InMsg, type PresetId, type SnapEvent } from '../../src/net';
import { createInitialState, step, type Intent, type SideIndex, type SimState, type SimTuning } from '../../src/sim';

/** A Snapshot goes out once this many Ticks have run since the last one: 30 Hz. */
const SNAP_TICKS = 2;

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
  /** The Player left: their Side keeps its last move and aim, but a shot they pressed is dropped. */
  disconnect(side: SideIndex): void;
  /** The Player's grace ran out: their Side stands still for the rest of the Match. */
  gone(side: SideIndex): void;
  /** Runs `ticks` steps. Returns a Snapshot for each Side if one is due, then `over` if the Match ended. */
  advance(ticks: number): Outgoing[];
  /** For a Player who reloads: a Snapshot of the current state with no events, then `over` if the Match ended. */
  current(side: SideIndex): CourtMsg[];
}

/**
 * The naive input model (issue 07 replaces it): each Side steps with its latest `move` and `aim`, and a shot press
 * is latched until the next step uses it, so a press between Ticks isn't lost. A Side with no input yet stands still.
 * Human Sides are `auto` until issue 10, so `contact` is ignored.
 */
export function createCourtMatch(opts: { seed: number; preset: PresetId; tuning: SimTuning }): CourtMatch {
  let state = createInitialState(opts.seed, PRESETS[opts.preset].config);
  /** Each Side's Intent for the next step. */
  const held: [Intent, Intent] = [idle(), idle()];
  const gone = [false, false];
  const ack = [-1, -1];
  /** Every event since the last Snapshot. Both Sides get the same list. */
  let events: SnapEvent[] = [];
  let snapTick = 0;
  const over = () => state.phase === 'over';
  /** A Snapshot for `side`, followed by `over` once the Match has a winner. */
  const snapFor = (side: SideIndex, evs: SnapEvent[]): CourtMsg[] => {
    const snap: CourtMsg = { t: 'snap', tick: state.tick, ack: ack[side]!, state, events: evs };
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
      if (gone[side]) return;
      const { move, aim, shot } = dequantizeIntent(msg.intent);
      held[side] = { move, aim, shot: shot ?? held[side].shot };
      ack[side] = Math.max(ack[side]!, msg.tick);
    },
    disconnect(side) {
      held[side] = { ...held[side], shot: null };
    },
    gone(side) {
      gone[side] = true;
      held[side] = idle();
    },
    advance(ticks) {
      if (over()) return [];
      for (let i = 0; i < ticks && !over(); i++) {
        state = step(state, held, opts.tuning);
        for (const side of [0, 1] as const) held[side] = { ...held[side], shot: null };
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

function idle(): Intent {
  return { move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, shot: null };
}
