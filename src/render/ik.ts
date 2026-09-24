// Analytic 2-bone IK (shoulder-elbow-hand, hip-knee-foot).
import { Vector3 } from 'three';

/**
 * Joint positions for a two-bone chain from `root` toward `target`. The middle
 * joint bends toward `pole`. A target out of reach straightens the chain.
 */
export function solveTwoBone(
  root: Vector3,
  target: Vector3,
  upper: number,
  lower: number,
  pole: Vector3,
): { mid: Vector3; end: Vector3 } {
  const toTarget = target.clone().sub(root);
  const dir = toTarget.lengthSq() > 1e-12 ? toTarget.clone().normalize() : new Vector3(0, -1, 0);
  const d = Math.min(Math.max(toTarget.length(), Math.abs(upper - lower) + 1e-4), upper + lower - 1e-4);
  // Law of cosines: how far along the chain the middle joint sits, and how far off it.
  const along = (upper * upper - lower * lower + d * d) / (2 * d);
  const off = Math.sqrt(Math.max(0, upper * upper - along * along));
  const bend = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir)));
  if (bend.lengthSq() < 1e-12) bend.set(dir.y, -dir.x, 0);
  bend.normalize();
  const mid = root.clone().addScaledVector(dir, along).addScaledVector(bend, off);
  const end = root.clone().addScaledVector(dir, d);
  return { mid, end };
}
