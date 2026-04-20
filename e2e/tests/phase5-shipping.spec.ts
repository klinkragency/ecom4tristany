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

test('Shipping settings: admin can create a zone + rate, storefront can quote it', async ({ page, browser }) => {
  await adminLogin(page);

  // Clear pre-existing zones via the admin API so the test is idempotent.
  // Run the HTTP calls from inside the browser page so cookies + CSRF match.
  await page.goto(`${ADMIN}/settings/shipping`);
  await page.evaluate(async (api) => {
    const csrf = await fetch(`${api}/api/csrf`, { credentials: 'include' }).then((r) => r.json());
    const list = await fetch(`${api}/api/admin/shipping/zones`, { credentials: 'include' }).then((r) => r.json());
    for (const z of list.items ?? []) {
      await fetch(`${api}/api/admin/shipping/zones/${z.id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'X-CSRF-Token': csrf.csrfToken },
      });
    }
  }, API);
  await page.reload();

  await page.goto(`${ADMIN}/settings/shipping`);
  await expect(page.getByRole('heading', { name: /^Shipping$/ })).toBeVisible();

  const zoneName = `France ${Date.now()}`;
  const country = 'FR';

  // Create zone.
  await page.getByRole('button', { name: /new zone/i }).click();
  const modal = page.locator('div.fixed');
  await modal.getByPlaceholder(/FR, DE, BE/i).fill(country);
  await modal.locator('input').first().fill(zoneName);
  await modal.getByRole('button', { name: /^Save$/ }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByRole('heading', { name: new RegExp(zoneName) })).toBeVisible();

  // Add a rate to that zone.
  const zoneLi = page.locator('li', { hasText: zoneName }).first();
  await zoneLi.getByRole('button', { name: /\+ Add rate/i }).click();
  const rateModal = page.locator('div.fixed');
  await rateModal.locator('input').first().fill('Colissimo standard');
  // Default kind=flat, price=5.00.
  await rateModal.getByRole('button', { name: /^Save$/ }).click();
  await expect(page.getByText(/Colissimo standard/)).toBeVisible();

  // Now verify the storefront shipping-quote endpoint returns this rate.
  // We need a cart cookie — add something to the cart via the storefront API.
  const ctx = await browser.newContext();
  const storePage = await ctx.newPage();
  await storePage.goto(`${STORE}/`);
  // Prime CSRF.
  await storePage.evaluate(async () => {
    await fetch('/api/csrf', { credentials: 'include' }).catch(() => {});
  });
  // Get a product → fetch its detail to find a variant id.
  const products = await fetch(`${API}/api/storefront/products?limit=1`).then((r) => r.json());
  const handle: string | undefined = products?.items?.[0]?.handle;
  if (!handle) {
    test.skip(true, 'No products available to prime cart');
  }
  const detail = await fetch(`${API}/api/storefront/products/${handle}`).then((r) => r.json());
  const firstVariantId: string | undefined = detail?.variants?.[0]?.id;
  if (!firstVariantId) {
    test.skip(true, 'No variants available to prime cart');
  }
  // Using the storePage context so cookies are attached.
  const addResp = await storePage.evaluate(async (variantId) => {
    const csrf = await fetch('/api/csrf', { credentials: 'include' }).then((r) => r.json());
    const r = await fetch('/api/storefront/cart/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.csrfToken },
      credentials: 'include',
      body: JSON.stringify({ variantId, quantity: 1 }),
    });
    return r.status;
  }, firstVariantId);
  expect(addResp).toBe(200);

  // Quote.
  const quote = await storePage.evaluate(async (country) => {
    const csrf = await fetch('/api/csrf', { credentials: 'include' }).then((r) => r.json());
    const r = await fetch('/api/storefront/checkout/shipping-quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.csrfToken },
      credentials: 'include',
      body: JSON.stringify({ country }),
    });
    return { status: r.status, body: await r.json() };
  }, country);
  expect(quote.status).toBe(200);
  expect(Array.isArray(quote.body.rates)).toBe(true);
  expect(quote.body.rates.length).toBeGreaterThanOrEqual(1);
  expect(quote.body.rates[0].name).toBe('Colissimo standard');
  await ctx.close();
});

test('Returns list page renders for admin (even empty)', async ({ page }) => {
  await adminLogin(page);
  await page.getByRole('link', { name: 'Returns', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Returns$/ })).toBeVisible();
  // Either the table or the empty-state banner is present.
  const hasTable = await page.locator('table').count();
  const hasEmpty = await page.getByText(/No returns/i).count();
  expect(hasTable + hasEmpty).toBeGreaterThan(0);
});

test('Fulfillments card renders on order detail (if a paid order exists)', async ({ page }) => {
  await adminLogin(page);
  await page.goto(`${ADMIN}/orders`);
  await expect(page.getByRole('heading', { name: /^Orders$/ })).toBeVisible();
  // If any row, open it and look for the Fulfillments card.
  const firstOrder = page.locator('tbody tr td:first-child a').first();
  if ((await firstOrder.count()) === 0) {
    test.skip(true, 'No orders to inspect');
  }
  await firstOrder.click();
  await expect(page.getByRole('heading', { name: /Fulfillments/ })).toBeVisible();
});
