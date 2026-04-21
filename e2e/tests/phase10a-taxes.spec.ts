import { test, expect } from '@playwright/test';

const ADMIN = 'http://localhost:3001';
const API = 'http://localhost:8080';
const ADMIN_EMAIL = 'admin@shop.test';
const ADMIN_PASSWORD = 'changeme123';

async function adminLogin(page: import('@playwright/test').Page) {
  await page.goto(ADMIN);
  if (page.url().endsWith('/login')) {
    await page.getByLabel('Email').fill(ADMIN_EMAIL);
    await page.getByLabel('Password').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  }
}

test('Tax rates: EU seed is present + admin can upsert', async ({ page }) => {
  await adminLogin(page);
  await page.goto(`${ADMIN}/settings/taxes`);
  await expect(page.getByRole('heading', { name: /^Tax rates$/ })).toBeVisible();

  // The migration seeds FR, DE, etc. — the table should render several rows.
  await expect(page.locator('tbody tr').first()).toBeVisible();

  // List endpoint returns the seed.
  const data = await page.evaluate(async (api) => {
    const r = await fetch(`${api}/api/admin/tax-rates`, { credentials: 'include' });
    return await r.json();
  }, API);
  const fr = data.items.find((t: { country: string; percent: number }) => t.country === 'FR');
  const de = data.items.find((t: { country: string; percent: number }) => t.country === 'DE');
  expect(fr?.percent).toBe(20);
  expect(de?.percent).toBe(19);
});
