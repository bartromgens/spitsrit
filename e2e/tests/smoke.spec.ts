import { expect, test } from '@playwright/test';
import { smokeUser } from './smoke-user';

test('home page shows a healthy backend', { tag: '@smoke' }, async ({ page }) => {
  await page.goto('/');
  const health = page.getByTestId('health');
  await expect(health).toContainText('ok');
  await expect(health).not.toContainText('error');
});

test('log in and open the commutes page', { tag: '@smoke' }, async ({ page }) => {
  const { username, password } = smokeUser();

  await page.goto('/commutes');
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/commutes/);

  // Read-only: saving a commute needs station search, which needs the NS API key.
  await expect(page.getByRole('heading', { name: 'My commutes' })).toBeVisible();
  await expect(page.getByText('Add a commute')).toBeVisible();
});

test('serves the favicon', { tag: '@smoke' }, async ({ page, request }) => {
  await page.goto('/');
  const icon = page.locator('link[rel="icon"]');
  await expect(icon).toHaveAttribute('type', 'image/svg+xml');
  const href = await icon.getAttribute('href');
  const response = await request.get(new URL(href ?? '', page.url()).toString());
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toContain('image/svg+xml');
  expect(await response.text()).toContain('<title>Spitsrit</title>');
});
