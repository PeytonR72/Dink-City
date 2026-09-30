// The Lobby's directory of Courts, pure, with the time passed in. Courts report their lifecycle best-effort, so the
// reports can arrive late, twice, out of order or not at all: each carries the Court's own sequence number, and every
// entry expires 90 s after its last report.
import type { LobbyCourt, PresetId } from '../../src/net';

/** How long an entry lives after its last report. A Court heartbeats every 30 s until the Match starts. */
export const ENTRY_TTL_MS = 90_000;
/** The most Courts a list holds. */
export const LIST_CAP = 50;

/** What a Court reports about itself while it's waiting for its Match to start. */
export interface CourtInfo {
  code: string;
  hostName: string;
  preset: PresetId;
  createdAt: number;
}

/**
 * One report from a Court. `seq` rises with every report the Court sends. The live reports carry the whole entry, so
 * a lost `open` is rebuilt by the next one; `heartbeat` says whether a Guest is seated.
 */
export type CourtReport =
  | (CourtInfo & { op: 'open' | 'join' | 'leave'; seq: number })
  | (CourtInfo & { op: 'heartbeat'; seq: number; players: 1 | 2 })
  | { op: 'start' | 'end' | 'close'; code: string; seq: number };

/** What a report says happened. */
export type ReportOp = CourtReport['op'];

/** A Court, or the memory of a removed one, which keeps late reports from bringing it back until it expires. */
type Entry = { seq: number; expiresAt: number } & ({ removed: false; info: CourtInfo; players: 1 | 2 } | { removed: true });

/** The Lobby's entries, keyed by Court code. */
export interface CourtDirectory {
  /** Applies a report. True if the list changed. */
  report(r: CourtReport, now: number): boolean;
  /** Forgets every expired entry. True if the list changed. */
  sweep(now: number): boolean;
  /** The open Courts with no Guest, newest first, at most `LIST_CAP`. */
  list(now: number): LobbyCourt[];
}

/** An empty directory. `ttlMs` shortens the entries' life, for testing expiry. */
export function createCourtDirectory({ ttlMs = ENTRY_TTL_MS }: { ttlMs?: number } = {}): CourtDirectory {
  const entries = new Map<string, Entry>();
  const listed = (e: Entry | undefined, now: number): e is Entry & { removed: false } =>
    e !== undefined && !e.removed && e.players === 1 && e.expiresAt > now;

  return {
    report(r, now) {
      const old = entries.get(r.code);
      // A removed Court stays removed; a report older than the latest changes nothing.
      if (old !== undefined && (old.removed || r.seq <= old.seq)) return false;
      const was = listed(old, now);
      const expiresAt = now + ttlMs;
      // Only the live reports carry the entry; start, end and close remove it.
      if ('hostName' in r) {
        const players = r.op === 'heartbeat' ? r.players : r.op === 'join' ? 2 : 1;
        const info = { code: r.code, hostName: r.hostName, preset: r.preset, createdAt: r.createdAt };
        entries.set(r.code, { seq: r.seq, expiresAt, removed: false, info, players });
      } else entries.set(r.code, { seq: r.seq, expiresAt, removed: true });
      return was !== listed(entries.get(r.code), now);
    },

    sweep(now) {
      let changed = false;
      for (const [code, e] of entries) {
        if (e.expiresAt > now) continue;
        entries.delete(code);
        changed ||= !e.removed && e.players === 1;
      }
      return changed;
    },

    list(now) {
      const out: LobbyCourt[] = [];
      for (const e of entries.values()) if (listed(e, now)) out.push({ ...e.info, players: 1 });
      out.sort((a, b) => b.createdAt - a.createdAt || (a.code < b.code ? -1 : 1));
      return out.slice(0, LIST_CAP);
    },
  };
}
