import { Server, type Connection, type WSMessage } from 'partyserver';
import {
  PROTOCOL_VERSION,
  decode,
  encode,
  isHello,
  isPresetId,
  simHash,
  validateDisplayName,
  type CourtErrorCode,
  type CourtMsg,
  type HelloMsg,
  type PresetId,
} from '../../src/net';
import type { SideIndex } from '../../src/sim';
import { simTuning } from '../../src/tuning';
import * as seats from './courtSeats';
import type { Env } from './env';

/** Longer messages are dropped unread. A hello is about 150 bytes. */
const MAX_MESSAGE = 2048;

const SIM_HASH = simHash(simTuning);

/** What the Worker sends when it creates the Court. */
export interface ProvisionRequest {
  hostName: string;
  preset: PresetId;
  seed: number;
}

/** The Host token on success. A Court that's already provisioned refuses. */
export type ProvisionResult = { ok: true; hostToken: string } | { ok: false };

/** One Match, named by its Court code. A thin shell: the seat rules live in `courtSeats`. */
export class Court extends Server<Env> {
  static override options = { hibernate: false };

  private match: { preset: PresetId; seed: number } | null = null;
  private seats: seats.Seats | null = null;
  /** The id of the connection holding each seat. */
  private holders: [string | null, string | null] = [null, null];
  private graceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Called by the Worker over RPC. Only the first call provisions; any later one is refused and changes nothing. */
  provision(req: ProvisionRequest): ProvisionResult {
    if (this.seats !== null) return { ok: false };
    const name = validateDisplayName(req.hostName);
    if (!name.ok || !isPresetId(req.preset) || !Number.isInteger(req.seed)) return { ok: false };
    const hostToken = crypto.randomUUID();
    this.match = { preset: req.preset, seed: req.seed };
    this.seats = seats.provision(name.name, hostToken, Date.now());
    this.schedule();
    return { ok: true, hostToken };
  }

  override onConnect(conn: Connection): void {
    if (this.seats === null || this.seats.closed) this.refuse(conn, 'not_found');
  }

  override onMessage(conn: Connection, message: WSMessage): void {
    if (typeof message !== 'string' || message.length > MAX_MESSAGE) return this.send(conn, { t: 'error', code: 'bad_message' });
    const msg = decode(message);
    if (msg !== null && isHello(msg)) return this.hello(conn, msg);
    this.send(conn, { t: 'error', code: 'bad_message' });
  }

  override onClose(conn: Connection): void {
    // partyserver doesn't answer a close that carries no code, which would leave the client waiting.
    try {
      conn.close(1000);
    } catch {}
    this.left(conn);
  }

  override onError(conn: Connection): void {
    // Free the seat first: closing a failed socket can throw.
    this.left(conn);
    try {
      conn.close();
    } catch {}
  }

  private hello(conn: Connection, msg: HelloMsg): void {
    // A hello from a socket that's already closing would seat a Player no one can reach.
    if (this.holders.includes(conn.id) || conn.readyState !== WebSocket.READY_STATE_OPEN) return;
    if (this.seats === null || this.match === null || this.seats.closed) return this.refuse(conn, 'not_found');
    const name = validateDisplayName(msg.name);
    if (!name.ok) return this.refuse(conn, 'bad_name');
    if (msg.protocolVersion !== PROTOCOL_VERSION || msg.simHash !== SIM_HASH) return this.refuse(conn, 'version');
    const { seats: next, result } = seats.join(this.seats, { name: name.name, token: msg.token }, crypto.randomUUID());
    if (!result.ok) return this.refuse(conn, result.code);
    this.seats = next;
    const replaced = this.holders[result.side];
    this.holders[result.side] = conn.id;
    // A token reclaimed a seat whose old connection is still open, such as a second tab.
    if (replaced !== null) this.getConnection(replaced)?.close(4000, 'replaced');
    this.schedule();
    this.send(conn, { t: 'welcome', side: result.side, token: result.token, preset: this.match.preset, players: seats.players(next) });
  }

  /** Runs once per connection: onClose and onError can both fire, and the second finds no seat. */
  private left(conn: Connection): void {
    const side = this.holders.indexOf(conn.id);
    if (side === -1 || this.seats === null) return;
    this.holders[side] = null;
    this.seats = seats.disconnect(this.seats, side as SideIndex, Date.now());
    this.schedule();
  }

  private schedule(): void {
    if (this.graceTimer !== null) clearTimeout(this.graceTimer);
    this.graceTimer = null;
    const at = this.seats === null ? null : seats.nextExpiry(this.seats);
    if (at !== null) this.graceTimer = setTimeout(() => this.expire(), Math.max(0, at - Date.now()));
  }

  private expire(): void {
    if (this.seats === null) return;
    this.seats = seats.expire(this.seats, Date.now());
    if (this.seats.closed) {
      this.holders = [null, null];
      for (const conn of this.getConnections()) conn.close(4000, 'closed');
    }
    this.schedule();
  }

  private send(conn: Connection, msg: CourtMsg): void {
    // A refused client may still have a message in flight.
    if (conn.readyState === WebSocket.READY_STATE_OPEN) conn.send(encode(msg));
  }

  private refuse(conn: Connection, code: CourtErrorCode): void {
    this.send(conn, { t: 'error', code });
    conn.close(4000, code);
  }
}
