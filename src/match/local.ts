// An offline Match or Practice: the local Player against a Bot, stepped on this machine. Owns the Tick
// accumulator, hit-stop, Game speed and the Fault Replay, all presentation only (ADR-0001).
import type { Bot } from '../bot/bot';
import { observe } from '../bot/observe';
import type { Practice } from '../practice/practice';
import { createReplay, type Replay } from '../replay/replay';
import { DEFAULT_MATCH, TICK, createInitialState, other, step, type Intent, type SideIndex, type SimState, type SimTuning } from '../sim';
import type { ViewTuning } from '../tuning';
import type { MatchDriver, MatchView } from './driver';

export interface LocalMatchOptions {
  sim: SimTuning;
  viewTuning: ViewTuning;
  view: MatchView;
  /** Samples the local Player's Intent. Called once per Tick, and once per Replay frame to skip it. */
  input: () => Intent;
  /** A shot pressed once the Match is over: start the next one (with `startMatch`). */
  rematch: () => void;
}

/** Drives an offline Match or Practice: the local Player on Side 0, the Bot or ball machine on Side 1. */
export class LocalMatch implements MatchDriver {
  /** The local Player's Side. The Bot plays the other. */
  readonly local: SideIndex = 0;
  prev!: SimState;
  curr!: SimState;
  /** The Venue's Bot, or the ball machine in Practice mode. */
  bot!: Bot;
  /** Practice mode's steps and reps, or null in a Match. */
  practice: Practice | null = null;
  /** The current Rally's start state and every Tick's Intents since: enough to replay it. */
  rally!: { start: SimState; intents: [Intent, Intent][] };
  /** The Fault Replay playing, or waiting `replayIn` seconds to start. */
  replay: Replay | null = null;
  private replayIn = 0;
  private acc = 0;
  /** Seconds of hit-stop left. Presentation only: the Sim just isn't stepped meanwhile (ADR-0001). */
  private hitStop = 0;

  constructor(private opts: LocalMatchOptions) {}

  /** A new Match from `state` against `bot`. */
  startMatch(state: SimState, bot: Bot) {
    this.bot = bot;
    this.curr = this.prev = state;
    this.rally = { start: this.curr, intents: [] };
    this.practice = null;
    this.endReplay();
  }

  /** Practice mode: `machine` plays the other Side, and there is no score. */
  startPractice(practice: Practice, machine: Bot) {
    this.practice = practice;
    this.bot = machine;
    this.newRep();
    this.endReplay();
  }

  /** Each rep is a fresh Rally, served by whoever the step says. */
  private newRep() {
    this.curr = this.prev = createInitialState(Date.now() >>> 0, DEFAULT_MATCH, this.practice!.step.server);
  }

  /** Steps one Tick. `local` overrides the local Player's input. */
  tick(local: Intent = this.opts.input()) {
    const { sim, viewTuning: tuning, view } = this.opts;
    if (this.curr.phase === 'over') {
      if (local.shot) this.opts.rematch();
      return;
    }
    const intents: [Intent, Intent] = [local, this.bot.think(observe(this.curr, other(this.local)))];
    this.prev = this.curr;
    this.curr = step(this.curr, intents, sim);
    if (this.curr.phase === 'serve' && this.prev.phase !== 'serve') {
      if (this.practice) this.newRep();
      this.rally = { start: this.curr, intents: [] };
    } else this.rally.intents.push(intents);

    const { curr } = this;
    view.tick(curr, curr.events);
    for (const e of curr.events) {
      if (e.kind === 'hit' && (e.variant === 'smash' || e.speed >= tuning.hitStopSpeed)) this.hitStop = tuning.hitStopMs / 1000;
      // A double bounce is a winner, not a rule break, so it gets no Replay. In Practice only the Player's Faults do.
      if (e.kind === 'dead' && e.reason !== 'double-bounce' && !(this.practice && e.loser !== this.local)) {
        this.replay = createReplay({ start: this.rally.start, intents: this.rally.intents.slice() }, sim, {
          seconds: tuning.replaySeconds,
          speed: tuning.replaySpeed,
          hold: tuning.replayHold,
        });
        this.replayIn = tuning.replayDelay;
      }
    }
  }

  frame(dt: number) {
    if (this.playReplay(dt)) return;
    if (this.hitStop > 0) this.hitStop -= dt;
    else this.acc += dt * this.opts.viewTuning.gameSpeed;

    while (this.acc >= TICK && this.hitStop <= 0) {
      this.tick();
      this.acc -= TICK;
    }

    this.opts.view.draw(this.prev, this.curr, this.acc / TICK, this.curr, dt);
  }

  private endReplay() {
    if (!this.replay) return;
    this.replay = null;
    this.opts.view.replay(false);
  }

  /** Plays the Fault Replay once its delay is up. The Match waits meanwhile. Returns whether it drew the frame. */
  private playReplay(dt: number): boolean {
    const { replay } = this;
    const { view } = this.opts;
    if (!replay) return false;
    if (this.replayIn > 0) {
      this.replayIn -= dt;
      // The live Match plays on through the dead pause, but never into the next Serve.
      if (this.replayIn > 0 && this.curr.phase === 'dead') return false;
      this.replayIn = 0;
      view.replay(true);
    }
    if (this.opts.input().shot) replay.skip();
    replay.advance(dt);
    view.replayed(replay.curr, replay.events);
    view.draw(replay.prev, replay.curr, replay.alpha, this.curr, dt);
    if (replay.done) {
      this.endReplay();
      this.skipDeadPause();
    }
    return true;
  }

  /**
   * Plays out the rest of the dead pause unseen, so a Replay cuts back in at the next Serve (where the Players are
   * placed anyway) rather than mid pause, with everyone jumped from where the Fault left them.
   */
  private skipDeadPause() {
    const still: Intent = { move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, shot: null };
    while (this.curr.phase === 'dead') this.tick(still);
    this.prev = this.curr;
    this.acc = 0;
  }
}
