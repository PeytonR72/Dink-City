import type { Intent, ShotType, Vec2 } from '../sim';

/** Screen-local displacement: up is positive y. Match the gamepad's raw deadzone. */
export function joystickVector(dx: number, dy: number, radius: number): Vec2 {
  const length = Math.hypot(dx, dy) / radius;
  if (length <= 0.2) return { x: 0, y: 0 };
  const divisor = radius * Math.max(1, length);
  return { x: dx / divisor, y: -dy / divisor };
}

/** No clocks or Sim dependencies: each accepted down belongs to one gesture. */
export class TouchSource {
  enabled = false;
  joystick: number | null = null;
  private move = { x: 0, y: 0 };
  private shots = new Set<number>();
  private pending: { owner: number; shot: ShotType } | null = null;
  onClear: (() => void) | null = null;

  setEnabled(on: boolean) { if (this.enabled !== on) { this.clear(); this.enabled = on; } }
  startJoystick(id: number) {
    if (!this.enabled || this.joystick !== null || this.shots.has(id)) return false;
    this.joystick = id; return true;
  }
  drag(id: number, dx: number, dy: number, radius: number) {
    if (this.joystick === id) this.move = joystickVector(dx, dy, radius);
  }
  press(id: number, shot: ShotType) {
    if (!this.enabled || this.shots.has(id) || this.joystick === id) return false;
    this.shots.add(id); this.pending ??= { owner: id, shot }; return true;
  }
  release(id: number, cancel = false) {
    if (this.joystick === id) { this.joystick = null; this.move = { x: 0, y: 0 }; }
    this.shots.delete(id);
    if (cancel && this.pending?.owner === id) this.pending = null;
  }
  clear() {
    this.joystick = null; this.move = { x: 0, y: 0 }; this.shots.clear(); this.pending = null;
    this.onClear?.();
  }
  sample(): Intent {
    const shot = this.enabled ? this.pending?.shot ?? null : null;
    this.pending = null;
    const move = this.enabled ? { ...this.move } : { x: 0, y: 0 };
    return { move, aim: { ...move }, shot };
  }
}

export function mergeManual(keys: Intent, touch: TouchSource): Intent {
  if (!touch.enabled) return keys;
  const owned = touch.joystick !== null;
  const intent = touch.sample();
  return { move: owned ? intent.move : keys.move, aim: owned ? intent.aim : keys.aim, shot: keys.shot ?? intent.shot };
}
