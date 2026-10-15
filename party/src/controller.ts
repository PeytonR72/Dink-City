import { Server, type Connection, type ConnectionContext } from 'partyserver';
import type { Env } from './env';
import { createControllerRelay, type RelayAction } from './controllerRelay';
export class Controller extends Server<Env> {
  static override options = { hibernate: false };
  private relay = createControllerRelay();
  override async onStart() { this.relay = createControllerRelay((await this.ctx.storage.get<boolean>('used')) ?? false); }
  override async onConnect(conn: Connection, ctx: ConnectionContext) {
    const role = new URL(ctx.request.url).searchParams.get('role');
    if (role !== 'screen' && role !== 'phone') { conn.close(4000, 'bad_role'); return; }
    const actions = this.relay.connect(conn.id, role);
    // After process eviction a used code is expired; never resurrect a pair with stale sockets.
    if (role === 'screen' && !actions.some(a => a.kind === 'close')) await this.ctx.storage.put('used', true);
    this.apply(actions);
  }
  override onMessage(conn: Connection, raw: string | ArrayBuffer) { this.apply(this.relay.message(conn.id, raw, Date.now())); }
  override onClose(conn: Connection) { this.apply(this.relay.disconnect(conn.id)); }
  override onError(conn: Connection) { this.onClose(conn); }
  private apply(actions: RelayAction[]) {
    for (const action of actions) {
      const conn = this.getConnection(action.id);
      if (!conn) continue;
      try { if (action.kind === 'send') conn.send(JSON.stringify(action.msg)); else conn.close(4000, action.reason); } catch {}
    }
  }
}
