import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const port = 5176;
const q = process.argv[2] ?? 'autostart=1&spectate=1&players=4&size=168&fast=1800';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((res) => server.stdout.on('data', (d) => String(d).includes('Local') && res()));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message + '\n' + e.stack));
try {
  const t0 = Date.now();
  await page.goto(`http://localhost:${port}/?${q}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  console.log('loaded+fastforward in', Date.now() - t0, 'ms');
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => {
    const s = window.__session, g = s.game;
    // look at the biggest cluster of units of player 1
    const own = g.units.filter((u) => u.owner === 1 && !u.garrisonedIn);
    const mx = own.reduce((a, u) => a + u.x, 0) / own.length, mz = own.reduce((a, u) => a + u.z, 0) / own.length;
    s.renderer.centerOn(mx, mz);
    return { units: g.units.length, buildings: g.buildings.length, resources: g.resources.length, time: g.time, ages: g.players.map((p) => p.age) };
  });
  console.log(info);
  await page.waitForTimeout(500);
  const measure = () => page.evaluate(() => new Promise((res) => {
    const times = []; let last = performance.now(); const t0 = last;
    const f = () => { const now = performance.now(); times.push(now - last); last = now; if (now - t0 < 4000) requestAnimationFrame(f); else { times.sort((a, b) => a - b); res({ fps: times.length / 4, p50: times[Math.floor(times.length / 2)].toFixed(1), p95: times[Math.floor(times.length * 0.95)].toFixed(1), drawn: window.__session.renderer.units.drawn.length, calls: window.__session.renderer.gl.info.render.calls, tris: window.__session.renderer.gl.info.render.triangles }); } };
    requestAnimationFrame(f);
  }));
  console.log('speed 1.5:', await measure());
  await page.evaluate(() => { window.__session.speed = 4; });
  console.log('speed 4:', await measure());
  await page.evaluate(() => { const r = window.__session.renderer; r.setZoom(30); });
  console.log('zoomed out:', await measure());
  await page.screenshot({ path: 'screenshots/perf.png' });
} finally {
  console.log('errors:', errors.slice(0, 5).join('\n') || 'none');
  await browser.close();
  server.kill();
}
