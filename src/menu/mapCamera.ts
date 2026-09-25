// Where the Dink City map's camera looks from, and how it moves when a Venue's pin is hovered or focused.
// Plain math, in the map model's units (art/scripts/map.py: the board is 14 x 8).

export type Vec3 = readonly [number, number, number];

export interface Pose {
  position: Vec3;
  target: Vec3;
}

/** The whole board in view, tilted like a tabletop. */
export const REST: Pose = { position: [0, 14.5, 10.5], target: [0, 0, -1.9] };

/** How far toward a focused Venue the camera moves, as a share of the way. */
const ZOOM = 0.4;
/** How quickly the camera eases: the share of the way left after t seconds is exp(-RATE * t). */
const RATE = 4;

/**
 * The camera moved straight toward `anchor`, without turning: the anchor stays on the same line of sight, so its
 * pin stays under the pointer while the rest of the map spreads out around it.
 */
export function focusPose(anchor: Vec3, from: Pose = REST): Pose {
  const d = anchor.map((c, i) => (c - from.position[i]) * ZOOM);
  return { position: add(from.position, d), target: add(from.target, d) };
}

/** `from` eased toward `to` over `dt` seconds. */
export function easePose(from: Pose, to: Pose, dt: number): Pose {
  if (dt <= 0) return from;
  const k = 1 - Math.exp(-RATE * dt);
  const mix = (a: Vec3, b: Vec3): Vec3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  return { position: mix(from.position, to.position), target: mix(from.target, to.target) };
}

function add(a: Vec3, d: readonly number[]): Vec3 {
  return [a[0] + d[0], a[1] + d[1], a[2] + d[2]];
}
