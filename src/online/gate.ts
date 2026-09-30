// Whether this build offers online play. Vercel deploys `main` on every push, and production has no server until
// issue 16 sets `VITE_PARTY_HOST` there.

/** Offered in dev, and in a build that names its server. */
export function onlineOffered(env: { DEV: boolean; VITE_PARTY_HOST?: string }): boolean {
  return env.DEV || Boolean(env.VITE_PARTY_HOST);
}
