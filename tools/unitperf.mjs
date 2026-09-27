// Frame time with a crowd of units on screen, new (baked) unit models against the old procedural ones.
// Usage: node tools/unitperf.mjs [army-a] [army-b]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const port = 5178;
const a = process.argv[2] ?? 'scout*40', b = process.argv[3] ?? 'villager*60';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((res) => server.stdout.on('data', (d) => String(d).includes('Local') && res()));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
try {
  for (const old of [false, true, false]) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await page.goto(`http://localhost:${port}/?autostart=1&reveal=all&battle=1&a=${a}&b=${b}${old ? '&oldunits=1' : ''}`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
    await page.waitForTimeout(2500);
    const r = await page.evaluate(() => new Promise((res) => {
      const times = []; let last = performance.now(); const t0 = last;
      const f = () => {
        const now = performance.now(); times.push(now - last); last = now;
        if (now - t0 < 4000) requestAnimationFrame(f);
        else {
          times.sort((x, y) => x - y);
          res(`fps ${(times.length / 4).toFixed(1)}  p50 ${times[Math.floor(times.length / 2)].toFixed(1)}ms  p95 ${times[Math.floor(times.length * 0.95)].toFixed(1)}ms  units drawn ${window.__session.renderer.units.drawn.length}`);
        }
      };
      requestAnimationFrame(f);
    }));
    console.log(old ? 'old models ' : 'new models ', r);
    await page.close();
  }
} finally {
  await browser.close();
  server.kill();
}
