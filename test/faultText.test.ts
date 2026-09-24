import { describe, expect, it } from 'vitest';
import { faultText } from '../src/hud/faultText';
import type { DeadReason } from '../src/sim';

describe('Fault banner text', () => {
  it('explains a Kitchen fault by the local Player', () => {
    expect(faultText('kitchen', true)).toEqual({
      title: 'KITCHEN FAULT',
      detail: 'You volleyed while standing in the kitchen.',
    });
  });

  it("explains the opponent's Fault from their side", () => {
    expect(faultText('kitchen', false).detail).toBe('They volleyed while standing in the kitchen.');
  });

  it('explains a serve into the Kitchen', () => {
    expect(faultText('service-kitchen', true)).toEqual({
      title: 'SERVICE FAULT',
      detail: 'Your serve landed in the kitchen.',
    });
  });

  it('has a title and a one-sentence explanation for every reason', () => {
    const reasons: DeadReason[] = ['out', 'net', 'double-bounce', 'service-kitchen', 'service-court', 'two-bounce', 'kitchen'];
    for (const reason of reasons) {
      for (const you of [true, false]) {
        const { title, detail } = faultText(reason, you);
        expect(title).toMatch(/^[A-Z -]+$/);
        expect(detail).toMatch(/^[A-Z].*\.$/);
      }
    }
  });
});
