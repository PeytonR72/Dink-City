import { expect, it } from 'vitest';
import { MotionSource } from '../src/input/motion';
import { motionTuning } from '../src/input/motionTuning';
import { keyboardContact } from '../src/input/input';
import { createBot, DIFFICULTY } from '../src/bot/bot';
import { observe } from '../src/bot/observe';
import { DEFAULT_MATCH, createInitialState, step, type Intent, type SimState } from '../src/sim';
import { createPredictor } from '../src/net/prediction';
import { simTuning } from '../src/tuning';
const idle: Intent = { move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, shot: null };
function incoming() {
  const s = createInitialState(8, { ...DEFAULT_MATCH, contactMode: ['reported', 'auto'] });
  s.phase = 'rally'; s.tick = 100; s.shots = 4;
  s.ball.lastHitBy = 1; s.ball.bouncesSinceHit = 1;
  s.ball.pos = { x: 0.2, y: 0.9, z: 3.55 };
  s.sides[0].players[0].pos = { x: 0, y: 0, z: 4 };
  s.sides[0].players[0].commit = { type: 'soft', tick: 30, bestDistance: null };
  return s;
}
it('keyboard driver adapter matches every tick of the all-auto golden match', () => {
  const seed = 2026;
  const bots = [createBot(0, seed + 1, DIFFICULTY.hard, simTuning), createBot(1, seed + 2, DIFFICULTY.hard, simTuning)];
  let auto = createInitialState(seed); let reported = createInitialState(seed, { ...DEFAULT_MATCH, contactMode: ['reported', 'auto'] });
  const plain = (s: SimState) => { const copy = structuredClone(s); delete copy.match.config.contactMode; return JSON.stringify(copy); };
  let mismatch = -1;
  while (auto.phase !== 'over' && auto.tick < 50_000) {
    const intents: [Intent, Intent] = [bots[0].think(observe(auto, 0)), bots[1].think(observe(auto, 1))];
    const adapted: [Intent, Intent] = [keyboardContact(reported, intents, 0, simTuning), intents[1]];
    auto = step(auto, intents, simTuning); reported = step(reported, adapted, simTuning);
    if (plain(auto) !== plain(reported)) { mismatch = auto.tick; break; }
  }
  expect(mismatch).toBe(-1); expect(auto.match.points).toEqual([11, 13]); expect(auto.tick).toBe(39353);
}, 60000);
it('a swing supplies exactly six contact ticks; manual motion does not become aim', () => {
  const source = new MotionSource(simTuning); const state = incoming();
  source.swing({ type: 'lob', aim: { x: -0.4, y: 0.8 }, at: 1000, strength: 1 });
  for (let n = 0; n < 7; n++) {
    const intent = source.sample({ ...state, tick: 100 + n }, 0, { ...idle, move: { x: 1, y: 0 } }, 1000 + n * 16);
    expect(intent.move).toEqual({ x: 1, y: 0 }); expect(intent.aim).toEqual({ x: -0.4, y: 0 }); expect(intent.contact).toBe(n < 6);
  }
});
it('serves are presses, stale and cleared swings do not leak across interruptions', () => {
  const source = new MotionSource(simTuning); const swing = { type: 'drive' as const, aim: { x: 0, y: 0 }, at: 1000, strength: 1 };
  source.swing(swing); expect(source.sample(createInitialState(1), 0, idle, 1000)).toMatchObject({ shot: 'drive', contact: false });
  source.swing(swing); source.clear(); expect(source.sample(incoming(), 0, idle, 1000).contact).toBe(false);
  source.swing(swing); expect(source.sample(incoming(), 0, idle, 1600).contact).toBe(false);
  source.swing({ ...swing, at: 1600 }); expect(source.sample(incoming(), 0, idle, 1600).contact).toBe(true);
  const after = incoming(); after.ball.lastHitBy = 0; after.shots++; expect(source.sample(after, 0, idle, 1616).contact).toBe(false);
});
it('lead restores transport-age ticks, and never affects sim tuning', () => {
  const source = new MotionSource(simTuning, { ...motionTuning, swingLeadMs: 80 });
  source.swing({ type: 'drive', aim: { x: 0, y: 0 }, at: 1000, strength: 1 });
  expect(source.sample(incoming(), 0, idle, 1080).contact).toBe(true);
});
it('online prediction respects an explicit no-contact, and a reported type change', () => {
  const start = incoming();
  const predictor = createPredictor({ local: 0, start, tuning: simTuning });
  const no = predictor.stamp(start.tick, { ...idle, contact: false });
  expect(no.intent.contact).toBeFalsy(); expect(predictor.curr.shots).toBe(4);
  const hit = predictor.stamp(start.tick + 1, { ...idle, shot: 'drive', contact: true });
  expect(hit.intent.contact).toBe(true); expect(predictor.curr.events).toContainEqual(expect.objectContaining({ kind: 'hit', type: 'drive' }));
});

it('keyboard type changes on the exact contact tick stay bit-identical to auto, including online quantization', () => {
  const reported = incoming(); const auto = structuredClone(reported); auto.match.config.contactMode = ['auto', 'auto'];
  const press: Intent = { ...idle, shot: 'drive' };
  const adapted = keyboardContact(reported, [press, idle], 0, simTuning);
  expect(adapted).toMatchObject({ contact: true, recommit: true });
  const a = step(auto, [press, idle], simTuning); const b = step(reported, [adapted, idle], simTuning);
  delete a.match.config.contactMode; delete b.match.config.contactMode; expect(b).toEqual(a);
  const predictor = createPredictor({ local: 0, start: reported, tuning: simTuning });
  expect(predictor.stamp(reported.tick, press).intent).toMatchObject({ contact: true, recommit: true });
  expect(predictor.curr.events).toEqual(a.events);
});
