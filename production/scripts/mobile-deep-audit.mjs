import { chromium } from '/Users/hassan/Downloads/temp/BloomOulu/production/node_modules/.pnpm/playwright@1.60.0/node_modules/playwright/index.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const VIEWPORTS = [
  { name: 'iPhone5_320', w: 320, h: 568 },
  { name: 'iPhone13_390', w: 390, h: 844 },
];

const ROUTES = [
  { host: 'http://localhost:3000', path: '/en',                          tag: 'web-home' },
  { host: 'http://localhost:3000', path: '/en/plants',                   tag: 'web-plants' },
  { host: 'http://localhost:3000', path: '/en/plants/pulsatilla-patens', tag: 'web-plant-detail' },
  { host: 'http://localhost:3000', path: '/en/adopt',                    tag: 'web-adopt' },
  { host: 'http://localhost:3000', path: '/en/ask',                      tag: 'web-ask' },
  { host: 'http://localhost:3000', path: '/en/donate',                   tag: 'web-donate' },
  { host: 'http://localhost:3000', path: '/en/donate/pay?amount=2500',   tag: 'web-donate-pay' },
  { host: 'http://localhost:3000', path: '/en/donors',                   tag: 'web-donors' },
  { host: 'http://localhost:3000', path: '/en/cart',                     tag: 'web-cart' },
  { host: 'http://localhost:3000', path: '/en/garden',                   tag: 'web-garden' },
  { host: 'http://localhost:3000', path: '/en/me',                       tag: 'web-me' },
  { host: 'http://localhost:3000', path: '/en/sign-in',                  tag: 'web-signin' },
  { host: 'http://localhost:3000', path: '/en/privacy',                  tag: 'web-privacy' },
  { host: 'http://localhost:3000', path: '/en/terms',                    tag: 'web-terms' },
  { host: 'http://localhost:3000', path: '/en/accessibility-statement',  tag: 'web-a11y' },
  { host: 'http://localhost:3100', path: '/',                            tag: 'kiosk-home' },
];

const DIR = '/tmp/bloom-mobile/deep';
mkdirSync(DIR, { recursive: true });

const DEEP_AUDIT = () => {
  const doc = document.documentElement;
  const cw = doc.clientWidth;

  // 1. forms — text-entry inputs/textareas where font-size < 16px. iOS
  //    Safari only triggers auto-zoom for text/email/password/search/url/
  //    tel/number inputs (and textarea). Checkboxes, radios, ranges, file
  //    pickers do not zoom regardless of font-size, so exclude them.
  const ZOOM_TYPES = new Set(['text', 'email', 'password', 'search', 'url', 'tel', 'number', '']);
  const smallInputs = [];
  document.querySelectorAll('input, textarea, select').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width === 0) return;
    const type = (el.type || '').toLowerCase();
    if (el.tagName.toLowerCase() === 'input' && !ZOOM_TYPES.has(type)) return;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 16) {
      smallInputs.push({
        tag: el.tagName.toLowerCase(),
        type,
        ph: (el.placeholder || el.getAttribute('aria-label') || '').slice(0, 30),
        fs,
      });
    }
  });

  // 2. images without explicit width/height (CLS risk) or that are very tall
  const imgs = [];
  document.querySelectorAll('img').forEach(img => {
    const r = img.getBoundingClientRect();
    if (r.width === 0) return;
    const hasNaturalDims = img.naturalWidth > 0;
    const isTall = r.height > innerHeight * 1.2;
    if (isTall) imgs.push({ src: (img.src || '').slice(-40), w: Math.round(r.width), h: Math.round(r.height) });
  });

  // 3. fixed-position elements that might block content on mobile
  const fixed = [];
  document.querySelectorAll('body *').forEach(el => {
    const s = getComputedStyle(el);
    if (s.position === 'fixed' || s.position === 'sticky') {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        fixed.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || '').toString().slice(0, 30),
          pos: s.position,
          h: Math.round(r.height),
        });
      }
    }
  });

  // 4. Buttons / links with tap area < 24x24 (WCAG 2.2 AA)
  const tinyTargets = [];
  document.querySelectorAll('button, a, [role="button"]').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    if (r.width < 24 || r.height < 24) {
      tinyTargets.push({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30),
        w: Math.round(r.width),
        h: Math.round(r.height),
      });
    }
  });

  // 5. text overlapping (very rough — check elements whose computed font color matches background)
  // skip for now

  // 6. body computed font-size — readability baseline
  const bodyFs = parseFloat(getComputedStyle(document.body).fontSize);

  return {
    url: location.href,
    bodyFs,
    smallInputs,
    tallImgsCount: imgs.length,
    tallImgs: imgs.slice(0, 3),
    fixedCount: fixed.length,
    fixed: fixed.slice(0, 5),
    tinyTargets: tinyTargets.slice(0, 10),
    docH: doc.scrollHeight,
  };
};

const report = {};
const browser = await chromium.launch();
for (const vp of VIEWPORTS) {
  console.log(`\n=== Viewport ${vp.name} ===`);
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  for (const r of ROUTES) {
    try {
      await page.goto(r.host + r.path, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(800);
      const data = await page.evaluate(DEEP_AUDIT);
      report[`${r.tag}@${vp.name}`] = data;
      const png = `${DIR}/${r.tag}-${vp.name}.png`;
      await page.screenshot({ path: png, fullPage: true });
      const flags = [];
      if (data.smallInputs.length > 0) flags.push(`iosZoom:${data.smallInputs.length}`);
      if (data.tinyTargets.length > 0) flags.push(`tinyTap:${data.tinyTargets.length}`);
      if (data.bodyFs < 14) flags.push(`smallBody:${data.bodyFs}`);
      console.log(`  ${r.tag.padEnd(25)} body=${data.bodyFs}px ${flags.join(' ') || '✓'}`);
    } catch (e) {
      console.log(`  ${r.tag.padEnd(25)} ✗ ${e.message.slice(0, 60)}`);
    }
  }
  await ctx.close();
}
await browser.close();
writeFileSync(`${DIR}/audit.json`, JSON.stringify(report, null, 2));
console.log(`\nDeep audit JSON: ${DIR}/audit.json`);
