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

test('admin creates product with options + variants, storefront renders it', async ({ page }) => {
  const suffix = Date.now();
  const title = `Hoodie ${suffix}`;
  const handle = `hoodie-${suffix}`;

  await adminLogin(page);

  // Products list
  await page.getByRole('link', { name: 'Products', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Products$/ })).toBeVisible();

  // Create new
  await page.getByRole('link', { name: /add product/i }).click();
  await page.getByLabel('Title').fill(title);
  // Editor is a contentEditable div (class .rte-editor), not a textarea.
  await page.locator('.rte-editor').first().click();
  await page.locator('.rte-editor').first().pressSequentially('Warm hoodie for cold days.');
  await page.locator('select').first().selectOption('active');
  await page.getByLabel('Vendor').fill('ACME');
  await page.getByLabel('Product type').fill('Apparel');
  await page.getByLabel('Tags (comma-separated)').fill('winter, warm');
  await page.getByRole('button', { name: /create product/i }).click();

  // We should be on the edit page with the title visible as H1
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();

  // Add option "Size" with values S, M, L
  await page.getByPlaceholder('Option name (e.g. Size)').fill('Size');
  await page.getByPlaceholder('Values, comma-separated (e.g. S, M, L)').fill('S, M, L');
  await page.getByRole('button', { name: /^Add$/ }).click();
  // "Options (1 / 3)" card heading is enough to confirm the option was added.
  await expect(page.getByRole('heading', { name: /Options \(1 \/ 3\)/ })).toBeVisible();

  // Add one new variant (Size M @ €29.99) then delete the default variant.
  // The <select> for the Size option inside the "Add variant" section.
  const sizeSelect = page.locator('select').filter({ hasText: 'Size…' });
  await sizeSelect.selectOption({ label: 'M' });
  await page.getByPlaceholder('SKU').last().fill(`HOODIE-${suffix}-M`);
  await page.getByPlaceholder('Price').last().fill('29.99');
  await page.getByRole('button', { name: /^Add variant$/ }).click();

  // Wait for the variant count to show 2 variants, then delete "Default".
  await expect(page.getByRole('heading', { name: /Variants \(2\)/ })).toBeVisible();
  page.once('dialog', (d) => d.accept());
  // After adding the "Size" option, the pre-existing default variant has no option values assigned,
  // so its computed label is "?". Delete that one.
  await page
    .locator('[data-variant-label="?"]')
    .getByRole('button', { name: /^Delete$/ })
    .click();
  await expect(page.getByRole('heading', { name: /Variants \(1\)/ })).toBeVisible();

  // Update handle to a stable one so the storefront test below is predictable.
  const handleInput = page.getByLabel('Handle (URL slug)');
  await handleInput.fill(handle);
  // Use the header Save button (first in DOM order).
  await page.getByRole('button', { name: /^Save$/ }).first().click();
  await expect(page.getByText(/Saved/)).toBeVisible({ timeout: 5000 });

  // Storefront listing
  const store = await page.context().newPage();
  await store.goto(`${STORE}/products`);
  await expect(store.getByRole('link', { name: new RegExp(title) })).toBeVisible();

  // PDP
  await store.goto(`${STORE}/products/${handle}`);
  await expect(store.getByRole('heading', { name: title })).toBeVisible();
  // fr-FR EUR format: "29,99 €" with NBSP between amount and symbol.
  await expect(store.getByText(/29,99/)).toBeVisible();
  await expect(store.getByText(/Warm hoodie/)).toBeVisible();
});
