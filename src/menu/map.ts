// The Dink City map: a live 3D tabletop of the city (mapView.ts) with a button pinned over each Venue, locked
// until the one before it is beaten, and a star per Difficulty beaten there.
import { DIFFICULTY } from '../bot/bot';
import { isUnlocked, type Progress } from '../save/progress';
import type { DifficultyName } from '../save/settings';
import { VENUES, VENUE_IDS, type VenueId } from '../venue/venues';
import { MapView } from './mapView';

/** Where each pin sits until the map has loaded, in percent of its width and height: about where it will point. */
const PINS: Record<VenueId, { x: number; y: number }> = {
  park: { x: 16, y: 62 },
  rooftop: { x: 50, y: 12 },
  beach: { x: 85, y: 58 },
};

export class CityMap {
  readonly el = document.createElement('div');
  private pins = new Map<VenueId, HTMLButtonElement>();
  private view = new MapView();
  /** The pin under the pointer, and the one with keyboard focus: the camera moves toward the first of them. */
  private hovered: VenueId | null = null;
  private focused: VenueId | null = null;
  /** The next focus is the menu opening, not the player moving, so it leaves the camera on the whole board. */
  private quietFocus = false;

  constructor(onPick: (id: VenueId) => void) {
    this.el.className = 'city-map';
    this.el.append(this.view.canvas);
    for (const id of VENUE_IDS) {
      const venue = VENUES[id];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pin';
      b.dataset.venue = id;
      b.style.left = `${PINS[id].x}%`;
      b.style.top = `${PINS[id].y}%`;
      b.innerHTML = `<span class="pin-name">${venue.name}</span><span class="pin-stars"></span><span class="pin-blurb"></span>`;
      b.addEventListener('click', () => {
        if (!b.classList.contains('locked')) onPick(id);
      });
      b.addEventListener('pointerenter', () => {
        this.hovered = id;
        this.aim();
      });
      b.addEventListener('pointerleave', () => {
        this.hovered = null;
        this.aim();
      });
      b.addEventListener('focus', () => {
        this.focused = this.quietFocus ? null : id;
        this.quietFocus = false;
        this.aim();
      });
      b.addEventListener('blur', () => {
        this.focused = null;
        this.aim();
      });
      this.pins.set(id, b);
      this.el.append(b);
    }
  }

  refresh(progress: Progress) {
    VENUE_IDS.forEach((id, i) => {
      const b = this.pins.get(id)!;
      const open = isUnlocked(progress, id);
      b.classList.toggle('locked', !open);
      b.setAttribute('aria-disabled', String(!open));
      b.querySelector('.pin-stars')!.innerHTML = (Object.keys(DIFFICULTY) as DifficultyName[])
        .map((d) => `<span class="${progress[id].includes(d) ? 'star won' : 'star'}" title="${d}">★</span>`)
        .join('');
      b.querySelector('.pin-blurb')!.textContent = open ? VENUES[id].blurb : `Beat ${VENUES[VENUE_IDS[i - 1]].name} to open.`;
      b.setAttribute('aria-label', `${VENUES[id].name}: ${open ? `${progress[id].length} of 3 stars` : 'locked'}`);
    });
  }

  focusFirst() {
    const first = [...this.pins.values()].find((b) => !b.classList.contains('locked'));
    this.quietFocus = first !== undefined && first !== document.activeElement;
    first?.focus();
  }

  private aim() {
    this.view.focus(this.hovered ?? this.focused);
  }

  /** Draws the map. Called every frame while the menu shows. */
  draw(dt: number) {
    this.view.draw(dt, this.pins);
  }

  /** Draw calls and triangles of the map's last frame. */
  get stats() {
    return this.view.stats;
  }
}
