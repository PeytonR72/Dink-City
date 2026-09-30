// The Court's wire messages, both directions. `decode` checks only the tag; the Court re-guards every payload.
import type { SideIndex, SimEvent, SimState } from '../sim';
import { isQIntent, type QIntent } from './intentCodec';
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

/** The client has loaded its Venue. The Match starts once both are ready, or 10 s after the Guest is seated. */
export interface ReadyMsg {
  t: 'ready';
}

/** The client's Intent, labeled with its Tick. The Court acknowledges the latest `tick` in each Snapshot. */
export interface InMsg {
  t: 'in';
  tick: number;
  intent: QIntent;
}

/** Client → Court. */
export type ClientMsg = HelloMsg | ReadyMsg | InMsg;

/** A Sim event in a Snapshot, labeled with the Tick whose step emitted it. */
export type SnapEvent = SimEvent & { tick: number };

/**
 * Court → client. `welcome` seats the client on `side`; keep `token` to reclaim the seat after a reload. `start`
 * is sent to both when the Match begins, and again after the `welcome` of a Player who reloads mid-Match. A `snap`
 * carries the full state, the latest input Tick received from this client (`ack`, -1 before any), and every event
 * since the previous `snap`.
 */
export type CourtMsg =
  | { t: 'welcome'; side: SideIndex; token: string; preset: PresetId; players: [CourtPlayer | null, CourtPlayer | null] }
  | { t: 'error'; code: CourtErrorCode }
  | { t: 'start'; seed: number; preset: PresetId }
  | { t: 'snap'; tick: number; ack: number; state: SimState; events: SnapEvent[] }
  | { t: 'over'; winner: SideIndex };

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

/** Guards a `ready` from the wire. */
export function isReady(v: unknown): v is ReadyMsg {
  return isTagged(v) && v.t === 'ready';
}

/** Guards an `in` from the wire: a whole Tick and a well-formed quantized Intent. */
export function isIn(v: unknown): v is InMsg {
  if (!isTagged(v) || v.t !== 'in') return false;
  const m = v as Record<string, unknown>;
  return Number.isSafeInteger(m.tick) && (m.tick as number) >= 0 && isQIntent(m.intent);
}

function isTagged(v: unknown): v is { t: string } {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && typeof (v as { t?: unknown }).t === 'string';
}
