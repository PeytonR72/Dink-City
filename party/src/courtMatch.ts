// The Court's Match engine, pure: everything the Court does per Tick, with no Durable Object and no clock. The
// Court decides when to step (`tickLoop`) and who to send to. Each Side's Intents wait here for their Tick, or come
// from the Takeover Bot once its Player is gone.
import { DIFFICULTY, NEUTRAL, createBot, type Bot } from '../../src/bot/bot';
import { observe } from '../../src/bot/observe';
import { dequantizeIntent, onlineConfig, fadeIntent, stillIntent, quantizeIntent, type CourtMsg, type InMsg, type PresetId, type QIntent, type SnapEvent } from '../../src/net';
import { autoContact, createInitialState, step, type Intent, type SideIndex, type SimState, type SimTuning } from '../../src/sim';

/** A Snapshot goes out once this many Ticks have run since the last one: 30 Hz. */
const SNAP_TICKS = 2;
/** Intents labeled further ahead of the Court than this are refused. A client leads by at most 15. */
export const MAX_AHEAD_TICKS = 30;
/** The Rewind window: an Intent this many Ticks late still lands on its Tick. */
export const REWIND_TICKS = 15;
/** The ring buffer keeps this many past states, twice the window. */
const HISTORY_TICKS = 30;

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
  /**
   * The Player's grace ran out: the Takeover Bot plays their Side for the rest of the Match. Once both Players are
   * gone, nothing steps: a Bot never plays a Bot.
   */
  gone(side: SideIndex): void;
  /** Runs `ticks` steps. Returns a Snapshot for each Side if one is due, then `over` if the Match ended. */
  advance(ticks: number): Outgoing[];
  /** For a Player who reloads: a Snapshot of the current state with no events, then `over` if the Match ended. */
  current(side: SideIndex): CourtMsg[];
}

/** One Side's incoming Intents. */
interface Feed {
  /** Its client's Intents by Tick, from the oldest the ring buffer holds to the furthest ahead. */
  received: Map<number, Intent>;
  /** The last Tick up to which every Intent has arrived (or been given up by the client); -1 before any. */
  ack: number;
  /** The Takeover Bot, once the Player's grace ran out. */
  takeover: Takeover | null;
}

/**
 * The Bot playing a gone Player's Side from Tick `at` on. It thinks once per Tick, the first time the Tick is stepped;
 * its memory lives in a closure, so a re-step replays the `move`, `aim` and `shot` it logged, and only `contact` is
 * worked out again, from the state being stepped.
 */
interface Takeover {
  at: number;
  bot: Bot;
  log: Map<number, Intent>;
}

/** The missing-input policy's memory for one Side: the last real Intent stepped, and how many Ticks since had none. */
interface Fill {
  last: Intent;
  missing: number;
}

/** The ring buffer's entry for one Tick: the state stepped from, each Side's Fill before it, and how it was stepped. */
interface Past {
  tick: number;
  state: SimState;
  fills: readonly [Fill, Fill];
  intents: readonly [Intent, Intent];
}

/**
 * Each Side steps Tick T with the Intent its client labeled T. An `in` carries a run of Ticks from the oldest the
 * client hasn't had acknowledged, so a run starting past `ack + 1` means the client gave up the Ticks between, and
 * `ack` jumps over them. A Tick with no Intent repeats the last move and aim with no shot and no Contact, the move
 * fading to nothing over `DECAY_TICKS`, so a stalled or hidden tab stops. A Side with no input yet stands still.
 *
 * Reported Contact (ADR-0004): both Sides are `reported` for the whole Match, so a Player hits only on a Tick whose
 * Intent carries `contact`, from their own client. The Sim itself checks the report: the Player must be Committed, the
 * ball theirs to hit and within reach plus `REACH_SLACK`, or nothing happens. The Court's only part is timing: a report
 * inside the Rewind window rewinds like any late Intent, and one older is dropped, so the ball flies on. A filled-in
 * Tick never carries `contact`.
 *
 * The Rewind window: an Intent up to `REWIND_TICKS` late replaces the fill, and the next `advance` re-steps from its
 * Tick, so the Match comes out as if it had come on time. Older ones are dropped. Moment events go out at once and are
 * never told twice; outcome events wait until no rewind can change them (see `stepOnce`).
 *
 * The Takeover Bot (ADR-0004): once a Player is `gone`, a medium, neutral Bot plays their Side (`Takeover`). Its Side
 * stays `reported`, and it reports Contact as a client does, by the `auto` rule on the state stepped, so after a
 * rewind it still meets a ball a late hit sent elsewhere, though it moves as it chose before it knew, up to the window
 * stale.
 */
export function createCourtMatch(opts: {
  seed: number;
  preset: PresetId;
  tuning: SimTuning;
  /** Watches each step, re-steps included: the Tick stepped from and both Sides' Intents. */
  onStep?: (tick: number, intents: readonly [Intent, Intent]) => void;
  /** Makes the Takeover Bot: by default a medium one with the neutral Personality. */
  bot?: (side: SideIndex, seed: number) => Bot;
}): CourtMatch {
  const makeBot = opts.bot ?? ((side, seed) => createBot(side, seed, DIFFICULTY.medium, opts.tuning, NEUTRAL));
  let state = createInitialState(opts.seed, onlineConfig(opts.preset));
  const feeds: [Feed, Feed] = [feed(), feed()];
  let fills: readonly [Fill, Fill] = [fill(), fill()];
  /** By Tick modulo `HISTORY_TICKS`. */
  const history: Past[] = [];
  /** The oldest Tick a late Intent asks to re-step from, if any. */
  let rewindFrom: number | null = null;
  /** Moment events waiting for the next Snapshot. */
  let outbox: SnapEvent[] = [];
  /** Moment events told, as far back as a rewind can reach. */
  let told: Told[] = [];
  /** Told moment events that no event in the current timeline stands for: owed. */
  let unmatched: Told[] = [];
  /** Outcome events not sent yet, waiting until they're final. */
  let held: SnapEvent[] = [];
  let snapTick = 0;
  /** The Intents the last Tick was stepped with, for the Snapshot's `last`. */
  let lastIntents: readonly [Intent, Intent] = [stillIntent(), stillIntent()];
  const over = () => state.phase === 'over';
  /** Both Players are gone: the Match stops where it is, and the Court closes. */
  const abandoned = () => feeds.every((f) => f.takeover !== null);
  /** A Snapshot for `side`, followed by `over` once the Match has a winner. */
  const snapFor = (side: SideIndex, evs: SnapEvent[]): CourtMsg[] => {
    const last: [QIntent, QIntent] = [quantizeIntent(lastIntents[0]), quantizeIntent(lastIntents[1])];
    const snap: CourtMsg = { t: 'snap', tick: state.tick, ack: feeds[side].ack, state, last, events: evs };
    const winner = state.match.winner;
    return over() && winner !== null ? [snap, { t: 'over', winner }] : [snap];
  };

  /**
   * Steps one Tick from `state`, buffering it, and sorts out its events. The moment ones (`hit`, `bounce`, `net`) go
   * out in the next Snapshot, unless a told one stands for them: a rewind matches the events told from the Ticks it
   * re-steps, in order, by kind and Side, against the new ones. A told event no new one matches is never taken back
   * (clients already played its sound); it stays owed, and absorbs the next like event while it's inside the window,
   * usually the same one a few Ticks on. The cost: an owed `bounce` can swallow a different bounce's sound. The
   * outcome events (`dead`, `rally-won`, `game`, `match`) are held until they're older than the window, so clients
   * hear them `REWIND_TICKS` late but only ever the true one. A Snapshot's events are in Tick order.
   */
  const stepOnce = () => {
    const tick = state.tick;
    const a = intentFor(feeds[0], fills[0], tick);
    const b = intentFor(feeds[1], fills[1], tick);
    const intents: [Intent, Intent] = [botIntent(0, tick) ?? a.intent, botIntent(1, tick) ?? b.intent];
    for (const side of [0, 1] as const) if (playing(side, tick)) intents[side] = { ...intents[side], contact: callsHit(state, intents, side) };
    history[tick % HISTORY_TICKS] = { tick, state, fills, intents };
    fills = [a.fill, b.fill];
    lastIntents = intents;
    opts.onStep?.(tick, intents);
    state = step(state, intents, opts.tuning);
    for (const e of state.events) {
      const ev: SnapEvent = { ...e, tick: state.tick };
      if (OUTCOMES.has(ev.kind)) {
        held.push(ev);
        continue;
      }
      const i = unmatched.findIndex((r) => r.kind === ev.kind && r.side === sideOf(ev));
      if (i >= 0) unmatched.splice(i, 1)[0]!.at = ev.tick;
      else outbox.push(ev);
    }
  };

  /** Whether the Takeover Bot plays `side` on Tick `tick`. */
  const playing = (side: SideIndex, tick: number) => {
    const t = feeds[side].takeover;
    return t !== null && tick >= t.at;
  };

  /** The Takeover Bot's `move`, `aim` and `shot` for Tick `tick` on `side`, if it plays it: logged, or thought now. */
  const botIntent = (side: SideIndex, tick: number): Intent | null => {
    const t = feeds[side].takeover;
    if (t === null || !playing(side, tick)) return null;
    let intent = t.log.get(tick);
    if (intent === undefined) {
      // Through the wire format, as a client's would be.
      intent = dequantizeIntent(quantizeIntent(t.bot.think(observe(state, side))));
      t.log.set(tick, intent);
    }
    return intent;
  };

  /**
   * Whether `side` hits from `s` on this step by the `auto` rule. The Sim skips a Player with no Commit after the
   * step's presses, so with none and no press now the probe step is skipped.
   */
  const callsHit = (s: SimState, intents: readonly [Intent, Intent], side: SideIndex) =>
    (s.sides[side].players[0].commit !== null || intents[side].shot !== null) && autoContact(s, intents, side, opts.tuning);

  /** Goes back to the state before Tick `from` and re-steps to the Tick it was on. */
  const rewind = (from: number) => {
    const past = history[from % HISTORY_TICKS];
    // `receive` only asks for Ticks inside the window, which the buffer always holds.
    if (past?.tick !== from) throw new Error(`no buffered state for Tick ${from}`);
    const to = state.tick;
    state = past.state;
    fills = past.fills;
    // The re-stepped Ticks' events come again: the outcomes and untold moments are dropped, the told ones matched.
    held = held.filter((e) => e.tick <= from);
    outbox = outbox.filter((e) => e.tick <= from);
    unmatched = told.filter((e) => e.at > from || unmatched.includes(e));
    while (state.tick < to && !over()) stepOnce();
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
      if (over() || f.takeover !== null || msg.from > limit) return;
      f.ack = Math.max(f.ack, msg.from - 1);
      msg.intents.forEach((q, i) => {
        const tick = msg.from + i;
        if (tick <= f.ack || tick > limit) return;
        f.ack = tick;
        if (tick < state.tick - REWIND_TICKS) return;
        f.received.set(tick, dequantizeIntent(q));
        if (tick < state.tick) rewindFrom = Math.min(rewindFrom ?? tick, tick);
      });
    },
    disconnect(side) {
      dropIntents(feeds[side], (tick) => tick >= state.tick);
      feeds[side].ack = -1;
    },
    gone(side) {
      // The Court says so again on every later grace expiry; the first takeover stays, so a rewind re-steps the same.
      feeds[side].takeover ??= { at: state.tick, bot: makeBot(side, (opts.seed ^ BOT_SEED ^ side) >>> 0), log: new Map() };
    },
    advance(ticks) {
      if (over() || abandoned()) return [];
      if (rewindFrom !== null) rewind(rewindFrom);
      rewindFrom = null;
      for (let i = 0; i < ticks && !over(); i++) stepOnce();
      for (const f of feeds) {
        dropIntents(f, (tick) => tick < state.tick - HISTORY_TICKS);
        const log = f.takeover?.log;
        for (const tick of log?.keys() ?? []) if (tick < state.tick - HISTORY_TICKS) log!.delete(tick);
      }
      if (state.tick - snapTick < SNAP_TICKS && !over()) return [];
      snapTick = state.tick;
      // Outcomes are final once no rewind can reach them, or once the Match is over.
      const final = held.filter((e) => over() || e.tick <= state.tick - REWIND_TICKS);
      held = held.filter((e) => !final.includes(e));
      const events = outbox.concat(final).sort((x, y) => x.tick - y.tick);
      const reach = state.tick - REWIND_TICKS;
      told = told.concat(outbox.map((e) => ({ kind: e.kind, side: sideOf(e), at: e.tick }))).filter((e) => e.at > reach);
      unmatched = unmatched.filter((e) => e.at > reach);
      outbox = [];
      return ([0, 1] as const).flatMap((side) => snapFor(side, events).map((msg) => ({ side, msg })));
    },
    current(side) {
      return snapFor(side, []);
    },
  };
}

/** Mixed into the Match's seed for the Takeover Bot's. */
const BOT_SEED = 0x7a6e;

const OUTCOMES: ReadonlySet<SnapEvent['kind']> = new Set(['dead', 'rally-won', 'game', 'match']);

/** A moment event told to clients: what it was, and the Tick of the event in the current timeline it stands for. */
interface Told {
  kind: SnapEvent['kind'];
  side: SideIndex | null;
  at: number;
}

/** The Side an event belongs to, for matching re-simulated events with told ones. */
function sideOf(e: SnapEvent): SideIndex | null {
  return e.kind === 'hit' ? e.side : null;
}

/**
 * The Intent a Side's client gives Tick `tick`, and the Fill after it: the client's Intent, or the missing-input fill.
 * A pure function of the Feed and the Fill before, so a re-simulation repeats it.
 */
function intentFor(f: Feed, before: Fill, tick: number): { intent: Intent; fill: Fill } {
  const intent = f.received.get(tick);
  if (intent) return { intent, fill: { last: intent, missing: 0 } };
  const missing = before.missing + 1;
  return { intent: fadeIntent(before.last, missing), fill: { last: before.last, missing } };
}

function dropIntents(f: Feed, which: (tick: number) => boolean) {
  for (const tick of f.received.keys()) if (which(tick)) f.received.delete(tick);
}

function feed(): Feed {
  return { received: new Map(), ack: -1, takeover: null };
}

function fill(): Fill {
  return { last: stillIntent(), missing: 0 };
}
