// Practice mode: a ball machine on Side 1 feeds shots while step-by-step prompts teach the Two-bounce rule and
// Kitchen faults. The machine is a precise Bot whose Intents are edited, so it only ever feeds through the
// Intent interface (ADR-0003). There is no score: each rep is a fresh Rally, judged from its events.
import { DIFFICULTY, createBot, type Difficulty } from '../bot/bot';
import type { Observation } from '../bot/observe';
import { faultText } from '../hud/faultText';
import type { Intent, ShotType, SideIndex, SimEvent, SimTuning } from '../sim';

type Hit = Extract<SimEvent, { kind: 'hit' }>;

export interface PracticeStep {
  id: 'return' | 'third' | 'volley' | 'dink' | 'free';
  title: string;
  prompt: string;
  /** Who serves each rep. */
  server: SideIndex;
  /**
   * The machine's Shot type for each Rally hit it plays, by hit number (1 is the Serve). It lets every other
   * ball go. Null in free play, where it rallies on its own.
   */
  feeds: Record<number, ShotType> | null;
  /** The hit number of the Player's shot that the step is about. */
  target: number;
  /** Why that shot doesn't count (it was legal but not the skill asked for), or null when it does. */
  check(shot: Hit): string | null;
}

export const PRACTICE_STEPS: PracticeStep[] = [
  {
    id: 'return',
    title: 'Return of serve',
    prompt: 'The machine serves. Let it bounce, then hit it back. Volleying the serve is a Two-bounce fault.',
    server: 1,
    feeds: { 1: 'soft' },
    target: 2,
    check: () => null,
  },
  {
    id: 'third',
    title: 'Third shot',
    prompt: 'You serve (J or K). The return has to bounce too: let it bounce before you hit it.',
    server: 0,
    feeds: { 2: 'drive' },
    target: 3,
    check: () => null,
  },
  {
    id: 'volley',
    title: 'Volley',
    prompt: 'Return the serve, then move up to the Kitchen line. Volley the next ball before it bounces, feet behind the line.',
    server: 1,
    feeds: { 1: 'soft', 3: 'drive' },
    target: 4,
    check: (shot) => (shot.volley ? null : 'Hit it before it bounces: move up to the Kitchen line and volley.'),
  },
  {
    id: 'dink',
    title: 'Dink',
    prompt: 'Return and move up. The machine drops the next ball into the Kitchen: let it bounce, step in if you must, and dink it back with Soft (J).',
    server: 1,
    feeds: { 1: 'soft', 3: 'soft' },
    target: 4,
    check: (shot) => (shot.variant === 'dink' ? null : 'Use Soft (J) from the Kitchen line for a dink.'),
  },
  {
    id: 'free',
    title: 'Free play',
    prompt: 'Rally with the machine as long as you like. Esc to leave.',
    server: 1,
    feeds: null,
    target: 0,
    check: () => null,
  },
];

/** Good reps to pass a step. */
export const REPS_TO_PASS = 3;

export interface Outcome {
  /** A good rep, a legal shot that wasn't the skill asked for (or a machine miss), or a Fault. */
  kind: 'good' | 'miss' | 'fault';
  title: string;
  detail: string;
  /** This rep passed the step. */
  passed?: boolean;
}

/** The step, the reps so far, and the judging of each rep. */
export class Practice {
  private index = 0;
  reps = 0;
  /** This Rally's hits so far. */
  private hits: Hit[] = [];

  get step(): PracticeStep {
    return PRACTICE_STEPS[this.index];
  }

  get stepNumber(): number {
    return this.index + 1;
  }

  skipTo(index: number) {
    this.index = Math.max(0, Math.min(PRACTICE_STEPS.length - 1, index));
    this.reps = 0;
    this.hits = [];
  }

  /** Feeds one Tick's events. Returns the rep's Outcome when its Rally ends, otherwise null. */
  onEvents(events: readonly SimEvent[]): Outcome | null {
    let outcome: Outcome | null = null;
    for (const e of events) {
      if (e.kind === 'hit') this.hits.push(e);
      if (e.kind !== 'dead') continue;
      outcome = this.judge(e);
      this.hits = [];
    }
    return outcome;
  }

  private judge(dead: Extract<SimEvent, { kind: 'dead' }>): Outcome | null {
    const step = this.step;
    if (dead.loser === 0) {
      if (dead.reason === 'double-bounce') return { kind: 'miss', title: 'MISSED', detail: 'Get to the ball before it bounces twice.' };
      return { kind: 'fault', ...faultText(dead.reason, true) };
    }
    if (step.id === 'free') return null;
    const shot = this.hits[step.target - 1];
    if (!shot || shot.side !== 0) return { kind: 'miss', title: 'AGAIN', detail: 'The machine missed. Go again.' };
    const why = step.check(shot);
    if (why) return { kind: 'miss', title: 'NOT QUITE', detail: why };

    this.reps++;
    if (this.reps < REPS_TO_PASS) return { kind: 'good', title: 'NICE!', detail: `${this.reps} of ${REPS_TO_PASS}.` };
    this.skipTo(this.index + 1);
    return { kind: 'good', title: 'STEP PASSED!', detail: `Next: ${this.step.title}.`, passed: true };
  }
}

/** A precise machine: no mistakes, quick and steady. */
const MACHINE: Difficulty = { ...DIFFICULTY.hard, lateCommit: 0, offCenter: 0, unforcedError: 0, aimNoise: 0, kitchenDiscipline: 1 };

/** The ball machine: a Bot whose shot presses follow the current step's feeds, aimed down the middle. */
export function createMachine(seed: number, t: SimTuning, step: () => PracticeStep) {
  const bot = createBot(1, seed, MACHINE, t);
  return {
    plan: bot.plan,
    think(o: Observation): Intent {
      const intent = bot.think(o);
      const { feeds } = step();
      if (!intent.shot || !feeds) return intent;
      const shot = feeds[o.shots + 1] ?? null;
      // A Soft feed goes short (a drop into the Kitchen); everything else to the middle.
      return { ...intent, shot, aim: { x: 0, y: shot === 'soft' && o.shots > 0 ? -0.4 : 0 } };
    },
  };
}
