// Regulation court dimensions, in meters. Net is at z = 0; Side 0 plays from +z.
import type { SideIndex } from './types';

export const COURT_WIDTH = 6.096; // 20 ft
export const COURT_LENGTH = 13.411; // 44 ft
export const HALF_WIDTH = COURT_WIDTH / 2;
export const HALF_LENGTH = COURT_LENGTH / 2;
export const KITCHEN_DEPTH = 2.134; // 7 ft
export const NET_HEIGHT_POST = 0.914; // 36 in
export const NET_HEIGHT_CENTER = 0.864; // 34 in
export const NET_POST_X = 3.353; // posts 22 ft apart

export const BALL_RADIUS = 0.037;

/** Net top height at lateral position x. */
export function netHeight(x: number): number {
  const t = Math.min(Math.abs(x) / NET_POST_X, 1);
  return NET_HEIGHT_CENTER + (NET_HEIGHT_POST - NET_HEIGHT_CENTER) * t;
}

/** World z of "forward" for a Side: Side 0 faces -z, Side 1 faces +z. */
export function facing(side: SideIndex): 1 | -1 {
  return side === 0 ? -1 : 1;
}

/** Which Side's half a world z lies in. */
export function sideOfZ(z: number): SideIndex {
  return z >= 0 ? 0 : 1;
}

export function isInBounds(x: number, z: number): boolean {
  return Math.abs(x) <= HALF_WIDTH && Math.abs(z) <= HALF_LENGTH;
}

/** Convert a local (right, forward) vector to world (x, z) for a Side. */
export function localToWorld(side: SideIndex, lx: number, ly: number): { x: number; z: number } {
  const f = facing(side);
  return { x: -f * lx, z: f * ly };
}

export function worldToLocal(side: SideIndex, wx: number, wz: number): { x: number; y: number } {
  const f = facing(side);
  return { x: -f * wx, y: f * wz };
}
