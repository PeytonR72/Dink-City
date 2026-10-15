import { createControllerClock, makePairCode, readControllerMsg, type Swing } from '../net/controller';
import type { Vec2 } from '../sim';
import { controllerUrl } from './url';
export type ControllerStatus = 'idle' | 'pairing' | 'connected' | 'disconnected' | 'error';
export class ScreenController {
  code = '';
  status: ControllerStatus = 'idle';
  private ws: WebSocket | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private clock = createControllerClock();
  private pending = new Set<number>();
  private lastPong = 0;
  private synced = false;
  constructor(private handlers: { onSwing(s: Swing): void; onTilt(aim: Vec2): void; onStatus(): void }) {}
  get rtt() { return this.clock.rtt; }
  open() {
    if (this.ws) return;
    this.clock = createControllerClock(); this.synced = false; this.pending.clear();
    this.code = makePairCode(n => crypto.getRandomValues(new Uint8Array(n)));
    this.setStatus('pairing');
    const ws = this.ws = new WebSocket(controllerUrl(this.code, 'screen'));
    ws.onmessage = e => {
      if (this.ws !== ws) return;
      const m = readControllerMsg(e.data);
      if (!m) return;
      if (m.t === 'status') {
        if (m.connected) { this.clock = createControllerClock(); this.synced = false; this.pending.clear(); this.lastPong = Date.now(); this.setStatus('connected'); this.ping(); }
        else { this.synced = false; this.setStatus(this.status === 'pairing' ? 'pairing' : 'disconnected'); }
      } else if (m.t === 'pong' && this.pending.delete(m.at)) {
        if (this.clock.pong(m.at, m.phoneAt, Date.now())) { this.lastPong = Date.now(); this.synced = true; this.handlers.onStatus(); }
      } else if (m.t === 'swing' && this.status === 'connected' && this.synced) this.handlers.onSwing({ ...m, at: this.clock.screenTime(m.at) });
      else if (m.t === 'tilt' && this.status === 'connected') this.handlers.onTilt(m.aim);
    };
    ws.onclose = () => { if (this.ws !== ws) return; this.disposeSocket(); this.setStatus('error'); };
    ws.onerror = () => { if (this.ws === ws) this.setStatus('error'); };
    this.timer = setInterval(() => {
      if (this.status !== 'connected') return;
      if (Date.now() - this.lastPong > 6000) { this.disposeSocket(); this.setStatus('disconnected'); return; }
      this.ping();
    }, 1000);
  }
  hit() { if (this.status === 'connected') this.send({ t: 'hit' }); }
  close() { this.disposeSocket(); this.setStatus('idle'); }
  restart() { this.close(); this.open(); }
  private setStatus(status: ControllerStatus) { this.status = status; this.handlers.onStatus(); }
  private ping() { const at = Date.now(); this.pending.add(at); for (const p of this.pending) if (at - p > 6000) this.pending.delete(p); this.send({ t: 'ping', at }); }
  private send(msg: unknown) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg)); }
  private disposeSocket() { const ws = this.ws; this.ws = null; ws?.close(1000); if (this.timer) clearInterval(this.timer); this.timer = null; this.pending.clear(); }
}
