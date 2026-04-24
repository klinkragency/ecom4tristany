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

test('Geo-hint: CF-IPCountry header returns the country + a currency suggestion', async ({ request }) => {
  const r = await request.get(`${API}/api/storefront/geo-hint`, {
    headers: { 'CF-IPCountry': 'DE' },
  });
  expect(r.status()).toBe(200);
  const body = await r.json();
  expect(body.country).toBe('DE');
  // DE → EUR, which is seeded + active in migration 00012.
  expect(body.suggestedCurrency).toBe('EUR');
});

test('Geo-hint: Accept-Language fallback extracts region subtag', async ({ request }) => {
  const r = await request.get(`${API}/api/storefront/geo-hint`, {
    headers: { 'Accept-Language': 'en-GB,en;q=0.9' },
  });
  expect(r.status()).toBe(200);
  const body = await r.json();
  expect(body.country).toBe('GB');
  expect(body.suggestedCurrency).toBe('GBP');
});

test('Geo-hint: missing country → empty response (no crash)', async ({ request }) => {
  // No headers set that reveal country, generic Accept-Language.
  const r = await request.get(`${API}/api/storefront/geo-hint`, {
    headers: { 'Accept-Language': 'en' },
  });
  expect(r.status()).toBe(200);
  const body = await r.json();
  expect(body.country).toBe('');
  expect(body.suggestedCurrency).toBe('');
});

test('Admin analytics: sessions-by-country endpoint responds', async ({ page }) => {
  await adminLogin(page);
  await page.goto(`${ADMIN}/analytics`);
  // Widget renders.
  await expect(page.getByRole('heading', { name: /Live sessions by country/ })).toBeVisible();

  // API side-check.
  const data = await page.evaluate(async (api) => {
    const r = await fetch(`${api}/api/admin/analytics/sessions-by-country?minutes=5`, { credentials: 'include' });
    return await r.json();
  }, API);
  expect(data.windowMinutes).toBe(5);
  expect(Array.isArray(data.items)).toBe(true);
  // Total is a number, items may be empty if no traffic.
  expect(typeof data.totalSessions).toBe('number');
});

// ─── UI tests: the GeoHint banner on the storefront ─────────────────────

const STORE = 'http://localhost:3000';

test('GeoHint banner: US visitor gets a USD suggestion, accepting switches currency', async ({ browser }) => {
  // locale option sets both navigator.language AND Accept-Language, so
  // the backend's fallback path sees "US" without us forging CF-IPCountry.
  const ctx = await browser.newContext({ locale: 'en-US' });
  const page = await ctx.newPage();
  await page.goto(`${STORE}/`);

  // Banner visible with the detected country.
  await expect(page.getByText(/browsing from\s*US/i)).toBeVisible();
  await page.getByRole('button', { name: /Switch to USD/ }).click();

  // Currency provider reloads the page; afterwards the switcher shows USD.
  await expect(page.locator('select[aria-label="Currency"]')).toHaveValue('USD');
  await ctx.close();
});

test('GeoHint banner: dismissing hides it and survives a reload', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'en-US' });
  const page = await ctx.newPage();
  await page.goto(`${STORE}/`);

  await expect(page.getByText(/browsing from\s*US/i)).toBeVisible();
  await page.getByRole('button', { name: /No thanks/ }).click();

  // Banner gone immediately.
  await expect(page.getByText(/browsing from\s*US/i)).toHaveCount(0);

  // Reload — dismiss cookie prevents re-appearance.
  await page.reload();
  await expect(page.getByText(/browsing from\s*US/i)).toHaveCount(0);
  await ctx.close();
});

test('GeoHint banner: no prompt when base currency matches the visitor (FR → EUR)', async ({ browser }) => {
  // Base currency is EUR. A French visitor is already seeing EUR, so the
  // banner should not appear at all.
  const ctx = await browser.newContext({ locale: 'fr-FR' });
  const page = await ctx.newPage();
  await page.goto(`${STORE}/`);

  // Banner text never shows up.
  await page.waitForTimeout(500); // allow the hint fetch to complete
  await expect(page.getByText(/browsing from/i)).toHaveCount(0);
  await ctx.close();
});
