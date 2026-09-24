// ZzFX sound effects, hooked onto Sim events (never inside the Sim).
import { ZZFX, ZZFXSound } from 'zzfx';
import { HALF_WIDTH, type End, type ShotVariant, type SimEvent } from '../sim';
import type { ViewTuning } from '../tuning';

// ZzFX parameters: volume, randomness, frequency, attack, sustain, release, shape,
// shapeCurve, slide, deltaSlide, pitchJump, pitchJumpTime, repeatTime, noise,
// modulation, bitCrush, delay, sustainVolume, decay, tremolo, filter.
const SOUNDS = {
  /** Hollow plastic "pock" of a pickleball paddle. */
  pop: new ZZFXSound([1.4, 0.04, 720, 0, 0.004, 0.05, 1, 2, -30, 0, 0, 0, 0, 0.35, 0, 0, 0, 0.7, 0.012]),
  bounce: new ZZFXSound([0.7, 0.05, 170, 0, 0.004, 0.06, 0, 1, -45, 0, 0, 0, 0, 1.2]),
  net: new ZZFXSound([0.9, 0.1, 90, 0.005, 0.03, 0.15, 4, 1, -5, 0, 0, 0, 0, 0, 0, 0, 0, 0.8, 0.02, 0, -900]),
  cord: new ZZFXSound([0.8, 0.05, 900, 0, 0.005, 0.04, 1, 1, -60]),
  /** A short descending two-tone sting for Faults. */
  fault: new ZZFXSound([0.7, 0, 392, 0.01, 0.12, 0.2, 2, 1, 0, 0, -98, 0.1, 0, 0, 0, 0, 0, 0.6, 0.05, 0, -1800]),
};

/** Softer shots pop quieter and higher; Smashes crack lower and louder. */
const POP: Record<ShotVariant, { volume: number; pitch: number }> = {
  dink: { volume: 0.55, pitch: 1.15 },
  drop: { volume: 0.65, pitch: 1.1 },
  block: { volume: 0.7, pitch: 1.05 },
  lob: { volume: 0.8, pitch: 1 },
  serve: { volume: 0.85, pitch: 1 },
  drive: { volume: 1, pitch: 0.95 },
  smash: { volume: 1.3, pitch: 0.8 },
};

let unlocked = false;
/** Browsers start audio suspended until a user gesture. */
export function unlockAudio(target: Window = window) {
  const resume = () => {
    if (unlocked) return;
    unlocked = true;
    ZZFX.audioContext.resume().catch(() => {});
  };
  target.addEventListener('keydown', resume);
  target.addEventListener('pointerdown', resume);
}

/**
 * Plays the sounds for one Tick's events. `localEnd` mirrors panning so the
 * local Player's left is always the left speaker.
 */
export function playEvents(events: readonly SimEvent[], localEnd: End, view: ViewTuning) {
  ZZFX.volume = 0.3 * view.volume;
  const pan = (x: number) => Math.max(-0.8, Math.min(0.8, ((localEnd === 1 ? -x : x) / HALF_WIDTH) * 0.8));
  for (const e of events) {
    if (e.kind === 'hit') {
      const p = POP[e.variant];
      // Weak contact sounds duller.
      SOUNDS.pop.play(p.volume * (0.7 + 0.3 * e.quality), p.pitch * (0.9 + 0.1 * e.quality), 1, pan(e.pos.x));
    } else if (e.kind === 'bounce') {
      SOUNDS.bounce.play(Math.min(1, 0.25 + e.speed / 10), 1, 1, pan(e.pos.x));
    } else if (e.kind === 'net') {
      (e.cord ? SOUNDS.cord : SOUNDS.net).play(1, 1, 1, pan(e.pos.x));
    } else if (e.kind === 'dead' && e.reason !== 'double-bounce') {
      SOUNDS.fault.play();
    }
  }
}
