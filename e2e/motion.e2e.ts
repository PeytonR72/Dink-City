import { expect, test, type Page } from '@playwright/test';
import type { SimState, ShotType, Vec2, SimEvent } from '../src/sim';
interface Dink { state: SimState; mode: string; controls: string; eventLog: SimEvent[]; controller: { code: string; status: string; rtt: number | null }; newMatch(seed: number): void; advance(ticks: number, drive?: unknown): void; swing(type: ShotType, aim?: Vec2): void; }
async function start(page: Page, query = '') { await page.goto('/?play' + query); await page.waitForFunction(() => 'dink' in window); }
async function fakePhone(phone: Page, code: string) {
  await phone.goto('/controller.html?pair=' + code);
  await phone.evaluate(async pair => {
    const ws = new WebSocket('ws://localhost:8797/parties/controller/' + pair + '?role=phone');
    (window as unknown as { fake: WebSocket }).fake = ws;
    ws.onmessage = e => { const m = JSON.parse(String(e.data)); if (m.t === 'ping') ws.send(JSON.stringify({ t: 'pong', at: m.at, phoneAt: Date.now() })); };
    await new Promise<void>((resolve, reject) => { ws.onopen = () => { ws.send(JSON.stringify({ t: 'hello', version: 1 })); resolve(); }; ws.onerror = () => reject(Error('fake phone failed')); });
  }, code);
}
test('M switches mid-rally, a debug Swing wins a rally, keyboard resumes without restart', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await start(page, '&debug');
  await page.evaluate(() => { const d = (window as unknown as { dink: Dink }).dink; d.newMatch(2026); d.advance(30); });
  await page.keyboard.press('k');
  await page.waitForFunction(() => (window as unknown as { dink: Dink }).dink.state.phase === 'rally');
  await page.keyboard.press('m');
  await expect(page.locator('#controller-pairing')).toBeVisible();
  const result = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { autoContact } = await load('/src/sim/index.ts');
    const { simTuning } = await load('/src/tuning.ts');
    const d = (window as unknown as { dink: Dink }).dink;
    const idle = { move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, shot: null };
    d.swing('drive'); // Activates the explicit e2e producer; no physical-phone claim.
    let hits = 0; let won = false; const before = d.state.tick;
    for (let n = 0; n < 12000 && !won; n++) {
      const s = d.state;
      if ((s.phase === 'serve' && s.server === 0 && s.tick - s.phaseTick >= 15) || (s.phase === 'rally' && s.ball.lastHitBy === 1 && s.ball.bouncesSinceHit > 0 && autoContact(s, [idle, idle], 0, simTuning))) d.swing('drive');
      d.advance(1);
      hits += d.state.events.filter(e => e.kind === 'hit' && e.side === 0 && e.variant !== 'serve').length;
      won = d.state.events.some(e => e.kind === 'rally-won' && e.winner === 0);
    }
    return { hits, won, before, after: d.state.tick, modes: d.state.match.config.contactMode };
  });
  expect(result.hits).toBeGreaterThan(0); expect(result.won).toBe(true); expect(result.modes).toEqual(['reported', 'auto']);
  await page.keyboard.press('m'); await expect(page.locator('#control-mode')).toHaveText('KEYBOARD');
  const tick = await page.evaluate(() => (window as unknown as { dink: Dink }).dink.state.tick);
  await page.keyboard.down('d'); await page.waitForTimeout(120); await page.keyboard.up('d');
  expect(await page.evaluate(() => (window as unknown as { dink: Dink }).dink.state.tick)).toBeGreaterThanOrEqual(tick);
  expect(errors).toEqual([]);
});
test('pairing fallback, replacement, disconnect pause and keyboard recovery use the real local relay', async ({ page, browser }) => {
  await start(page); await page.keyboard.press('m');
  await expect(page.locator('.pair-qr svg')).toBeVisible();
  await page.evaluate(() => (window as unknown as { dink: Dink }).dink.advance(30));
  await page.keyboard.press('k');
  await page.waitForFunction(() => (window as unknown as { dink: Dink }).dink.state.phase === 'rally');
  const code = await page.evaluate(() => (window as unknown as { dink: Dink }).dink.controller.code);
  const context = await browser.newContext({ baseURL: 'http://localhost:5174' }); const phone = await context.newPage();
  try {
    await fakePhone(phone, code);
    await expect(page.locator('#control-mode')).toContainText('Controller connected');
    await page.waitForFunction(() => (window as unknown as { dink: Dink }).dink.controller.rtt !== null, { }, { timeout: 5000 });
    await page.locator('#control-mode').click();
    await expect(page.locator('#controller-pairing')).toBeVisible();
    await expect(page.locator('.pair-status')).toContainText('ms RTT');
    await page.locator('.pair-hide').click();
    await phone.evaluate(() => (window as unknown as { fake: WebSocket }).fake.close(1000));
    await expect(page.locator('#pause h1')).toHaveText('Controller disconnected');
    await expect(page.locator('#resume')).toBeDisabled();
    await fakePhone(phone, code);
    await expect(page.locator('#resume')).toBeEnabled();
    await page.locator('#resume').click();
    await phone.evaluate(() => (window as unknown as { fake: WebSocket }).fake.close(1000));
    await expect(page.locator('#pause')).toBeVisible();
    await page.keyboard.press('m'); await expect(page.locator('#pause')).toBeHidden();
    await expect(page.locator('#control-mode')).toHaveText('KEYBOARD');
  } finally { await context.close(); }
});
test('settings persist, pause toggle works and queued presses cannot leak across M', async ({ page }) => {
  await page.goto('/'); await page.getByRole('radio', { name: 'Motion', exact: true }).click();
  await expect(page.locator('#controller-pairing')).toBeVisible();
  await page.getByRole('button', { name: 'Use keyboard', exact: true }).click();
  await page.reload(); await expect(page.getByRole('radio', { name: 'Keyboard', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: /The Park/ }).click();
  await page.keyboard.press('Escape'); await page.locator('#pause-controls').click();
  await expect(page.locator('#pause-controls')).toContainText('MOTION');
  await page.getByRole('button', { name: 'Use keyboard', exact: true }).click();
  await page.locator('#resume').click();
  const phase = await page.evaluate(() => {
    const d = (window as unknown as { dink: Dink }).dink; d.newMatch(12); d.advance(30);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyK' }));
    d.advance(1); return d.state.phase;
  });
  expect(phase).toBe('serve');
});
test('phone rejects bad codes and supports denied permission retry without duplicate handlers', async ({ page }) => {
  await page.goto('/controller.html?pair=bad'); await expect(page.locator('#status')).toContainText('Invalid Pair code'); await expect(page.locator('#permission')).toBeDisabled();
  await page.addInitScript(() => {
    let attempts = 0;
    Object.defineProperty(DeviceMotionEvent, 'requestPermission', { configurable: true, value: async () => (++attempts === 1 ? 'denied' : 'granted') });
    Object.defineProperty(DeviceOrientationEvent, 'requestPermission', { configurable: true, value: async () => 'granted' });
  });
  await page.goto('/controller.html?pair=P-AAAAAAAAAA&debug');
  await page.locator('#permission').click(); await expect(page.locator('#status')).toContainText('permission denied');
  await page.locator('#permission').click(); await expect(page.locator('#calibrate')).toBeVisible();
  await page.locator('#ready').click(); await expect(page.locator('#status')).toContainText('No gyroscope samples');
  await page.evaluate(() => { window.dispatchEvent(new DeviceMotionEvent('devicemotion', { rotationRate: { alpha: 0, beta: 0, gamma: 0 }, acceleration: { x: 0, y: 0, z: 0 } })); });
  await page.locator('#ready').click(); await expect(page.locator('#playing')).toBeVisible();
  await expect(page.locator('#status')).toContainText('expired');
  await page.locator('#recalibrate').click(); await expect(page.locator('#calibrate')).toBeVisible(); await expect(page.locator('#playing')).toBeHidden();
});
test('phone synthetic sensors traverse calibration, relay, classification and trace download', async ({ page, browser }) => {
  await start(page, '&motion');
  const code = await page.evaluate(() => (window as unknown as { dink: Dink }).dink.controller.code);
  const context = await browser.newContext({ baseURL: 'http://localhost:5174', viewport: { width: 390, height: 844 } }); const phone = await context.newPage();
  try {
    await phone.addInitScript(() => {
      Object.defineProperty(DeviceMotionEvent, 'requestPermission', { configurable: true, value: async () => 'granted' });
      Object.defineProperty(DeviceOrientationEvent, 'requestPermission', { configurable: true, value: async () => 'granted' });
      Object.defineProperty(navigator, 'vibrate', { configurable: true, value: () => { (window as unknown as { vibrations: number }).vibrations = ((window as unknown as { vibrations?: number }).vibrations ?? 0) + 1; return true; } });
    });
    phone.on('pageerror', error => console.log('Phone error:', error.message));
    await phone.goto('/controller.html?pair=' + code + '&debug'); await phone.locator('#permission').click();
    console.log('phone permission', await phone.locator('#status').textContent());
    await phone.evaluate(() => window.dispatchEvent(new DeviceMotionEvent('devicemotion', { rotationRate: { alpha: 0, beta: 0, gamma: 0 } })));
    await phone.locator('#ready').click(); console.log('phone ready', await phone.locator('#status').textContent()); await expect(page.locator('#control-mode')).toContainText('Controller connected');
    await page.waitForFunction(() => (window as unknown as { dink: Dink }).dink.controller.rtt !== null, { }, { timeout: 5000 });
    console.log('phone RTT synchronized');
    // This flow tests a ready serve. An early press is intentionally discarded, never buffered.
    await page.waitForFunction(() => { const s = (window as unknown as { dink: Dink }).dink.state; return s.phase === 'serve' && s.server === 0 && s.tick - s.phaseTick >= 15; });
    await phone.locator('#participant').fill('synthetic-e2e'); await phone.locator('#record').click();
    await phone.evaluate(async () => { for (const speed of [0, 30, 90, 70, 0]) { window.dispatchEvent(new DeviceMotionEvent('devicemotion', { rotationRate: { alpha: speed, beta: 0, gamma: 0 } })); await new Promise(resolve => setTimeout(resolve, 25)); } });
    await expect(phone.locator('#last-swing')).toContainText('SOFT');
    await expect(phone.locator('#last-peak')).toContainText('90 deg/s');
    await expect.poll(() => page.evaluate(() => (window as unknown as { dink: Dink }).dink.eventLog.some(e => e.kind === 'hit' && e.side === 0))).toBe(true);
    await expect.poll(() => phone.evaluate(() => (window as unknown as { vibrations?: number }).vibrations ?? 0)).toBeGreaterThan(0);
    const download = phone.waitForEvent('download'); await phone.locator('#record').click(); expect((await download).suggestedFilename()).toMatch(/motion-soft-/);
    // This downloaded synthetic run is intentionally NOT saved into recorded-human fixtures.
    await phone.screenshot({ path: 'test-results/motion-phone.png', fullPage: true });
  } finally { await context.close(); }
});

test('held gamepad buttons do not turn into presses at a mode boundary; stick overrides Auto-move', async ({ page }) => {
  await page.addInitScript(() => {
    const pad = { connected: true, axes: [0, 0], buttons: Array.from({ length: 10 }, () => ({ pressed: false, value: 0 })) };
    (window as unknown as { pad: typeof pad }).pad = pad;
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad] });
  });
  await start(page, '&debug');
  await page.keyboard.press('m');
  const results = await page.evaluate(() => {
    const d = (window as unknown as { dink: Dink }).dink;
    const pad = (window as unknown as { pad: { axes: number[]; buttons: { pressed: boolean }[] } }).pad;
    d.newMatch(17); d.advance(30); d.swing('drive'); d.advance(1);
    const before = d.state.sides[0].players[0].pos.x;
    pad.axes[0] = 1; d.advance(10); const after = d.state.sides[0].players[0].pos.x;
    d.newMatch(17); d.advance(30); pad.buttons[0].pressed = true;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM' }));
    d.advance(1); const heldPhase = d.state.phase;
    pad.buttons[0].pressed = false; d.advance(1); pad.buttons[0].pressed = true; d.advance(1);
    return { before, after, heldPhase, pressedPhase: d.state.phase };
  });
  expect(results.after).toBeGreaterThan(results.before);
  expect(results.heldPhase).toBe('serve'); expect(results.pressedPhase).toBe('rally');
});
test('insecure phone contexts explain why motion is unavailable', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'isSecureContext', { value: false }));
  await page.goto('/controller.html?pair=P-AAAAAAAAAA'); await page.locator('#permission').click();
  await expect(page.locator('#status')).toContainText('Motion needs HTTPS');
});

test('online motion serves through the Court and phone loss returns to keyboard without pausing', async ({ page, browser }) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:5174', viewport: { width: 480, height: 270 } });
  const guest = await context.newPage(); const phone = await context.newPage();
  try {
    await page.goto('/'); await page.getByRole('button', { name: 'Play online' }).click();
    await page.locator('#online-name').fill('Motion Host'); await page.locator('[data-preset="quick"]').click(); await page.locator('#create-court').click();
    await expect(page.locator('#lobby .wait-status')).toHaveText(/Waiting for opponent/, { timeout: 20_000 });
    const code = await page.locator('#lobby .online-code strong').textContent();
    await guest.goto('/'); await guest.getByRole('button', { name: 'Play online' }).click(); await guest.locator('#online-name').fill('Keyboard Guest');
    await guest.locator('#join-code').fill(code!); await guest.getByRole('button', { name: 'Join', exact: true }).click();
    await page.waitForFunction(() => (window as unknown as { dink: Dink }).dink.mode === 'match');
    await guest.waitForFunction(() => (window as unknown as { dink: Dink }).dink.mode === 'match');
    await page.keyboard.press('m'); const pair = await page.evaluate(() => (window as unknown as { dink: Dink }).dink.controller.code);
    await fakePhone(phone, pair); await expect(page.locator('#control-mode')).toContainText('Controller connected');
    await page.waitForFunction(() => (window as unknown as { dink: Dink }).dink.controller.rtt !== null);
    await page.waitForFunction(() => { const s = (window as unknown as { dink: Dink }).dink.state; return s.phase === 'serve' && s.server === 0 && s.tick - s.phaseTick >= 15; });
    await page.evaluate(() => (window as unknown as { dink: Dink }).dink.swing('drive'));
    await expect.poll(() => guest.evaluate(() => (window as unknown as { dink: Dink }).dink.eventLog.some(e => e.kind === 'hit' && e.side === 0))).toBe(true);
    await phone.evaluate(() => (window as unknown as { fake: WebSocket }).fake.close(1000));
    await expect(page.locator('#control-mode')).toHaveText('KEYBOARD');
    expect(await page.evaluate(() => (window as unknown as { dink: Dink }).dink.mode)).toBe('match');
    await expect(page.locator('#pause')).toBeHidden();
  } finally { await context.close(); }
});

test('quitting ends a pairing and re-entering with saved Motion opens a fresh code', async ({ page }) => {
  await start(page, '&motion'); await expect(page.locator('#controller-pairing')).toBeVisible();
  const oldCode = await page.evaluate(() => (window as unknown as { dink: Dink }).dink.controller.code);
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Quit to map' }).click();
  await expect(page.locator('#controller-pairing')).toBeHidden();
  await page.getByRole('button', { name: /The Park/ }).click();
  await expect(page.locator('#controller-pairing')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { dink: Dink }).dink.controller.code)).not.toBe(oldCode);
});

// Freeze rendering time, then drive the same input/Sim boundary used by normal frames.
test('motion contact is immediate only: early and late swings cannot hit later', async ({ page }) => {
  await start(page, '&motion&debug');
  const result = await page.evaluate(async () => {
    const d = (window as unknown as { dink: Dink & { viewTuning: { gameSpeed: number } } }).dink;
    d.viewTuning.gameSpeed = 0;
    const setup = (z: number) => {
      d.newMatch(8); const s = d.state; s.phase = 'rally'; s.tick = 100; s.shots = 4;
      s.ball.lastHitBy = 1; s.ball.bouncesSinceHit = 1; s.ball.pos = { x: .2, y: .9, z }; s.ball.vel = { x: 0, y: 0, z: 0 };
      s.sides[0].players[0].pos = { x: 0, y: 0, z: 4 }; s.sides[0].players[0].commit = { type: 'soft', tick: 30, bestDistance: null };
    };
    const shots: number[] = [];
    for (const z of [1.5, 3.55, 5.8]) {
      setup(z); d.swing('drive'); d.advance(1); shots.push(d.state.shots);
      if (z !== 3.55) { d.state.ball.pos = { x: .2, y: .9, z: 3.55 }; d.state.ball.vel = { x: 0, y: 0, z: 0 }; d.advance(7); shots.push(d.state.shots); }
    }
    setup(3.55); d.swing('drive'); window.dispatchEvent(new Event('blur')); d.advance(1); shots.push(d.state.shots);
    return shots;
  });
  expect(result).toEqual([4, 4, 5, 4, 4, 4]);
});
