// A full SimState on the wire (ADR-0004). It's plain data, so JSON carries it. JSON turns -0 into 0, which
// steps identically (tested).
import type { SimState } from '../sim';

export function encodeState(s: SimState): string {
  return JSON.stringify(s);
}

export function decodeState(raw: string): SimState {
  return JSON.parse(raw) as SimState;
}
