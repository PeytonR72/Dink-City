// Plain DOM menus over the canvas: the start menu with its Settings panel, and the pause menu.
import type { Settings } from '../save/settings';

interface Choice<K extends keyof Settings> {
  key: K;
  label: string;
  options: [Settings[K], string][];
}

const CHOICES = [
  { key: 'rallyScoring', label: 'Scoring', options: [[false, 'Side-out'], [true, 'Rally']] },
  { key: 'bestOf', label: 'Match', options: [[1, 'One game'], [3, 'Best of 3']] },
  { key: 'difficulty', label: 'Bot', options: [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']] },
  { key: 'sunset', label: 'Light', options: [[false, 'Day'], [true, 'Sunset']] },
] satisfies Choice<keyof Settings>[];

/** A row of toggle buttons for each setting. Calls `onChange` with the new settings on every click. */
export class SettingsPanel {
  readonly el = document.createElement('div');

  constructor(
    private settings: Settings,
    private onChange: (s: Settings) => void,
  ) {
    this.el.className = 'settings';
    for (const choice of CHOICES as Choice<keyof Settings>[]) {
      const row = document.createElement('div');
      row.className = 'setting';
      row.innerHTML = `<span class="label">${choice.label}</span><span class="options" role="radiogroup" aria-label="${choice.label}"></span>`;
      for (const [value, text] of choice.options) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = text;
        b.setAttribute('role', 'radio');
        b.addEventListener('click', () => {
          this.settings = { ...this.settings, [choice.key]: value };
          this.refresh();
          this.onChange(this.settings);
        });
        row.querySelector('.options')!.append(b);
      }
      this.el.append(row);
    }
    this.refresh();
  }

  private refresh() {
    (CHOICES as Choice<keyof Settings>[]).forEach((choice, i) => {
      const buttons = this.el.children[i].querySelectorAll('button');
      choice.options.forEach(([value], j) => buttons[j].setAttribute('aria-checked', String(this.settings[choice.key] === value)));
    });
  }
}

/** A full-screen overlay panel that can be shown and hidden. */
export class Overlay {
  readonly el = document.createElement('div');

  constructor(id: string, html: string) {
    this.el.id = id;
    this.el.className = 'overlay';
    this.el.innerHTML = html;
    this.el.hidden = true;
    document.body.append(this.el);
  }

  get shown() {
    return !this.el.hidden;
  }

  show() {
    this.el.hidden = false;
    this.el.querySelector<HTMLElement>('[autofocus], button')?.focus();
  }

  hide() {
    this.el.hidden = true;
  }

  on(selector: string, handler: () => void) {
    this.el.querySelector(selector)!.addEventListener('click', handler);
  }
}
