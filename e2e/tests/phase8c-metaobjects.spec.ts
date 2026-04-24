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

test('Metaobjects: full round trip — create type, create entry, list publicly', async ({ page, request }) => {
  await adminLogin(page);
  const token = await csrf(page);
  const handle = `faq_${Date.now()}`;

  // 1. Create a type with two fields.
  const created = await page.evaluate(async ({ api, token, handle }) => {
    const r = await fetch(`${api}/api/admin/content/metaobjects/types`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify({
        handle,
        name: 'FAQ',
        description: 'Q&A entries',
        fieldDefs: [
          { key: 'question', name: 'Question', type: 'single_line_text', required: true },
          { key: 'answer',   name: 'Answer',   type: 'rich_text',        required: true },
        ],
      }),
    });
    return { status: r.status, body: await r.json() };
  }, { api: API, token, handle });
  expect(created.status).toBe(201);
  const typeId: string = created.body.id;

  // 2. Create a published entry of that type.
  const entry = await page.evaluate(async ({ api, token, typeId }) => {
    const r = await fetch(`${api}/api/admin/content/metaobjects/types/${typeId}/entries`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify({
        handle: 'shipping',
        name: 'Shipping policy',
        status: 'published',
        fields: {
          question: 'Do you ship internationally?',
          answer: '<p>Yes, we ship to 30 countries.</p>',
        },
      }),
    });
    return { status: r.status, body: await r.json() };
  }, { api: API, token, typeId });
  expect(entry.status).toBe(201);

  // 3. Public list returns only published entries of this type.
  const listResp = await request.get(`${API}/api/storefront/metaobjects/${handle}`);
  expect(listResp.status()).toBe(200);
  const list = await listResp.json();
  expect(list.items.length).toBe(1);
  expect(list.items[0].name).toBe('Shipping policy');
  expect(list.items[0].fields.answer).toContain('30 countries');

  // 4. Public single-entry lookup by slug.
  const oneResp = await request.get(`${API}/api/storefront/metaobjects/${handle}/shipping`);
  expect(oneResp.status()).toBe(200);
  const one = await oneResp.json();
  expect(one.handle).toBe('shipping');
});

test('Metaobjects: entry validation — missing required field fails', async ({ page }) => {
  await adminLogin(page);
  const token = await csrf(page);
  const handle = `vtest_${Date.now()}`;

  const created = await page.evaluate(async ({ api, token, handle }) => {
    const r = await fetch(`${api}/api/admin/content/metaobjects/types`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify({
        handle, name: 'Size chart',
        fieldDefs: [
          { key: 'title', name: 'Title', type: 'single_line_text', required: true },
        ],
      }),
    });
    return await r.json();
  }, { api: API, token, handle });
  const typeId: string = created.id;

  const bad = await page.evaluate(async ({ api, token, typeId }) => {
    const r = await fetch(`${api}/api/admin/content/metaobjects/types/${typeId}/entries`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify({
        handle: 'draft-1', name: 'Draft', status: 'draft',
        fields: {}, // missing required "title"
      }),
    });
    return { status: r.status, body: await r.json() };
  }, { api: API, token, typeId });
  expect(bad.status).toBe(400);
  expect(bad.body.error).toContain('title');
});

test('Metaobjects: drafts 404 on the storefront', async ({ page, request }) => {
  await adminLogin(page);
  const token = await csrf(page);
  const handle = `d_${Date.now()}`;

  const t = await page.evaluate(async ({ api, token, handle }) => {
    const r = await fetch(`${api}/api/admin/content/metaobjects/types`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify({ handle, name: 'D', fieldDefs: [] }),
    });
    return await r.json();
  }, { api: API, token, handle });

  await page.evaluate(async ({ api, token, typeId }) => {
    await fetch(`${api}/api/admin/content/metaobjects/types/${typeId}/entries`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify({
        handle: 'hidden', name: 'Hidden', status: 'draft', fields: {},
      }),
    });
  }, { api: API, token, typeId: t.id });

  // Public list is empty.
  const list = await request.get(`${API}/api/storefront/metaobjects/${handle}`).then((r) => r.json());
  expect(list.items).toEqual([]);

  // Direct slug lookup is 404.
  const direct = await request.get(`${API}/api/storefront/metaobjects/${handle}/hidden`);
  expect(direct.status()).toBe(404);
});
