import qrcode from 'qrcode-generator';
import type { ScreenController } from './screen';
export class PairingPanel {
  readonly el = document.createElement('aside');
  private code = '';
  private manualLabel = '';
  constructor(private controller: ScreenController, keyboard: () => void, private changed: () => void = () => {}) {
    this.el.id = 'controller-pairing'; this.el.hidden = true;
    this.el.setAttribute('aria-label', 'Pair phone controller');
    this.el.innerHTML = '<h2>Pair your phone</h2><p>Scan with your phone, enable motion, then hold it like a paddle.</p><div class="pair-qr"></div><a class="pair-link" target="_blank" rel="noopener"></a><p class="pair-status" aria-live="polite"></p><p class="pair-fallback">Keyboard still works until a phone connects. M switches controls.</p><button class="pair-retry">New pair code</button><button class="pair-keyboard">Use keyboard</button><button class="pair-hide">Hide panel</button>';
    this.el.querySelector('.pair-keyboard')!.addEventListener('click', keyboard);
    this.el.querySelector('.pair-hide')!.addEventListener('click', () => { this.el.hidden = true; this.changed(); });
    this.el.querySelector('.pair-retry')!.addEventListener('click', () => { controller.restart(); this.show(); });
    document.body.append(this.el);
  }
  show() { this.el.hidden = false; this.refresh(); this.changed(); }
  setManualLabel(label: string) {
    if (label === this.manualLabel) return;
    this.manualLabel = label;
    this.el.querySelector('.pair-keyboard')!.textContent = 'Use ' + (label === 'Keyboard' ? 'keyboard' : label);
    this.el.querySelector('.pair-fallback')!.textContent = label + ' still works until a phone connects. M switches controls.';
  }
  refresh() {
    const c = this.controller;
    if (c.code && c.code !== this.code) {
      this.code = c.code;
      const url = new URL('controller.html', location.href); url.search = ''; url.searchParams.set('pair', c.code);
      const qr = qrcode(0, 'M'); qr.addData(url.href); qr.make();
      this.el.querySelector('.pair-qr')!.innerHTML = qr.createSvgTag({ scalable: true, margin: 4 });
      const link = this.el.querySelector<HTMLAnchorElement>('.pair-link')!; link.href = url.href; link.textContent = c.code;
    }
    this.el.querySelector('.pair-status')!.textContent = c.status === 'connected' ? 'Controller connected · ' + (c.rtt === null ? 'measuring RTT' : Math.round(c.rtt) + ' ms RTT') : c.status === 'error' ? 'Relay unavailable. Check the dev setup, then try a new code.' : c.status === 'disconnected' ? 'Controller disconnected. Reconnect the phone or create a new code.' : 'Waiting for phone';
  }
}
