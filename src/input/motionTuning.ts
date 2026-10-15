// Client-only tuning: deliberately absent from simTuning and simHash.
export const motionTuning = {
  swingWindowTicks: 6,
  swingLeadMs: 0,
  maxSwingAgeMs: 400,
  peakThreshold: 100,
  driveThreshold: 330,
  lobPitchDegrees: 22,
  aimDegrees: 45,
  cooldownMs: 400,
  sampleWindowMs: 240,
  peakFallRatio: 0.65,
  settleRatio: 0.5,
  tiltIntervalMs: 50,
  autoMoveSpeed: 0.9,
  autoCommitReactionTicks: 14,
};
export type MotionTuning = typeof motionTuning;
