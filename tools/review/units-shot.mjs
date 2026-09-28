// Screenshots of the unit viewer (units-viewer.html, served by a running Vite dev server).
// Usage: node tools/review/units-shot.mjs <out.png> '<query>' '<shots json array>' [cols]
//   e.g. node tools/review/units-shot.mjs out.png 'units=knight&anim=attack' '[{"t":0.3},{"t":0.75}]'
// Each shot is window.__shot(options); several shots are laid side by side in one PNG.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const [out, query, shotsArg, colsArg] = process.argv.slice(2);
const base = process.env.VIEWER || 'http://localhost:5199/tools/review/units-viewer.html';
const shots = JSON.parse(shotsArg || '[{}]');
const W = Number(process.env.W || 480), H = Number(process.env.H || 420);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
page.on('pageerror', (e) => logs.push(e.message));
await page.goto(`${base}?${query}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
const urls = [];
for (const s of shots) urls.push(await page.evaluate((o) => window.__shot(o), s));
// compose on a canvas in the page
const cols = Number(colsArg || Math.min(shots.length, 4));
const png = await page.evaluate(async ({ urls, cols, W, H }) => {
  const c = document.createElement('canvas');
  const rows = Math.ceil(urls.length / cols);
  c.width = W * cols; c.height = H * rows;
  const g = c.getContext('2d');
  for (let i = 0; i < urls.length; i++) {
    const im = new Image();
    im.src = urls[i];
    await im.decode();
    g.drawImage(im, (i % cols) * W, Math.floor(i / cols) * H, W, H);
  }
  return c.toDataURL('image/png');
}, { urls, cols, W, H });
writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
console.log(logs.slice(0, 8).join('\n') || 'ok');
await browser.close();
