import { createBasicBot } from './bot/basicBot';
import { Input } from './input/input';
import { Renderer } from './render/renderer';
import { TICK, createInitialState, step, type DeadReason, type Intent, type SimEvent, type SimState } from './sim';
import { simTuning, viewTuning } from './tuning';

const MAX_FRAME = 0.25;
const CALLOUTS: Record<DeadReason, string> = {
  out: 'OUT',
  'double-bounce': 'POINT',
  net: 'NET',
  gone: 'OUT',
};

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const callout = document.querySelector<HTMLDivElement>('#callout')!;

const renderer = new Renderer(canvas, viewTuning);
const input = new Input();
const bot = createBasicBot(1, 1234);

let prev: SimState = createInitialState(Date.now());
let curr: SimState = prev;
let acc = 0;
let last = performance.now();
let calloutTimer = 0;
const eventLog: ({ tick: number } & SimEvent)[] = [];

if (import.meta.env.DEV && new URLSearchParams(location.search).has('debug')) {
  import('./debug/panel').then(({ createDebugPanel }) => createDebugPanel(simTuning, viewTuning));
}

// Exposed for Playwright playtests and console poking.
(window as unknown as { dink: unknown }).dink = {
  get state() {
    return curr;
  },
  simTuning,
  viewTuning,
  eventLog,
  /** Step N Ticks synchronously (works while the tab is hidden). `drive` overrides local input. */
  advance(ticks: number, drive?: (s: SimState) => Intent) {
    for (let i = 0; i < ticks; i++) tick(drive?.(curr));
    renderer.render(prev, curr, 1, TICK);
    return curr;
  },
};

function tick(local: Intent = input.sample()) {
  prev = curr;
  curr = step(curr, [local, bot.think(curr)], simTuning);
  for (const e of curr.events) {
    if (e.kind === 'dead') showCallout(CALLOUTS[e.reason]);
    eventLog.push({ tick: curr.tick, ...e });
  }
  if (eventLog.length > 100) eventLog.splice(0, eventLog.length - 100);
}

function frame(now: number) {
  const dt = Math.min((now - last) / 1000, MAX_FRAME);
  last = now;
  acc += dt * viewTuning.gameSpeed;

  while (acc >= TICK) {
    tick();
    acc -= TICK;
  }

  calloutTimer -= dt;
  if (calloutTimer <= 0) callout.classList.remove('show');

  renderer.render(prev, curr, acc / TICK, dt);
  requestAnimationFrame(frame);
}

function showCallout(text: string) {
  callout.textContent = text;
  callout.classList.add('show');
  calloutTimer = 1.1;
}

requestAnimationFrame(frame);
