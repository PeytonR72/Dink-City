import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

// The Online panel, then two browsers playing through a Court on the `wrangler dev` that playwright.config.ts starts.
// The Display-name gate's rule is unit-tested in test/onlineGate.test.ts.

test('online play is offered in dev, and the panel opens with a guest name', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play online' }).click();
  await expect(page.locator('#lobby')).toBeVisible();
  await expect(page.locator('#online-name')).toHaveValue(/^Guest \d{4}$/);
  await expect(page.locator('#create-court')).toBeEnabled();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('#lobby')).toBeHidden();
  await expect(page.locator('#menu')).toBeVisible();
});

test('the Display name is checked as it is typed, and saved when valid', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play online' }).click();
  const name = page.locator('#online-name');
  const problem = page.locator('#lobby .field-problem');

  await name.fill('   ');
  await expect(problem).toHaveText('Pick a Display name.');
  await expect(page.locator('#create-court')).toBeDisabled();

  await name.fill('Ana the Magnificent');
  await expect(problem).toHaveText('Use 16 characters or fewer.');

  await name.fill('Ana<3');
  await expect(problem).toHaveText("Use letters, numbers, spaces and - _ . ' only.");
  await expect(page.locator('#create-court')).toBeDisabled();

  await name.fill('  Ana  Bea ');
  await expect(problem).toHaveText('');
  await expect(page.locator('#create-court')).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem('dink.name'))).toBe('"Ana Bea"');

  // Typing a name isn't play: P would otherwise pause, and Esc would leave the panel.
  await name.fill('');
  await name.pressSequentially('Pip');
  await expect(page.locator('#lobby')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Play online' }).click();
  await expect(name).toHaveValue('Pip');
});

test('a code that is not a Court code is refused before connecting', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play online' }).click();
  await page.locator('#join-code').fill('HELLO0');
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page.locator('#lobby .online-message')).toHaveText('That is not a Court code. Codes are 5 letters and digits.');
});

/** The slice of `window.dink` these tests read and set. */
interface Dink {
  mode: string;
  state: {
    tick: number;
    phase: string;
    server: number;
    match: { points: [number, number]; winner: number | null };
    ball: { lastHitBy: number | null; bouncesSinceHit: number };
    sides: [{ players: [{ pos: { z: number } }] }, { players: [{ pos: { z: number } }] }];
  };
  replay: unknown;
  online: { side: number } | null;
  drive: ((s: Dink['state']) => unknown) | null;
}

/** What `watchBanner` has seen on a screen: each text the Fault banner showed, and whether REPLAY ever showed. */
interface BannerSeen {
  texts: string[];
  replay: boolean;
}

/** The screens this test opened. Closed after it, or they would go on drawing through the tests that follow. */
const screens: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(screens.splice(0).map((context) => context.close()));
});

/** A screen of its own: a small one, since two draw at once on SwiftShader and nothing here looks at pixels. */
async function screen(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 480, height: 270 } });
  screens.push(context);
  return context.newPage();
}

/** How long to wait on the server. Under load, `wrangler dev` has taken 7 s to answer a `/create`. */
const SERVER_WAIT = { timeout: 20_000 };

/** A Display name no other test or earlier run has listed. */
function uniqueName(prefix: string): string {
  return `${prefix} ${Math.floor(Math.random() * 1e6)}`;
}

/** Opens the Online panel and types `name` as the Display name. */
async function openOnline(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play online' }).click();
  await page.locator('#online-name').fill(name);
}

/** Creates a Court on `preset` from the Online panel as `name`, and returns its code once the Court has seated us. */
async function createCourt(page: Page, name: string, preset: 'quick' | 'standard' | 'long'): Promise<string> {
  await openOnline(page, name);
  await page.locator(`[data-preset="${preset}"]`).click();
  await page.locator('#create-court').click();
  await expect(page.locator('#lobby .wait-status')).toHaveText('Waiting for opponent…', SERVER_WAIT);
  return (await page.locator('#lobby .online-code strong').textContent())!;
}

/** Waits until the Match is on this screen, and returns the Side it plays. */
async function inMatch(page: Page): Promise<number> {
  await expect.poll(() => page.evaluate(() => (window as unknown as { dink?: Dink }).dink?.mode), SERVER_WAIT).toBe('match');
  return page.evaluate(() => (window as unknown as { dink: Dink }).dink.online!.side);
}

/**
 * Drives this screen's Player through `dink.drive`. Serving, it serves a Drive as soon as it may, while fewer than
 * `upTo` points have been played. Receiving, it stands still and lets the ball bounce twice, so the server wins each
 * point; or, with `volley`, it steps in to 4 m from the net and swings at the Serve before it bounces, a Two-bounce
 * Fault. (In the Sim with the auto Contact rule, that is a Fault for every seed tried.)
 */
async function play(page: Page, upTo: number, volley = false) {
  await page.evaluate(
    ({ upTo, volley }) => {
      const dink = (window as unknown as { dink: Dink }).dink;
      const side = dink.online!.side;
      dink.drive = (s) => {
        const still = { x: 0, y: 0 };
        if (s.server === side) {
          return { move: still, aim: still, shot: s.phase === 'serve' && s.match.points[0] + s.match.points[1] < upTo ? 'drive' : null };
        }
        if (!volley) return { move: still, aim: still, shot: null };
        const incoming = s.phase === 'rally' && s.ball.lastHitBy !== side && s.ball.bouncesSinceHit === 0;
        const forward = Math.abs(s.sides[side].players[0].pos.z) > 4 ? 1 : 0;
        return { move: { x: 0, y: forward }, aim: still, shot: incoming ? 'drive' : null };
      };
    },
    { upTo, volley },
  );
}

/**
 * Records what this screen's Fault banner says, as it changes, and whether its REPLAY tag ever shows. The banner is up
 * for a few seconds only, so the other screen's checks can't be relied on to catch it there.
 */
async function watchBanner(page: Page) {
  await page.evaluate(() => {
    const seen: BannerSeen = { texts: [], replay: false };
    (window as unknown as { banner: BannerSeen }).banner = seen;
    const banner = document.querySelector('#banner')!;
    new MutationObserver(() => {
      const text = `${banner.querySelector('#callout')!.textContent} | ${banner.querySelector('#detail')!.textContent}`;
      if (seen.texts.at(-1) !== text) seen.texts.push(text);
      seen.replay ||= banner.querySelector('#replay-tag')!.classList.contains('show');
    }).observe(banner, { subtree: true, childList: true, characterData: true, attributes: true });
  });
}

/** What `watchBanner` has seen on this screen. */
function bannerSeen(page: Page): Promise<BannerSeen> {
  return page.evaluate(() => (window as unknown as { banner: BannerSeen }).banner);
}

/** The score as this screen draws it, by Side. */
function points(page: Page): Promise<[number, number]> {
  return page.evaluate(() => (window as unknown as { dink: Dink }).dink.state.match.points);
}

test('two screens create, list, join and play a Quick Match, then rematch', async ({ browser }) => {
  // A whole Quick Match: 11 points at about 3.5 s each.
  test.setTimeout(90_000);
  const host = await screen(browser);
  const guest = await screen(browser);
  const hostName = uniqueName('Hosty');
  const guestName = uniqueName('Guesty');

  await createCourt(host, hostName, 'quick');
  await openOnline(guest, guestName);
  const row = guest.locator('.court-row', { hasText: hostName });
  await expect(row).toContainText('Quick', SERVER_WAIT);
  await expect(row).toContainText('1/2');
  await row.click();
  expect(await inMatch(host)).toBe(0);
  expect(await inMatch(guest)).toBe(1);
  await expect(host.locator('#scoreboard .name').nth(1)).toHaveText(guestName.toUpperCase());
  await expect(guest.locator('#scoreboard .name').nth(1)).toHaveText(hostName.toUpperCase());

  // One point, ended by the receiver's Fault: both screens show the Fault banner with no Fault Replay, as online play
  // has none, and agree on the score.
  for (const page of [host, guest]) await watchBanner(page);
  for (const page of [host, guest]) await play(page, 1, true);
  await expect.poll(() => points(host).then(([a, b]) => a + b), { timeout: 15_000 }).toBe(1);
  const score = await points(host);
  await expect.poll(() => points(guest)).toEqual(score);
  for (const page of [host, guest]) {
    await expect.poll(async () => (await bannerSeen(page)).texts.some((t) => /^TWO-BOUNCE FAULT \| \w+ volleyed too early\./.test(t))).toBe(true);
    expect((await bannerSeen(page)).replay).toBe(false);
    expect(await page.evaluate(() => (window as unknown as { dink: Dink }).dink.replay)).toBeNull();
  }
  // Each screen lists its own Player first.
  await expect(host.locator('#scoreboard .points')).toHaveText(score.map(String));
  await expect(guest.locator('#scoreboard .points')).toHaveText([...score].reverse().map(String));

  // The rest of the Match, then a rematch: the Court starts a new Match once both have asked.
  for (const page of [host, guest]) await play(page, Infinity);
  for (const page of [host, guest]) await expect(page.locator('#online-over')).toBeVisible({ timeout: 75_000 });
  const final = await points(host);
  expect(await points(guest)).toEqual(final);
  expect(Math.max(...final)).toBe(11);
  await host.locator('#rematch').click();
  await expect(host.locator('#online-over .rematch-status')).toHaveText(`Waiting for ${guestName}…`);
  await expect(host.locator('#rematch')).toBeDisabled();
  await expect(guest.locator('#online-over .rematch-status')).toHaveText(`${hostName} wants a rematch`);
  await guest.locator('#rematch').click();
  for (const page of [host, guest]) {
    await expect(page.locator('#online-over')).toBeHidden();
    await expect.poll(() => page.evaluate(() => (window as unknown as { dink: Dink }).dink.state.match)).toMatchObject({ points: [0, 0], winner: null });
  }
});

test('a Court link joins it, and a reload rejoins the same seat', async ({ browser }) => {
  const host = await screen(browser);
  const guest = await screen(browser);
  const code = await createCourt(host, uniqueName('Hosty'), 'standard');
  // With a saved name, the link joins straight away.
  const guestName = uniqueName('Linky');
  await guest.addInitScript((name) => localStorage.setItem('dink.name', JSON.stringify(name)), guestName);
  await guest.goto(`/?court=${code}`);
  expect(await inMatch(host)).toBe(0);
  expect(await inMatch(guest)).toBe(1);
  await expect(host.locator('#scoreboard .name').nth(1)).toHaveText(guestName.toUpperCase());

  // Nobody serves, so the Match waits in its first Serve; the Court's clock runs on.
  const tick = () => guest.evaluate(() => (window as unknown as { dink: Dink }).dink.state.tick);
  const before = await tick();
  await guest.reload();
  expect(guest.url()).toContain(`court=${code}`);
  expect(await inMatch(guest)).toBe(1);
  await expect.poll(tick).toBeGreaterThan(before);
  await expect(host.locator('#peer')).toBeHidden();
});
