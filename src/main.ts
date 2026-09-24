import { startAmbience, updateAmbience } from './audio/ambience';
import { playEvents, unlockAudio } from './audio/sfx';
import { DIFFICULTY, createBot, type Bot } from './bot/bot';
import { observe } from './bot/observe';
import { Hud } from './hud/hud';
import { Input } from './input/input';
import { loadModels } from './render/models';
import { Renderer } from './render/renderer';
import { DEFAULT_MATCH, TICK, createInitialState, endOf, step, type Intent, type MatchConfig, type SimEvent, type SimState } from './sim';
import { simTuning, viewTuning } from './tuning';

const MAX_FRAME = 0.25;
const LOCAL = 0;

// Flags for playtesting: ?rally (Rally scoring), ?bo3 (best of 3), ?bot=easy|medium|hard, ?sunset.
const params = new URLSearchParams(location.search);
const config: MatchConfig = { ...DEFAULT_MATCH, rallyScoring: params.has('rally'), bestOf: params.has('bo3') ? 3 : 1 };
const difficulty = DIFFICULTY[(params.get('bot') ?? 'medium') as keyof typeof DIFFICULTY] ?? DIFFICULTY.medium;

if (params.has('sunset')) viewTuning.sunset = true;

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const models = await loadModels().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', '<p style="position:fixed;inset:40% 0;text-align:center">Could not load the court. Please reload.</p>');
  throw e;
});
const renderer = new Renderer(canvas, viewTuning, simTuning, models);
const input = new Input();
const hud = new Hud(document.querySelector('#hud')!, LOCAL);
unlockAudio();
void startAmbience(viewTuning);

let bot: Bot;
let prev: SimState;
let curr: SimState;
/** The current Rally's start state and every Tick's Intents since: enough to replay it (Fault Replays, milestone 05). */
let rally: { start: SimState; intents: [Intent, Intent][] };
let acc = 0;
let last = performance.now();
/** Seconds of hit-stop left. Presentation only: the Sim just isn't stepped meanwhile (ADR-0001). */
let hitStop = 0;
const eventLog: ({ tick: number } & SimEvent)[] = [];

function newMatch(seed: number) {
  bot = createBot(1, seed ^ 0x5eed, difficulty, simTuning);
  curr = prev = createInitialState(seed, config);
  rally = { start: curr, intents: [] };
  hud.reset();
}
newMatch(Date.now());

if (import.meta.env.DEV && params.has('debug')) {
  import('./debug/panel').then(({ createDebugPanel }) => createDebugPanel(simTuning, viewTuning, difficulty));
  import('./debug/overlays').then(({ createOverlays }) => createOverlays(renderer, simTuning, () => bot));
}

// Exposed for playtests and console poking.
(window as unknown as { dink: unknown }).dink = {
  get state() {
    return curr;
  },
  get rally() {
    return rally;
  },
  simTuning,
  viewTuning,
  eventLog,
  newMatch,
  /** Draw calls and triangles of the last frame. */
  get stats() {
    return renderer.stats;
  },
  /** Step N Ticks synchronously (works while the tab is hidden). `drive` overrides local input. */
  advance(ticks: number, drive?: (s: SimState) => Intent) {
    for (let i = 0; i < ticks; i++) tick(drive?.(curr));
    renderer.render(prev, curr, 1, TICK);
    hud.update(curr, ticks * TICK);
    return curr;
  },
};

function tick(local: Intent = input.sample()) {
  if (curr.phase === 'over') {
    if (local.shot) newMatch(Date.now());
    return;
  }
  const intents: [Intent, Intent] = [local, bot.think(observe(curr, 1))];
  prev = curr;
  curr = step(curr, intents, simTuning);
  if (curr.phase === 'serve' && prev.phase !== 'serve') rally = { start: curr, intents: [] };
  else rally.intents.push(intents);

  hud.onEvents(curr, curr.events);
  renderer.onEvents(curr, curr.events);
  playEvents(curr.events, endOf(curr, LOCAL), viewTuning);
  for (const e of curr.events) {
    eventLog.push({ tick: curr.tick, ...e });
    if (e.kind === 'hit' && (e.variant === 'smash' || e.speed >= viewTuning.hitStopSpeed)) hitStop = viewTuning.hitStopMs / 1000;
  }
  if (eventLog.length > 100) eventLog.splice(0, eventLog.length - 100);
}

function frame(now: number) {
  const dt = Math.min((now - last) / 1000, MAX_FRAME);
  last = now;
  if (hitStop > 0) hitStop -= dt;
  else acc += dt * viewTuning.gameSpeed;

  while (acc >= TICK && hitStop <= 0) {
    tick();
    acc -= TICK;
  }

  hud.update(curr, dt);
  updateAmbience(viewTuning);
  renderer.render(prev, curr, acc / TICK, dt);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
