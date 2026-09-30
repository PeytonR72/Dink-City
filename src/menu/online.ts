// The menu's Online panel: the Display name, the live list of open Courts, Create Court and Join by code, then the
// wait for the Match to start. It only shows things and reports clicks; main.ts holds the sockets.
import { DEFAULT_PRESET, PRESETS, readCourtCode, validateDisplayName, type DisplayNameResult, type LobbyCourt, type PresetId } from '../net';
import { Overlay } from './menu';

type NameProblem = Extract<DisplayNameResult, { ok: false }>['reason'];

const NAME_PROBLEMS: Record<NameProblem, string> = {
  empty: 'Pick a Display name.',
  'too-long': 'Use 16 characters or fewer.',
  charset: "Use letters, numbers, spaces and - _ . ' only.",
};

export interface OnlinePanelHandlers {
  /** A valid Display name was typed. */
  name(name: string): void;
  create(preset: PresetId, name: string): void;
  join(code: string, name: string): void;
  /** Leave the waiting view (and its Court). */
  cancel(): void;
  /** Back to the menu. */
  back(): void;
}

export class OnlinePanel {
  private overlay = new Overlay(
    'lobby',
    `<h1>Play online</h1>
    <p class="online-message" role="alert"></p>
    <div class="online-list">
      <div class="online-side">
        <label class="field">
          <span class="label">Display name</span>
          <input id="online-name" type="text" maxlength="32" autocomplete="nickname" spellcheck="false" />
        </label>
        <p class="field-problem" aria-live="polite"></p>
        <h2>Create a Court</h2>
        <div class="setting"><span class="options" role="radiogroup" aria-label="Preset"></span></div>
        <button id="create-court" class="primary">Create Court</button>
        <h2>Join by code</h2>
        <form class="join-code">
          <input id="join-code" type="text" maxlength="200" autocomplete="off" spellcheck="false" placeholder="ABCDE" aria-label="Court code" />
          <button type="submit">Join</button>
        </form>
      </div>
      <div class="online-courts">
        <h2>Open Courts</h2>
        <ul class="court-list" aria-label="Open Courts"></ul>
        <p class="court-empty"></p>
      </div>
    </div>
    <div class="online-waiting">
      <p class="online-code">Court <strong></strong></p>
      <p class="wait-status" aria-live="polite"></p>
      <div class="online-link">
        <input type="text" readonly aria-label="Link to this Court" />
        <button id="copy-link" type="button">Copy link</button>
      </div>
      <button id="cancel-court">Cancel</button>
    </div>
    <button id="online-back">Back</button>`,
  );
  private preset: PresetId = DEFAULT_PRESET;
  private name: HTMLInputElement;
  private code: HTMLInputElement;

  constructor(
    name: string,
    private handlers: OnlinePanelHandlers,
  ) {
    const el = this.overlay.el;
    this.name = el.querySelector('#online-name')!;
    this.code = el.querySelector('#join-code')!;
    this.name.value = name;
    this.name.addEventListener('input', () => {
      const result = this.checkName();
      if (result.ok) handlers.name(result.name);
    });

    const presets = el.querySelector('.options')!;
    for (const id of Object.keys(PRESETS) as PresetId[]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = PRESETS[id].label;
      b.dataset.preset = id;
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => {
        this.preset = id;
        this.showPreset();
      });
      presets.append(b);
    }
    this.showPreset();

    this.overlay.on('#create-court', () => {
      const result = this.checkName();
      if (result.ok) handlers.create(this.preset, result.name);
    });
    el.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const code = readCourtCode(this.code.value);
      if (!code) return this.message('That is not a Court code. Codes are 5 letters and digits.');
      this.joinCourt(code);
    });
    this.overlay.on('#copy-link', () => {
      const link = el.querySelector<HTMLInputElement>('.online-link input')!;
      link.select();
      void navigator.clipboard?.writeText(link.value).then(
        () => (el.querySelector('#copy-link')!.textContent = 'Copied!'),
        () => {},
      );
    });
    this.overlay.on('#cancel-court', () => handlers.cancel());
    this.overlay.on('#online-back', () => handlers.back());
  }

  /**
   * The list view. `message` says what went wrong last, in plain words. `code` fills Join by code (a `?court=` link
   * opened with no saved name) and puts the focus on the name, which must be picked first.
   */
  showList(message = '', code = '') {
    this.el.dataset.view = 'list';
    this.message(message);
    if (code) this.code.value = code;
    this.checkName();
    this.overlay.show();
    this.name.focus();
    if (code) this.name.select();
  }

  /** The live list, or null while the Lobby can't be reached. */
  setCourts(courts: readonly LobbyCourt[] | null) {
    const list = this.el.querySelector('.court-list')!;
    list.replaceChildren(
      ...(courts ?? []).map((c) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'court-row';
        b.dataset.code = c.code;
        // textContent, never innerHTML: the Host's Display name comes from another Player.
        for (const [cls, text] of [['court-host', c.hostName], ['court-preset', PRESETS[c.preset].label], ['court-players', `${c.players}/2`]]) {
          const span = document.createElement('span');
          span.className = cls;
          span.textContent = text;
          b.append(span);
        }
        b.addEventListener('click', () => this.joinCourt(c.code));
        li.append(b);
        return li;
      }),
    );
    this.el.querySelector('.court-empty')!.textContent =
      courts === null ? 'Connecting to the Lobby…' : courts.length === 0 ? 'No open Courts right now. Create one!' : '';
    this.checkName();
  }

  /** The wait for the Match: `status` in words, and the Court's code and link once it has one. */
  showWaiting(status: string, code: string | null = null) {
    const el = this.el;
    el.dataset.view = 'waiting';
    el.querySelector('.wait-status')!.textContent = status;
    el.querySelector<HTMLElement>('.online-code')!.hidden = code === null;
    el.querySelector<HTMLElement>('.online-link')!.hidden = code === null;
    if (code) {
      el.querySelector('.online-code strong')!.textContent = code;
      el.querySelector<HTMLInputElement>('.online-link input')!.value = `${location.origin}${location.pathname}?court=${code}`;
      el.querySelector('#copy-link')!.textContent = 'Copy link';
    }
    this.overlay.show();
    el.querySelector<HTMLElement>('#cancel-court')!.focus();
  }

  hide() {
    this.overlay.hide();
  }

  private get el() {
    return this.overlay.el;
  }

  private joinCourt(code: string) {
    const result = this.checkName();
    if (result.ok) this.handlers.join(code, result.name);
  }

  /** Shows what's wrong with the name, if anything; Create, Join and the rows wait for a valid one. */
  private checkName(): DisplayNameResult {
    const result = validateDisplayName(this.name.value);
    this.el.querySelector('.field-problem')!.textContent = result.ok ? '' : NAME_PROBLEMS[result.reason];
    this.name.setAttribute('aria-invalid', String(!result.ok));
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('#create-court, .join-code button, .court-row')) b.disabled = !result.ok;
    return result;
  }

  private message(text: string) {
    this.el.querySelector('.online-message')!.textContent = text;
  }

  private showPreset() {
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('[data-preset]')) b.setAttribute('aria-checked', String(b.dataset.preset === this.preset));
  }
}
