import { describe, expect, it } from 'vitest';
import { onlineOffered } from '../src/online/gate';

describe('Online play', () => {
  it('is offered in dev, with or without a server named', () => {
    expect(onlineOffered({ DEV: true })).toBe(true);
    expect(onlineOffered({ DEV: true, VITE_PARTY_HOST: 'localhost:8787' })).toBe(true);
  });

  it('is offered in a build only when it names its server', () => {
    expect(onlineOffered({ DEV: false })).toBe(false);
    expect(onlineOffered({ DEV: false, VITE_PARTY_HOST: '' })).toBe(false);
    expect(onlineOffered({ DEV: false, VITE_PARTY_HOST: 'dink-city.example.workers.dev' })).toBe(true);
  });
});
