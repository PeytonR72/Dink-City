import { getServerByName, routePartykitRequest } from 'partyserver';
import { isPresetId, validateDisplayName } from '../../src/net';
import { makeCourtCode, isCourtCode } from './courtCode';
import type { Env } from './env';
import { LOBBY_NAME } from './lobby';
import { isAllowedOrigin } from './origin';

export { Court } from './court';
export { Lobby } from './lobby';

/** Tries this many fresh codes before giving up on a create. */
const CODE_ATTEMPTS = 5;
/** A create body is about 40 bytes. */
const MAX_BODY = 1024;

const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    if (new URL(request.url).pathname === '/create') return create(request, env, origin);
    const response = await routePartykitRequest(request, env, {
      onBeforeConnect: (_req, { className, name }) => {
        if (!isAllowedOrigin(origin)) return new Response('Forbidden', { status: 403 });
        const known = className === 'COURT' ? isCourtCode(name) : className === 'LOBBY' && name === LOBBY_NAME;
        if (!known) return new Response('Not found', { status: 404 });
      },
      // Only WebSockets reach the Durable Objects from outside. The Worker talks to them over RPC.
      onBeforeRequest: () => new Response('Not found', { status: 404 }),
    });
    return response ?? new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;

/** `POST /create { name, preset }` → `{ code, hostToken }`. */
async function create(request: Request, env: Env, origin: string | null): Promise<Response> {
  if (!isAllowedOrigin(origin)) return new Response('Forbidden', { status: 403 });
  const cors = {
    'Access-Control-Allow-Origin': origin!,
    'Access-Control-Allow-Methods': 'POST',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Max-Age': '86400' } });
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: cors });
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });

  if (Number(request.headers.get('Content-Length') ?? 0) > MAX_BODY) return json({ error: 'bad_message' }, 400);
  const text = await request.text();
  let body: { name?: unknown; preset?: unknown } | null = null;
  try {
    if (text.length <= MAX_BODY) body = JSON.parse(text);
  } catch {}
  if (typeof body !== 'object' || body === null) return json({ error: 'bad_message' }, 400);
  const name = validateDisplayName(body.name);
  if (!name.ok) return json({ error: 'bad_name' }, 400);
  if (!isPresetId(body.preset)) return json({ error: 'bad_preset' }, 400);

  const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
    const code = makeCourtCode(randomBytes);
    const court = await getServerByName(env.COURT, code);
    const result = await court.provision({ hostName: name.name, preset: body.preset, seed });
    if (result.ok) return json({ code, hostToken: result.hostToken });
  }
  return json({ error: 'busy' }, 503);
}
