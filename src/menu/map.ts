// The Dink City map: a decorative SVG city with a button per Venue, locked until the one before it is beaten,
// and a star per Difficulty beaten there.
import { DIFFICULTY } from '../bot/bot';
import { isUnlocked, type Progress } from '../save/progress';
import type { DifficultyName } from '../save/settings';
import { VENUES, VENUE_IDS, type VenueId } from '../venue/venues';

/** Where each Venue sits on the map, in percent of its width and height. */
const PINS: Record<VenueId, { x: number; y: number }> = {
  park: { x: 22, y: 64 },
  rooftop: { x: 52, y: 30 },
  beach: { x: 80, y: 68 },
};

const CITY_SVG = `<svg viewBox="0 0 800 450" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <rect width="800" height="450" fill="#f2e2c4"/>
  <path d="M560 450 C600 360 700 330 800 300 L800 450 Z" fill="#6fc6e8"/>
  <path d="M580 450 C615 375 705 350 800 322" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity="0.6"/>
  <path d="M548 450 C590 355 690 322 800 290" fill="none" stroke="#e8d3a0" stroke-width="22"/>
  <ellipse cx="170" cy="300" rx="150" ry="105" fill="#7cc05a"/>
  <ellipse cx="190" cy="320" rx="90" ry="55" fill="#69ad4c"/>
  <circle cx="110" cy="260" r="22" fill="#4f9e3f"/><circle cx="240" cy="250" r="18" fill="#4f9e3f"/><circle cx="90" cy="340" r="20" fill="#6dbb4a"/>
  <circle cx="265" cy="355" r="16" fill="#4f9e3f"/><circle cx="140" cy="380" r="14" fill="#e0a13a"/>
  <g fill="#c9c1b3">
    <rect x="330" y="40" width="70" height="90" rx="6"/><rect x="410" y="20" width="60" height="110" rx="6"/>
    <rect x="480" y="55" width="80" height="75" rx="6"/><rect x="570" y="35" width="55" height="95" rx="6"/>
    <rect x="345" y="150" width="60" height="55" rx="6"/><rect x="560" y="150" width="70" height="60" rx="6"/>
  </g>
  <g fill="#8fd3ff" opacity="0.8">
    <rect x="342" y="52" width="14" height="10"/><rect x="372" y="52" width="14" height="10"/><rect x="342" y="74" width="14" height="10"/>
    <rect x="422" y="34" width="12" height="10"/><rect x="446" y="34" width="12" height="10"/><rect x="422" y="58" width="12" height="10"/>
    <rect x="494" y="68" width="16" height="10"/><rect x="528" y="68" width="16" height="10"/><rect x="582" y="48" width="12" height="10"/>
  </g>
  <path d="M0 215 H800 M300 0 V450 M660 0 V260" stroke="#fff" stroke-width="16" opacity="0.8"/>
  <path d="M176 288 C260 180 330 140 416 135 C520 130 560 190 600 250 C620 280 630 290 640 306" fill="none" stroke="#ff7a3d" stroke-width="5" stroke-dasharray="4 12" stroke-linecap="round"/>
</svg>`;

export class CityMap {
  readonly el = document.createElement('div');
  private pins = new Map<VenueId, HTMLButtonElement>();

  constructor(onPick: (id: VenueId) => void) {
    this.el.className = 'city-map';
    this.el.innerHTML = CITY_SVG;
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
    [...this.pins.values()].find((b) => !b.classList.contains('locked'))?.focus();
  }
}
