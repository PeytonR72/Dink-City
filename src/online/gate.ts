// Whether this build offers online play. The production build uses the public Worker hostname in
// .env.production; local development can override it with VITE_PARTY_HOST.

/** Offered in dev, and in a build that names its server. */
export function onlineOffered(env: { DEV: boolean; VITE_PARTY_HOST?: string }): boolean {
  return env.DEV || Boolean(env.VITE_PARTY_HOST);
}
