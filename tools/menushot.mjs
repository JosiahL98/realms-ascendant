import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const port = 5177;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((res) => server.stdout.on('data', (d) => String(d).includes('Local') && res()));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(`http://localhost:${port}/`);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'screenshots/menu_main.png' });
  await page.click('text=Single Player');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'screenshots/menu_setup.png' });
  await page.click('text=Back');
  await page.click('text=The Eight Realms');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshots/menu_civs.png', fullPage: false });
} finally {
  console.log('errors:', errors.join('\n') || 'none');
  await browser.close();
  server.kill();
}
