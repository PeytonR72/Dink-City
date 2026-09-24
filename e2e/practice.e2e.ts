import { expect, test } from '@playwright/test';

test('Practice starts from the map, with the first step and the ball machine', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Practice' }).click();
  await expect(page.locator('#practice')).toContainText('Step 1 of 5');
  await expect(page.locator('#practice')).toContainText('Let it bounce');
  await expect(page.locator('#scoreboard')).toBeHidden();
  const machineServer = await page.evaluate(() => (window as unknown as { dink: { state: { server: number } } }).dink.state.server);
  expect(machineServer).toBe(1);
});
