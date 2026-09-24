import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { solveTwoBone } from '../src/render/ik';

describe('2-bone IK', () => {
  const root = new Vector3(0, 1, 0);
  const pole = new Vector3(0, 0, 1);

  it('reaches a target in range, keeping both bone lengths', () => {
    const target = new Vector3(0.3, 0.4, -0.2);
    const { mid, end } = solveTwoBone(root, target, 0.5, 0.5, pole);
    expect(end.distanceTo(target)).toBeLessThan(1e-6);
    expect(mid.distanceTo(root)).toBeCloseTo(0.5, 6);
    expect(end.distanceTo(mid)).toBeCloseTo(0.5, 6);
  });

  it('bends toward the pole', () => {
    const { mid } = solveTwoBone(root, new Vector3(0, 0.3, 0), 0.5, 0.5, pole);
    expect(mid.z).toBeGreaterThan(0.2);
  });

  it('straightens toward a target out of reach', () => {
    const target = new Vector3(0, 1, -3);
    const { mid, end } = solveTwoBone(root, target, 0.5, 0.5, pole);
    expect(end.distanceTo(root)).toBeCloseTo(1, 3);
    expect(end.z).toBeLessThan(-0.99);
    expect(mid.distanceTo(root)).toBeCloseTo(0.5, 3);
  });
});
