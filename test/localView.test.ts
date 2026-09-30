import { describe, expect, it } from 'vitest';
import { localView } from '../src/render/localView';
import { createInitialState, type End, type SideIndex, type SimState } from '../src/sim';

/** A state with Side `side` at End `end`, standing at world x = `x`. */
function at(side: SideIndex, end: End, x: number): SimState {
  const s = createInitialState(1);
  s.match.ends = side === 0 ? [end, end === 0 ? 1 : 0] : [end === 0 ? 1 : 0, end];
  s.sides[side].players[0].pos.x = x;
  return s;
}

describe('the local view', () => {
  it('draws Side 0 at End 0 as is', () => {
    expect(localView(at(0, 0, 1.2), 0)).toEqual({ mirrored: false, followX: 1.2, ring: 0, landingFrom: 1 });
  });

  it('mirrors Side 0 at End 1', () => {
    expect(localView(at(0, 1, 1.2), 0)).toEqual({ mirrored: true, followX: -1.2, ring: 0, landingFrom: 1 });
  });

  it('mirrors the local Player on Side 1 at End 1, following their mirrored x', () => {
    expect(localView(at(1, 1, 0.8), 1)).toEqual({ mirrored: true, followX: -0.8, ring: 1, landingFrom: 0 });
  });

  it('draws the local Player on Side 1 at End 0 as is', () => {
    expect(localView(at(1, 0, 0.8), 1)).toEqual({ mirrored: false, followX: 0.8, ring: 1, landingFrom: 0 });
  });

  it('follows the local Player, not the other one', () => {
    const s = at(1, 1, 0.8);
    s.sides[0].players[0].pos.x = -2;
    expect(localView(s, 1).followX).toBe(-0.8);
    // Side 0 is at End 0 here, so it isn't mirrored.
    expect(localView(s, 0).followX).toBe(-2);
  });
});
