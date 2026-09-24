// The Venue's ambience loop (art/audio/, made by art/scripts/ambience.py). It shares the ZzFX audio context,
// so it starts when unlockAudio resumes that context.
import { ZZFX } from 'zzfx';
import type { ViewTuning } from '../tuning';

let gain: GainNode | null = null;
let source: AudioBufferSourceNode | null = null;
/** The loop asked for last; a slower earlier load mustn't start over it. */
let wanted = '';
const buffers = new Map<string, Promise<AudioBuffer>>();

/** Loops `url` in place of the current ambience. Failure (no audio, no Ogg support) just means silence. */
export async function setAmbience(url: string, view: ViewTuning) {
  if (url === wanted) return;
  wanted = url;
  try {
    const ctx = ZZFX.audioContext;
    let buffer = buffers.get(url);
    if (!buffer) {
      buffer = fetch(url)
        .then((r) => r.arrayBuffer())
        .then((b) => ctx.decodeAudioData(b));
      buffers.set(url, buffer);
    }
    const decoded = await buffer;
    if (url !== wanted) return;
    source?.stop();
    if (!gain) {
      gain = ctx.createGain();
      gain.connect(ctx.destination);
    }
    source = ctx.createBufferSource();
    source.buffer = decoded;
    source.loop = true;
    source.connect(gain);
    updateAmbience(view);
    source.start();
  } catch (e) {
    buffers.delete(url);
    if (url === wanted) wanted = '';
    console.warn('Ambience unavailable:', e);
  }
}

/** Follows the live volume sliders. */
export function updateAmbience(view: ViewTuning) {
  if (gain) gain.gain.value = view.ambience * view.volume;
}
