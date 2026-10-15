import { allowedControllerMessage, readControllerMsg, type ControllerMsg, type ControllerRole } from '../../src/net/controller';
export type RelayAction = { kind: 'send'; id: string; msg: ControllerMsg } | { kind: 'close'; id: string; reason: string };
/** Pure pairing lifecycle. One screen owns it, latest phone wins, no implicit resurrection. */
export function createControllerRelay(expired = false) {
  let screen: string | null = null;
  let phone: string | null = null;
  let ready = false;
  const rates = new Map<string, { since: number; count: number }>();
  const status = (connected: boolean): RelayAction[] => screen ? [{ kind: 'send', id: screen, msg: { t: 'status', connected } }] : [];
  return {
    get expired() { return expired; },
    connect(id: string, role: ControllerRole): RelayAction[] {
      if (expired || (role === 'phone' && !screen)) return [{ kind: 'close', id, reason: 'expired' }];
      if (role === 'screen') {
        if (screen) return [{ kind: 'close', id, reason: 'screen_exists' }];
        screen = id; return status(false);
      }
      const old = phone;
      phone = id; ready = false;
      if (old) rates.delete(old);
      return [...(old ? [{ kind: 'close' as const, id: old, reason: 'replaced' }] : []), ...status(false)];
    },
    message(id: string, raw: unknown, now: number): RelayAction[] {
      const role = id === screen ? 'screen' : id === phone ? 'phone' : null;
      if (!role || expired) return [];
      let rate = rates.get(id);
      if (!rate || now - rate.since >= 1000) { rate = { since: now, count: 0 }; rates.set(id, rate); }
      if (++rate.count > 80) return [];
      const msg = readControllerMsg(raw);
      if (!msg || !allowedControllerMessage(role, msg)) return [];
      if (msg.t === 'hello') { ready = true; return status(true); }
      if (!ready) return [];
      const peer = role === 'screen' ? phone : screen;
      return peer ? [{ kind: 'send', id: peer, msg }] : [];
    },
    disconnect(id: string): RelayAction[] {
      rates.delete(id);
      if (id === screen) {
        expired = true; screen = null; const old = phone; phone = null; ready = false;
        return old ? [{ kind: 'close', id: old, reason: 'expired' }] : [];
      }
      if (id === phone) { phone = null; ready = false; return status(false); }
      return [];
    },
  };
}
