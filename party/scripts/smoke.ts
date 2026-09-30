// A scripted client for a Court under `wrangler dev`. Start `npm run party`, then `npm --prefix party run smoke`
// for the handshake checks, or `npm --prefix party run smoke -- --match` to have two Bots play a whole Match.
// Pass another base URL as an argument to aim it elsewhere.
import { DIFFICULTY, createBot, type Bot } from '../../src/bot/bot';
import { observe } from '../../src/bot/observe';
import { PROTOCOL_VERSION, decode, encode, quantizeIntent, simHash, type CourtMsg, type HelloMsg } from '../../src/net';
import type { Intent, SideIndex, SimState } from '../../src/sim';
import { simTuning } from '../../src/tuning';

const args = process.argv.slice(2);
const BASE = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:8787';
const MATCH = args.includes('--match');
const ORIGIN = 'http://localhost:5173';
const TIMEOUT_MS = 5_000;
/** A Quick Match between easy Bots takes a few minutes of real time: Game speed online is always 1. */
const MATCH_TIMEOUT_MS = 20 * 60_000;
const PROGRESS_MS = 15_000;

interface Client {
  ws: WebSocket;
  /** The Court's first answer to the hello. */
  first: CourtMsg;
  /** Every later message. */
  onMessage?: (msg: CourtMsg) => void;
}

/** Connects to a Court, says hello, and waits for the first answer. */
function connect(code: string, hello: Partial<HelloMsg> = {}): Promise<Client> {
  const url = `${BASE.replace(/^http/, 'ws')}/parties/court/${code}`;
  // Node's WebSocket (undici) takes headers; browsers send Origin themselves.
  const ws = new WebSocket(url, { headers: { Origin: ORIGIN } } as unknown as string[]);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer from ${code}`)), TIMEOUT_MS);
    ws.addEventListener('open', () =>
      ws.send(encode({ t: 'hello', name: 'Smoke', protocolVersion: PROTOCOL_VERSION, simHash: simHash(simTuning), ...hello })),
    );
    let client: Client | null = null;
    ws.addEventListener('message', (e) => {
      const msg = decode(String(e.data)) as CourtMsg;
      if (client !== null) return client.onMessage?.(msg);
      clearTimeout(timer);
      client = { ws, first: msg };
      resolve(client);
    });
    ws.addEventListener('error', () => reject(new Error(`socket error on ${code}`)));
  });
}

function close(c: Client): Promise<void> {
  return new Promise((resolve) => {
    if (c.ws.readyState === WebSocket.CLOSED) return resolve();
    c.ws.addEventListener('close', () => resolve());
    c.ws.close();
  });
}

function check(what: string, ok: boolean, detail?: unknown): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : `: ${JSON.stringify(detail)}`}`);
  if (!ok) process.exitCode = 1;
}

/** Creates a Court with the Smoke Host. */
async function create(preset: string): Promise<{ status: number; code: string; hostToken: string; cors: string | null }> {
  const res = await fetch(`${BASE}/create`, {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Smoke Host', preset }),
  });
  const { code, hostToken } = (await res.json()) as { code: string; hostToken: string };
  return { status: res.status, code, hostToken, cors: res.headers.get('Access-Control-Allow-Origin') };
}

async function handshake(): Promise<void> {
  const refused = await fetch(`${BASE}/create`, { method: 'POST', headers: { Origin: 'https://evil.example' }, body: '{}' });
  check('create refuses a foreign Origin', refused.status === 403, refused.status);

  const badName = await fetch(`${BASE}/create`, { method: 'POST', headers: { Origin: ORIGIN }, body: JSON.stringify({ name: '', preset: 'quick' }) });
  check('create refuses a bad name', badName.status === 400, await badName.text());

  const { status, code, hostToken, cors } = await create('quick');
  check(`create answers with a code (${code}) and a Host token`, status === 200 && /^[A-Z2-9]{5}$/.test(code) && !!hostToken);
  check('create sends CORS headers', cors === ORIGIN);

  const http = await fetch(`${BASE}/parties/court/${code}`, { headers: { Origin: ORIGIN } });
  check('plain HTTP to the Court is refused', http.status === 404, http.status);

  const host = await connect(code, { name: 'Smoke Host', token: hostToken });
  check('the Host is seated on Side 0', host.first.t === 'welcome' && host.first.side === 0 && host.first.preset === 'quick', host.first);

  const guest = await connect(code, { name: 'Smoke Guest' });
  const guestToken = guest.first.t === 'welcome' ? guest.first.token : '';
  check('a Guest is seated on Side 1', guest.first.t === 'welcome' && guest.first.side === 1 && guestToken !== hostToken, guest.first);
  check(
    'the welcome lists both Players',
    guest.first.t === 'welcome' && guest.first.players[0]?.name === 'Smoke Host' && guest.first.players[1]?.name === 'Smoke Guest',
    guest.first,
  );

  const third = await connect(code, { name: 'Third' });
  check('a third client gets full', third.first.t === 'error' && third.first.code === 'full', third.first);

  await close(guest);
  const back = await connect(code, { name: 'Smoke Guest', token: guestToken });
  check('the Guest reconnects with its token and gets Side 1 back', back.first.t === 'welcome' && back.first.side === 1 && back.first.token === guestToken, back.first);

  const version = await connect(code, { simHash: 'deadbeef' });
  check('a Sim hash mismatch gets version', version.first.t === 'error' && version.first.code === 'version', version.first);

  const badHello = await connect(code, { name: '<script>' });
  check('a bad Display name gets bad_name', badHello.first.t === 'error' && badHello.first.code === 'bad_name', badHello.first);

  const unknown = await connect('ZZZZZ');
  check('an unprovisioned Court gets not_found', unknown.first.t === 'error' && unknown.first.code === 'not_found', unknown.first);

  await Promise.all([close(host), close(back)]);
}

interface Played {
  state: SimState;
  winner: SideIndex;
  snaps: number;
  /** Snapshots that arrived after `over`, so far: there should be none. */
  late: () => number;
}

/**
 * Plays one Side with an easy Bot on the latest Snapshot. Snapshots come every 2 Ticks, but the Bot must think exactly
 * once per Tick (it serves on an exact Tick), so it thinks for each Tick since the last Snapshot, on that Snapshot's
 * state. A shot from any of those thoughts goes out with the last one's move and aim; the Court latches it.
 */
function botSide(c: Client, onSnap: (s: SimState) => void): Promise<Played> {
  if (c.first.t !== 'welcome') throw new Error(`not seated: ${JSON.stringify(c.first)}`);
  const side = c.first.side;
  let bot: Bot | null = null;
  let thought = 0;
  let snaps = 0;
  let late = 0;
  let state: SimState | null = null;
  return new Promise((resolve, reject) => {
    c.ws.addEventListener('close', (e) => reject(new Error(`Side ${side} closed: ${e.code} ${e.reason}`)));
    c.onMessage = (msg) => {
      if (msg.t === 'start') bot = createBot(side, msg.seed + 1 + side, DIFFICULTY.easy, simTuning);
      else if (msg.t === 'snap' && bot !== null) {
        if (state?.phase === 'over') late++;
        snaps++;
        state = msg.state;
        onSnap(state);
        let intent: Intent | null = null;
        let shot: Intent['shot'] = null;
        for (let k = thought + 1; k <= msg.tick; k++) {
          intent = bot.think({ ...observe(msg.state, side), tick: k });
          shot ??= intent.shot;
        }
        thought = msg.tick;
        if (intent !== null) c.ws.send(encode({ t: 'in', tick: msg.tick, intent: quantizeIntent({ ...intent, shot }) }));
      } else if (msg.t === 'over' && state !== null) resolve({ state, winner: msg.winner, snaps, late: () => late });
    };
    c.ws.send(encode({ t: 'ready' }));
  });
}

async function match(): Promise<void> {
  const began = Date.now();
  const { code, hostToken } = await create('quick');
  const host = await connect(code, { name: 'Smoke Host', token: hostToken });
  const guest = await connect(code, { name: 'Smoke Guest' });
  console.log(`Court ${code}: two easy Bots play a Quick Match in real time. This takes a few minutes.`);
  let latest: SimState | null = null;
  const played = Promise.all([botSide(host, (s) => (latest = s)), botSide(guest, () => {})]);
  const progress = setInterval(() => {
    const s = latest as SimState | null;
    if (s !== null) console.log(`     Tick ${s.tick}, ${s.match.points.join('-')}, ${Math.round((Date.now() - began) / 1000)} s`);
  }, PROGRESS_MS);
  let giveUp: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => (giveUp = setTimeout(() => reject(new Error('the Match took too long')), MATCH_TIMEOUT_MS)));
  try {
    const [a, b] = await Promise.race([played, timeout]);
    const wall = Math.round((Date.now() - began) / 1000);
    check('both Players get over with the same winner', a.winner === b.winner && a.state.match.winner === a.winner, [a.winner, b.winner]);
    check('both final Snapshots show the same state', JSON.stringify(a.state) === JSON.stringify(b.state));
    check('the final Snapshot is over', a.state.phase === 'over');
    // The Court's interval should have stopped: nothing more arrives.
    await new Promise((r) => setTimeout(r, 1_000));
    check('no Snapshot comes after over', a.late() + b.late() === 0, a.late() + b.late());
    console.log(`Side ${a.winner} won ${a.state.match.points.join('-')} at Tick ${a.state.tick}, ${a.snaps} Snapshots, ${wall} s wall time`);
  } finally {
    clearTimeout(giveUp);
    clearInterval(progress);
    await Promise.all([close(host), close(guest)]);
  }
}

(MATCH ? match() : handshake()).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
