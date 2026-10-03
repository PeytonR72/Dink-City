// The Court's and the Lobby's wire messages. `decode` checks only the tag; the Court re-guards every payload.
import type { SideIndex, SimEvent, SimState } from '../sim';
import { isQIntent, type QIntent } from './intentCodec';
import { isPresetId, type PresetId } from './presets';

/** Bump when a message changes shape. The handshake refuses a mismatch with `version`. */
export const PROTOCOL_VERSION = 7;

/**
 * Why the Court refused or dropped a client. Every code but `bad_message` closes the socket. `host_left`: the Host
 * left before the Match started, and the Court closed.
 */
export type CourtErrorCode = (typeof COURT_ERROR_CODES)[number];
const COURT_ERROR_CODES = ['full', 'not_found', 'bad_name', 'version', 'bad_message', 'host_left'] as const;

/**
 * The close code of a socket the Court ends: a refusal (the reason is its `CourtErrorCode`), a seat taken by another
 * tab (`replaced`), or a Court that has closed (`closed`).
 */
export const COURT_CLOSE = 4000;

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

/** An `in` carries at most this many Ticks of Intents: usually about 15, more to hold on to a shot press. */
export const MAX_IN_INTENTS = 30;

/**
 * The client's Intents for the Ticks `from`, `from + 1`, …: every one the Court hasn't acknowledged yet, so a lost
 * packet costs nothing. The Court steps Tick T with the Intent labeled T, and acknowledges the last Tick up to which
 * it has them all in each Snapshot's `ack`.
 */
export interface InMsg {
  t: 'in';
  from: number;
  intents: QIntent[];
}

/** A clock sample: the Court answers at once with `pong`, echoing `id` and `clientTime` (the client's clock, ms). */
export interface PingMsg {
  t: 'ping';
  id: number;
  clientTime: number;
}

/** The Court's answer to a `ping`. */
export interface PongMsg {
  t: 'pong';
  id: number;
  clientTime: number;
  courtTick: number;
}

/**
 * The Player leaves the Match for good, just before closing the socket: their grace starts at once rather than when the
 * socket times out, and the client forgets its seat token. Closing a tab or reloading sends none, so it rejoins.
 */
export interface LeaveMsg {
  t: 'leave';
}

/** Once the Match is over, the Player asks to play again in the same Court. The next Match starts once both have. */
export interface RematchMsg {
  t: 'rematch';
}

/** Client → Court. */
export type ClientMsg = HelloMsg | ReadyMsg | InMsg | PingMsg | LeaveMsg | RematchMsg;

/** A Sim event in a Snapshot, labeled with the Tick whose step emitted it. */
export type SnapEvent = SimEvent & { tick: number };

/**
 * Court → client. `welcome` seats the client on `side`; keep `token` to reclaim the seat after a reload. `start`
 * is sent to both when the Match begins, and again after the `welcome` of a Player who reloads mid-Match; its
 * `players` names both, since the Host's `welcome` came before the Guest was seated. A `snap`
 * carries the full state, the last Tick up to which the Court has every Intent from this client (`ack`, -1 before
 * any), the Intents the Court stepped the Tick before `state` with (`last`: a client's guess at its opponent's next ones),
 * and every event since the previous `snap`. `pong` answers a `ping` with the Court's Tick when it was sent,
 * fractional: the Ticks stepped plus how far the Court's clock is into the next. `peer` tells a Player, once the
 * Match has started, that the Player on `side` disconnected (`grace`), came back (`connected`), or is `gone` for good.
 * `rematch` tells both Players that the Player on `side` asked for a rematch; once both have, a new `start` follows.
 */
export type CourtMsg =
  | { t: 'welcome'; side: SideIndex; token: string; preset: PresetId; players: [CourtPlayer | null, CourtPlayer | null] }
  | { t: 'error'; code: CourtErrorCode }
  | { t: 'start'; seed: number; preset: PresetId; players: [CourtPlayer | null, CourtPlayer | null] }
  | SnapMsg
  | { t: 'over'; winner: SideIndex }
  | PongMsg
  | { t: 'peer'; side: SideIndex; status: PeerStatus }
  | { t: 'rematch'; side: SideIndex };

/** A seated Player's link to the Court: `grace` while their seat waits for them to come back. */
export type PeerStatus = (typeof PEER_STATUSES)[number];
const PEER_STATUSES = ['connected', 'grace', 'gone'] as const;

/** A Snapshot: see `CourtMsg`. */
export interface SnapMsg {
  t: 'snap';
  tick: number;
  ack: number;
  state: SimState;
  last: [QIntent, QIntent];
  events: SnapEvent[];
}

/** An open Court as the Lobby lists it. Full Courts aren't listed, so `players` is always 1. */
export interface LobbyCourt {
  code: string;
  hostName: string;
  preset: PresetId;
  players: 1;
  createdAt: number;
}

/** Lobby → menu client: every open Court, newest first, on connect and after every change. */
export type LobbyMsg = { t: 'courts'; courts: LobbyCourt[] };

/** A message as it goes on the wire. */
export function encode(msg: ClientMsg | CourtMsg | LobbyMsg): string {
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

/** Guards a `leave` from the wire. */
export function isLeave(v: unknown): v is LeaveMsg {
  return isTagged(v) && v.t === 'leave';
}

/** Guards a `rematch` from the wire. */
export function isRematch(v: unknown): v is RematchMsg {
  return isTagged(v) && v.t === 'rematch';
}

/** Guards an `in` from the wire: a whole first Tick and 1 to `MAX_IN_INTENTS` well-formed quantized Intents. */
export function isIn(v: unknown): v is InMsg {
  if (!isTagged(v) || v.t !== 'in') return false;
  const m = v as Record<string, unknown>;
  return (
    Number.isSafeInteger(m.from) &&
    (m.from as number) >= 0 &&
    Array.isArray(m.intents) &&
    m.intents.length >= 1 &&
    m.intents.length <= MAX_IN_INTENTS &&
    m.intents.every(isQIntent)
  );
}

/** Guards a `ping` from the wire. */
export function isPing(v: unknown): v is PingMsg {
  if (!isTagged(v) || v.t !== 'ping') return false;
  const m = v as Record<string, unknown>;
  return Number.isSafeInteger(m.id) && Number.isFinite(m.clientTime);
}

/**
 * Guards a message from the Court: the tag and the fields a client reads. A Snapshot's state is trusted to be a
 * `SimState`, since only the Court sends one.
 */
export function isCourtMsg(v: unknown): v is CourtMsg {
  if (!isTagged(v)) return false;
  const m = v as Record<string, unknown>;
  switch (v.t) {
    case 'welcome':
      return isSide(m.side) && typeof m.token === 'string' && isPresetId(m.preset) && isPlayers(m.players);
    case 'error':
      return (COURT_ERROR_CODES as readonly unknown[]).includes(m.code);
    case 'start':
      return Number.isSafeInteger(m.seed) && isPresetId(m.preset) && isPlayers(m.players);
    case 'snap':
      return (
        Number.isSafeInteger(m.tick) &&
        Number.isSafeInteger(m.ack) &&
        typeof m.state === 'object' &&
        m.state !== null &&
        Array.isArray(m.last) &&
        m.last.length === 2 &&
        m.last.every(isQIntent) &&
        Array.isArray(m.events)
      );
    case 'over':
      return isSide(m.winner);
    case 'pong':
      return Number.isSafeInteger(m.id) && Number.isFinite(m.clientTime) && Number.isFinite(m.courtTick);
    case 'peer':
      return isSide(m.side) && (PEER_STATUSES as readonly unknown[]).includes(m.status);
    case 'rematch':
      return isSide(m.side);
  }
  return false;
}

/** Guards a message from the Lobby. */
export function isLobbyMsg(v: unknown): v is LobbyMsg {
  if (!isTagged(v) || v.t !== 'courts') return false;
  const courts = (v as { courts?: unknown }).courts;
  return Array.isArray(courts) && courts.every(isLobbyCourt);
}

function isLobbyCourt(v: unknown): v is LobbyCourt {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  return typeof c.code === 'string' && typeof c.hostName === 'string' && isPresetId(c.preset) && c.players === 1 && Number.isFinite(c.createdAt);
}

function isSide(v: unknown): v is SideIndex {
  return v === 0 || v === 1;
}

function isPlayers(v: unknown): v is [CourtPlayer | null, CourtPlayer | null] {
  return Array.isArray(v) && v.length === 2 && v.every((p) => p === null || (typeof p === 'object' && typeof p.name === 'string'));
}

function isTagged(v: unknown): v is { t: string } {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && typeof (v as { t?: unknown }).t === 'string';
}
