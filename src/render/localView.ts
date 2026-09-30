// Which way this screen looks at the court: pure, so it's testable without three.js.
import { endOf, other, type SideIndex, type SimState } from '../sim';

export interface LocalView {
  /** The world turns 180° when the local Player is at End 1, so they always appear at the bottom. */
  mirrored: boolean;
  /** The local Player's x on screen, which the camera follows. */
  followX: number;
  /** The Side that shows its Commit ring. */
  ring: SideIndex;
  /** The Side whose shots get a landing marker. */
  landingFrom: SideIndex;
}

export function localView(s: SimState, local: SideIndex): LocalView {
  const mirrored = endOf(s, local) === 1;
  const x = s.sides[local].players[0].pos.x;
  return { mirrored, followX: mirrored ? -x : x, ring: local, landingFrom: other(local) };
}
