// Both ends of an online Match must run the same Sim. The handshake compares this hash and refuses a mismatch.
import type { SimTuning } from '../sim';

/** Bump when a Sim change alters play without touching `simTuning`. */
export const SIM_VERSION = 1;

/** A 32-bit FNV-1a hash (8 hex digits) of `tuning`'s canonical JSON and the Sim version. */
export function simHash(tuning: SimTuning, version = SIM_VERSION): string {
  const text = `${version}:${canonical(tuning)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** JSON with every object's keys sorted, so key order doesn't matter. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}
