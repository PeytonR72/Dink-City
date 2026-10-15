import { TouchSource, mergeManual } from './touch';
import { KeyboardInput } from './keyboard';
import { MotionSource } from './motion';
import { autoContact, type Intent, type SimState, type SideIndex, type SimTuning } from '../sim';
import type { ControlMode } from '../save/settings';
import type { Swing } from '../net/controller';

/** Run at the driver boundary, after both Intents exist (and online, after quantization). */
export function keyboardContact(s: SimState, intents: [Intent, Intent], side: SideIndex, tuning: SimTuning): Intent {
  const local = intents[side];
  if (local.contact !== undefined) return local;
  const contact = autoContact(s, intents, side, tuning);
  const commit = s.sides[side].players[0].commit;
  const recommit = contact && local.shot !== null && commit !== null && local.shot !== commit.type;
  return { ...local, contact, ...(recommit ? { recommit: true } : {}) };
}

export class Input {
  readonly touch = new TouchSource();
  readonly keyboard: KeyboardInput;
  readonly motion: MotionSource;
  mode: ControlMode = 'keyboard';
  controller = false;
  debugMotion = false;
  private context: { state: SimState; side: SideIndex } | null = null;
  constructor(tuning: SimTuning, target: Window = window) {
    this.keyboard = new KeyboardInput(target);
    this.motion = new MotionSource(tuning);
    target.addEventListener('blur', () => this.motion.clear());
  }
  setMode(mode: ControlMode) { this.mode = mode; this.clear(); }
  prepare(state: SimState, side: SideIndex) { this.context = { state, side }; }
  pausePressed() { return this.keyboard.pausePressed(); }
  clear() { this.keyboard.clear(); this.motion.clear(); this.touch.clear(); }
  reset() { this.clear(); this.motion.reset(); }
  swing(swing: Swing) { if (this.mode === 'motion') this.motion.swing(swing); }
  get manual() { return this.mode !== 'motion' || (!this.controller && !this.debugMotion) || !this.context; }
  sample(): Intent {
    const keys = this.keyboard.sample();
    if (this.manual) return mergeManual(keys, this.touch);
    this.touch.setEnabled(false);
    return this.motion.sample(this.context!.state, this.context!.side, keys, Date.now());
  }
}
