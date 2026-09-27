import './ui/style.css';
import type { GameSetup } from './sim/game';
import { Session } from './ui/session';
import { Menus } from './ui/menus';
import { AudioSys } from './audio/audio';
import { AIPlayer } from './ai/ai';
import { issueCommand } from './sim/commands';
import { loadTextureAssets } from './render/assets';

const app = document.getElementById('app')!;
const audio = new AudioSys();
let session: Session | null = null;

const menus = new Menus(app, audio, startGame);

function startGame(setup: GameSetup): void {
  menus.showLoading('Preparing the realm…');
  // let the loading screen paint before the heavy lifting
  setTimeout(async () => {
    const assets = await loadTextureAssets();
    app.innerHTML = '';
    session = new Session(app, setup, (game, pid) => new AIPlayer(game, pid, setup.players[pid - 1].difficulty), backToMenu, audio, assets);
    applyDebug(session);
    session.start();
    (window as unknown as Record<string, unknown>).__ready = true;
  }, 50);
}

function backToMenu(): void {
  session = null;
  menus.showMain();
}

/* ---------------------------------------------------------------------------------------- */
/* Debug / screenshot helpers driven by URL parameters                                        */
/* ---------------------------------------------------------------------------------------- */
const params = new URLSearchParams(location.search);

function applyDebug(s: Session): void {
  const g = s.game;
  if (params.get('speed')) s.speed = Number(params.get('speed'));
  if (params.get('zoom')) {
    s.renderer.zoom = Number(params.get('zoom'));
    s.renderer.updateCamera();
  }
  const gallery = params.get('gallery');
  if (gallery) {
    const cx = g.map.n / 2, cz = g.map.n / 2;
    for (const r of [...g.resources]) if (Math.abs(r.x - cx) < 16 && Math.abs(r.z - cz) < 16) g.removeResource(r);
    for (const u of [...g.units]) if (Math.abs(u.x - cx) < 16 && Math.abs(u.z - cz) < 16) g.killUnit(u, 0);
    g.events.length = 0;
    g.map.refreshAll();
    const list = (params.get('list') ?? '').split(',').filter(Boolean);
    if (gallery === 'trees') {
      // one row per tree variant, the right half packed like a forest
      for (let v = 0; v < 4; v++) {
        for (let i = 0; i < 9; i++) {
          const tx = Math.floor(cx - 10 + i * (i < 4 ? 2 : 1) + (i >= 4 ? 4 : 0)), tz = Math.floor(cz - 6 + v * 3);
          for (let row = 0; row < (i >= 4 ? 2 : 1); row++) {
            const r = g.addResource('tree', 'wood', 100, tx, tz + row, true);
            r.variant = v;
            r.rot = (i * 1.7 + row) % (Math.PI * 2);
            r.scale = 0.9 + ((i * 7 + row * 3) % 5) * 0.05;
          }
        }
      }
    } else if (gallery === 'units') {
      list.forEach((id, i) => {
        const u = g.spawnUnit(id, i % 3 === 2 ? 2 : 1, cx - 8 + (i % 8) * 1.6, cz - 6 + Math.floor(i / 8) * 1.8);
        u.facing = u.pfacing = Number(params.get('face') ?? Math.PI / 4);
      });
    } else {
      let x = cx - 12, z = cz - 8, rowH = 0;
      for (const id of list) {
        const b = g.createBuilding(id, 1, x, z, true);
        x += b.w + 1;
        rowH = Math.max(rowH, b.h);
        if (x > cx + 10) {
          x = cx - 12;
          z += rowH + 1;
          rowH = 0;
        }
      }
    }
    g.vision.update(false);
    s.renderer.centerOn(Number(params.get('cx') ?? cx), Number(params.get('cz') ?? cz));
  }
  if (params.get('battle')) {
    const cx = g.map.n / 2, cz = g.map.n / 2;
    for (const r of [...g.resources]) if (Math.abs(r.x - cx) < 14 && Math.abs(r.z - cz) < 14) g.removeResource(r);
    g.map.refreshAll();
    const armyA = (params.get('a') ?? 'longSwordsman*8,crossbowman*6,knight*4,warElephant*2,mangonel*1').split(',');
    const armyB = (params.get('b') ?? 'pikeman*8,archer*6,camel*4,legionary*4,scorpion*1').split(',');
    const spawn = (list: string[], owner: number, x0: number, dir: number) => {
      const ids: number[] = [];
      let row = 0;
      for (const item of list) {
        const [id, n] = item.split('*');
        for (let i = 0; i < Number(n ?? 1); i++) {
          const u = g.spawnUnit(id, owner, x0 + dir * row * 1.1, cz - 4 + i * 0.9);
          u.facing = u.pfacing = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
          ids.push(u.id);
        }
        row++;
      }
      return ids;
    };
    const a = spawn(armyA, 1, cx - 6, -1);
    const b = spawn(armyB, 2, cx + 6, 1);
    g.recomputePop(1);
    g.recomputePop(2);
    issueCommand(g, 1, { c: 'move', units: a, x: cx + 8, z: cz, attackMove: true });
    issueCommand(g, 2, { c: 'move', units: b, x: cx - 8, z: cz, attackMove: true });
    s.renderer.centerOn(cx, cz);
  }
  if (params.get('fast')) {
    // simulate ahead quickly (for testing AI and mid-game visuals)
    const secs = Number(params.get('fast'));
    const steps = Math.floor(secs / 0.05);
    for (let i = 0; i < steps; i++) {
      g.step();
      for (const { pid, ai } of s.ais) if ((g.tickCount + pid * 3) % 10 === 0) ai.update();
      g.events.length = 0;
    }
  }
  if (params.get('select')) {
    const what = params.get('select');
    const ids = g.units.filter((u) => u.owner === s.local && (what === 'all' || u.type === what)).map((u) => u.id);
    if (what === 'tc') s.select(g.buildings.filter((b) => b.owner === s.local && b.type === 'townCenter').map((b) => b.id));
    else s.select(ids);
  }
  if (params.get('look')) {
    const [lx, lz] = params.get('look')!.split(',').map(Number);
    s.renderer.centerOn(lx, lz);
  }
}

if (params.get('autostart')) {
  const n = Number(params.get('players') ?? 2);
  const civs = (params.get('civs') ?? 'carthaginians,gauls,parthians,han,latins,hellenes,suebi,kushites').split(',');
  const players = Array.from({ length: n }, (_, i) => ({
    name: i === 0 ? 'You' : `AI ${i}`, civ: civs[i % civs.length], color: i, team: i + 1, human: i === 0 && !params.get('spectate'),
    difficulty: (params.get('diff') ?? 'standard') as 'standard',
  }));
  if (params.get('spectate')) players[0].human = false;
  startGame({
    seed: Number(params.get('seed') ?? 12345),
    mapType: (params.get('map') ?? 'steppe') as GameSetup['mapType'],
    mapSize: Number(params.get('size') ?? 120),
    players,
    resources: (params.get('res') ?? 'standard') as GameSetup['resources'],
    popLimit: 200,
    reveal: (params.get('reveal') ?? 'normal') as GameSetup['reveal'],
    victory: 'standard',
    startAge: Number(params.get('age') ?? 0) as GameSetup['startAge'],
    spectator: !!params.get('spectate'),
  });
} else {
  menus.showMain();
}
