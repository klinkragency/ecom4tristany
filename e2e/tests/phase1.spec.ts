import { test, expect } from '@playwright/test';

const ADMIN = 'http://localhost:3001';
const STORE = 'http://localhost:3000';
const ADMIN_EMAIL = 'admin@shop.test';
const ADMIN_PASSWORD = 'changeme123';

test('admin can sign in and see dashboard shell', async ({ page }) => {
  await page.goto(ADMIN);
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();

  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  for (const label of ['Orders', 'Products', 'Customers', 'Discounts', 'Content', 'Analytics', 'Settings']) {
    await expect(page.getByRole('link', { name: label })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Orders' }).click();
  await expect(page.getByText(/Phase 3/)).toBeVisible();

  await page.getByRole('button', { name: /log out/i }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('customer can register and view account', async ({ page }) => {
  const email = `jane+${Date.now()}@example.com`;
  await page.goto(`${STORE}/account/register`);
  await page.getByLabel('First name').fill('Jane');
  await page.getByLabel('Last name').fill('Doe');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/password/i).fill('password123');
  await page.getByRole('button', { name: /create account/i }).click();

  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText(email)).toBeVisible();

  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/account\/login$/);
});
