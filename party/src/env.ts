import type { Court } from './court';
import type { Lobby } from './lobby';

/** The Worker's bindings, from wrangler.jsonc. */
export interface Env {
  COURT: DurableObjectNamespace<Court>;
  LOBBY: DurableObjectNamespace<Lobby>;
}
