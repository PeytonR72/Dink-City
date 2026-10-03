import { setAmbience, updateAmbience } from './audio/ambience';
import { playEvents, unlockAudio } from './audio/sfx';
import { DIFFICULTY, createBot } from './bot/bot';
import { PERSONALITY, type PersonalityName } from './bot/personality';
import { Hud } from './hud/hud';
import { Input } from './input/input';
import type { MatchDriver, MatchView } from './match/driver';
import { LocalMatch } from './match/local';
import type { OnlineMatch } from './match/online';
import { Locker } from './menu/locker';
import { CityMap } from './menu/map';
import { Overlay, SettingsPanel } from './menu/menu';
import { OnlinePanel } from './menu/online';
import { COURT_CLOSE, onlineConfig, readCourtCode, type CourtErrorCode, type PresetId } from './net';
import type { CourtLink } from './online/connection';
import { onlineOffered } from './online/gate';
import { PRACTICE_STEPS, Practice, REPS_TO_PASS, createMachine } from './practice/practice';
import { DEFAULT_PLAYER_COLORS, loadModels, loadSurroundings } from './render/models';
import { Renderer } from './render/renderer';
import { loadColors, saveColors } from './save/colors';
import { guestName, loadName, saveName } from './save/name';
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
// ?court=CODE joins that Court (it's the link a Host shares), asking for a Display name first if none is saved.
const params = new URLSearchParams(location.search);
const store = browserStore();
let saved = loadSettings(store);
const settings = (): Settings => withFlags(saved, params);
let progress = loadProgress(store);
let colors = loadColors(store);
/** The Display name for online play, once one has been used or typed. */
let displayName = loadName(store);
const ONLINE = onlineOffered(import.meta.env);

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
  draw(prev, curr, alpha, live, dt, clock) {
    hud.update(live, dt);
    renderer.render(prev, curr, alpha, dt, clock);
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

/** The colors of `id`'s Bot. */
function botColors(id: VenueId) {
  return { ...DEFAULT_PLAYER_COLORS, ...VENUES[id].bot };
}

/**
 * `lobby` is the Online panel's list, `waiting` its wait for a Court's Match to start, and `online` the notice of an
 * online Match that was cut off.
 */
type Mode = 'menu' | 'locker' | 'match' | 'paused' | 'lobby' | 'waiting' | 'online';
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
if (ONLINE) {
  menu.el.querySelector('#open-practice')!.insertAdjacentHTML('beforebegin', '<button id="open-online" class="primary">Play online</button>');
  menu.on('#open-online', () => void openLobby());
}

const onlinePanel = new OnlinePanel(displayName ?? guestName(), {
  name: useName,
  create: (preset, name) => void goOnline(name, { preset }),
  join: (code, name) => void goOnline(name, { code }),
  cancel() {
    leaveCourt();
    void openLobby();
  },
  back: () => setMode('menu'),
});

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

/** Online, Esc opens this instead of pausing: the Court doesn't wait, so the Match plays on behind it. */
const leaveMenu = new Overlay(
  'leave-match',
  `<h1>Leave match?</h1>
  <p>The match plays on while this is open.</p>
  <button id="keep-playing" class="primary">Keep playing</button>
  <button id="leave-now">Leave</button>`,
);
leaveMenu.on('#keep-playing', () => setMode('match'));
leaveMenu.on('#leave-now', () => quitToMenu());

const onlineStatus = new Overlay(
  'online',
  `<h1>Online</h1>
  <p class="online-status"></p>
  <button id="leave">Leave</button>`,
);
onlineStatus.on('#leave', () => quitToMenu());

/** An online Match is over: both Players press Rematch to play again in the same Court. */
const onlineOver = new Overlay(
  'online-over',
  `<p class="rematch-status"></p>
  <button id="rematch" class="primary">Rematch</button>
  <button id="back-to-map">Back to map</button>`,
);
// The Court tells both Players of each ask, this one's included, and the panel shows what it said.
onlineOver.on('#rematch', () => court?.send({ t: 'rematch' }));
onlineOver.on('#back-to-map', () => quitToMenu());

/**
 * The rematch as the Court has told this screen: who has asked, and whether the opponent left instead, or the
 * Takeover Bot played for them, after which there's none.
 */
interface RematchOffer {
  local: SideIndex;
  opponent: string;
  asked: [boolean, boolean];
  left: boolean;
  bot: boolean;
}

/** The Match-over panel's line and button for `offer`. */
function showRematch({ local, opponent, asked, left, bot }: RematchOffer) {
  const mine = asked[local];
  const theirs = asked[other(local)];
  let text = '';
  if (bot) text = `No rematch: ${opponent} left, and a Bot finished the Match.`;
  else if (left) text = `${opponent} left.`;
  else if (mine && !theirs) text = `Waiting for ${opponent}…`;
  else if (theirs && !mine) text = `${opponent} wants a rematch`;
  onlineOver.el.querySelector('.rematch-status')!.textContent = text;
  onlineOver.el.querySelector<HTMLButtonElement>('#rematch')!.disabled = left || bot || mine;
}

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

/**
 * Back to the map. Leaving an online Match tells the Court and forgets the seat, so it won't rejoin by accident, then
 * reloads the page offline, which drops the Court and its driver.
 */
function quitToMenu() {
  if (match === offline) return setMode('menu');
  court?.leave();
  location.assign(location.pathname);
}

const COURT_ERRORS: Record<CourtErrorCode, string> = {
  full: 'That Court is full.',
  not_found: 'There is no Court with that code.',
  bad_name: 'That Display name is not allowed.',
  version: 'Please reload for the latest version.',
  bad_message: 'The Court did not understand this game.',
  host_left: 'The host left.',
};

/** Unsubscribes from the Lobby's list, while the Online panel shows it. */
let stopLobby: (() => void) | null = null;

/** The Online panel's list, with the Lobby's Courts live. `message` and `code` are as in `OnlinePanel.showList`. */
async function openLobby(message = '', code = '') {
  setMode('lobby');
  onlinePanel.showList(message, code);
  onlinePanel.setCourts(null);
  const { watchLobby } = await import('./online/connection');
  if (mode === 'lobby' && !stopLobby) stopLobby = watchLobby((courts) => onlinePanel.setCourts(courts));
}

/** The Court this screen is in, before and during its Match. */
let court: CourtLink | null = null;
/** Counts attempts to go online, so one that was cancelled while it waited on the network stops there. */
let attempt = 0;

/** Saves the Display name this Player typed or played under. */
function useName(name: string) {
  displayName = name;
  saveName(store, name);
}

/** Puts the Court's code in the URL, so a reload rejoins it in the same seat, or takes it out (null). */
function showCourtInUrl(code: string | null) {
  if (code) params.set('court', code);
  else params.delete('court');
  history.replaceState(null, '', params.size ? `?${params}` : location.pathname);
}

/** Leaves the Court before its Match starts. Its seat token stays, so its link still rejoins the same seat. */
function leaveCourt() {
  attempt++;
  court?.close();
  court = null;
  showCourtInUrl(null);
}

/**
 * Creates a Court with `preset` and joins it as its Host, or joins the Court `code`, as `name`, then waits for its
 * Match and plays it. The Hud, renderer and colors follow the seat the Court gives.
 */
async function goOnline(name: string, target: { preset: PresetId } | { code: string }) {
  const mine = ++attempt;
  useName(name);
  setMode('waiting');
  onlinePanel.showWaiting('Connecting…');
  // Before the start, anything that goes wrong returns to the list and says why; after it, the Match stays on screen.
  const fail = (text: string) => {
    if (match !== offline) return showOnlineStatus(text);
    leaveCourt();
    void openLobby(text);
  };
  const [{ createCourt, joinCourt }, { OnlineMatch }] = await Promise.all([import('./online/connection'), import('./match/online')]);
  if (mine !== attempt) return;

  let code: string;
  if ('code' in target) code = target.code;
  else {
    try {
      code = await createCourt(name, target.preset);
    } catch (e) {
      if (mine !== attempt) return;
      const reason = (e as Error).message;
      return fail(
        reason === 'bad_name'
          ? COURT_ERRORS.bad_name
          : e instanceof TypeError
            ? 'Could not reach the server. Try again in a moment.'
            : `Could not create a Court (${reason}).`,
      );
    }
    if (mine !== attempt) return;
  }
  showCourtInUrl(code);

  let side: SideIndex = 0;
  let online: InstanceType<typeof OnlineMatch> | null = null;
  let opponent = 'Player';
  /** The opponent left, which ended the Match or the wait for a rematch: the Court closing is no news. */
  let peerLeft = false;
  /** The Court said the Match is over, which a Snapshot may not have shown yet. */
  let over = false;
  const isOver = () => over || online?.latest.phase === 'over';
  let offer: RematchOffer = { local: 0, opponent, asked: [false, false], left: false, bot: false };
  const link = joinCourt(code, name, {
    onMessage(msg) {
      if (msg.t === 'welcome') {
        side = msg.side;
        // The Host shares the code and link; a Guest's opponent is already here, and the Match starts in a moment.
        onlinePanel.showWaiting('Waiting for opponent…', side === 0 ? code : null);
        // The Venue on show is loaded already. It isn't part of the Preset: each screen shows its own.
        link.send({ t: 'ready' });
      } else if (msg.t === 'start') {
        // The first Match, a rematch, or the one in play after a reload: each starts the screen afresh.
        over = false;
        peerLeft = false;
        online = new OnlineMatch({
          local: side,
          start: createInitialState(msg.seed, onlineConfig(msg.preset)),
          view,
          input: () => (mode !== 'match' ? STILL : drive ? drive(online!.latest) : input.sample()),
          send: (m) => link.send(m),
          tuning: simTuning,
        });
        match = online;
        renderer.setLocalSide(side);
        renderer.setMachine(false);
        renderer.setColors(side, colors);
        renderer.setColors(other(side), botColors(venue));
        renderer.cut();
        opponent = msg.players[other(side)]?.name ?? 'Player';
        offer = { local: side, opponent, asked: [false, false], left: false, bot: false };
        showRematch(offer);
        hud.setOnline(side, opponent);
        // A Player who reloads may find their opponent away.
        hud.setPeer(msg.players[other(side)]?.connected === false ? 'grace' : null);
        hud.setPractice(null);
        hud.reset();
        setMode('match');
      } else if (msg.t === 'snap') online?.receive(msg);
      else if (msg.t === 'pong') online?.pong(msg);
      else if (msg.t === 'peer') {
        hud.setPeer(msg.status, opponent);
        if (msg.status === 'bot') {
          // The Takeover Bot plays on for them. The Court closes once the Match is over: no rematch, and no news.
          peerLeft = true;
          offer.bot = true;
          showRematch(offer);
          hud.setOnline(side, `${opponent} (Bot)`);
          return;
        }
        // `gone` comes only once the Match is over (mid-Match it's `bot`): there's no rematch, and the Court closes; the
        // Match-over panel says so.
        if (msg.status !== 'gone' || online === null || !isOver()) return;
        peerLeft = true;
        offer.left = true;
        showRematch(offer);
      } else if (msg.t === 'over') over = true;
      else if (msg.t === 'rematch') {
        offer.asked[msg.side] = true;
        showRematch(offer);
      }
      else if (msg.t === 'error') fail(COURT_ERRORS[msg.code]);
    },
    onClose(closeCode, reason) {
      // A refusal already said why.
      if (peerLeft || Object.hasOwn(COURT_ERRORS, reason)) return;
      if (reason === 'replaced') fail('This seat is being played in another tab.');
      else if (closeCode === COURT_CLOSE) fail(isOver() ? 'No rematch: the Court has closed.' : 'The Court has closed.');
      else fail(match === offline ? 'Lost the connection to the Court.' : 'Lost the connection to the Court. Reload to rejoin.');
    },
  });
  court = link;
}

/** The notice over an online Match that was cut off, with the way back to the map. */
function showOnlineStatus(text: string) {
  onlineStatus.el.querySelector('.online-status')!.textContent = text;
  setMode('online');
}

function setMode(m: Mode) {
  mode = m;
  menu.el.hidden = m !== 'menu';
  // Online, Esc asks to leave instead: nothing pauses.
  pause.el.hidden = m !== 'paused' || match !== offline;
  leaveMenu.el.hidden = m !== 'paused' || match === offline;
  onlineStatus.el.hidden = m !== 'online';
  if (m !== 'lobby' && m !== 'waiting') onlinePanel.hide();
  // The Lobby's socket is open only while its list is on show.
  if (m !== 'lobby' && stopLobby) {
    stopLobby();
    stopLobby = null;
  }
  if (m === 'locker') locker.show();
  else locker.hide();
  if (m === 'menu') {
    map.refresh(progress);
    map.focusFirst();
  }
  if (m === 'paused') (match === offline ? pause : leaveMenu).show();
  if (m === 'match') (document.activeElement as HTMLElement | null)?.blur?.();
  document.body.dataset.mode = m;
  input.clear();
  last = performance.now();
}

newMatch(Date.now());
const courtParam = ONLINE ? params.get('court') : null;
const linked = courtParam === null ? null : readCourtCode(courtParam);
if (courtParam !== null && !linked) {
  leaveCourt();
  void openLobby(COURT_ERRORS.not_found);
} else if (linked && displayName) void goOnline(displayName, { code: linked });
else if (linked) void openLobby(`Pick a Display name, then join Court ${linked}.`, linked);
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
  /**
   * Online only: the Side this screen plays, the link as it measures it (`OnlineMatch.net`), and the Tick each Player
   * and the ball were last drawn at (`OnlineMatch.clock`); null offline.
   */
  get online() {
    if (match === offline) return null;
    const online = match as OnlineMatch;
    return { side: match.local, net: online.net, clock: online.clock };
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
    else if (mode === 'locker' || mode === 'lobby') setMode('menu');
  }
  // Online the Match-over panel offers a rematch or the way back to the map, in place of the shot press offline.
  const onlineOverShown = mode === 'match' && match !== offline && match.curr.phase === 'over';
  if (onlineOverShown && !onlineOver.shown) onlineOver.show();
  else if (!onlineOverShown) onlineOver.hide();

  if (mode === 'menu') {
    // The map is drawn instead of the court, which keeps its last frame behind the menu.
    map.draw(dt);
  } else if (mode === 'match' || (mode === 'paused' && match !== offline)) {
    // The Court doesn't wait, so an online Match plays on behind "Leave match?".
    match.frame(dt);
  } else {
    // The court sits still behind the other menus.
    renderer.render(match.prev, match.curr, 1, dt);
  }
}

requestAnimationFrame(frame);
