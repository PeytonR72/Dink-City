// A guest Display name. The same check runs on the client, for instant feedback, and on the server, which decides.

const MAX_LENGTH = 16;
/** Letters and digits in any script, plus space and - _ . ' */
const ALLOWED = /^[\p{L}\p{N} \-_.']+$/u;

export type DisplayNameResult = { ok: true; name: string } | { ok: false; reason: 'empty' | 'too-long' | 'charset' };

/** Normalizes to NFC, trims, and collapses whitespace, then checks 1–16 code points of allowed characters. */
export function validateDisplayName(raw: unknown): DisplayNameResult {
  if (typeof raw !== 'string') return { ok: false, reason: 'empty' };
  const name = raw.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (name === '') return { ok: false, reason: 'empty' };
  if ([...name].length > MAX_LENGTH) return { ok: false, reason: 'too-long' };
  if (!ALLOWED.test(name)) return { ok: false, reason: 'charset' };
  return { ok: true, name };
}
