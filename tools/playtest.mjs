// Drives the real UI with mouse/keyboard to verify input handling.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const port = 5175;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((res) => server.stdout.on('data', (d) => String(d).includes('Local') && res()));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message + '\n' + e.stack));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
try {
  await page.goto(`http://localhost:${port}/?autostart=1&seed=4242`);
  await page.waitForFunction(() => window.__ready === true);
  await page.waitForTimeout(800);
  const state = () => page.evaluate(() => {
    const s = window.__session, g = s.game;
    return {
      sel: s.selection.length,
      res: g.players[1].res,
      buildings: g.buildings.filter((b) => b.owner === 1).map((b) => `${b.type}${b.built ? '' : '*'}`),
      vills: g.units.filter((u) => u.owner === 1 && u.type === 'villager').map((u) => u.order.t + (u.order.t === 'gather' ? ':' + u.gatherKind : '')),
      queue: g.buildings.filter((b) => b.owner === 1).map((b) => b.queue.map((q) => q.id)).flat(),
    };
  });
  // helper: screen position of a world point
  const screenOf = (x, z) => page.evaluate(([x, z]) => {
    const r = window.__session.renderer;
    return r.project(x, window.__session.game.map.heightAt(x, z) + 0.4, z);
  }, [x, z]);
  // 1) box-select all villagers by dragging across the screen center
  await page.mouse.move(300, 120);
  await page.mouse.down();
  await page.mouse.move(1300, 650, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  console.log('after box select:', await state());
  // 2) Q (build economic) then Q (house) then click near TC
  await page.keyboard.press('q');
  await page.waitForTimeout(100);
  await page.keyboard.press('q');
  await page.waitForTimeout(100);
  const tc = await page.evaluate(() => { const b = window.__session.game.buildings.find((b) => b.owner === 1 && b.type === 'townCenter'); return { x: b.x, z: b.z }; });
  let p = await screenOf(tc.x + 6, tc.z + 1);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(150);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(300);
  console.log('after house placement:', await state());
  // 3) select TC with H and queue 3 villagers with shift+Q
  await page.keyboard.press('h');
  await page.waitForTimeout(100);
  await page.keyboard.down('Shift');
  await page.keyboard.press('q');
  await page.keyboard.up('Shift');
  await page.waitForTimeout(200);
  console.log('after TC queue:', await state());
  // 4) select villagers again and right-click berries
  const berry = await page.evaluate(() => {
    const g = window.__session.game; const tc = g.buildings.find((b) => b.owner === 1 && b.type === 'townCenter');
    const r = g.resources.filter((r) => r.type === 'berries').sort((a, b) => Math.hypot(a.x - tc.x, a.z - tc.z) - Math.hypot(b.x - tc.x, b.z - tc.z))[0];
    return { x: r.x, z: r.z };
  });
  await page.keyboard.press('.');
  await page.waitForTimeout(100);
  p = await screenOf(berry.x, berry.z);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.waitForTimeout(300);
  console.log('after right-click berries (idle villager):', await state());
  // 5) let the game run 20 seconds
  await page.evaluate(() => { window.__session.speed = 4; });
  await page.waitForTimeout(5000);
  console.log('after 20s:', await state());
  await page.screenshot({ path: 'screenshots/playtest.png' });
  // 6) FPS measurement
  const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(n / 3); }; requestAnimationFrame(f); }));
  console.log('FPS (early game):', fps.toFixed(1));
} finally {
  console.log('errors:', errors.slice(0, 10).join('\n---\n') || 'none');
  await browser.close();
  server.kill();
}
