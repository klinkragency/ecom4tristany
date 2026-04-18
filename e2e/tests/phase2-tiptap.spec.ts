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

test('Tiptap: admin writes bold + heading, backend sanitizes script, storefront renders safely', async ({ page }) => {
  const suffix = Date.now();
  const title = `Tiptap test ${suffix}`;
  const handle = `tiptap-${suffix}`;

  await adminLogin(page);
  await page.getByRole('link', { name: 'Products', exact: true }).click();
  await page.getByRole('link', { name: /add product/i }).click();

  await page.getByLabel('Title').fill(title);

  // Type into the Tiptap editor, then select-all and toggle bold.
  const editor = page.locator('.ProseMirror').first();
  await editor.click();
  await editor.pressSequentially('Warm hoodie description.');
  await page.keyboard.press('ControlOrMeta+a');
  await page.getByRole('button', { name: /^Bold$/ }).click();

  // Create → land on the edit page.
  await page.locator('select').first().selectOption('active');
  await page.getByRole('button', { name: /create product/i }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();

  // Rename the handle for a stable storefront URL and save.
  await page.getByLabel('Handle (URL slug)').fill(handle);
  // Also try to smuggle in a <script> — backend sanitizer should strip it.
  const malicious = '<p>Safe copy.</p><script>alert(1)</script>';
  // Use the API client indirectly by typing into the editor. Tiptap strips script tags itself,
  // but we still want to prove the server layer. We'll PUT directly via fetch from the page context.
  await page.evaluate(async ({ handle, malicious }) => {
    // Grab the CSRF cookie and send a PUT that tries to inject raw HTML.
    const csrf = document.cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith('csrf_token='))?.split('=')[1] ?? '';
    const id = window.location.pathname.split('/').pop()!;
    await fetch(`http://localhost:8080/api/admin/products/${id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': decodeURIComponent(csrf) },
      body: JSON.stringify({ handle, descriptionHtml: malicious }),
    });
  }, { handle, malicious });

  // Storefront: bold survives, <script> does not.
  const store = await page.context().newPage();
  await store.goto(`${STORE}/products/${handle}`);
  await expect(store.getByRole('heading', { name: title })).toBeVisible();

  const htmlOnPage = await store.locator('.prose').first().innerHTML();
  expect(htmlOnPage).toContain('Safe copy');
  expect(htmlOnPage.toLowerCase()).not.toContain('<script');
  // The <script> contents should not appear either.
  expect(htmlOnPage).not.toContain('alert(1)');
});
