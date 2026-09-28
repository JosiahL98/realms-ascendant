// Screenshots of the unit viewer (units-viewer.html, served by a running Vite dev server).
// Usage: node tools/review/units-shot.mjs <out.png> '<query>' '<shots json array>' [cols]
//   e.g. node tools/review/units-shot.mjs out.png 'units=knight&anim=attack' '[{"t":0.3},{"t":0.75}]'
// Each shot is window.__shot(options) (plus an optional caption, "label"); several are laid side by side in one PNG.
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
const labels = shots.map((o) => o.label || '');
const png = await page.evaluate(async ({ urls, cols, W, H, labels }) => {
  const c = document.createElement('canvas');
  const rows = Math.ceil(urls.length / cols);
  c.width = W * cols; c.height = H * rows;
  const g = c.getContext('2d');
  for (let i = 0; i < urls.length; i++) {
    const im = new Image();
    im.src = urls[i];
    await im.decode();
    g.drawImage(im, (i % cols) * W, Math.floor(i / cols) * H, W, H);
    if (labels[i]) {
      // a caption in the corner of each shot
      g.font = '600 15px system-ui, sans-serif';
      const x = (i % cols) * W + 8, y = Math.floor(i / cols) * H + 8;
      const w = g.measureText(labels[i]).width + 12;
      g.fillStyle = 'rgba(255, 252, 240, 0.85)';
      g.fillRect(x, y, w, 22);
      g.fillStyle = '#1d1b16';
      g.fillText(labels[i], x + 6, y + 16);
    }
  }
  return c.toDataURL('image/png');
}, { urls, cols, W, H, labels });
writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
console.log(logs.slice(0, 8).join('\n') || 'ok');
await browser.close();
