// What a Bot is allowed to see (ADR-0003): what a player on court could see.
// Bots take an Observation, never the SimState, so they can't peek at Sim internals.
import { endOf, other, type End, type Phase, type ShotType, type ShotVariant, type SideIndex, type SimState, type Vec3 } from '../sim';

export interface Observation {
  tick: number;
  phase: Phase;
  /** Tick the current phase started. */
  phaseTick: number;
  myEnd: End;
  server: SideIndex;
  /** Hits so far this Rally, the Serve included. Players count these too. */
  shots: number;
  ball: {
    pos: Vec3;
    vel: Vec3;
    lastHitBy: SideIndex | null;
    bouncesSinceHit: number;
  };
  /** The Shot type and variant of the last swing, which a player reads from the hitter's swing. */
  lastShot: ShotType | null;
  lastVariant: ShotVariant | null;
  myPos: Vec3;
  /** Whether my shot button is already pressed for this ball. */
  committed: boolean;
  opponentPos: Vec3;
}

export function observe(s: SimState, me: SideIndex): Observation {
  const self = s.sides[me].players[0];
  const hitter = s.ball.lastHitBy === null ? null : s.sides[s.ball.lastHitBy].players[0];
  return {
    tick: s.tick,
    phase: s.phase,
    phaseTick: s.phaseTick,
    myEnd: endOf(s, me),
    server: s.server,
    shots: s.shots,
    ball: {
      pos: { ...s.ball.pos },
      vel: { ...s.ball.vel },
      lastHitBy: s.ball.lastHitBy,
      bouncesSinceHit: s.ball.bouncesSinceHit,
    },
    lastShot: hitter?.swing?.type ?? null,
    lastVariant: hitter?.swing?.variant ?? null,
    myPos: { ...self.pos },
    committed: self.commit !== null,
    opponentPos: { ...s.sides[other(me)].players[0].pos },
  };
}
