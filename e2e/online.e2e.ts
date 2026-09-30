import { expect, test } from '@playwright/test';

// The Online panel without a server: it is offered in dev (the gate's rule is unit-tested in test/onlineGate.test.ts),
// and the Display name is checked. Two browsers playing through a Court is issue 15.

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
