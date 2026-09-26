import { Game, type GameSetup } from './sim/game';
import { Renderer } from './render/renderer';

const app = document.getElementById('app')!;
app.innerHTML = '<canvas id="view" style="position:fixed;inset:0;width:100vw;height:100vh;display:block"></canvas>';
const canvas = document.getElementById('view') as HTMLCanvasElement;

const params = new URLSearchParams(location.search);
const setup: GameSetup = {
  seed: Number(params.get('seed') ?? 12345),
  mapType: (params.get('map') as GameSetup['mapType']) ?? 'steppe',
  mapSize: 120,
  players: [
    { name: 'You', civ: params.get('civ') ?? 'carthaginians', color: 0, team: 1, human: true, difficulty: 'standard' },
    { name: 'Rival', civ: 'gauls', color: 1, team: 2, human: false, difficulty: 'standard' },
  ],
  resources: 'standard',
  popLimit: 200,
  reveal: (params.get('reveal') as GameSetup['reveal']) ?? 'normal',
  victory: 'conquest',
  startAge: 0,
};
const game = new Game(setup);
const renderer = new Renderer(canvas, game, 1);
const tc = game.buildings.find((b) => b.owner === 1 && b.type === 'townCenter')!;
renderer.centerOn(tc.x, tc.z);
const gallery = params.get('gallery');
if (gallery) {
  // clear an area in the middle of the map and line up models
  const cx = 60, cz = 60;
  for (const r of [...game.resources]) if (Math.abs(r.x - cx) < 16 && Math.abs(r.z - cz) < 16) game.removeResource(r);
  for (const u of [...game.units]) if (Math.abs(u.x - cx) < 16 && Math.abs(u.z - cz) < 16) game.killUnit(u, 0);
  game.map.refreshAll();
  if (gallery === 'units') {
    const list = (params.get('list') ?? 'villager,militia,manAtArms,longSwordsman,twoHanded,champion,spearman,pikeman,halberdier,archer,crossbowman,arbalest,skirmisher,handCannoneer,monk,legionary,phalangite,gaesatae,berserker,bowman,fireLancer,scout,lightCav,hussar,knight,cavalier,paladin,camel,cavArcher,horseArcher,warElephant,ram,mangonel,scorpion,bombard,trebuchet,tradeCart,sheep,deer,boar,wolf').split(',');
    list.forEach((id, i) => {
      const u = game.spawnUnit(id, i % 3 === 2 ? 2 : 1, cx - 8 + (i % 8) * 1.6, cz - 6 + Math.floor(i / 8) * 1.8);
      u.facing = Number(params.get("face") ?? Math.PI / 4);
      u.pfacing = u.facing;
      if (params.get('anim')) {
        u.anim = params.get('anim') as typeof u.anim;
        u.tool = (params.get('tool') as typeof u.tool) ?? 'axe';
      }
    });
    if (params.get('trebUnpacked')) for (const u of game.units) if (u.def.packs) u.packed = false;
  } else {
    const list = (params.get('list') ?? 'house,townCenter,barracks,archeryRange,stable,blacksmith,market,mill,lumberCamp,miningCamp,farm,outpost').split(',');
    let x = cx - 12, z = cz - 8, rowH = 0;
    for (const id of list) {
      const def = (game as unknown as { players: { buildingStats: Map<string, unknown> }[] }).players[1].buildingStats.get(id) ? id : 'house';
      const b = game.createBuilding(def, Number(params.get('owner') ?? 1), x, z, true);
      x += b.w + 1;
      rowH = Math.max(rowH, b.h);
      if (x > cx + 10) {
        x = cx - 12;
        z += rowH + 1;
        rowH = 0;
      }
    }
  }
  game.vision.update(false);
  renderer.centerOn(Number(params.get('cx') ?? cx), Number(params.get('cz') ?? cz));
}
if (params.get('zoom')) {
  renderer.zoom = Number(params.get('zoom'));
  renderer.updateCamera();
}
const speed = Number(params.get('speed') ?? 1);
window.addEventListener('resize', () => renderer.resize());
(window as unknown as Record<string, unknown>).__game = game;
(window as unknown as Record<string, unknown>).__renderer = renderer;

let last = performance.now();
let frames = 0;
function loop(): void {
  const now = performance.now();
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  const alpha = game.update(dt * speed);
  renderer.render(alpha);
  frames++;
  if (frames === 3) (window as unknown as Record<string, unknown>).__ready = true;
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
