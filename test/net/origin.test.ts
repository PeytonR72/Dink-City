import { describe, expect, it } from 'vitest';
import { isAllowedOrigin } from '../../party/src/origin';

describe('the Origin allowlist', () => {
  it('allows the Vercel site and localhost on any port', () => {
    for (const o of ['https://dink-city.vercel.app', 'http://localhost:5173', 'http://127.0.0.1:8787', 'http://localhost'])
      expect(isAllowedOrigin(o), o).toBe(true);
  });

  it('refuses everything else', () => {
    const bad = [
      null,
      '',
      'null',
      'http://dink-city.vercel.app',
      'https://dink-city.vercel.app.evil.com',
      'https://evil-dink-city.vercel.app',
      'https://localhost:5173',
      'http://localhost.evil.com',
      'http://localhost:5173/path',
    ];
    for (const o of bad) expect(isAllowedOrigin(o), String(o)).toBe(false);
  });
});
