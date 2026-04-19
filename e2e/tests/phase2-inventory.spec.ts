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

test('Locations page: create + delete a second location', async ({ page }) => {
  const suffix = Date.now();
  const name = `Popup ${suffix}`;

  await adminLogin(page);
  await page.getByRole('link', { name: 'Locations', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Locations$/ })).toBeVisible();

  await page.getByRole('button', { name: /add location/i }).click();
  // Modal's Name input is the first one in the dialog.
  const modal = page.locator('div.fixed').last();
  await modal.locator('input').first().fill(name);
  await modal.getByRole('button', { name: /^Save$/ }).click();

  await expect(page.getByText(name)).toBeVisible();

  // Delete what we just created.
  page.once('dialog', (d) => d.accept());
  const row = page.locator('tr', { hasText: name });
  await row.getByRole('button', { name: /^Delete$/ }).click();
  await expect(page.getByText(name)).not.toBeVisible({ timeout: 5000 });
});

test('Inventory matrix: set levels on a product, matrix persists the numbers', async ({ page }) => {
  await adminLogin(page);

  // Use the coffee-mug-csv product created by the CSV test.
  await page.goto(`${ADMIN}/products`);
  await page.getByPlaceholder(/search/i).fill('coffee-mug-csv');
  await page.getByPlaceholder(/search/i).press('Enter');
  await page.getByRole('link', { name: /Coffee mug/ }).first().click();

  // Inventory section renders; change the Black variant's on_hand at Main.
  await expect(page.getByRole('heading', { name: /Inventory \(/ })).toBeVisible();
  // Fresh random value so we always produce a diff against whatever previous
  // runs left in the DB (the "Save inventory" button is disabled when !dirty).
  const target = String(1 + Math.floor(Math.random() * 900));
  const firstInput = page.locator('table input[type="number"]').first();
  await firstInput.fill(target);
  await page.getByRole('button', { name: /save inventory/i }).click();
  await expect(page.getByText(/Saved/)).toBeVisible({ timeout: 10_000 });

  // Navigate away and back — the value should persist.
  await page.goto(`${ADMIN}/products`);
  await page.getByPlaceholder(/search/i).fill('coffee-mug-csv');
  await page.getByPlaceholder(/search/i).press('Enter');
  await page.getByRole('link', { name: /Coffee mug/ }).first().click();
  await expect(page.locator('table input[type="number"]').first()).toHaveValue(target);
});
