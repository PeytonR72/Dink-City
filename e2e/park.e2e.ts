import { expect, test, type Page } from '@playwright/test';

interface Dink {
  stats: { calls: number; triangles: number };
  advance(ticks: number, drive?: unknown): unknown;
}

/** Opens the game and waits until the Park is on screen and the camera has settled. */
async function openPark(page: Page, query = '') {
  await page.goto(`/?play${query}`);
  await page.waitForFunction(() => 'dink' in window && (window as unknown as { dink: Dink }).dink.stats.calls > 0);
  // The camera follow is damped; give it time to come to rest before comparing pixels.
  await page.waitForTimeout(1500);
}

test('the Park Venue matches its reference screenshot', async ({ page }) => {
  await openPark(page);
  await expect(page).toHaveScreenshot('park.png', { maxDiffPixelRatio: 0.02 });
});

test('the Park at sunset matches its reference screenshot', async ({ page }) => {
  await openPark(page, '&sunset');
  await expect(page).toHaveScreenshot('park-sunset.png', { maxDiffPixelRatio: 0.02 });
});

test('the Park stays within the performance budget during a Rally', async ({ page }) => {
  await openPark(page);
  // Play a few seconds with a Bot on the local Side, so the ball, trail and swings are all drawn.
  const stats = await page.evaluate(async () => {
    // Modules of the page itself, served by Vite (not resolvable from this test file).
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { createBot, DIFFICULTY } = await load('/src/bot/bot.ts');
    const { observe } = await load('/src/bot/observe.ts');
    const { simTuning } = await load('/src/tuning.ts');
    const dink = (window as unknown as { dink: Dink }).dink;
    const bot = createBot(0, 1, DIFFICULTY.medium, simTuning);
    let worst = { calls: 0, triangles: 0 };
    for (let i = 0; i < 20; i++) {
      dink.advance(30, (s: unknown) => bot.think(observe(s, 0)));
      const { calls, triangles } = dink.stats;
      worst = { calls: Math.max(worst.calls, calls), triangles: Math.max(worst.triangles, triangles) };
    }
    return worst;
  });
  console.log(`Park budget: ${stats.calls} draw calls, ${stats.triangles} triangles`);
  // Spec budget: under about 150 draw calls and 50k triangles.
  expect(stats.calls).toBeLessThan(150);
  expect(stats.triangles).toBeLessThan(50_000);
});

test('the map opens first, with only the Park open, and the Park starts a Match', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dink City' })).toBeVisible();
  await expect(page.getByRole('button', { name: /The Rooftop: locked/ })).toBeVisible();
  await page.getByRole('button', { name: /The Park/ }).click();
  await expect(page.locator('#menu')).toBeHidden();
  await expect(page.locator('#scoreboard')).toBeVisible();
});
