import { Server, getServerByName, type Connection, type WSMessage } from 'partyserver';
import {
  COURT_CLOSE,
  PROTOCOL_VERSION,
  decode,
  encode,
  isHello,
  isIn,
  isPresetId,
  isReady,
  simHash,
  validateDisplayName,
  type CourtErrorCode,
  type CourtMsg,
  type HelloMsg,
  type InMsg,
  type PresetId,
} from '../../src/net';
import { TICK, type SideIndex } from '../../src/sim';
import { simTuning } from '../../src/tuning';
import type { CourtInfo, CourtReport, ReportOp } from './courtDirectory';
import { createCourtMatch, type CourtMatch } from './courtMatch';
import * as seats from './courtSeats';
import * as starting from './courtStart';
import type { Env } from './env';
import { LOBBY_NAME } from './lobby';
import { createTickLoop, type TickLoop } from './tickLoop';

/** Longer messages are dropped unread. A hello is about 150 bytes. */
const MAX_MESSAGE = 2048;

const SIM_HASH = simHash(simTuning);

const HZ = Math.round(1 / TICK);
/** A late interval callback runs at most this many Ticks; the rest of a longer stall is dropped. */
const MAX_CATCH_UP = 8;
/** How often a Court that hasn't started tells the Lobby it's still there. */
const HEARTBEAT_MS = 30_000;

/** What the Worker sends when it creates the Court. */
export interface ProvisionRequest {
  hostName: string;
  preset: PresetId;
  seed: number;
}

/** The Host token on success. A Court that's already provisioned refuses. */
export type ProvisionResult = { ok: true; hostToken: string } | { ok: false };

/**
 * One Match, named by its Court code. A thin shell: the seat rules live in `courtSeats`, the start rules in
 * `courtStart`, and the Match itself in `courtMatch`, stepped by `tickLoop`. It reports its lifecycle to the Lobby.
 */
export class Court extends Server<Env> {
  static override options = { hibernate: false };

  private setup: { preset: PresetId; seed: number } | null = null;
  private seats: seats.Seats | null = null;
  /** The id of the connection holding each seat. */
  private holders: [string | null, string | null] = [null, null];
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private gate = starting.NO_ONE_READY;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private match: CourtMatch | null = null;
  private loop: TickLoop | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  /** What the Lobby lists, and the number of the last report sent to it. */
  private info: CourtInfo | null = null;
  private reports = 0;
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  /** Called by the Worker over RPC. Only the first call provisions; any later one is refused and changes nothing. */
  provision(req: ProvisionRequest): ProvisionResult {
    if (this.seats !== null) return { ok: false };
    const name = validateDisplayName(req.hostName);
    if (!name.ok || !isPresetId(req.preset) || !Number.isInteger(req.seed)) return { ok: false };
    const hostToken = crypto.randomUUID();
    const now = Date.now();
    this.setup = { preset: req.preset, seed: req.seed };
    this.seats = seats.provision(name.name, hostToken, now);
    this.info = { code: this.name, hostName: name.name, preset: req.preset, createdAt: now };
    this.schedule();
    this.report('open');
    this.heartbeat = setInterval(() => this.report('heartbeat'), HEARTBEAT_MS);
    return { ok: true, hostToken };
  }

  override onConnect(conn: Connection): void {
    if (this.seats === null || this.seats.closed) this.refuse(conn, 'not_found');
  }

  override onMessage(conn: Connection, message: WSMessage): void {
    if (typeof message !== 'string' || message.length > MAX_MESSAGE) return this.send(conn, { t: 'error', code: 'bad_message' });
    const msg = decode(message);
    if (msg !== null && isHello(msg)) return this.hello(conn, msg);
    if (msg !== null && isReady(msg)) return this.ready(conn);
    if (msg !== null && isIn(msg)) return this.input(conn, msg);
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
    if (this.seats === null || this.setup === null || this.seats.closed) return this.refuse(conn, 'not_found');
    const name = validateDisplayName(msg.name);
    if (!name.ok) return this.refuse(conn, 'bad_name');
    if (msg.protocolVersion !== PROTOCOL_VERSION || msg.simHash !== SIM_HASH) return this.refuse(conn, 'version');
    const guestSeatFree = this.seats.seats[1] === null;
    const { seats: next, result } = seats.join(this.seats, { name: name.name, token: msg.token }, crypto.randomUUID());
    if (!result.ok) return this.refuse(conn, result.code);
    this.seats = next;
    if (result.side === 1 && guestSeatFree) this.report('join');
    const replaced = this.holders[result.side];
    this.holders[result.side] = conn.id;
    // A token reclaimed a seat whose old connection is still open, such as a second tab.
    if (replaced !== null) this.getConnection(replaced)?.close(COURT_CLOSE, 'replaced');
    this.gate = starting.seated(this.gate, result.side, result.token, Date.now());
    this.schedule();
    this.send(conn, { t: 'welcome', side: result.side, token: result.token, preset: this.setup.preset, players: seats.players(next) });
    // A Player reloading mid-Match rebuilds from `start` and the current Snapshot, and learns if it's already over.
    if (this.match === null) return this.maybeStart();
    this.send(conn, this.startMsg());
    for (const msg of this.match.current(result.side)) this.send(conn, msg);
  }

  private ready(conn: Connection): void {
    const side = this.sideOf(conn);
    if (side === null || this.match !== null) return;
    this.gate = starting.ready(this.gate, side);
    this.maybeStart();
  }

  private input(conn: Connection, msg: InMsg): void {
    const side = this.sideOf(conn);
    if (side !== null) this.match?.receive(side, msg);
  }

  /** The Side of an open, seated connection. Messages from anything else, such as a socket that's closing, are ignored. */
  private sideOf(conn: Connection): SideIndex | null {
    const side = this.holders.indexOf(conn.id);
    return side === -1 || conn.readyState !== WebSocket.READY_STATE_OPEN ? null : (side as SideIndex);
  }

  /** Starts the Match if it's due, or sets the timer for the 10 s cap. */
  private maybeStart(): void {
    this.clearStartTimer();
    if (this.seats === null || this.setup === null) return;
    const now = Date.now();
    if (starting.due(this.seats, this.gate, now)) return this.start();
    const at = starting.nextDue(this.seats, this.gate, now);
    if (at !== null) this.startTimer = setTimeout(() => this.maybeStart(), at - now);
  }

  private start(): void {
    if (this.seats === null || this.setup === null) return;
    this.seats = seats.start(this.seats);
    this.stopHeartbeat();
    this.report('start');
    this.match = createCourtMatch({ ...this.setup, tuning: simTuning });
    this.loop = createTickLoop({ hz: HZ, maxCatchUp: MAX_CATCH_UP });
    this.loop.advance(Date.now());
    for (const conn of this.getConnections()) if (this.holders.includes(conn.id)) this.send(conn, this.startMsg());
    this.interval = setInterval(() => this.tick(), 1000 / HZ);
    console.log(`[court ${this.name}] Match started (${this.setup.preset}, seed ${this.setup.seed})`);
  }

  /** One interval callback: the timestamp is taken first, because the clock doesn't move while the Sim runs. */
  private tick(): void {
    const now = Date.now();
    if (this.match === null || this.loop === null) return;
    const ticks = this.loop.advance(now);
    if (ticks === 0) return;
    for (const { side, msg } of this.match.advance(ticks)) {
      const holder = this.holders[side];
      const conn = holder === null ? undefined : this.getConnection(holder);
      if (conn !== undefined) this.send(conn, msg);
    }
    if (this.match.over && this.interval !== null) {
      this.stopTicking(`the Match is over, ${this.match.state.match.points.join('-')}`);
      this.report('end');
    }
  }

  /** `start`, naming both Players. Only called once the Court is provisioned. */
  private startMsg(): CourtMsg {
    return { t: 'start', ...this.setup!, players: seats.players(this.seats!) };
  }

  private clearStartTimer(): void {
    if (this.startTimer !== null) clearTimeout(this.startTimer);
    this.startTimer = null;
  }

  private stopTicking(why: string): void {
    if (this.interval === null) return;
    clearInterval(this.interval);
    this.interval = null;
    console.log(`[court ${this.name}] tick interval stopped at Tick ${this.match?.state.tick}: ${why}`);
  }

  /** Runs once per connection: onClose and onError can both fire, and the second finds no seat. */
  private left(conn: Connection): void {
    const side = this.holders.indexOf(conn.id);
    if (side === -1 || this.seats === null) return;
    this.holders[side] = null;
    this.seats = seats.disconnect(this.seats, side as SideIndex, Date.now());
    this.gate = starting.unready(this.gate, side as SideIndex);
    this.match?.disconnect(side as SideIndex);
    this.schedule();
    // Before the start this drops the cap timer: the Match only starts while both Players are connected.
    if (this.match === null) this.maybeStart();
  }

  private schedule(): void {
    if (this.graceTimer !== null) clearTimeout(this.graceTimer);
    this.graceTimer = null;
    const at = this.seats === null ? null : seats.nextExpiry(this.seats);
    if (at !== null) this.graceTimer = setTimeout(() => this.expire(), Math.max(0, at - Date.now()));
  }

  private expire(): void {
    if (this.seats === null || this.seats.closed) return;
    const before = this.seats;
    this.seats = seats.expire(before, Date.now());
    for (const side of [0, 1] as const) if (this.seats.seats[side]?.status === 'gone') this.match?.gone(side);
    if (this.seats.closed) this.close(before);
    else if (!before.started && before.seats[1] !== null && this.seats.seats[1] === null) this.report('leave');
    this.schedule();
  }

  /**
   * Ends the Court. Before the start that's the Host leaving (or never connecting), which a seated Guest is told, or
   * 30 minutes with no Guest; after it, both Players being gone.
   */
  private close(before: seats.Seats): void {
    const guest = this.holders[1] === null ? undefined : this.getConnection(this.holders[1]);
    this.stopTicking('both Players are gone');
    this.stopHeartbeat();
    this.clearStartTimer();
    this.holders = [null, null];
    if (before.started) {
      // A Match that ended has already reported `end`.
      if (this.match?.over !== true) this.report('end');
    } else {
      const hostLeft = before.seats[0]?.status !== 'connected';
      console.log(`[court ${this.name}] closed before the start: ${hostLeft ? 'the Host left' : 'no Guest came'}`);
      this.report('close');
      if (hostLeft && guest !== undefined) this.refuse(guest, 'host_left');
    }
    for (const conn of this.getConnections()) conn.close(COURT_CLOSE, 'closed');
  }

  private stopHeartbeat(): void {
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  /** Tells the Lobby, best-effort: a failed report is logged, and the entry heals by expiring. */
  private report(op: ReportOp): void {
    if (this.info === null || this.seats === null) return;
    const seq = ++this.reports;
    const r: CourtReport =
      op === 'start' || op === 'end' || op === 'close'
        ? { op, seq, code: this.info.code }
        : op === 'heartbeat'
          ? { op, seq, ...this.info, players: this.seats.seats[1] === null ? 1 : 2 }
          : { op, seq, ...this.info };
    getServerByName(this.env.LOBBY, LOBBY_NAME)
      .then((lobby) => lobby.report(r))
      .catch((e) => console.warn(`[court ${this.name}] Lobby report ${op} failed:`, e));
  }

  private send(conn: Connection, msg: CourtMsg): void {
    // A refused client may still have a message in flight.
    if (conn.readyState === WebSocket.READY_STATE_OPEN) conn.send(encode(msg));
  }

  private refuse(conn: Connection, code: CourtErrorCode): void {
    this.send(conn, { t: 'error', code });
    conn.close(COURT_CLOSE, code);
  }
}
