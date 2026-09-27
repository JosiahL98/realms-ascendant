// Bundles the unit viewer (game models + animation code) into one script and writes a self-contained page.
// Usage: node tools/viewer/build.mjs <out.html>
import { build } from 'vite';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] || 'unit-viewer.html');
const outDir = mkdtempSync(join(tmpdir(), 'unit-viewer-'));
await build({
  configFile: false,
  logLevel: 'warn',
  root: resolve(here, '../..'),
  build: {
    outDir,
    emptyOutDir: true,
    minify: true,
    target: 'es2022',
    lib: { entry: join(here, 'unitViewer.ts'), formats: ['iife'], name: 'UnitViewer', fileName: () => 'viewer.js' },
  },
});
const js = readFileSync(join(outDir, 'viewer.js'), 'utf8');
const html = readFileSync(join(here, 'unit-viewer.template.html'), 'utf8').replace('%%BUNDLE%%', () => js.replace(/<\/script/gi, '<\\/script'));
writeFileSync(out, html);
console.log(`${out}: ${(html.length / 1024).toFixed(0)} KB`);
