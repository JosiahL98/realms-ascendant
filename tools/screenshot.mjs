// Usage: node tools/screenshot.mjs [url-query] [out.png] [waitMs]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const query = process.argv[2] ?? '';
const out = process.argv[3] ?? 'screenshots/shot.png';
const waitMs = Number(process.argv[4] ?? 1500);
const width = Number(process.env.W ?? 1600), height = Number(process.env.H ?? 900);
mkdirSync('screenshots', { recursive: true });

const port = 5174;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('vite start timeout')), 30000);
  server.stdout.on('data', (d) => { if (String(d).includes('Local')) { clearTimeout(t); res(); } });
  server.stderr.on('data', (d) => process.stderr.write(d));
});
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
try {
  const page = await browser.newPage({ viewport: { width, height } });
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
  await page.goto(`http://localhost:${port}/?${query}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 }).catch((e) => logs.push('ready timeout: ' + e.message));
  await page.waitForTimeout(waitMs);
  if (process.env.EVAL) {
    const r = await page.evaluate(process.env.EVAL);
    console.log('EVAL:', JSON.stringify(r));
    await page.waitForTimeout(Number(process.env.WAIT2 ?? 500));
  }
  await page.screenshot({ path: out });
  const info = await page.evaluate(() => {
    const gl = document.querySelector('canvas')?.getContext('webgl2');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'n/a' };
  }).catch(() => ({}));
  console.log('GPU:', info.renderer);
  console.log(logs.slice(0, 40).join('\n'));
  console.log('saved', out);
} finally {
  await browser.close();
  server.kill();
}
