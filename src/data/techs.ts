import type { Effect, Selector, TechDef } from './types';

export const TECHS: Record<string, TechDef> = {};
function add(d: TechDef): void {
  TECHS[d.id] = d;
}

const stat = (target: Selector, s: Extract<Effect, { kind: 'stat' }>['stat'], value: number, op: 'add' | 'mul' | 'set' = 'add'): Effect =>
  ({ kind: 'stat', target, stat: s, op, value });
const cls = (...classes: string[]): Selector => ({ classes });
const units = (...ids: string[]): Selector => ({ units: ids });

/* ---------------------------- Ages --------------------------------- */
add({
  id: 'feudalAge', name: 'Feudal Age', age: 0, building: 'townCenter', cost: { food: 500 }, time: 130, slot: 4, icon: 'age1',
  isAge: true, requiresBuildings: { count: 2, age: 1 }, effects: [{ kind: 'age', age: 1 }],
  description: 'Advance to the Feudal Age. Requires two Dark Age buildings (Barracks, Mill, Lumber Camp or Mining Camp).',
});
add({
  id: 'castleAge', name: 'Castle Age', age: 1, building: 'townCenter', cost: { food: 800, gold: 200 }, time: 160, slot: 4, icon: 'age2',
  isAge: true, requiresBuildings: { count: 2, age: 2 }, effects: [{ kind: 'age', age: 2 }],
  description: 'Advance to the Castle Age. Requires two Feudal Age buildings (Archery Range, Stable, Blacksmith or Market).',
});
add({
  id: 'imperialAge', name: 'Imperial Age', age: 2, building: 'townCenter', cost: { food: 1000, gold: 800 }, time: 190, slot: 4, icon: 'age3',
  isAge: true, requiresBuildings: { count: 2, age: 3 }, effects: [{ kind: 'age', age: 3 }],
  description: 'Advance to the Imperial Age. Requires two Castle Age buildings (University, Temple, Siege Workshop) or a Castle.',
});

/* ---------------------------- Town Center -------------------------- */
add({
  id: 'loom', name: 'Loom', age: 0, building: 'townCenter', cost: { gold: 50 }, time: 25, slot: 5, icon: 'loom',
  effects: [stat(units('villager'), 'hp', 15), stat(units('villager'), 'meleeArmor', 1), stat(units('villager'), 'pierceArmor', 2)],
  description: 'Villagers +15 HP, +1 melee armor, +2 pierce armor.',
});
add({
  id: 'wheelbarrow', name: 'Wheelbarrow', age: 1, building: 'townCenter', cost: { food: 175, wood: 50 }, time: 75, slot: 6, icon: 'wheelbarrow',
  effects: [stat(units('villager'), 'speed', 1.1, 'mul'), { kind: 'carry', value: 3 }],
  description: 'Villagers move 10% faster and carry 3 more resources.',
});
add({
  id: 'handCart', name: 'Hand Cart', age: 2, building: 'townCenter', cost: { food: 300, wood: 200 }, time: 55, slot: 6, icon: 'handCart',
  requires: ['wheelbarrow'], effects: [stat(units('villager'), 'speed', 1.1, 'mul'), { kind: 'carry', value: 5 }],
  description: 'Villagers move 10% faster and carry 5 more resources.',
});
add({
  id: 'townWatch', name: 'Town Watch', age: 1, building: 'townCenter', cost: { food: 75 }, time: 25, slot: 7, icon: 'townWatch',
  effects: [stat({ allBuildings: true }, 'los', 4)], description: 'Buildings +4 line of sight.',
});
add({
  id: 'townPatrol', name: 'Town Patrol', age: 2, building: 'townCenter', cost: { food: 300, gold: 100 }, time: 40, slot: 7, icon: 'townPatrol',
  requires: ['townWatch'], effects: [stat({ allBuildings: true }, 'los', 4)], description: 'Buildings +4 line of sight.',
});

/* ---------------------------- Mill --------------------------------- */
add({
  id: 'horseCollar', name: 'Horse Collar', age: 1, building: 'mill', cost: { food: 75, wood: 75 }, time: 20, slot: 0, icon: 'horseCollar',
  effects: [{ kind: 'farmFood', value: 75 }], description: 'Farms +75 food.',
});
add({
  id: 'heavyPlow', name: 'Heavy Plow', age: 2, building: 'mill', cost: { food: 125, wood: 125 }, time: 40, slot: 0, icon: 'heavyPlow',
  requires: ['horseCollar'], effects: [{ kind: 'farmFood', value: 125 }, { kind: 'carry', value: 1, gather: 'farm' }],
  description: 'Farms +125 food; farmers carry +1 food.',
});
add({
  id: 'cropRotation', name: 'Crop Rotation', age: 3, building: 'mill', cost: { food: 250, wood: 250 }, time: 70, slot: 0, icon: 'cropRotation',
  requires: ['heavyPlow'], effects: [{ kind: 'farmFood', value: 175 }], description: 'Farms +175 food.',
});

/* ---------------------------- Lumber camp -------------------------- */
add({
  id: 'doubleBitAxe', name: 'Double-Bit Axe', age: 1, building: 'lumberCamp', cost: { food: 100, wood: 50 }, time: 25, slot: 0, icon: 'axe1',
  effects: [{ kind: 'gather', gather: 'wood', mult: 1.2 }], description: 'Lumberjacks work 20% faster.',
});
add({
  id: 'bowSaw', name: 'Bow Saw', age: 2, building: 'lumberCamp', cost: { food: 150, wood: 100 }, time: 50, slot: 0, icon: 'axe2',
  requires: ['doubleBitAxe'], effects: [{ kind: 'gather', gather: 'wood', mult: 1.2 }], description: 'Lumberjacks work 20% faster.',
});
add({
  id: 'twoManSaw', name: 'Two-Man Saw', age: 3, building: 'lumberCamp', cost: { food: 300, wood: 200 }, time: 100, slot: 0, icon: 'axe3',
  requires: ['bowSaw'], effects: [{ kind: 'gather', gather: 'wood', mult: 1.1 }], description: 'Lumberjacks work 10% faster.',
});

/* ---------------------------- Mining camp -------------------------- */
add({
  id: 'goldMining', name: 'Gold Mining', age: 1, building: 'miningCamp', cost: { food: 100, wood: 75 }, time: 30, slot: 0, icon: 'gold1',
  effects: [{ kind: 'gather', gather: 'gold', mult: 1.15 }], description: 'Gold miners work 15% faster.',
});
add({
  id: 'goldShaftMining', name: 'Gold Shaft Mining', age: 2, building: 'miningCamp', cost: { food: 200, wood: 150 }, time: 75, slot: 0, icon: 'gold2',
  requires: ['goldMining'], effects: [{ kind: 'gather', gather: 'gold', mult: 1.15 }], description: 'Gold miners work 15% faster.',
});
add({
  id: 'stoneMining', name: 'Stone Mining', age: 1, building: 'miningCamp', cost: { food: 100, wood: 75 }, time: 30, slot: 1, icon: 'stone1',
  effects: [{ kind: 'gather', gather: 'stone', mult: 1.15 }], description: 'Stone miners work 15% faster.',
});
add({
  id: 'stoneShaftMining', name: 'Stone Shaft Mining', age: 2, building: 'miningCamp', cost: { food: 200, wood: 150 }, time: 75, slot: 1, icon: 'stone2',
  requires: ['stoneMining'], effects: [{ kind: 'gather', gather: 'stone', mult: 1.15 }], description: 'Stone miners work 15% faster.',
});

/* ---------------------------- Blacksmith --------------------------- */
const melee = cls('infantry', 'cavalry');
const meleeNoArcher: Selector = { classes: ['infantry', 'cavalry'] };
add({
  id: 'forging', name: 'Forging', age: 1, building: 'blacksmith', cost: { food: 150 }, time: 50, slot: 0, icon: 'forging',
  effects: [stat(meleeNoArcher, 'attack', 1)], description: 'Infantry and cavalry +1 attack.',
});
add({
  id: 'ironCasting', name: 'Iron Casting', age: 2, building: 'blacksmith', cost: { food: 220, gold: 120 }, time: 75, slot: 0, icon: 'ironCasting',
  requires: ['forging'], effects: [stat(meleeNoArcher, 'attack', 1)], description: 'Infantry and cavalry +1 attack.',
});
add({
  id: 'blastFurnace', name: 'Blast Furnace', age: 3, building: 'blacksmith', cost: { food: 275, gold: 225 }, time: 100, slot: 0, icon: 'blastFurnace',
  requires: ['ironCasting'], effects: [stat(meleeNoArcher, 'attack', 2)], description: 'Infantry and cavalry +2 attack.',
});
add({
  id: 'scaleMail', name: 'Scale Mail Armor', age: 1, building: 'blacksmith', cost: { food: 100 }, time: 40, slot: 1, icon: 'mail1',
  effects: [stat(cls('infantry'), 'meleeArmor', 1), stat(cls('infantry'), 'pierceArmor', 1)], description: 'Infantry +1/+1 armor.',
});
add({
  id: 'chainMail', name: 'Chain Mail Armor', age: 2, building: 'blacksmith', cost: { food: 200, gold: 100 }, time: 55, slot: 1, icon: 'mail2',
  requires: ['scaleMail'], effects: [stat(cls('infantry'), 'meleeArmor', 1), stat(cls('infantry'), 'pierceArmor', 1)], description: 'Infantry +1/+1 armor.',
});
add({
  id: 'plateMail', name: 'Plate Mail Armor', age: 3, building: 'blacksmith', cost: { food: 300, gold: 150 }, time: 70, slot: 1, icon: 'mail3',
  requires: ['chainMail'], effects: [stat(cls('infantry'), 'meleeArmor', 1), stat(cls('infantry'), 'pierceArmor', 2)], description: 'Infantry +1/+2 armor.',
});
const cavNoArch: Selector = { classes: ['cavalry'] };
add({
  id: 'scaleBarding', name: 'Scale Barding Armor', age: 1, building: 'blacksmith', cost: { food: 150 }, time: 45, slot: 2, icon: 'barding1',
  effects: [stat(cavNoArch, 'meleeArmor', 1), stat(cavNoArch, 'pierceArmor', 1)], description: 'Cavalry +1/+1 armor.',
});
add({
  id: 'chainBarding', name: 'Chain Barding Armor', age: 2, building: 'blacksmith', cost: { food: 250, gold: 150 }, time: 60, slot: 2, icon: 'barding2',
  requires: ['scaleBarding'], effects: [stat(cavNoArch, 'meleeArmor', 1), stat(cavNoArch, 'pierceArmor', 1)], description: 'Cavalry +1/+1 armor.',
});
add({
  id: 'plateBarding', name: 'Plate Barding Armor', age: 3, building: 'blacksmith', cost: { food: 350, gold: 200 }, time: 75, slot: 2, icon: 'barding3',
  requires: ['chainBarding'], effects: [stat(cavNoArch, 'meleeArmor', 1), stat(cavNoArch, 'pierceArmor', 2)], description: 'Cavalry +1/+2 armor.',
});
const archers: Selector = { classes: ['archer'], buildings: ['townCenter', 'watchTower', 'guardTower', 'keep', 'castle'] };
add({
  id: 'fletching', name: 'Fletching', age: 1, building: 'blacksmith', cost: { food: 100, gold: 50 }, time: 30, slot: 3, icon: 'fletching',
  effects: [stat(archers, 'attack', 1), stat(archers, 'range', 1)], description: 'Archers, Town Centers and towers +1 attack, +1 range.',
});
add({
  id: 'bodkinArrow', name: 'Bodkin Arrow', age: 2, building: 'blacksmith', cost: { food: 200, gold: 100 }, time: 35, slot: 3, icon: 'bodkin',
  requires: ['fletching'], effects: [stat(archers, 'attack', 1), stat(archers, 'range', 1)], description: 'Archers, Town Centers and towers +1 attack, +1 range.',
});
add({
  id: 'bracer', name: 'Bracer', age: 3, building: 'blacksmith', cost: { food: 300, gold: 200 }, time: 40, slot: 3, icon: 'bracer',
  requires: ['bodkinArrow'], effects: [stat(archers, 'attack', 1), stat(archers, 'range', 1)], description: 'Archers, Town Centers and towers +1 attack, +1 range.',
});
const archArmor = cls('archer');
add({
  id: 'paddedArcherArmor', name: 'Padded Archer Armor', age: 1, building: 'blacksmith', cost: { food: 100 }, time: 40, slot: 4, icon: 'archArmor1',
  effects: [stat(archArmor, 'meleeArmor', 1), stat(archArmor, 'pierceArmor', 1)], description: 'Archers +1/+1 armor.',
});
add({
  id: 'leatherArcherArmor', name: 'Leather Archer Armor', age: 2, building: 'blacksmith', cost: { food: 150, gold: 150 }, time: 55, slot: 4, icon: 'archArmor2',
  requires: ['paddedArcherArmor'], effects: [stat(archArmor, 'meleeArmor', 1), stat(archArmor, 'pierceArmor', 1)], description: 'Archers +1/+1 armor.',
});
add({
  id: 'ringArcherArmor', name: 'Ring Archer Armor', age: 3, building: 'blacksmith', cost: { food: 250, gold: 250 }, time: 70, slot: 4, icon: 'archArmor3',
  requires: ['leatherArcherArmor'], effects: [stat(archArmor, 'meleeArmor', 1), stat(archArmor, 'pierceArmor', 2)], description: 'Archers +1/+2 armor.',
});

/* ---------------------------- University --------------------------- */
const bld: Selector = { allBuildings: true };
add({
  id: 'masonry', name: 'Masonry', age: 2, building: 'university', cost: { wood: 175, stone: 150 }, time: 50, slot: 0, icon: 'masonry',
  effects: [stat(bld, 'hp', 1.1, 'mul'), stat(bld, 'meleeArmor', 1), stat(bld, 'pierceArmor', 1)], description: 'Buildings +10% HP, +1/+1 armor.',
});
add({
  id: 'architecture', name: 'Architecture', age: 3, building: 'university', cost: { wood: 200, stone: 300 }, time: 70, slot: 0, icon: 'architecture',
  requires: ['masonry'], effects: [stat(bld, 'hp', 1.1, 'mul'), stat(bld, 'meleeArmor', 1), stat(bld, 'pierceArmor', 1)], description: 'Buildings +10% HP, +1/+1 armor.',
});
add({
  id: 'ballistics', name: 'Ballistics', age: 2, building: 'university', cost: { wood: 300, gold: 175 }, time: 60, slot: 1, icon: 'ballistics',
  effects: [{ kind: 'flag', flag: 'ballistics' }], description: 'Archers, towers and Town Centers aim ahead of moving targets.',
});
add({
  id: 'chemistry', name: 'Chemistry', age: 3, building: 'university', cost: { food: 300, gold: 200 }, time: 100, slot: 2, icon: 'chemistry',
  effects: [stat({ classes: ['archer', 'siege'], buildings: ['townCenter', 'watchTower', 'guardTower', 'keep', 'castle'] }, 'attack', 1),
    { kind: 'enable', unit: 'handCannoneer' }, { kind: 'enable', unit: 'bombard' }],
  description: 'Ranged units and buildings +1 attack. Enables Hand Cannoneers and Bombard Cannons.',
});
add({
  id: 'siegeEngineers', name: 'Siege Engineers', age: 3, building: 'university', cost: { food: 500, wood: 600 }, time: 45, slot: 3, icon: 'siegeEngineers',
  effects: [stat(units('mangonel', 'onager', 'siegeOnager', 'scorpion', 'heavyScorpion', 'bombard', 'trebuchet'), 'range', 1),
    { kind: 'bonus', target: cls('siege'), vs: 'building', value: 20 }],
  description: 'Siege weapons +1 range and +20 attack against buildings.',
});
add({
  id: 'murderHoles', name: 'Murder Holes', age: 2, building: 'university', cost: { food: 200, stone: 100 }, time: 60, slot: 4, icon: 'murderHoles',
  effects: [{ kind: 'flag', flag: 'murderHoles' }], description: 'Towers and castles have no minimum range.',
});
add({
  id: 'treadmillCrane', name: 'Treadmill Crane', age: 2, building: 'university', cost: { wood: 200, stone: 300 }, time: 50, slot: 5, icon: 'crane',
  effects: [{ kind: 'buildRate', mult: 1.2 }], description: 'Villagers build 20% faster.',
});
add({
  id: 'guardTowerUp', name: 'Guard Tower', age: 2, building: 'university', cost: { food: 100, wood: 250 }, time: 30, slot: 6, icon: 'guardTower',
  effects: [{ kind: 'flag', flag: 'guardTower' }], description: 'Upgrades Watch Towers to Guard Towers.',
});
add({
  id: 'keepUp', name: 'Keep', age: 3, building: 'university', cost: { food: 500, wood: 350 }, time: 75, slot: 6, icon: 'keep',
  requires: ['guardTowerUp'], effects: [{ kind: 'flag', flag: 'keep' }], description: 'Upgrades Guard Towers to Keeps.',
});
add({
  id: 'fortifiedWall', name: 'Fortified Wall', age: 3, building: 'university', cost: { food: 200, stone: 100 }, time: 50, slot: 7, icon: 'fortifiedWall',
  effects: [stat({ buildings: ['stoneWall', 'gate'] }, 'hp', 1.7, 'mul'), stat({ buildings: ['stoneWall', 'gate'] }, 'meleeArmor', 4)],
  description: 'Stone walls and gates +70% HP and +4 melee armor.',
});
add({
  id: 'heatedShot', name: 'Heated Shot', age: 2, building: 'university', cost: { food: 350, gold: 100 }, time: 30, slot: 8, icon: 'heatedShot',
  effects: [{ kind: 'bonus', target: { buildings: ['watchTower', 'guardTower', 'keep', 'castle', 'townCenter'] }, vs: 'siege', value: 4 }],
  description: 'Towers and castles +4 attack against siege weapons.',
});

/* ---------------------------- Monastery ---------------------------- */
add({
  id: 'redemption', name: 'Redemption', age: 2, building: 'monastery', cost: { gold: 475 }, time: 50, slot: 1, icon: 'redemption',
  effects: [{ kind: 'flag', flag: 'redemption' }], description: 'Priests can convert siege weapons.',
});
add({
  id: 'atonement', name: 'Atonement', age: 2, building: 'monastery', cost: { gold: 325 }, time: 40, slot: 2, icon: 'atonement',
  effects: [{ kind: 'flag', flag: 'atonement' }], description: 'Priests can convert enemy priests.',
});
add({
  id: 'sanctity', name: 'Sanctity', age: 2, building: 'monastery', cost: { gold: 120 }, time: 60, slot: 3, icon: 'sanctity',
  effects: [stat(units('monk'), 'hp', 15)], description: 'Priests +15 HP.',
});
add({
  id: 'fervor', name: 'Fervor', age: 2, building: 'monastery', cost: { gold: 140 }, time: 50, slot: 4, icon: 'fervor',
  effects: [stat(units('monk'), 'speed', 1.15, 'mul')], description: 'Priests move 15% faster.',
});
add({
  id: 'blockPrinting', name: 'Block Printing', age: 3, building: 'monastery', cost: { gold: 200 }, time: 55, slot: 5, icon: 'blockPrinting',
  effects: [stat(units('monk'), 'range', 3)], description: 'Priests +3 conversion range.',
});
add({
  id: 'illumination', name: 'Illumination', age: 3, building: 'monastery', cost: { gold: 120 }, time: 65, slot: 6, icon: 'illumination',
  effects: [{ kind: 'flag', flag: 'illumination' }], description: 'Priests regain faith 50% faster.',
});
add({
  id: 'faith', name: 'Faith', age: 3, building: 'monastery', cost: { food: 750, gold: 1000 }, time: 60, slot: 7, icon: 'faith',
  effects: [{ kind: 'flag', flag: 'faith' }], description: 'Your units are much harder to convert.',
});
add({
  id: 'theocracy', name: 'Theocracy', age: 3, building: 'monastery', cost: { gold: 200 }, time: 75, slot: 8, icon: 'theocracy',
  effects: [{ kind: 'flag', flag: 'theocracy' }], description: 'Priests regain faith twice as fast after converting.',
});

/* ---------------------------- Unit upgrades ------------------------- */
function up(id: string, name: string, building: string, age: 1 | 2 | 3, cost: TechDef['cost'], time: number, slot: number,
  from: string, to: string, requires?: string[], extra: Effect[] = []): void {
  add({
    id, name, age, building, cost, time, slot, icon: 'unit:' + to, requires, upgradeTo: to,
    effects: [{ kind: 'upgrade', from, to }, ...extra],
    description: `Upgrades your ${nameOf(from)} to ${name}.`,
  });
}
// names are filled lazily to avoid import cycles
const pendingNames: Record<string, string> = {
  militia: 'Militia', manAtArms: 'Men-at-Arms', longSwordsman: 'Long Swordsmen', twoHanded: 'Two-Handed Swordsmen',
  spearman: 'Spearmen', pikeman: 'Pikemen', archer: 'Archers', crossbowman: 'Crossbowmen', skirmisher: 'Skirmishers',
  cavArcher: 'Cavalry Archers', scout: 'Scout Cavalry', lightCav: 'Light Cavalry', knight: 'Knights', cavalier: 'Cavaliers',
  camel: 'Camel Riders', ram: 'Battering Rams', cappedRam: 'Capped Rams', mangonel: 'Mangonels', onager: 'Onagers', scorpion: 'Scorpions',
};
function nameOf(id: string): string {
  return pendingNames[id] ?? id;
}
up('manAtArmsUp', 'Man-at-Arms', 'barracks', 1, { food: 100, gold: 40 }, 40, 5, 'militia', 'manAtArms');
up('longSwordsmanUp', 'Long Swordsman', 'barracks', 2, { food: 200, gold: 65 }, 45, 5, 'manAtArms', 'longSwordsman', ['manAtArmsUp']);
up('twoHandedUp', 'Two-Handed Swordsman', 'barracks', 3, { food: 300, gold: 100 }, 75, 5, 'longSwordsman', 'twoHanded', ['longSwordsmanUp']);
up('championUp', 'Champion', 'barracks', 3, { food: 750, gold: 350 }, 100, 5, 'twoHanded', 'champion', ['twoHandedUp']);
up('pikemanUp', 'Pikeman', 'barracks', 2, { food: 215, gold: 90 }, 45, 6, 'spearman', 'pikeman');
up('halberdierUp', 'Halberdier', 'barracks', 3, { food: 300, gold: 600 }, 50, 6, 'pikeman', 'halberdier', ['pikemanUp']);
up('crossbowmanUp', 'Crossbowman', 'archeryRange', 2, { food: 125, gold: 75 }, 35, 5, 'archer', 'crossbowman');
up('arbalestUp', 'Arbalest', 'archeryRange', 3, { food: 350, gold: 300 }, 50, 5, 'crossbowman', 'arbalest', ['crossbowmanUp']);
up('eliteSkirmisherUp', 'Elite Skirmisher', 'archeryRange', 2, { wood: 230, gold: 130 }, 50, 6, 'skirmisher', 'eliteSkirmisher');
up('heavyCavArcherUp', 'Heavy Cavalry Archer', 'archeryRange', 3, { food: 900, wood: 500 }, 50, 7, 'cavArcher', 'heavyCavArcher');
up('lightCavUp', 'Light Cavalry', 'stable', 2, { food: 150, gold: 50 }, 45, 5, 'scout', 'lightCav');
up('hussarUp', 'Hussar', 'stable', 3, { food: 500, gold: 600 }, 50, 5, 'lightCav', 'hussar', ['lightCavUp']);
up('cavalierUp', 'Cavalier', 'stable', 3, { food: 300, gold: 300 }, 100, 6, 'knight', 'cavalier');
up('paladinUp', 'Paladin', 'stable', 3, { food: 1300, gold: 750 }, 170, 6, 'cavalier', 'paladin', ['cavalierUp']);
up('heavyCamelUp', 'Heavy Camel Rider', 'stable', 3, { food: 325, gold: 360 }, 125, 7, 'camel', 'heavyCamel');
up('cappedRamUp', 'Capped Ram', 'siegeWorkshop', 3, { food: 300 }, 50, 5, 'ram', 'cappedRam');
up('siegeRamUp', 'Siege Ram', 'siegeWorkshop', 3, { food: 1000, gold: 300 }, 75, 5, 'cappedRam', 'siegeRam', ['cappedRamUp']);
up('onagerUp', 'Onager', 'siegeWorkshop', 3, { food: 800, gold: 500 }, 75, 6, 'mangonel', 'onager');
up('siegeOnagerUp', 'Siege Onager', 'siegeWorkshop', 3, { food: 1450, gold: 1000 }, 150, 6, 'onager', 'siegeOnager', ['onagerUp']);
up('heavyScorpionUp', 'Heavy Scorpion', 'siegeWorkshop', 3, { food: 1000, wood: 1100 }, 50, 7, 'scorpion', 'heavyScorpion');

/* ---------------------------- Barracks/Range/Stable techs ------------ */
add({
  id: 'squires', name: 'Squires', age: 2, building: 'barracks', cost: { food: 200 }, time: 40, slot: 7, icon: 'squires',
  effects: [stat(cls('infantry'), 'speed', 1.1, 'mul')], description: 'Infantry move 10% faster.',
});
add({
  id: 'tracking', name: 'Tracking', age: 1, building: 'barracks', cost: { food: 75 }, time: 35, slot: 8, icon: 'tracking',
  effects: [stat(cls('infantry'), 'los', 2)], description: 'Infantry +2 line of sight.',
});
add({
  id: 'arson', name: 'Arson', age: 2, building: 'barracks', cost: { food: 150, gold: 50 }, time: 25, slot: 9, icon: 'arson',
  effects: [{ kind: 'bonus', target: cls('infantry'), vs: 'building', value: 2 }], description: 'Infantry +2 attack against buildings.',
});
add({
  id: 'thumbRing', name: 'Thumb Ring', age: 2, building: 'archeryRange', cost: { food: 300, wood: 250 }, time: 45, slot: 8, icon: 'thumbRing',
  effects: [stat(cls('archer'), 'accuracy', 1, 'set'), stat(cls('archer'), 'reload', 1 / 1.1, 'mul')],
  description: 'Archers fire 10% faster and are perfectly accurate.',
});
add({
  id: 'parthianTactics', name: 'Parthian Tactics', age: 3, building: 'archeryRange', cost: { food: 200, gold: 250 }, time: 65, slot: 9, icon: 'parthianTactics',
  effects: [stat(cls('cavArcher'), 'meleeArmor', 1), stat(cls('cavArcher'), 'pierceArmor', 2), { kind: 'bonus', target: cls('cavArcher'), vs: 'spear', value: 4 }],
  description: 'Cavalry archers +1/+2 armor and +4 attack against spearmen.',
});
add({
  id: 'bloodlines', name: 'Bloodlines', age: 1, building: 'stable', cost: { food: 150, gold: 100 }, time: 50, slot: 8, icon: 'bloodlines',
  effects: [stat(cls('mounted'), 'hp', 20)], description: 'Mounted units +20 HP.',
});
add({
  id: 'husbandry', name: 'Husbandry', age: 2, building: 'stable', cost: { food: 250 }, time: 40, slot: 9, icon: 'husbandry',
  effects: [stat(cls('mounted'), 'speed', 1.1, 'mul')], description: 'Mounted units move 10% faster.',
});

/* ---------------------------- Castle ------------------------------- */
add({
  id: 'hoardings', name: 'Hoardings', age: 3, building: 'castle', cost: { wood: 400, stone: 400 }, time: 75, slot: 8, icon: 'hoardings',
  effects: [stat({ buildings: ['castle'] }, 'hp', 1.21, 'mul')], description: 'Castles +21% HP.',
});
add({
  id: 'sappers', name: 'Sappers', age: 3, building: 'castle', cost: { food: 400, gold: 200 }, time: 10, slot: 9, icon: 'sappers',
  effects: [{ kind: 'bonus', target: units('villager'), vs: 'building', value: 15 }], description: 'Villagers +15 attack against buildings.',
});
add({
  id: 'conscription', name: 'Conscription', age: 3, building: 'castle', cost: { food: 150, gold: 150 }, time: 60, slot: 3, icon: 'conscription',
  effects: [{ kind: 'workRate', building: 'military', mult: 1.33 }], description: 'Military buildings train units 33% faster.',
});

/* ---------------------------- Market ------------------------------- */
add({
  id: 'caravan', name: 'Caravan', age: 2, building: 'market', cost: { food: 200, gold: 200 }, time: 40, slot: 5, icon: 'caravan',
  effects: [stat(units('tradeCart'), 'speed', 1.5, 'mul')], description: 'Trade Carts move 50% faster.',
});
add({
  id: 'guilds', name: 'Guilds', age: 3, building: 'market', cost: { food: 300, gold: 200 }, time: 50, slot: 6, icon: 'guilds',
  effects: [{ kind: 'flag', flag: 'guilds' }], description: 'Market trading fee reduced from 30% to 15%.',
});
add({
  id: 'coinage', name: 'Coinage', age: 2, building: 'market', cost: { food: 200, gold: 100 }, time: 50, slot: 7, icon: 'coinage',
  effects: [{ kind: 'flag', flag: 'coinage' }], description: 'Trade Carts earn 20% more gold.',
});

/* ---------------------------- Elite unique units -------------------- */
function eliteUU(uuId: string, name: string, cost: TechDef['cost'], time: number, civ: string): void {
  const to = 'elite' + uuId[0].toUpperCase() + uuId.slice(1);
  add({
    id: 'elite_' + uuId, name, age: 3, building: 'castle', cost, time, slot: 5, icon: 'unit:' + to, civ, upgradeTo: to,
    effects: [{ kind: 'upgrade', from: uuId, to }], description: `Upgrades your unique unit to ${name}.`,
  });
}
eliteUU('warElephant', 'Elite War Elephant', { food: 1600, gold: 1200 }, 70, 'carthaginians');
eliteUU('legionary', 'Elite Legionary', { food: 1000, gold: 850 }, 55, 'latins');
eliteUU('phalangite', 'Elite Phalangite', { food: 900, gold: 750 }, 55, 'hellenes');
eliteUU('gaesatae', 'Elite Gaesatae', { food: 1000, gold: 800 }, 50, 'gauls');
eliteUU('berserker', 'Elite Wolfcoat', { food: 1300, gold: 550 }, 45, 'suebi');
eliteUU('horseArcher', 'Elite Parthian Rider', { food: 1100, gold: 675 }, 50, 'parthians');
eliteUU('bowman', 'Elite Ta-Seti Bowman', { food: 850, gold: 850 }, 60, 'kushites');
eliteUU('fireLancer', 'Elite Fire Lancer', { food: 950, gold: 750 }, 55, 'han');

/* ---------------------------- Unique techs ------------------------- */
function ut(id: string, name: string, age: 2 | 3, civ: string, cost: TechDef['cost'], time: number, effects: Effect[], description: string): void {
  add({ id, name, age, building: 'castle', cost, time, slot: age === 2 ? 6 : 7, icon: 'ut:' + civ, civ, effects, description });
}
ut('numidianAllies', 'Numidian Allies', 2, 'carthaginians', { food: 400, gold: 300 }, 40,
  [stat(cls('cavalry'), 'pierceArmor', 1), stat(cls('mounted'), 'speed', 1.05, 'mul')],
  'Cavalry +1 pierce armor and mounted units move 5% faster.');
ut('alpineCrossing', "Hannibal's Crossing", 3, 'carthaginians', { food: 750, gold: 600 }, 60,
  [stat(units('warElephant', 'eliteWarElephant'), 'speed', 1.2, 'mul'), stat(units('warElephant', 'eliteWarElephant'), 'meleeArmor', 2)],
  'War Elephants move 20% faster and gain +2 melee armor.');
ut('testudo', 'Testudo', 2, 'latins', { food: 450, gold: 250 }, 40,
  [stat(units('legionary', 'eliteLegionary'), 'pierceArmor', 3)], 'Legionaries +3 pierce armor.');
ut('viaMunita', 'Via Munita', 3, 'latins', { food: 700, gold: 500 }, 60,
  [stat(cls('infantry'), 'speed', 1.15, 'mul'), stat(cls('siege'), 'speed', 1.15, 'mul')],
  'Paved military roads: infantry and siege move 15% faster.');
ut('sarissa', 'Sarissa', 2, 'hellenes', { food: 400, wood: 200 }, 40,
  [stat(cls('spear'), 'hp', 1.2, 'mul'), { kind: 'bonus', target: cls('spear'), vs: 'cavalry', value: 4 }],
  'Spear units +20% HP and +4 attack against cavalry.');
ut('companionCavalry', 'Companion Cavalry', 3, 'hellenes', { food: 700, gold: 700 }, 60,
  [stat(units('knight', 'cavalier', 'paladin'), 'attack', 3), stat(units('knight', 'cavalier', 'paladin'), 'hp', 20)],
  'Knight line +3 attack and +20 HP.');
ut('druidicRites', 'Druidic Rites', 2, 'gauls', { food: 300, gold: 200 }, 40,
  [stat(units('monk'), 'hp', 30), stat(units('monk'), 'speed', 1.2, 'mul')], 'Priests +30 HP and move 20% faster.');
ut('torcOfKings', 'Torc of Kings', 3, 'gauls', { food: 750, gold: 450 }, 50,
  [stat(cls('infantry'), 'attack', 2)], 'Infantry +2 attack.');
ut('bloodOath', 'Blood Oath', 2, 'suebi', { food: 350, gold: 250 }, 40,
  [stat(units('berserker', 'eliteBerserker'), 'regen', 2, 'mul'), stat(units('berserker', 'eliteBerserker'), 'speed', 1.1, 'mul')],
  'Wolfcoats regenerate twice as fast and move 10% faster.');
ut('wodansFury', "Wodan's Fury", 3, 'suebi', { food: 600, gold: 600 }, 60,
  [stat(cls('infantry'), 'hp', 15)], 'Infantry +15 HP.');
ut('parthianShot', 'Parthian Shot', 2, 'parthians', { food: 400, gold: 350 }, 40,
  [stat(cls('cavArcher'), 'range', 1), stat(cls('cavArcher'), 'reload', 0.85, 'mul')], 'Cavalry archers +1 range and fire 15% faster.');
ut('silkRoad', 'Silk Road', 3, 'parthians', { food: 500, gold: 300 }, 50,
  [{ kind: 'flag', flag: 'silkRoad' }, stat(units('tradeCart'), 'hp', 1.5, 'mul')],
  'Trade Carts earn 25% more gold and have +50% HP.');
ut('kandakesGuard', "Kandake's Guard", 2, 'kushites', { food: 350, gold: 300 }, 40,
  [stat(cls('footArcher'), 'hp', 15)], 'Foot archers +15 HP.');
ut('ironOfMeroe', 'Iron of Meroë', 3, 'kushites', { food: 700, gold: 500 }, 60,
  [stat(cls('archer'), 'attack', 1), stat(cls('infantry'), 'attack', 1), stat(cls('cavalry'), 'attack', 1)],
  'All archers, infantry and cavalry +1 attack.');
ut('blackPowder', 'Black Powder', 2, 'han', { food: 400, gold: 300 }, 40,
  [stat(cls('gunpowder'), 'attack', 1.2, 'mul'), stat(cls('gunpowder'), 'range', 1)], 'Gunpowder units +20% attack and +1 range.');
ut('greatWall', 'Great Wall', 3, 'han', { wood: 400, stone: 400 }, 60,
  [stat({ buildings: ['stoneWall', 'gate', 'watchTower', 'guardTower', 'keep', 'palisade'] }, 'hp', 1.3, 'mul')],
  'Walls and towers +30% HP.');

export const TECH_LIST = Object.values(TECHS);
