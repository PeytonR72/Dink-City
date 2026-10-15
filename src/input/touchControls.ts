import { TouchSource } from './touch';
import type { ShotType } from '../sim';

/** One capability policy governs both hit targets and input acceptance. */
export class TouchControls {
  readonly el = document.createElement('div');
  readonly media = matchMedia('(pointer: coarse) and (hover: none)');
  eligible = false;
  private stick: HTMLElement;
  private thumb: HTMLElement;
  private actions: HTMLElement;
  private menu: HTMLButtonElement;
  private owners = new Map<number, HTMLElement>();
  private cleanup: (() => void)[] = [];
  private center = { x: 0, y: 0, radius: 36 };
  constructor(readonly source: TouchSource, menu: () => void, changed: () => void) {
    this.el.id = 'touch-controls';
    this.el.innerHTML = '<div id="touch-stick" role="group" aria-label="Move and aim" aria-description="Drag to move and aim. Release to center."><span class="touch-caption">Move &amp; aim</span><span class="touch-thumb"></span></div><div id="touch-shots"><button type="button" data-shot="lob">Lob</button><button type="button" data-shot="soft">Dink</button><button type="button" data-shot="drive">Hit</button></div><button type="button" id="touch-menu">Menu</button>';
    this.stick = this.el.querySelector('#touch-stick')!;
    this.thumb = this.el.querySelector('.touch-thumb')!;
    this.actions = this.el.querySelector('#touch-shots')!;
    this.menu = this.el.querySelector('#touch-menu')!;
    this.menu.onclick = menu;
    this.source.onClear = () => {
      const owners = [...this.owners]; this.owners.clear();
      for (const [id, el] of owners) { el.classList.remove('pressed'); if (el.hasPointerCapture(id)) el.releasePointerCapture(id); }
      this.thumb.style.transform = '';
    };
    const listen = (target: EventTarget, type: string, fn: EventListener) => {
      target.addEventListener(type, fn); this.cleanup.push(() => target.removeEventListener(type, fn));
    };
    for (const target of [this.stick, ...this.actions.querySelectorAll('button')]) {
      listen(target, 'pointerdown', ((e: PointerEvent) => {
        if (e.button !== 0 || !this.source.enabled) return;
        const stick = target === this.stick;
        if (!(stick ? source.startJoystick(e.pointerId) : source.press(e.pointerId, (target as HTMLElement).dataset.shot as ShotType))) return;
        e.preventDefault(); this.owners.set(e.pointerId, target); target.setPointerCapture(e.pointerId); target.classList.add('pressed');
        if (stick) {
          const rect = target.getBoundingClientRect();
          this.center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, radius: rect.width <= 112 ? 32 : 36 };
          this.drag(e);
        }
      }) as EventListener);
      listen(target, 'pointermove', ((e: PointerEvent) => { if (this.owners.get(e.pointerId) === this.stick) { e.preventDefault(); this.drag(e); } }) as EventListener);
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(target, type, ((e: PointerEvent) => {
        if (this.owners.get(e.pointerId) !== target) return;
        this.owners.delete(e.pointerId); source.release(e.pointerId, type !== 'pointerup');
        if (![...this.owners.values()].includes(target)) target.classList.remove('pressed');
        if (target === this.stick) this.thumb.style.transform = '';
        if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
      }) as EventListener);
      if (target !== this.stick) listen(target, 'click', ((e: MouseEvent) => {
        // Pointer compatibility clicks have detail > 0; keyboard/AT activation has detail 0.
        if (e.detail === 0 && source.press(-1, (target as HTMLElement).dataset.shot as ShotType)) source.release(-1);
      }) as EventListener);
    }
    const resize = () => { source.clear(); this.viewport(); };
    for (const type of ['blur', 'pagehide', 'resize', 'orientationchange']) listen(window, type, resize);
    listen(document, 'visibilitychange', () => { if (document.hidden) source.clear(); });
    if (window.visualViewport) {
      listen(window.visualViewport, 'resize', resize);
      listen(window.visualViewport, 'scroll', resize);
    }
    const capability = () => {
      source.clear(); this.eligible = navigator.maxTouchPoints > 0 && this.media.matches;
      document.body.toggleAttribute('data-mobile-controls', this.eligible);
      if (this.eligible) document.body.append(this.el); else this.el.remove();
      changed();
    };
    listen(this.media, 'change', capability);
    this.eligible = navigator.maxTouchPoints > 0 && this.media.matches;
    document.body.toggleAttribute('data-mobile-controls', this.eligible);
    if (this.eligible) document.body.append(this.el);
    this.viewport(); this.update(false, false);
  }
  private viewport() {
    const v = window.visualViewport;
    const bottom = Math.max(0, window.innerHeight - (v ? v.offsetTop + v.height : window.innerHeight));
    document.body.style.setProperty('--touch-bottom', bottom + 'px');
    document.body.style.setProperty('--touch-top', (v?.offsetTop ?? 0) + 'px');
  }
  private drag(e: PointerEvent) {
    const dx = e.clientX - this.center.x, dy = e.clientY - this.center.y, r = this.center.radius;
    this.source.drag(e.pointerId, dx, dy, r);
    const scale = Math.min(1, r / (Math.hypot(dx, dy) || 1));
    this.thumb.style.transform = 'translate(' + dx * scale + 'px,' + dy * scale + 'px)';
  }
  update(play: boolean, menu: boolean) {
    const enabled = this.eligible && play;
    this.source.setEnabled(enabled);
    this.stick.hidden = this.actions.hidden = !enabled;
    this.menu.hidden = !(this.eligible && menu);
  }
  dispose() { this.source.clear(); this.source.onClear = null; this.source.setEnabled(false); this.cleanup.forEach(fn => fn()); this.el.remove(); document.body.removeAttribute('data-mobile-controls'); document.body.removeAttribute('data-touch-manual'); }
}
