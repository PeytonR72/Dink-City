import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DIFFICULTY, createBot } from '../src/bot/bot';
import { observe } from '../src/bot/observe';
import {
  DEFAULT_PRESET,
  PRESETS,
  SIM_VERSION,
  decodeState,
  dequantizeIntent,
  encodeState,
  isPresetId,
  quantizeIntent,
  simHash,
  validateDisplayName,
  type QIntent,
} from '../src/net';
import { DEFAULT_MATCH, createInitialState, step, type Intent, type ShotType, type SimState } from '../src/sim';
import { simTuning as t } from '../src/tuning';

vi.setConfig({ testTimeout: 60_000 });

describe('net boundary', () => {
  it('imports only the Sim, and never three.js, the DOM, or the clock', () => {
    const dir = join(__dirname, '../src/net');
    for (const file of readdirSync(dir)) {
      const src = readFileSync(join(dir, file), 'utf8');
      for (const [, from] of src.matchAll(/from ['"]([^'"]+)['"]/g)) expect(from, file).toMatch(/^(\.\.\/sim|\.\/[\w]+)$/);
      expect(src, file).not.toMatch(/\b(document|window|navigator|localStorage)\b/);
      expect(src, file).not.toMatch(/Math\.random|Date\.now|performance\.now/);
    }
  });
});

describe('the Intent codec', () => {
  const intent = (mx: number, my: number, ax: number, ay: number, shot: ShotType | null = null): Intent => ({
    move: { x: mx, y: my },
    aim: { x: ax, y: ay },
    shot,
  });

  it('round-trips keyboard values exactly', () => {
    for (const [a, b] of [[-1, 1], [0, 0], [1, -1], [1, 0]]) {
      const i = intent(a, b, b, a);
      expect(dequantizeIntent(quantizeIntent(i))).toEqual(i);
    }
  });

  it('round-trips every shot, and the contact flag', () => {
    for (const shot of [null, 'soft', 'drive', 'lob'] as const) {
      expect(dequantizeIntent(quantizeIntent(intent(0, 1, 0, 0, shot))).shot).toBe(shot);
      const reported = dequantizeIntent(quantizeIntent({ ...intent(0, 0, 0, 0, shot), contact: true }));
      expect(reported).toMatchObject({ shot, contact: true });
    }
    expect(dequantizeIntent(quantizeIntent({ ...intent(0, 0, 0, 0), contact: false })).contact).toBeFalsy();
  });

  it('clamps and rounds analog values to int8, never to -0', () => {
    expect(quantizeIntent(intent(0.5, -2, 0.1234, -0.001))).toEqual([64, -127, 16, 0, 0]);
    expect(Object.is(quantizeIntent(intent(-0.001, 0, 0, 0))[0], 0)).toBe(true);
  });

  it('is exact once quantized: quantize ∘ dequantize is the identity on QIntent', () => {
    for (let n = 0; n < 500; n++) {
      const q: QIntent = [((n * 37) % 255) - 127, ((n * 91) % 255) - 127, ((n * 13) % 255) - 127, ((n * 53) % 255) - 127, n % 8];
      expect(quantizeIntent(dequantizeIntent(q))).toEqual(q);
    }
  });

  it('steps a quantized Intent identically on both ends', () => {
    let a = createInitialState(9);
    let b = a;
    for (let n = 0; n < 400; n++) {
      const raw = intent(Math.sin(n / 7), Math.cos(n / 11), Math.sin(n / 5), 0.3, n === 20 ? 'drive' : null);
      const q = quantizeIntent(raw);
      // Each side dequantizes the same packet.
      a = step(a, [dequantizeIntent(q), raw], t);
      b = step(b, [dequantizeIntent(JSON.parse(JSON.stringify(q))), raw], t);
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    }
  });
});

describe('Snapshots', () => {
  it('a decoded Snapshot steps the same as the state it came from, all through a Bot-vs-Bot Game', () => {
    const seed = 2026;
    const bots = [createBot(0, seed + 1, DIFFICULTY.hard, t), createBot(1, seed + 2, DIFFICULTY.hard, t)] as const;
    let direct: SimState = createInitialState(seed);
    let wired: SimState = direct;
    let mismatch: number | null = null;
    while (direct.phase !== 'over' && direct.tick < 60 * 60 * 30) {
      const intents: [Intent, Intent] = [bots[0].think(observe(direct, 0)), bots[1].think(observe(direct, 1))];
      direct = step(direct, intents, t);
      wired = step(decodeState(encodeState(wired)), intents, t);
      if (mismatch === null && JSON.stringify(wired) !== JSON.stringify(direct)) mismatch = direct.tick;
    }
    expect(mismatch).toBeNull();
    expect(direct.match.points).toEqual([11, 13]);
  });

  it('survives -0, which JSON turns into 0', () => {
    let s = createInitialState(5);
    for (let n = 0; n < 20; n++) s = step(s, [{ move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, shot: n === 19 ? 'drive' : null }, idle()], t);
    s.ball.vel.x = -0;
    s.ball.pos.x = -0;
    s.sides[0].players[0].pos.x = -0;
    s.sides[1].players[0].vel.x = -0;
    const decoded = decodeState(encodeState(s));
    expect(Object.is(decoded.ball.vel.x, 0)).toBe(true);
    let a = s;
    let b = decoded;
    for (let n = 0; n < 300; n++) {
      a = step(a, [idle(), idle()], t);
      b = step(b, [idle(), idle()], t);
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    }
  });
});

function idle(): Intent {
  return { move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, shot: null };
}

describe('simHash', () => {
  it('is an 8-digit hex string, stable across key order', () => {
    const reordered = Object.fromEntries(Object.entries(t).reverse()) as typeof t;
    reordered.shots = Object.fromEntries(Object.entries(t.shots).reverse()) as typeof t.shots;
    expect(simHash(t)).toMatch(/^[0-9a-f]{8}$/);
    expect(simHash(reordered)).toBe(simHash(t));
  });

  it('changes when any value changes, nested ones included', () => {
    const base = simHash(t);
    expect(simHash({ ...t, gravity: t.gravity + 0.01 })).not.toBe(base);
    expect(simHash({ ...t, shots: { ...t.shots, dink: { ...t.shots.dink, spin: t.shots.dink.spin + 0.01 } } })).not.toBe(base);
    expect(simHash({ ...t, serves: { ...t.serves, drive: { ...t.serves.drive, width: t.serves.drive.width + 1 } } })).not.toBe(base);
  });

  it('changes with the Sim version', () => {
    expect(simHash(t, SIM_VERSION + 1)).not.toBe(simHash(t));
  });
});

describe('Presets', () => {
  it('map to their rules', () => {
    const rules = { pointsToWin: 11, winBy: 2 };
    expect(PRESETS.quick.config).toEqual({ ...rules, rallyScoring: true, bestOf: 1 });
    expect(PRESETS.standard.config).toEqual({ ...rules, rallyScoring: false, bestOf: 1 });
    expect(PRESETS.long.config).toEqual({ ...rules, rallyScoring: false, bestOf: 3 });
    expect(PRESETS.standard.config).toEqual(DEFAULT_MATCH);
    expect(DEFAULT_PRESET).toBe('standard');
    expect(Object.values(PRESETS).map((p) => p.label)).toEqual(['Quick', 'Standard', 'Long']);
  });

  it('guards Preset ids', () => {
    for (const id of ['quick', 'standard', 'long']) expect(isPresetId(id)).toBe(true);
    for (const id of ['Quick', 'toString', '__proto__', '', 3, null, undefined]) expect(isPresetId(id)).toBe(false);
  });
});

describe('Display names', () => {
  const ok = (raw: unknown) => validateDisplayName(raw);

  it('trims and collapses whitespace', () => {
    expect(ok('  Ana  Lee ')).toEqual({ ok: true, name: 'Ana Lee' });
    expect(ok('Ana\t\nLee')).toEqual({ ok: true, name: 'Ana Lee' });
  });

  it('accepts accented names in NFC and NFD, stored as NFC', () => {
    const nfc = "Zoë Renée-L_2.'".normalize('NFC');
    expect(nfc.normalize('NFD')).not.toBe(nfc);
    for (const raw of [nfc, nfc.normalize('NFD')]) expect(ok(raw)).toEqual({ ok: true, name: nfc });
  });

  it('accepts other scripts, counting code points', () => {
    expect(ok('李小龍')).toEqual({ ok: true, name: '李小龍' });
    expect(ok('𠀀'.repeat(16))).toEqual({ ok: true, name: '𠀀'.repeat(16) });
  });

  it('rejects empty, too long, and other characters', () => {
    expect(ok('')).toEqual({ ok: false, reason: 'empty' });
    expect(ok('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(ok('a'.repeat(16))).toMatchObject({ ok: true });
    expect(ok('a'.repeat(17))).toEqual({ ok: false, reason: 'too-long' });
    expect(ok('Ana 🏓')).toEqual({ ok: false, reason: 'charset' });
    expect(ok('Ana\u0007')).toEqual({ ok: false, reason: 'charset' });
    expect(ok('<script>')).toEqual({ ok: false, reason: 'charset' });
  });

  it('rejects non-strings', () => {
    for (const raw of [undefined, null, 42, ['Ana'], { name: 'Ana' }]) expect(ok(raw)).toEqual({ ok: false, reason: 'empty' });
  });
});
