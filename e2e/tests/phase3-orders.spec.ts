import { test, expect } from '@playwright/test';

const ADMIN = 'http://localhost:3001';
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

test('Orders admin: list loads; if any order, detail page renders items, totals, timeline', async ({ page }) => {
  await adminLogin(page);
  await page.getByRole('link', { name: 'Orders', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Orders$/ })).toBeVisible();

  // The list table must render (empty-state is OK too).
  await expect(page.locator('table')).toBeVisible();

  // If there's at least one order, open it.
  const firstOrder = page.locator('tbody tr td:first-child a').first();
  const hasOrder = (await firstOrder.count()) > 0;
  if (hasOrder) {
    const number = (await firstOrder.textContent())?.trim();
    await firstOrder.click();
    // Detail page shows the order number as H1.
    await expect(page.getByRole('heading', { level: 1, name: new RegExp(number ?? '') })).toBeVisible();
    // Items card.
    await expect(page.getByRole('heading', { name: /Items \(\d+\)/ })).toBeVisible();
    // Timeline card with at least the "created" event.
    await expect(page.getByRole('heading', { name: /^Timeline$/ })).toBeVisible();
    await expect(page.getByText(/created/i).first()).toBeVisible();
    // Totals row.
    await expect(page.getByText(/^Total$/).first()).toBeVisible();
  }
});
