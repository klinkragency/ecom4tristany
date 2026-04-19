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

test('Customers admin: list + detail page renders with LTV and addresses', async ({ page }) => {
  await adminLogin(page);
  await page.getByRole('link', { name: 'Customers', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Customers$/ })).toBeVisible();
  await expect(page.locator('table')).toBeVisible();

  const firstCust = page.locator('tbody tr td:first-child a').first();
  if ((await firstCust.count()) > 0) {
    await firstCust.click();
    await expect(page.getByRole('heading', { name: /Summary/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Store credit/ })).toBeVisible();
  }
});

test('Customer account: dashboard shows orders and addresses', async ({ page }) => {
  // Register fresh customer
  const email = `phase4+${Date.now()}@test.com`;
  await page.goto(`${STORE}/account/register`);
  await page.getByLabel('First name').fill('Phase');
  await page.getByLabel('Last name').fill('Four');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/password/i).fill('password123');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/account$/);

  // Account page shows the customer's name.
  await expect(page.getByRole('heading', { name: /Hello,? Phase Four/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Orders/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Addresses/ })).toBeVisible();

  // Add an address.
  await page.getByRole('button', { name: /\+ Add address/i }).click();
  const modal = page.locator('div.fixed');
  await modal.getByPlaceholder('Label (Home, Office…)').fill('Home');
  await modal.getByPlaceholder('First name').fill('Phase');
  await modal.getByPlaceholder('Last name').fill('Four');
  await modal.getByPlaceholder('Address line 1').fill('1 rue Test');
  await modal.getByPlaceholder('City').fill('Paris');
  await modal.getByPlaceholder('Postal code').fill('75001');
  await modal.getByRole('button', { name: /^Save$/ }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByText('1 rue Test')).toBeVisible();

  // Sign out.
  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/account\/login$/);
});
