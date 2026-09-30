import type { Court } from './court';
import type { Lobby } from './lobby';

/** The Worker's bindings, from wrangler.jsonc. */
export interface Env {
  COURT: DurableObjectNamespace<Court>;
  LOBBY: DurableObjectNamespace<Lobby>;
  /** Dev only: the Lobby's entry lifetime in ms, e.g. `wrangler dev --var LOBBY_TTL_MS:5000`. */
  LOBBY_TTL_MS?: string;
}
