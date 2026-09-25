import { describe, expect, it } from 'vitest';
import { REST, easePose, focusPose, type Pose, type Vec3 } from '../src/menu/mapCamera';

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3) => Math.hypot(...a);
const unit = (a: Vec3): Vec3 => a.map((c) => c / len(a)) as unknown as Vec3;
const park: Vec3 = [-5.1, 0.5, 1.4];

describe('the map camera', () => {
  it('moves toward a focused Venue along its line of sight, so the Venue stays put on screen', () => {
    const pose = focusPose(park);
    unit(sub(park, pose.position)).forEach((c, i) => expect(c).toBeCloseTo(unit(sub(park, REST.position))[i], 9));
    expect(len(sub(park, pose.position))).toBeLessThan(len(sub(park, REST.position)) * 0.8);
  });

  it("doesn't turn while it moves", () => {
    const pose = focusPose(park);
    sub(pose.target, pose.position).forEach((c, i) => expect(c).toBeCloseTo(sub(REST.target, REST.position)[i], 9));
  });

  it('eases toward where it is going, the same at any frame rate', () => {
    const goal = focusPose(park);
    const once = easePose(REST, goal, 0.1);
    const twice = easePose(easePose(REST, goal, 0.05), goal, 0.05);
    const gap = (p: Pose) => len(sub(p.position, goal.position));
    expect(gap(once)).toBeLessThan(gap(REST));
    once.position.forEach((c, i) => expect(c).toBeCloseTo(twice.position[i], 9));
    expect(gap(easePose(REST, goal, 5))).toBeLessThan(1e-3);
    expect(easePose(REST, goal, 0)).toEqual(REST);
  });
});
