import { describe, expect, it } from 'vitest';
import { DIFFICULTY, createBot } from '../src/bot/bot';
import { observe } from '../src/bot/observe';
import type { MatchView } from '../src/match/driver';
import { LocalMatch } from '../src/match/local';
import { createInitialState, type SimState } from '../src/sim';
import { simTuning, viewTuning } from '../src/tuning';

/** An offline Match with a hard Bot at the local Player's controls, logging what the view is told. */
function botMatch(seed: number) {
  const log: string[] = [];
  const drawn: { curr: SimState; live: SimState }[] = [];
  const view: MatchView = {
    tick: (s, events) => events.forEach((e) => log.push(`${s.tick} ${e.kind}`)),
    replay: (on) => log.push(on ? 'replay in' : 'replay out'),
    replayed: () => {},
    draw: (_prev, curr, _alpha, live) => drawn.push({ curr, live }),
  };
  const player = createBot(0, seed + 1, DIFFICULTY.hard, simTuning);
  const match: LocalMatch = new LocalMatch({
    sim: simTuning,
    tuning: { ...viewTuning, gameSpeed: 1 },
    view,
    input: () => player.think(observe(match.curr, 0)),
    rematch: () => {},
  });
  match.startMatch(createInitialState(seed), createBot(1, seed + 2, DIFFICULTY.hard, simTuning));
  return { match, log, drawn };
}

describe('LocalMatch', () => {
  it('plays a Fault Replay while the Match waits, then cuts back in at the next Serve', () => {
    const { match, log, drawn } = botMatch(7);
    for (let i = 0; i < 60 * 600 && !log.includes('replay out'); i++) match.frame(1 / 60);

    const fault = log.findIndex((l) => l.endsWith(' dead'));
    const into = log.indexOf('replay in');
    expect(fault).toBeGreaterThanOrEqual(0);
    expect(into).toBeGreaterThan(fault);
    expect(log.indexOf('replay out')).toBeGreaterThan(into);
    // The live Match doesn't step while the Replay plays.
    expect(log.slice(into + 1, log.indexOf('replay out'))).toEqual([]);
    expect(match.curr.phase).toBe('serve');
    expect(match.replay).toBeNull();
    // Replay frames draw the Replay's states but score from the live one.
    const replayFrames = drawn.filter((d) => d.curr !== d.live);
    expect(replayFrames.length).toBeGreaterThan(60);
    expect(replayFrames.every((d) => d.live.phase === 'dead')).toBe(true);
  });
});
