import { describe, expect, it } from 'vitest';
import { COURT_CODE_ALPHABET, COURT_CODE_LENGTH, isCourtCode, makeCourtCode } from '../../party/src/courtCode';

/** Hands out the given bytes in order, then zeros. */
function bytes(...values: number[]): (n: number) => Uint8Array {
  let i = 0;
  return (n) => Uint8Array.from({ length: n }, () => values[i++] ?? 0);
}

describe('Court codes', () => {
  it('uses no ambiguous characters', () => {
    for (const c of 'O0I1L') expect(COURT_CODE_ALPHABET).not.toContain(c);
  });

  it('maps bytes onto the alphabet', () => {
    expect(makeCourtCode(bytes(0, 1, 2, 30, 31))).toBe('ABC9A');
  });

  it('skips bytes that would bias the alphabet', () => {
    // 248 = 8 × 31, so 248–255 are thrown away and more bytes drawn.
    expect(makeCourtCode(bytes(255, 248, 3, 4, 5, 6, 7))).toBe('DEFGH');
  });

  it('makes valid codes from real randomness', () => {
    const random = (n: number) => Uint8Array.from({ length: n }, () => Math.floor(Math.random() * 256));
    for (let n = 0; n < 200; n++) {
      const code = makeCourtCode(random);
      expect(code).toHaveLength(COURT_CODE_LENGTH);
      expect(isCourtCode(code)).toBe(true);
    }
  });

  it('recognizes codes', () => {
    expect(isCourtCode('ABC9A')).toBe(true);
    for (const v of ['abc9a', 'ABC9', 'ABC9AA', 'ABC0A', 7, null]) expect(isCourtCode(v)).toBe(false);
  });
});
