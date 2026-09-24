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
  isInBounds,
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
  /** Meters of error in the Bot's read of where the ball will be, one second out. Shrinks as the ball arrives. */
  predictionError: number;
  /** Random spread added to Aim (Aim runs -1..1). */
  aimNoise: number;
  /** 0–1: chance of picking the best-weighted Shot type rather than a weighted guess. */
  shotChoiceAccuracy: number;
  /** 0–1: chance, per incoming ball, of respecting the Kitchen and Two-bounce rules. */
  kitchenDiscipline: number;
}

export const DIFFICULTY = {
  easy: { reactionTicks: 18, predictionError: 0.9, aimNoise: 0.35, shotChoiceAccuracy: 0.4, kitchenDiscipline: 0.9 },
  medium: { reactionTicks: 11, predictionError: 0.5, aimNoise: 0.2, shotChoiceAccuracy: 0.7, kitchenDiscipline: 0.97 },
  hard: { reactionTicks: 6, predictionError: 0.2, aimNoise: 0.1, shotChoiceAccuracy: 0.9, kitchenDiscipline: 1 },
} satisfies Record<string, Difficulty>;

/** A Personality is a weighting over Shot types (milestone 05 adds Banger, Dinker, Lobber). */
export type ShotWeights = Record<ShotType, number>;
export const NEUTRAL: ShotWeights = { soft: 1, drive: 1, lob: 1 };

export interface Bot {
  think(obs: Observation): Intent;
}

const SERVE_WAIT_TICKS = [40, 80] as const;
const PREDICT_TICKS = 150;
/** Stand this far behind the Kitchen line at the net. */
const NET_GAP = 0.3;
/** Commit to a volley when contact is this close. */
const VOLLEY_COMMIT_TICKS = 30;
/** How far from the net a disciplined Bot keeps its feet when volleying. */
function kitchenEdge(t: SimTuning): number {
  return KITCHEN_DEPTH + t.footRadius + 0.08;
}
/** Leave a ball the Bot reads as landing this far out. */
const OUT_MARGIN = 0.15;

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
  weights: ShotWeights = NEUTRAL,
): Bot {
  let rng = seed >>> 0;
  const random = () => {
    const [v, n] = nextRandom(rng);
    rng = n;
    return v;
  };
  const spread = () => random() * 2 - 1;

  // Per-ball memory, reset whenever a new shot is seen.
  let seenShots = -1;
  let seenAt = 0;
  let error = { x: 0, z: 0 };
  let disciplined = true;
  let leave = false;
  /** Soft shots in a row this Rally. Bots lose patience in long dink exchanges. */
  let softStreak = 0;
  let aim: Vec2 = { x: 0, y: 0 };
  let servePhase = -1;
  let serveAt = 0;
  let lastSpot: { x: number; z: number } | null = null;

  return {
    think(o) {
      const idle: Intent = { move: { x: 0, y: 0 }, aim, shot: null };

      if (o.phase === 'serve') {
        seenShots = -1;
        if (o.server !== side) return idle;
        if (servePhase !== o.phaseTick) {
          servePhase = o.phaseTick;
          serveAt = o.phaseTick + SERVE_WAIT_TICKS[0] + Math.floor(random() * (SERVE_WAIT_TICKS[1] - SERVE_WAIT_TICKS[0]));
        }
        if (o.tick !== serveAt) return idle;
        aim = noisyAim(spread() * 0.6, spread() * 0.5);
        return { ...idle, aim, shot: weightedPick({ soft: 1, drive: 1.2, lob: 0 }) };
      }
      if (o.phase !== 'rally') return idle;

      if (o.shots !== seenShots) {
        softStreak = o.lastShot === 'soft' && o.shots > 1 ? softStreak + 1 : 0;
        seenShots = o.shots;
        seenAt = o.tick;
        error = { x: spread() * difficulty.predictionError, z: spread() * difficulty.predictionError };
        disciplined = random() < difficulty.kitchenDiscipline;
        leave = false;
      }

      const incoming = o.ball.lastHitBy !== null && o.ball.lastHitBy !== side;
      if (!incoming || o.tick < seenAt + difficulty.reactionTicks) {
        // Until it reacts, the Bot keeps heading where it was heading.
        return moveTo(o, (incoming && lastSpot) || readySpot(o), null);
      }

      const path = predict(o);
      if (o.ball.bouncesSinceHit === 0 && !leave) {
        const landing = path.find((p) => p.bounces === 1);
        if (landing && endOfZ(landing.pos.z) === o.myEnd && !isInBounds(landing.pos.x * (1 - OUT_MARGIN / HALF_WIDTH), landing.pos.z * (1 - OUT_MARGIN / HALF_LENGTH))) {
          leave = true;
        }
      }
      if (leave) return moveTo(o, readySpot(o), null);

      const plan = planContact(o, path);
      if (!plan) return moveTo(o, readySpot(o), null);

      let shot: ShotType | null = null;
      const volley = plan.contact.bounces === 0;
      const ready = volley ? plan.contact.tick <= VOLLEY_COMMIT_TICKS : o.ball.bouncesSinceHit >= 1;
      if (!o.committed && ready) {
        shot = chooseShot(o, plan);
        aim = chooseAim(o, shot);
      }
      // Committed with the ball still in the air: any contact is a Volley, so stay behind the Kitchen line.
      const spot = { ...plan.spot };
      const edge = kitchenEdge(t);
      if (disciplined && (o.committed || shot) && o.ball.bouncesSinceHit === 0 && Math.abs(spot.z) < edge) {
        spot.z = -facing(o.myEnd) * edge;
      }
      return moveTo(o, spot, shot);
    },
  };

  /** The ball's path from now, with the Bot's own read of spin and its prediction error. */
  function predict(o: Observation): PathPoint[] {
    const spin = o.lastShot ? (o.shots === 1 && o.lastShot !== 'lob' ? t.serves[o.lastShot] : t.shots[o.lastShot]).spin : 0;
    const ball: Ball = { pos: { ...o.ball.pos }, vel: { ...o.ball.vel }, spin, lastHitBy: null, bouncesSinceHit: 0 };
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
      const need = Math.hypot(spot.x - o.myPos.x, spot.z - o.myPos.z) / t.playerSpeed + 0.12;
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

  function moveTo(o: Observation, spot: { x: number; z: number }, shot: ShotType | null): Intent {
    lastSpot = spot;
    const l = worldToLocal(o.myEnd, spot.x - o.myPos.x, spot.z - o.myPos.z);
    const d = Math.hypot(l.x, l.y);
    // Brake in time to stop on the spot (v² = 2ad, with some margin), so the Bot doesn't overshoot.
    const speed = Math.min(1, Math.sqrt(2 * t.playerAccel * 0.7 * d) / t.playerSpeed);
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
    const x = away * (0.45 + 0.5 * random());
    const y = shot === 'soft' ? -0.2 + spread() * 0.4 : spread() * 0.5;
    return noisyAim(x, y);
  }

  function noisyAim(x: number, y: number): Vec2 {
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    return { x: clamp(x + spread() * difficulty.aimNoise), y: clamp(y + spread() * difficulty.aimNoise) };
  }
}
