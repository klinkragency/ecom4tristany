import { test, expect } from '@playwright/test';

const ADMIN = 'http://localhost:3001';
const STORE = 'http://localhost:3000';
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

test('admin creates a manual collection, storefront renders it', async ({ page }) => {
  const suffix = Date.now();
  const title = `Curated ${suffix}`;

  await adminLogin(page);
  await page.getByRole('link', { name: 'Collections', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Collections$/ })).toBeVisible();
  await page.getByRole('link', { name: /new collection/i }).click();

  await page.getByLabel('Title').fill(title);
  await page.getByRole('button', { name: /create collection/i }).click();

  // We land on the editor; confirm it's manual and open product picker.
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  // Match the header pill specifically (not the <option> in the sort select).
  await expect(page.locator('span', { hasText: /^Manual$/ }).first()).toBeVisible();
  await page.getByRole('button', { name: /add products/i }).click();

  // Pick the first product in the picker.
  const modal = page.locator('div.fixed');
  await modal.locator('li').first().click();
  await modal.getByRole('button', { name: /^Add\s*\d+$/ }).click();
  await expect(modal).toHaveCount(0);

  // Product list on the editor should now show 1 item.
  await expect(page.getByRole('heading', { name: /Products \(1\)/ })).toBeVisible();

  // Storefront — collections index and the collection PDP.
  const handle = title.toLowerCase().replace(/\s+/g, '-');
  const store = await page.context().newPage();
  await store.goto(`${STORE}/collections`);
  await expect(store.getByRole('link', { name: new RegExp(title) })).toBeVisible();
  await store.goto(`${STORE}/collections/${handle}`);
  await expect(store.getByRole('heading', { name: title })).toBeVisible();
  // At least one product card is visible.
  await expect(store.locator('ul li a').first()).toBeVisible();
});

test('admin creates a rule-based collection (price > 25€) and storefront shows matches', async ({ page }) => {
  const suffix = Date.now();
  const title = `Premium ${suffix}`;

  await adminLogin(page);
  await page.getByRole('link', { name: 'Collections', exact: true }).click();
  await page.getByRole('link', { name: /new collection/i }).click();

  await page.getByLabel('Title').fill(title);
  await page.getByLabel(/Rule-based/).check();
  await page.getByRole('button', { name: /create collection/i }).click();

  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(page.locator('span', { hasText: /^Rule-based$/ }).first()).toBeVisible();

  // Add a rule: price greater than 25
  await page.locator('select').nth(1).selectOption('price'); // rule field
  // The operator select is the next sibling — look by options available after picking price
  await page.locator('select').nth(2).selectOption('greater_than');
  await page.getByPlaceholder(/e.g. 25/).fill('25');
  await page.getByRole('button', { name: /^Add rule$/ }).click();

  // Matched products card should appear with at least 1 matched product.
  await expect(page.getByRole('heading', { name: /Matched products/ })).toBeVisible();

  // Storefront shows matches.
  const handle = title.toLowerCase().replace(/\s+/g, '-');
  const store = await page.context().newPage();
  await store.goto(`${STORE}/collections/${handle}`);
  await expect(store.getByRole('heading', { name: title })).toBeVisible();
  await expect(store.locator('ul li a').first()).toBeVisible();
});
