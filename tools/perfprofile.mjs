// Measures frame times under several renderer configurations to find what costs the most.
// Usage: node tools/perfprofile.mjs [url-query]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const port = 5177;
const q = process.argv[2] ?? 'autostart=1&spectate=1&players=4&size=168&map=forest&fast=300';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((res) => server.stdout.on('data', (d) => String(d).includes('Local') && res()));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(`http://localhost:${port}/?${q}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const s = window.__session, g = s.game;
    const own = g.units.filter((u) => u.owner === 1);
    const mx = own.reduce((a, u) => a + u.x, 0) / own.length, mz = own.reduce((a, u) => a + u.z, 0) / own.length;
    s.renderer.centerOn(mx, mz);
  });
  const measure = () => page.evaluate(() => new Promise((res) => {
    const times = []; let last = performance.now(); const t0 = last;
    const f = () => {
      const now = performance.now(); times.push(now - last); last = now;
      if (now - t0 < 3000) requestAnimationFrame(f);
      else { times.sort((a, b) => a - b); res(`fps ${(times.length / 3).toFixed(1)}  p50 ${times[Math.floor(times.length / 2)].toFixed(1)}ms`); }
    };
    requestAnimationFrame(f);
  }));
  const configs = [
    ['medium (default)', () => {}],
    ['medium, no ground clutter', () => { window.__session.renderer.ground.group.visible = false; }],
    ['medium, no leaves/clutter', () => {
      window.__session.renderer.props.group.traverse((o) => { if (o.userData.noAO) o.material.visible = false; });
    }],
    ['medium, zoomed out', () => {
      const r = window.__session.renderer;
      r.ground.group.visible = true;
      r.props.group.traverse((o) => { if (o.userData.noAO) o.material.visible = true; });
      r.setZoom(30);
    }],
    ['low, zoomed out', () => window.__session.renderer.setQuality('low')],
  ];
  for (const [name, fn] of configs) {
    await page.evaluate(fn);
    await page.waitForTimeout(800);
    console.log(name.padEnd(32), await measure());
  }
} finally {
  console.log('errors:', errors.slice(0, 5).join('\n') || 'none');
  await browser.close();
  server.kill();
}
