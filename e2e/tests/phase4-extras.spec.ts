import { test, expect } from '@playwright/test';

const STORE = 'http://localhost:3000';
const MAILPIT_API = 'http://localhost:8025/api/v1';

// Reset the mailpit inbox so we can pick the right reset email.
async function clearMailpit() {
  await fetch(`${MAILPIT_API}/messages`, { method: 'DELETE' }).catch(() => {});
}

test('Password reset: request a link, follow it, sign in with the new password', async ({ page }) => {
  const email = `reset+${Date.now()}@test.com`;
  const oldPw = 'oldpass123';
  const newPw = 'brandnewpass123';

  // 1. Register a customer we can reset.
  await page.goto(`${STORE}/account/register`);
  await page.getByLabel('First name').fill('Reset');
  await page.getByLabel('Last name').fill('Tester');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/password/i).fill(oldPw);
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/account$/);
  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/account\/login$/);

  // 2. Clear mailpit, then request a reset.
  await clearMailpit();
  await page.getByRole('link', { name: /forgot password/i }).click();
  await expect(page).toHaveURL(/\/account\/password-reset$/);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: /send reset link/i }).click();
  await expect(page.getByRole('heading', { name: /check your email/i })).toBeVisible();

  // 3. Fetch the reset link from Mailpit.
  // Mailpit can be slow for first message; poll.
  let resetUrl = '';
  for (let i = 0; i < 10 && !resetUrl; i++) {
    await page.waitForTimeout(500);
    const res = await fetch(`${MAILPIT_API}/messages`);
    const data = (await res.json()) as { messages: { ID: string; Subject: string; To: { Address: string }[] }[] };
    const msg = data.messages.find((m) => m.To.some((t) => t.Address === email));
    if (!msg) continue;
    const msgRes = await fetch(`${MAILPIT_API}/message/${msg.ID}`);
    const full = (await msgRes.json()) as { HTML?: string; Text?: string };
    const body = full.HTML ?? full.Text ?? '';
    const match = body.match(/\/account\/password-reset\/confirm\?token=([^\s"'<]+)/);
    if (match) {
      resetUrl = `${STORE}/account/password-reset/confirm?token=${match[1]}`;
    }
  }
  expect(resetUrl).toBeTruthy();

  // 4. Follow the reset URL, set a new password.
  await page.goto(resetUrl);
  await expect(page.getByRole('heading', { name: /choose a new password/i })).toBeVisible();
  await page.getByLabel('New password (8+ chars)').fill(newPw);
  await page.getByLabel('Confirm password').fill(newPw);
  await page.getByRole('button', { name: /set new password/i }).click();
  await expect(page.getByRole('heading', { name: /password updated/i })).toBeVisible();

  // 5. Sign in with the new password.
  await page.goto(`${STORE}/account/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(newPw);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/account$/);
});
