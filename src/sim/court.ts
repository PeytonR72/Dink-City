// Regulation court dimensions, in meters. Net is at z = 0; End 0 is the +z half.
import type { End } from './types';

export const COURT_WIDTH = 6.096; // 20 ft
export const COURT_LENGTH = 13.411; // 44 ft
export const HALF_WIDTH = COURT_WIDTH / 2;
export const HALF_LENGTH = COURT_LENGTH / 2;
export const KITCHEN_DEPTH = 2.134; // 7 ft
/** Half the width of the 2 in centerline, which counts as in for both Service courts. */
export const CENTERLINE_HALF = 0.025;
export const NET_HEIGHT_POST = 0.914; // 36 in
export const NET_HEIGHT_CENTER = 0.864; // 34 in
export const NET_POST_X = 3.353; // posts 22 ft apart

export const BALL_RADIUS = 0.037;

/** Net top height at lateral position x. */
export function netHeight(x: number): number {
  const t = Math.min(Math.abs(x) / NET_POST_X, 1);
  return NET_HEIGHT_CENTER + (NET_HEIGHT_POST - NET_HEIGHT_CENTER) * t;
}

/** World z of "forward" from an End: End 0 faces -z, End 1 faces +z. */
export function facing(end: End): 1 | -1 {
  return end === 0 ? -1 : 1;
}

/** Which End a world z lies in. */
export function endOfZ(z: number): End {
  return z >= 0 ? 0 : 1;
}

export function isInBounds(x: number, z: number): boolean {
  return Math.abs(x) <= HALF_WIDTH && Math.abs(z) <= HALF_LENGTH;
}

/** Convert a local (right, forward) vector to world (x, z) for a Player at an End. */
export function localToWorld(end: End, lx: number, ly: number): { x: number; z: number } {
  const f = facing(end);
  return { x: -f * lx, z: f * ly };
}

export function worldToLocal(end: End, wx: number, wz: number): { x: number; y: number } {
  const f = facing(end);
  return { x: -f * wx, y: f * wz };
}
