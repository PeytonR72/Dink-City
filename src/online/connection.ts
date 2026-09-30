// The browser's end of a Court: the WebSocket, the handshake and the rejoin token. The only online code that
// touches the DOM or sockets; everything it carries is defined in `src/net/`.
import { PROTOCOL_VERSION, decode, encode, isCourtMsg, simHash, type ClientMsg, type CourtMsg, type PresetId } from '../net';
import { simTuning } from '../tuning';

/** Where the Worker runs: `wrangler dev` unless the build says otherwise (issue 16 sets production's). */
export const PARTY_HOST: string = import.meta.env.VITE_PARTY_HOST ?? 'localhost:8787';

/** `wrangler dev` speaks plain HTTP; anywhere else is TLS. */
function url(scheme: 'http' | 'ws', path: string): string {
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(PARTY_HOST);
  return `${scheme}${local ? '' : 's'}://${PARTY_HOST}${path}`;
}

/** The seat token for a Court lives with the tab, so a reload rejoins the same seat and a new tab doesn't. */
const tokenKey = (code: string) => `dink.court.${code}`;

function loadToken(code: string): string | undefined {
  try {
    return sessionStorage.getItem(tokenKey(code)) ?? undefined;
  } catch {
    return undefined;
  }
}

function saveToken(code: string, token: string) {
  try {
    sessionStorage.setItem(tokenKey(code), token);
  } catch {}
}

/** Creates a Court with this Player as its Host, and keeps the Host token for the hello. Returns its code. */
export async function createCourt(name: string, preset: PresetId): Promise<string> {
  const res = await fetch(url('http', '/create'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, preset }),
  });
  const body = (await res.json().catch(() => ({}))) as { code?: string; hostToken?: string; error?: string };
  if (!res.ok || !body.code || !body.hostToken) throw new Error(body.error ?? `create failed (${res.status})`);
  saveToken(body.code, body.hostToken);
  return body.code;
}

export interface CourtLink {
  send(msg: ClientMsg): void;
}

/**
 * Joins the Court named `code` as `name`, rejoining this tab's seat if it has a token. Every well-formed Court
 * message goes to `onMessage`; `onClose` gets the close code and reason when the Court or the network ends it.
 */
export function joinCourt(
  code: string,
  name: string,
  handlers: { onMessage(msg: CourtMsg): void; onClose(code: number, reason: string): void },
): CourtLink {
  const ws = new WebSocket(url('ws', `/parties/court/${code}`));
  ws.addEventListener('open', () =>
    ws.send(encode({ t: 'hello', name, token: loadToken(code), protocolVersion: PROTOCOL_VERSION, simHash: simHash(simTuning) })),
  );
  ws.addEventListener('message', (e) => {
    const msg = typeof e.data === 'string' ? decode(e.data) : null;
    if (!isCourtMsg(msg)) return;
    if (msg.t === 'welcome') saveToken(code, msg.token);
    handlers.onMessage(msg);
  });
  ws.addEventListener('close', (e) => handlers.onClose(e.code, e.reason));
  return {
    send(msg) {
      if (ws.readyState === WebSocket.OPEN) ws.send(encode(msg));
    },
  };
}
