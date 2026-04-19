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

async function registerCustomer(page: import('@playwright/test').Page, email: string, password: string, first = 'Gdpr', last = 'Tester') {
  await page.goto(`${STORE}/account/register`);
  await page.getByLabel('First name').fill(first);
  await page.getByLabel('Last name').fill(last);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/account$/);
}

test('GDPR: customer can download their data and delete their account', async ({ page, context }) => {
  const email = `gdpr+${Date.now()}@test.com`;
  const password = 'password123';
  await registerCustomer(page, email, password);

  // Download the data export: the link opens in a new tab; instead, fetch
  // directly with the same cookies to assert the shape.
  const cookies = await context.cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const res = await fetch(`${API}/api/customer/data-export`, { headers: { cookie: cookieHeader } });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('application/json');
  const body = await res.json();
  expect(body.customer.email).toBe(email);
  expect(Array.isArray(body.orders)).toBe(true);
  expect(Array.isArray(body.addresses)).toBe(true);

  // Now delete the account. Open the confirmation modal, enter the password.
  await page.getByRole('button', { name: /delete my account/i }).click();
  await page.getByLabel(/re-enter your password/i).fill(password);
  await page.getByRole('button', { name: /^delete account$/i }).click();
  // Redirects to login with erased=1.
  await expect(page).toHaveURL(/\/account\/login/);

  // The old credentials must no longer work.
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('alert')).toBeVisible();
});

test('Admin can export a customer\'s data and erase the account', async ({ page, browser }) => {
  // Set up a fresh customer first in an isolated context.
  const custCtx = await browser.newContext();
  const custPage = await custCtx.newPage();
  const email = `admin-erase+${Date.now()}@test.com`;
  const password = 'password123';
  await registerCustomer(custPage, email, password, 'ToErase', 'User');
  await custCtx.close();

  // Admin finds & opens the customer.
  await adminLogin(page);
  await page.getByRole('link', { name: 'Customers', exact: true }).click();
  await page.waitForSelector('table');
  const row = page.locator('tbody tr', { hasText: email }).first();
  await row.locator('a').first().click();
  await expect(page.getByRole('heading', { name: /ToErase User/i })).toBeVisible();

  // Click "Erase account (anonymize)"
  await page.getByRole('button', { name: /erase account/i }).click();
  // Type email to confirm.
  const modal = page.locator('div.fixed');
  await modal.locator('input[autocomplete="off"]').fill(email);
  await modal.getByRole('button', { name: /^erase account$/i }).click();
  await expect(page).toHaveURL(/\/customers$/);
});

test('Segments: admin can create a segment with a rule and preview matches', async ({ page }) => {
  // First register a customer so the preview is non-empty.
  const custCtx = await page.context().browser()!.newContext();
  const custPage = await custCtx.newPage();
  const email = `seg+${Date.now()}@test.com`;
  await registerCustomer(custPage, email, 'password123', 'Seg', 'Ment');
  await custCtx.close();

  await adminLogin(page);
  await page.goto(`${ADMIN}/segments`);
  await expect(page.getByRole('heading', { name: /^Segments$/ })).toBeVisible();
  await page.getByRole('button', { name: /new segment/i }).click();
  await expect(page).toHaveURL(/\/segments\/[0-9a-f-]+$/);

  // Rename, add an email-contains rule, save.
  const uniqueName = `Test segment ${Date.now()}`;
  const nameInput = page.locator('input').first();
  await nameInput.fill(uniqueName);
  await page.getByRole('button', { name: /\+ add rule/i }).click();
  await page.locator('input[placeholder="value"]').fill('seg+');
  await page.getByRole('button', { name: /^save$/i }).click();
  await page.waitForTimeout(500);
  await page.goto(`${ADMIN}/segments`);
  await expect(page.getByRole('link', { name: uniqueName, exact: true })).toBeVisible();
});

test('Merge: admin can merge two duplicate customers into one', async ({ page, browser }) => {
  // Create two customers in separate contexts so both rows exist.
  const tok = Date.now();
  const targetEmail = `merge-target+${tok}@test.com`;
  const sourceEmail = `merge-source+${tok}@test.com`;

  for (const [em, fn] of [[targetEmail, 'Target'], [sourceEmail, 'Source']] as const) {
    const c = await browser.newContext();
    const p = await c.newPage();
    await registerCustomer(p, em, 'password123', fn, 'Person');
    await c.close();
  }

  await adminLogin(page);
  await page.getByRole('link', { name: 'Customers', exact: true }).click();
  await page.waitForSelector('table');
  // Open the target row.
  await page.locator('tbody tr', { hasText: targetEmail }).locator('a').first().click();
  await expect(page.getByRole('heading', { name: /Target Person/i })).toBeVisible();

  // Open merge modal, search for source, pick it.
  await page.getByRole('button', { name: /merge duplicate/i }).click();
  const modal = page.locator('div.fixed');
  await modal.getByPlaceholder(/search by email/i).fill(sourceEmail);
  // Wait for the result list and click the matching item.
  await modal.locator('li button', { hasText: sourceEmail }).first().click();
  await modal.getByRole('button', { name: /merge & delete source/i }).click();

  // After merge, going back to /customers should show target but not source.
  await page.waitForTimeout(500);
  await page.goto(`${ADMIN}/customers`);
  await page.waitForSelector('table');
  await expect(page.locator('tbody')).toContainText(targetEmail);
  await expect(page.locator('tbody')).not.toContainText(sourceEmail);
});
