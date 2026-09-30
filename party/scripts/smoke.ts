// A scripted client for a Court under `wrangler dev`. Start `npm run party`, then `npm --prefix party run smoke`.
// Pass another base URL as the first argument to aim it elsewhere.
import { PROTOCOL_VERSION, decode, encode, simHash, type CourtMsg, type HelloMsg } from '../../src/net';
import { simTuning } from '../../src/tuning';

const BASE = process.argv[2] ?? 'http://localhost:8787';
const ORIGIN = 'http://localhost:5173';
const TIMEOUT_MS = 5_000;

interface Client {
  ws: WebSocket;
  /** The Court's first answer to the hello. */
  first: CourtMsg;
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
    ws.addEventListener('message', (e) => {
      clearTimeout(timer);
      resolve({ ws, first: decode(String(e.data)) as CourtMsg });
    });
    ws.addEventListener('error', () => reject(new Error(`socket error on ${code}`)));
  });
}

function close(c: Client): Promise<void> {
  return new Promise((resolve) => {
    c.ws.addEventListener('close', () => resolve());
    c.ws.close();
  });
}

function check(what: string, ok: boolean, detail?: unknown): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : `: ${JSON.stringify(detail)}`}`);
  if (!ok) process.exitCode = 1;
}

async function main(): Promise<void> {
  const refused = await fetch(`${BASE}/create`, { method: 'POST', headers: { Origin: 'https://evil.example' }, body: '{}' });
  check('create refuses a foreign Origin', refused.status === 403, refused.status);

  const badName = await fetch(`${BASE}/create`, { method: 'POST', headers: { Origin: ORIGIN }, body: JSON.stringify({ name: '', preset: 'quick' }) });
  check('create refuses a bad name', badName.status === 400, await badName.text());

  const created = await fetch(`${BASE}/create`, {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Smoke Host', preset: 'quick' }),
  });
  const { code, hostToken } = (await created.json()) as { code: string; hostToken: string };
  check(`create answers with a code (${code}) and a Host token`, created.status === 200 && /^[A-Z2-9]{5}$/.test(code) && !!hostToken);
  check('create sends CORS headers', created.headers.get('Access-Control-Allow-Origin') === ORIGIN);

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

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
