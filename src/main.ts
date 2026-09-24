import { setAmbience, updateAmbience } from './audio/ambience';
import { playEvents, unlockAudio } from './audio/sfx';
import { DIFFICULTY, createBot, type Bot } from './bot/bot';
import { observe } from './bot/observe';
import { PERSONALITY, type PersonalityName } from './bot/personality';
import { Hud } from './hud/hud';
import { Input } from './input/input';
import { Locker } from './menu/locker';
import { CityMap } from './menu/map';
import { Overlay, SettingsPanel } from './menu/menu';
import { PRACTICE_STEPS, Practice, REPS_TO_PASS, createMachine } from './practice/practice';
import { DEFAULT_PLAYER_COLORS, loadModels, loadSurroundings } from './render/models';
import { Renderer } from './render/renderer';
import { createReplay, type Replay } from './replay/replay';
import { loadColors, saveColors } from './save/colors';
import { isUnlocked, loadProgress, recordWin, saveProgress } from './save/progress';
import { loadSettings, saveSettings, withFlags, type Settings } from './save/settings';
import { browserStore } from './save/store';
import { DEFAULT_MATCH, TICK, createInitialState, endOf, step, type Intent, type SimEvent, type SimState } from './sim';
import { simTuning, viewTuning } from './tuning';
import { VENUE_ASSETS } from './venue/assets';
import { VENUES, VENUE_IDS, type VenueId } from './venue/venues';

const MAX_FRAME = 0.25;
const LOCAL = 0;

// Flags for playtesting override the saved Settings: ?rally, ?bo3, ?bot=easy|medium|hard, ?sunset.
// ?play skips the menu and starts a Match; ?venue=park|rooftop|beach picks its Venue, locked or not.
// ?personality=dinker|banger|lobber overrides the Venue Bot's Personality. ?practice starts Practice mode.
const params = new URLSearchParams(location.search);
const store = browserStore();
let saved = loadSettings(store);
const settings = (): Settings => withFlags(saved, params);
let progress = loadProgress(store);
let colors = loadColors(store);

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const failed = (e: unknown): never => {
  document.body.insertAdjacentHTML('beforeend', '<p style="position:fixed;inset:40% 0;text-align:center">Could not load the court. Please reload.</p>');
  throw e;
};
const models = await loadModels().catch(failed);
const renderer = new Renderer(canvas, viewTuning, simTuning, models);
renderer.setColors(LOCAL, colors);
const input = new Input();
const hud = new Hud(document.querySelector('#hud')!, LOCAL);
unlockAudio();

const flagVenue = params.get('venue') as VenueId | null;
/** The Venue on show: the flag's, or the furthest one open. */
let venue: VenueId = flagVenue && VENUE_IDS.includes(flagVenue) ? flagVenue : VENUE_IDS.filter((id) => isUnlocked(progress, id)).at(-1)!;
await showVenue(venue).catch(failed);

/** Puts `id`'s surroundings, lighting, ambience and Bot look on show. */
async function showVenue(id: VenueId) {
  const surroundings = await loadSurroundings(VENUE_ASSETS[id].model);
  venue = id;
  renderer.setVenue(VENUES[id], surroundings);
  renderer.setColors(1, { ...DEFAULT_PLAYER_COLORS, ...VENUES[id].bot });
  void setAmbience(VENUE_ASSETS[id].ambience, viewTuning);
}

type Mode = 'menu' | 'locker' | 'match' | 'paused';
let mode: Mode = 'menu';

const menu = new Overlay(
  'menu',
  `<h1>Dink City</h1>
  <div class="menu-body">
    <div class="menu-map"></div>
    <div class="menu-side">
      <button id="open-practice" class="primary">Practice</button>
      <h2>Settings</h2>
      <button id="open-locker">Locker</button>
    </div>
  </div>`,
);
const map = new CityMap((id) => void playVenue(id));
menu.el.querySelector('.menu-map')!.append(map.el);
menu.el.querySelector('#open-locker')!.before(
  new SettingsPanel(saved, (s) => {
    saved = s;
    saveSettings(store, s);
    viewTuning.sunset = settings().sunset;
  }).el,
);
menu.on('#open-locker', () => setMode('locker'));
menu.on('#open-practice', () => startPractice());

const locker = new Locker(
  models.player,
  colors,
  (c) => {
    colors = c;
    saveColors(store, c);
    renderer.setColors(LOCAL, c);
  },
  () => setMode('menu'),
);

const pause = new Overlay(
  'pause',
  `<h1>Paused</h1>
  <button id="resume" class="primary">Resume</button>
  <button id="quit">Quit to map</button>`,
);
pause.on('#resume', () => setMode('match'));
pause.on('#quit', () => setMode('menu'));

/** Side 1: the Venue's Bot, or the ball machine in Practice mode. */
let bot: Bot;
/** Practice mode's steps and reps, or null in a Match. */
let practice: Practice | null = null;
let prev: SimState;
let curr: SimState;
/** The Difficulty of the Match in play, for its star. */
let difficulty = settings().difficulty;
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

/** A new Match against the Bot of the Venue on show. */
function newMatch(seed: number) {
  const s = settings();
  difficulty = s.difficulty;
  viewTuning.sunset = s.sunset;
  const personality = PERSONALITY[params.get('personality') as PersonalityName] ?? PERSONALITY[VENUES[venue].personality];
  bot = createBot(1, seed ^ 0x5eed, DIFFICULTY[s.difficulty], simTuning, personality);
  curr = prev = createInitialState(seed, { ...DEFAULT_MATCH, rallyScoring: s.rallyScoring, bestOf: s.bestOf });
  rally = { start: curr, intents: [] };
  practice = null;
  renderer.setMachine(false);
  hud.setPractice(null);
  endReplay();
  hud.reset();
}

/** Practice mode at the Venue on show: the ball machine plays Side 1, and there is no score. */
function startPractice() {
  practice = new Practice();
  const p = practice;
  bot = createMachine(Date.now(), simTuning, () => p.step);
  renderer.setMachine(true);
  newRep();
  endReplay();
  hud.reset();
  showPractice();
  setMode('match');
}

/** Each rep is a fresh Rally, served by whoever the step says. */
function newRep() {
  curr = prev = createInitialState(Date.now() >>> 0, DEFAULT_MATCH, practice!.step.server);
}

function showPractice() {
  const p = practice!;
  const free = p.step.id === 'free';
  hud.setPractice({ step: p.stepNumber, steps: PRACTICE_STEPS.length, title: p.step.title, prompt: p.step.prompt, reps: p.reps, needed: free ? 0 : REPS_TO_PASS });
}

async function playVenue(id: VenueId) {
  await showVenue(id);
  newMatch(Date.now());
  setMode('match');
}

/** A Match won: a star for this Difficulty, and maybe the next Venue opens. */
function onMatchWon() {
  const before = VENUE_IDS.filter((id) => isUnlocked(progress, id));
  progress = recordWin(progress, venue, difficulty);
  saveProgress(store, progress);
  const opened = VENUE_IDS.find((id) => isUnlocked(progress, id) && !before.includes(id));
  if (opened) hud.note(`${VENUES[opened].name} is open!`);
}

function setMode(m: Mode) {
  mode = m;
  menu.el.hidden = m !== 'menu';
  pause.el.hidden = m !== 'paused';
  if (m === 'locker') locker.show();
  else locker.hide();
  if (m === 'menu') {
    map.refresh(progress);
    map.focusFirst();
  }
  if (m === 'paused') pause.show();
  if (m === 'match') (document.activeElement as HTMLElement | null)?.blur?.();
  document.body.dataset.mode = m;
  input.clear();
  last = performance.now();
}

newMatch(Date.now());
if (params.has('practice')) startPractice();
else setMode(params.has('play') ? 'match' : 'menu');

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
  playVenue,
  startPractice,
  get practice() {
    return practice;
  },
  get progress() {
    return progress;
  },
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
  if (curr.phase === 'serve' && prev.phase !== 'serve') {
    if (practice) newRep();
    rally = { start: curr, intents: [] };
  } else rally.intents.push(intents);

  if (practice) {
    // Practice judges each rep itself; the Match banners (a Bot "letting it bounce twice") would mislead.
    const outcome = practice.onEvents(curr.events);
    if (outcome) {
      hud.banner(outcome.title, outcome.detail);
      showPractice();
    }
  } else hud.onEvents(curr, curr.events);
  renderer.onEvents(curr, curr.events);
  playEvents(curr.events, endOf(curr, LOCAL), viewTuning);
  for (const e of curr.events) {
    eventLog.push({ tick: curr.tick, ...e });
    if (e.kind === 'match' && e.winner === LOCAL) onMatchWon();
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
    else if (mode === 'locker') setMode('menu');
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
