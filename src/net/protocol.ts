// The Court's wire messages, both directions. `decode` checks only the tag; the Court re-guards every payload.
import type { SideIndex } from '../sim';
import type { PresetId } from './presets';

/** Bump when a message changes shape. The handshake refuses a mismatch with `version`. */
export const PROTOCOL_VERSION = 1;

/** Why the Court refused a client. Every code but `bad_message` closes the socket. */
export type CourtErrorCode = 'full' | 'not_found' | 'bad_name' | 'version' | 'bad_message';

/** A seated Player as the other clients see them. */
export interface CourtPlayer {
  name: string;
  connected: boolean;
}

/** The handshake: a Display name, the rejoin token if the client has one, and what must match the Court's build. */
export interface HelloMsg {
  t: 'hello';
  name: string;
  token?: string;
  protocolVersion: number;
  simHash: string;
}

/** Client → Court. */
export type ClientMsg = HelloMsg;

/** Court → client. `welcome` seats the client on `side`; keep `token` to reclaim the seat after a reload. */
export type CourtMsg =
  | { t: 'welcome'; side: SideIndex; token: string; preset: PresetId; players: [CourtPlayer | null, CourtPlayer | null] }
  | { t: 'error'; code: CourtErrorCode };

/** A message as it goes on the wire. */
export function encode(msg: ClientMsg | CourtMsg): string {
  return JSON.stringify(msg);
}

/** Parses JSON with a string `t` tag, or returns null. Nothing else is checked. */
export function decode(raw: string): { t: string } | null {
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  return isTagged(o) ? o : null;
}

/** Guards a `hello` from the wire. The Court still validates the name and checks the versions. */
export function isHello(v: unknown): v is HelloMsg {
  if (!isTagged(v) || v.t !== 'hello') return false;
  const m = v as Record<string, unknown>;
  return (
    typeof m.name === 'string' &&
    (m.token === undefined || typeof m.token === 'string') &&
    typeof m.protocolVersion === 'number' &&
    typeof m.simHash === 'string'
  );
}

function isTagged(v: unknown): v is { t: string } {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && typeof (v as { t?: unknown }).t === 'string';
}
