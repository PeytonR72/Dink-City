import { startAmbience, updateAmbience } from './audio/ambience';
import { playEvents, unlockAudio } from './audio/sfx';
import { DIFFICULTY, createBot, type Bot } from './bot/bot';
import { observe } from './bot/observe';
import { PERSONALITY, type PersonalityName } from './bot/personality';
import { Hud } from './hud/hud';
import { Input } from './input/input';
import { Overlay, SettingsPanel } from './menu/menu';
import { loadModels } from './render/models';
import { Renderer } from './render/renderer';
import { createReplay, type Replay } from './replay/replay';
import { loadSettings, saveSettings, withFlags, type Settings } from './save/settings';
import { browserStore } from './save/store';
import { DEFAULT_MATCH, TICK, createInitialState, endOf, step, type Intent, type SimEvent, type SimState } from './sim';
import { simTuning, viewTuning } from './tuning';

const MAX_FRAME = 0.25;
const LOCAL = 0;

// Flags for playtesting override the saved Settings: ?rally, ?bo3, ?bot=easy|medium|hard, ?sunset.
// ?play skips the menu and starts a Match. ?personality=dinker|banger|lobber overrides the Bot's Personality.
const params = new URLSearchParams(location.search);
const store = browserStore();
let saved = loadSettings(store);
const settings = (): Settings => withFlags(saved, params);

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

type Mode = 'menu' | 'match' | 'paused';
let mode: Mode = 'menu';

const menu = new Overlay(
  'menu',
  `<h1>Dink City</h1>
  <button id="play" class="primary" autofocus>Play</button>
  <h2>Settings</h2>`,
);
menu.el.append(
  new SettingsPanel(saved, (s) => {
    saved = s;
    saveSettings(store, s);
    viewTuning.sunset = settings().sunset;
  }).el,
);
menu.on('#play', () => startMatch());

const pause = new Overlay(
  'pause',
  `<h1>Paused</h1>
  <button id="resume" class="primary">Resume</button>
  <button id="quit">Quit to menu</button>`,
);
pause.on('#resume', () => setMode('match'));
pause.on('#quit', () => setMode('menu'));

let bot: Bot;
let prev: SimState;
let curr: SimState;
/** The current Rally's start state and every Tick's Intents since: enough to replay it. */
let rally: { start: SimState; intents: [Intent, Intent][] };
/** The Fault Replay playing, or waiting `replayIn` seconds to start. */
let replay: Replay | null = null;
let replayIn = 0;
let acc = 0;
let last = performance.now();
/** Seconds of hit-stop left. Presentation only: the Sim just isn't stepped meanwhile (ADR-0001). */
let hitStop = 0;
const eventLog: ({ tick: number } & SimEvent)[] = [];

function newMatch(seed: number) {
  const s = settings();
  viewTuning.sunset = s.sunset;
  const personality = PERSONALITY[(params.get('personality') as PersonalityName) ?? 'dinker'] ?? PERSONALITY.dinker;
  bot = createBot(1, seed ^ 0x5eed, DIFFICULTY[s.difficulty], simTuning, personality);
  curr = prev = createInitialState(seed, { ...DEFAULT_MATCH, rallyScoring: s.rallyScoring, bestOf: s.bestOf });
  rally = { start: curr, intents: [] };
  endReplay();
  hud.reset();
}

function startMatch() {
  newMatch(Date.now());
  setMode('match');
}

function setMode(m: Mode) {
  mode = m;
  menu.el.hidden = m !== 'menu';
  pause.el.hidden = m !== 'paused';
  if (m === 'menu') menu.show();
  if (m === 'paused') pause.show();
  if (m === 'match') (document.activeElement as HTMLElement | null)?.blur?.();
  document.body.dataset.mode = m;
  input.clear();
  last = performance.now();
}

newMatch(Date.now());
setMode(params.has('play') ? 'match' : 'menu');

if (import.meta.env.DEV && params.has('debug')) {
  import('./debug/panel').then(({ createDebugPanel }) => createDebugPanel(simTuning, viewTuning, DIFFICULTY[settings().difficulty]));
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
  get replay() {
    return replay;
  },
  get mode() {
    return mode;
  },
  simTuning,
  viewTuning,
  eventLog,
  newMatch,
  startMatch,
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
  /** Run N frames of `dt` seconds synchronously, as rAF would (Replays, menus, hit-stop included). */
  frames(n: number, dt = 1 / 60) {
    for (let i = 0; i < n; i++) update(dt);
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
    // A double bounce is a winner, not a rule break, so it gets no Replay.
    if (e.kind === 'dead' && e.reason !== 'double-bounce') {
      replay = createReplay({ start: rally.start, intents: rally.intents.slice() }, simTuning, {
        seconds: viewTuning.replaySeconds,
        speed: viewTuning.replaySpeed,
      });
      replayIn = viewTuning.replayDelay;
    }
  }
  if (eventLog.length > 100) eventLog.splice(0, eventLog.length - 100);
}

function endReplay() {
  if (!replay) return;
  replay = null;
  hud.setReplay(false);
  renderer.cut();
}

/** Plays the Fault Replay once its delay is up. The Match waits meanwhile. Returns whether it drew the frame. */
function playReplay(dt: number): boolean {
  if (!replay) return false;
  if (replayIn > 0) {
    replayIn -= dt;
    if (replayIn > 0) return false;
    hud.setReplay(true);
    renderer.cut();
  }
  if (input.sample().shot) replay.skip();
  replay.advance(dt);
  const { prev: rp, curr: rc } = replay;
  renderer.onEvents(rc, replay.events);
  playEvents(replay.events, endOf(rc, LOCAL), viewTuning);
  hud.update(curr, dt);
  renderer.render(rp, rc, replay.alpha, dt);
  if (replay.done) endReplay();
  return true;
}

function frame(now: number) {
  const dt = Math.min((now - last) / 1000, MAX_FRAME);
  last = now;
  update(dt);
  requestAnimationFrame(frame);
}

/** One frame: menus, the Replay, or the live Match. */
function update(dt: number) {
  updateAmbience(viewTuning);

  if (input.pausePressed()) {
    if (mode === 'match' && curr.phase === 'over') setMode('menu');
    else if (mode === 'match') setMode('paused');
    else if (mode === 'paused') setMode('match');
  }

  if (mode !== 'match') {
    // The court sits still behind the menus.
    renderer.render(prev, curr, 1, dt);
  } else if (!playReplay(dt)) {
    if (hitStop > 0) hitStop -= dt;
    else acc += dt * viewTuning.gameSpeed;

    while (acc >= TICK && hitStop <= 0) {
      tick();
      acc -= TICK;
    }

    hud.update(curr, dt);
    renderer.render(prev, curr, acc / TICK, dt);
  }
}

requestAnimationFrame(frame);
