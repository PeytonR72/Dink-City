import { describe, expect, it } from 'vitest';
import { REVEAL, reveal, revealSeconds } from '../src/hud/reveal';

// "NET CITY" over "The ball actually needs to go OVER the net."
const WORDS = 2;
const CHARS = 43;
const typingStarts = REVEAL.wordGap + REVEAL.typeDelay;

describe('the emphasised banner reveal', () => {
  it('pops the first word at once, with nothing typed', () => {
    expect(reveal(WORDS, CHARS, 0)).toEqual({ words: 1, chars: 0 });
  });

  it('pops the next word after a gap', () => {
    expect(reveal(WORDS, CHARS, REVEAL.wordGap - 0.01).words).toBe(1);
    expect(reveal(WORDS, CHARS, REVEAL.wordGap)).toEqual({ words: 2, chars: 0 });
  });

  it('types the detail only once every word is in, a letter at a time', () => {
    expect(reveal(WORDS, CHARS, typingStarts - 0.01).chars).toBe(0);
    const a = reveal(WORDS, CHARS, typingStarts + 0.2).chars;
    const b = reveal(WORDS, CHARS, typingStarts + 0.4).chars;
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThan(CHARS);
  });

  it('has shown everything by the time it says it ends, and stays there', () => {
    const end = revealSeconds(WORDS, CHARS);
    expect(reveal(WORDS, CHARS, end - 0.05).chars).toBeLessThan(CHARS);
    expect(reveal(WORDS, CHARS, end)).toEqual({ words: WORDS, chars: CHARS });
    expect(reveal(WORDS, CHARS, Infinity)).toEqual({ words: WORDS, chars: CHARS });
  });
});
