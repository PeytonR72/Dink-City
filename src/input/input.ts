// Keyboard + gamepad → Intent for the local Player. The local Player always
// appears at the bottom of the screen, so screen directions equal the local frame.
import type { Intent, ShotType } from '../sim';

const SHOT_KEYS: Record<string, ShotType> = { KeyJ: 'soft', KeyK: 'drive', KeyL: 'lob' };
// Standard gamepad layout: A / B / Y (X doubles as Drive).
const SHOT_BUTTONS: [number, ShotType][] = [
  [0, 'soft'],
  [1, 'drive'],
  [2, 'drive'],
  [3, 'lob'],
];
const PAUSE_KEYS = ['Escape', 'KeyP'];
/** Standard gamepad layout: Start. */
const PAUSE_BUTTON = 9;
const DEADZONE = 0.2;

export class Input {
  private held = new Set<string>();
  private queued: ShotType | null = null;
  private padPrev: boolean[] = [];
  private pauseQueued = false;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.held.add(e.code);
      const shot = SHOT_KEYS[e.code];
      if (shot) this.queued ??= shot;
      if (PAUSE_KEYS.includes(e.code)) this.pauseQueued = true;
    });
    target.addEventListener('keyup', (e) => this.held.delete(e.code));
    target.addEventListener('blur', () => this.held.clear());
  }

  /** A pause press (Esc, P or the gamepad's Start) since the last call. Called once per frame. */
  pausePressed(): boolean {
    const pad = navigator.getGamepads?.().find((p) => p?.connected);
    const down = pad?.buttons[PAUSE_BUTTON]?.pressed ?? false;
    if (down && !this.padPrev[PAUSE_BUTTON]) this.pauseQueued = true;
    this.padPrev[PAUSE_BUTTON] = down;
    const pressed = this.pauseQueued;
    this.pauseQueued = false;
    return pressed;
  }

  /** Drops presses made outside play (in a menu), so they don't serve or Commit. */
  clear() {
    this.queued = null;
    this.pauseQueued = false;
  }

  /** Called once per Sim Tick. Consumes at most one queued shot press. */
  sample(): Intent {
    let x = axis(this.held, ['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']);
    let y = axis(this.held, ['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']);

    const pad = navigator.getGamepads?.().find((p) => p?.connected);
    if (pad) {
      const px = pad.axes[0] ?? 0;
      const py = -(pad.axes[1] ?? 0);
      if (Math.hypot(px, py) > DEADZONE) {
        x = px;
        y = py;
      }
      for (const [index, shot] of SHOT_BUTTONS) {
        const down = pad.buttons[index]?.pressed ?? false;
        if (down && !this.padPrev[index]) this.queued ??= shot;
        this.padPrev[index] = down;
      }
    }

    const shot = this.queued;
    this.queued = null;
    const move = { x, y };
    return { move, aim: { ...move }, shot };
  }
}

function axis(held: Set<string>, pos: string[], neg: string[]): number {
  const p = pos.some((k) => held.has(k)) ? 1 : 0;
  const n = neg.some((k) => held.has(k)) ? 1 : 0;
  return p - n;
}
