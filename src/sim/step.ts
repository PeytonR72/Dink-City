import {
  BALL_RADIUS,
  HALF_LENGTH,
  HALF_WIDTH,
  facing,
  isInBounds,
  localToWorld,
  sideOfZ,
  worldToLocal,
} from './court';
import { integrateBall } from './physics';
import { nextRandom } from './rng';
import { TICK, netClearance, simulateFlight, solveShot, solveTimedShot } from './solver';
import type {
  DeadReason,
  Intent,
  Player,
  ShotTuning,
  ShotType,
  SideIndex,
  SimState,
  SimTuning,
  Vec2,
  Vec3,
} from './types';

const SERVE_DELAY_TICKS = 15;
const SERVE_X = 1.52;
const BASELINE_OFFSET = 0.3;
const FAR = 10;

export function createInitialState(seed: number): SimState {
  const player = (): Player => ({
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    commit: null,
    aiming: false,
    swing: null,
  });
  const s: SimState = {
    tick: 0,
    rng: seed >>> 0,
    phase: 'serve',
    phaseTick: 0,
    server: 0,
    serveCount: 0,
    ball: { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, spin: 0, lastHitBy: null, bouncesSinceHit: 0 },
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
    if (s.phase === 'rally') checkContact(s, intents, t);
  } else if (s.tick - s.phaseTick >= t.deadTicks) {
    s.serveCount++;
    s.server = (s.serveCount % 2) as SideIndex;
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
  if (s.phase === 'rally') player.commit = { type: shot, tick: s.tick, bestDistance: null };
}

function serve(s: SimState, i: SideIndex, shot: ShotType, intent: Intent, t: SimTuning) {
  const kind = shot === 'drive' ? 'drive' : 'soft';
  const tuning = t.serves[kind];
  const player = s.sides[i].players[0];
  const f = facing(i);
  const diagonalX = -Math.sign(player.pos.x) * SERVE_X;
  const lateral = localToWorld(i, clamp(intent.aim.x, -1, 1) * tuning.width, 0).x;
  const target = {
    x: clamp(diagonalX + lateral, -HALF_WIDTH + 0.15, HALF_WIDTH - 0.15),
    z: f * depthFor(tuning, intent.aim.y),
  };
  const vel = solveShot(s.ball.pos, target, tuning.apex, tuning.spin, t);
  launch(s, i, kind, vel, tuning.spin);
  s.phase = 'rally';
  s.phaseTick = s.tick;
}

function checkContact(s: SimState, intents: readonly [Intent, Intent], t: SimTuning) {
  const { ball } = s;
  for (const i of [0, 1] as const) {
    const player = s.sides[i].players[0];
    if (!player.commit) continue;
    if (ball.lastHitBy === i || sideOfZ(ball.pos.z) !== i || ball.bouncesSinceHit > 1) {
      player.commit.bestDistance = null;
      continue;
    }
    const d = sweetSpotDistance(player, i, ball.pos, t);
    if (d === null) continue;

    // Wait for the ball to reach its closest point to the sweet spot, but
    // never let it leave reach unhit.
    const next = { x: ball.pos.x + ball.vel.x * TICK, y: ball.pos.y + ball.vel.y * TICK, z: ball.pos.z + ball.vel.z * TICK };
    const leaving = sweetSpotDistance(player, i, next, t) === null;
    const best = player.commit.bestDistance;
    if (d > t.sweetRadius && !leaving && (best === null || d < best)) {
      player.commit.bestDistance = d;
      continue;
    }

    hit(s, i, player.commit.type, qualityAt(d, t), intents[i].aim, t);
    return;
  }
}

/**
 * Normalized distance (0 = sweet spot, 1 = edge of reach) from the Player's
 * sweet spot to a ball position, or null when out of reach.
 */
function sweetSpotDistance(player: Player, i: SideIndex, pos: Vec3, t: SimTuning): number | null {
  if (pos.y > t.reachHeight) return null;
  const l = worldToLocal(i, pos.x - player.pos.x, pos.z - player.pos.z);
  if (Math.hypot(l.x / t.reachSide, l.y / (l.y >= 0 ? t.reachForward : t.reachBack)) > 1) return null;
  const dx = (l.x - t.sweetSpotSide) / t.reachSide;
  const dy =
    l.y >= t.sweetSpotForward
      ? (l.y - t.sweetSpotForward) / (t.reachForward - t.sweetSpotForward)
      : (t.sweetSpotForward - l.y) / (t.sweetSpotForward + t.reachBack);
  return Math.min(1, Math.hypot(dx, dy));
}

function qualityAt(distance: number, t: SimTuning): number {
  if (distance <= t.sweetRadius) return 1;
  const k = (distance - t.sweetRadius) / (1 - t.sweetRadius);
  return 1 + (t.edgeQuality - 1) * k;
}

function hit(s: SimState, i: SideIndex, type: ShotType, quality: number, aim: Vec2, t: SimTuning) {
  const { ball } = s;
  const tuning = t.shots[type];
  const weak = 1 - quality;
  const lateral = localToWorld(i, clamp(aim.x, -1, 1) * tuning.width, 0).x;
  const depth = Math.max(0.5, depthFor(tuning, aim.y) - weak * tuning.weakDepth);
  const target = { x: clamp(lateral, -HALF_WIDTH + 0.15, HALF_WIDTH - 0.15), z: facing(i) * depth };

  let smash = false;
  let vel: Vec3 | null = null;
  if (type === 'drive' && ball.pos.y >= t.smashHeight) {
    const speed = t.smashSpeed * (0.6 + 0.4 * quality);
    const v = solveTimedShot(ball.pos, target, speed, tuning.spin, t);
    // A smash from too deep would go into the net; fall back to a normal Drive.
    if (netClearance(simulateFlight(ball.pos, v, tuning.spin, t)) > 0.05) {
      vel = v;
      smash = true;
    }
  }
  if (!vel) {
    const apex = tuning.apex + tuning.apexPerMeter * Math.abs(ball.pos.z) + weak * tuning.weakApex;
    vel = solveShot(ball.pos, target, apex, tuning.spin, t);
  }
  launch(s, i, type, vel, tuning.spin, { smash, quality });
}

function launch(
  s: SimState,
  i: SideIndex,
  type: ShotType,
  vel: Vec3,
  spin: number,
  info: { smash: boolean; quality: number } = { smash: false, quality: 1 },
) {
  const { ball } = s;
  const player = s.sides[i].players[0];
  ball.vel = vel;
  ball.spin = spin;
  ball.lastHitBy = i;
  ball.bouncesSinceHit = 0;
  player.commit = null;
  player.aiming = false;
  player.swing = { type, tick: s.tick };
  s.events.push({ kind: 'hit', side: i, type, ...info, pos: { ...ball.pos }, speed: length(ball.vel) });
}

function onBounce(s: SimState, pos: Vec3) {
  const { ball } = s;
  ball.bouncesSinceHit++;
  if (ball.bouncesSinceHit >= 2) return die(s, 'double-bounce');
  if (ball.lastHitBy !== null && sideOfZ(pos.z) === ball.lastHitBy) return die(s, 'net');
  if (!isInBounds(pos.x, pos.z)) return die(s, 'out');
}

function checkRolling(s: SimState) {
  const { ball } = s;
  const onGround = ball.pos.y <= BALL_RADIUS + 1e-6 && ball.vel.y === 0;
  if (onGround) {
    return die(s, ball.lastHitBy !== null && sideOfZ(ball.pos.z) === ball.lastHitBy ? 'net' : 'double-bounce');
  }
  if (Math.abs(ball.pos.x) > HALF_WIDTH + FAR || Math.abs(ball.pos.z) > HALF_LENGTH + FAR) die(s, 'gone');
}

function die(s: SimState, reason: DeadReason) {
  s.phase = 'dead';
  s.phaseTick = s.tick;
  for (const side of s.sides) for (const p of side.players) p.commit = null;
  s.events.push({ kind: 'dead', reason });
}

function movePlayer(s: SimState, i: SideIndex, intent: Intent, t: SimTuning) {
  const player = s.sides[i].players[0];
  const f = facing(i);
  const mx = intent.move.x;
  const my = intent.move.y;
  const mag = Math.hypot(mx, my);
  const scale = mag > 1 ? 1 / mag : 1;
  const want = localToWorld(i, mx * scale * t.playerSpeed, my * scale * t.playerSpeed);

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
    const sweet = localToWorld(i, t.sweetSpotSide, t.sweetSpotForward);
    const dx = ball.pos.x - sweet.x - player.pos.x;
    const dz = ball.pos.z - sweet.z - player.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.02) {
      const speed = Math.min(t.assistSpeed, d / TICK);
      assistX = (dx / d) * speed;
      assistZ = (dz / d) * speed;
    }
  }

  player.pos.x += (player.vel.x + assistX) * TICK;
  player.pos.z += (player.vel.z + assistZ) * TICK;

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
  const server = s.server;
  const receiver: SideIndex = server === 0 ? 1 : 0;
  // Right-hand service court on even serves, left on odd.
  const localX = s.serveCount % 2 === 0 ? SERVE_X : -SERVE_X;
  place(s.sides[server].players[0], server, localToWorld(server, localX, 0).x);
  // The receiver stands diagonally opposite, which is the same world x mirrored.
  place(s.sides[receiver].players[0], receiver, -localToWorld(server, localX, 0).x);
  s.ball.vel = { x: 0, y: 0, z: 0 };
  s.ball.spin = 0;
  s.ball.lastHitBy = null;
  s.ball.bouncesSinceHit = 0;
  holdBall(s);
}

function place(p: Player, side: SideIndex, x: number) {
  p.pos = { x, y: 0, z: -facing(side) * (HALF_LENGTH + BASELINE_OFFSET) };
  p.vel = { x: 0, y: 0, z: 0 };
  p.commit = null;
  p.aiming = false;
}

function holdBall(s: SimState) {
  const player = s.sides[s.server].players[0];
  const offset = localToWorld(s.server, 0.3, 0.35);
  s.ball.pos = { x: player.pos.x + offset.x, y: 0.75, z: player.pos.z + offset.z };
}

function depthFor(tuning: ShotTuning, aimY: number): number {
  const d = tuning.depth + clamp(aimY, -1, 1) * tuning.depthRange;
  return clamp(d, tuning.minDepth, tuning.maxDepth);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}
