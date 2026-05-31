import { chromium } from '/Users/hassan/Downloads/temp/BloomOulu/production/node_modules/.pnpm/playwright@1.60.0/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

mkdirSync('/tmp/bloom-mobile/e2e', { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 320, height: 568 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();

const steps = [];
const log = (msg, png) => { console.log(msg); steps.push({ msg, png }); };

async function shot(name) {
  const p = `/tmp/bloom-mobile/e2e/${name}.png`;
  await page.screenshot({ path: p, fullPage: true });
  return p;
}

async function overflow() {
  return await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

try {
  // Step 1: visit plants index
  await page.goto('http://localhost:3000/en/plants', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  let o = await overflow();
  log(`Step 1: /en/plants loaded (overflow=${o}px)`, await shot('1-plants'));

  // Step 2: type a search query
  const search = page.locator('input#plant-search');
  if (await search.count()) {
    await search.click();
    await search.fill('puls');
    await page.waitForTimeout(800);
    o = await overflow();
    log(`Step 2: searched "puls" (overflow=${o}px)`, await shot('2-plants-search'));
  } else {
    log('Step 2: search input not found, skipping', null);
  }

  // Step 3: click first plant link in the list
  const cards = page.locator('a[href*="/en/plants/"]:visible');
  const ccount = await cards.count();
  if (ccount > 0) {
    await cards.first().click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);
    o = await overflow();
    log(`Step 3: opened first plant detail (overflow=${o}px) URL=${page.url()}`, await shot('3-plant-detail'));
  } else {
    log('Step 3: no plant cards found, jumping to /adopt direct', null);
    await page.goto('http://localhost:3000/en/adopt');
    await page.waitForTimeout(1500);
  }

  // Step 4: navigate to /en/adopt directly
  await page.goto('http://localhost:3000/en/adopt');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
  o = await overflow();
  log(`Step 4: /en/adopt step 1 (overflow=${o}px)`, await shot('4-adopt-step1'));

  // Step 5: click first tier card "Continue" button if present
  const continueBtn = page.locator('button:has-text("Continue"), button:has-text("Jatka")');
  const ccnt = await continueBtn.count();
  if (ccnt > 0) {
    await continueBtn.first().scrollIntoViewIfNeeded();
    await continueBtn.first().click();
    await page.waitForTimeout(1500);
    o = await overflow();
    log(`Step 5: clicked Continue → step 2 (overflow=${o}px)`, await shot('5-adopt-step2'));
  }

  // Step 6: pick a plant
  const plantPick = page.locator('button:has(img), button:has-text("Pulsatilla"), label:has-text("Pulsatilla")');
  if (await plantPick.count()) {
    await plantPick.first().scrollIntoViewIfNeeded();
    await plantPick.first().click();
    await page.waitForTimeout(800);
    o = await overflow();
    log(`Step 6: picked a plant (overflow=${o}px)`, await shot('6-adopt-picked'));
  }

  // Step 7: try ask page
  await page.goto('http://localhost:3000/en/ask');
  await page.waitForTimeout(1500);
  const ta = page.locator('textarea');
  if (await ta.count()) {
    await ta.first().click();
    // Verify iOS does NOT zoom: textarea font-size should be >= 16px
    const fs = await ta.first().evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    log(`Step 7: /ask textarea font-size=${fs}px (iOS-safe if >=16)`, await shot('7-ask-input'));
    await ta.first().fill('Which plants here are endangered?');
    o = await overflow();
    log(`Step 7b: typed query (overflow=${o}px)`, await shot('7b-ask-typed'));
  }

  // Step 8: Cart
  await page.goto('http://localhost:3000/en/cart');
  await page.waitForTimeout(1200);
  o = await overflow();
  log(`Step 8: /cart (overflow=${o}px)`, await shot('8-cart'));

  // Step 9: Plant detail action — try save-to-garden
  await page.goto('http://localhost:3000/en/plants');
  await page.waitForTimeout(1500);
  const firstCard = page.locator('a[href*="/en/plants/"]:visible').first();
  if (await firstCard.count()) {
    await firstCard.click();
    await page.waitForTimeout(1500);
    const saveBtn = page.locator('button[aria-label*="Save"], button[aria-label*="bookmark"], button[aria-label*="Garden"]');
    const sc = await saveBtn.count();
    log(`Step 9: plant detail save-button count=${sc}`, await shot('9-plant-actions'));
    if (sc > 0) {
      // Get its visible size to confirm tap target sizing
      const box = await saveBtn.first().boundingBox();
      log(`Step 9b: save button box w=${box?.width} h=${box?.height} (>=40 is good)`, null);
    }
  }

} catch (e) {
  console.log('ERROR:', e.message);
  await shot('error');
}

await browser.close();
console.log('\nE2E walkthrough complete.');
