// Browser regressions for desktop controls, native touch gestures and compact HUDs.
// Requires Chrome, as does tools/screenshot.mjs. Run with npm run inputtest.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const port = Number(process.env.INPUT_TEST_PORT ?? 5175);
// Disable HMR so an edit in another terminal cannot reload an active gesture test.
const serverCode = `import('vite').then(async ({ createServer }) => {
  const server = await createServer({ server: { host: '127.0.0.1', port: ${port}, strictPort: true, hmr: false } });
  await server.listen(); server.printUrls();
});`;
const server = spawn(process.execPath, ['-e', serverCode], {
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
let browser;
const errors = [];
const check = (message) => console.log(`PASS ${message}`);

try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Vite start timeout')), 30000);
    server.once('error', reject);
    server.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Vite exited (${code})`)); });
    server.stdout.on('data', (data) => {
      if (String(data).includes('Local')) { clearTimeout(timer); resolve(); }
    });
    server.stderr.on('data', (data) => process.stderr.write(data));
  });
  browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
  });

  async function start(context, expectedZoom) {
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/?autostart=1&size=80&reveal=all&speed=0&oldunits=1`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
    if (expectedZoom !== undefined) assert.equal(await page.evaluate(() => window.__session.renderer.zoom), expectedZoom, 'New mobile matches start at a useful zoom');
    await page.evaluate(() => {
      const s = window.__session;
      s.speed = 0;
      s.renderer.setQuality('low');
      s.renderer.setZoom(40);
      s.renderer.centerOn(s.game.map.n / 2, s.game.map.n / 2);
      // Keep a small, deterministic patch of the actual rendered map clear.
      for (const r of [...s.game.resources]) {
        if (Math.hypot(r.x - s.renderer.camX, r.z - s.renderer.camZ) < 12) s.game.removeResource(r);
      }
      s.game.map.refreshAll();
      window.__inputCommands = [];
      const issue = s.issue.bind(s);
      s.issue = (command) => { window.__inputCommands.push(command); return issue(command); };
      window.__inputUnits = [-1, 1].map((side) => {
        const ground = s.renderer.screenToGround(innerWidth / 2 + side * 45, innerHeight * 0.4);
        return s.game.spawnUnit('villager', s.local, ground.x, ground.z).id;
      });
      s.game.vision.update(false);
    });
    await page.waitForFunction(() => window.__inputUnits.every((id) => window.__session.renderer.units.drawn.some((u) => u.id === id)));
    return page;
  }

  const camera = (page) => page.evaluate(() => ({ x: window.__session.renderer.camX, z: window.__session.renderer.camZ }));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const commands = (page) => page.evaluate(() => window.__inputCommands);
  const selection = (page) => page.evaluate(() => window.__session.selection);
  const clearCommands = (page) => page.evaluate(() => { window.__inputCommands.length = 0; });

  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const pc = await start(desktop, 62);
  assert.equal(await pc.evaluate(() => {
    const r = window.__session.renderer;
    r.setZoom(1);
    const minimum = r.zoom;
    r.setZoom(40);
    return minimum;
  }), 28, 'Desktop retains its existing zoom range');
  await pc.evaluate(() => window.__session.select(window.__inputUnits));
  await pc.mouse.move(640, 350);
  for (const [key, signX, signZ] of [['w', -1, -1], ['a', -1, 1], ['s', 1, 1], ['d', 1, -1]]) {
    const before = await camera(pc);
    await pc.keyboard.down(key);
    await pc.evaluate(() => window.__session.input.update(0.08));
    await pc.keyboard.up(key);
    const after = await camera(pc);
    assert.ok((after.x - before.x) * signX > 0.1 && (after.z - before.z) * signZ > 0.1, `${key.toUpperCase()} pans in its expected direction`);
    await pc.evaluate(() => window.__session.input.update(0.08));
    assert.ok(distance(after, await camera(pc)) < 0.001, 'Camera stops after key release');
  }
  assert.deepEqual(await commands(pc), [], 'WASD does not fire command hotkeys');
  assert.equal(await pc.evaluate(() => window.__session.targeting), null, 'A does not enter attack move');
  assert.equal(await pc.evaluate(() => window.__session.panelMode), 'main', 'WASD does not change command panels');
  check('WASD pans in all four directions without triggering unit commands, and key release stops movement');

  await pc.keyboard.down('w');
  await pc.evaluate(() => window.dispatchEvent(new Event('blur')));
  const afterBlur = await camera(pc);
  await pc.evaluate(() => window.__session.input.update(0.08));
  await pc.keyboard.up('w');
  assert.ok(distance(afterBlur, await camera(pc)) < 0.001, 'Blur clears held camera keys');
  check('Losing browser focus clears held camera keys');
  await desktop.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await start(mobile, 28);
  const cdp = await mobile.newCDPSession(page);
  const point = (x, y, id = 1) => ({ x, y, id, radiusX: 1, radiusY: 1, force: 1 });
  const touch = (type, points = []) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  const tap = async (p) => { await touch('touchStart', [p]); await touch('touchEnd'); };
  const drag = async (from, to) => {
    await touch('touchStart', [from]);
    for (let step = 1; step <= 4; step++) {
      await touch('touchMove', [point(from.x + (to.x - from.x) * step / 4, from.y + (to.y - from.y) * step / 4, from.id)]);
    }
    await touch('touchEnd');
  };
  const settleTap = () => page.waitForTimeout(400);
  const reset = async () => {
    await settleTap();
    await page.evaluate(() => {
      const s = window.__session;
      s.renderer.setZoom(40);
      s.renderer.centerOn(s.game.map.n / 2, s.game.map.n / 2);
      s.select([]);
      s.setPanel('main');
      window.__inputCommands.length = 0;
    });
  };
  const unitPoints = () => page.evaluate(() => window.__inputUnits.map((id) => {
    const s = window.__session, unit = s.game.get(id);
    const p = s.renderer.project(unit.x, s.game.map.surfaceAt(unit.x, unit.z) + 0.55, unit.z);
    if (s.renderer.pick(p.x, p.y)?.id !== id) throw new Error(`Fixture unit ${id} is not pickable`);
    const hit = document.elementFromPoint(p.x, p.y);
    if (hit !== s.canvas) throw new Error(`Fixture unit at ${p.x},${p.y} is covered by ${hit?.outerHTML.slice(0, 180)}`);
    return { x: p.x, y: p.y, id: 1 };
  }));
  assert.equal(await page.evaluate(() => innerWidth), 390, 'Viewport uses the device width');
  assert.equal(await page.locator('#view').evaluate((el) => getComputedStyle(el).touchAction), 'none', 'Canvas consumes native map gestures');

  await reset();
  const ownIds = await page.evaluate(() => window.__inputUnits);
  await tap((await unitPoints())[0]);
  await settleTap();
  assert.deepEqual(await selection(page), [ownIds[0]], 'A tap selects an owned unit');
  assert.deepEqual(await commands(page), [], 'Selection does not issue a command');
  await settleTap();
  const ground = await page.evaluate(() => {
    const s = window.__session;
    for (let y = 180; y < 280; y += 20) {
      for (let x = 80; x < innerWidth - 80; x += 20) {
        if (document.elementFromPoint(x, y) === s.canvas && !s.renderer.pick(x, y)) return { x, y, id: 1 };
      }
    }
    throw new Error('No empty fixture ground point');
  });
  await tap(ground);
  await settleTap();
  assert.ok((await commands(page)).some((c) => c.c === 'move' && c.units.includes(ownIds[0])), 'Tapping ground orders the selected unit to move');
  check('Native touch taps select owned units and issue contextual ground movement');

  await settleTap();
  await clearCommands(page);
  const selectedBeforePan = await selection(page);
  const beforePan = await camera(page);
  await drag(point(170, 220), point(235, 265));
  await settleTap();
  assert.ok(distance(beforePan, await camera(page)) > 0.5, 'One finger drag pans the camera');
  assert.deepEqual(await selection(page), selectedBeforePan, 'Panning preserves selection');
  assert.deepEqual(await commands(page), [], 'Panning never issues a ground command');
  assert.equal(await page.locator('#selbox').isVisible(), false, 'Panning never leaves a selection box');
  const releasedPan = await camera(page);
  await page.evaluate(() => window.__session.input.update(0.2));
  assert.ok(distance(releasedPan, await camera(page)) < 0.001, 'Touch release does not trigger mouse edge scrolling');
  check('One finger drag pans without selecting, issuing commands or continuing after release');

  await reset();
  const positions = await unitPoints();
  const corner = point(Math.min(...positions.map((p) => p.x)) - 24, Math.min(...positions.map((p) => p.y)) - 24);
  const farCorner = point(Math.max(...positions.map((p) => p.x)) + 24, Math.max(...positions.map((p) => p.y)) + 24);
  await page.evaluate(() => window.__session.select([window.__inputUnits[0]]));
  const beforeBox = await camera(page);
  await tap(corner);
  await touch('touchStart', [corner]);
  await touch('touchMove', [farCorner]);
  assert.equal(await page.locator('#selbox').isVisible(), true, 'The second touch drag displays a selection box');
  await touch('touchEnd');
  await settleTap();
  assert.deepEqual((await selection(page)).sort(), [...ownIds].sort(), 'Double tap then drag selects the units in the rectangle');
  assert.ok(distance(beforeBox, await camera(page)) < 0.001, 'Box selection leaves the camera stationary');
  assert.deepEqual(await commands(page), [], 'Box selection does not issue commands');
  check('Double tap, hold and drag selects units without moving the camera');

  await reset();
  await tap(corner);
  await touch('touchStart', [corner]);
  await touch('touchMove', [farCorner]);
  assert.equal(await page.locator('#selbox').isVisible(), true);
  await touch('touchCancel');
  await settleTap();
  assert.equal(await page.locator('#selbox').isVisible(), false, 'Pointer cancellation clears the visible selection box');
  assert.deepEqual(await selection(page), [], 'Cancelled box selection selects nothing');
  assert.deepEqual(await commands(page), [], 'Cancelled touch issues no command');
  check('Cancelled native touch clears an unfinished selection gesture');

  await reset();
  const initialZoom = await page.evaluate(() => window.__session.renderer.zoom);
  await touch('touchStart', [point(155, 250)]);
  await touch('touchStart', [point(155, 250), point(235, 250, 2)]);
  await touch('touchMove', [point(120, 250), point(270, 250, 2)]);
  await touch('touchEnd');
  await settleTap();
  assert.ok(await page.evaluate(() => window.__session.renderer.zoom) > initialZoom + 1, 'Spreading two fingers increases the game zoom');
  assert.deepEqual(await commands(page), [], 'Pinch issues no command');
  assert.deepEqual(await selection(page), [], 'Pinch does not select units');
  check('Native two finger pinch zooms the map without accidental commands');

  await reset();
  await touch('touchStart', [point(75, 250)]);
  await touch('touchStart', [point(75, 250), point(315, 250, 2)]);
  for (let step = 1; step <= 5; step++) {
    await touch('touchMove', [point(75 + step * 20, 250), point(315 - step * 20, 250, 2)]);
  }
  await touch('touchEnd');
  await settleTap();
  assert.equal(await page.evaluate(() => window.__session.renderer.zoom), 10, 'Pinching inward reaches the new mobile overview limit');
  assert.deepEqual(await commands(page), [], 'Zooming far out does not issue commands');
  assert.deepEqual(await selection(page), [], 'Zooming far out does not select units');
  mkdirSync('screenshots', { recursive: true });
  await page.screenshot({ path: 'screenshots/mobile-zoomed-out.png' });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForFunction(() => window.__session.renderer.width === 844);
  assert.equal(await page.evaluate(() => window.__session.renderer.zoom), 10, 'Rotation preserves the chosen wide zoom');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => window.__session.renderer.width === 390);
  check('Mobile pinch zoom reaches a much wider overview and survives rotation');

  await reset();
  const mini = await page.locator('#minimap').boundingBox();
  assert.ok(mini && mini.width > 0 && mini.height > 0, 'Minimap is visible on mobile');
  const beforeMini = await camera(page);
  await drag(point(mini.x + mini.width * 0.5, mini.y + mini.height * 0.35), point(mini.x + mini.width * 0.6, mini.y + mini.height * 0.6));
  assert.ok(distance(beforeMini, await camera(page)) > 0.5, 'Touch dragging the minimap changes the camera');
  assert.deepEqual(await commands(page), [], 'Touch minimap navigation does not issue commands');
  check('Touch dragging navigates the minimap');

  await reset();
  await page.evaluate(() => {
    window.__session.select([window.__inputUnits[0]]);
    window.__session.hud.update(performance.now() + 150);
  });
  await page.locator('#touch-select').tap();
  assert.equal(await page.locator('#touch-select').getAttribute('aria-pressed'), 'true', 'Select toggle announces its active state');
  await page.locator('#touch-cancel').tap();
  assert.deepEqual(await selection(page), [ownIds[0]], 'Cancelling Select mode preserves the current selection');
  assert.equal(await page.locator('#touch-select').getAttribute('aria-pressed'), 'false');
  await tap((await unitPoints())[1]);
  await settleTap();
  assert.deepEqual(await selection(page), [ownIds[1]], 'A normal friendly-unit tap changes selection');
  assert.deepEqual(await commands(page), [], 'Selecting a friendly unit does not issue an order');
  await page.evaluate(() => {
    window.__session.select([window.__inputUnits[0]]);
    window.__session.hud.update(performance.now() + 150);
  });
  assert.equal(await page.locator('#touch-command').textContent(), 'Interact', 'Units get an Interact button with a distinct purpose');
  await page.locator('#touch-command').tap();
  await tap((await unitPoints())[1]);
  await settleTap();
  assert.deepEqual(await selection(page), [ownIds[0]], 'Interact does not replace selection with the friendly target');
  assert.ok((await commands(page)).some((c) => c.c === 'move' && c.units.includes(ownIds[0])), 'Interact orders movement to a friendly unit');
  check('Select/Cancel preserves selection and Interact can target friendly units');

  await clearCommands(page);
  const rallyBuilding = await page.evaluate(() => {
    const s = window.__session;
    const b = s.game.buildings.find((b) => b.owner === s.local && b.type === 'townCenter');
    s.select([b.id]);
    s.hud.update(performance.now() + 150);
    return b.id;
  });
  assert.equal(await page.locator('#touch-command').textContent(), 'Rally', 'Production buildings show the Rally action');
  await page.locator('#touch-command').tap();
  await tap(ground);
  await settleTap();
  assert.ok((await commands(page)).some((c) => c.c === 'rally' && c.buildings.includes(rallyBuilding)), 'Rally sets the selected building\'s gather point');
  assert.deepEqual(await selection(page), [rallyBuilding], 'Rally keeps the building selected');
  await page.evaluate(() => {
    window.__session.select([window.__inputUnits[0]]);
    window.__session.hud.update(performance.now() + 150);
  });
  check('The contextual Rally button sets production building gather points');

  await clearCommands(page);
  await page.getByRole('button', { name: 'Build Economic Building', exact: true }).tap();
  assert.equal(await page.evaluate(() => window.__session.panelMode), 'buildEco', 'A touch activates a command panel button');
  const house = await page.getByRole('button', { name: 'Build House', exact: true }).boundingBox();
  assert.ok(house, 'House command is available');
  // The map tap is still waiting to distinguish a double tap when House is pressed.
  await tap(ground);
  await tap(point(house.x + house.width / 2, house.y + house.height / 2));
  await settleTap();
  assert.equal(await page.evaluate(() => window.__session.placing?.type), 'house', 'Touching House begins placement');
  assert.deepEqual(await commands(page), [], 'Entering placement cancels the earlier pending map tap');
  await page.locator('#touch-cancel').tap();
  assert.equal(await page.evaluate(() => window.__session.placing), null);
  assert.deepEqual(await selection(page), [ownIds[0]], 'Cancelling placement keeps its builders selected');
  check('Build buttons work by touch and do not reuse a delayed map tap to place or command');

  await reset();
  await tap(corner);
  await touch('touchStart', [corner]);
  await touch('touchMove', [farCorner]);
  assert.equal(await page.locator('#selbox').isVisible(), true);
  await page.setViewportSize({ width: 391, height: 844 });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#selbox')).display === 'none');
  await touch('touchEnd');
  assert.deepEqual(await commands(page), [], 'A resize cancels an unfinished map gesture');
  await page.setViewportSize({ width: 390, height: 844 });
  await reset();
  await tap(corner);
  await touch('touchStart', [corner]);
  await touch('touchMove', [farCorner]);
  await page.evaluate(() => window.__session.hud.showHelp());
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#selbox')).display === 'none');
  assert.equal(await page.locator('#selbox').isVisible(), false, 'Opening a dialog cancels the active selection box');
  await touch('touchEnd');
  await settleTap();
  assert.deepEqual(await commands(page), [], 'Releasing behind a dialog issues no command');
  await page.evaluate(() => window.__session.hud.closeModal());
  check('Viewport changes and dialogs cancel unfinished map gestures');

  // Do not carry CDP's cancelled touch sequence across emulated device changes.
  await page.close();
  const layoutPage = await start(mobile, 28);
  const layoutTouch = await mobile.newCDPSession(layoutPage);
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 568, height: 320 }]) {
    await layoutPage.setViewportSize(viewport);
    await layoutPage.evaluate(() => {
      const s = window.__session;
      s.hud.closeModal();
      s.paused = false;
      s.select([window.__inputUnits[0]]);
      s.setPanel('buildEco');
      s.hud.update(performance.now() + 150);
    });
    const layout = await layoutPage.evaluate(() => {
      const selectors = ['#topbar', '#bottom', '#cmd', '#info', '#mapwrap', '#minimap', '#btn-help', '#btn-menu'];
      const clipped = [];
      for (const selector of selectors) {
        for (const el of document.querySelectorAll(selector)) {
          const r = el.getBoundingClientRect();
          if (r.width && r.height && (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1)) {
            clipped.push(`${selector} ${JSON.stringify(r.toJSON())}`);
          }
        }
      }
      const top = document.querySelector('#topbar').getBoundingClientRect();
      const bottom = document.querySelector('#bottom').getBoundingClientRect();
      return { clipped, mapHeight: bottom.top - top.bottom, scrollWidth: document.documentElement.scrollWidth, width: innerWidth };
    });
    assert.deepEqual(layout.clipped, [], `HUD fits ${viewport.width}×${viewport.height}`);
    assert.ok(layout.mapHeight >= 100, `Map remains usable at ${viewport.width}×${viewport.height}: ${layout.mapHeight}px`);
    assert.ok(layout.scrollWidth <= layout.width + 1, 'No document horizontal overflow');
    const commandBox = await layoutPage.locator('#cmd').boundingBox();
    const scrollX = commandBox.x + commandBox.width / 2;
    const scrollY = commandBox.y + commandBox.height - 12;
    await layoutTouch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: scrollX, y: scrollY }] });
    for (let step = 1; step <= 8; step++) {
      await layoutTouch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: scrollX, y: scrollY - step * 10 }] });
      await layoutPage.waitForTimeout(20);
    }
    await layoutTouch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await layoutPage.waitForTimeout(200);
    assert.ok(await layoutPage.locator('#cmd').evaluate(el => el.scrollTop > 0), 'A finger drag scrolls labeled commands');
    assert.equal(await layoutPage.evaluate(() => window.__session.panelMode), 'buildEco', 'Scrolling does not activate a command');
    await layoutPage.evaluate(() => window.__session.hud.refreshCommands());
    assert.ok(await layoutPage.locator('#cmd').evaluate(el => el.scrollTop > 0), 'Command refresh keeps the scroll position');
    for (const button of await layoutPage.locator('#cmd .cbtn').all()) {
      await button.scrollIntoViewIfNeeded();
      const label = await button.evaluate((el) => {
        const text = el.querySelector('.command-label');
        const r = text.getBoundingClientRect(), b = el.getBoundingClientRect();
        return { visible: r.width > 0 && r.height > 0, text: text.textContent, title: el.title,
          fits: r.left >= b.left && r.right <= b.right && r.top >= b.top && r.bottom <= b.bottom };
      });
      assert.ok(label.visible && label.fits && label.text === label.title, 'Touch commands show their full names without clipping');
    }
    await layoutPage.locator('#cmd').evaluate((el) => { el.scrollTop = 0; });
    if (viewport.width === 390 || viewport.width === 844) {
      mkdirSync('screenshots', { recursive: true });
      await layoutPage.screenshot({ path: `screenshots/mobile-${viewport.width === 390 ? 'portrait' : 'landscape'}.png` });
    }
    await layoutPage.locator('#btn-help').tap();
    const modal = await layoutPage.locator('.modal').evaluate((el) => {
      const r = el.getBoundingClientRect();
      el.scrollTop = el.scrollHeight;
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight, overflowing: el.scrollHeight > el.clientHeight + 1, scrollTop: el.scrollTop };
    });
    assert.ok(modal.left >= -1 && modal.top >= -1 && modal.right <= modal.width + 1 && modal.bottom <= modal.height + 1, 'Help dialog fits the viewport');
    assert.ok(!modal.overflowing || modal.scrollTop > 0, 'Long help remains scrollable');
    await layoutPage.evaluate(() => window.__session.hud.closeModal());
    check(`HUD, build commands and scrollable Help fit ${viewport.width}×${viewport.height}`);
  }
  assert.deepEqual(errors, [], 'No browser runtime errors');
  console.log('Input and responsive layout regressions passed.');
} finally {
  await browser?.close();
  server.kill();
}
