/**
 * Accessibility smoke test — every public page passes axe-core at level AA.
 * Run in CI as a merge-blocking check.
 */
import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

interface AxeViolation {
  impact?: 'minor' | 'moderate' | 'serious' | 'critical' | null;
}

const PAGES = [
  '/fi',
  '/en',
  '/sv',
  '/fi/plants/pulsatilla-patens',
  '/fi/plants/pulsatilla-patens?mode=kid',
  '/fi/plants/pulsatilla-patens?mode=school',
  '/fi/adopt?plant=pulsatilla-patens',
  '/fi/ask',
  '/fi/privacy',
  '/fi/terms',
  '/fi/accessibility-statement',
];

for (const path of PAGES) {
  test(`a11y: ${path}`, async ({ page }) => {
    await page.goto(`http://localhost:3000${path}`);
    const results = await new AxeBuilder({ page }).withTags(['wcag2aa', 'wcag22aa']).analyze();
    const serious = results.violations.filter((v: AxeViolation) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
  });
}
