// Plain, serializable Sim data. No classes, no three.js (ADR-0001).

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

export type SideIndex = 0 | 1;

export type ShotType = 'soft' | 'drive' | 'lob';

/**
 * One Tick of input for one Player. `move` and `aim` are in the Player's local
 * frame: +x is the Player's right, +y is forward (toward the net).
 */
export interface Intent {
  move: Vec2;
  aim: Vec2;
  /** Shot button pressed this Tick, if any. */
  shot: ShotType | null;
}

export interface Commit {
  type: ShotType;
  tick: number;
  /** Closest sweet-spot distance seen so far while the ball is in reach. */
  bestDistance: number | null;
}

export interface Swing {
  type: ShotType;
  tick: number;
}

export interface Player {
  /** Feet position on the ground plane (y is always 0). */
  pos: Vec3;
  vel: Vec3;
  commit: Commit | null;
  /**
   * Committed and the ball is close: the contact assist owns footwork and
   * move input only aims.
   */
  aiming: boolean;
  /** Most recent swing, for animation. */
  swing: Swing | null;
}

export interface Side {
  players: Player[];
}

export interface Ball {
  pos: Vec3;
  vel: Vec3;
  /** Topspin (+) / backspin (-), -1..1. A fixed property of the last shot. */
  spin: number;
  /** Side that last hit the ball, or null while held for a Serve. */
  lastHitBy: SideIndex | null;
  bouncesSinceHit: number;
}

export type Phase = 'serve' | 'rally' | 'dead';

export type DeadReason = 'out' | 'double-bounce' | 'net' | 'gone';

export type SimEvent =
  | { kind: 'hit'; side: SideIndex; type: ShotType; smash: boolean; quality: number; pos: Vec3; speed: number }
  | { kind: 'bounce'; pos: Vec3; speed: number }
  | { kind: 'net'; pos: Vec3; cord: boolean }
  | { kind: 'dead'; reason: DeadReason };

export interface SimState {
  tick: number;
  /** Seeded RNG state (uint32). */
  rng: number;
  phase: Phase;
  phaseTick: number;
  server: SideIndex;
  serveCount: number;
  ball: Ball;
  sides: [Side, Side];
  /** Events emitted during the most recent step only. */
  events: SimEvent[];
}

export interface SimTuning {
  gravity: number;
  /** Drag acceleration = drag * speed * velocity. */
  drag: number;
  /** Extra downward acceleration per unit of topspin per m/s of speed. */
  magnus: number;
  /** Vertical coefficient of restitution on the court. */
  restitution: number;
  /** Horizontal velocity kept on a bounce with no spin. */
  bounceFriction: number;
  /** Extra horizontal velocity kept per unit of topspin on a bounce. */
  spinKick: number;
  substeps: number;

  playerSpeed: number;
  playerAccel: number;
  /**
   * Reach is an oval in the Player's local frame: long in front, shorter to
   * the sides, short behind.
   */
  reachForward: number;
  reachSide: number;
  reachBack: number;
  reachHeight: number;
  /** Where in the reach oval the sweet spot sits (local right, forward). */
  sweetSpotSide: number;
  sweetSpotForward: number;
  /** Fraction of the oval (from the sweet spot) that still gives full quality. */
  sweetRadius: number;
  /** Quality at the very edge of reach. */
  edgeQuality: number;
  /** Extra range beyond reach where the contact assist pulls the Player in, and move input switches to aim. */
  assistRange: number;
  assistSpeed: number;

  /** Drive contact at or above this height becomes a Smash. */
  smashHeight: number;
  smashSpeed: number;

  deadTicks: number;

  shots: Record<ShotType, ShotTuning>;
  serves: Record<'soft' | 'drive', ShotTuning>;
}

export interface ShotTuning {
  /** Target distance past the net, in meters. */
  depth: number;
  /** How far forward/back Aim moves the target. */
  depthRange: number;
  minDepth: number;
  maxDepth: number;
  /** Apex height above the ground. */
  apex: number;
  /** Additional apex per meter of distance from the net (so drops arc higher than dinks). */
  apexPerMeter: number;
  spin: number;
  /** Lateral target at full left/right Aim. */
  width: number;
  /** At zero quality: extra apex (a loopier, slower ball)... */
  weakApex: number;
  /** ...and this much shorter. */
  weakDepth: number;
}
