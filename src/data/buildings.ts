import type { BuildingDef } from './types';

export const BUILDINGS: Record<string, BuildingDef> = {};
function add(d: BuildingDef): void {
  BUILDINGS[d.id] = d;
}

const B = ['building'];
const DEF = ['building', 'stoneDefense'];

add({
  id: 'townCenter', name: 'Town Center', age: 0, buildAge: 2, cost: { wood: 275, stone: 100 }, buildTime: 150, hp: 2400,
  size: [4, 4], meleeArmor: 3, pierceArmor: 5, los: 8, classes: B, popProvided: 5,
  dropoff: ['food', 'wood', 'gold', 'stone'], trains: ['villager'],
  researches: ['feudalAge', 'castleAge', 'imperialAge', 'loom', 'wheelbarrow', 'handCart', 'townWatch', 'townPatrol'],
  garrison: 15, attack: { damage: 5, range: 6, reload: 2, arrows: 1, projectile: 'arrow' },
  model: 'townCenter', menu: 'eco', slot: 10,
  description: 'The heart of your realm. Trains villagers, accepts every resource, and advances you through the ages. Shoots arrows at nearby enemies; garrison villagers for more.',
});
add({
  id: 'house', name: 'House', age: 0, cost: { wood: 25 }, buildTime: 25, hp: 550, size: [2, 2],
  meleeArmor: 0, pierceArmor: 7, los: 2, classes: B, popProvided: 5, model: 'house', menu: 'eco', slot: 0,
  description: 'Supports 5 population.',
});
add({
  id: 'mill', name: 'Mill', age: 0, cost: { wood: 100 }, buildTime: 35, hp: 600, size: [2, 2],
  meleeArmor: 0, pierceArmor: 7, los: 6, classes: B, dropoff: ['food'], researches: ['horseCollar', 'heavyPlow', 'cropRotation'],
  model: 'mill', menu: 'eco', slot: 1, ageReqFor: 1,
  description: 'Drop-off point for food. Build near berry bushes and farms. Researches farming improvements.',
});
add({
  id: 'lumberCamp', name: 'Lumber Camp', age: 0, cost: { wood: 100 }, buildTime: 35, hp: 600, size: [2, 2],
  meleeArmor: 0, pierceArmor: 7, los: 6, classes: B, dropoff: ['wood'], researches: ['doubleBitAxe', 'bowSaw', 'twoManSaw'],
  model: 'lumberCamp', menu: 'eco', slot: 3, ageReqFor: 1,
  description: 'Drop-off point for wood. Build next to forests. Researches woodcutting improvements.',
});
add({
  id: 'miningCamp', name: 'Mining Camp', age: 0, cost: { wood: 100 }, buildTime: 35, hp: 600, size: [2, 2],
  meleeArmor: 0, pierceArmor: 7, los: 6, classes: B, dropoff: ['gold', 'stone'],
  researches: ['goldMining', 'stoneMining', 'goldShaftMining', 'stoneShaftMining'],
  model: 'miningCamp', menu: 'eco', slot: 2, ageReqFor: 1,
  description: 'Drop-off point for gold and stone. Build next to mines. Researches mining improvements.',
});
add({
  id: 'farm', name: 'Farm', age: 0, cost: { wood: 60 }, buildTime: 15, hp: 480, size: [3, 3],
  meleeArmor: 0, pierceArmor: 0, los: 1, classes: B, walkable: true, foodCapacity: 175, requires: ['mill'],
  model: 'farm', menu: 'eco', slot: 5,
  description: 'Renewable food source. One villager farms each field. Exhausted farms are reseeded automatically if you can afford it.',
});
add({
  id: 'barracks', name: 'Barracks', age: 0, cost: { wood: 175 }, buildTime: 50, hp: 1200, size: [3, 3],
  meleeArmor: 0, pierceArmor: 7, los: 5, classes: B, trains: ['militia', 'spearman'],
  researches: ['manAtArmsUp', 'longSwordsmanUp', 'twoHandedUp', 'championUp', 'pikemanUp', 'halberdierUp', 'squires', 'tracking', 'arson'],
  model: 'barracks', menu: 'mil', slot: 0, ageReqFor: 1,
  description: 'Trains infantry and researches infantry improvements.',
});
add({
  id: 'outpost', name: 'Outpost', age: 0, cost: { wood: 25, stone: 25 }, buildTime: 15, hp: 500, size: [1, 1],
  meleeArmor: 0, pierceArmor: 0, los: 10, classes: B, model: 'outpost', menu: 'mil', slot: 6,
  description: 'A tall lookout that lets you see far across the land. Has no attack.',
});
add({
  id: 'palisade', name: 'Palisade Wall', age: 0, cost: { wood: 2 }, buildTime: 6, hp: 250, size: [1, 1],
  meleeArmor: 2, pierceArmor: 5, los: 2, classes: ['building', 'wall'], wall: true, model: 'palisade', menu: 'mil', slot: 7,
  description: 'Cheap wooden wall. Drag to place a line.',
});
add({
  id: 'archeryRange', name: 'Archery Range', age: 1, cost: { wood: 175 }, buildTime: 50, hp: 1500, size: [3, 3],
  meleeArmor: 0, pierceArmor: 7, los: 5, classes: B, trains: ['archer', 'skirmisher', 'cavArcher', 'handCannoneer'],
  researches: ['crossbowmanUp', 'arbalestUp', 'eliteSkirmisherUp', 'heavyCavArcherUp', 'thumbRing', 'parthianTactics'],
  requires: ['barracks'], model: 'archeryRange', menu: 'mil', slot: 1, ageReqFor: 2,
  description: 'Trains archers and researches archer improvements.',
});
add({
  id: 'stable', name: 'Stable', age: 1, cost: { wood: 175 }, buildTime: 50, hp: 1500, size: [3, 3],
  meleeArmor: 0, pierceArmor: 7, los: 5, classes: B, trains: ['scout', 'knight', 'camel'],
  researches: ['lightCavUp', 'hussarUp', 'cavalierUp', 'paladinUp', 'heavyCamelUp', 'bloodlines', 'husbandry'],
  requires: ['barracks'], model: 'stable', menu: 'mil', slot: 2, ageReqFor: 2,
  description: 'Trains cavalry and researches cavalry improvements.',
});
add({
  id: 'blacksmith', name: 'Blacksmith', age: 1, cost: { wood: 150 }, buildTime: 40, hp: 1800, size: [3, 3],
  meleeArmor: 0, pierceArmor: 7, los: 5, classes: B,
  researches: ['forging', 'ironCasting', 'blastFurnace', 'scaleMail', 'chainMail', 'plateMail', 'scaleBarding', 'chainBarding',
    'plateBarding', 'fletching', 'bodkinArrow', 'bracer', 'paddedArcherArmor', 'leatherArcherArmor', 'ringArcherArmor'],
  model: 'blacksmith', menu: 'eco', slot: 6, ageReqFor: 2,
  description: 'Researches attack and armor improvements for your army.',
});
add({
  id: 'market', name: 'Market', age: 1, cost: { wood: 175 }, buildTime: 60, hp: 2100, size: [4, 4],
  meleeArmor: 0, pierceArmor: 7, los: 5, classes: B, trains: ['tradeCart'], researches: ['caravan', 'guilds', 'coinage'],
  requires: ['mill'], model: 'market', menu: 'eco', slot: 7, ageReqFor: 2,
  description: 'Buy and sell resources, and trains Trade Carts to earn gold between markets.',
});
add({
  id: 'watchTower', name: 'Watch Tower', age: 1, cost: { wood: 25, stone: 125 }, buildTime: 80, hp: 1020, size: [1, 1],
  meleeArmor: 1, pierceArmor: 7, los: 10, classes: DEF, garrison: 5,
  attack: { damage: 5, range: 8, minRange: 1, reload: 2, arrows: 1, projectile: 'arrow' },
  model: 'watchTower', menu: 'mil', slot: 5,
  description: 'Defensive tower that fires arrows at enemies. Garrison units for extra arrows.',
});
add({
  id: 'guardTower', name: 'Guard Tower', age: 2, cost: { wood: 25, stone: 125 }, buildTime: 80, hp: 1500, size: [1, 1],
  meleeArmor: 1, pierceArmor: 8, los: 10, classes: DEF, garrison: 5,
  attack: { damage: 6, range: 8, minRange: 1, reload: 2, arrows: 1, projectile: 'arrow' },
  model: 'guardTower', menu: 'mil', slot: 5, upgradesFrom: 'watchTower', requiresTech: 'guardTowerUp',
  description: 'Upgraded tower with more hit points and attack.',
});
add({
  id: 'keep', name: 'Keep', age: 3, cost: { wood: 25, stone: 125 }, buildTime: 80, hp: 2250, size: [1, 1],
  meleeArmor: 2, pierceArmor: 9, los: 10, classes: DEF, garrison: 5,
  attack: { damage: 7, range: 8, minRange: 1, reload: 2, arrows: 1, projectile: 'arrow' },
  model: 'keep', menu: 'mil', slot: 5, upgradesFrom: 'guardTower', requiresTech: 'keepUp',
  description: 'The strongest defensive tower.',
});
add({
  id: 'stoneWall', name: 'Stone Wall', age: 1, cost: { stone: 5 }, buildTime: 10, hp: 1800, size: [1, 1],
  meleeArmor: 8, pierceArmor: 10, los: 2, classes: ['building', 'wall', 'stoneDefense'], wall: true,
  model: 'stoneWall', menu: 'mil', slot: 8,
  description: 'Strong stone wall. Drag to place a line.',
});
add({
  id: 'gate', name: 'Gate', age: 1, cost: { stone: 30 }, buildTime: 70, hp: 2750, size: [1, 3],
  meleeArmor: 6, pierceArmor: 6, los: 6, classes: ['building', 'wall', 'stoneDefense'], gate: true,
  model: 'gate', menu: 'mil', slot: 9,
  description: 'Opens for your own units and allies while keeping enemies out. Press R to rotate before placing.',
});
add({
  id: 'monastery', name: 'Temple', age: 2, cost: { stone: 175 }, buildTime: 40, hp: 2100, size: [3, 3],
  meleeArmor: 3, pierceArmor: 10, los: 6, classes: B, trains: ['monk'], garrison: 10,
  researches: ['redemption', 'atonement', 'sanctity', 'fervor', 'blockPrinting', 'illumination', 'faith', 'theocracy'],
  model: 'monastery', menu: 'eco', slot: 8, ageReqFor: 3,
  description: 'Trains priests and houses sacred relics, which generate gold.',
});
add({
  id: 'university', name: 'University', age: 2, cost: { wood: 200 }, buildTime: 60, hp: 2100, size: [4, 4],
  meleeArmor: 0, pierceArmor: 8, los: 6, classes: B,
  researches: ['masonry', 'architecture', 'ballistics', 'chemistry', 'siegeEngineers', 'murderHoles', 'treadmillCrane',
    'guardTowerUp', 'keepUp', 'fortifiedWall', 'heatedShot'],
  requires: ['blacksmith'], model: 'university', menu: 'eco', slot: 9, ageReqFor: 3,
  description: 'Researches technologies for buildings, towers and siege.',
});
add({
  id: 'siegeWorkshop', name: 'Siege Workshop', age: 2, cost: { wood: 200 }, buildTime: 40, hp: 2100, size: [4, 4],
  meleeArmor: 0, pierceArmor: 8, los: 5, classes: B, trains: ['ram', 'mangonel', 'scorpion', 'bombard'],
  researches: ['cappedRamUp', 'siegeRamUp', 'onagerUp', 'siegeOnagerUp', 'heavyScorpionUp'],
  requires: ['blacksmith'], model: 'siegeWorkshop', menu: 'mil', slot: 3, ageReqFor: 3,
  description: 'Builds siege weapons.',
});
add({
  id: 'castle', name: 'Castle', age: 2, cost: { stone: 650 }, buildTime: 200, hp: 4800, size: [4, 4],
  meleeArmor: 8, pierceArmor: 11, los: 11, classes: DEF, trains: ['uniqueUnit', 'trebuchet'], garrison: 20,
  researches: ['eliteUnique', 'uniqueTech1', 'uniqueTech2', 'hoardings', 'sappers', 'conscription'],
  attack: { damage: 11, range: 8, reload: 2, arrows: 4, projectile: 'arrow' },
  model: 'castle', menu: 'mil', slot: 4, ageReqFor: 3,
  description: 'Mighty fortress that trains your unique unit and trebuchets. Fires volleys of arrows.',
});
add({
  id: 'wonder', name: 'Wonder', age: 3, cost: { wood: 1000, gold: 1000, stone: 1000 }, buildTime: 1500, hp: 4800, size: [5, 5],
  meleeArmor: 1, pierceArmor: 10, los: 8, classes: B, model: 'wonder', menu: 'eco', slot: 11, maxPerPlayer: 1,
  description: 'A monument to your civilization. Defend a completed Wonder for 200 years to win the game.',
});

export const BUILDING_LIST = Object.values(BUILDINGS);
