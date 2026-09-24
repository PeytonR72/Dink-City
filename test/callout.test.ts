import { describe, expect, it } from 'vitest';
import { calloutFor } from '../src/hud/callout';
import type { SimEvent } from '../src/sim';

const hit = (side: 0 | 1, variant: 'smash' | 'drive' | 'dink'): SimEvent => ({
  kind: 'hit',
  side,
  type: variant === 'dink' ? 'soft' : 'drive',
  variant,
  volley: false,
  quality: 1,
  factors: { set: 1, timing: 1, height: 1, pace: 1 },
  pos: { x: 0, y: 1, z: 3 },
  speed: 20,
});

describe('call-outs', () => {
  it('calls SMASH! on the local Player’s Smash only', () => {
    expect(calloutFor(hit(0, 'smash'), 0)).toBe('SMASH!');
    expect(calloutFor(hit(1, 'smash'), 0)).toBeNull();
  });

  it('stays quiet on ordinary shots', () => {
    expect(calloutFor(hit(0, 'drive'), 0)).toBeNull();
    expect(calloutFor(hit(0, 'dink'), 0)).toBeNull();
  });

  it('calls WINNER when the local Player’s shot goes unreturned', () => {
    expect(calloutFor({ kind: 'dead', reason: 'double-bounce', loser: 1 }, 0)).toBe('WINNER');
    expect(calloutFor({ kind: 'dead', reason: 'double-bounce', loser: 0 }, 0)).toBeNull();
  });

  it('leaves Faults to the Fault banner', () => {
    expect(calloutFor({ kind: 'dead', reason: 'out', loser: 1 }, 0)).toBeNull();
    expect(calloutFor({ kind: 'dead', reason: 'kitchen', loser: 1 }, 0)).toBeNull();
  });
});
