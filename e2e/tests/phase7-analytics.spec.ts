import { test, expect } from '@playwright/test';

const ADMIN = 'http://localhost:3001';
const STORE = 'http://localhost:3000';
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

test('Analytics dashboard renders KPIs and charts', async ({ page }) => {
  await adminLogin(page);
  await page.goto(`${ADMIN}/analytics`);
  await expect(page.getByRole('heading', { name: /^Analytics$/ })).toBeVisible();
  // KPI tiles present.
  await expect(page.getByText(/Gross revenue/)).toBeVisible();
  await expect(page.getByText(/Net revenue/)).toBeVisible();
  await expect(page.getByText(/Orders paid/).first()).toBeVisible();
  await expect(page.getByText(/Conversion/).first()).toBeVisible();
  // Charts/sections exist.
  await expect(page.getByRole('heading', { name: /Revenue over time/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Conversion funnel/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Top products/ })).toBeVisible();
});

test('Finance tab renders and offers CSV download', async ({ page }) => {
  await adminLogin(page);
  await page.goto(`${ADMIN}/analytics/finance`);
  await expect(page.getByRole('heading', { name: /^Finance$/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Sales by country/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Refunds$/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Store credit liability/ })).toBeVisible();
  // CSV link present
  await expect(page.getByRole('link', { name: /Download CSV/ })).toBeVisible();
});

test('Storefront tracker fires page_view events', async ({ page, browser }) => {
  // Warm context.
  const ctx = await browser.newContext();
  const sp = await ctx.newPage();
  await sp.goto(`${STORE}/`);
  await sp.waitForTimeout(1000);

  // Query the events table via the admin summary endpoint (sessions count).
  // Admin cookies lives on a different context; fetch directly — sessions count
  // shows up in the summary only after SessionMiddleware + track() have run.
  const adminCtx = await browser.newContext();
  const ap = await adminCtx.newPage();
  await adminLogin(ap);
  const sum = await ap.evaluate(async (api) => {
    const to = new Date().toISOString();
    const from = new Date(Date.now() - 60_000).toISOString();
    const r = await fetch(`${api}/api/admin/analytics/summary?from=${from}&to=${to}`, {
      credentials: 'include',
    });
    return r.json();
  }, API);
  expect(sum.sessions).toBeGreaterThanOrEqual(1);
  await ctx.close();
  await adminCtx.close();
});

test('POST /events with invalid kind is rejected', async ({ request }) => {
  const res = await request.post(`${API}/api/storefront/events`, {
    headers: { 'Content-Type': 'application/json' },
    data: { kind: 'bogus_kind' },
  });
  expect(res.status()).toBe(400);
});
