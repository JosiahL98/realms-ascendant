// Screenshots the unit viewer page: node tools/viewer/shot.mjs <page.html> <out-prefix>
import { chromium } from 'playwright';
const [file, prefix] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1360, height: 1100 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto('file:///' + file);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 }).catch(() => logs.push('ready timeout'));
await page.click('[data-sel="0"]');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${prefix}_one.png` });
await page.click('[data-mode="all"]');
await page.waitForTimeout(2000);
await page.screenshot({ path: `${prefix}_all.png` });
console.log(logs.slice(0, 10).join('\n') || 'no errors');
await browser.close();
