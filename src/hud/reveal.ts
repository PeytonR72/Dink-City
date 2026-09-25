// The timeline of an emphasised banner (NET CITY): the title's words pop in one at a time, then the detail types out.

export const REVEAL = {
  /** Seconds between one word popping in and the next. */
  wordGap: 0.5,
  /** Seconds from the last word popping in to the first letter typed. */
  typeDelay: 0.55,
  charsPerSecond: 32,
};

/** How many of the title's words and the detail's characters show `t` seconds in. */
export function reveal(words: number, chars: number, t: number): { words: number; chars: number } {
  const typing = t - typeStart(words);
  return {
    words: Math.min(words, Math.floor(t / REVEAL.wordGap) + 1),
    chars: typing <= 0 ? 0 : Math.min(chars, Math.floor(typing * REVEAL.charsPerSecond + 1e-9)),
  };
}

/** Seconds until everything shows. */
export function revealSeconds(words: number, chars: number): number {
  return typeStart(words) + chars / REVEAL.charsPerSecond;
}

function typeStart(words: number): number {
  return (words - 1) * REVEAL.wordGap + REVEAL.typeDelay;
}
