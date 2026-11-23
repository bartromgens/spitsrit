import { expect, test } from '@playwright/test';
import { smokeUser } from './smoke-user';

test('home page loads without the health debug card', { tag: '@smoke' }, async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Plan a trip', { exact: true })).toBeVisible();
  await expect(page.getByTestId('health')).toHaveCount(0);
});

test('log in and open the commutes page', { tag: '@smoke' }, async ({ page }) => {
  const { username, password } = smokeUser();

  await page.goto('/login');
  await page.getByLabel('Email').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/commutes/);

  // Read-only: saving a commute needs station search, which needs the NS API key.
  await expect(page.getByRole('heading', { name: 'My commutes' })).toBeVisible();
  await expect(page.getByText('Add a commute')).toBeVisible();
});

test('keep a commute on this device without an account', { tag: '@smoke' }, async ({ page }) => {
  // Seeded directly: saving through the form needs station search, which needs the NS API key.
  // The browser context is fresh per test, so nothing is left behind; the delete is the cleanup.
  await page.goto('/');
  await page.evaluate(() =>
    localStorage.setItem(
      'spitsrit.commutes.v1',
      JSON.stringify([
        {
          id: 1,
          name: 'Smoke commute',
          origin_code: 'UT',
          origin_name: 'Utrecht Centraal',
          destination_code: 'ASD',
          destination_name: 'Amsterdam Centraal',
          created_at: '2026-01-01T00:00:00Z',
        },
      ]),
    ),
  );

  await page.goto('/commutes');
  await expect(page.getByText('Saved on this device.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create an account' })).toBeVisible();
  await expect(page.getByText('Smoke commute')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Smoke commute')).toBeVisible();

  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Smoke commute')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('spitsrit.commutes.v1'))).toBeNull();
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
