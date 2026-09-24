// The Venue's ambience loop (art/audio/, made by art/scripts/ambience.py). It shares the ZzFX audio context,
// so it starts when unlockAudio resumes that context.
import { ZZFX } from 'zzfx';
import parkUrl from '../../art/audio/park-ambience.ogg?url';
import type { ViewTuning } from '../tuning';

let gain: GainNode | null = null;

/** Starts the Park ambience looping. Failure (no audio, no Ogg support) just means silence. */
export async function startAmbience(view: ViewTuning) {
  try {
    const ctx = ZZFX.audioContext;
    const buffer = await ctx.decodeAudioData(await (await fetch(parkUrl)).arrayBuffer());
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    gain = ctx.createGain();
    source.connect(gain).connect(ctx.destination);
    updateAmbience(view);
    source.start();
  } catch (e) {
    console.warn('Ambience unavailable:', e);
  }
}

/** Follows the live volume sliders. */
export function updateAmbience(view: ViewTuning) {
  if (gain) gain.gain.value = view.ambience * view.volume;
}
