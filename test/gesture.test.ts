import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectSwing, GestureDetector, tiltAim, type Calibration, type MotionSample } from '../src/controller/gesture';
import { motionTuning } from '../src/input/motionTuning';
const calibration: Calibration = { pitch: 0, roll: 0, yaw: 0, hand: 'right' };
// SYNTHETIC mechanics fixtures, not recordings or accuracy evidence.
const synthetic = (speed: number, rise = 0): MotionSample[] => [0, speed * .4, speed, speed * .5, 0].map((v, i) => ({ at: 1000 + i * 25, rotation: { alpha: v, beta: 0, gamma: 0 }, acceleration: { x: 0, y: 0, z: 0 }, orientation: { pitch: i >= 2 ? rise : 0, roll: 22.5, yaw: 0 } }));
describe('synthetic gesture mechanics (not human accuracy)', () => {
  it.each([['soft', 180, 0], ['drive', 450, 0], ['lob', 450, 35], ['miss', 20, 0]] as const)('recognizes %s', (type, speed, rise) => { expect(detectSwing(synthetic(speed, rise), calibration, motionTuning)?.type ?? 'miss').toBe(type); });
  it('requires a falling peak and valid samples', () => { expect(detectSwing(synthetic(450).slice(0, 3), calibration, motionTuning)).toBeNull(); const bad = synthetic(450); bad[2].rotation.alpha = NaN; expect(detectSwing(bad, calibration, motionTuning)).toBeNull(); });
  it('mirrors left hand, wraps angles and fixes depth at zero', () => { const s = synthetic(450)[2]; expect(tiltAim(s, calibration, motionTuning)).toEqual({ x: .5, y: 0 }); expect(tiltAim(s, { ...calibration, hand: 'left' }, motionTuning).x).toBe(-.5); s.orientation.roll = -179; expect(tiltAim(s, { ...calibration, roll: 179 }, motionTuning).x).toBeCloseTo(2 / 45); });
  it('fires once, requires settling and cooldown, and resets on recalibration', () => {
    const d = new GestureDetector(motionTuning); const samples = synthetic(450); let count = 0;
    for (const s of samples) if (d.push(s, calibration)) count++;
    for (const s of samples.map(s => ({ ...s, at: s.at + 130 }))) if (d.push(s, calibration)) count++;
    expect(count).toBe(1);
    for (const s of samples.map(s => ({ ...s, at: s.at + 1000 }))) if (d.push(s, calibration)) count++;
    expect(count).toBe(2); d.reset(); expect(samples.map(s => d.push(s, calibration)).filter(Boolean)).toHaveLength(1);
  });
});
describe('modest sensitivity and repeat guards', () => {
  const wave = (speeds: number[], at = 1000) => speeds.map((speed, i) => ({ ...synthetic(100)[0], at: at + i * 25, rotation: { alpha: speed, beta: 0, gamma: 0 } }));
  it('accepts an 85 degree/s peak, rejects below-threshold motion, and keeps shot boundaries', () => {
    expect(detectSwing(wave([0, 30, 85, 60]), calibration, motionTuning)?.type).toBe('soft');
    expect(detectSwing(wave([0, 30, 84.9, 60]), calibration, motionTuning)).toBeNull();
    expect(detectSwing(synthetic(329), calibration, motionTuning)?.type).toBe('soft');
    expect(detectSwing(synthetic(330), calibration, motionTuning)?.type).toBe('drive');
    expect(detectSwing(synthetic(180, 22), calibration, motionTuning)?.type).toBe('lob');
  });
  it('emits on a 20% fall, without waiting for the former 35% fall or replaying its tail', () => {
    const samples = wave([0, 30, 90, 73, 72, 60, 0]); const detector = new GestureDetector(motionTuning);
    const events = samples.map(sample => detector.push(sample, calibration));
    expect(events.slice(0, 4)).toEqual([null, null, null, null]);
    expect(events[4]).toMatchObject({ type: 'soft', at: samples[2].at });
    expect(events.filter(Boolean)).toHaveLength(1);
  });
  it('rejects rest, slow rotation, acceleration-only jolts, sustained plateaus and stale peaks', () => {
    for (const speeds of [[0, 0, 0, 0], [15, 35, 60, 40], [0, 0, 0, 0], [0, 90, 90, 90]]) {
      const samples = wave(speeds); samples[2].acceleration = { x: 40, y: 40, z: 40 };
      expect(detectSwing(samples, calibration, motionTuning)).toBeNull();
    }
    const slow = wave([0, 90, 0]).map((s, i) => ({ ...s, at: 1000 + i * 250 }));
    expect(detectSwing(slow, calibration, motionTuning)).toBeNull();
    const unordered = wave([0, 90, 0]); unordered[2].at = unordered[1].at;
    expect(detectSwing(unordered, calibration, motionTuning)).toBeNull();
  });
  it('retains the settled baseline for the next short swing but never fires without settling', () => {
    const detector = new GestureDetector(motionTuning);
    expect(wave([0, 40, 180, 100]).map(s => detector.push(s, calibration)).filter(Boolean)).toHaveLength(1);
    expect(wave([100, 180, 100, 180, 100], 1700).map(s => detector.push(s, calibration)).filter(Boolean)).toHaveLength(0);
    expect(wave([0, 90, 60], 2200).map(s => detector.push(s, calibration)).filter(Boolean)).toHaveLength(1);
    detector.reset(); // recalibration drops an incomplete peak
    detector.push(wave([0])[0], calibration); detector.push(wave([180], 1025)[0], calibration); detector.reset();
    expect(detector.push(wave([60], 1050)[0], calibration)).toBeNull();
  });
});

type Trace = { source: string; participant: string; label: string; calibration: Calibration; samples: MotionSample[] };
const dir = join(__dirname, 'fixtures/motion');
const traces = readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Trace).filter(t => t.source === 'recorded-human');
it.skipIf(traces.length === 0)('HUMAN ACCEPTANCE: >=85% correct, no non-swing false positives, >=70 traces and two people', () => {
  const labels = ['soft', 'drive', 'lob', 'miss']; const matrix: Record<string, Record<string, number>> = Object.fromEntries(labels.map(l => [l, Object.fromEntries(labels.map(k => [k, 0]))]));
  let correct = 0; let total = 0;
  for (const trace of traces) {
    expect(labels).toContain(trace.label);
    const detector = new GestureDetector(motionTuning); const recognized = trace.samples.map(s => detector.push(s, trace.calibration)).filter(s => s !== null);
    const actual = recognized[0]?.type ?? 'miss'; matrix[trace.label][actual]++;
    if (trace.label === 'miss') expect(recognized).toHaveLength(0);
    else { total++; if (recognized.length === 1 && actual === trace.label) correct++; }
  }
  console.table(matrix);
  expect(new Set(traces.map(t => t.participant)).size).toBeGreaterThanOrEqual(2);
  for (const label of labels) expect(traces.filter(t => t.label === label).length).toBeGreaterThanOrEqual(label === 'miss' ? 10 : 20);
  expect(correct / total).toBeGreaterThanOrEqual(.85);
});
