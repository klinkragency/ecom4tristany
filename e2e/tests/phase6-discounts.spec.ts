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

test.describe('Guided discount creation', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
  });

  test('creates an amount-off-order discount via the modal', async ({ page }) => {
    await page.goto(`${ADMIN}/discounts`);
    await page.getByRole('button', { name: /New discount/i }).click();
    await page.getByRole('button', { name: /Amount off order/i }).click();
    await expect(page).toHaveURL(/\/discounts\/new\/amount-off-order/);

    // Switch to "Discount code" mode so the auto-derived code field is visible.
    await page.getByLabel('Discount code').check();
    const title = `E2E test 10% ${Date.now()}`;
    await page.getByLabel('Title (admin-facing)').fill(title);
    // Auto-derived code; assert it's populated (deriveCode strips non-alphanum
    // and keeps up to the first 3 tokens).
    await expect(page.getByLabel(/Code/)).toHaveValue(/E2ETEST10/);

    await page.getByRole('button', { name: 'Create discount' }).click();
    await expect(page).toHaveURL(/\/discounts$/);
    await expect(page.getByText(title)).toBeVisible();
  });

  test('creates a free-shipping discount', async ({ page }) => {
    await page.goto(`${ADMIN}/discounts`);
    await page.getByRole('button', { name: /New discount/i }).click();
    await page.getByRole('button', { name: /Free shipping/i }).click();
    await expect(page).toHaveURL(/\/discounts\/new\/free-shipping/);

    const title = `Free ship E2E ${Date.now()}`;
    await page.getByLabel('Title (admin-facing)').fill(title);
    // LivePreview must show free shipping (the €0.00 line in the customer view).
    await expect(page.getByText('€0.00')).toBeVisible();
    await page.getByRole('button', { name: 'Create discount' }).click();
    await expect(page).toHaveURL(/\/discounts$/);
    await expect(page.getByText(title)).toBeVisible();
  });

  test('creates a buy-x-get-y discount', async ({ page }) => {
    await page.goto(`${ADMIN}/discounts`);
    await page.getByRole('button', { name: /New discount/i }).click();
    await page.getByRole('button', { name: /Buy X get Y/i }).click();
    await expect(page).toHaveURL(/\/discounts\/new\/buy-x-get-y/);

    const title = `BOGO E2E ${Date.now()}`;
    await page.getByLabel('Title (admin-facing)').fill(title);
    // get qty + discount % default to 1 + 100, just bump the buy quantity.
    await page.getByLabel('Quantity').first().fill('1');
    await page.getByRole('button', { name: 'Create discount' }).click();
    await expect(page).toHaveURL(/\/discounts$/);
    await expect(page.getByText(title)).toBeVisible();
  });

  test('creates an amount-off-products discount and edits it', async ({ page }) => {
    await page.goto(`${ADMIN}/discounts`);
    await page.getByRole('button', { name: /New discount/i }).click();
    await page.getByRole('button', { name: /Amount off products/i }).click();
    await expect(page).toHaveURL(/\/discounts\/new\/amount-off-products/);

    const title = `Products E2E ${Date.now()}`;
    await page.getByLabel('Title (admin-facing)').fill(title);
    await page.getByRole('button', { name: 'Create discount' }).click();
    await expect(page).toHaveURL(/\/discounts$/);
    await expect(page.getByText(title)).toBeVisible();

    // Edit
    await page.getByText(title).click();
    await expect(page).toHaveURL(/\/discounts\/[0-9a-f-]+$/);
    await expect(page.getByText(/Type:\s*Amount off products/)).toBeVisible();
    const editedTitle = `${title} (edited)`;
    await page.getByLabel('Title (admin-facing)').fill(editedTitle);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(/\/discounts$/);
    await expect(page.getByText(editedTitle)).toBeVisible();
  });
});
