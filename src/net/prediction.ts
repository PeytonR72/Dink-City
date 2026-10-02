// The Predicted timeline: a client's own run of the Sim, ahead of the Court, so its Player moves the moment a key is
// pressed. Pure, so `OnlineMatch` and the netcode harness both drive it.
import { autoContact, endOf, endOfZ, other, step, type Intent, type SideIndex, type SimState, type SimTuning } from '../sim';
import { fadeIntent, stillIntent } from './fade';
import { dequantizeIntent, quantizeIntent } from './intentCodec';
import type { SnapEvent, SnapMsg } from './protocol';

/** Further ahead of its base state than this (a reload mid-Match, a long stall), the prediction waits for a Snapshot. */
export const MAX_PREDICT_TICKS = 60;
/** Events told are remembered this many Ticks behind the newest Snapshot, long enough for the Court's copy to come. */
const TOLD_TICKS = 60;

/** Events to show, with the state they came in. */
export interface Told {
  state: SimState;
  events: SnapEvent[];
}

/** A stamped Tick: the Intent to send for it, and the events its prediction made. */
export interface Stamped {
  /** The Intent as the Court will step it: quantized, with `contact` set if the prediction hits on this Tick. */
  intent: Intent;
  told: Told[];
}

/** What a Snapshot did to the prediction. */
export interface Reconciled {
  /** How far the local Player's predicted position moved, ground plane (m). */
  correction: { x: number; z: number };
  /** What to show now: the Snapshot's events this screen hasn't told already, then any the re-simulation newly made. */
  told: Told[];
}

export interface Predictor {
  /** The predicted states either side of the newest predicted Tick. */
  readonly prev: SimState;
  readonly curr: SimState;
  /** The guess at the remote Player's Intent: their last one the Court stepped, with no shot and no Contact. */
  readonly guess: Intent;
  /**
   * The local Player's Intent for Tick `tick`, to stamp for the Court. Reports Contact on it if the prediction hits on
   * that Tick, steps the prediction through it, and returns the Intent to send with the events to show at once.
   */
  stamp(tick: number, intent: Intent): Stamped;
  /** A Snapshot: re-simulates from its state through every Tick stamped since. */
  reconcile(snap: Pick<SnapMsg, 'state' | 'last' | 'events'>): Reconciled;
}

/**
 * Predicts the local Player and the ball from the last Snapshot. The local Player steps with the Intents this client
 * stamped, quantized as the Court will step them (a Tick with none fades as on the Court). The remote Player steps
 * with a guess, which every Snapshot replaces with the truth. The Snapshot's `rng` comes along, so even a net cord
 * predicts exactly.
 *
 * Reported Contact (ADR-0004): each Tick stamped calls the local Player's hit by the rule the Court's Sim would use in
 * `auto` (`autoContact`), on the predicted state, and sends it as the Intent's `contact`. The Court steps the same
 * Intent from the same state, so it confirms the hit on the same Tick; one it can't confirm (the report came too late
 * to rewind for, or the Court's state differed) a Snapshot corrects, and the re-simulation never hits again, because
 * a `reported` hit fires only on the Tick reported. While the prediction waits for a Snapshot (`MAX_PREDICT_TICKS`), it
 * calls no hits. The remote Player is guessed to call their hits the same way.
 *
 * Events: the local Player's `hit`, a `bounce` on the local half and `net` are told from the prediction the moment
 * they're predicted; every other event, the outcomes and the Fault included, only from the Court. Events are keyed by
 * Tick, kind and Side, so the Court's copy of one already told, or a re-simulation making it again, is not told twice.
 */
export function createPredictor(opts: { local: SideIndex; start: SimState; tuning: SimTuning }): Predictor {
  const { local, tuning } = opts;
  const remote = other(local);
  let prev = opts.start;
  let curr = opts.start;
  /** The Tick after the last one stamped: where the prediction runs to. */
  let head = opts.start.tick;
  let guess = stillIntent();
  /** The local Intents stamped, quantized, by Tick: from the newest before the last Snapshot's state on. */
  const stamped = new Map<number, Intent>();
  /** Keys of the predictable events told, with their Ticks. */
  const toldKeys = new Map<string, number>();

  /** The local Intent for Tick `tick`: the one stamped, or the Court's fade from the last one before. */
  const localAt = (tick: number): Intent => {
    const intent = stamped.get(tick);
    if (intent) return intent;
    let last = -1;
    for (const t of stamped.keys()) if (t < tick && t > last) last = t;
    return last < 0 ? stillIntent() : fadeIntent(stamped.get(last)!, tick - last);
  };

  /** Whether this screen tells `e` from its own prediction. */
  const predictable = (e: SnapEvent, s: SimState) =>
    e.kind === 'net' || (e.kind === 'hit' && e.side === local) || (e.kind === 'bounce' && endOfZ(e.pos.z) === endOf(s, local));

  /** Marks `e` told, returning false if it already was. */
  const tell = (e: SnapEvent) => {
    const key = `${e.tick} ${e.kind} ${e.kind === 'hit' ? e.side : ''}`;
    if (toldKeys.has(key)) return false;
    toldKeys.set(key, e.tick);
    return true;
  };

  /**
   * Whether `side` hits from `s` on this step by the `auto` rule: the Contact to report. `checkContact` skips a Player
   * with no Commit after the step's presses, so with none and no press now the probe step is skipped.
   */
  const callsHit = (s: SimState, intents: readonly [Intent, Intent], side: SideIndex) =>
    (s.sides[side].players[0].commit !== null || intents[side].shot !== null) && autoContact(s, intents, side, tuning);

  /** Both Sides' Intents for the step from `curr`: the local one stamped, and the guess, calling its own hits. */
  const intentsNow = (): [Intent, Intent] => {
    const intents: [Intent, Intent] = [guess, guess];
    intents[local] = localAt(curr.tick);
    if (callsHit(curr, intents, remote)) intents[remote] = { ...guess, contact: true };
    return intents;
  };

  /** Steps the prediction to `head`, unless that's too far to catch up. */
  const advance = (): Told[] => {
    const out: Told[] = [];
    if (head - curr.tick > MAX_PREDICT_TICKS) return out;
    while (curr.tick < head && curr.phase !== 'over') {
      const intents = intentsNow();
      prev = curr;
      curr = step(curr, intents, tuning);
      const s = curr;
      const events = s.events.map((e) => ({ ...e, tick: s.tick })).filter((e) => predictable(e, s) && tell(e));
      if (events.length > 0) out.push({ state: s, events });
    }
    return out;
  };

  return {
    get prev() {
      return prev;
    },
    get curr() {
      return curr;
    },
    get guess() {
      return guess;
    },
    stamp(tick, intent) {
      // Up to `tick` first, fading any Ticks skipped, so the hit is called from the state the Tick steps from.
      head = Math.max(head, tick);
      const told = advance();
      let wire = dequantizeIntent(quantizeIntent({ ...intent, contact: false }));
      if (curr.tick === tick) {
        const intents = intentsNow();
        intents[local] = wire;
        if (callsHit(curr, intents, local)) wire = { ...wire, contact: true };
      }
      stamped.set(tick, wire);
      head = Math.max(head, tick + 1);
      told.push(...advance());
      return { intent: wire, told };
    },
    reconcile(snap) {
      const before = curr.sides[local].players[0].pos;
      const base = snap.state;
      prev = curr = base;
      head = Math.max(head, base.tick);
      const { move, aim } = dequantizeIntent(snap.last[remote]);
      guess = { move, aim, shot: null };

      // Keep the stamped Intents from the base on, and the newest before it for a fade.
      const older = [...stamped.keys()].filter((t) => t < base.tick);
      const newest = Math.max(...older);
      for (const t of older) if (t !== newest) stamped.delete(t);
      for (const [key, t] of toldKeys) if (t < base.tick - TOLD_TICKS) toldKeys.delete(key);

      const fromCourt = snap.events.filter((e) => !predictable(e, base) || tell(e));
      const out: Told[] = fromCourt.length > 0 ? [{ state: base, events: fromCourt }] : [];
      out.push(...advance());
      const after = curr.sides[local].players[0].pos;
      return { correction: { x: after.x - before.x, z: after.z - before.z }, told: out };
    },
  };
}
