// Plain DOM HUD: score, server, the Fault banner, and call-outs.
import type { SideIndex, SimEvent, SimState } from '../sim';
import { calloutFor } from './callout';
import { faultText } from './faultText';

const NAMES = ['YOU', 'BOT'] as const;
const BANNER_SECONDS = 2.2;
/** The banner lingers this long after a Replay. */
const AFTER_REPLAY_SECONDS = 0.6;

export class Hud {
  private rows: HTMLElement[];
  private games: HTMLElement;
  private callout: HTMLElement;
  private detail: HTMLElement;
  private shoutEl: HTMLElement;
  private replayTag: HTMLElement;
  /** A Replay is playing: the Fault banner stays up. */
  private replaying = false;
  private bannerTimer = 0;
  private sticky = false;

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
      <div id="shout"></div>`,
    );
    this.rows = [...root.querySelectorAll<HTMLElement>('#scoreboard .row')];
    this.games = root.querySelector('#games')!;
    this.callout = root.querySelector('#callout')!;
    this.detail = root.querySelector('#detail')!;
    this.shoutEl = root.querySelector('#shout')!;
    this.replayTag = root.querySelector('#replay-tag')!;
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

    if (this.sticky || this.replaying) return;
    this.bannerTimer -= dt;
    if (this.bannerTimer <= 0) this.show('', '');
  }

  onEvents(s: SimState, events: readonly SimEvent[]) {
    for (const e of events) {
      const shout = calloutFor(e, this.local);
      if (shout) this.shout(shout);
      if (e.kind === 'dead') {
        const { title, detail } = faultText(e.reason, e.loser === this.local);
        this.show(title, detail, BANNER_SECONDS);
      } else if (e.kind === 'rally-won' && e.sideOut) {
        this.appendDetail('Side out.');
      } else if (e.kind === 'game' && s.match.winner === null) {
        this.appendDetail(`${e.winner === this.local ? 'You win' : 'Bot wins'} the game. Switching ends.`);
      } else if (e.kind === 'match') {
        // Best of 3 reports Games won; a single Game reports its points.
        const tally = s.match.config.bestOf > 1 ? s.match.games : s.match.points;
        const [a, b] = this.order().map((side) => tally[side]);
        this.show(e.winner === this.local ? 'YOU WIN' : 'BOT WINS', `${a}–${b}. Press J, K or L to play again, or Esc for the menu.`);
        this.sticky = true;
      }
    }
  }

  /** Holds the Fault banner up, tagged REPLAY, while a Replay plays. */
  setReplay(on: boolean) {
    this.replaying = on;
    this.replayTag.classList.toggle('show', on);
    if (!on) this.bannerTimer = AFTER_REPLAY_SECONDS;
  }

  reset() {
    this.sticky = false;
    this.setReplay(false);
    this.show('', '');
  }

  private show(title: string, detail: string, seconds = 0) {
    this.callout.textContent = title;
    this.detail.textContent = detail;
    this.bannerTimer = seconds;
    this.callout.parentElement!.classList.toggle('show', title !== '');
  }

  /** Pops a call-out; restarting the CSS animation lets back-to-back call-outs replay. */
  private shout(text: string) {
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
    this.detail.textContent = `${this.detail.textContent} ${text}`.trim();
  }
}
