// A Court code names the Court's Durable Object, and Players type it to join.

/** Uppercase letters and digits, without O/0/I/1/L. */
export const COURT_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** 31^5, about 29 million codes. */
export const COURT_CODE_LENGTH = 5;

/** The largest multiple of the alphabet's size below 256; bytes from here up would bias the code. */
const BYTE_LIMIT = 256 - (256 % COURT_CODE_ALPHABET.length);

/** A random code. The Worker passes `crypto.getRandomValues` as `randomBytes`. */
export function makeCourtCode(randomBytes: (n: number) => Uint8Array): string {
  let code = '';
  while (code.length < COURT_CODE_LENGTH) {
    for (const b of randomBytes(COURT_CODE_LENGTH - code.length)) {
      if (b < BYTE_LIMIT) code += COURT_CODE_ALPHABET[b % COURT_CODE_ALPHABET.length];
    }
  }
  return code;
}

const CODE = new RegExp(`^[${COURT_CODE_ALPHABET}]{${COURT_CODE_LENGTH}}$`);

/** Guards a Court code from a URL or the wire. */
export function isCourtCode(v: unknown): v is string {
  return typeof v === 'string' && CODE.test(v);
}

/** The code in what a Player typed or pasted: the code itself in any case, or a link with `court=CODE`. */
export function readCourtCode(raw: string): string | null {
  const code = (/[?&]court=([^&#]*)/.exec(raw)?.[1] ?? raw).trim().toUpperCase();
  return isCourtCode(code) ? code : null;
}
