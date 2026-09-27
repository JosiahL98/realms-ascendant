// Renders a review page's window.__filmstrip(...args) to a PNG, or (PAGE=1) screenshots the whole page.
// Usage: node tools/review/filmstrip.mjs <page.html> <out.png> [filmstrip args...]
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const [file, out, ...rest] = process.argv.slice(2);
const args = rest.map((x) => (isNaN(Number(x)) ? x : Number(x)));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto('file:///' + file);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 }).catch(() => logs.push('ready timeout'));
await page.waitForTimeout(800);
if (process.env.PAGE) {
  await page.waitForTimeout(2500);
  await page.screenshot({ path: out, fullPage: true });
} else {
  const url = await page.evaluate((a) => window.__filmstrip(...a), args);
  writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
}
console.log(logs.slice(0, 10).join('\n') || 'no errors');
await browser.close();
