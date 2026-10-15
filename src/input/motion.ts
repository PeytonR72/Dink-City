import { createBot, DIFFICULTY, NEUTRAL, type Bot } from '../bot/bot';
import { observe } from '../bot/observe';
import { TICK, type Intent, type SideIndex, type SimState, type SimTuning, type Vec2 } from '../sim';
import type { Swing } from '../net/controller';
import { motionTuning, type MotionTuning } from './motionTuning';

/** Motion's only route into the Sim is an Intent. Bot footwork sees only an Observation. */
export class MotionSource {
  private bot: Bot | null = null;
  private side: SideIndex = 0;
  private lastTick = -1;
  private phase = '';
  private shots = -1;
  private queued: Swing | null = null;
  private active: { swing: Swing; ticks: number } | null = null;
  private aim: Vec2 = { x: 0, y: 0 };
  constructor(private sim: SimTuning, private tuning: MotionTuning = motionTuning) {}
  swing(s: Swing) { this.queued = s; }
  tilt(aim: Vec2) { this.aim = { x: aim.x, y: 0 }; }
  clear() { this.queued = null; this.active = null; }
  reset() { this.clear(); this.bot = null; this.lastTick = -1; this.aim = { x: 0, y: 0 }; }
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
    if (s.phase !== this.phase || s.shots !== this.shots) this.active = null;
    this.phase = s.phase; this.shots = s.shots; this.lastTick = s.tick;
    const footwork = this.bot.think(observe(s, side));
    const move = keys.move.x || keys.move.y ? keys.move : footwork.move;
    let shot: Intent['shot'] = s.phase === 'rally' && s.ball.lastHitBy !== side && footwork.shot ? 'soft' : null;
    let contact = false;
    if (this.queued) {
      const swing = this.queued;
      const age = now - swing.at;
      if (age > this.tuning.maxSwingAgeMs || age < -1000 || s.phase === 'dead') this.queued = null;
      else if (age + this.tuning.swingLeadMs >= 0) {
        this.queued = null;
        this.aim = { x: swing.aim.x, y: 0 };
        if (s.phase === 'serve' || s.phase === 'over') shot = swing.type;
        else if (s.phase === 'rally' && s.ball.lastHitBy !== side) {
          // Never replay a stale network swing in a later rally. Lead restores a bounded amount of transport age.
          const lost = Math.floor(Math.max(0, age - this.tuning.swingLeadMs) / (TICK * 1000));
          this.active = { swing, ticks: Math.max(0, Math.round(this.tuning.swingWindowTicks) - lost) };
        }
      }
    }
    if (this.active && this.active.ticks > 0 && s.phase === 'rally' && s.ball.lastHitBy !== side) {
      shot = this.active.swing.type; this.aim = { x: this.active.swing.aim.x, y: 0 }; contact = true;
      this.active.ticks--;
    }
    return { move, aim: { ...this.aim }, shot, contact };
  }
}
