import type { CivDef, Effect, Selector } from './types';

const stat = (target: Selector, s: Extract<Effect, { kind: 'stat' }>['stat'], value: number, op: 'add' | 'mul' | 'set' = 'add'): Effect =>
  ({ kind: 'stat', target, stat: s, op, value });
const cls = (...classes: string[]): Selector => ({ classes });

/**
 * THE DIVERGENCE — 216 BC.
 * After the slaughter at Cannae, Hannibal Barca heeds Maharbal and marches on Rome. The city falls before
 * the winter. Carthage razes the Capitol and scatters the Latin League. There will be no Roman Empire.
 *
 * Twelve centuries later, the successor realms of a world that never knew Rome contend for dominion.
 */
export const WORLD_LORE = {
  title: 'Realms Ascendant',
  subtitle: 'The Punic Centuries',
  intro: [
    'In the year 216 before the Common Reckoning, after the slaughter at Cannae, Hannibal Barca listened to his cavalry commander Maharbal and marched on Rome. The city burned before winter.',
    'Carthage salted the Capitol and scattered the Latin League to the mountains. There would be no Roman Empire: no legions on the Rhine, no roads to Britannia, no Caesars.',
    'Twelve centuries on, the Middle Sea is a Punic lake of merchant princes. Gaul was never conquered and bows to a High King beneath the sacred oak. The heirs of Alexander still hold the east, where Parthian riders guard the Silk Road. Latin exiles have hardened in the Alps into a republic of engineers sworn to rebuild the Seven Hills. Suebian wolf-kings rule the northern forests, the Kandakes of Meroë command the Nile to the sea, and from beyond the mountains the Han have sent their fire-lances west.',
    'The old balance has broken. Eight realms rise. Only one will be ascendant.',
  ],
};

export const CIVS: Record<string, CivDef> = {
  carthaginians: {
    id: 'carthaginians', name: 'Carthaginians', realm: 'The Punic Thalassocracy', style: 'mediterranean',
    motto: 'Qart-Hadasht endures.',
    specialty: 'Cavalry and Economy',
    lore: 'Victors of the Second War, the Carthaginians rule the Middle Sea from their harbor of a thousand ships. Their Shofetim still sit in the city of Elissa; their elephant corps still remembers the Alps.',
    bonuses: [
      { text: 'Gold miners work 15% faster', effects: [{ kind: 'gather', gather: 'gold', mult: 1.15 }] },
      { text: 'Cavalry +15% HP (Numidian horses)', effects: [stat(cls('cavalry'), 'hp', 1.15, 'mul')] },
      { text: 'Market and Trade Carts cost -33%', effects: [{ kind: 'cost', target: { buildings: ['market'], units: ['tradeCart'] }, mult: 0.67 }] },
      { text: 'Start with +100 gold', effects: [{ kind: 'resource', res: 'gold', value: 100 }] },
    ],
    teamBonus: { text: 'Trade Carts earn 10% more gold', effects: [] },
    uniqueUnit: 'warElephant', eliteUniqueUnit: 'eliteWarElephant', uniqueTechs: ['numidianAllies', 'alpineCrossing'],
    disabled: ['arbalestUp', 'bracer', 'handCannoneer', 'championUp', 'siegeOnagerUp'],
    emblem: { bg: '#5b2a86', fg: '#f2d27a', symbol: 'crescent' },
    ai: { favored: ['knight', 'uniqueUnit', 'camel', 'archer'] },
  },
  latins: {
    id: 'latins', name: 'Latins', realm: 'The Alpine Republic', style: 'mediterranean',
    motto: 'Roma resurget.',
    specialty: 'Infantry and Siege',
    lore: 'The survivors of burned Rome fled into the Alps and never forgot. Their consuls are engineers, their legions build a fortified camp every night, and every Latin child swears to see the Seven Hills rebuilt.',
    bonuses: [
      { text: 'Villagers build 25% faster', effects: [{ kind: 'buildRate', mult: 1.25 }] },
      { text: 'Stone walls and towers cost -33%', effects: [{ kind: 'cost', target: { buildings: ['stoneWall', 'gate', 'watchTower', 'guardTower', 'keep'] }, mult: 0.67 }] },
      { text: 'Siege weapons +20% HP', effects: [stat(cls('siege'), 'hp', 1.2, 'mul')] },
      { text: 'Infantry +1 pierce armor in the Feudal Age, +1 more in the Imperial Age', effects: [stat(cls('infantry'), 'pierceArmor', 1)], age: 1 },
      { text: '', effects: [stat(cls('infantry'), 'pierceArmor', 1)], age: 3 },
    ],
    teamBonus: { text: 'Siege workshops work 20% faster', effects: [{ kind: 'workRate', building: 'siegeWorkshop', mult: 1.2 }] },
    uniqueUnit: 'legionary', eliteUniqueUnit: 'eliteLegionary', uniqueTechs: ['testudo', 'viaMunita'],
    disabled: ['paladinUp', 'hussarUp', 'heavyCavArcherUp', 'camel', 'parthianTactics'],
    emblem: { bg: '#8c1c13', fg: '#f4e4b0', symbol: 'eagle' },
    ai: { favored: ['militia', 'uniqueUnit', 'archer', 'ram'] },
  },
  hellenes: {
    id: 'hellenes', name: 'Hellenes', realm: 'The Basileia of the Diadochi', style: 'mediterranean',
    motto: 'The spear-won land.',
    specialty: 'Infantry and Monks',
    lore: 'The heirs of Alexander never lost Asia. From Antioch to Alexandria their basileis rule through philosophers and phalanxes, and their academies are the envy of the known world.',
    bonuses: [
      { text: 'Spear units +25% HP', effects: [stat(cls('spear'), 'hp', 1.25, 'mul')] },
      { text: 'University technologies cost -33%', effects: [{ kind: 'flag', flag: 'cheapUniversity' }] },
      { text: 'Monks heal 50% faster', effects: [stat({ units: ['monk'] }, 'healRate', 1.5, 'mul')] },
      { text: 'Town Centers +2 line of sight and +10% HP', effects: [stat({ buildings: ['townCenter'] }, 'los', 2), stat({ buildings: ['townCenter'] }, 'hp', 1.1, 'mul')] },
    ],
    teamBonus: { text: 'Monasteries work 20% faster', effects: [{ kind: 'workRate', building: 'monastery', mult: 1.2 }] },
    uniqueUnit: 'phalangite', eliteUniqueUnit: 'elitePhalangite', uniqueTechs: ['sarissa', 'companionCavalry'],
    disabled: ['handCannoneer', 'heavyCavArcherUp', 'siegeOnagerUp', 'camel', 'hussarUp'],
    emblem: { bg: '#1d4f91', fg: '#f7f3e8', symbol: 'sun' },
    ai: { favored: ['spearman', 'uniqueUnit', 'knight', 'archer'] },
  },
  gauls: {
    id: 'gauls', name: 'Gauls', realm: 'The High Kingdom of the Oak', style: 'northern',
    motto: 'The sky may fall; we will not.',
    specialty: 'Infantry and Siege',
    lore: 'Unconquered by any legion, the tribes of Gaul bent the knee only to their own High King at the sacred grove of the Carnutes. Their druids keep the calendar; their smiths forge the finest iron north of the sea.',
    bonuses: [
      { text: 'Infantry move 15% faster (from Feudal Age)', effects: [stat(cls('infantry'), 'speed', 1.15, 'mul')], age: 1 },
      { text: 'Lumberjacks work 15% faster', effects: [{ kind: 'gather', gather: 'wood', mult: 1.15 }] },
      { text: 'Siege weapons fire 20% faster', effects: [stat(cls('siege'), 'reload', 1 / 1.2, 'mul')] },
      { text: 'Barracks cost -50 wood', effects: [{ kind: 'cost', target: { buildings: ['barracks'] }, mult: 0.72, res: 'wood' }] },
    ],
    teamBonus: { text: 'Siege Workshops work 20% faster', effects: [{ kind: 'workRate', building: 'siegeWorkshop', mult: 1.2 }] },
    uniqueUnit: 'gaesatae', eliteUniqueUnit: 'eliteGaesatae', uniqueTechs: ['druidicRites', 'torcOfKings'],
    disabled: ['arbalestUp', 'ringArcherArmor', 'paladinUp', 'camel', 'heavyCavArcherUp', 'bombard'],
    emblem: { bg: '#1f5a2a', fg: '#e8d27a', symbol: 'oak' },
    ai: { favored: ['militia', 'uniqueUnit', 'mangonel', 'knight'] },
  },
  suebi: {
    id: 'suebi', name: 'Suebi', realm: 'The Forest Kingdoms', style: 'northern',
    motto: 'Wolves do not bargain.',
    specialty: 'Infantry',
    lore: 'Without Rome to push them, the Suebian confederacy spread from the Elbe to the Danube. Their kings are chosen by the shield and their warbands still wear the pelts of the wolves they slew.',
    bonuses: [
      { text: 'Infantry cost -20% (from Feudal Age)', effects: [{ kind: 'cost', target: cls('infantry'), mult: 0.8 }], age: 1 },
      { text: 'Hunters work 25% faster and carry +5 meat', effects: [{ kind: 'gather', gather: 'hunt', mult: 1.25 }, { kind: 'carry', value: 5, gather: 'hunt' }] },
      { text: 'Barracks work 20% faster', effects: [{ kind: 'workRate', building: 'barracks', mult: 1.2 }] },
      { text: 'Infantry +1 attack against buildings per age after Dark', effects: [{ kind: 'bonus', target: cls('infantry'), vs: 'building', value: 1 }], age: 1 },
      { text: '', effects: [{ kind: 'bonus', target: cls('infantry'), vs: 'building', value: 1 }], age: 2 },
      { text: '', effects: [{ kind: 'bonus', target: cls('infantry'), vs: 'building', value: 1 }], age: 3 },
    ],
    teamBonus: { text: 'Barracks work 20% faster', effects: [{ kind: 'workRate', building: 'barracks', mult: 1.2 }] },
    uniqueUnit: 'berserker', eliteUniqueUnit: 'eliteBerserker', uniqueTechs: ['bloodOath', 'wodansFury'],
    disabled: ['plateBarding', 'paladinUp', 'siegeOnagerUp', 'camel', 'keepUp', 'arbalestUp'],
    emblem: { bg: '#3d3d3d', fg: '#d9d9d9', symbol: 'wolf' },
    ai: { favored: ['militia', 'uniqueUnit', 'spearman', 'skirmisher'] },
  },
  parthians: {
    id: 'parthians', name: 'Parthians', realm: 'The Shahdom of the Silk Road', style: 'desert',
    motto: 'Strike, and be gone.',
    specialty: 'Cavalry Archers',
    lore: 'Masters of the Iranian plateau and wardens of the Silk Road, the Parthian shahs grew rich on caravans and fierce on the saddle. Their riders can loose an arrow over the horse\'s tail at full gallop.',
    bonuses: [
      { text: 'Cavalry archers cost -15% (Castle Age), -25% (Imperial Age)', effects: [{ kind: 'cost', target: cls('cavArcher'), mult: 0.85 }], age: 2 },
      { text: '', effects: [{ kind: 'cost', target: cls('cavArcher'), mult: 0.882 }], age: 3 },
      { text: 'Town Centers +50% HP', effects: [stat({ buildings: ['townCenter'] }, 'hp', 1.5, 'mul')] },
      { text: 'Mounted units +2 line of sight', effects: [stat(cls('mounted'), 'los', 2)] },
      { text: 'Stables work 20% faster', effects: [{ kind: 'workRate', building: 'stable', mult: 1.2 }] },
    ],
    teamBonus: { text: 'Archery Ranges work 20% faster', effects: [{ kind: 'workRate', building: 'archeryRange', mult: 1.2 }] },
    uniqueUnit: 'horseArcher', eliteUniqueUnit: 'eliteHorseArcher', uniqueTechs: ['parthianShot', 'silkRoad'],
    disabled: ['championUp', 'halberdierUp', 'siegeRamUp', 'siegeOnagerUp', 'fortifiedWall'],
    emblem: { bg: '#a0521d', fg: '#fbe6b4', symbol: 'horse' },
    ai: { favored: ['cavArcher', 'uniqueUnit', 'knight', 'camel'] },
  },
  kushites: {
    id: 'kushites', name: 'Kushites', realm: 'The Kandake Kingdom of Meroë', style: 'desert',
    motto: 'The bow does not forget.',
    specialty: 'Archers',
    lore: 'The Egyptians called Kush Ta-Seti, the Land of the Bow. With Egypt fallen to Carthaginian merchants and Greek kings, the warrior queens of Meroë rule the Nile from the cataracts to the delta, their iron furnaces burning day and night.',
    bonuses: [
      { text: 'Foot archers +1 range in Castle Age, +1 more in Imperial Age', effects: [stat(cls('footArcher'), 'range', 1)], age: 2 },
      { text: '', effects: [stat(cls('footArcher'), 'range', 1)], age: 3 },
      { text: 'Archery Ranges work 20% faster', effects: [{ kind: 'workRate', building: 'archeryRange', mult: 1.2 }] },
      { text: 'Stone miners work 20% faster', effects: [{ kind: 'gather', gather: 'stone', mult: 1.2 }] },
      { text: 'Monks and Monasteries cost -30%', effects: [{ kind: 'cost', target: { units: ['monk'], buildings: ['monastery'] }, mult: 0.7 }] },
    ],
    teamBonus: { text: 'Archers +1 line of sight', effects: [stat(cls('archer'), 'los', 1)] },
    uniqueUnit: 'bowman', eliteUniqueUnit: 'eliteBowman', uniqueTechs: ['kandakesGuard', 'ironOfMeroe'],
    disabled: ['paladinUp', 'hussarUp', 'siegeRamUp', 'heavyScorpionUp', 'handCannoneer'],
    emblem: { bg: '#b8860b', fg: '#2b1a05', symbol: 'bow' },
    ai: { favored: ['archer', 'uniqueUnit', 'camel', 'spearman'] },
  },
  han: {
    id: 'han', name: 'Han', realm: 'The Jade Mandate', style: 'eastern',
    motto: 'Heaven has not withdrawn its mandate.',
    specialty: 'Gunpowder and Technology',
    lore: 'Never pressed by western empires, the Han court turned its alchemists loose on saltpeter and sulfur centuries early. Now its envoys, merchants and fire-lance banners reach the gates of Parthia and beyond.',
    bonuses: [
      { text: 'Start with +2 villagers but -150 food', effects: [{ kind: 'resource', res: 'food', value: -150 }] },
      { text: 'Technologies cost -10% (Feudal), -15% (Castle), -20% (Imperial)', effects: [{ kind: 'techCost', mult: 0.9 }], age: 1 },
      { text: '', effects: [{ kind: 'techCost', mult: 0.944 }], age: 2 },
      { text: '', effects: [{ kind: 'techCost', mult: 0.941 }], age: 3 },
      { text: 'Town Centers support 10 population', effects: [{ kind: 'popBonus', building: 'townCenter', value: 5 }] },
      { text: 'Farms +45 food', effects: [{ kind: 'farmFood', value: 45 }] },
    ],
    teamBonus: { text: 'Farms +45 food', effects: [] },
    uniqueUnit: 'fireLancer', eliteUniqueUnit: 'eliteFireLancer', uniqueTechs: ['blackPowder', 'greatWall'],
    disabled: ['paladinUp', 'hussarUp', 'camel', 'plateBarding', 'heavyCamelUp'],
    start: { villagers: 5 },
    emblem: { bg: '#8b0000', fg: '#f5c542', symbol: 'dragon' },
    ai: { favored: ['archer', 'uniqueUnit', 'spearman', 'mangonel'] },
  },
};

export const CIV_LIST = Object.values(CIVS);
