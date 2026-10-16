// Client-only tuning: deliberately absent from simTuning and simHash.
export const motionTuning = {
  maxSwingAgeMs: 400,
  peakThreshold: 85,
  driveThreshold: 330,
  lobPitchDegrees: 22,
  aimDegrees: 45,
  cooldownMs: 400,
  sampleWindowMs: 240,
  peakFallRatio: 0.8,
  settleRatio: 0.5,
  tiltIntervalMs: 50,
  autoMoveSpeed: 0.9,
  autoCommitReactionTicks: 14,
};
export type MotionTuning = typeof motionTuning;
