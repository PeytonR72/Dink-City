// The Venues of Dink City, in unlock order: their Bot, its look, and the lighting. Plain data; the models and
// ambience files are in assets.ts, so this stays importable from tests.
import type { PersonalityName } from '../bot/personality';
import type { PlayerColors } from '../render/models';

export const VENUE_IDS = ['park', 'rooftop', 'beach'] as const;
export type VenueId = (typeof VENUE_IDS)[number];

/** One sun plus a hemisphere light. */
export interface Lighting {
  sky: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sun: number;
  sunIntensity: number;
  sunPos: readonly [number, number, number];
}

export interface Venue {
  id: VenueId;
  name: string;
  /** One line for the map. */
  blurb: string;
  personality: PersonalityName;
  /** The Bot's look: the model's default colors with these regions changed. */
  bot: Partial<PlayerColors>;
  lighting: { day: Lighting; sunset: Lighting };
}

export const VENUES: Record<VenueId, Venue> = {
  park: {
    id: 'park',
    name: 'The Park',
    blurb: 'A patient Dinker who lives at the Kitchen line.',
    personality: 'dinker',
    bot: { shirt: '#8a5cf6', hair: '#e0a13a', skin: '#c68a5e', paddle: '#3aa0e8' },
    lighting: {
      day: { sky: 0x8fd3ff, hemiSky: 0xffffff, hemiGround: 0x5a7a4a, hemiIntensity: 1.6, sun: 0xfff1d6, sunIntensity: 2.2, sunPos: [-6, 12, 4] },
      sunset: { sky: 0xf4a26b, hemiSky: 0xffd9bf, hemiGround: 0x6b4f63, hemiIntensity: 1.75, sun: 0xffa866, sunIntensity: 2.5, sunPos: [-10, 6, -6] },
    },
  },
  rooftop: {
    id: 'rooftop',
    name: 'The Rooftop',
    blurb: 'A Banger who hits everything hard and wide.',
    personality: 'banger',
    bot: { shirt: '#e8474c', shorts: '#1d1d24', hair: '#1d1d24', skin: '#8d5a3b', paddle: '#ffd23f' },
    lighting: {
      day: { sky: 0x9cc8ec, hemiSky: 0xf4f6ff, hemiGround: 0x5a5f6e, hemiIntensity: 1.55, sun: 0xfff4e0, sunIntensity: 2.3, sunPos: [7, 13, 3] },
      sunset: { sky: 0xe98b7a, hemiSky: 0xffc9c0, hemiGround: 0x4f4460, hemiIntensity: 1.7, sun: 0xff9a6a, sunIntensity: 2.5, sunPos: [11, 5, -5] },
    },
  },
  beach: {
    id: 'beach',
    name: 'The Beach',
    blurb: 'A Lobber who throws the ball up into the sun.',
    personality: 'lobber',
    bot: { shirt: '#2ec4b6', shorts: '#ff7eb0', hair: '#f4d27a', skin: '#e6b08a', paddle: '#ff7a3d' },
    lighting: {
      day: { sky: 0x7fd6f5, hemiSky: 0xffffff, hemiGround: 0xc9b27a, hemiIntensity: 1.65, sun: 0xfff6dc, sunIntensity: 2.3, sunPos: [-4, 14, 6] },
      sunset: { sky: 0xf7a35c, hemiSky: 0xffdcb0, hemiGround: 0x8a6a5a, hemiIntensity: 1.8, sun: 0xff9f55, sunIntensity: 2.6, sunPos: [-12, 5, -4] },
    },
  },
};
