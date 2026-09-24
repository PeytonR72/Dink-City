import {
  BALL_RADIUS,
  CENTERLINE_HALF,
  HALF_LENGTH,
  HALF_WIDTH,
  KITCHEN_DEPTH,
  endOfZ,
  facing,
  isInBounds,
  localToWorld,
  worldToLocal,
} from './court';
import { integrateBall } from './physics';
import { nextRandom } from './rng';
import { TICK, netClearance, simulateFlight, solveShot, solveTimedShot } from './solver';
import type {
  Commit,
  DeadReason,
  End,
  Match,
  MatchConfig,
  Intent,
  Player,
  QualityFactors,
  ShotTuning,
  ShotType,
  ShotVariant,
  SideIndex,
  SimState,
  SimTuning,
  TunedVariant,
  Vec2,
  Vec3,
} from './types';

const SERVE_DELAY_TICKS = 15;
const SERVE_X = 1.52;
const BASELINE_OFFSET = 0.3;
const FAR = 10;

export const DEFAULT_MATCH: MatchConfig = { pointsToWin: 11, winBy: 2, rallyScoring: false, bestOf: 1 };

/** The End a Side is playing from in the current Game. */
export function endOf(s: SimState, side: SideIndex): End {
  return s.match.ends[side];
}

export function createInitialState(seed: number, config: MatchConfig = DEFAULT_MATCH): SimState {
  const player = (): Player => ({
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    commit: null,
    aiming: false,
    swing: null,
    speed: 0,
  });
  const s: SimState = {
    tick: 0,
    rng: seed >>> 0,
    phase: 'serve',
    phaseTick: 0,
    server: 0,
    match: {
      config: { ...config },
      points: [0, 0],
      games: [0, 0],
      ends: [0, 1],
      gameFirstServer: 0,
      winner: null,
    },
    shots: 0,
    ball: { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, spin: 0, lastHitBy: null, bouncesSinceHit: 0, hitTick: 0 },
    sides: [{ players: [player()] }, { players: [player()] }],
    events: [],
  };
  setUpServe(s);
  return s;
}

export function step(prev: SimState, intents: readonly [Intent, Intent], t: SimTuning): SimState {
  const s = structuredClone(prev);
  s.tick++;
  s.events = [];
  const random = () => {
    const [value, next] = nextRandom(s.rng);
    s.rng = next;
    return value;
  };

  for (const i of [0, 1] as const) {
    const shot = intents[i].shot;
    if (shot) press(s, i, shot, intents[i], t);
  }

  for (const i of [0, 1] as const) movePlayer(s, i, intents[i], t);

  if (s.phase === 'serve') {
    holdBall(s);
    return s;
  }

  const events = integrateBall(s.ball, TICK, t, random);
  s.events.push(...events);

  if (s.phase === 'rally') {
    for (const e of events) {
      if (e.kind === 'bounce') onBounce(s, e.pos);
      if (s.phase !== 'rally') break;
    }
    if (s.phase === 'rally') checkRolling(s);
    if (s.phase === 'rally') checkContact(s, intents, t, random);
  } else if (s.phase === 'dead' && s.tick - s.phaseTick >= t.deadTicks) {
    if (s.match.winner !== null) {
      s.phase = 'over';
      s.phaseTick = s.tick;
      return s;
    }
    if (gameWinner(s.match) !== null) startNextGame(s);
    setUpServe(s);
  }

  return s;
}

function press(s: SimState, i: SideIndex, shot: ShotType, intent: Intent, t: SimTuning) {
  const player = s.sides[i].players[0];
  if (s.phase === 'serve') {
    if (i === s.server && s.tick - s.phaseTick >= SERVE_DELAY_TICKS) serve(s, i, shot, intent, t);
    return;
  }
  // Pressing the same button again keeps the earlier Commit (and its timing); a different one is a new, later Commit.
  if (s.phase === 'rally' && player.commit?.type !== shot) player.commit = { type: shot, tick: s.tick, bestDistance: null };
}

function serve(s: SimState, i: SideIndex, shot: ShotType, intent: Intent, t: SimTuning) {
  const kind = shot === 'drive' ? 'drive' : 'soft';
  const tuning = t.serves[kind];
  const end = endOf(s, i);
  const f = facing(end);
  const diagonalX = serviceCourtSign(s) * SERVE_X;
  const lateral = localToWorld(end, clamp(intent.aim.x, -1, 1) * tuning.width, 0).x;
  const target = {
    x: clamp(diagonalX + lateral, -HALF_WIDTH + 0.15, HALF_WIDTH - 0.15),
    z: f * depthFor(tuning, intent.aim.y),
  };
  const vel = solveShot(s.ball.pos, target, tuning.apex, tuning.spin, t);
  launch(s, i, kind, 'serve', vel, tuning.spin);
  s.phase = 'rally';
  s.phaseTick = s.tick;
}

function checkContact(s: SimState, intents: readonly [Intent, Intent], t: SimTuning, random: () => number) {
  const { ball } = s;
  for (const i of [0, 1] as const) {
    const player = s.sides[i].players[0];
    if (!player.commit) continue;
    const end = endOf(s, i);
    if (ball.lastHitBy === i || endOfZ(ball.pos.z) !== end || ball.bouncesSinceHit > 1) {
      player.commit.bestDistance = null;
      continue;
    }
    const d = sweetSpotDistance(player, end, ball.pos, t);
    if (d === null) continue;

    // Wait for the ball to reach its closest point to the sweet spot, but
    // never let it leave reach unhit.
    const next = { x: ball.pos.x + ball.vel.x * TICK, y: ball.pos.y + ball.vel.y * TICK, z: ball.pos.z + ball.vel.z * TICK };
    const leaving = sweetSpotDistance(player, end, next, t) === null;
    const best = player.commit.bestDistance;
    if (d > t.sweetRadius && !leaving && (best === null || d < best)) {
      player.commit.bestDistance = d;
      continue;
    }

    const volley = ball.bouncesSinceHit === 0;
    // The Serve and the return of serve must both bounce (Two-bounce rule).
    const mustBounce = s.shots < 3;
    hit(s, i, player.commit, d, intents[i].aim, t, random);
    if (volley && mustBounce) die(s, 'two-bounce', i);
    else if (volley && inKitchen(player, t)) die(s, 'kitchen', i);
    return;
  }
}

/** A Player is a point with a foot radius; touching the Kitchen line counts as in the Kitchen. */
function inKitchen(player: Player, t: SimTuning): boolean {
  return Math.abs(player.pos.z) < KITCHEN_DEPTH + t.footRadius;
}

/**
 * Normalized distance (0 = sweet spot, 1 = edge of reach) from the Player's
 * sweet spot to a ball position, or null when out of reach.
 */
export function sweetSpotDistance(player: Player, end: End, pos: Vec3, t: SimTuning): number | null {
  if (pos.y > t.reachHeight) return null;
  const l = worldToLocal(end, pos.x - player.pos.x, pos.z - player.pos.z);
  if (Math.hypot(l.x / t.reachSide, l.y / (l.y >= 0 ? t.reachForward : t.reachBack)) > 1) return null;
  const dx = (l.x - t.sweetSpotSide) / t.reachSide;
  const dy =
    l.y >= t.sweetSpotForward
      ? (l.y - t.sweetSpotForward) / (t.reachForward - t.sweetSpotForward)
      : (t.sweetSpotForward - l.y) / (t.sweetSpotForward + t.reachBack);
  return Math.min(1, Math.hypot(dx, dy));
}

/** Linear from 1 at k = 0 down to `floor` at k = 1 (k is clamped). */
function falloff(k: number, floor: number): number {
  return 1 + (floor - 1) * clamp(k, 0, 1);
}

/** Soft becomes a Dink, Drop or Block from context. A Smash is decided in `hit`, since it can fall back to a Drive. */
export function variantOf(type: ShotType, pos: Vec3, pace: number, t: SimTuning): TunedVariant {
  if (type !== 'soft') return type;
  if (pace >= t.blockSpeed) return 'block';
  return Math.abs(pos.z) - KITCHEN_DEPTH <= t.dinkZone ? 'dink' : 'drop';
}

/** The Shot quality inputs (ADR-0002). Movement at Contact acts through Aim error instead. */
function qualityFactors(s: SimState, commit: Commit, distance: number, pace: number, variant: TunedVariant, t: SimTuning): QualityFactors {
  const { ball } = s;
  // Commit timing is a fraction of the flight, so fast exchanges aren't punished twice (pace covers them).
  const flight = Math.max(1, s.tick - ball.hitTick);
  const pressedAt = (commit.tick - ball.hitTick) / flight;
  return {
    set: distance <= t.sweetRadius ? 1 : falloff((distance - t.sweetRadius) / (1 - t.sweetRadius), t.edgeQuality),
    timing: falloff((pressedAt - t.commitFullFraction) / (t.commitRushedFraction - t.commitFullFraction), t.rushedQuality),
    height: falloff((t.lowContactHeight - ball.pos.y) / (t.lowContactHeight - BALL_RADIUS), t.lowContactQuality),
    // A Block is the answer to pace, so it ignores it.
    pace: variant === 'block' ? 1 : falloff((pace - t.paceStart) / (t.paceFull - t.paceStart), t.paceQuality),
  };
}

/**
 * `distance` is how far from the sweet spot the ball was met (0 = dead center,
 * 1 = edge of reach).
 */
function hit(s: SimState, i: SideIndex, commit: Commit, distance: number, aim: Vec2, t: SimTuning, random: () => number) {
  const { ball } = s;
  const player = s.sides[i].players[0];
  const type = commit.type;
  const pace = length(ball.vel);
  const base = variantOf(type, ball.pos, pace, t);
  let variant: ShotVariant = base;
  const tuning = t.shots[base];
  const factors = qualityFactors(s, commit, distance, pace, base, t);
  const quality = factors.set * factors.timing * factors.height * factors.pace;
  const weak = 1 - quality;
  const end = endOf(s, i);
  const lateral = localToWorld(end, clamp(aim.x, -1, 1) * tuning.width, 0).x;
  let depth = Math.max(0.5, depthFor(tuning, aim.y) - weak * tuning.weakDepth);
  const target = { x: clamp(lateral, -HALF_WIDTH + 0.15, HALF_WIDTH - 0.15), z: 0 };

  // A random miss from moving at Contact, plus a smaller one from poor quality
  // (squared, so only a poor shot sprays). Applied after the in-court clamp, so
  // a shot on the run aimed near a line can go out.
  const running = Math.min(1, player.speed / t.playerSpeed);
  const spread = t.moveAimError * running + t.qualityAimError * weak * weak;
  target.x += (random() + random() - 1) * spread;
  depth += (random() + random() - 1) * spread;

  // A Soft shot from behind the Kitchen is easy to hit too hard: only a
  // dead-center, set contact keeps it short. A Block just absorbs the pace.
  if (variant === 'dink' || variant === 'drop') {
    const beyond = Math.max(0, Math.abs(ball.pos.z) - KITCHEN_DEPTH);
    const offCenter = clamp((distance - t.softPerfectRadius) / (t.sweetRadius - t.softPerfectRadius), 0, 1);
    depth += t.softOverhit * beyond * Math.max(offCenter, running) * (0.5 + random());
  }
  target.z = facing(end) * Math.max(0.3, depth);

  let vel: Vec3 | null = null;
  if (variant === 'drive' && ball.pos.y >= t.smashHeight) {
    const speed = t.smashSpeed * (0.6 + 0.4 * quality);
    const v = solveTimedShot(ball.pos, target, speed, tuning.spin, t);
    // A smash from too deep would go into the net; fall back to a normal Drive.
    if (netClearance(simulateFlight(ball.pos, v, tuning.spin, t)) > 0.05) {
      vel = v;
      variant = 'smash';
    }
  }
  if (!vel) {
    const apex = tuning.apex + tuning.apexPerMeter * Math.abs(ball.pos.z) + weak * tuning.weakApex;
    vel = solveShot(ball.pos, target, apex, tuning.spin, t);
  }
  launch(s, i, type, variant, vel, tuning.spin, { volley: ball.bouncesSinceHit === 0, quality, factors });
}

const SERVE_INFO = { volley: false, quality: 1, factors: { set: 1, timing: 1, height: 1, pace: 1 } };

function launch(
  s: SimState,
  i: SideIndex,
  type: ShotType,
  variant: ShotVariant,
  vel: Vec3,
  spin: number,
  info: { volley: boolean; quality: number; factors: QualityFactors } = SERVE_INFO,
) {
  const { ball } = s;
  const player = s.sides[i].players[0];
  ball.vel = vel;
  ball.spin = spin;
  ball.lastHitBy = i;
  ball.bouncesSinceHit = 0;
  ball.hitTick = s.tick;
  s.shots++;
  player.commit = null;
  player.aiming = false;
  player.swing = { type, variant, tick: s.tick };
  s.events.push({ kind: 'hit', side: i, type, variant, ...info, pos: { ...ball.pos }, speed: length(ball.vel) });
}

function onBounce(s: SimState, pos: Vec3) {
  const { ball } = s;
  ball.bouncesSinceHit++;
  if (ball.bouncesSinceHit >= 2) return die(s, 'double-bounce', defenderOfBounce(s, pos));
  if (ball.lastHitBy === null) return;
  if (endOfZ(pos.z) === endOf(s, ball.lastHitBy)) return die(s, 'net', ball.lastHitBy);
  if (s.shots === 1) {
    // The Kitchen line is part of the Kitchen; the centerline counts for both Service courts.
    if (Math.abs(pos.z) <= KITCHEN_DEPTH) return die(s, 'service-kitchen', ball.lastHitBy);
    if (pos.x * serviceCourtSign(s) < -CENTERLINE_HALF) return die(s, 'service-court', ball.lastHitBy);
  }
  if (!isInBounds(pos.x, pos.z)) return die(s, 'out', ball.lastHitBy);
}

function checkRolling(s: SimState) {
  const { ball } = s;
  if (ball.lastHitBy === null) return;
  const onGround = ball.pos.y <= BALL_RADIUS + 1e-6 && ball.vel.y === 0;
  if (onGround) {
    const onHitterSide = endOfZ(ball.pos.z) === endOf(s, ball.lastHitBy);
    return onHitterSide ? die(s, 'net', ball.lastHitBy) : die(s, 'double-bounce', other(ball.lastHitBy));
  }
  if (Math.abs(ball.pos.x) > HALF_WIDTH + FAR || Math.abs(ball.pos.z) > HALF_LENGTH + FAR) {
    // Gone: a winner if it bounced in first, otherwise it was hit out.
    if (ball.bouncesSinceHit > 0) die(s, 'double-bounce', other(ball.lastHitBy));
    else die(s, 'out', ball.lastHitBy);
  }
}

/** Sign of world x for the receiver's (diagonal) Service court. */
function serviceCourtSign(s: SimState): number {
  const serverLocalX = s.match.points[s.server] % 2 === 0 ? 1 : -1;
  return -Math.sign(localToWorld(endOf(s, s.server), serverLocalX, 0).x);
}

/** The Side whose End a bounce landed in. */
function defenderOfBounce(s: SimState, pos: Vec3): SideIndex {
  return endOf(s, 0) === endOfZ(pos.z) ? 0 : 1;
}

function die(s: SimState, reason: DeadReason, loser: SideIndex) {
  s.phase = 'dead';
  s.phaseTick = s.tick;
  for (const side of s.sides) for (const p of side.players) p.commit = null;
  s.events.push({ kind: 'dead', reason, loser });
  awardRally(s, other(loser));
}

function awardRally(s: SimState, winner: SideIndex) {
  const { match } = s;
  const sideOut = !match.config.rallyScoring && winner !== s.server;
  if (!sideOut) match.points[winner]++;
  s.server = winner;
  s.events.push({ kind: 'rally-won', winner, sideOut });

  if (gameWinner(match) !== winner) return;
  match.games[winner]++;
  s.events.push({ kind: 'game', winner });
  if (match.games[winner] > match.config.bestOf / 2) {
    match.winner = winner;
    s.events.push({ kind: 'match', winner });
  }
}

function gameWinner(match: Match): SideIndex | null {
  const { points, config } = match;
  for (const side of [0, 1] as const) {
    if (points[side] >= config.pointsToWin && points[side] - points[other(side)] >= config.winBy) return side;
  }
  return null;
}

/** Ends switch between Games, and the first serve alternates. */
function startNextGame(s: SimState) {
  const { match } = s;
  match.points = [0, 0];
  match.ends = [match.ends[1], match.ends[0]];
  match.gameFirstServer = other(match.gameFirstServer);
  s.server = match.gameFirstServer;
}

function movePlayer(s: SimState, i: SideIndex, intent: Intent, t: SimTuning) {
  const player = s.sides[i].players[0];
  const end = endOf(s, i);
  const f = facing(end);
  const mx = intent.move.x;
  const my = intent.move.y;
  const mag = Math.hypot(mx, my);
  const scale = mag > 1 ? 1 / mag : 1;
  const want = localToWorld(end, mx * scale * t.playerSpeed, my * scale * t.playerSpeed);

  const serving = s.phase === 'serve' && i === s.server;
  if (serving) want.z = 0;

  // Close to a committed ball, the assist takes over footwork and move input only aims.
  const { ball } = s;
  const incoming = player.commit !== null && s.phase === 'rally' && ball.lastHitBy !== i;
  const ballDistance = Math.hypot(ball.pos.x - player.pos.x, ball.pos.z - player.pos.z);
  player.aiming = incoming && ballDistance < t.reachForward + t.assistRange && ball.pos.y < t.reachHeight + 0.5;
  if (player.aiming) {
    want.x = 0;
    want.z = 0;
  }

  const maxDelta = t.playerAccel * TICK;
  player.vel.x += clamp(want.x - player.vel.x, -maxDelta, maxDelta);
  player.vel.z += clamp(want.z - player.vel.z, -maxDelta, maxDelta);

  // The assist steers so the ball passes through the sweet spot.
  let assistX = 0;
  let assistZ = 0;
  if (player.aiming) {
    const sweet = localToWorld(end, t.sweetSpotSide, t.sweetSpotForward);
    const dx = ball.pos.x - sweet.x - player.pos.x;
    const dz = ball.pos.z - sweet.z - player.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.02) {
      const speed = Math.min(t.assistSpeed, d / TICK);
      assistX = (dx / d) * speed;
      assistZ = (dz / d) * speed;
    }
  }

  const wasOutsideKitchen = !inKitchen(player, t);
  player.pos.x += (player.vel.x + assistX) * TICK;
  player.pos.z += (player.vel.z + assistZ) * TICK;
  player.speed = Math.hypot(player.vel.x + assistX, player.vel.z + assistZ);

  // The assist owns footwork here, so it must never walk the Player into a Kitchen fault.
  if (player.aiming && ball.bouncesSinceHit === 0 && wasOutsideKitchen && inKitchen(player, t)) {
    player.pos.z = -f * (KITCHEN_DEPTH + t.footRadius);
    player.vel.z = 0;
  }

  if (serving) {
    const half = Math.sign(player.pos.x) || 1;
    player.pos.x = half * clamp(Math.abs(player.pos.x), 0.2, HALF_WIDTH - 0.1);
    player.pos.z = -f * (HALF_LENGTH + BASELINE_OFFSET);
    player.vel.z = 0;
  } else {
    player.pos.x = clamp(player.pos.x, -HALF_WIDTH - 3, HALF_WIDTH + 3);
    // Own half only: never cross the net plane.
    const back = HALF_LENGTH + 4;
    player.pos.z = f < 0 ? clamp(player.pos.z, 0.25, back) : clamp(player.pos.z, -back, -0.25);
  }
}

function setUpServe(s: SimState) {
  s.phase = 'serve';
  s.phaseTick = s.tick;
  s.shots = 0;
  const server = s.server;
  const receiver = other(server);
  const serverX = -serviceCourtSign(s) * SERVE_X;
  place(s.sides[server].players[0], endOf(s, server), serverX);
  // The receiver stands diagonally opposite, which is the same world x mirrored.
  place(s.sides[receiver].players[0], endOf(s, receiver), -serverX);
  s.ball.vel = { x: 0, y: 0, z: 0 };
  s.ball.spin = 0;
  s.ball.lastHitBy = null;
  s.ball.bouncesSinceHit = 0;
  s.ball.hitTick = s.tick;
  holdBall(s);
}

function place(p: Player, end: End, x: number) {
  p.pos = { x, y: 0, z: -facing(end) * (HALF_LENGTH + BASELINE_OFFSET) };
  p.vel = { x: 0, y: 0, z: 0 };
  p.commit = null;
  p.aiming = false;
  p.speed = 0;
}

function holdBall(s: SimState) {
  const player = s.sides[s.server].players[0];
  const offset = localToWorld(endOf(s, s.server), 0.3, 0.35);
  s.ball.pos = { x: player.pos.x + offset.x, y: 0.75, z: player.pos.z + offset.z };
}

function depthFor(tuning: ShotTuning, aimY: number): number {
  const d = tuning.depth + clamp(aimY, -1, 1) * tuning.depthRange;
  return clamp(d, tuning.minDepth, tuning.maxDepth);
}

export function other(side: SideIndex): SideIndex {
  return side === 0 ? 1 : 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}
