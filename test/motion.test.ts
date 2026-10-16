import { expect, it } from 'vitest';
import { MotionSource } from '../src/input/motion';
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
const swing = (at = 1000) => ({ type: 'drive' as const, aim: { x: -.4, y: .8 }, at, strength: 1 });
const hitOf = (s: SimState) => s.events.find(e => e.kind === 'hit' && e.side === 0);
it('a swing is one contact evaluation; manual movement does not become aim', () => {
  const source = new MotionSource(simTuning); const state = incoming(); source.swing(swing());
  for (let n = 0; n < 8; n++) {
    const intent = source.sample({ ...state, tick: 100 + n }, 0, { ...idle, move: { x: 1, y: 0 } }, 1000 + n * 16);
    expect(intent.move).toEqual({ x: 1, y: 0 }); expect(intent.aim).toEqual({ x: -.4, y: 0 }); expect(intent.contact).toBe(n === 0);
  }
});
it('an early miss cannot hit when the ball enters reach, despite retained preparation', () => {
  const source = new MotionSource(simTuning); let state = incoming(); state.ball.pos.z = 1.5;
  source.swing(swing()); state = step(state, [source.sample(state, 0, idle, 1000), idle], simTuning);
  expect(hitOf(state)).toBeUndefined(); expect(state.sides[0].players[0].commit).not.toBeNull();
  state.ball.pos = { x: .2, y: .9, z: 3.55 }; state.ball.vel = { x: 0, y: 0, z: 0 };
  for (let n = 0; n < 8; n++) {
    const intent = source.sample(state, 0, idle, 1016 + n * 16); expect(intent.contact).toBe(false);
    state = step(state, [intent, idle], simTuning); expect(hitOf(state)).toBeUndefined();
  }
});
it('a fresh in-reach swing hits immediately, including normal transport age over the old window', () => {
  for (const age of [0, 80, 150, 300]) {
    const source = new MotionSource(simTuning); const state = incoming(); source.swing(swing());
    const intent = source.sample(state, 0, idle, 1000 + age);
    expect(hitOf(step(state, [intent, idle], simTuning))).toMatchObject({ type: 'drive' });
    expect(source.sample(state, 0, idle, 1016 + age).contact).toBe(false);
  }
});
it('a late swing after the ball leaves reach misses and is not retried', () => {
  const source = new MotionSource(simTuning); let state = incoming(); state.ball.pos.z = 5.8;
  source.swing(swing()); state = step(state, [source.sample(state, 0, idle, 1000), idle], simTuning);
  expect(hitOf(state)).toBeUndefined();
  state.ball.pos = { x: .2, y: .9, z: 3.55 }; state.ball.vel = { x: 0, y: 0, z: 0 };
  expect(hitOf(step(state, [source.sample(state, 0, idle, 1016), idle], simTuning))).toBeUndefined();
});
it('duplicate, older and cancelled deliveries never revive contact; fresh swings remain independent', () => {
  const source = new MotionSource(simTuning); const state = incoming();
  source.swing(swing()); expect(source.sample(state, 0, idle, 1000).contact).toBe(true);
  source.swing(swing()); source.swing(swing(999)); expect(source.sample(state, 0, idle, 1016).contact).toBe(false);
  source.swing(swing(1100)); source.clear(); source.swing(swing(1100)); expect(source.sample(state, 0, idle, 1100).contact).toBe(false);
  source.swing(swing(1200)); source.swing({ ...swing(1201), type: 'lob' });
  expect(source.sample(state, 0, idle, 1201)).toMatchObject({ shot: 'lob', contact: true });
  expect(source.sample(state, 0, idle, 1217).contact).toBe(false);
  const outgoing = incoming(); outgoing.ball.lastHitBy = 0; source.swing(swing(1300));
  expect(source.sample(outgoing, 0, idle, 1300).contact).toBe(false);
  expect(source.sample(state, 0, idle, 1316).contact).toBe(false);
});
it('stale, future and dead-phase events are discarded, with no scheduled future hit', () => {
  for (const [at, now, phase] of [[1000, 1500, 'rally'], [2000, 1000, 'rally'], [1000, 1000, 'dead']] as const) {
    const source = new MotionSource(simTuning); const state = incoming(); state.phase = phase;
    source.swing(swing(at)); expect(source.sample(state, 0, idle, now).contact).toBe(false);
    expect(source.sample(incoming(), 0, idle, at + 16).contact).toBe(false);
  }
  const source = new MotionSource(simTuning); source.swing(swing(1050));
  expect(source.sample(incoming(), 0, idle, 1000).contact).toBe(true); // clock skew: now, never later
  expect(source.sample(incoming(), 0, idle, 1050).contact).toBe(false);
});
it('serves remain single presses; swinging before serve-ready does not queue a serve', () => {
  for (const ready of [false, true]) {
    const source = new MotionSource(simTuning); let state = createInitialState(1, { ...DEFAULT_MATCH, contactMode: ['reported', 'auto'] });
    state.server = 0; state.tick = ready ? 100 : 0; state.phaseTick = 0;
    source.swing(swing()); const intent = source.sample(state, 0, idle, 1000);
    expect(intent).toMatchObject({ shot: 'drive', contact: false });
    state = step(state, [intent, idle], simTuning); expect(state.phase).toBe(ready ? 'rally' : 'serve');
    if (!ready) { state.tick = 100; state = step(state, [source.sample(state, 0, idle, 1016), idle], simTuning); expect(state.phase).toBe('serve'); }
  }
});
it('online prediction and missing-input fade do not extend a missed motion contact', () => {
  const source = new MotionSource(simTuning); const start = incoming(); start.ball.pos.z = 1.5; start.ball.vel.z = 20;
  const predictor = createPredictor({ local: 0, start, tuning: simTuning }); source.swing(swing());
  expect(predictor.stamp(start.tick, source.sample(start, 0, idle, 1000)).intent.contact).toBe(true);
  expect(hitOf(predictor.curr)).toBeUndefined();
  for (let n = 1; n < 7; n++) {
    const intent = source.sample(predictor.curr, 0, idle, 1000 + n * 16);
    expect(predictor.stamp(start.tick + n, intent).intent.contact).toBeFalsy(); expect(hitOf(predictor.curr)).toBeUndefined();
  }
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
