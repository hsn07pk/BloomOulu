/**
 * Playwright e2e — adoption journey via the web UI.
 *
 *   - Lands on home, clicks featured plant
 *   - Navigates to adopt page
 *   - Picks tier + payment method = bank_transfer
 *   - Submits form
 *   - Lands on bank-instructions page with valid RF reference visible
 *
 * Run via `pnpm test:e2e`. Requires docker-compose.dev.yml up.
 */
import { test, expect } from '@playwright/test';

test.describe('adoption flow', () => {
  test('Finnish donor adopts a plant via bank transfer', async ({ page }) => {
    await page.goto('http://localhost:3000/fi');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Click first featured plant
    await page.locator('a').filter({ hasText: '—' }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Adopt CTA
    await page.getByRole('link', { name: /adoptoi tämä kasvi/i }).click();
    await expect(page).toHaveURL(/\/fi\/adopt/);

    // Pick tier + bank
    await page.getByRole('radio', { name: /siemen/i }).check();
    await page.getByRole('radio', { name: /tilisiirto/i }).check();
    await page.getByLabel(/sähköposti/i).fill('test@bloomoulu.fi');
    await page.getByRole('button', { name: /jatka maksuun/i }).click();

    // Land on instructions
    await expect(page).toHaveURL(/donate\/pay/);
    await expect(page.getByText(/RF\d{2}/)).toBeVisible();
  });

  test('keyboard-only navigation through the form', async ({ page }) => {
    await page.goto('http://localhost:3000/fi/adopt?plant=pulsatilla-patens');
    await page.keyboard.press('Tab'); // skip link
    await page.keyboard.press('Tab'); // first tier radio
    await page.keyboard.press('Space');
    // assertions on accessibility are checked by axe-playwright in a
    // separate file; this just exercises the keyboard path.
  });
});
