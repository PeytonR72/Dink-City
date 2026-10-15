// Browsers send Origin, so only the Dink City site and local dev servers can reach /create and the WebSockets.

const SITE = 'https://dink-city.vercel.app';
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

/** The Dink City site, or http://localhost or 127.0.0.1 on any port. A missing Origin is refused. */
export function isAllowedOrigin(origin: string | null, dev?: { CONTROLLER_DEV?: string; EXTRA_ORIGINS?: string }): boolean {
  return origin !== null && (origin === SITE || LOCAL.test(origin) || (dev?.CONTROLLER_DEV === 'true' && (dev.EXTRA_ORIGINS ?? '').split(',').some(v => v.trim() === origin && /^https:\/\//.test(origin))));
}
