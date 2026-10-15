import assert from 'node:assert/strict';
import { makePairCode } from '../../src/net/controller';
const base = process.argv[2] ?? 'http://localhost:8787';
const code = makePairCode(n => crypto.getRandomValues(new Uint8Array(n)));
const sockets: WebSocket[] = [];
function open(role: string) { const ws = new WebSocket(base.replace(/^http/, 'ws') + '/parties/controller/' + code + '?role=' + role, { headers: { Origin: 'http://localhost:5173' } } as unknown as string[]); sockets.push(ws); return ws; }
function event(ws: WebSocket, name: 'open' | 'close' | 'message'): Promise<Event | MessageEvent> { return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('Timed out: ' + name)), 5000); ws.addEventListener(name, e => { clearTimeout(timer); resolve(e); }, { once: true }); ws.addEventListener('error', () => { clearTimeout(timer); reject(Error('Socket error')); }, { once: true }); }); }
try {
  const screen = open('screen'); await event(screen, 'open');
  const phone = open('phone'); await event(phone, 'open');
  const ready = event(screen, 'message'); phone.send(JSON.stringify({ t: 'hello', version: 1 })); await ready;
  // Consume only the relayed Swing, ignoring pairing status notifications.
  const received = new Promise<Record<string, unknown>>((resolve, reject) => { const timeout = setTimeout(() => reject(Error('No swing')), 5000); screen.addEventListener('message', e => { const m = JSON.parse(String(e.data)); if (m.t === 'swing') { clearTimeout(timeout); resolve(m); } }); });
  phone.send(JSON.stringify({ t: 'swing', type: 'drive', aim: { x: .5, y: 0 }, strength: .8, at: Date.now() }));
  assert.equal((await received).type, 'drive');
  const replaced = event(phone, 'close'); const next = open('phone'); await event(next, 'open'); await replaced;
  const expired = event(next, 'close'); screen.close(); await expired;
  console.log('Controller smoke passed: handshake, Swing relay, phone replacement, screen expiry.');
} finally { sockets.forEach(ws => ws.close()); }
