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

async function adminCSRF(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(async (api) => {
    const r = await fetch(`${api}/api/csrf`, { credentials: 'include' });
    const j = await r.json();
    return j.csrfToken as string;
  }, API);
}

test('CMS: create a published page, fetch it on the storefront', async ({ page, browser }) => {
  await adminLogin(page);
  const slug = `about-${Date.now()}`;
  const token = await adminCSRF(page);
  const create = await page.evaluate(async ({ api, token, slug }) => {
    const r = await fetch(`${api}/api/admin/content/pages`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify({
        slug, title: 'About us', contentHtml: '<p>Hello world</p>',
        excerpt: '', metaDescription: 'about page', status: 'published',
      }),
    });
    return r.status;
  }, { api: API, token, slug });
  expect(create).toBe(201);

  // Fetch the published page from the storefront.
  const storeCtx = await browser.newContext();
  const storePage = await storeCtx.newPage();
  await storePage.goto(`${STORE}/pages/${slug}`);
  await expect(storePage.getByRole('heading', { name: /About us/ })).toBeVisible();
  await expect(storePage.getByText(/Hello world/)).toBeVisible();
  await storeCtx.close();
});

test('CMS: draft pages 404 on the storefront', async ({ page }) => {
  await adminLogin(page);
  const slug = `draft-${Date.now()}`;
  const token = await adminCSRF(page);
  await page.evaluate(async ({ api, token, slug }) => {
    await fetch(`${api}/api/admin/content/pages`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify({ slug, title: 'Draft', contentHtml: '', status: 'draft' }),
    });
  }, { api: API, token, slug });

  const res = await fetch(`${API}/api/storefront/pages/${slug}`);
  expect(res.status).toBe(404);
});

test('Blog: create a post, see it in listing and detail + RSS feed', async ({ page, browser }) => {
  await adminLogin(page);
  const slug = `hello-${Date.now()}`;
  const token = await adminCSRF(page);
  const create = await page.evaluate(async ({ api, token, slug }) => {
    const r = await fetch(`${api}/api/admin/content/blog`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify({
        slug, title: 'Hello Blog World', excerpt: 'First post excerpt',
        contentHtml: '<p>Post body here.</p>',
        authorName: 'Tristany', featuredImageUrl: '', metaDescription: '',
        status: 'published', tags: ['launch'],
      }),
    });
    return r.status;
  }, { api: API, token, slug });
  expect(create).toBe(201);

  // Storefront listing.
  const storeCtx = await browser.newContext();
  const storePage = await storeCtx.newPage();
  await storePage.goto(`${STORE}/blog`);
  await expect(storePage.getByRole('heading', { name: /Hello Blog World/ })).toBeVisible();

  // Detail page.
  await storePage.goto(`${STORE}/blog/${slug}`);
  await expect(storePage.getByRole('heading', { name: /Hello Blog World/ })).toBeVisible();
  await expect(storePage.getByText(/Post body here\./)).toBeVisible();

  // RSS.
  const feedRes = await fetch(`${API}/api/storefront/blog/feed.xml`);
  expect(feedRes.headers.get('content-type')).toContain('rss');
  const feedBody = await feedRes.text();
  expect(feedBody).toContain('Hello Blog World');
  await storeCtx.close();
});

test('Menus: edit header menu, see link appear on storefront', async ({ page, browser }) => {
  await adminLogin(page);
  // Look up the "main" menu id.
  const token = await adminCSRF(page);
  const { id } = await page.evaluate(async (api) => {
    const r = await fetch(`${api}/api/admin/content/menus`, { credentials: 'include' });
    const j = await r.json();
    const m = j.items.find((x: { handle: string; id: string }) => x.handle === 'main');
    return { id: m.id as string };
  }, API);

  const label = `TestLink-${Date.now()}`;
  const save = await page.evaluate(async ({ api, token, id, label }) => {
    const r = await fetch(`${api}/api/admin/content/menus/${id}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify({
        name: 'Header navigation',
        items: [{ label, linkType: 'url', target: '/products', openInNewTab: false }],
      }),
    });
    return r.status;
  }, { api: API, token, id, label });
  expect(save).toBe(200);

  // Storefront should now render the link in its header.
  const storeCtx = await browser.newContext();
  const storePage = await storeCtx.newPage();
  await storePage.goto(`${STORE}/`);
  await expect(storePage.getByRole('link', { name: label })).toBeVisible();
  await storeCtx.close();
});
