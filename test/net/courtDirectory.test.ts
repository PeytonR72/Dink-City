import { describe, expect, it } from 'vitest';
import { ENTRY_TTL_MS, LIST_CAP, createCourtDirectory, type CourtReport } from '../../party/src/courtDirectory';

const T0 = 1_000_000;

/** A Court's reports, numbered in the order the Court sent them. */
function court(code: string, createdAt = T0) {
  let seq = 0;
  const info = { code, hostName: `Host ${code}`, preset: 'standard' as const, createdAt };
  return {
    open: (): CourtReport => ({ op: 'open', seq: ++seq, ...info }),
    heartbeat: (players: 1 | 2 = 1): CourtReport => ({ op: 'heartbeat', seq: ++seq, ...info, players }),
    join: (): CourtReport => ({ op: 'join', seq: ++seq, ...info }),
    leave: (): CourtReport => ({ op: 'leave', seq: ++seq, ...info }),
    start: (): CourtReport => ({ op: 'start', seq: ++seq, code }),
    end: (): CourtReport => ({ op: 'end', seq: ++seq, code }),
    close: (): CourtReport => ({ op: 'close', seq: ++seq, code }),
  };
}

const codes = (d: ReturnType<typeof createCourtDirectory>, now = T0) => d.list(now).map((c) => c.code);

describe('the Court directory', () => {
  it('lists an opened Court with its host, Preset, one Player and creation time', () => {
    const d = createCourtDirectory();
    expect(d.report(court('AAAAA').open(), T0)).toBe(true);
    expect(d.list(T0)).toEqual([{ code: 'AAAAA', hostName: 'Host AAAAA', preset: 'standard', players: 1, createdAt: T0 }]);
  });

  it('drops an entry 90 s after its last report, with no reports in between', () => {
    const d = createCourtDirectory();
    d.report(court('AAAAA').open(), T0);
    expect(codes(d, T0 + ENTRY_TTL_MS - 1)).toEqual(['AAAAA']);
    expect(codes(d, T0 + ENTRY_TTL_MS)).toEqual([]);
    expect(d.sweep(T0 + ENTRY_TTL_MS - 1)).toBe(false);
    expect(d.sweep(T0 + ENTRY_TTL_MS)).toBe(true);
    expect(d.sweep(T0 + ENTRY_TTL_MS)).toBe(false);
  });

  it('keeps a heartbeating Court listed, without counting the heartbeat as a change', () => {
    const d = createCourtDirectory();
    const c = court('AAAAA');
    d.report(c.open(), T0);
    expect(d.report(c.heartbeat(), T0 + 60_000)).toBe(false);
    expect(codes(d, T0 + 60_000 + ENTRY_TTL_MS - 1)).toEqual(['AAAAA']);
    expect(d.sweep(T0 + 60_000 + ENTRY_TTL_MS)).toBe(true);
  });

  it('hides a Court when a Guest joins and shows it again when they leave', () => {
    const d = createCourtDirectory();
    const c = court('AAAAA');
    d.report(c.open(), T0);
    expect(d.report(c.join(), T0 + 1)).toBe(true);
    expect(codes(d)).toEqual([]);
    // A hidden entry still expires on its own, and heartbeats keep it hidden.
    expect(d.report(c.heartbeat(2), T0 + 2)).toBe(false);
    expect(codes(d)).toEqual([]);
    expect(d.report(c.leave(), T0 + 3)).toBe(true);
    expect(codes(d)).toEqual(['AAAAA']);
  });

  it('removes a Court on start, end and close', () => {
    for (const op of ['start', 'end', 'close'] as const) {
      const d = createCourtDirectory();
      const c = court('AAAAA');
      d.report(c.open(), T0);
      expect(d.report(c[op](), T0 + 1)).toBe(true);
      expect(codes(d)).toEqual([]);
    }
  });

  it('removes a hidden Court on start without counting it as a change to the list', () => {
    const d = createCourtDirectory();
    const c = court('AAAAA');
    d.report(c.open(), T0);
    d.report(c.join(), T0);
    expect(d.report(c.start(), T0)).toBe(false);
  });

  it('takes end more than once, and for a Court it never heard of', () => {
    const d = createCourtDirectory();
    const c = court('AAAAA');
    d.report(c.open(), T0);
    d.report(c.start(), T0);
    expect(d.report(c.end(), T0)).toBe(false);
    expect(d.report(c.end(), T0)).toBe(false);
    expect(d.report(court('BBBBB').end(), T0)).toBe(false);
    expect(codes(d)).toEqual([]);
  });

  it('never brings back a removed Court, whatever arrives late', () => {
    const d = createCourtDirectory();
    const c = court('AAAAA');
    const open = c.open();
    const join = c.join();
    const leave = c.leave();
    const heartbeat = c.heartbeat();
    d.report(open, T0);
    d.report(c.start(), T0);
    for (const late of [join, leave, heartbeat, open]) expect(d.report(late, T0 + 1)).toBe(false);
    expect(codes(d, T0 + 1)).toEqual([]);
  });

  it('ignores a report older than one it already has', () => {
    const d = createCourtDirectory();
    const c = court('AAAAA');
    d.report(c.open(), T0);
    const join = c.join();
    const leave = c.leave();
    d.report(leave, T0);
    expect(d.report(join, T0)).toBe(false);
    expect(codes(d)).toEqual(['AAAAA']);
  });

  it('rebuilds an entry from a later report when the open was lost', () => {
    const d = createCourtDirectory();
    const c = court('AAAAA');
    c.open();
    expect(d.report(c.heartbeat(), T0)).toBe(true);
    expect(codes(d)).toEqual(['AAAAA']);
    const hidden = createCourtDirectory();
    const h = court('BBBBB');
    h.open();
    expect(hidden.report(h.join(), T0)).toBe(false);
    expect(hidden.report(h.leave(), T0)).toBe(true);
    expect(codes(hidden)).toEqual(['BBBBB']);
  });

  it('forgets a removed Court 90 s after its last report', () => {
    const d = createCourtDirectory();
    const c = court('AAAAA');
    const late = court('AAAAA');
    d.report(c.open(), T0);
    d.report(c.close(), T0);
    expect(d.sweep(T0 + ENTRY_TTL_MS)).toBe(false);
    // Forgotten, so a Court of the same code (a code reused much later) is listed again.
    expect(d.report(late.open(), T0 + ENTRY_TTL_MS)).toBe(true);
  });

  it('lists newest first, at most 50', () => {
    const d = createCourtDirectory();
    for (let i = 0; i < LIST_CAP + 5; i++) d.report(court(`C${String(i).padStart(4, '0')}`, T0 + i).open(), T0);
    const list = d.list(T0);
    expect(list).toHaveLength(LIST_CAP);
    expect(list[0]!.code).toBe(`C${String(LIST_CAP + 4).padStart(4, '0')}`);
    expect(list.every((c, i) => i === 0 || c.createdAt < list[i - 1]!.createdAt)).toBe(true);
  });

  it('takes a shorter time to live for testing', () => {
    const d = createCourtDirectory({ ttlMs: 5_000 });
    d.report(court('AAAAA').open(), T0);
    expect(codes(d, T0 + 5_000)).toEqual([]);
  });
});
