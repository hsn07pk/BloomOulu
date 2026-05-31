import { chromium } from '/Users/hassan/Downloads/temp/BloomOulu/production/node_modules/.pnpm/playwright@1.60.0/node_modules/playwright/index.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const VIEWPORTS = [
  { name: 'iPhone5_320', w: 320, h: 568 },
  { name: 'Galaxy_360', w: 360, h: 800 },
  { name: 'iPhoneSE_375', w: 375, h: 667 },
  { name: 'iPhone13_390', w: 390, h: 844 },
  { name: 'Pixel_412', w: 412, h: 915 },
  { name: 'ProMax_430', w: 430, h: 932 },
];

const ROUTES = [
  // Production web (Next.js :3000)
  { host: 'http://localhost:3000', path: '/en',                          tag: 'web-home' },
  { host: 'http://localhost:3000', path: '/en/plants',                   tag: 'web-plants' },
  { host: 'http://localhost:3000', path: '/en/plants/pulsatilla-patens', tag: 'web-plant-detail' },
  { host: 'http://localhost:3000', path: '/en/adopt',                    tag: 'web-adopt' },
  { host: 'http://localhost:3000', path: '/en/ask',                      tag: 'web-ask' },
  { host: 'http://localhost:3000', path: '/en/donate',                   tag: 'web-donate' },
  { host: 'http://localhost:3000', path: '/en/donate/pay?amount=2500',   tag: 'web-donate-pay' },
  { host: 'http://localhost:3000', path: '/en/donate/complete',          tag: 'web-donate-complete' },
  { host: 'http://localhost:3000', path: '/en/donors',                   tag: 'web-donors' },
  { host: 'http://localhost:3000', path: '/en/cart',                     tag: 'web-cart' },
  { host: 'http://localhost:3000', path: '/en/garden',                   tag: 'web-garden' },
  { host: 'http://localhost:3000', path: '/en/me',                       tag: 'web-me' },
  { host: 'http://localhost:3000', path: '/en/me/profile',               tag: 'web-me-profile' },
  { host: 'http://localhost:3000', path: '/en/sign-in',                  tag: 'web-signin' },
  { host: 'http://localhost:3000', path: '/en/sign-in/sent',             tag: 'web-signin-sent' },
  { host: 'http://localhost:3000', path: '/en/privacy',                  tag: 'web-privacy' },
  { host: 'http://localhost:3000', path: '/en/terms',                    tag: 'web-terms' },
  { host: 'http://localhost:3000', path: '/en/accessibility-statement',  tag: 'web-a11y' },
  { host: 'http://localhost:3000', path: '/en/staff',                    tag: 'web-staff' },
  // Kiosk
  { host: 'http://localhost:3100', path: '/',                            tag: 'kiosk-home' },
  // Demo design (static)
  { host: 'http://localhost:8000', path: '/demo-design/',                tag: 'demo-discover' },
  { host: 'http://localhost:8000', path: '/demo-design/#plant=puls-pat', tag: 'demo-plant' },
  { host: 'http://localhost:8000', path: '/demo-design/#screen=adopt',   tag: 'demo-adopt' },
  { host: 'http://localhost:8000', path: '/demo-design/#screen=ask',     tag: 'demo-ask' },
  { host: 'http://localhost:8000', path: '/demo-design/#screen=garden',  tag: 'demo-garden' },
  { host: 'http://localhost:8000', path: '/demo-design/#screen=kiosk',   tag: 'demo-kiosk' },
];

const SCREENSHOT_DIR = '/tmp/bloom-mobile';
mkdirSync(SCREENSHOT_DIR, { recursive: true });

const AUDIT_FN = () => {
  const doc = document.documentElement;
  const cw = doc.clientWidth;
  const overflowX = doc.scrollWidth - cw;

  const overflowing = [];
  document.querySelectorAll('body *').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.right > cw + 1 && r.width > 0 && r.height > 0) {
      const style = getComputedStyle(el);
      // skip elements where parent has overflow:hidden/auto/scroll
      let p = el.parentElement;
      let clipped = false;
      while (p) {
        const ps = getComputedStyle(p);
        if (['hidden','auto','scroll','clip'].includes(ps.overflowX) || ['hidden','auto','scroll','clip'].includes(ps.overflow)) {
          clipped = true; break;
        }
        p = p.parentElement;
      }
      if (clipped) return;
      overflowing.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().slice(0, 70),
        right: Math.round(r.right),
        width: Math.round(r.width),
        text: (el.textContent || '').trim().slice(0, 40),
      });
    }
  });

  const smallTargets = [];
  document.querySelectorAll('button, a, [role="button"], input[type="checkbox"], input[type="radio"], select').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    if (r.width < 36 || r.height < 36) {
      smallTargets.push({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30),
        w: Math.round(r.width),
        h: Math.round(r.height),
      });
    }
  });

  return {
    url: location.href,
    vp: { w: innerWidth, h: innerHeight },
    overflowX,
    overflowingCount: overflowing.length,
    overflowing: overflowing.sort((a, b) => b.right - a.right).slice(0, 8),
    smallTargetsCount: smallTargets.length,
    smallTargets: smallTargets.slice(0, 6),
  };
};

const report = {};
const browser = await chromium.launch();
for (const vp of VIEWPORTS) {
  console.log(`\n=== Viewport ${vp.name} (${vp.w}x${vp.h}) ===`);
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  for (const r of ROUTES) {
    const key = `${r.tag}@${vp.name}`;
    try {
      await page.goto(r.host + r.path, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(800);
      const data = await page.evaluate(AUDIT_FN);
      report[key] = data;
      const mark = data.overflowX > 0 ? `⚠ overflow ${data.overflowX}px` : '✓';
      console.log(`  ${r.tag.padEnd(25)} ${mark}  smallTargets=${data.smallTargetsCount}`);
      if (data.overflowX > 0) {
        const png = `${SCREENSHOT_DIR}/${r.tag}-${vp.name}.png`;
        await page.screenshot({ path: png, fullPage: true });
      }
    } catch (e) {
      report[key] = { error: e.message.slice(0, 200) };
      console.log(`  ${r.tag.padEnd(25)} ✗ ${e.message.slice(0, 60)}`);
    }
  }
  await ctx.close();
}
await browser.close();
writeFileSync('/tmp/bloom-mobile/audit.json', JSON.stringify(report, null, 2));
console.log('\nReport written to /tmp/bloom-mobile/audit.json');
