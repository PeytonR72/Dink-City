// A scripted client for a Court under `wrangler dev`. Start `npm run party`, then `npm --prefix party run smoke`
// for the handshake checks, `-- --match` to have two Bots play a whole Match, `-- --lobby` for the Lobby's list, or
// `-- --expire` to see an entry expire (under a shortened TTL; see the README). Pass another base URL as an argument
// to aim it elsewhere.
import { DIFFICULTY, createBot, type Bot } from '../../src/bot/bot';
import { observe } from '../../src/bot/observe';
import {
  PROTOCOL_VERSION,
  createClockSync,
  createInputStream,
  decode,
  encode,
  inputFrame,
  simHash,
  type CourtMsg,
  type HelloMsg,
  type LobbyCourt,
  type LobbyMsg,
} from '../../src/net';
import { TICK, type SideIndex, type SimState } from '../../src/sim';
import { simTuning } from '../../src/tuning';

const args = process.argv.slice(2);
const BASE = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:8787';
const MODE = args.find((a) => ['--match', '--lobby', '--expire'].includes(a)) ?? '--handshake';
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

/** A socket to a Durable Object, with the Origin a browser would send. */
function open(party: 'court' | 'lobby', name: string): WebSocket {
  // Node's WebSocket (undici) takes headers; browsers send Origin themselves.
  return new WebSocket(`${BASE.replace(/^http/, 'ws')}/parties/${party}/${name}`, { headers: { Origin: ORIGIN } } as unknown as string[]);
}

/** Connects to a Court, says hello, and waits for the first answer. */
function connect(code: string, hello: Partial<HelloMsg> = {}): Promise<Client> {
  const ws = open('court', code);
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

function close(c: { ws: WebSocket }): Promise<void> {
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
  /** The round trip (ms) and input lead (Ticks) at the end. */
  net: { rtt: number; lead: number };
}

/**
 * Plays one Side with an easy Bot on the latest Snapshot, the way `OnlineMatch` sends input: it syncs to the Court's
 * clock with pings, and every frame stamps an Intent for each Tick up to its input Tick, resending the unacknowledged.
 * The Bot thinks once per Tick stamped (it serves on an exact Tick), told that Tick, on the latest Snapshot's state.
 */
function botSide(c: Client, onSnap: (s: SimState) => void): Promise<Played> {
  if (c.first.t !== 'welcome') throw new Error(`not seated: ${JSON.stringify(c.first)}`);
  const side = c.first.side;
  const sync = createClockSync();
  const stream = createInputStream();
  let bot: Bot | null = null;
  let frames: ReturnType<typeof setInterval> | undefined;
  let snaps = 0;
  let late = 0;
  let state: SimState | null = null;
  const frame = () => {
    if (bot === null || state === null) return;
    const [b, s] = [bot, state];
    for (const msg of inputFrame(sync, stream, performance.now(), (tick) => b.think({ ...observe(s, side), tick }))) c.ws.send(encode(msg));
  };
  return new Promise((resolve, reject) => {
    c.ws.addEventListener('close', (e) => {
      clearInterval(frames);
      reject(new Error(`Side ${side} closed: ${e.code} ${e.reason}`));
    });
    c.onMessage = (msg) => {
      if (msg.t === 'start') {
        bot = createBot(side, msg.seed + 1 + side, DIFFICULTY.easy, simTuning);
        frames = setInterval(frame, TICK * 1000);
      } else if (msg.t === 'pong') sync.pong(msg, performance.now());
      else if (msg.t === 'snap') {
        if (state?.phase === 'over') late++;
        snaps++;
        state = msg.state;
        stream.ack(msg.ack);
        onSnap(state);
      } else if (msg.t === 'over' && state !== null) {
        clearInterval(frames);
        resolve({ state, winner: msg.winner, snaps, late: () => late, net: { rtt: sync.rtt, lead: sync.lead } });
      }
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
    console.log(`     round trip ${a.net.rtt.toFixed(1)} ms, input lead ${a.net.lead.toFixed(2)} Ticks`);
  } finally {
    clearTimeout(giveUp);
    clearInterval(progress);
    await Promise.all([close(host), close(guest)]);
  }
}

interface Subscriber {
  ws: WebSocket;
  courts: LobbyCourt[];
  /** Waits for the list to satisfy `ok`, and resolves with how long that took, or null after `ms`. */
  until(ok: (courts: LobbyCourt[]) => boolean, ms: number): Promise<number | null>;
}

/** Subscribes to the Lobby, like the menu's Online panel, and waits for the first list. */
function subscribe(): Promise<Subscriber> {
  const ws = open('lobby', 'global');
  const waiters = new Set<() => void>();
  const sub: Subscriber = {
    ws,
    courts: [],
    until(ok, ms) {
      const began = Date.now();
      return new Promise((resolve) => {
        const check = () => {
          if (!ok(sub.courts)) return;
          waiters.delete(check);
          clearTimeout(timer);
          resolve(Date.now() - began);
        };
        const timer = setTimeout(() => {
          waiters.delete(check);
          resolve(null);
        }, ms);
        waiters.add(check);
        check();
      });
    },
  };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no list from the Lobby')), TIMEOUT_MS);
    ws.addEventListener('message', (e) => {
      const msg = decode(String(e.data)) as LobbyMsg;
      if (msg.t !== 'courts') return;
      sub.courts = msg.courts;
      clearTimeout(timer);
      resolve(sub);
      for (const w of [...waiters]) w();
    });
    ws.addEventListener('error', () => reject(new Error('socket error on the Lobby')));
  });
}

const listed = (code: string) => (courts: LobbyCourt[]) => courts.some((c) => c.code === code);
const unlisted = (code: string) => (courts: LobbyCourt[]) => !courts.some((c) => c.code === code);
const took = (ms: number | null) => (ms === null ? 'never' : `${ms} ms`);

/** Waits for the next message on a Court client, or null after `ms`. */
function next(c: Client, ms: number): Promise<CourtMsg | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    c.onMessage = (msg) => {
      clearTimeout(timer);
      c.onMessage = undefined;
      resolve(msg);
    };
  });
}

async function lobby(): Promise<void> {
  const sub = await subscribe();
  check('the Lobby sends the list on connect', Array.isArray(sub.courts));

  const began = Date.now();
  const { code, hostToken } = await create('quick');
  const shown = (await sub.until(listed(code), 1_000)) === null ? null : Date.now() - began;
  check(`a new Court is listed within 1 s of the create request (${took(shown)})`, shown !== null && shown <= 1_000);
  const entry = sub.courts.find((c) => c.code === code);
  check('the entry names the host and the Preset, with one Player', entry?.hostName === 'Smoke Host' && entry.preset === 'quick' && entry.players === 1, entry);

  const host = await connect(code, { name: 'Smoke Host', token: hostToken });
  const guest = await connect(code, { name: 'Smoke Guest' });
  const hidden = await sub.until(unlisted(code), 1_000);
  check(`it leaves the list when a Guest joins (${took(hidden)})`, hidden !== null);

  console.log("     the Guest leaves; their seat is freed after the 30 s grace");
  await close(guest);
  const back = await sub.until(listed(code), 35_000);
  check(`it comes back once the Guest's seat is freed (${took(back)} after they left)`, back !== null);

  const second = await connect(code, { name: 'Second Guest' });
  const hiddenAgain = await sub.until(unlisted(code), 1_000);
  check(`it leaves the list again for the next Guest (${took(hiddenAgain)})`, hiddenAgain !== null);
  const started = Promise.all([next(host, TIMEOUT_MS), next(second, TIMEOUT_MS)]);
  for (const c of [host, second]) c.ws.send(encode({ t: 'ready' }));
  const [a, b] = await started;
  check('both Players get start', a?.t === 'start' && b?.t === 'start', [a?.t, b?.t]);
  // The start removes an entry that's already hidden, so from outside it can only be seen as the Court staying off
  // the list. courtDirectory's tests cover the removal itself.
  check('it stays off the list once the Match has started', (await sub.until(listed(code), 2_000)) === null);
  await Promise.all([close(host), close(second)]);

  console.log('     two Hosts leave before the start, one alone and one with a Guest seated (15 s reload grace)');
  const alone = await create('standard');
  const pair = await create('long');
  const aloneHost = await connect(alone.code, { name: 'Smoke Host', token: alone.hostToken });
  const pairHost = await connect(pair.code, { name: 'Smoke Host', token: pair.hostToken });
  const pairGuest = await connect(pair.code, { name: 'Smoke Guest' });
  check('the lone Host is listed and the full Court is not', (await sub.until((cs) => listed(alone.code)(cs) && unlisted(pair.code)(cs), 1_000)) !== null);
  const told = next(pairGuest, 20_000);
  const left = Date.now();
  await Promise.all([close(aloneHost), close(pairHost)]);
  const gone = await sub.until(unlisted(alone.code), 20_000);
  check(`the lone Host's Court leaves the list after the grace (${took(gone)})`, gone !== null && gone >= 14_000, gone);
  const msg = await told;
  check(`the seated Guest gets host_left (${Date.now() - left} ms after the Host left)`, msg?.t === 'error' && msg.code === 'host_left', msg);
  const late = await connect(pair.code, { name: 'Late' });
  check('the closed Court refuses a newcomer', late.first.t === 'error' && late.first.code === 'not_found', late.first);
  await Promise.all([close(pairGuest), close(late)]);
  await close(sub);
}

/**
 * Needs `LOBBY_TTL_MS` under 15 s (see the README). The Court heartbeats only every 30 s, so between heartbeats its
 * entry gets no reports, just like one whose Court was killed.
 */
async function expire(): Promise<void> {
  const sub = await subscribe();
  const { code, hostToken } = await create('quick');
  const host = await connect(code, { name: 'Smoke Host', token: hostToken });
  check('the Court is listed', (await sub.until(listed(code), 1_000)) !== null);
  const gone = await sub.until(unlisted(code), 28_000);
  check(`its entry expires with no reports (${took(gone)}: the TTL plus up to one 15 s sweep)`, gone !== null, gone);
  await close(host);
  await close(sub);
}

const modes: Record<string, () => Promise<void>> = { '--handshake': handshake, '--match': match, '--lobby': lobby, '--expire': expire };
modes[MODE]!().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
