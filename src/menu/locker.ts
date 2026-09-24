// The locker: palette swatches for each customizable part, with a live 3D preview.
import type { PlayerColors, PlayerParts } from '../render/models';
import { Preview } from '../render/preview';
import { CUSTOM_PARTS } from '../save/colors';
import { Overlay } from './menu';

type Part = (typeof CUSTOM_PARTS)[number];

const SWATCHES: Record<Part, string[]> = {
  shirt: ['#ff7a3d', '#e8474c', '#8a5cf6', '#2ec4b6', '#3aa0e8', '#ffd23f', '#4f9e3f', '#f4f1ea'],
  shorts: ['#2b3240', '#1d1d24', '#f4f1ea', '#3f5fa8', '#7a4a2b', '#4f9e3f', '#e8474c', '#ff7eb0'],
  paddle: ['#e8474c', '#3aa0e8', '#ffd23f', '#2ec4b6', '#8a5cf6', '#ff7a3d', '#1d2433', '#f4f1ea'],
  skin: ['#ffd9c0', '#f2c29b', '#e6b08a', '#d9a07a', '#c68a5e', '#8d5a3b', '#6b4128', '#4a2f22'],
  hair: ['#4a2f1f', '#1d1d24', '#b5452a', '#e0a13a', '#f4d27a', '#8a8a8a', '#f4f1ea', '#ff7eb0'],
};

const LABELS: Record<Part, string> = { shirt: 'Shirt', shorts: 'Shorts', paddle: 'Paddle', skin: 'Skin', hair: 'Hair' };

export class Locker {
  readonly overlay: Overlay;
  private preview: Preview | null = null;

  constructor(
    private parts: PlayerParts,
    private colors: PlayerColors,
    private onChange: (colors: PlayerColors) => void,
    onDone: () => void,
  ) {
    this.overlay = new Overlay(
      'locker',
      `<h1>Locker</h1>
      <div class="locker-body">
        <canvas class="locker-preview" aria-label="Your player"></canvas>
        <div class="swatches"></div>
      </div>
      <button id="locker-done" class="primary">Done</button>`,
    );
    const rows = this.overlay.el.querySelector('.swatches')!;
    for (const part of CUSTOM_PARTS) {
      const row = document.createElement('div');
      row.className = 'setting';
      row.innerHTML = `<span class="label">${LABELS[part]}</span><span class="options" role="radiogroup" aria-label="${LABELS[part]}"></span>`;
      for (const color of SWATCHES[part]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'swatch';
        b.style.background = color;
        b.dataset.part = part;
        b.dataset.color = color;
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-label', color);
        b.addEventListener('click', () => this.pick(part, color));
        row.querySelector('.options')!.append(b);
      }
      rows.append(row);
    }
    this.overlay.on('#locker-done', onDone);
    this.refresh();
  }

  show() {
    this.overlay.show();
    this.preview ??= new Preview(this.overlay.el.querySelector('canvas')!, this.parts, this.colors);
    this.preview.start();
  }

  hide() {
    this.overlay.hide();
    this.preview?.stop();
  }

  private pick(part: Part, color: string) {
    this.colors = { ...this.colors, [part]: color };
    this.preview?.setColors(this.colors);
    this.refresh();
    this.onChange(this.colors);
  }

  private refresh() {
    for (const b of this.overlay.el.querySelectorAll<HTMLElement>('.swatch')) {
      b.setAttribute('aria-checked', String(this.colors[b.dataset.part as Part].toLowerCase() === b.dataset.color));
    }
  }
}
