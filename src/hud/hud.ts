// Plain DOM HUD: score, server, the Fault banner, and call-outs.
import type { SideIndex, SimEvent, SimState } from '../sim';
import { calloutFor } from './callout';
import { faultText, type FaultText } from './faultText';
import { reveal, revealSeconds } from './reveal';

const NAMES = ['YOU', 'BOT'] as const;
const BANNER_SECONDS = 2.2;
/** The banner lingers this long after a Replay. */
const AFTER_REPLAY_SECONDS = 0.6;
/** An emphasised banner stays up this long once it has all shown. */
const AFTER_REVEAL_SECONDS = 1.3;
const NO_BANNER: FaultText = { title: '', detail: '' };

/** An emphasised banner part-way through its reveal. */
interface Reveal {
  words: HTMLElement[];
  detail: string;
  /** Sentences added meanwhile ("Side out."), shown once the detail has typed out. */
  after: string;
  t: number;
  end: number;
}

export class Hud {
  private rows: HTMLElement[];
  private games: HTMLElement;
  private callout: HTMLElement;
  private detail: HTMLElement;
  private shoutEl: HTMLElement;
  private replayTag: HTMLElement;
  private practice: HTMLElement;
  /** A Replay is playing: the Fault banner stays up. */
  private replaying = false;
  private bannerTimer = 0;
  private sticky = false;
  private revealing: Reveal | null = null;

  constructor(
    root: HTMLElement,
    private local: SideIndex,
  ) {
    root.insertAdjacentHTML(
      'beforeend',
      `<div id="scoreboard">
        <div class="row"><span class="serve">●</span><span class="name"></span><span class="points"></span></div>
        <div class="row"><span class="serve">●</span><span class="name"></span><span class="points"></span></div>
        <div id="games"></div>
      </div>
      <div id="banner"><div id="callout"></div><div id="detail"></div><div id="replay-tag">REPLAY · J / K / L to skip</div></div>
      <div id="shout"></div>
      <div id="practice" hidden><div class="practice-step"></div><div class="practice-prompt"></div><div class="practice-reps"></div></div>`,
    );
    this.rows = [...root.querySelectorAll<HTMLElement>('#scoreboard .row')];
    this.games = root.querySelector('#games')!;
    this.callout = root.querySelector('#callout')!;
    this.detail = root.querySelector('#detail')!;
    this.shoutEl = root.querySelector('#shout')!;
    this.replayTag = root.querySelector('#replay-tag')!;
    this.practice = root.querySelector('#practice')!;
  }

  /** Local Player's row first. */
  private order(): [SideIndex, SideIndex] {
    return this.local === 0 ? [0, 1] : [1, 0];
  }

  update(s: SimState, dt: number) {
    this.order().forEach((side, row) => {
      const el = this.rows[row];
      el.querySelector('.name')!.textContent = NAMES[side === this.local ? 0 : 1];
      el.querySelector('.points')!.textContent = String(s.match.points[side]);
      el.classList.toggle('serving', s.server === side && s.match.winner === null);
    });
    const { games, config } = s.match;
    this.games.textContent = config.bestOf > 1 ? `Games ${games[this.order()[0]]}–${games[this.order()[1]]}` : '';

    // The reveal plays on through a Replay.
    if (this.revealing) this.advanceReveal(dt);
    if (this.sticky || this.replaying) return;
    this.bannerTimer -= dt;
    if (this.bannerTimer <= 0) this.show(NO_BANNER);
  }

  onEvents(s: SimState, events: readonly SimEvent[]) {
    for (const e of events) {
      const shout = calloutFor(e, this.local);
      if (shout) this.shout(shout);
      if (e.kind === 'dead') {
        this.show(faultText(e.reason, e.loser === this.local), BANNER_SECONDS);
      } else if (e.kind === 'rally-won' && e.sideOut) {
        this.appendDetail('Side out.');
      } else if (e.kind === 'game' && s.match.winner === null) {
        this.appendDetail(`${e.winner === this.local ? 'You win' : 'Bot wins'} the game. Switching ends.`);
      } else if (e.kind === 'match') {
        // Best of 3 reports Games won; a single Game reports its points.
        const tally = s.match.config.bestOf > 1 ? s.match.games : s.match.points;
        const [a, b] = this.order().map((side) => tally[side]);
        this.show({
          title: e.winner === this.local ? 'YOU WIN' : 'BOT WINS',
          detail: `${a}–${b}. Press J, K or L to play again, or Esc for the menu.`,
        });
        this.sticky = true;
      }
    }
  }

  /** Holds the Fault banner up, tagged REPLAY, while a Replay plays. */
  setReplay(on: boolean) {
    this.replaying = on;
    this.replayTag.classList.toggle('show', on);
    if (!on) this.bannerTimer = Math.max(AFTER_REPLAY_SECONDS, this.revealLeft());
  }

  reset() {
    this.sticky = false;
    this.setReplay(false);
    this.show(NO_BANNER);
    // The HUD is hidden on the map; showing it again would restart a leftover call-out's animation.
    this.shoutEl.textContent = '';
    this.shoutEl.classList.remove('pop');
  }

  /** Practice mode's panel (in place of the scoreboard), or null to hide it. */
  setPractice(p: { step: number; steps: number; title: string; prompt: string; reps: number; needed: number } | null) {
    this.practice.hidden = p === null;
    document.body.dataset.practice = String(p !== null);
    if (!p) return;
    this.practice.querySelector('.practice-step')!.textContent = `Step ${p.step} of ${p.steps} · ${p.title}`;
    this.practice.querySelector('.practice-prompt')!.textContent = p.prompt;
    this.practice.querySelector('.practice-reps')!.textContent = p.needed > 0 ? '●'.repeat(p.reps) + '○'.repeat(p.needed - p.reps) : '';
  }

  /** Shows the banner for a few seconds (Practice mode's rep outcomes). */
  banner(text: FaultText) {
    this.show(text, BANNER_SECONDS);
  }

  private show({ title, detail, emphasis }: FaultText, seconds = 0) {
    this.revealing = null;
    this.callout.textContent = title;
    this.detail.textContent = detail;
    if (emphasis) this.startReveal(title, detail);
    this.bannerTimer = Math.max(seconds, this.revealLeft());
    this.callout.parentElement!.classList.toggle('show', title !== '');
  }

  /** Pops the title's words in one at a time, then types the detail out. Presentation only, timed by frames. */
  private startReveal(title: string, detail: string) {
    this.callout.replaceChildren();
    const words = title.split(' ').map((word, i) => {
      const el = document.createElement('span');
      el.className = 'word';
      el.textContent = word;
      this.callout.append(...(i > 0 ? [' ', el] : [el]));
      return el;
    });
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const end = revealSeconds(words.length, detail.length);
    this.revealing = { words, detail, after: '', t: reduced ? end : 0, end };
    this.advanceReveal(0);
  }

  private advanceReveal(dt: number) {
    const r = this.revealing!;
    r.t += dt;
    const shown = reveal(r.words.length, r.detail.length, r.t);
    r.words.forEach((el, i) => el.classList.toggle('in', i < shown.words));
    const done = r.t >= r.end;
    this.detail.textContent = done ? `${r.detail}${r.after}` : r.detail.slice(0, shown.chars);
    if (done) this.revealing = null;
  }

  /** Seconds the banner should stay up for the reveal to finish and be read. */
  private revealLeft(): number {
    return this.revealing ? this.revealing.end - this.revealing.t + AFTER_REVEAL_SECONDS : 0;
  }

  /** Pops a call-out; restarting the CSS animation lets back-to-back call-outs replay. */
  shout(text: string) {
    this.shoutEl.textContent = text;
    this.shoutEl.classList.remove('pop');
    void this.shoutEl.offsetWidth;
    this.shoutEl.classList.add('pop');
  }

  /** Adds a sentence to the banner's detail line (a Venue unlocked, say). */
  note(text: string) {
    this.appendDetail(text);
  }

  private appendDetail(text: string) {
    if (this.revealing) this.revealing.after += ` ${text}`;
    else this.detail.textContent = `${this.detail.textContent} ${text}`.trim();
  }
}
