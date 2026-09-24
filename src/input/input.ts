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
const DEADZONE = 0.2;

export class Input {
  private held = new Set<string>();
  private queued: ShotType | null = null;
  private padPrev: boolean[] = [];

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.held.add(e.code);
      const shot = SHOT_KEYS[e.code];
      if (shot) this.queued ??= shot;
    });
    target.addEventListener('keyup', (e) => this.held.delete(e.code));
    target.addEventListener('blur', () => this.held.clear());
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
