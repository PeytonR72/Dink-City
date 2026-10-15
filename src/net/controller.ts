// Pure shared Controller protocol. No browser or runtime dependencies.
import type { ShotType, Vec2 } from '../sim';
export const CONTROLLER_VERSION = 1;
export const MAX_CONTROLLER_BYTES = 1024;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const isPairCode = (v: unknown): v is string => typeof v === 'string' && /^P-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/.test(v);
export function makePairCode(randomBytes: (n: number) => Uint8Array): string {
  let code = 'P-';
  const limit = 256 - 256 % ALPHABET.length;
  while (code.length < 12) for (const b of randomBytes(12 - code.length)) if (b < limit) code += ALPHABET[b % ALPHABET.length];
  return code;
}
export interface Swing { type: ShotType; aim: Vec2; strength: number; at: number }
export type ControllerRole = 'screen' | 'phone';
export type ControllerMsg =
  | ({ t: 'swing' } & Swing)
  | { t: 'tilt'; aim: Vec2 }
  | { t: 'hello'; version: number }
  | { t: 'hit' }
  | { t: 'ping'; at: number }
  | { t: 'pong'; at: number; phoneAt: number }
  | { t: 'status'; connected: boolean };
const obj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const time = (v: unknown): v is number => num(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER;
const aim = (v: unknown): v is Vec2 => obj(v) && num(v.x) && num(v.y) && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
export function isControllerMsg(v: unknown): v is ControllerMsg {
  if (!obj(v)) return false;
  switch (v.t) {
    case 'hello': return v.version === CONTROLLER_VERSION;
    case 'swing': return typeof v.type === 'string' && ['soft', 'drive', 'lob'].includes(v.type) && aim(v.aim) && num(v.strength) && v.strength >= 0 && v.strength <= 1 && time(v.at);
    case 'tilt': return aim(v.aim);
    case 'hit': return true;
    case 'ping': return time(v.at);
    case 'pong': return time(v.at) && time(v.phoneAt);
    case 'status': return typeof v.connected === 'boolean';
    default: return false;
  }
}
export function readControllerMsg(raw: unknown): ControllerMsg | null {
  if (typeof raw !== 'string' || raw.length > MAX_CONTROLLER_BYTES || new TextEncoder().encode(raw).length > MAX_CONTROLLER_BYTES) return null;
  try { const value: unknown = JSON.parse(raw); return isControllerMsg(value) ? value : null; } catch { return null; }
}
export function allowedControllerMessage(role: ControllerRole, m: ControllerMsg): boolean {
  return role === 'phone' ? ['hello', 'swing', 'tilt', 'pong'].includes(m.t) : ['hit', 'ping'].includes(m.t);
}
/** Minimum-delay clock sample avoids treating temporary queueing as phone clock skew. */
export function createControllerClock() {
  let best = Infinity;
  let offset = 0;
  let rtt: number | null = null;
  return {
    get rtt() { return rtt; },
    pong(sent: number, phoneAt: number, now: number) {
      const elapsed = now - sent;
      if (elapsed < 0 || elapsed > 10_000) return false;
      rtt = elapsed;
      if (elapsed <= best) { best = elapsed; offset = phoneAt - (sent + now) / 2; }
      return true;
    },
    screenTime(phoneAt: number) { return phoneAt - offset; },
  };
}
