// A Bot produces Intents only, from an Observation (ADR-0003). It predicts the
// ball with its own noisy estimate and keeps its seeded RNG in this closure,
// so it is deterministic but lives outside the Sim state.
import {
  HALF_LENGTH,
  HALF_WIDTH,
  KITCHEN_DEPTH,
  TICK,
  endOfZ,
  facing,
  localToWorld,
  worldToLocal,
  type Ball,
  type Intent,
  type ShotType,
  type SideIndex,
  type SimTuning,
  type Vec2,
  type Vec3,
} from '../sim';
import { integrateBall } from '../sim/physics';
import { nextRandom } from '../sim/rng';
import type { Observation } from './observe';

export interface Difficulty {
  /** Ticks before the Bot reacts to a new shot. */
  reactionTicks: number;
  /** 0–1: the Bot's top speed as a fraction of `playerSpeed`. Humans always get full speed. */
  moveSpeed: number;
  /** Meters of error in the Bot's read of where the ball will be, one second out. Shrinks as the ball arrives. */
  predictionError: number;
  /** 0–1: how close to the sideline the Bot aims, away from the opponent. It aims at 40–100% of this. */
  aimWidth: number;
  /** Random spread added to Aim (Aim runs -1..1). */
  aimNoise: number;
  /** 0–1: chance, per incoming ball, of committing late, which rushes the shot (ADR-0002). */
  lateCommit: number;
  /**
   * 0–1: chance, per incoming ball, of setting up to the side and committing at the last moment. The contact
   * assist fixes some of the footwork, so this weakens the shot mostly through the late Commit.
   */
  offCenter: number;
  /** 0–1: chance, per incoming ball, of going for too much: an off-center, last-moment swing aimed at the lines. */
  unforcedError: number;
  /** 0–1: chance of picking the best-weighted Shot type rather than a weighted guess. */
  shotChoiceAccuracy: number;
  /** 0–1: chance, per incoming ball, of respecting the Kitchen and Two-bounce rules. */
  kitchenDiscipline: number;
}

export const DIFFICULTY = {
  easy: {
    reactionTicks: 24,
    moveSpeed: 0.75,
    predictionError: 0.9,
    aimWidth: 0.4,
    aimNoise: 0.45,
    lateCommit: 0.5,
    offCenter: 0.3,
    unforcedError: 0.08,
    shotChoiceAccuracy: 0.4,
    kitchenDiscipline: 0.9,
  },
  medium: {
    reactionTicks: 14,
    moveSpeed: 0.9,
    predictionError: 0.5,
    aimWidth: 0.5,
    aimNoise: 0.3,
    lateCommit: 0.4,
    offCenter: 0.2,
    unforcedError: 0.08,
    shotChoiceAccuracy: 0.7,
    kitchenDiscipline: 0.97,
  },
  hard: {
    reactionTicks: 8,
    moveSpeed: 0.95,
    predictionError: 0.2,
    aimWidth: 0.85,
    aimNoise: 0.15,
    lateCommit: 0.1,
    offCenter: 0.05,
    unforcedError: 0.02,
    shotChoiceAccuracy: 0.9,
    kitchenDiscipline: 1,
  },
} satisfies Record<string, Difficulty>;

export type ShotWeights = Record<ShotType, number>;

/** A Bot's style: a weighting over Shot types, plus a small Difficulty tweak (presets in personality.ts). */
export interface Personality {
  weights: ShotWeights;
  /** Added to the Difficulty's values (chances stay within 0–1). */
  adjust: Partial<Difficulty>;
}
export const NEUTRAL: Personality = { weights: { soft: 1, drive: 1, lob: 1 }, adjust: {} };

/** Difficulty fields that aren't 0–1 chances or fractions. */
const UNBOUNDED: (keyof Difficulty)[] = ['reactionTicks', 'predictionError'];

/** `base` plus `adjust`, read live, so the debug panel's edits to the preset still apply. */
function adjusted(base: Difficulty, adjust: Partial<Difficulty>): Difficulty {
  const d = {} as Difficulty;
  for (const k of Object.keys(base) as (keyof Difficulty)[]) {
    Object.defineProperty(d, k, {
      enumerable: true,
      get: () => {
        const v = Math.max(0, base[k] + (adjust[k] ?? 0));
        return UNBOUNDED.includes(k) ? v : Math.min(1, v);
      },
    });
  }
  return d;
}

export interface Bot {
  think(obs: Observation): Intent;
  /** What the Bot is trying to do, for the debug overlay. Updated by `think`. */
  readonly plan: BotPlan;
}

export interface BotPlan {
  /** Where the Bot is heading. */
  spot: { x: number; z: number } | null;
  /** Where it plans to meet the ball, by its own (noisy) read. */
  contact: Vec3 | null;
  /** The Shot type it committed to for this ball. */
  shot: ShotType | null;
  /** It reads the ball as going out and will let it go. */
  leave: boolean;
}

const SERVE_WAIT_TICKS = [40, 80] as const;
const PREDICT_TICKS = 150;
/** Stand this far behind the Kitchen line at the net. */
const NET_GAP = 0.3;
/** Commit to a volley when contact is this close. */
const VOLLEY_COMMIT_TICKS = 60;
/** A late Commit waits until the ball is this many Ticks from reach (picked per ball). */
const LATE_COMMIT_TICKS = [5, 18] as const;
/**
 * An off-center setup: the ball passes this many meters to the backhand side of the sweet spot (the side
 * with room before the edge of reach), and the Commit comes this many Ticks before the ball is in reach.
 */
const OFF_CENTER_X = [0.5, 0.8] as const;
const OFF_CENTER_COMMIT_TICKS = 6;
/** Before an early groundstroke Commit, the ball must stay this far beyond reach until it bounces. */
const COMMIT_MARGIN = 0.2;
/** How far from the net a disciplined Bot keeps its feet when volleying. */
function kitchenEdge(t: SimTuning): number {
  return KITCHEN_DEPTH + t.footRadius + 0.08;
}
/**
 * Leave a ball the Bot reads as landing this far out, plus however far its read could still be off. Near-line
 * balls are played until the read is sure, so the Bot never gives up on a ball that lands in.
 */
const OUT_MARGIN = 0.15;
/** Top speed (a fraction of `playerSpeed`) while the ball is dead: a walk, not a sprint or a sudden stop. */
const WALK = 0.35;

interface PathPoint {
  tick: number;
  pos: Vec3;
  bounces: number;
  /** At or past the top of its bounce. */
  falling: boolean;
}

interface Plan {
  contact: PathPoint;
  /** Where the Player's feet should be for the ball to meet the sweet spot. */
  spot: { x: number; z: number };
}

export function createBot(
  side: SideIndex,
  seed: number,
  difficulty: Difficulty,
  t: SimTuning,
  personality: Personality = NEUTRAL,
): Bot {
  const { weights } = personality;
  difficulty = adjusted(difficulty, personality.adjust);
  let rng = seed >>> 0;
  const random = () => {
    const [v, n] = nextRandom(rng);
    rng = n;
    return v;
  };
  const spread = () => random() * 2 - 1;
  const uniform = ([lo, hi]: readonly [number, number]) => lo + random() * (hi - lo);

  // Per-ball memory, reset whenever a new shot is seen.
  let seenShots = -1;
  let seenAt = 0;
  let error = { x: 0, z: 0 };
  let disciplined = true;
  let leave = false;
  /** Commit only when the ball is this many Ticks from reach, or null for the usual early Commit. */
  let lateAt: number | null = null;
  /** Meters (local x) the ball should pass to the side of the sweet spot on this ball: an off-center setup. */
  let offCenterX = 0;
  /** An Unforced error on this ball: going for too much, aimed at the lines. */
  let unforced = false;
  /** Soft shots in a row this Rally. Bots lose patience in long dink exchanges. */
  let softStreak = 0;
  let aim: Vec2 = { x: 0, y: 0 };
  let servePhase = -1;
  let serveAt = 0;
  let lastSpot: { x: number; z: number } | null = null;
  /** Where the Bot settles after leaving a ball, or while it is dead: fixed, so it doesn't follow the ball. */
  let settleSpot: { x: number; z: number } | null = null;
  const shown: BotPlan = { spot: null, contact: null, shot: null, leave: false };

  return {
    plan: shown,
    think(o) {
      shown.contact = null;
      const idle: Intent = { move: { x: 0, y: 0 }, aim, shot: null };

      if (o.phase === 'serve') {
        seenShots = -1;
        settleSpot = null;
        shown.leave = false;
        if (o.server !== side) return idle;
        if (servePhase !== o.phaseTick) {
          servePhase = o.phaseTick;
          serveAt = o.phaseTick + SERVE_WAIT_TICKS[0] + Math.floor(random() * (SERVE_WAIT_TICKS[1] - SERVE_WAIT_TICKS[0]));
        }
        if (o.tick !== serveAt) return idle;
        aim = noisyAim(spread() * 0.6, spread() * 0.5);
        return { ...idle, aim, shot: weightedPick({ soft: 1, drive: 1.2, lob: 0 }) };
      }
      if (o.phase === 'dead') {
        settleSpot ??= readySpot(o);
        return moveTo(o, settleSpot, null, WALK);
      }
      if (o.phase !== 'rally') return idle;

      if (o.shots !== seenShots) {
        softStreak = o.lastShot === 'soft' && o.shots > 1 ? softStreak + 1 : 0;
        seenShots = o.shots;
        seenAt = o.tick;
        error = { x: spread() * difficulty.predictionError, z: spread() * difficulty.predictionError };
        disciplined = random() < difficulty.kitchenDiscipline;
        leave = shown.leave = false;
        settleSpot = null;
        // The mistakes a Difficulty allows, rolled once per ball.
        // An Unforced error is also always off-center.
        unforced = random() < difficulty.unforcedError;
        const setUpOffCenter = unforced || random() < difficulty.offCenter;
        lateAt = setUpOffCenter ? OFF_CENTER_COMMIT_TICKS : random() < difficulty.lateCommit ? uniform(LATE_COMMIT_TICKS) : null;
        // Sideways only: along the ball's path, Contact just happens a little earlier or later.
        offCenterX = setUpOffCenter ? -uniform(OFF_CENTER_X) : 0;
      }

      const incoming = o.ball.lastHitBy !== null && o.ball.lastHitBy !== side;
      if (!incoming || o.tick < seenAt + difficulty.reactionTicks) {
        // Until it reacts, the Bot keeps heading where it was heading.
        return moveTo(o, (incoming && lastSpot) || readySpot(o), null);
      }

      const path = predict(o);
      if (o.ball.bouncesSinceHit === 0 && !leave) {
        const landing = path.find((p) => p.bounces === 1);
        if (landing && endOfZ(landing.pos.z) === o.myEnd) {
          // The read's error shrinks as the ball arrives (see `predict`).
          const margin = OUT_MARGIN + difficulty.predictionError * Math.min(1, landing.tick * TICK);
          if (Math.abs(landing.pos.x) > HALF_WIDTH + margin || Math.abs(landing.pos.z) > HALF_LENGTH + margin) {
            leave = true;
            settleSpot = readySpot(o);
          }
        }
      }
      shown.leave = leave;
      if (leave) return moveTo(o, settleSpot!, null);

      const plan = planContact(o, path);
      if (!plan) return moveTo(o, readySpot(o), null);
      shown.contact = plan.contact.pos;

      // Moving the feet away from the ball puts the ball on the other side of the sweet spot.
      const spot = { x: plan.spot.x - localToWorld(o.myEnd, offCenterX, 0).x, z: plan.spot.z };
      let shot: ShotType | null = null;
      const volley = plan.contact.bounces === 0;
      // Commit early for Shot quality, unless the ball passes close before it bounces (it could be volleyed by
      // accident). While the Two-bounce rule applies, a disciplined Bot allows for its own misread too.
      const mustBounce = o.shots < 3 && disciplined;
      const early = clearUntilBounce(o, path, plan.contact.tick, spot, COMMIT_MARGIN + (mustBounce ? difficulty.predictionError + 0.3 : 0));
      // A late Commit keeps the same safety check, it just waits longer.
      const safe = volley ? plan.contact.tick <= VOLLEY_COMMIT_TICKS : o.ball.bouncesSinceHit >= 1 || early;
      const ready = safe && (lateAt === null || ticksToReach(path, plan.contact.tick, [o.myPos, spot], mustBounce) <= lateAt);
      if (!o.committed && ready) {
        shot = chooseShot(o, plan);
        aim = chooseAim(o, shot);
        shown.shot = shot;
      }
      // Committed with the ball still in the air: any contact is a Volley, so stay behind the Kitchen line.
      const edge = kitchenEdge(t);
      if (disciplined && (o.committed || shot) && o.ball.bouncesSinceHit === 0 && Math.abs(spot.z) < edge) {
        spot.z = -facing(o.myEnd) * edge;
      }
      return moveTo(o, spot, shot);
    },
  };

  /** The ball's path from now, with the Bot's own read of spin and its prediction error. */
  function predict(o: Observation): PathPoint[] {
    const ball: Ball = { pos: { ...o.ball.pos }, vel: { ...o.ball.vel }, spin: spinOf(o), lastHitBy: null, bouncesSinceHit: 0, hitTick: 0 };
    const path: PathPoint[] = [];
    let bounces = o.ball.bouncesSinceHit;
    for (let k = 1; k <= PREDICT_TICKS && bounces < 2; k++) {
      const events = integrateBall(ball, TICK, t, () => 0.5, false);
      if (events.some((e) => e.kind === 'bounce')) bounces++;
      const falling = bounces > 0 && ball.vel.y <= 0;
      // Early reads are off; they sharpen as the ball arrives.
      const errorShare = Math.min(1, k * TICK);
      path.push({ tick: k, pos: { x: ball.pos.x + error.x * errorShare, y: ball.pos.y, z: ball.pos.z + error.z * errorShare }, bounces, falling });
    }
    return path;
  }

  /** The ball stays out of reach (and assist range) of both where I am and where I'm going until it bounces. */
  function clearUntilBounce(o: Observation, path: PathPoint[], contactTick: number, spot: { x: number; z: number }, margin: number): boolean {
    const danger = t.reachForward + margin;
    for (const p of path) {
      if (p.bounces > 0 || p.tick >= contactTick) break;
      if (p.pos.y > t.reachHeight + 0.5) continue;
      for (const q of [o.myPos, spot]) if (Math.hypot(p.pos.x - q.x, p.pos.z - q.z) < danger) return false;
    }
    return true;
  }

  /**
   * Ticks until the ball first comes within reach of any of `feet` (where the Bot is, and where it's going),
   * or until the planned Contact if sooner. A late Commit counts down to this, not to Contact: off-center
   * feet meet the ball early, and a Commit after that would be no swing at all.
   */
  function ticksToReach(path: PathPoint[], contactTick: number, feet: { x: number; z: number }[], mustBounce: boolean): number {
    for (const p of path) {
      if (p.tick >= contactTick) break;
      if (mustBounce && p.bounces === 0) continue;
      if (p.pos.y >= t.reachHeight) continue;
      if (feet.some((q) => Math.hypot(p.pos.x - q.x, p.pos.z - q.z) < t.reachForward)) return p.tick;
    }
    return contactTick;
  }

  function spinOf(o: Observation): number {
    const v = o.lastVariant;
    if (!v) return 0;
    if (v === 'serve') return t.serves[o.lastShot === 'drive' ? 'drive' : 'soft'].spin;
    return t.shots[v === 'smash' ? 'drive' : v].spin;
  }

  function planContact(o: Observation, path: PathPoint[]): Plan | null {
    const mustBounce = o.shots < 3 && disciplined;
    const sweet = localToWorld(o.myEnd, t.sweetSpotSide, t.sweetSpotForward);
    const myDepth = Math.abs(o.myPos.z);
    // Volley from the net; from deep, let it bounce.
    const wantVolley = !mustBounce && myDepth < KITCHEN_DEPTH + 1.6;

    // Prefer a reachable ball past the top of its bounce, then any reachable ball, then the least-late one.
    let rising: Plan | null = null;
    let best: Plan | null = null;
    let bestLate = Infinity;
    for (const p of path) {
      if (endOfZ(p.pos.z) !== o.myEnd || p.bounces > 1) continue;
      if (p.pos.y > t.reachHeight - 0.2 || p.pos.y < 0.06) continue;
      const volley = p.bounces === 0;
      if (volley && (mustBounce || !wantVolley)) continue;
      const spot = { x: p.pos.x - sweet.x, z: p.pos.z - sweet.z };
      if (volley && disciplined && Math.abs(spot.z) < kitchenEdge(t)) continue;
      const need = Math.hypot(spot.x - o.myPos.x, spot.z - o.myPos.z) / (t.playerSpeed * difficulty.moveSpeed) + 0.12;
      const late = need - p.tick * TICK;
      if (late <= 0 && (volley || p.falling)) return { contact: p, spot };
      if (late <= 0) rising ??= { contact: p, spot };
      if (late < bestLate) {
        bestLate = late;
        best = { contact: p, spot };
      }
    }
    return rising ?? best;
  }

  /** Real pickleball positioning: stay back until the Two-bounce rule is satisfied, then move up to the Kitchen line. */
  function readySpot(o: Observation): { x: number; z: number } {
    const f = facing(o.myEnd);
    // The receiver moves up after the return; the server after the third shot.
    const advance = o.server === side ? o.shots >= 3 : o.shots >= 2;
    const depth = advance ? KITCHEN_DEPTH + t.footRadius + NET_GAP : HALF_LENGTH - 0.2;
    // Shade toward the ball to cover the angle.
    const x = Math.max(-HALF_WIDTH + 0.5, Math.min(HALF_WIDTH - 0.5, o.ball.pos.x * 0.45));
    return { x, z: -f * depth };
  }

  function moveTo(o: Observation, spot: { x: number; z: number }, shot: ShotType | null, maxSpeed = difficulty.moveSpeed): Intent {
    lastSpot = spot;
    shown.spot = spot;
    if (!o.committed && !shot) shown.shot = null;
    const l = worldToLocal(o.myEnd, spot.x - o.myPos.x, spot.z - o.myPos.z);
    const d = Math.hypot(l.x, l.y);
    // Brake in time to stop on the spot (v² = 2ad, with some margin), so the Bot doesn't overshoot.
    const speed = Math.min(maxSpeed, Math.sqrt(2 * t.playerAccel * 0.7 * d) / t.playerSpeed);
    const move = d < 0.03 ? { x: 0, y: 0 } : { x: (l.x / d) * speed, y: (l.y / d) * speed };
    return { move, aim, shot };
  }

  function chooseShot(o: Observation, plan: Plan): ShotType {
    const { pos } = plan.contact;
    const myDepth = Math.abs(pos.z);
    const theirDepth = Math.abs(o.opponentPos.z);
    const atNet = myDepth < KITCHEN_DEPTH + 1.2;
    const high = pos.y >= t.smashHeight - 0.1;
    const low = pos.y < 0.8;
    const scores: ShotWeights = { soft: 1, drive: 1, lob: 0.25 };
    if (high) {
      scores.drive = 5;
      scores.soft = 0.3;
    } else if (o.shots === 1) {
      // Return of serve: deep, to keep the server back.
      scores.drive = 2.5;
      scores.soft = 0.2;
      scores.lob = 0.5;
    } else if (atNet && low) {
      scores.soft = 4;
      scores.drive = 0.3 + 0.5 * softStreak;
    } else if (atNet) {
      // A ball above the net at the net: speed it up.
      scores.drive = 3;
    } else if (!atNet && theirDepth < KITCHEN_DEPTH + 1.5) {
      // They're at the net and I'm back: drop it in, or lob over.
      scores.soft = 3;
      scores.drive = 0.8;
      scores.lob = 0.6;
    } else if (!atNet) {
      scores.drive = 2;
      scores.soft = 1.5;
    }
    for (const k of Object.keys(scores) as ShotType[]) scores[k] *= weights[k];
    return weightedPick(scores);
  }

  function weightedPick(scores: ShotWeights): ShotType {
    const entries = Object.entries(scores) as [ShotType, number][];
    if (random() < difficulty.shotChoiceAccuracy) return entries.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
    let r = random() * entries.reduce((sum, [, v]) => sum + v, 0);
    for (const [k, v] of entries) {
      r -= v;
      if (r <= 0) return k;
    }
    return entries[entries.length - 1][0];
  }

  /** Aim away from the opponent. */
  function chooseAim(o: Observation, shot: ShotType): Vec2 {
    // Both the opponent's x and the Aim's lateral are in my local frame.
    const theirLocalX = worldToLocal(o.myEnd, o.opponentPos.x, 0).x;
    const away = theirLocalX > 0 ? -1 : 1;
    // Going for too much: the corner, as deep as the shot goes.
    if (unforced) return { x: away, y: 1 };
    const x = away * difficulty.aimWidth * (0.4 + 0.6 * random());
    const y = shot === 'soft' ? -0.2 + spread() * 0.4 : spread() * 0.5;
    return noisyAim(x, y);
  }

  function noisyAim(x: number, y: number): Vec2 {
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    return { x: clamp(x + spread() * difficulty.aimNoise), y: clamp(y + spread() * difficulty.aimNoise) };
  }
}
