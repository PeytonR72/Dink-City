import { Server, type Connection } from 'partyserver';
import { encode, type LobbyMsg } from '../../src/net';
import { createCourtDirectory, type CourtReport } from './courtDirectory';
import type { Env } from './env';

/** The one Lobby's name. */
export const LOBBY_NAME = 'global';
/** How often expired entries are swept while a menu client is subscribed. */
const SWEEP_MS = 15_000;
/** At most 4 list broadcasts a second. */
const BROADCAST_GAP_MS = 250;

/**
 * The directory of open Courts, one for the whole game. A thin shell over `courtDirectory`: Courts report to it over
 * RPC, and it pushes the list to every subscribed menu client, which only listens.
 */
export class Lobby extends Server<Env> {
  static override options = { hibernate: false };

  private directory = createCourtDirectory({ ttlMs: ttlFrom(this.env) });
  private sweeper: ReturnType<typeof setInterval> | null = null;
  private lastBroadcast = 0;
  private pending: ReturnType<typeof setTimeout> | null = null;

  /** Called by a Court over RPC. Reports arrive best-effort, so the directory takes them in any order. */
  report(r: CourtReport): void {
    const now = Date.now();
    // Sweeping here too keeps the directory small while no one is subscribed.
    const swept = this.directory.sweep(now);
    if (this.directory.report(r, now) || swept) this.changed();
  }

  override onConnect(conn: Connection): void {
    this.send(conn);
    this.sweeper ??= setInterval(() => {
      if (this.directory.sweep(Date.now())) this.changed();
    }, SWEEP_MS);
  }

  override onMessage(): void {
    // Menu clients only listen.
  }

  override onClose(conn: Connection): void {
    // partyserver doesn't answer a close that carries no code, which would leave the client waiting.
    try {
      conn.close(1000);
    } catch {}
    this.unsubscribed();
  }

  override onError(conn: Connection): void {
    try {
      conn.close();
    } catch {}
    this.unsubscribed();
  }

  /** Stops the sweep and any pending broadcast once no menu client is left. Only open sockets are counted. */
  private unsubscribed(): void {
    if (this.hasSubscribers()) return;
    if (this.sweeper !== null) clearInterval(this.sweeper);
    if (this.pending !== null) clearTimeout(this.pending);
    this.sweeper = null;
    this.pending = null;
  }

  private hasSubscribers(): boolean {
    return !this.getConnections()[Symbol.iterator]().next().done;
  }

  /** Broadcasts the list now, or at the end of the current throttle gap. */
  private changed(): void {
    if (this.pending !== null) return;
    const wait = this.lastBroadcast + BROADCAST_GAP_MS - Date.now();
    if (wait <= 0) return this.broadcastList();
    this.pending = setTimeout(() => {
      this.pending = null;
      this.broadcastList();
    }, wait);
  }

  private broadcastList(): void {
    this.lastBroadcast = Date.now();
    const raw = encode(this.listMsg());
    for (const conn of this.getConnections()) this.send(conn, raw);
  }

  /**
   * Sends to one menu client. A socket whose peer just vanished can still read as open, and sending to it throws;
   * it's dropped quietly here, because partyserver's `broadcast` would throw into the Court's `report` call.
   */
  private send(conn: Connection, raw = encode(this.listMsg())): void {
    try {
      conn.send(raw);
    } catch {}
  }

  private listMsg(): LobbyMsg {
    return { t: 'courts', courts: this.directory.list(Date.now()) };
  }
}

/** `LOBBY_TTL_MS` shortens the entries' life, to test expiry under `wrangler dev`. */
function ttlFrom(env: Env): number | undefined {
  const ms = Number(env.LOBBY_TTL_MS);
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}
