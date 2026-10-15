import type { Swing } from '../net/controller';
import type { MotionTuning } from '../input/motionTuning';
export interface MotionSample {
  at: number;
  rotation: { alpha: number; beta: number; gamma: number };
  acceleration: { x: number; y: number; z: number };
  orientation: { pitch: number; roll: number; yaw: number };
}
export interface Calibration { pitch: number; roll: number; yaw: number; hand: 'left' | 'right' }
export const rotationSpeed = (s: MotionSample) => Math.hypot(s.rotation.alpha, s.rotation.beta, s.rotation.gamma);
export const angleDelta = (a: number, b: number) => ((a - b + 540) % 360 + 360) % 360 - 180;
const clamp = (n: number) => Math.max(-1, Math.min(1, n));
export function tiltAim(sample: MotionSample, calibration: Calibration, tuning: MotionTuning) {
  return { x: clamp(angleDelta(sample.orientation.roll, calibration.roll) / Math.max(1, tuning.aimDegrees) * (calibration.hand === 'left' ? -1 : 1)), y: 0 };
}
/** Explainable initial classifier. Real-phone accuracy is a separate recorded-fixture acceptance gate. */
export function detectSwing(samples: readonly MotionSample[], calibration: Calibration, tuning: MotionTuning): Swing | null {
  if (samples.length < 3) return null;
  if (samples.some((s, i) => !Number.isFinite(s.at) || Object.values(s.rotation).some(v => !Number.isFinite(v)) || Object.values(s.orientation).some(v => !Number.isFinite(v)) || (i > 0 && s.at <= samples[i - 1].at))) return null;
  const end = samples[samples.length - 1];
  const window = samples.filter(s => end.at - s.at <= tuning.sampleWindowMs);
  if (window.length < 3) return null;
  let peakIndex = 0;
  for (let i = 1; i < window.length; i++) if (rotationSpeed(window[i]) > rotationSpeed(window[peakIndex])) peakIndex = i;
  const peak = window[peakIndex];
  const speed = rotationSpeed(peak);
  if (speed < tuning.peakThreshold || peakIndex === 0 || peakIndex === window.length - 1 || rotationSpeed(end) > speed * tuning.peakFallRatio) return null;
  const rise = angleDelta(peak.orientation.pitch, window[0].orientation.pitch);
  const type = rise >= tuning.lobPitchDegrees ? 'lob' : speed >= tuning.driveThreshold ? 'drive' : 'soft';
  const low = tuning.peakThreshold;
  const high = type === 'soft' ? tuning.driveThreshold : tuning.driveThreshold * 2;
  return { type, aim: tiltAim(peak, calibration, tuning), strength: Math.max(0, Math.min(1, (speed - low) / Math.max(1, high - low))), at: peak.at };
}
/** One event per physical peak: must settle and leave cooldown before rearming. */
export class GestureDetector {
  private samples: MotionSample[] = [];
  private last = -Infinity;
  private armed = true;
  constructor(private tuning: MotionTuning) {}
  reset() { this.samples = []; this.last = -Infinity; this.armed = true; }
  push(sample: MotionSample, calibration: Calibration): Swing | null {
    if (!this.armed) {
      if (sample.at - this.last >= this.tuning.cooldownMs && rotationSpeed(sample) < this.tuning.peakThreshold * this.tuning.settleRatio) { this.armed = true; this.samples = []; }
      return null;
    }
    this.samples.push(sample);
    this.samples = this.samples.filter(s => sample.at - s.at <= this.tuning.sampleWindowMs).slice(-120);
    const swing = detectSwing(this.samples, calibration, this.tuning);
    if (swing) { this.last = sample.at; this.armed = false; this.samples = []; }
    return swing;
  }
}
