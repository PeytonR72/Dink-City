// Chunky text call-outs for the local Player's big moments. Faults already get
// the Fault banner, so they aren't called out here.
import type { SideIndex, SimEvent } from '../sim';

export function calloutFor(e: SimEvent, local: SideIndex): string | null {
  if (e.kind === 'hit' && e.side === local && e.variant === 'smash') return 'SMASH!';
  // A double bounce on the opponent's side is always the local Player's shot.
  if (e.kind === 'dead' && e.reason === 'double-bounce' && e.loser !== local) return 'WINNER';
  return null;
}
