import type { UnitDef } from './types';

const u = (d: UnitDef): UnitDef => d;

export const UNITS: Record<string, UnitDef> = {};
function add(d: UnitDef): void {
  UNITS[d.id] = d;
}

/* ------------------------------------------------------------------ */
/* Economy                                                              */
/* ------------------------------------------------------------------ */
add(u({
  id: 'villager', name: 'Villager', classes: ['villager', 'land'], age: 0, trainedAt: 'townCenter', slot: 0,
  cost: { food: 50 }, trainTime: 25, pop: 1, hp: 25, speed: 0.8, los: 4, attack: 3, attackType: 'melee',
  bonus: { building: 3, animal: 1 }, range: 0, reload: 2, meleeArmor: 0, pierceArmor: 0, radius: 0.18,
  model: 'villager', weapon: 'none', gatherer: true, builder: true,
  description: 'Gathers food, wood, gold and stone, and constructs and repairs buildings. The backbone of every realm.',
}));

add(u({
  id: 'tradeCart', name: 'Trade Cart', classes: ['trade', 'land'], age: 1, trainedAt: 'market', slot: 0,
  cost: { wood: 100, gold: 50 }, trainTime: 51, pop: 1, hp: 70, speed: 1.0, los: 7, attack: 0, attackType: 'melee',
  range: 0, reload: 2, meleeArmor: 0, pierceArmor: 0, radius: 0.35, model: 'tradeCart', trader: true, noGarrison: true,
  description: 'Travels between your Market and a distant allied or own Market, earning gold with every trip. The longer the road, the richer the reward.',
}));

/* ------------------------------------------------------------------ */
/* Barracks                                                             */
/* ------------------------------------------------------------------ */
const infantry = ['infantry', 'land'];
add(u({
  id: 'militia', name: 'Militia', classes: infantry, age: 0, trainedAt: 'barracks', slot: 0, lineOf: 'militia',
  cost: { food: 60, gold: 20 }, trainTime: 21, pop: 1, hp: 40, speed: 0.9, los: 4, attack: 4, attackType: 'melee',
  bonus: { building: 1 }, range: 0, reload: 2, meleeArmor: 0, pierceArmor: 1, radius: 0.2, model: 'militia', weapon: 'sword',
  description: 'Basic swordsman. Cheap and sturdy against buildings and other infantry.',
}));
add(u({
  id: 'manAtArms', name: 'Man-at-Arms', classes: infantry, age: 1, trainedAt: 'barracks', slot: 0, lineOf: 'militia',
  cost: { food: 60, gold: 20 }, trainTime: 21, pop: 1, hp: 45, speed: 0.9, los: 4, attack: 6, attackType: 'melee',
  bonus: { building: 2 }, range: 0, reload: 2, meleeArmor: 0, pierceArmor: 1, radius: 0.2, model: 'manAtArms', weapon: 'sword',
  description: 'Armored swordsman. Strong against infantry and villagers.',
}));
add(u({
  id: 'longSwordsman', name: 'Long Swordsman', classes: infantry, age: 2, trainedAt: 'barracks', slot: 0, lineOf: 'militia',
  cost: { food: 60, gold: 20 }, trainTime: 21, pop: 1, hp: 60, speed: 0.9, los: 4, attack: 9, attackType: 'melee',
  bonus: { building: 3 }, range: 0, reload: 2, meleeArmor: 1, pierceArmor: 1, radius: 0.2, model: 'longSwordsman', weapon: 'sword',
  description: 'Veteran swordsman in mail. Good against infantry and buildings.',
}));
add(u({
  id: 'twoHanded', name: 'Two-Handed Swordsman', classes: infantry, age: 3, trainedAt: 'barracks', slot: 0, lineOf: 'militia',
  cost: { food: 60, gold: 20 }, trainTime: 21, pop: 1, hp: 60, speed: 0.9, los: 5, attack: 12, attackType: 'melee',
  bonus: { building: 4 }, range: 0, reload: 2, meleeArmor: 1, pierceArmor: 1, radius: 0.2, model: 'twoHanded', weapon: 'greatsword',
  description: 'Wields a massive blade. Devastating against other foot soldiers.',
}));
add(u({
  id: 'champion', name: 'Champion', classes: infantry, age: 3, trainedAt: 'barracks', slot: 0, lineOf: 'militia',
  cost: { food: 60, gold: 20 }, trainTime: 21, pop: 1, hp: 70, speed: 0.9, los: 5, attack: 13, attackType: 'melee',
  bonus: { building: 4 }, range: 0, reload: 2, meleeArmor: 2, pierceArmor: 1, radius: 0.2, model: 'champion', weapon: 'greatsword',
  description: 'The finest swordsman of the age.',
}));

const spear = ['infantry', 'spear', 'land'];
add(u({
  id: 'spearman', name: 'Spearman', classes: spear, age: 1, trainedAt: 'barracks', slot: 1, lineOf: 'spearman',
  cost: { food: 35, wood: 25 }, trainTime: 22, pop: 1, hp: 45, speed: 1.0, los: 4, attack: 3, attackType: 'melee',
  bonus: { cavalry: 15, building: 1 }, range: 0, reload: 3, meleeArmor: 0, pierceArmor: 0, radius: 0.2, model: 'spearman', weapon: 'spear',
  description: 'Cheap anti-cavalry infantry. Weak against archers and swordsmen.',
}));
add(u({
  id: 'pikeman', name: 'Pikeman', classes: spear, age: 2, trainedAt: 'barracks', slot: 1, lineOf: 'spearman',
  cost: { food: 35, wood: 25 }, trainTime: 22, pop: 1, hp: 55, speed: 1.0, los: 4, attack: 4, attackType: 'melee',
  bonus: { cavalry: 22, building: 1 }, range: 0, reload: 3, meleeArmor: 0, pierceArmor: 0, radius: 0.2, model: 'pikeman', weapon: 'pike',
  description: 'Anti-cavalry infantry with a long pike.',
}));
add(u({
  id: 'halberdier', name: 'Halberdier', classes: spear, age: 3, trainedAt: 'barracks', slot: 1, lineOf: 'spearman',
  cost: { food: 35, wood: 25 }, trainTime: 22, pop: 1, hp: 60, speed: 1.0, los: 4, attack: 6, attackType: 'melee',
  bonus: { cavalry: 32, building: 1 }, range: 0, reload: 3, meleeArmor: 0, pierceArmor: 0, radius: 0.2, model: 'halberdier', weapon: 'halberd',
  description: 'The ultimate horse-killer.',
}));

/* ------------------------------------------------------------------ */
/* Archery Range                                                        */
/* ------------------------------------------------------------------ */
const archer = ['archer', 'footArcher', 'land'];
add(u({
  id: 'archer', name: 'Archer', classes: archer, age: 1, trainedAt: 'archeryRange', slot: 0, lineOf: 'archer',
  cost: { wood: 25, gold: 45 }, trainTime: 35, pop: 1, hp: 30, speed: 0.96, los: 6, attack: 4, attackType: 'pierce',
  bonus: { spear: 3 }, range: 4, reload: 2, accuracy: 0.8, projectile: 'arrow', projectileSpeed: 7,
  meleeArmor: 0, pierceArmor: 0, radius: 0.2, model: 'archer', weapon: 'bow',
  description: 'Ranged foot soldier. Strong against infantry, weak against skirmishers and cavalry.',
}));
add(u({
  id: 'crossbowman', name: 'Crossbowman', classes: archer, age: 2, trainedAt: 'archeryRange', slot: 0, lineOf: 'archer',
  cost: { wood: 25, gold: 45 }, trainTime: 27, pop: 1, hp: 35, speed: 0.96, los: 7, attack: 5, attackType: 'pierce',
  bonus: { spear: 3 }, range: 5, reload: 2, accuracy: 0.85, projectile: 'bolt', projectileSpeed: 8,
  meleeArmor: 0, pierceArmor: 0, radius: 0.2, model: 'crossbowman', weapon: 'crossbow',
  description: 'Improved archer with a crossbow.',
}));
add(u({
  id: 'arbalest', name: 'Arbalest', classes: archer, age: 3, trainedAt: 'archeryRange', slot: 0, lineOf: 'archer',
  cost: { wood: 25, gold: 45 }, trainTime: 27, pop: 1, hp: 40, speed: 0.96, los: 7, attack: 6, attackType: 'pierce',
  bonus: { spear: 3 }, range: 5, reload: 2, accuracy: 0.9, projectile: 'bolt', projectileSpeed: 8,
  meleeArmor: 0, pierceArmor: 0, radius: 0.2, model: 'arbalest', weapon: 'crossbow',
  description: 'Master crossbowman with a heavy steel arbalest.',
}));
const skirm = ['archer', 'footArcher', 'skirmisher', 'land'];
add(u({
  id: 'skirmisher', name: 'Skirmisher', classes: skirm, age: 1, trainedAt: 'archeryRange', slot: 1, lineOf: 'skirmisher',
  cost: { food: 25, wood: 35 }, trainTime: 22, pop: 1, hp: 30, speed: 0.96, los: 6, attack: 2, attackType: 'pierce',
  bonus: { archer: 3, spear: 3 }, range: 4, minRange: 1, reload: 3, accuracy: 0.9, projectile: 'javelin', projectileSpeed: 6,
  meleeArmor: 0, pierceArmor: 3, radius: 0.2, model: 'skirmisher', weapon: 'javelin',
  description: 'Javelin thrower. Cheap counter to archers; weak in melee.',
}));
add(u({
  id: 'eliteSkirmisher', name: 'Elite Skirmisher', classes: skirm, age: 2, trainedAt: 'archeryRange', slot: 1, lineOf: 'skirmisher',
  cost: { food: 25, wood: 35 }, trainTime: 22, pop: 1, hp: 35, speed: 0.96, los: 7, attack: 3, attackType: 'pierce',
  bonus: { archer: 4, spear: 3 }, range: 5, minRange: 1, reload: 3, accuracy: 0.9, projectile: 'javelin', projectileSpeed: 6,
  meleeArmor: 0, pierceArmor: 4, radius: 0.2, model: 'eliteSkirmisher', weapon: 'javelin',
  description: 'Veteran skirmisher with extra armor against arrows.',
}));
const cavArcher = ['archer', 'cavalry', 'cavArcher', 'mounted', 'land'];
add(u({
  id: 'cavArcher', name: 'Cavalry Archer', classes: cavArcher, age: 2, trainedAt: 'archeryRange', slot: 2, lineOf: 'cavArcher',
  cost: { wood: 40, gold: 70 }, trainTime: 34, pop: 1, hp: 50, speed: 1.4, los: 6, attack: 6, attackType: 'pierce',
  bonus: { spear: 2 }, range: 4, reload: 2, accuracy: 0.6, projectile: 'arrow', projectileSpeed: 7,
  meleeArmor: 0, pierceArmor: 0, radius: 0.3, model: 'cavArcher', weapon: 'bow', noGarrison: true,
  description: 'Mounted archer. Fast and mobile; excels at hit-and-run.',
}));
add(u({
  id: 'heavyCavArcher', name: 'Heavy Cavalry Archer', classes: cavArcher, age: 3, trainedAt: 'archeryRange', slot: 2, lineOf: 'cavArcher',
  cost: { wood: 40, gold: 70 }, trainTime: 27, pop: 1, hp: 60, speed: 1.4, los: 6, attack: 7, attackType: 'pierce',
  bonus: { spear: 2 }, range: 4, reload: 2, accuracy: 0.6, projectile: 'arrow', projectileSpeed: 7,
  meleeArmor: 1, pierceArmor: 0, radius: 0.3, model: 'heavyCavArcher', weapon: 'bow', noGarrison: true,
  description: 'Armored mounted archer.',
}));
add(u({
  id: 'handCannoneer', name: 'Hand Cannoneer', classes: ['archer', 'footArcher', 'gunpowder', 'land'], age: 3, trainedAt: 'archeryRange', slot: 3,
  lineOf: 'handCannoneer', cost: { food: 45, gold: 50 }, trainTime: 34, pop: 1, hp: 35, speed: 0.96, los: 9, attack: 17, attackType: 'pierce',
  bonus: { infantry: 10, spear: 1 }, range: 7, reload: 3.45, accuracy: 0.75, projectile: 'bullet', projectileSpeed: 14,
  meleeArmor: 1, pierceArmor: 0, radius: 0.2, model: 'handCannoneer', weapon: 'gun',
  description: 'Early firearm infantry. Inaccurate but shreds infantry. Requires Chemistry.',
}));

/* ------------------------------------------------------------------ */
/* Stable                                                               */
/* ------------------------------------------------------------------ */
const cav = ['cavalry', 'mounted', 'land'];
add(u({
  id: 'scout', name: 'Scout Cavalry', classes: cav, age: 0, trainedAt: 'stable', slot: 0, lineOf: 'scout',
  cost: { food: 80 }, trainTime: 30, pop: 1, hp: 45, speed: 1.55, los: 6, attack: 3, attackType: 'melee',
  bonus: { monk: 6 }, range: 0, reload: 2, meleeArmor: 0, pierceArmor: 2, radius: 0.3, model: 'scout', weapon: 'spear', noGarrison: true,
  description: 'Fast light rider for exploring the map and raiding.',
}));
add(u({
  id: 'lightCav', name: 'Light Cavalry', classes: cav, age: 2, trainedAt: 'stable', slot: 0, lineOf: 'scout',
  cost: { food: 80 }, trainTime: 30, pop: 1, hp: 60, speed: 1.5, los: 8, attack: 7, attackType: 'melee',
  bonus: { monk: 10 }, range: 0, reload: 2, meleeArmor: 0, pierceArmor: 2, radius: 0.3, model: 'lightCav', weapon: 'sword', noGarrison: true,
  description: 'Fast raider, good against monks and siege.',
}));
add(u({
  id: 'hussar', name: 'Hussar', classes: cav, age: 3, trainedAt: 'stable', slot: 0, lineOf: 'scout',
  cost: { food: 80 }, trainTime: 30, pop: 1, hp: 75, speed: 1.5, los: 10, attack: 7, attackType: 'melee',
  bonus: { monk: 12 }, range: 0, reload: 1.9, meleeArmor: 0, pierceArmor: 2, radius: 0.3, model: 'hussar', weapon: 'sword', noGarrison: true,
  description: 'Elite light cavalry.',
}));
add(u({
  id: 'knight', name: 'Knight', classes: cav, age: 2, trainedAt: 'stable', slot: 1, lineOf: 'knight',
  cost: { food: 60, gold: 75 }, trainTime: 30, pop: 1, hp: 100, speed: 1.35, los: 4, attack: 10, attackType: 'melee',
  range: 0, reload: 1.8, meleeArmor: 2, pierceArmor: 2, radius: 0.3, model: 'knight', weapon: 'sword', noGarrison: true,
  description: 'Heavily armored cavalry. Powerful all-rounder, weak against spears and camels.',
}));
add(u({
  id: 'cavalier', name: 'Cavalier', classes: cav, age: 3, trainedAt: 'stable', slot: 1, lineOf: 'knight',
  cost: { food: 60, gold: 75 }, trainTime: 30, pop: 1, hp: 120, speed: 1.35, los: 4, attack: 12, attackType: 'melee',
  range: 0, reload: 1.8, meleeArmor: 2, pierceArmor: 2, radius: 0.3, model: 'cavalier', weapon: 'sword', noGarrison: true,
  description: 'Upgraded knight.',
}));
add(u({
  id: 'paladin', name: 'Paladin', classes: cav, age: 3, trainedAt: 'stable', slot: 1, lineOf: 'knight',
  cost: { food: 60, gold: 75 }, trainTime: 30, pop: 1, hp: 160, speed: 1.35, los: 5, attack: 14, attackType: 'melee',
  range: 0, reload: 1.9, meleeArmor: 2, pierceArmor: 3, radius: 0.3, model: 'paladin', weapon: 'sword', noGarrison: true,
  description: 'The mightiest heavy cavalry.',
}));
add(u({
  id: 'camel', name: 'Camel Rider', classes: ['cavalry', 'camel', 'mounted', 'land'], age: 2, trainedAt: 'stable', slot: 2, lineOf: 'camel',
  cost: { food: 55, gold: 60 }, trainTime: 22, pop: 1, hp: 100, speed: 1.45, los: 4, attack: 6, attackType: 'melee',
  bonus: { cavalry: 9 }, range: 0, reload: 2, meleeArmor: 0, pierceArmor: 0, radius: 0.3, model: 'camel', weapon: 'sword', noGarrison: true,
  description: 'Horses fear its scent. Strong against cavalry.',
}));
add(u({
  id: 'heavyCamel', name: 'Heavy Camel Rider', classes: ['cavalry', 'camel', 'mounted', 'land'], age: 3, trainedAt: 'stable', slot: 2, lineOf: 'camel',
  cost: { food: 55, gold: 60 }, trainTime: 22, pop: 1, hp: 120, speed: 1.45, los: 5, attack: 7, attackType: 'melee',
  bonus: { cavalry: 18 }, range: 0, reload: 2, meleeArmor: 1, pierceArmor: 0, radius: 0.3, model: 'heavyCamel', weapon: 'sword', noGarrison: true,
  description: 'Upgraded camel rider.',
}));

/* ------------------------------------------------------------------ */
/* Siege Workshop                                                       */
/* ------------------------------------------------------------------ */
const ram = ['siege', 'ram', 'land'];
add(u({
  id: 'ram', name: 'Battering Ram', classes: ram, age: 2, trainedAt: 'siegeWorkshop', slot: 0, lineOf: 'ram',
  cost: { wood: 160, gold: 75 }, trainTime: 36, pop: 1, hp: 175, speed: 0.5, los: 3, attack: 2, attackType: 'melee',
  bonus: { building: 125, siege: 40 }, range: 0, reload: 5, meleeArmor: 0, pierceArmor: 180, radius: 0.45,
  model: 'ram', garrisonCapacity: 4, noGarrison: true,
  description: 'Covered ram for smashing buildings. Nearly immune to arrows. Infantry may garrison inside.',
}));
add(u({
  id: 'cappedRam', name: 'Capped Ram', classes: ram, age: 3, trainedAt: 'siegeWorkshop', slot: 0, lineOf: 'ram',
  cost: { wood: 160, gold: 75 }, trainTime: 36, pop: 1, hp: 200, speed: 0.5, los: 3, attack: 3, attackType: 'melee',
  bonus: { building: 150, siege: 50 }, range: 0, reload: 5, meleeArmor: 0, pierceArmor: 190, radius: 0.45,
  model: 'cappedRam', garrisonCapacity: 4, noGarrison: true, description: 'Improved battering ram.',
}));
add(u({
  id: 'siegeRam', name: 'Siege Ram', classes: ram, age: 3, trainedAt: 'siegeWorkshop', slot: 0, lineOf: 'ram',
  cost: { wood: 160, gold: 75 }, trainTime: 36, pop: 1, hp: 270, speed: 0.6, los: 3, attack: 4, attackType: 'melee',
  bonus: { building: 200, siege: 65 }, range: 0, reload: 5, meleeArmor: 0, pierceArmor: 195, radius: 0.5,
  model: 'siegeRam', garrisonCapacity: 6, noGarrison: true, description: 'The heaviest ram.',
}));
const mangonel = ['siege', 'land'];
add(u({
  id: 'mangonel', name: 'Mangonel', classes: mangonel, age: 2, trainedAt: 'siegeWorkshop', slot: 1, lineOf: 'mangonel',
  cost: { wood: 160, gold: 135 }, trainTime: 46, pop: 1, hp: 50, speed: 0.6, los: 9, attack: 40, attackType: 'melee',
  bonus: { building: 35, ship: 12 }, range: 7, minRange: 3, reload: 6, accuracy: 0.9, projectile: 'stone', projectileSpeed: 6,
  splash: 1.0, friendlyFire: true, meleeArmor: 0, pierceArmor: 6, radius: 0.45, model: 'mangonel', attackDelay: 0.6, noGarrison: true,
  description: 'Hurls rocks that damage everything in an area — including friends.',
}));
add(u({
  id: 'onager', name: 'Onager', classes: mangonel, age: 3, trainedAt: 'siegeWorkshop', slot: 1, lineOf: 'mangonel',
  cost: { wood: 160, gold: 135 }, trainTime: 46, pop: 1, hp: 60, speed: 0.6, los: 10, attack: 50, attackType: 'melee',
  bonus: { building: 45, ship: 12 }, range: 8, minRange: 3, reload: 6, accuracy: 0.9, projectile: 'stone', projectileSpeed: 6,
  splash: 1.0, friendlyFire: true, meleeArmor: 0, pierceArmor: 7, radius: 0.45, model: 'onager', attackDelay: 0.6, noGarrison: true,
  description: 'Improved mangonel.',
}));
add(u({
  id: 'siegeOnager', name: 'Siege Onager', classes: mangonel, age: 3, trainedAt: 'siegeWorkshop', slot: 1, lineOf: 'mangonel',
  cost: { wood: 160, gold: 135 }, trainTime: 46, pop: 1, hp: 70, speed: 0.6, los: 10, attack: 75, attackType: 'melee',
  bonus: { building: 60, ship: 15 }, range: 8, minRange: 3, reload: 6, accuracy: 0.9, projectile: 'boulder', projectileSpeed: 6,
  splash: 1.5, friendlyFire: true, meleeArmor: 0, pierceArmor: 8, radius: 0.5, model: 'siegeOnager', attackDelay: 0.6, noGarrison: true,
  description: 'Huge stone thrower that can clear forests.',
}));
add(u({
  id: 'scorpion', name: 'Scorpion', classes: ['siege', 'land'], age: 2, trainedAt: 'siegeWorkshop', slot: 2, lineOf: 'scorpion',
  cost: { wood: 75, gold: 75 }, trainTime: 30, pop: 1, hp: 40, speed: 0.65, los: 9, attack: 12, attackType: 'pierce',
  bonus: { elephant: 6 }, range: 7, minRange: 2, reload: 3.6, accuracy: 1, projectile: 'bolt', projectileSpeed: 9, passThrough: true,
  meleeArmor: 0, pierceArmor: 7, radius: 0.4, model: 'scorpion', noGarrison: true,
  description: 'Giant crossbow whose bolts pierce through rows of troops.',
}));
add(u({
  id: 'heavyScorpion', name: 'Heavy Scorpion', classes: ['siege', 'land'], age: 3, trainedAt: 'siegeWorkshop', slot: 2, lineOf: 'scorpion',
  cost: { wood: 75, gold: 75 }, trainTime: 30, pop: 1, hp: 50, speed: 0.65, los: 9, attack: 16, attackType: 'pierce',
  bonus: { elephant: 8 }, range: 7, minRange: 2, reload: 3.6, accuracy: 1, projectile: 'bolt', projectileSpeed: 9, passThrough: true,
  meleeArmor: 0, pierceArmor: 7, radius: 0.4, model: 'heavyScorpion', noGarrison: true, description: 'Improved scorpion.',
}));
add(u({
  id: 'bombard', name: 'Bombard Cannon', classes: ['siege', 'gunpowder', 'land'], age: 3, trainedAt: 'siegeWorkshop', slot: 3, lineOf: 'bombard',
  cost: { wood: 225, gold: 225 }, trainTime: 56, pop: 1, hp: 80, speed: 0.7, los: 14, attack: 40, attackType: 'pierce',
  bonus: { building: 200, siege: 20, ship: 40 }, range: 12, minRange: 5, reload: 6.5, accuracy: 0.92, projectile: 'cannonball', projectileSpeed: 12,
  splash: 0.5, meleeArmor: 2, pierceArmor: 5, radius: 0.5, model: 'bombard', noGarrison: true,
  description: 'Gunpowder siege with enormous range. Requires Chemistry.',
}));
add(u({
  id: 'trebuchet', name: 'Trebuchet', classes: ['siege', 'land'], age: 2, trainedAt: 'castle', slot: 1, lineOf: 'trebuchet',
  cost: { wood: 200, gold: 200 }, trainTime: 50, pop: 1, hp: 150, speed: 0.8, los: 19, attack: 200, attackType: 'melee',
  bonus: { building: 250, ship: 50 }, range: 16, minRange: 4, reload: 10, accuracy: 0.8, projectile: 'boulder', projectileSpeed: 7,
  splash: 0.5, meleeArmor: 2, pierceArmor: 150, radius: 0.6, model: 'trebuchet', packs: true, attackDelay: 1.2, noGarrison: true,
  description: 'Long-range siege engine that must unpack to fire. Levels castles.',
}));

/* ------------------------------------------------------------------ */
/* Monastery                                                            */
/* ------------------------------------------------------------------ */
add(u({
  id: 'monk', name: 'Priest', classes: ['monk', 'land'], age: 2, trainedAt: 'monastery', slot: 0,
  cost: { gold: 100 }, trainTime: 51, pop: 1, hp: 30, speed: 0.7, los: 11, attack: 0, attackType: 'melee',
  range: 9, reload: 1, meleeArmor: 0, pierceArmor: 0, radius: 0.2, model: 'monk', weapon: 'staff', monk: true,
  description: 'Heals friendly units, converts enemies to your faith, and carries relics to the Temple.',
}));

/* ------------------------------------------------------------------ */
/* Unique units                                                         */
/* ------------------------------------------------------------------ */
function uu(base: UnitDef, elite: Partial<UnitDef> & { name: string }): void {
  add(u({ ...base, unique: true, trainedAt: 'castle', slot: 0, lineOf: base.id }));
  add(u({ ...base, ...elite, id: 'elite' + base.id[0].toUpperCase() + base.id.slice(1), unique: true, trainedAt: 'castle', slot: 0, lineOf: base.id }));
}

uu({
  id: 'warElephant', name: 'War Elephant', civ: 'carthaginians', classes: ['cavalry', 'elephant', 'mounted', 'land', 'unique'], age: 2, trainedAt: 'castle',
  cost: { food: 170, gold: 85 }, trainTime: 31, pop: 1, hp: 450, speed: 0.6, los: 4, attack: 15, attackType: 'melee',
  bonus: { building: 7 }, range: 0, reload: 2, meleeArmor: 1, pierceArmor: 2, radius: 0.55, trample: 0.25,
  model: 'warElephant', weapon: 'tusk', noGarrison: true,
  description: 'Carthaginian unique unit. A living siege tower that tramples all around it. Slow but nearly unstoppable.',
}, { name: 'Elite War Elephant', hp: 600, attack: 20, meleeArmor: 1, pierceArmor: 3, model: 'eliteWarElephant' });

uu({
  id: 'legionary', name: 'Legionary', civ: 'latins', classes: ['infantry', 'land', 'unique'], age: 2, trainedAt: 'castle',
  cost: { food: 60, gold: 35 }, trainTime: 16, pop: 1, hp: 65, speed: 0.9, los: 5, attack: 9, attackType: 'melee',
  bonus: { building: 2, siege: 4 }, range: 0, reload: 2, meleeArmor: 1, pierceArmor: 4, radius: 0.2,
  model: 'legionary', weapon: 'sword',
  description: 'Latin unique unit. Shield-wall infantry that shrugs off arrows.',
}, { name: 'Elite Legionary', hp: 80, attack: 12, meleeArmor: 2, pierceArmor: 6, model: 'eliteLegionary' });

uu({
  id: 'phalangite', name: 'Phalangite', civ: 'hellenes', classes: ['infantry', 'spear', 'land', 'unique'], age: 2, trainedAt: 'castle',
  cost: { food: 55, wood: 20, gold: 20 }, trainTime: 18, pop: 1, hp: 70, speed: 0.85, los: 4, attack: 5, attackType: 'melee',
  bonus: { cavalry: 20, building: 1 }, range: 1, reload: 3, meleeArmor: 2, pierceArmor: 1, radius: 0.2,
  model: 'phalangite', weapon: 'pike',
  description: 'Hellene unique unit. Sarissa pikemen who strike from the second rank and hold any charge.',
}, { name: 'Elite Phalangite', hp: 90, attack: 7, meleeArmor: 3, pierceArmor: 2, bonus: { cavalry: 28, building: 1 }, model: 'elitePhalangite' });

uu({
  id: 'gaesatae', name: 'Gaesatae', civ: 'gauls', classes: ['infantry', 'land', 'unique'], age: 2, trainedAt: 'castle',
  cost: { food: 65, gold: 25 }, trainTime: 10, pop: 1, hp: 65, speed: 1.38, los: 4, attack: 8, attackType: 'melee',
  bonus: { building: 3, siege: 4 }, range: 0, reload: 2, meleeArmor: 0, pierceArmor: 1, radius: 0.2,
  model: 'gaesatae', weapon: 'greatsword',
  description: 'Gallic unique unit. Fearless warband that charges faster than any foot soldier.',
}, { name: 'Elite Gaesatae', hp: 80, attack: 13, meleeArmor: 0, pierceArmor: 1, model: 'eliteGaesatae' });

uu({
  id: 'berserker', name: 'Wolfcoat', civ: 'suebi', classes: ['infantry', 'land', 'unique'], age: 2, trainedAt: 'castle',
  cost: { food: 65, gold: 25 }, trainTime: 16, pop: 1, hp: 54, speed: 1.05, los: 4, attack: 9, attackType: 'melee',
  bonus: { building: 2 }, range: 0, reload: 2, meleeArmor: 0, pierceArmor: 1, radius: 0.2, regen: 20,
  model: 'berserker', weapon: 'axe',
  description: 'Suebian unique unit. Wolf-pelted berserker whose wounds close in battle.',
}, { name: 'Elite Wolfcoat', hp: 62, attack: 14, meleeArmor: 2, pierceArmor: 1, regen: 40, model: 'eliteBerserker' });

uu({
  id: 'horseArcher', name: 'Parthian Rider', civ: 'parthians', classes: ['archer', 'cavalry', 'cavArcher', 'mounted', 'land', 'unique'], age: 2, trainedAt: 'castle',
  cost: { wood: 55, gold: 65 }, trainTime: 26, pop: 1, hp: 60, speed: 1.45, los: 6, attack: 6, attackType: 'pierce',
  bonus: { siege: 3, spear: 2 }, range: 4, reload: 1.7, accuracy: 0.9, projectile: 'arrow', projectileSpeed: 7,
  meleeArmor: 0, pierceArmor: 0, radius: 0.3, model: 'horseArcher', weapon: 'bow', noGarrison: true,
  description: 'Parthian unique unit. Horse archer famed for the backward shot. Fires faster than any rider.',
}, { name: 'Elite Parthian Rider', hp: 65, attack: 8, meleeArmor: 1, pierceArmor: 1, range: 5, model: 'eliteHorseArcher' });

uu({
  id: 'bowman', name: 'Ta-Seti Bowman', civ: 'kushites', classes: ['archer', 'footArcher', 'land', 'unique'], age: 2, trainedAt: 'castle',
  cost: { wood: 35, gold: 40 }, trainTime: 19, pop: 1, hp: 35, speed: 0.96, los: 8, attack: 5, attackType: 'pierce',
  bonus: { spear: 3 }, range: 6, reload: 2, accuracy: 0.8, projectile: 'arrow', projectileSpeed: 8,
  meleeArmor: 0, pierceArmor: 1, radius: 0.2, model: 'bowman', weapon: 'longbow',
  description: 'Kushite unique unit. Archer of the Land of the Bow, with unmatched range.',
}, { name: 'Elite Ta-Seti Bowman', hp: 40, attack: 6, pierceArmor: 1, range: 7, accuracy: 0.9, model: 'eliteBowman' });

uu({
  id: 'fireLancer', name: 'Fire Lancer', civ: 'han', classes: ['infantry', 'gunpowder', 'land', 'unique'], age: 2, trainedAt: 'castle',
  cost: { food: 50, gold: 45 }, trainTime: 20, pop: 1, hp: 55, speed: 1.0, los: 5, attack: 10, attackType: 'pierce',
  bonus: { infantry: 4, building: 6 }, range: 2, reload: 3, accuracy: 1, projectile: 'fire', projectileSpeed: 10, splash: 0.6,
  meleeArmor: 1, pierceArmor: 1, radius: 0.2, model: 'fireLancer', weapon: 'fireLance',
  description: 'Han unique unit. A spear with a bamboo tube of black powder that bursts in a gout of flame.',
}, { name: 'Elite Fire Lancer', hp: 70, attack: 14, meleeArmor: 2, pierceArmor: 2, model: 'eliteFireLancer' });

/* ------------------------------------------------------------------ */
/* Dock                                                                 */
/* ------------------------------------------------------------------ */
const ship = ['ship', 'naval'];
add(u({
  id: 'fishingShip', name: 'Fishing Ship', classes: ship, age: 0, trainedAt: 'dock', slot: 0,
  cost: { wood: 75 }, trainTime: 40, pop: 1, hp: 60, speed: 1.26, los: 5, attack: 0, attackType: 'melee',
  range: 0, reload: 2, meleeArmor: 0, pierceArmor: 4, radius: 0.45, model: 'fishingShip', naval: true, gatherer: true, fisher: true, noGarrison: true,
  description: 'Gathers fish from the sea and brings it to the Dock.',
}));
add(u({
  id: 'transportShip', name: 'Transport Ship', classes: ship, age: 0, trainedAt: 'dock', slot: 1,
  cost: { wood: 125 }, trainTime: 46, pop: 1, hp: 100, speed: 1.45, los: 5, attack: 0, attackType: 'melee',
  range: 0, reload: 2, meleeArmor: 4, pierceArmor: 8, radius: 0.55, model: 'transportShip', naval: true, transport: true, garrisonCapacity: 5, noGarrison: true,
  description: 'Carries up to 5 land units across water. Right-click land to unload.',
}));
add(u({
  id: 'tradeCog', name: 'Trade Cog', classes: [...ship, 'trade'], age: 1, trainedAt: 'dock', slot: 2,
  cost: { wood: 100, gold: 50 }, trainTime: 36, pop: 1, hp: 80, speed: 1.32, los: 6, attack: 0, attackType: 'melee',
  range: 0, reload: 2, meleeArmor: 0, pierceArmor: 6, radius: 0.5, model: 'tradeCog', naval: true, trader: true, noGarrison: true,
  description: 'Sails between your Dock and a distant Dock, earning gold.',
}));
const warship = ['ship', 'naval', 'warship'];
add(u({
  id: 'galley', name: 'Galley', classes: warship, age: 1, trainedAt: 'dock', slot: 3, lineOf: 'galley',
  cost: { wood: 90, gold: 30 }, trainTime: 60, pop: 1, hp: 120, speed: 1.43, los: 7, attack: 6, attackType: 'pierce',
  bonus: { ship: 4 }, range: 5, reload: 3, accuracy: 0.9, projectile: 'arrow', projectileSpeed: 8,
  meleeArmor: 0, pierceArmor: 6, radius: 0.6, model: 'galley', naval: true, noGarrison: true,
  description: 'Oared warship with archers. Good all-round naval unit.',
}));
add(u({
  id: 'warGalley', name: 'War Galley', classes: warship, age: 2, trainedAt: 'dock', slot: 3, lineOf: 'galley',
  cost: { wood: 90, gold: 30 }, trainTime: 36, pop: 1, hp: 135, speed: 1.43, los: 8, attack: 7, attackType: 'pierce',
  bonus: { ship: 5 }, range: 6, reload: 3, accuracy: 0.9, projectile: 'arrow', projectileSpeed: 8,
  meleeArmor: 0, pierceArmor: 6, radius: 0.6, model: 'warGalley', naval: true, noGarrison: true, description: 'Improved galley.',
}));
add(u({
  id: 'galleon', name: 'Galleon', classes: warship, age: 3, trainedAt: 'dock', slot: 3, lineOf: 'galley',
  cost: { wood: 90, gold: 30 }, trainTime: 36, pop: 1, hp: 165, speed: 1.43, los: 9, attack: 8, attackType: 'pierce',
  bonus: { ship: 6 }, range: 7, reload: 3, accuracy: 0.9, projectile: 'arrow', projectileSpeed: 8,
  meleeArmor: 0, pierceArmor: 8, radius: 0.65, model: 'galleon', naval: true, noGarrison: true, description: 'The finest archer warship.',
}));
add(u({
  id: 'fireShip', name: 'Fire Ship', classes: warship, age: 2, trainedAt: 'dock', slot: 4, lineOf: 'fireShip',
  cost: { wood: 75, gold: 45 }, trainTime: 36, pop: 1, hp: 100, speed: 1.35, los: 5, attack: 3, attackType: 'pierce',
  bonus: { ship: 5, building: 2 }, range: 2.5, reload: 0.5, accuracy: 1, projectile: 'fire', projectileSpeed: 8,
  meleeArmor: 0, pierceArmor: 6, radius: 0.55, model: 'fireShip', naval: true, noGarrison: true,
  description: 'Sprays burning oil at close range. Destroys other ships.',
}));
add(u({
  id: 'fastFireShip', name: 'Fast Fire Ship', classes: warship, age: 3, trainedAt: 'dock', slot: 4, lineOf: 'fireShip',
  cost: { wood: 75, gold: 45 }, trainTime: 36, pop: 1, hp: 120, speed: 1.43, los: 6, attack: 4, attackType: 'pierce',
  bonus: { ship: 6, building: 2 }, range: 2.5, reload: 0.5, accuracy: 1, projectile: 'fire', projectileSpeed: 8,
  meleeArmor: 0, pierceArmor: 8, radius: 0.55, model: 'fastFireShip', naval: true, noGarrison: true, description: 'Improved fire ship.',
}));
add(u({
  id: 'demolitionShip', name: 'Demolition Ship', classes: warship, age: 2, trainedAt: 'dock', slot: 5, lineOf: 'demolitionShip',
  cost: { wood: 70, gold: 50 }, trainTime: 31, pop: 1, hp: 60, speed: 1.6, los: 6, attack: 110, attackType: 'melee',
  bonus: { building: 150, ship: 40 }, range: 0, reload: 1, splash: 2, friendlyFire: true, meleeArmor: 0, pierceArmor: 3, radius: 0.45,
  model: 'demolitionShip', naval: true, selfDestruct: true, noGarrison: true,
  description: 'A floating powder keg that explodes on contact, wrecking ships and docks.',
}));
add(u({
  id: 'heavyDemolitionShip', name: 'Heavy Demolition Ship', classes: warship, age: 3, trainedAt: 'dock', slot: 5, lineOf: 'demolitionShip',
  cost: { wood: 70, gold: 50 }, trainTime: 31, pop: 1, hp: 70, speed: 1.6, los: 6, attack: 140, attackType: 'melee',
  bonus: { building: 180, ship: 50 }, range: 0, reload: 1, splash: 2.5, friendlyFire: true, meleeArmor: 0, pierceArmor: 5, radius: 0.45,
  model: 'heavyDemolitionShip', naval: true, selfDestruct: true, noGarrison: true, description: 'A bigger floating powder keg.',
}));
add(u({
  id: 'cannonGalleon', name: 'Cannon Galleon', classes: [...warship, 'gunpowder'], age: 3, trainedAt: 'dock', slot: 6, lineOf: 'cannonGalleon',
  cost: { wood: 200, gold: 150 }, trainTime: 46, pop: 1, hp: 120, speed: 1.1, los: 14, attack: 35, attackType: 'pierce',
  bonus: { building: 200 }, range: 13, minRange: 3, reload: 10, accuracy: 0.9, projectile: 'cannonball', projectileSpeed: 12, splash: 0.5,
  meleeArmor: 0, pierceArmor: 6, radius: 0.7, model: 'cannonGalleon', naval: true, noGarrison: true,
  description: 'Bombards coastal buildings from long range. Requires Chemistry.',
}));

/* ------------------------------------------------------------------ */
/* Gaia animals                                                         */
/* ------------------------------------------------------------------ */
add(u({
  id: 'sheep', name: 'Sheep', classes: ['animal', 'land'], age: 0, trainedAt: null, cost: {}, trainTime: 0, pop: 0,
  hp: 7, speed: 0.7, los: 2, attack: 0, attackType: 'melee', range: 0, reload: 2, meleeArmor: 0, pierceArmor: 0,
  radius: 0.2, model: 'sheep', animal: 'sheep', food: 100, herdable: true, noGarrison: true,
  description: 'Livestock. Can be herded by whoever spots it first. Provides 100 food.',
}));
add(u({
  id: 'deer', name: 'Deer', classes: ['animal', 'land'], age: 0, trainedAt: null, cost: {}, trainTime: 0, pop: 0,
  hp: 5, speed: 1.3, los: 3, attack: 0, attackType: 'melee', range: 0, reload: 2, meleeArmor: 0, pierceArmor: 0,
  radius: 0.2, model: 'deer', animal: 'deer', food: 140, noGarrison: true,
  description: 'Skittish game. Flees when attacked. Provides 140 food.',
}));
add(u({
  id: 'boar', name: 'Wild Boar', classes: ['animal', 'land'], age: 0, trainedAt: null, cost: {}, trainTime: 0, pop: 0,
  hp: 75, speed: 0.9, los: 4, attack: 8, attackType: 'melee', range: 0, reload: 2, meleeArmor: 0, pierceArmor: 0,
  radius: 0.28, model: 'boar', animal: 'boar', food: 340, noGarrison: true,
  description: 'Dangerous game that fights back. Lure it to your Town Center. Provides 340 food.',
}));
add(u({
  id: 'wolf', name: 'Wolf', classes: ['animal', 'land'], age: 0, trainedAt: null, cost: {}, trainTime: 0, pop: 0,
  hp: 25, speed: 1.1, los: 6, attack: 3, attackType: 'melee', range: 0, reload: 1.5, meleeArmor: 0, pierceArmor: 0,
  radius: 0.22, model: 'wolf', animal: 'wolf', noGarrison: true,
  description: 'A predator that attacks anything that wanders too close.',
}));

export const UNIT_LIST = Object.values(UNITS);
