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

async function csrf(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(async (api) => {
    const r = await fetch(`${api}/api/csrf`, { credentials: 'include' });
    return (await r.json()).csrfToken as string;
  }, API);
}

test('Settings/general: edit shop name, see it in admin response', async ({ page }) => {
  await adminLogin(page);
  await page.goto(`${ADMIN}/settings/general`);
  await expect(page.getByRole('heading', { name: /^General$/ })).toBeVisible();

  // Get current, mutate via API, verify.
  const token = await csrf(page);
  const newName = `Tristany Shop ${Date.now()}`;
  const after = await page.evaluate(async ({ api, token, name }) => {
    const r = await fetch(`${api}/api/admin/settings`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify({ shopName: name }),
    });
    return { status: r.status, body: await r.json() };
  }, { api: API, token, name: newName });
  expect(after.status).toBe(200);
  expect(after.body.shopName).toBe(newName);
});

test('Invite flow: owner invites a staff, accept token, new admin can log in', async ({ page, browser }) => {
  await adminLogin(page);
  const token = await csrf(page);
  const email = `staff-${Date.now()}@test.com`;

  // 1. Owner sends the invite — response returns the URL so we don't need mailpit.
  const invite = await page.evaluate(async ({ api, token, email }) => {
    const r = await fetch(`${api}/api/admin/users`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify({ email, name: 'New Staff', role: 'staff' }),
    });
    return { status: r.status, body: await r.json() };
  }, { api: API, token, email });
  expect(invite.status).toBe(201);
  const inviteUrl: string = invite.body.inviteUrl;
  const tokenValue = new URL(inviteUrl).searchParams.get('token')!;

  // 2. Accept the invite as the invitee (fresh context — no admin cookies).
  const newCtx = await browser.newContext();
  const newPage = await newCtx.newPage();
  await newPage.goto(`${ADMIN}/invite?token=${tokenValue}`);
  await newPage.getByLabel(/New password/).fill('staffpass123');
  await newPage.getByLabel(/Confirm password/).fill('staffpass123');
  await newPage.getByRole('button', { name: /Accept invite/ }).click();
  await expect(newPage.getByRole('heading', { name: /Welcome aboard/ })).toBeVisible();

  // 3. Sign in as the new staff.
  await newPage.waitForURL(/\/login/);
  await newPage.getByLabel('Email').fill(email);
  await newPage.getByLabel('Password').fill('staffpass123');
  await newPage.getByRole('button', { name: /sign in/i }).click();
  await expect(newPage.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  await newCtx.close();
});

test('RBAC: staff cannot issue a refund', async ({ page, browser }) => {
  // Seed a staff via owner API.
  await adminLogin(page);
  const token = await csrf(page);
  const email = `rbac-${Date.now()}@test.com`;
  const invite = await page.evaluate(async ({ api, token, email }) => {
    const r = await fetch(`${api}/api/admin/users`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify({ email, name: 'RBAC Staff', role: 'staff' }),
    });
    return await r.json();
  }, { api: API, token, email });
  const acceptToken = new URL(invite.inviteUrl).searchParams.get('token')!;

  const ctx = await browser.newContext();
  const sp = await ctx.newPage();
  await sp.goto(`${ADMIN}/invite?token=${acceptToken}`);
  await sp.getByLabel(/New password/).fill('rbacpass123');
  await sp.getByLabel(/Confirm password/).fill('rbacpass123');
  await sp.getByRole('button', { name: /Accept invite/ }).click();
  await sp.waitForURL(/\/login/);
  await sp.getByLabel('Email').fill(email);
  await sp.getByLabel('Password').fill('rbacpass123');
  await sp.getByRole('button', { name: /sign in/i }).click();
  // Wait for the session cookie to be set + the dashboard to render before
  // firing the CSRF fetch below — otherwise the refund call races the login.
  await expect(sp.getByRole('heading', { name: /dashboard/i })).toBeVisible();

  // Try to hit a refund endpoint — should 403.
  const staffCsrf = await csrf(sp);
  const res = await sp.evaluate(async ({ api, token }) => {
    const r = await fetch(`${api}/api/admin/orders/00000000-0000-0000-0000-000000000000/refunds`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify({ amountCents: 100 }),
    });
    return r.status;
  }, { api: API, token: staffCsrf });
  expect(res).toBe(403);
  await ctx.close();
});

test('Audit log records a mutating request', async ({ page }) => {
  await adminLogin(page);
  const token = await csrf(page);
  // Trigger a mutating admin call: update settings.
  await page.evaluate(async ({ api, token }) => {
    await fetch(`${api}/api/admin/settings`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify({ shopVatPercent: 20 }),
    });
  }, { api: API, token });

  // Audit middleware writes async — give it a breath then query.
  await page.waitForTimeout(300);
  const audit = await page.evaluate(async (api) => {
    const r = await fetch(`${api}/api/admin/audit?resourceType=settings&limit=5`, { credentials: 'include' });
    return await r.json();
  }, API);
  expect(audit.items.length).toBeGreaterThan(0);
  expect(audit.items[0].method).toBe('PUT');
});
