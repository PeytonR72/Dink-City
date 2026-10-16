import { createBot, DIFFICULTY, NEUTRAL, type Bot } from '../bot/bot';
import { observe } from '../bot/observe';
import { type Intent, type SideIndex, type SimState, type SimTuning, type Vec2 } from '../sim';
import type { Swing } from '../net/controller';
import { motionTuning, type MotionTuning } from './motionTuning';

/** Motion's only route into the Sim is an Intent. Bot footwork sees only an Observation. */
export class MotionSource {
  private bot: Bot | null = null;
  private side: SideIndex = 0;
  private lastTick = -1;
  // Event handoff to the next input sample only: never a future hit window or a list of swings.
  private pending: Swing | null = null;
  private lastSwingAt = -Infinity;
  private aim: Vec2 = { x: 0, y: 0 };
  constructor(private sim: SimTuning, private tuning: MotionTuning = motionTuning) {}
  swing(s: Swing) {
    if (!Number.isFinite(s.at) || s.at <= this.lastSwingAt) return;
    this.lastSwingAt = s.at; this.pending = s;
  }
  tilt(aim: Vec2) { this.aim = { x: aim.x, y: 0 }; }
  // Remember consumed/cancelled timestamps so a repeated delivery cannot revive a swing.
  clear() { this.pending = null; }
  reset() { this.clear(); this.bot = null; this.lastTick = -1; this.lastSwingAt = -Infinity; this.aim = { x: 0, y: 0 }; }
  sample(s: SimState, side: SideIndex, keys: Intent, now: number): Intent {
    if (!this.bot || this.side !== side || s.tick < this.lastTick) {
      this.side = side;
      const tuning = this.tuning;
      this.bot = createBot(side, 0x51a9 + side, {
        ...DIFFICULTY.hard, lateCommit: 0, offCenter: 0, unforcedError: 0,
        get moveSpeed() { return tuning.autoMoveSpeed; },
        get reactionTicks() { return tuning.autoCommitReactionTicks; },
      }, this.sim, NEUTRAL);
    }
    this.lastTick = s.tick;
    const footwork = this.bot.think(observe(s, side));
    const move = keys.move.x || keys.move.y ? keys.move : footwork.move;
    // Preparation affects footwork/shot quality only. Reported mode cannot hit without contact=true.
    let shot: Intent['shot'] = s.phase === 'rally' && s.ball.lastHitBy !== side && footwork.shot ? 'soft' : null;
    let contact = false;
    const swing = this.pending;
    this.pending = null; // Consume even on a miss, an interruption, or a future/stale timestamp.
    if (swing) {
      const age = now - swing.at;
      // Timestamps reject stale packets; they never schedule, extend or rewind contact.
      // A little clock-estimation skew is accepted immediately, never held for a future tick.
      if (age >= -100 && age <= this.tuning.maxSwingAgeMs) {
        this.aim = { x: swing.aim.x, y: 0 };
        if (s.phase === 'serve' || s.phase === 'over') shot = swing.type;
        else if (s.phase === 'rally' && s.ball.lastHitBy !== side) {
          shot = swing.type; contact = true;
        }
      }
    }
    return { move, aim: { ...this.aim }, shot, contact };
  }
}
