// A full SimState on the wire (ADR-0004). It's plain data, so JSON carries it. JSON turns -0 into 0, which
// steps identically (tested).
import type { SimState } from '../sim';

/** A Snapshot for the wire. */
export function encodeState(s: SimState): string {
  return JSON.stringify(s);
}

/** Trusts `raw` to be an encoded SimState; only the Court sends Snapshots. */
export function decodeState(raw: string): SimState {
  return JSON.parse(raw) as SimState;
}
