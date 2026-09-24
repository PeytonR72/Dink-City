declare module 'zzfx' {
  export const ZZFX: { volume: number; audioContext: AudioContext };
  export class ZZFXSound {
    constructor(params: (number | undefined)[]);
    play(volume?: number, pitch?: number, randomnessScale?: number, pan?: number): AudioBufferSourceNode | undefined;
  }
}
