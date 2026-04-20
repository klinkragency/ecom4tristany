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

test('Discounts admin: create a percentage code', async ({ page }) => {
  await adminLogin(page);
  await page.goto(`${ADMIN}/discounts/new`);
  await expect(page.getByRole('heading', { name: /new discount/i })).toBeVisible();

  const code = `TEST${Date.now()}`;
  await page.getByPlaceholder('SUMMER20').fill(code);
  await page.locator('input').first().fill(`Test ${code}`);
  // Percentage is default (10%). Just save.
  await page.getByRole('button', { name: /^Create$/ }).click();
  await expect(page).toHaveURL(/\/discounts\/[0-9a-f-]+$/);
  // List page shows our new discount.
  await page.goto(`${ADMIN}/discounts`);
  await expect(page.getByText(code).first()).toBeVisible();
});

test('Storefront: apply a code on cart and see discount reflected', async ({ page, browser }) => {
  // Seed a code via the admin API (cleaner than going through the UI).
  const adminCtx = await browser.newContext();
  const adminPage = await adminCtx.newPage();
  await adminLogin(adminPage);

  const code = `SFX${Date.now()}`;
  const created = await adminPage.evaluate(async ({ api, code }) => {
    const csrf = await fetch(`${api}/api/csrf`, { credentials: 'include' }).then((r) => r.json());
    const r = await fetch(`${api}/api/admin/discounts`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.csrfToken },
      body: JSON.stringify({
        code,
        title: `20% off (${code})`,
        kind: 'percentage',
        valuePercent: 20,
        scope: 'all',
        eligibility: 'all',
        minSubtotalCents: 0,
        active: true,
      }),
    });
    return { status: r.status, body: await r.json() };
  }, { api: API, code });
  expect(created.status).toBe(201);
  await adminCtx.close();

  // Customer side: need a product in the cart first.
  await page.goto(`${STORE}/`);
  const products = await fetch(`${API}/api/storefront/products?limit=1`).then((r) => r.json());
  const handle: string | undefined = products?.items?.[0]?.handle;
  if (!handle) test.skip(true, 'No products available to test cart');
  const detail = await fetch(`${API}/api/storefront/products/${handle}`).then((r) => r.json());
  const variantId: string | undefined = detail?.variants?.[0]?.id;
  if (!variantId) test.skip(true, 'No variants available to test cart');

  await page.evaluate(async ({ api, variantId }) => {
    const csrf = await fetch(`${api}/api/csrf`, { credentials: 'include' }).then((r) => r.json());
    await fetch(`${api}/api/storefront/cart/items`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.csrfToken },
      body: JSON.stringify({ variantId, quantity: 1 }),
    });
  }, { api: API, variantId: variantId! });

  // Go to cart, apply the code.
  await page.goto(`${STORE}/cart`);
  await expect(page.getByRole('heading', { name: /your cart/i })).toBeVisible();
  await page.getByPlaceholder(/discount code/i).fill(code);
  await page.getByRole('button', { name: /^Apply$/ }).click();
  // Discount code + title now visible; Apply button is gone.
  await expect(page.getByText(code, { exact: true })).toBeVisible();
  await expect(page.getByText(/20% off/).first()).toBeVisible();
});

test('Storefront: invalid code shows an error', async ({ page, browser }) => {
  // Seed a product first.
  const products = await fetch(`${API}/api/storefront/products?limit=1`).then((r) => r.json());
  const handle: string | undefined = products?.items?.[0]?.handle;
  if (!handle) test.skip(true, 'No products');
  const detail = await fetch(`${API}/api/storefront/products/${handle}`).then((r) => r.json());
  const variantId: string | undefined = detail?.variants?.[0]?.id;
  if (!variantId) test.skip(true, 'No variants');

  const ctx = await browser.newContext();
  const storePage = await ctx.newPage();
  await storePage.goto(`${STORE}/`);
  await storePage.evaluate(async ({ api, variantId }) => {
    const csrf = await fetch(`${api}/api/csrf`, { credentials: 'include' }).then((r) => r.json());
    await fetch(`${api}/api/storefront/cart/items`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.csrfToken },
      body: JSON.stringify({ variantId, quantity: 1 }),
    });
  }, { api: API, variantId: variantId! });

  await storePage.goto(`${STORE}/cart`);
  await storePage.getByPlaceholder(/discount code/i).fill('DEFINITELY_NOT_A_REAL_CODE');
  await storePage.getByRole('button', { name: /^Apply$/ }).click();
  await expect(storePage.getByRole('alert').or(storePage.getByText(/invalid/i))).toBeVisible();
  await ctx.close();
});
