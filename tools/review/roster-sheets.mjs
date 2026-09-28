// Contact sheets of every baked unit by category, from the unit viewer (a Vite dev server must be running).
//   node tools/review/roster-sheets.mjs <out-dir>
// Writes <out-dir>/roster_<category>.png (and _action variants: each unit mid-attack or under way).
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || 'screenshots/roster';
mkdirSync(out, { recursive: true });
// [category, ids, camera distance, look-at height, columns]
const GROUPS = [
  ['villagers', ['villager', 'villagerF', 'monk'], 2.6, 0.5, 3],
  ['infantry', ['militia', 'manAtArms', 'longSwordsman', 'twoHanded', 'champion', 'spearman', 'pikeman', 'halberdier',
    'legionary', 'eliteLegionary', 'phalangite', 'elitePhalangite', 'gaesatae', 'eliteGaesatae', 'berserker', 'eliteBerserker',
    'fireLancer', 'eliteFireLancer'], 2.6, 0.5, 6],
  ['archers', ['archer', 'crossbowman', 'arbalest', 'skirmisher', 'eliteSkirmisher', 'handCannoneer', 'bowman', 'eliteBowman'], 2.6, 0.5, 4],
  ['cavalry', ['scout', 'lightCav', 'hussar', 'knight', 'cavalier', 'paladin', 'cavArcher', 'heavyCavArcher', 'horseArcher',
    'eliteHorseArcher'], 3.8, 0.85, 5],
  ['camels_elephants', ['camel', 'heavyCamel', 'warElephant', 'eliteWarElephant'], 5.2, 1.1, 4],
  ['animals', ['sheep', 'deer', 'boar', 'wolf'], 2.2, 0.35, 4],
  ['siege', ['ram', 'cappedRam', 'siegeRam', 'mangonel', 'onager', 'siegeOnager', 'scorpion', 'heavyScorpion', 'bombard',
    'trebuchet', 'tradeCart'], 3.6, 0.5, 4],
  ['ships', ['fishingShip', 'transportShip', 'tradeCog', 'galley', 'warGalley', 'galleon', 'fireShip', 'fastFireShip',
    'demolitionShip', 'heavyDemolitionShip', 'cannonGalleon'], 4.2, 0.5, 4],
];
const ACTION = { cavalry: 'attack', camels_elephants: 'attack', infantry: 'attack', archers: 'attack', animals: 'canter', siege: 'attack', ships: 'walk', villagers: 'walk' };
for (const [name, ids, dist, ty, cols] of GROUPS) {
  for (const [suffix, anim, t] of [['', 'idle', 0.4], ['_action', ACTION[name], 0.45]]) {
    const shots = ids.map((unit) => {
      const big = unit === 'trebuchet' || /[gG]alleon|tradeCog|transportShip/.test(unit);
      return { unit, anim, t, dist: dist * (big ? 1.5 : 1), azim: 0.75, elev: 0.38, target: [0, ty * (big ? 1.6 : 1), 0], label: unit };
    });
    const r = spawnSync(process.execPath, ['tools/review/units-shot.mjs', `${out}/roster_${name}${suffix}.png`, `units=${ids.join(',')}`,
      JSON.stringify(shots), String(cols)], { env: { ...process.env, W: '300', H: '300' }, encoding: 'utf8' });
    console.log(name + suffix, (r.stdout || '').trim().split('\n').filter((l) => !l.includes('404')).join(' ') || 'ok', r.stderr ? r.stderr.slice(0, 200) : '');
  }
}
