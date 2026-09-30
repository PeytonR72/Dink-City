import { describe, expect, it } from 'vitest';
import { createTickLoop } from '../../party/src/tickLoop';

const T0 = 1_000_000;

describe('the tick loop', () => {
  it('runs nothing on the first callback, which only sets the clock', () => {
    expect(createTickLoop({ hz: 60, maxCatchUp: 8 }).advance(T0)).toBe(0);
  });

  it('runs 60 Ticks a second for callbacks at a steady rate', () => {
    const loop = createTickLoop({ hz: 60, maxCatchUp: 8 });
    loop.advance(T0);
    let ticks = 0;
    // setInterval(…, 1000 / 60) fires on whole milliseconds: 16 or 17 ms apart.
    for (let ms = 1; ms <= 3_000; ms++) if (ms % 50 === 0 || ms % 50 === 17 || ms % 50 === 33) ticks += loop.advance(T0 + ms);
    expect(ticks).toBe(180);
  });

  it('catches up after a late callback', () => {
    const loop = createTickLoop({ hz: 60, maxCatchUp: 8 });
    loop.advance(T0);
    expect(loop.advance(T0 + 50)).toBe(3);
    expect(loop.advance(T0 + 100)).toBe(3);
  });

  it('keeps the part of a Tick left over for the next callback', () => {
    const loop = createTickLoop({ hz: 60, maxCatchUp: 8 });
    loop.advance(T0);
    expect(loop.advance(T0 + 10)).toBe(0);
    expect(loop.advance(T0 + 20)).toBe(1);
    expect(loop.advance(T0 + 30)).toBe(0);
    expect(loop.advance(T0 + 34)).toBe(1);
  });

  it('caps a huge stall and drops the rest instead of spiraling', () => {
    const loop = createTickLoop({ hz: 60, maxCatchUp: 8 });
    loop.advance(T0);
    expect(loop.advance(T0 + 10_000)).toBe(8);
    // The stall is forgotten: the next callback runs at the normal rate.
    expect(loop.advance(T0 + 10_017)).toBe(1);
  });

  it('ignores a clock that goes backwards', () => {
    const loop = createTickLoop({ hz: 60, maxCatchUp: 8 });
    loop.advance(T0);
    expect(loop.advance(T0 - 500)).toBe(0);
    expect(loop.advance(T0 - 483)).toBe(1);
  });
});
