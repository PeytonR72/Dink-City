import { Server } from 'partyserver';
import type { Env } from './env';

/** The Court directory. A stub until issue 05, declared now so the migration tag doesn't change. */
export class Lobby extends Server<Env> {
  static override options = { hibernate: false };
}
