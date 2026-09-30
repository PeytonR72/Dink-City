import { setAmbience, updateAmbience } from './audio/ambience';
import { playEvents, unlockAudio } from './audio/sfx';
import { DIFFICULTY, createBot } from './bot/bot';
import { PERSONALITY, type PersonalityName } from './bot/personality';
import { Hud } from './hud/hud';
import { Input } from './input/input';
import { LocalMatch } from './match/local';
import { Locker } from './menu/locker';
import { CityMap } from './menu/map';
import { Overlay, SettingsPanel } from './menu/menu';
import { PRACTICE_STEPS, Practice, REPS_TO_PASS, createMachine } from './practice/practice';
import { DEFAULT_PLAYER_COLORS, loadModels, loadSurroundings } from './render/models';
import { Renderer } from './render/renderer';
import { loadColors, saveColors } from './save/colors';
import { isUnlocked, loadProgress, recordWin, saveProgress } from './save/progress';
import { loadSettings, saveSettings, withFlags, type Settings } from './save/settings';
import { browserStore } from './save/store';
import { DEFAULT_MATCH, TICK, createInitialState, endOf, type Intent, type SimEvent, type SimState } from './sim';
import { simTuning, viewTuning } from './tuning';
import { VENUE_ASSETS } from './venue/assets';
import { VENUES, VENUE_IDS, type VenueId } from './venue/venues';

const MAX_FRAME = 0.25;

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
const input = new Input();
const eventLog: ({ tick: number } & SimEvent)[] = [];
/** The Match in play. Offline for now; online play will add another driver. */
const match = new LocalMatch({
  sim: simTuning,
  tuning: viewTuning,
  input: () => input.sample(),
  rematch: () => newMatch(Date.now()),
  view: {
    tick(s, events) {
      const { practice, local } = match;
      if (practice) {
        // Practice judges each rep itself; the Match banners (a Bot "letting it bounce twice") would mislead.
        const outcome = practice.onEvents(events);
        if (outcome) {
          hud.banner(outcome);
          showPractice();
        }
      } else hud.onEvents(s, events);
      renderer.onEvents(s, events);
      playEvents(events, endOf(s, local), viewTuning);
      for (const e of events) {
        eventLog.push({ tick: s.tick, ...e });
        if (e.kind === 'match' && e.winner === local) onMatchWon();
      }
      if (eventLog.length > 100) eventLog.splice(0, eventLog.length - 100);
    },
    replay(on) {
      hud.setReplay(on);
      renderer.cut();
    },
    replayed(s, events) {
      renderer.onEvents(s, events);
      playEvents(events, endOf(s, match.local), viewTuning);
    },
    draw(prev, curr, alpha, live, dt) {
      hud.update(live, dt);
      renderer.render(prev, curr, alpha, dt);
    },
  },
});
renderer.setLocalSide(match.local);
renderer.setColors(match.local, colors);
const hud = new Hud(document.querySelector('#hud')!, match.local);
unlockAudio();

const flagVenue = params.get('venue') as VenueId | null;
/** The Venue on show: the flag's, or the Park, which the menu shows behind the map until a Venue is played. */
let venue: VenueId = flagVenue && VENUE_IDS.includes(flagVenue) ? flagVenue : 'park';
await showVenue(venue).catch(failed);

/** Puts `id`'s surroundings, lighting, ambience and Bot look on show. */
async function showVenue(id: VenueId) {
  const surroundings = await loadSurroundings(VENUE_ASSETS[id].model);
  venue = id;
  renderer.setVenue(VENUES[id], surroundings);
  // Side 1 is the offline Bot; online Matches will color it differently.
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
    renderer.setColors(match.local, c);
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

/** The Difficulty of the Match in play, for its star. */
let difficulty = settings().difficulty;
let last = performance.now();

/** A new Match against the Bot of the Venue on show. */
function newMatch(seed: number) {
  const s = settings();
  difficulty = s.difficulty;
  viewTuning.sunset = s.sunset;
  const flag = params.get('personality');
  const personality = PERSONALITY[flag && Object.hasOwn(PERSONALITY, flag) ? (flag as PersonalityName) : VENUES[venue].personality];
  const bot = createBot(1, seed ^ 0x5eed, DIFFICULTY[s.difficulty], simTuning, personality);
  renderer.setMachine(false);
  hud.setPractice(null);
  match.startMatch(createInitialState(seed, { ...DEFAULT_MATCH, rallyScoring: s.rallyScoring, bestOf: s.bestOf }), bot);
  hud.reset();
}

/** Practice mode at the Venue on show: the ball machine plays Side 1, and there is no score. */
function startPractice() {
  const p = new Practice();
  const machine = createMachine(Date.now(), simTuning, () => p.step);
  renderer.setMachine(true);
  match.startPractice(p, machine);
  hud.reset();
  showPractice();
  setMode('match');
}

function showPractice() {
  const p = match.practice!;
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
  // A locked Venue played through ?venue= earns nothing.
  if (!isUnlocked(progress, venue)) return;
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
// The menu doesn't draw the court, so draw it once: the Park stands behind the map until a Venue is played.
if (mode === 'menu') renderer.render(match.prev, match.curr, 1, 0);

if (import.meta.env.DEV && params.has('debug')) {
  import('./debug/panel').then(({ createDebugPanel }) => createDebugPanel(simTuning, viewTuning, DIFFICULTY[settings().difficulty]));
  import('./debug/overlays').then(({ createOverlays }) => createOverlays(renderer, simTuning, () => match.bot));
}

// Exposed for playtests and console poking.
(window as unknown as { dink: unknown }).dink = {
  get state() {
    return match.curr;
  },
  get rally() {
    return match.rally;
  },
  get replay() {
    return match.replay;
  },
  get mode() {
    return mode;
  },
  get venue() {
    return venue;
  },
  simTuning,
  viewTuning,
  eventLog,
  newMatch,
  playVenue,
  startPractice,
  get practice() {
    return match.practice;
  },
  get progress() {
    return progress;
  },
  /** Draw calls and triangles of the last frame. */
  get stats() {
    return renderer.stats;
  },
  /** Draw calls and triangles of the map's last frame. */
  get mapStats() {
    return map.stats;
  },
  /** Step N Ticks synchronously (works while the tab is hidden). `drive` overrides local input. */
  advance(ticks: number, drive?: (s: SimState) => Intent) {
    for (let i = 0; i < ticks; i++) match.tick(drive?.(match.curr));
    renderer.render(match.prev, match.curr, 1, TICK);
    hud.update(match.curr, ticks * TICK);
    return match.curr;
  },
  /** Run N frames of `dt` seconds synchronously, as rAF would (Replays, menus, hit-stop included). */
  frames(n: number, dt = 1 / 60) {
    for (let i = 0; i < n; i++) update(dt);
  },
};

function frame(now: number) {
  const dt = Math.min((now - last) / 1000, MAX_FRAME);
  last = now;
  update(dt);
  requestAnimationFrame(frame);
}

/** One frame: menus, or the Match (its Replay included). */
function update(dt: number) {
  updateAmbience(viewTuning);

  if (input.pausePressed()) {
    if (mode === 'match' && match.curr.phase === 'over') setMode('menu');
    else if (mode === 'match') setMode('paused');
    else if (mode === 'paused') setMode('match');
    else if (mode === 'locker') setMode('menu');
  }

  if (mode === 'menu') {
    // The map is drawn instead of the court, which keeps its last frame behind the menu.
    map.draw(dt);
  } else if (mode !== 'match') {
    // The court sits still behind the other menus.
    renderer.render(match.prev, match.curr, 1, dt);
  } else match.frame(dt);
}

requestAnimationFrame(frame);
