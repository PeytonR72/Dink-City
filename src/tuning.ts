// Every feel constant lives here. `?debug` exposes these live (see src/debug/panel.ts);
// use the panel's Export button and paste the result back into this file.
import type { SimTuning } from './sim/types';

export const simTuning: SimTuning = {
  gravity: 9.81,
  drag: 0.033,
  magnus: 0.25,
  restitution: 0.64,
  bounceFriction: 0.78,
  spinKick: 0.12,
  substeps: 4,

  playerSpeed: 5.5,
  playerAccel: 35,
  reachForward: 1.1,
  reachSide: 0.9,
  reachBack: 0.35,
  reachHeight: 2.3,
  sweetSpotSide: 0.2,
  sweetSpotForward: 0.45,
  sweetRadius: 0.45,
  edgeQuality: 0.3,
  assistRange: 0.9,
  assistSpeed: 2.5,
  footRadius: 0.12,
  moveAimError: 1.2,
  softOverhit: 1.0,
  softPerfectRadius: 0.1,
  qualityAimError: 0.8,

  commitFullFraction: 0.5,
  commitRushedFraction: 0.85,
  rushedQuality: 0.5,
  lowContactHeight: 0.3,
  lowContactQuality: 0.75,
  paceStart: 9,
  paceFull: 18,
  paceQuality: 0.6,

  dinkZone: 1.0,
  blockSpeed: 12,
  smashHeight: 1.5,
  smashSpeed: 21,

  deadTicks: 75,

  shots: {
    dink: { depth: 1.2, depthRange: 0.6, minDepth: 0.5, maxDepth: 2.0, apex: 1.2, apexPerMeter: 0.1, spin: -0.3, width: 2.2, weakApex: 0.3, weakDepth: 0 },
    drop: { depth: 1.2, depthRange: 0.6, minDepth: 0.5, maxDepth: 2.0, apex: 1.2, apexPerMeter: 0.1, spin: -0.3, width: 2.2, weakApex: 0.3, weakDepth: 0 },
    block: { depth: 1.0, depthRange: 0.4, minDepth: 0.6, maxDepth: 1.6, apex: 1.3, apexPerMeter: 0, spin: -0.2, width: 1.8, weakApex: 0.2, weakDepth: 0 },
    drive: { depth: 5.2, depthRange: 1.0, minDepth: 3.5, maxDepth: 6.3, apex: 1.15, apexPerMeter: 0.02, spin: 0.6, width: 2.4, weakApex: 0.9, weakDepth: 1.5 },
    lob: { depth: 5.6, depthRange: 0.7, minDepth: 4.5, maxDepth: 6.3, apex: 5.0, apexPerMeter: 0.05, spin: 0.2, width: 2.2, weakApex: 0, weakDepth: 0.8 },
  },
  serves: {
    soft: { depth: 4.2, depthRange: 0.8, minDepth: 2.8, maxDepth: 6.0, apex: 2.4, apexPerMeter: 0, spin: 0.1, width: 1.2, weakApex: 0, weakDepth: 0 },
    drive: { depth: 5.8, depthRange: 0.5, minDepth: 4.0, maxDepth: 6.4, apex: 1.6, apexPerMeter: 0, spin: 0.4, width: 1.2, weakApex: 0, weakDepth: 0 },
  },
};

export const viewTuning = {
  /** Global time factor. Scales real time into Sim Ticks; the Sim itself never sees it. */
  gameSpeed: 1.0,
  fov: 32,
  cameraHeight: 12.5,
  cameraDistance: 18,
  lookAtZ: 0.6,
  cameraFollowX: 0.25,
  cameraDamping: 3,
  ballScale: 2.2,
  shadowMaxHeight: 5,
  /** Ticks of ball trail (at most 16). */
  trailLength: 8,
  /** Presentation-only pause on hard hits: a Smash, or any hit leaving at least `hitStopSpeed` m/s. */
  hitStopMs: 40,
  hitStopSpeed: 16,
  /** Master volume for sound effects, 0–1. */
  volume: 0.5,
};

export type ViewTuning = typeof viewTuning;
