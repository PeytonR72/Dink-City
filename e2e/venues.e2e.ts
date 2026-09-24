import { expect, test, type Page } from '@playwright/test';

interface Dink {
  stats: { calls: number; triangles: number };
  advance(ticks: number, drive?: unknown): unknown;
}

const VENUES = ['park', 'rooftop', 'beach'] as const;

/** Opens a Match at `venue` and waits until it is on screen and the camera has settled. */
async function openVenue(page: Page, venue: string, query = '') {
  await page.goto(`/?play&venue=${venue}${query}`);
  await page.waitForFunction(() => 'dink' in window && (window as unknown as { dink: Dink }).dink.stats.calls > 0);
  // The camera follow is damped; give it time to come to rest before comparing pixels.
  await page.waitForTimeout(1500);
}

for (const venue of VENUES) {
  test(`the ${venue} matches its reference screenshot`, async ({ page }) => {
    await openVenue(page, venue);
    await expect(page).toHaveScreenshot(`${venue}.png`, { maxDiffPixelRatio: 0.02 });
  });

  test(`the ${venue} at sunset matches its reference screenshot`, async ({ page }) => {
    await openVenue(page, venue, '&sunset');
    await expect(page).toHaveScreenshot(`${venue}-sunset.png`, { maxDiffPixelRatio: 0.02 });
  });

  test(`the ${venue} stays within the performance budget during a Rally`, async ({ page }) => {
    await openVenue(page, venue);
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
    console.log(`${venue} budget: ${stats.calls} draw calls, ${stats.triangles} triangles`);
    // Spec budget: under about 150 draw calls and 50k triangles.
    expect(stats.calls).toBeLessThan(150);
    expect(stats.triangles).toBeLessThan(50_000);
  });
}

test('the map opens first, with only the Park open, and the Park starts a Match', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dink City' })).toBeVisible();
  await expect(page.getByRole('button', { name: /The Rooftop: locked/ })).toBeVisible();
  await page.getByRole('button', { name: /The Park/ }).click();
  await expect(page.locator('#menu')).toBeHidden();
  await expect(page.locator('#scoreboard')).toBeVisible();
});
