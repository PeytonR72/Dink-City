import { setAmbience, updateAmbience } from './audio/ambience';
import { playEvents, unlockAudio } from './audio/sfx';
import { DIFFICULTY, createBot } from './bot/bot';
import { PERSONALITY, type PersonalityName } from './bot/personality';
import { Hud } from './hud/hud';
import { Input } from './input/input';
import type { MatchDriver, MatchView } from './match/driver';
import type { OnlineMatch } from './match/online';
import { LocalMatch } from './match/local';
import { Locker } from './menu/locker';
import { CityMap } from './menu/map';
import { Overlay, SettingsPanel } from './menu/menu';
import { COURT_CLOSE, DEFAULT_PRESET, PRESETS, isPresetId, validateDisplayName, type CourtErrorCode } from './net';
import { PRACTICE_STEPS, Practice, REPS_TO_PASS, createMachine } from './practice/practice';
import { DEFAULT_PLAYER_COLORS, loadModels, loadSurroundings } from './render/models';
import { Renderer } from './render/renderer';
import { loadColors, saveColors } from './save/colors';
import { isUnlocked, loadProgress, recordWin, saveProgress } from './save/progress';
import { loadSettings, saveSettings, withFlags, type Settings } from './save/settings';
import { browserStore } from './save/store';
import { DEFAULT_MATCH, TICK, createInitialState, endOf, other, type Intent, type SideIndex, type SimEvent, type SimState } from './sim';
import { simTuning, viewTuning } from './tuning';
import { VENUE_ASSETS } from './venue/assets';
import { VENUES, VENUE_IDS, type VenueId } from './venue/venues';

const MAX_FRAME = 0.25;
const STILL: Intent = { move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, shot: null };

// Flags for playtesting override the saved Settings: ?rally, ?bo3, ?bot=easy|medium|hard, ?sunset.
// ?play skips the menu and starts a Match; ?venue=park|rooftop|beach picks its Venue, locked or not.
// ?personality=dinker|banger|lobber overrides the Venue Bot's Personality. ?practice starts Practice mode.
// In dev only, until the menu's online panel (issue 06): ?host=quick|standard|long&name=Ana creates a Court and
// joins it, and ?court=CODE&name=Ana joins one.
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
/** Where either driver shows the Match: the Hud, the renderer and the sounds. */
const view: MatchView = {
  tick(s, events) {
    const practice = match === offline ? offline.practice : null;
    if (practice) {
      // Practice judges each rep itself; the Match banners (a Bot "letting it bounce twice") would mislead.
      const outcome = practice.onEvents(events);
      if (outcome) {
        hud.banner(outcome);
        showPractice();
      }
    } else hud.onEvents(s, events);
    showSwingsAndSounds(s, events);
    for (const e of events) {
      eventLog.push({ tick: s.tick, ...e });
      // Online Matches earn no progress (ADR-0004).
      if (e.kind === 'match' && e.winner === match.local && match === offline) onMatchWon();
    }
    if (eventLog.length > 100) eventLog.splice(0, eventLog.length - 100);
  },
  replay(on) {
    hud.setReplay(on);
    renderer.cut();
  },
  replayed: showSwingsAndSounds,
  draw(prev, curr, alpha, live, dt) {
    hud.update(live, dt);
    renderer.render(prev, curr, alpha, dt);
  },
};
/** The offline Match or Practice, against the Venue's Bot or the ball machine. */
const offline = new LocalMatch({
  sim: simTuning,
  viewTuning,
  input: () => input.sample(),
  rematch: () => newMatch(Date.now()),
  view,
});
/** The Match in play: `offline`, or an online one once its Court starts it. */
let match: MatchDriver = offline;
renderer.setLocalSide(match.local);

/** Live or replayed: where each hit was met, and the sounds. */
function showSwingsAndSounds(s: SimState, events: readonly SimEvent[]) {
  renderer.onEvents(s, events);
  playEvents(events, endOf(s, match.local), viewTuning);
}
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
  // The other Side wears the Venue Bot's colors, online too for now.
  renderer.setColors(other(match.local), botColors(id));
  void setAmbience(VENUE_ASSETS[id].ambience, viewTuning);
}

/** `online` covers joining a Court, waiting for its Match, and being disconnected from it. */
/** The colors of `id`'s Bot. */
function botColors(id: VenueId) {
  return { ...DEFAULT_PLAYER_COLORS, ...VENUES[id].bot };
}

type Mode = 'menu' | 'locker' | 'match' | 'paused' | 'online';
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
pause.on('#quit', () => quitToMenu());

const onlineStatus = new Overlay(
  'online',
  `<h1>Online</h1>
  <p class="online-status"></p>
  <button id="leave">Leave</button>`,
);
onlineStatus.on('#leave', () => quitToMenu());

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
  offline.startMatch(createInitialState(seed, { ...DEFAULT_MATCH, rallyScoring: s.rallyScoring, bestOf: s.bestOf }), bot);
  hud.reset();
}

/** Practice mode at the Venue on show: the ball machine plays Side 1, and there is no score. */
function startPractice() {
  if (match !== offline) return;
  const p = new Practice();
  const machine = createMachine(Date.now(), simTuning, () => p.step);
  renderer.setMachine(true);
  offline.startPractice(p, machine);
  hud.reset();
  showPractice();
  setMode('match');
}

function showPractice() {
  const p = offline.practice!;
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

/** Online, drives the local Player instead of the keyboard: called once per Tick with the newest Snapshot's state. */
let drive: ((s: SimState) => Intent) | null = null;

/** Back to the map. Leaving an online Match reloads the page offline, which drops the Court and its driver. */
function quitToMenu() {
  if (match === offline) return setMode('menu');
  location.assign(location.pathname);
}

const COURT_ERRORS: Record<CourtErrorCode, string> = {
  full: 'That Court is full.',
  not_found: 'There is no Court with that code.',
  bad_name: 'That Display name is not allowed.',
  version: 'This game is out of date. Reload to update it.',
  bad_message: 'The Court did not understand this game.',
};

/**
 * Joins the Court in `?court=`, or creates one with the Preset in `?host=` first, then plays its Match as the
 * Display name in `?name=`. The Hud, renderer and colors follow the seat the Court gives.
 */
async function goOnline() {
  const status = (text: string) => {
    onlineStatus.el.querySelector('.online-status')!.textContent = text;
    setMode('online');
  };
  status('Connecting…');
  const name = validateDisplayName(params.get('name') ?? 'Player');
  if (!name.ok) return status(COURT_ERRORS.bad_name);
  const [{ createCourt, joinCourt }, { OnlineMatch: Online }] = await Promise.all([import('./online/connection'), import('./match/online')]);

  let code = params.get('court')?.toUpperCase() ?? '';
  if (code === '') {
    const preset = params.get('host');
    try {
      code = await createCourt(name.name, isPresetId(preset) ? preset : DEFAULT_PRESET);
    } catch (e) {
      return status(`Could not create a Court: ${(e as Error).message}`);
    }
    // A reload rejoins this Court as its Host.
    params.delete('host');
    params.set('court', code);
    history.replaceState(null, '', `?${params}`);
  }

  let side: SideIndex = 0;
  let online: OnlineMatch | null = null;
  const link = joinCourt(code, name.name, {
    onMessage(msg) {
      if (msg.t === 'welcome') {
        side = msg.side;
        status(`Court ${code}. Waiting for the Match to start…`);
        // The Venue is on show already.
        link.send({ t: 'ready' });
      } else if (msg.t === 'start') {
        online = new Online({
          local: side,
          start: createInitialState(msg.seed, PRESETS[msg.preset].config),
          view,
          input: () => (mode !== 'match' ? STILL : drive ? drive(online!.latest) : input.sample()),
          send: (m) => link.send(m),
        });
        match = online;
        renderer.setLocalSide(side);
        renderer.setMachine(false);
        renderer.setColors(side, colors);
        renderer.setColors(other(side), botColors(venue));
        renderer.cut();
        hud.setOnline(side, msg.players[other(side)]?.name ?? 'Player');
        hud.setPractice(null);
        hud.reset();
        setMode('match');
      } else if (msg.t === 'snap') online?.receive(msg);
      else if (msg.t === 'error') status(COURT_ERRORS[msg.code]);
    },
    onClose(closeCode, reason) {
      // A refusal already said why.
      if (Object.hasOwn(COURT_ERRORS, reason)) return;
      if (reason === 'replaced') status('This seat is being played in another tab.');
      else status(closeCode === COURT_CLOSE ? 'The Court has closed.' : 'Lost the connection to the Court. Reload to rejoin.');
    },
  });
}

function setMode(m: Mode) {
  mode = m;
  menu.el.hidden = m !== 'menu';
  pause.el.hidden = m !== 'paused';
  onlineStatus.el.hidden = m !== 'online';
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
// Dev only until issue 16: a production build has no way online.
if (import.meta.env.DEV && (params.has('court') || params.has('host'))) void goOnline();
else if (params.has('practice')) startPractice();
else setMode(params.has('play') ? 'match' : 'menu');
// The menu doesn't draw the court, so draw it once: the Park stands behind the map until a Venue is played.
if (mode === 'menu') renderer.render(match.prev, match.curr, 1, 0);

if (import.meta.env.DEV && params.has('debug')) {
  import('./debug/panel').then(({ createDebugPanel }) => createDebugPanel(simTuning, viewTuning, DIFFICULTY[settings().difficulty]));
  import('./debug/overlays').then(({ createOverlays }) => createOverlays(renderer, simTuning, () => offline.bot));
}

// Exposed for playtests and console poking. Online, `state` is the state drawn; `rally`, `replay` and `practice` are
// null; `advance` and `startPractice` throw, since the Court steps the Match; and `drive` sets the local Player's
// input (null gives it back to the keyboard). `frames` runs either kind of Match.
(window as unknown as { dink: unknown }).dink = {
  get state() {
    return match.curr;
  },
  get rally() {
    return match === offline ? offline.rally : null;
  },
  get replay() {
    return match === offline ? offline.replay : null;
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
  startPractice() {
    if (match !== offline) throw new Error('Practice is offline only');
    startPractice();
  },
  get practice() {
    return match === offline ? offline.practice : null;
  },
  /** Online only: the Side this screen plays, or null offline. */
  get online() {
    return match === offline ? null : { side: match.local };
  },
  get drive() {
    return drive;
  },
  set drive(fn: ((s: SimState) => Intent) | null) {
    drive = fn;
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
    if (match !== offline) throw new Error('advance is offline only: the Court steps an online Match');
    for (let i = 0; i < ticks; i++) offline.tick(drive?.(offline.curr));
    renderer.render(offline.prev, offline.curr, 1, TICK);
    hud.update(offline.curr, ticks * TICK);
    return offline.curr;
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
    if (mode === 'match' && match.curr.phase === 'over') quitToMenu();
    else if (mode === 'match') setMode('paused');
    else if (mode === 'paused') setMode('match');
    else if (mode === 'locker') setMode('menu');
  }

  if (mode === 'menu') {
    // The map is drawn instead of the court, which keeps its last frame behind the menu.
    map.draw(dt);
  } else if (mode === 'match' || (mode === 'paused' && match !== offline)) {
    // The Court doesn't wait, so an online Match plays on behind the pause menu.
    match.frame(dt);
  } else {
    // The court sits still behind the other menus.
    renderer.render(match.prev, match.curr, 1, dt);
  }
}

requestAnimationFrame(frame);
