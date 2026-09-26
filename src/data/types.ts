export type Res = 'food' | 'wood' | 'gold' | 'stone';
export const RES_LIST: readonly Res[] = ['food', 'wood', 'gold', 'stone'];
export type Cost = Partial<Record<Res, number>>;
export type AgeIndex = 0 | 1 | 2 | 3;
export const AGE_NAMES = ['Dark Age', 'Feudal Age', 'Castle Age', 'Imperial Age'] as const;

export type GatherKind = 'forage' | 'hunt' | 'herd' | 'farm' | 'fish' | 'wood' | 'gold' | 'stone';
export const GATHER_RES: Record<GatherKind, Res> = {
  forage: 'food',
  hunt: 'food',
  herd: 'food',
  farm: 'food',
  fish: 'food',
  wood: 'wood',
  gold: 'gold',
  stone: 'stone',
};

export type ArchStyle = 'mediterranean' | 'northern' | 'desert' | 'eastern';

export type WeaponKind =
  | 'none' | 'sword' | 'greatsword' | 'spear' | 'pike' | 'halberd' | 'bow' | 'longbow' | 'crossbow'
  | 'javelin' | 'axe' | 'club' | 'lance' | 'fireLance' | 'staff' | 'gun' | 'tusk' | 'bite';

export type ProjectileKind = 'arrow' | 'bolt' | 'stone' | 'bullet' | 'javelin' | 'fire' | 'cannonball' | 'boulder';

export interface UnitDef {
  id: string;
  name: string;
  classes: string[];
  age: AgeIndex;
  trainedAt: string | null;
  slot?: number;
  cost: Cost;
  trainTime: number;
  pop: number;
  hp: number;
  speed: number;
  los: number;
  attack: number;
  attackType: 'melee' | 'pierce';
  bonus?: Record<string, number>;
  range: number;
  minRange?: number;
  reload: number;
  attackDelay?: number;
  accuracy?: number;
  projectile?: ProjectileKind;
  projectileSpeed?: number;
  splash?: number;
  friendlyFire?: boolean;
  passThrough?: boolean;
  meleeArmor: number;
  pierceArmor: number;
  radius: number;
  model: string;
  weapon?: WeaponKind;
  /** Base unit id of this upgrade line (e.g. 'militia'). */
  lineOf?: string;
  gatherer?: boolean;
  builder?: boolean;
  monk?: boolean;
  trader?: boolean;
  /** HP regenerated per minute. */
  regen?: number;
  /** Fraction of attack dealt to enemies adjacent to the target. */
  trample?: number;
  garrisonCapacity?: number;
  unique?: boolean;
  civ?: string;
  animal?: 'sheep' | 'deer' | 'boar' | 'wolf';
  food?: number;
  herdable?: boolean;
  description: string;
  /** Trebuchet-style: must unpack before attacking. */
  packs?: boolean;
  /** Ranged unit that can only hit ground (mangonel), not a specific target. */
  groundAttack?: boolean;
  noGarrison?: boolean;
}

export interface BuildingAttack {
  damage: number;
  range: number;
  minRange?: number;
  reload: number;
  arrows: number;
  projectile: ProjectileKind;
  bonus?: Record<string, number>;
}

export interface BuildingDef {
  id: string;
  name: string;
  age: AgeIndex;
  cost: Cost;
  buildTime: number;
  hp: number;
  size: [number, number];
  meleeArmor: number;
  pierceArmor: number;
  los: number;
  classes: string[];
  popProvided?: number;
  dropoff?: Res[];
  trains?: string[];
  researches?: string[];
  garrison?: number;
  attack?: BuildingAttack;
  walkable?: boolean;
  wall?: boolean;
  gate?: boolean;
  requires?: string[];
  model: string;
  menu: 'eco' | 'mil' | 'none';
  slot: number;
  description: string;
  maxPerPlayer?: number;
  naval?: boolean;
  foodCapacity?: number;
  /** Buildings of this type count toward the age-up requirement of this age. */
  ageReqFor?: AgeIndex;
  /** Upgrades existing buildings (guard tower, keep). */
  upgradesFrom?: string;
  /** Available only when this tech is researched. */
  requiresTech?: string;
  /** Can only be built in this age or later (e.g. extra Town Centers). */
  buildAge?: AgeIndex;
}

export interface Selector {
  units?: string[];
  classes?: string[];
  buildings?: string[];
  allUnits?: boolean;
  allBuildings?: boolean;
}

export type UnitStatKey =
  | 'hp' | 'attack' | 'meleeArmor' | 'pierceArmor' | 'range' | 'los' | 'speed' | 'reload'
  | 'trainTime' | 'accuracy' | 'regen' | 'minRange' | 'splash' | 'carry' | 'workRate' | 'buildTime'
  | 'garrisonArrows' | 'healRate' | 'convertRange';

export type Effect =
  | { kind: 'stat'; target: Selector; stat: UnitStatKey; op: 'add' | 'mul' | 'set'; value: number }
  | { kind: 'bonus'; target: Selector; vs: string; value: number }
  | { kind: 'cost'; target: Selector; mult: number; res?: Res }
  | { kind: 'techCost'; mult: number; res?: Res }
  | { kind: 'upgrade'; from: string; to: string }
  | { kind: 'enable'; unit?: string; building?: string }
  | { kind: 'gather'; gather: GatherKind | 'all'; mult: number }
  | { kind: 'carry'; value: number; gather?: GatherKind }
  | { kind: 'farmFood'; value: number }
  | { kind: 'popBonus'; building: string; value: number }
  | { kind: 'buildRate'; mult: number }
  | { kind: 'workRate'; building: string; mult: number }
  | { kind: 'age'; age: AgeIndex }
  | { kind: 'flag'; flag: string; value?: number }
  | { kind: 'resource'; res: Res; value: number };

export interface TechDef {
  id: string;
  name: string;
  age: AgeIndex;
  building: string;
  cost: Cost;
  time: number;
  requires?: string[];
  requiresBuildings?: { count: number; age: AgeIndex };
  effects: Effect[];
  slot: number;
  icon: string;
  description: string;
  civ?: string;
  isAge?: boolean;
  /** Tech that upgrades a unit line — icon shows the resulting unit. */
  upgradeTo?: string;
}

export interface CivBonus {
  text: string;
  effects: Effect[];
  age?: AgeIndex;
}

export interface CivDef {
  id: string;
  name: string;
  realm: string;
  style: ArchStyle;
  motto: string;
  lore: string;
  specialty: string;
  bonuses: CivBonus[];
  teamBonus: CivBonus;
  uniqueUnit: string;
  eliteUniqueUnit: string;
  uniqueTechs: [string, string];
  disabled: string[];
  start?: Partial<Record<Res, number>> & { villagers?: number };
  emblem: { bg: string; fg: string; symbol: string };
  ai: { favored: string[] };
}
