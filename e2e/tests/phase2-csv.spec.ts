import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

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

test('CSV export downloads a non-empty file + CSV import creates products', async ({ page }) => {
  await adminLogin(page);
  await page.getByRole('link', { name: 'Products', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Products$/ })).toBeVisible();

  // 1. Export — the <a download> link hits the backend directly.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: /export csv/i }).click(),
  ]);
  const saved = await download.path();
  expect(saved).toBeTruthy();
  const stat = fs.statSync(saved!);
  expect(stat.size).toBeGreaterThan(100);
  const first = fs.readFileSync(saved!, 'utf8').split('\n')[0];
  expect(first).toContain('Handle,Title');

  // 2. Import a fresh small CSV.
  const suffix = Date.now();
  const csvPath = path.join(os.tmpdir(), `shop-import-${suffix}.csv`);
  const handle = `csv-test-${suffix}`;
  fs.writeFileSync(
    csvPath,
    [
      'Handle,Title,Body HTML,Vendor,Type,Tags,Status,Option1 Name,Option1 Value,Option2 Name,Option2 Value,Option3 Name,Option3 Value,Variant SKU,Variant Barcode,Variant Price,Variant Compare At Price,Variant Weight Grams,SEO Title,SEO Description',
      `${handle},CSV test ${suffix},<p>From Playwright.</p>,ACME,Test,playwright,active,Size,S,,,,,SKU-S-${suffix},,9.99,,100,,`,
      `${handle},,,,,,,Size,M,,,,,SKU-M-${suffix},,11.99,,120,,`,
    ].join('\n'),
  );

  // Trigger the hidden file input and wait for the import summary card.
  await page.setInputFiles('input[type="file"][accept=".csv,text/csv"]', csvPath);
  await expect(page.getByText(/Import complete/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/2 rows/)).toBeVisible();
  await expect(page.getByText(/1 created/)).toBeVisible();

  // Verify it shows up in the list (may need refresh depending on state).
  await page.getByPlaceholder(/search/i).fill(handle);
  await page.getByPlaceholder(/search/i).press('Enter');
  await expect(page.getByRole('link', { name: new RegExp(`CSV test ${suffix}`) })).toBeVisible();

  fs.unlinkSync(csvPath);
});
