import type { BuildingDef, GatherKind, ProjectileKind, Res, UnitDef } from '../data/types';
import type { BuildingStats, UnitStats } from './player';

export type Stance = 'aggressive' | 'defensive' | 'standGround' | 'passive';

export type Order =
  | { t: 'idle' }
  | { t: 'move'; x: number; z: number; attackMove?: boolean }
  | { t: 'attack'; target: number; force?: boolean }
  | { t: 'attackGround'; x: number; z: number }
  | { t: 'gather'; target: number }
  | { t: 'build'; target: number }
  | { t: 'repair'; target: number }
  | { t: 'garrison'; target: number }
  | { t: 'dropoff'; target: number }
  | { t: 'heal'; target: number }
  | { t: 'convert'; target: number }
  | { t: 'patrol'; ax: number; az: number; bx: number; bz: number; leg: 0 | 1 }
  | { t: 'follow'; target: number }
  | { t: 'trade'; target: number }
  | { t: 'relic'; target: number }
  | { t: 'flee'; x: number; z: number; until: number }
  | { t: 'unpack' };

export type AnimName = 'idle' | 'walk' | 'attack' | 'work' | 'die' | 'pack' | 'unpack' | 'carry';
export type WorkTool = 'axe' | 'pick' | 'hammer' | 'hoe' | 'basket' | 'spear' | 'rod' | null;

export class Unit {
  readonly kind = 'unit' as const;
  id: number;
  type: string;
  def: UnitDef;
  stats!: UnitStats;
  owner: number;
  x: number;
  z: number;
  px: number;
  pz: number;
  facing = 0;
  pfacing = 0;
  hp: number;
  alive = true;

  order: Order = { t: 'idle' };
  orderQueue: Order[] = [];
  stance: Stance = 'aggressive';

  // Navigation
  path: number[] = []; // flat x,z pairs
  pathIdx = 0;
  navGoalX = NaN;
  navGoalZ = NaN;
  navGoalR = 0;
  navGoalId = 0;
  navFailed = 0;
  repathAt = 0;
  stuckTime = 0;
  lastProgressX = 0;
  lastProgressZ = 0;
  moving = false;
  navReachable = true;
  navCheckAt = 0;
  navCheckD = 0;

  // Combat
  targetId = 0;
  cooldown = 0;
  attackWindup = -1;
  scanAt = 0;
  lastAttackedAt = -100;
  lastAttackerId = 0;
  /** Position to return to (defensive stance / auto-engage leash). */
  homeX = 0;
  homeZ = 0;
  engagedFrom: Order | null = null;

  // Economy
  carryType: Res | null = null;
  carryAmount = 0;
  gatherKind: GatherKind | null = null;
  lastGatherId = 0;
  lastGatherX = 0;
  lastGatherZ = 0;
  lastGatherKind: GatherKind | null = null;
  /** For villagers: task to resume after building something. */
  prevOrder: Order | null = null;
  returning = false;
  dropId = 0;
  farmSpotX = 0;
  farmSpotZ = 0;
  farmMoveAt = 0;

  // Animation
  anim: AnimName = 'idle';
  animStart = 0;
  tool: WorkTool = null;

  // Containers
  garrisonedIn = 0;
  cargo: number[] = [];

  // Monk
  faith = 100;
  convertTime = 0;
  convertNeed = 0;
  relicId = 0;
  healAcc = 0;

  // Trade
  tradeHome = 0;
  tradeGold = 0;

  // Trebuchet
  packed = true;
  packTimer = 0;

  // Animals
  wanderAt = 0;
  regenAcc = 0;

  constructor(id: number, def: UnitDef, owner: number, x: number, z: number) {
    this.id = id;
    this.type = def.id;
    this.def = def;
    this.owner = owner;
    this.x = this.px = this.lastProgressX = this.homeX = x;
    this.z = this.pz = this.lastProgressZ = this.homeZ = z;
    this.hp = def.hp;
  }

  get radius(): number {
    return this.def.radius;
  }
  setAnim(a: AnimName, now: number): void {
    if (this.anim !== a) {
      this.anim = a;
      this.animStart = now;
    }
  }
}

export interface QueueItem {
  kind: 'unit' | 'tech';
  id: string;
  paid: Partial<Record<Res, number>>;
}

export class Building {
  readonly kind = 'building' as const;
  id: number;
  type: string;
  def: BuildingDef;
  stats!: BuildingStats;
  owner: number;
  tx: number;
  tz: number;
  w: number;
  h: number;
  x: number;
  z: number;
  hp: number;
  alive = true;
  built = false;
  progress = 0;
  builders = 0;
  buildersPrev = 0;
  queue: QueueItem[] = [];
  queueTime = 0;
  blockedByPop = false;
  rally: { x: number; z: number; target: number } | null = null;
  garrison: number[] = [];
  relics: number[] = [];
  attackCooldown = 0;
  /** Farms */
  food = 0;
  farmer = 0;
  /** Bitmask of teams that have seen this building. */
  seenBy = 0;
  lastAttackedAt = -100;
  baseY = 0;
  /** Wonder countdown remaining (seconds), or -1. */
  wonderTimer = -1;
  rotated = false;
  /** Gate open animation 0..1. */
  gateOpen = 0;
  repairAcc = 0;

  constructor(id: number, def: BuildingDef, owner: number, tx: number, tz: number, rotated = false) {
    this.id = id;
    this.type = def.id;
    this.def = def;
    this.owner = owner;
    this.tx = tx;
    this.tz = tz;
    this.rotated = rotated;
    this.w = rotated ? def.size[1] : def.size[0];
    this.h = rotated ? def.size[0] : def.size[1];
    this.x = tx + this.w / 2;
    this.z = tz + this.h / 2;
    this.hp = 1;
  }

  maxHp(): number {
    return this.stats ? this.stats.hp : this.def.hp;
  }
}

export type ResourceType = 'tree' | 'gold' | 'stone' | 'berries' | 'carcass' | 'relic';

export class ResourceNode {
  readonly kind = 'resource' as const;
  id: number;
  type: ResourceType;
  gather: GatherKind;
  amount: number;
  maxAmount: number;
  x: number;
  z: number;
  tx: number;
  tz: number;
  alive = true;
  owner = 0;
  blocks: boolean;
  variant = 0;
  felled = false;
  fellAngle = 0;
  decay = 0;
  /** Model id of the carcass animal. */
  carcassOf = '';
  /** Villagers working this node during the previous tick (for spreading workers). */
  gatherers = 0;
  gatherTick = 0;
  gatherCount = 0;
  /** Relic: unit id carrying it, or building id holding it. */
  heldBy = 0;
  rot = 0;
  scale = 1;
  seen = false;

  constructor(id: number, type: ResourceType, gather: GatherKind, amount: number, tx: number, tz: number, blocks: boolean) {
    this.id = id;
    this.type = type;
    this.gather = gather;
    this.amount = this.maxAmount = amount;
    this.tx = tx;
    this.tz = tz;
    this.x = tx + 0.5;
    this.z = tz + 0.5;
    this.blocks = blocks;
  }
}

export interface Projectile {
  id: number;
  kind: ProjectileKind;
  owner: number;
  sourceId: number;
  sx: number;
  sy: number;
  sz: number;
  tx: number;
  ty: number;
  tz: number;
  t0: number;
  dur: number;
  arc: number;
  targetId: number;
  attack: number;
  attackType: 'melee' | 'pierce';
  bonus: Record<string, number> | undefined;
  splash: number;
  friendlyFire: boolean;
  passThrough: boolean;
  hit: boolean;
  elevMult: number;
  /** If the target was a building, the shot always lands on it. */
  vsBuilding: boolean;
  done: boolean;
}

export type Entity = Unit | Building | ResourceNode;
