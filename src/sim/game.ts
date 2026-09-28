import { BUILDINGS } from '../data/buildings';
import { CIVS } from '../data/civs';
import { UNITS } from '../data/units';
import type { AgeIndex, GatherKind, ProjectileKind, Res } from '../data/types';
import { RNG } from '../util/rng';
import { distToRect } from '../util/math';
import { Building, ResourceNode, Unit, type Entity, type Projectile, type ResourceType } from './entities';
import { GameMap } from './map';
import { Pathfinder } from './pathfinding';
import { GAIA_COLOR, PLAYER_COLORS, Player } from './player';
import { SpatialHash } from './spatial';
import { Vision } from './vision';
import { updateUnit, resolveCollisions } from './unitAI';
import { updateBuilding, finishConstruction, completeTech } from './buildingAI';
import { updateProjectiles } from './combat';
import { generateMap, type MapType } from './mapgen';

export type Difficulty = 'easy' | 'standard' | 'hard' | 'hardest';

export interface PlayerSetup {
  name: string;
  civ: string;
  color: number;
  team: number;
  human: boolean;
  difficulty: Difficulty;
}

export interface GameSetup {
  seed: number;
  mapType: MapType;
  mapSize: number;
  players: PlayerSetup[];
  resources: 'standard' | 'medium' | 'high';
  popLimit: number;
  reveal: 'normal' | 'explored' | 'all';
  victory: 'standard' | 'conquest';
  startAge: AgeIndex;
  /** Every player is a computer; the viewer only watches. */
  spectator?: boolean;
}

export type GameEvent =
  | { e: 'death'; id: number; type: string; owner: number; x: number; z: number; facing: number }
  | { e: 'bdestroy'; id: number; type: string; owner: number; x: number; z: number; w: number; h: number }
  | { e: 'bcomplete'; id: number; type: string; owner: number }
  | { e: 'trained'; id: number; type: string; owner: number }
  | { e: 'research'; tech: string; owner: number }
  | { e: 'age'; owner: number; age: number }
  | { e: 'attacked'; owner: number; x: number; z: number; what: 'military' | 'villager' | 'building' }
  | { e: 'hit'; x: number; z: number; kind: 'melee' | 'pierce' | 'building' | 'splash' | 'fire'; owner: number }
  | { e: 'shoot'; x: number; z: number; kind: ProjectileKind; owner: number }
  | { e: 'convert'; id: number; from: number; to: number; x: number; z: number }
  | { e: 'defeated'; owner: number }
  | { e: 'gameover'; winnerTeam: number }
  | { e: 'msg'; owner: number; text: string; kind: 'error' | 'info' }
  | { e: 'placed'; owner: number; x: number; z: number }
  | { e: 'fell'; id: number }
  | { e: 'wonder'; owner: number; state: 'started' | 'destroyed' | 'built' }
  | { e: 'relics'; team: number; state: 'held' | 'lost' };

export const TICK = 0.05;

export const GATHER_RATES: Record<GatherKind, number> = {
  forage: 0.31,
  hunt: 0.41,
  herd: 0.33,
  farm: 0.35,
  fish: 0.43,
  wood: 0.39,
  gold: 0.38,
  stone: 0.36,
};

export class Game {
  setup: GameSetup;
  rng: RNG;
  map: GameMap;
  players: Player[] = [];
  teamOf: Int8Array;
  time = 0;
  tickCount = 0;
  nextId = 1;
  entities = new Map<number, Entity>();
  units: Unit[] = [];
  buildings: Building[] = [];
  resources: ResourceNode[] = [];
  projectiles: Projectile[] = [];
  spatial: SpatialHash;
  pathfinder: Pathfinder;
  pathBudget = 0;
  /** Tiles path searches may still explore this tick (a cap on the tick's pathfinding cost). */
  pathNodes = 0;
  /** Fixed targets (resources, buildings) a team's search found no way to: key id * 16 + team -> until when. */
  unreachable = new Map<number, number>();
  events: GameEvent[] = [];
  vision: Vision;
  /** Global market prices (gold per 100 units). */
  market: Record<'food' | 'wood' | 'stone', number> = { food: 100, wood: 100, stone: 100 };
  winnerTeam = -1;
  over = false;
  /** Relic victory: team holding every relic and seconds remaining. */
  relicTeam = -1;
  relicTimer = -1;
  /** animal id -> carcass resource id */
  carcassOf = new Map<number, number>();
  private acc = 0;
  private deadUnits = false;
  private deadBuildings = false;
  private deadResources = false;
  /** Dropoff building cache per player, invalidated when buildings change. */
  private dropoffCache = new Map<number, Building[]>();
  buildingsVersion = 0;
  resourcesVersion = 0;

  /** `restoring`: an empty world for a saved game to be poured into (see save.ts), rather than a new map. */
  constructor(setup: GameSetup, restoring = false) {
    this.setup = setup;
    this.rng = new RNG(setup.seed);
    this.map = new GameMap(setup.mapSize);
    // players: index 0 = gaia
    this.teamOf = new Int8Array(setup.players.length + 1);
    this.players.push(new Player(0, 'Gaia', CIVS.carthaginians, GAIA_COLOR, 99, false, true));
    this.teamOf[0] = 99 & 0x7f;
    setup.players.forEach((ps, i) => {
      const civ = CIVS[ps.civ] ?? CIVS.carthaginians;
      const p = new Player(i + 1, ps.name, civ, PLAYER_COLORS[ps.color % PLAYER_COLORS.length], ps.team, ps.human);
      p.maxPop = setup.popLimit;
      this.players.push(p);
      this.teamOf[i + 1] = ps.team;
    });
    this.spatial = new SpatialHash(setup.mapSize, 2);
    this.pathfinder = new Pathfinder(this.map, this.teamOf);
    this.vision = new Vision(this);
    if (restoring) return;
    generateMap(this);
    this.map.refreshAll();
    this.map.labelWaterBodies();
    this.applyStartAge();
    for (const p of this.players) this.recomputePop(p.id);
    this.spatial.rebuild(this.units);
    this.vision.update(true);
    this.events.length = 0;
  }

  /** Later starting ages: research the ages instantly and add a few villagers. */
  private applyStartAge(): void {
    const age = this.setup.startAge ?? 0;
    if (age <= 0) return;
    const techs = ['feudalAge', 'castleAge', 'imperialAge'];
    for (const p of this.players) {
      if (p.isGaia) continue;
      for (let a = 0; a < age; a++) completeTech(this, p, techs[a]);
      const tc = this.buildings.find((b) => b.owner === p.id && b.type === 'townCenter');
      if (!tc) continue;
      for (let i = 0; i < age * 3; i++) {
        const a = (i / (age * 3)) * Math.PI * 2;
        const pt = this.pathfinder.setDomain(false).nearestPassable(tc.x + Math.cos(a) * 4, tc.z + Math.sin(a) * 4, this.teamOf[p.id], 6);
        if (pt) this.spawnUnit('villager', p.id, pt.x, pt.z);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Entity management                                                    */
  /* ------------------------------------------------------------------ */

  get(id: number): Entity | undefined {
    return this.entities.get(id);
  }
  unit(id: number): Unit | undefined {
    const e = this.entities.get(id);
    return e && e.kind === 'unit' ? e : undefined;
  }
  building(id: number): Building | undefined {
    const e = this.entities.get(id);
    return e && e.kind === 'building' ? e : undefined;
  }

  spawnUnit(type: string, owner: number, x: number, z: number): Unit {
    const def = UNITS[type];
    const u = new Unit(this.nextId++, def, owner, x, z);
    u.stats = this.players[owner].unitStats.get(type)!;
    u.hp = u.stats.hp;
    u.facing = this.rng.range(0, Math.PI * 2);
    u.pfacing = u.facing;
    if (def.packs) u.packed = true;
    this.entities.set(u.id, u);
    this.units.push(u);
    return u;
  }

  createBuilding(type: string, owner: number, tx: number, tz: number, built: boolean, rotated = false): Building {
    const def = BUILDINGS[type];
    const b = new Building(this.nextId++, def, owner, tx, tz, rotated);
    b.stats = this.players[owner].buildingStats.get(type)!;
    const fh = this.map.footprintHeight(tx, tz, b.w, b.h);
    b.baseY = def.naval ? this.map.waterLevel + 0.02 : def.walkable ? fh.avg : fh.max;
    if (built) {
      b.built = true;
      b.progress = 1;
      b.hp = b.stats.hp;
    } else {
      b.hp = Math.max(1, b.stats.hp * 0.02);
    }
    if (def.foodCapacity) b.food = def.foodCapacity + this.players[owner].farmFood;
    this.entities.set(b.id, b);
    this.buildings.push(b);
    if (def.walkable) {
      for (let z = tz; z < tz + b.h; z++) for (let x = tx; x < tx + b.w; x++) this.map.farmAt[this.map.idx(x, z)] = b.id;
    } else {
      this.map.setObstacle(tx, tz, b.w, b.h, b.id);
      if (def.gate) for (let z = tz; z < tz + b.h; z++) for (let x = tx; x < tx + b.w; x++) this.map.gateOwner[this.map.idx(x, z)] = built ? owner : -1;
      this.evictUnits(b);
    }
    this.buildingsVersion++;
    this.dropoffCache.delete(owner);
    if (built) this.recomputePop(owner);
    return b;
  }

  /** Push units standing inside a new footprint out to free tiles. */
  evictUnits(b: Building): void {
    for (const u of this.units) {
      if (!u.alive || u.garrisonedIn) continue;
      if (u.x >= b.tx - 0.1 && u.x <= b.tx + b.w + 0.1 && u.z >= b.tz - 0.1 && u.z <= b.tz + b.h + 0.1) {
        const p = this.pathfinder.setDomain(!!u.def.naval).nearestPassable(u.x, u.z, this.teamOf[u.owner], 8);
        this.pathfinder.setDomain(false);
        if (p) {
          u.x = u.px = p.x;
          u.z = u.pz = p.z;
          u.path = [];
        }
      }
    }
  }

  addResource(type: ResourceType, gather: GatherKind, amount: number, tx: number, tz: number, blocks: boolean): ResourceNode {
    const r = new ResourceNode(this.nextId++, type, gather, amount, tx, tz, blocks);
    this.entities.set(r.id, r);
    this.resources.push(r);
    if (blocks) this.map.setObstacle(tx, tz, 1, 1, r.id);
    this.resourcesVersion++;
    return r;
  }

  removeResource(r: ResourceNode): void {
    if (!r.alive) return;
    r.alive = false;
    if (r.blocks) this.map.clearObstacle(r.tx, r.tz, 1, 1, r.id);
    this.entities.delete(r.id);
    this.deadResources = true;
    this.resourcesVersion++;
  }

  killUnit(u: Unit, killerOwner: number): void {
    if (!u.alive) return;
    u.alive = false;
    u.hp = 0;
    this.entities.delete(u.id);
    this.deadUnits = true;
    const owner = this.players[u.owner];
    if (!u.def.animal) {
      if (!owner.isGaia) owner.stats.unitsLost++;
      if (killerOwner > 0 && killerOwner !== u.owner) this.players[killerOwner].stats.unitsKilled++;
    }
    // release claims
    if (u.order.t === 'gather') {
      const f = this.building(u.order.target);
      if (f && f.farmer === u.id) f.farmer = 0;
    }
    if (u.garrisonedIn) {
      const b = this.get(u.garrisonedIn);
      if (b && b.kind === 'building') b.garrison = b.garrison.filter((id) => id !== u.id);
      else if (b && b.kind === 'unit') b.cargo = b.cargo.filter((id) => id !== u.id);
    }
    // eject cargo (rams); cargo of a sunken transport drowns unless it is next to the shore
    for (const cid of u.cargo) {
      const c = this.unit(cid);
      if (!c) continue;
      c.garrisonedIn = 0;
      if (u.def.naval) {
        const p = this.pathfinder.setDomain(false).nearestPassable(u.x, u.z, this.teamOf[c.owner], 2);
        if (p) {
          c.x = c.px = p.x;
          c.z = c.pz = p.z;
        } else {
          this.killUnit(c, killerOwner);
        }
      } else {
        c.x = c.px = u.x + this.rng.range(-0.5, 0.5);
        c.z = c.pz = u.z + this.rng.range(-0.5, 0.5);
      }
    }
    u.cargo = [];
    if (u.relicId) this.dropRelic(u);
    if (u.def.animal && u.def.food) {
      const tx = Math.floor(u.x), tz = Math.floor(u.z);
      const kind: GatherKind = u.def.animal === 'sheep' ? 'herd' : 'hunt';
      const r = this.addResource('carcass', kind, u.def.food, tx, tz, false);
      r.x = u.x;
      r.z = u.z;
      r.carcassOf = u.def.model;
      r.rot = u.facing;
      r.decay = 0.08;
      this.carcassOf.set(u.id, r.id);
    }
    this.events.push({ e: 'death', id: u.id, type: u.type, owner: u.owner, x: u.x, z: u.z, facing: u.facing });
    if (u.def.pop) this.recomputePop(u.owner);
  }

  destroyBuilding(b: Building, killerOwner: number): void {
    if (!b.alive) return;
    b.alive = false;
    b.hp = 0;
    this.entities.delete(b.id);
    this.deadBuildings = true;
    if (killerOwner > 0 && killerOwner !== b.owner) this.players[killerOwner].stats.buildingsRazed++;
    if (!this.players[b.owner].isGaia && b.built) this.players[b.owner].stats.buildingsLost++;
    if (b.def.walkable) {
      for (let z = b.tz; z < b.tz + b.h; z++)
        for (let x = b.tx; x < b.tx + b.w; x++) if (this.map.farmAt[this.map.idx(x, z)] === b.id) this.map.farmAt[this.map.idx(x, z)] = 0;
    } else {
      this.map.clearObstacle(b.tx, b.tz, b.w, b.h, b.id);
    }
    // eject garrison
    this.pathfinder.setDomain(false);
    for (const id of b.garrison) {
      const u = this.unit(id);
      if (!u) continue;
      u.garrisonedIn = 0;
      const p = this.pathfinder.nearestPassable(b.x + this.rng.range(-1, 1), b.z + this.rng.range(-1, 1), this.teamOf[u.owner], 10);
      if (p) {
        u.x = u.px = p.x;
        u.z = u.pz = p.z;
      }
      u.order = { t: 'idle' };
    }
    b.garrison = [];
    for (const rid of b.relics) {
      const r = this.get(rid);
      if (r && r.kind === 'resource') {
        r.heldBy = 0;
        const p = this.pathfinder.nearestPassable(b.x, b.z, 0, 10);
        if (p) {
          r.x = p.x;
          r.z = p.z;
          r.tx = Math.floor(p.x);
          r.tz = Math.floor(p.z);
        }
      }
    }
    b.relics = [];
    // refund nothing; queued items are lost (AoE2 behaviour)
    for (const q of b.queue) if (q.kind === 'tech') this.players[b.owner].researching.delete(q.id);
    b.queue = [];
    if (b.type === 'wonder' && b.built) this.events.push({ e: 'wonder', owner: b.owner, state: 'destroyed' });
    this.events.push({ e: 'bdestroy', id: b.id, type: b.type, owner: b.owner, x: b.x, z: b.z, w: b.w, h: b.h });
    this.buildingsVersion++;
    this.dropoffCache.delete(b.owner);
    this.recomputePop(b.owner);
  }

  dropRelic(u: Unit): void {
    const r = this.get(u.relicId);
    u.relicId = 0;
    if (r && r.kind === 'resource') {
      r.heldBy = 0;
      r.x = u.x;
      r.z = u.z;
      r.tx = Math.floor(u.x);
      r.tz = Math.floor(u.z);
    }
  }

  /** Change the owner of a unit (conversion / sheep capture). */
  convertUnit(u: Unit, newOwner: number): void {
    const old = u.owner;
    if (old === newOwner) return;
    u.owner = newOwner;
    const hpFrac = u.hp / u.stats.hp;
    u.stats = this.players[newOwner].unitStats.get(u.type)!;
    u.hp = Math.max(1, hpFrac * u.stats.hp);
    u.order = { t: 'idle' };
    u.orderQueue = [];
    u.path = [];
    u.targetId = 0;
    if (u.def.pop) {
      this.recomputePop(old);
      this.recomputePop(newOwner);
    }
  }

  recomputePop(pid: number): void {
    const p = this.players[pid];
    if (!p || p.isGaia) return;
    let pop = 0;
    for (const u of this.units) if (u.alive && u.owner === pid) pop += u.def.pop;
    let cap = 0;
    for (const b of this.buildings) if (b.alive && b.built && b.owner === pid) cap += b.stats.popProvided;
    p.pop = pop;
    p.popCap = Math.min(cap, p.maxPop);
  }

  /* ------------------------------------------------------------------ */
  /* Queries                                                              */
  /* ------------------------------------------------------------------ */

  isEnemy(a: number, b: number): boolean {
    if (a === b) return false;
    if (a === 0 || b === 0) return false;
    return this.teamOf[a] !== this.teamOf[b];
  }
  isAlly(a: number, b: number): boolean {
    return a === b || (a !== 0 && b !== 0 && this.teamOf[a] === this.teamOf[b]);
  }

  invalidateDropoffs(owner: number): void {
    this.dropoffCache.delete(owner);
  }

  dropoffsFor(owner: number): Building[] {
    let list = this.dropoffCache.get(owner);
    if (!list) {
      list = this.buildings.filter((b) => b.alive && b.built && b.owner === owner && b.def.dropoff);
      this.dropoffCache.set(owner, list);
    }
    return list;
  }

  nearestDropoff(owner: number, res: Res, x: number, z: number, navalOnly = false, exclude = 0): Building | null {
    let best: Building | null = null;
    let bd = Infinity;
    for (const b of this.dropoffsFor(owner)) {
      if (!b.alive || !b.built || !b.def.dropoff!.includes(res) || b.id === exclude) continue;
      if (navalOnly && !b.def.naval) continue;
      const d = distToRect(x, z, b.tx, b.tz, b.tx + b.w, b.tz + b.h);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  /** Find the nearest resource of a gather kind around a point, preferring less crowded ones. */
  /** `team` (if given): leave out resources that team has found no way to (see markUnreachable). */
  findResource(kind: GatherKind, x: number, z: number, maxR: number, excludeId = 0, waterBody = 0, team = -1): ResourceNode | null {
    let best: ResourceNode | null = null;
    let bs = Infinity;
    const m = this.map;
    if (kind === 'wood' || kind === 'gold' || kind === 'stone' || kind === 'forage') {
      // ring search on obstacle grid
      const cx = Math.floor(x), cz = Math.floor(z);
      for (let r = 0; r <= maxR; r++) {
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            const tx = cx + dx, tz = cz + dz;
            if (!m.inBounds(tx, tz)) continue;
            const id = m.obstacle[m.idx(tx, tz)];
            if (!id || id === excludeId) continue;
            const e = this.entities.get(id);
            if (!e || e.kind !== 'resource' || e.gather !== kind || e.amount <= 0) continue;
            if (!m.hasOpenNeighbor(tx, tz)) continue;
            if (team >= 0 && this.isUnreachable(id, team)) continue;
            const d = Math.hypot(e.x - x, e.z - z) + this.crowd(e) * (kind === 'forage' ? 2.5 : 1.2);
            if (d < bs) {
              bs = d;
              best = e;
            }
          }
        }
        if (best && r > bs + 1) break;
      }
      return best;
    }
    for (const r of this.resources) {
      if (!r.alive || r.gather !== kind || r.id === excludeId || r.amount <= 0) continue;
      if (waterBody && m.waterBody[m.idx(r.tx, r.tz)] !== waterBody) continue;
      const d = Math.hypot(r.x - x, r.z - z);
      if (d > maxR) continue;
      const s = d + this.crowd(r) * 1.5;
      if (s < bs) {
        bs = s;
        best = r;
      }
    }
    return best;
  }

  /** Villagers currently working a resource node (as of the last tick). */
  crowd(r: ResourceNode): number {
    if (r.gatherTick >= this.tickCount - 1) return Math.max(r.gatherers, r.gatherTick === this.tickCount ? r.gatherCount : 0);
    return 0;
  }

  msg(owner: number, text: string, kind: 'error' | 'info' = 'info'): void {
    this.events.push({ e: 'msg', owner, text, kind });
  }

  takePathBudget(): boolean {
    if (this.pathBudget <= 0 || this.pathNodes <= 0) return false;
    this.pathBudget--;
    return true;
  }

  spendPathNodes(n: number): void {
    this.pathNodes -= n;
  }

  /** How long a target stays marked as out of reach (s): things change (a wood is cut, a wall comes down). */
  static readonly UNREACHABLE_FOR = 60;

  markUnreachable(id: number, team: number): void {
    if (id) this.unreachable.set(id * 16 + (team & 15), this.time + Game.UNREACHABLE_FOR);
  }

  isUnreachable(id: number, team: number): boolean {
    if (!id) return false;
    const until = this.unreachable.get(id * 16 + (team & 15));
    if (until === undefined) return false;
    if (until > this.time) return true;
    this.unreachable.delete(id * 16 + (team & 15));
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* Simulation                                                           */
  /* ------------------------------------------------------------------ */

  /** Advance by real elapsed seconds scaled by game speed. Returns interpolation alpha. */
  /** Advances by dtSeconds of game time (at most maxSteps ticks, and at most budgetMs of real time if given). */
  update(dtSeconds: number, maxSteps = 8, budgetMs = Infinity): number {
    this.acc += dtSeconds;
    let steps = 0;
    const t0 = budgetMs < Infinity ? performance.now() : 0;
    while (this.acc >= TICK && steps < maxSteps) {
      this.step();
      this.acc -= TICK;
      steps++;
      if (budgetMs < Infinity && performance.now() - t0 > budgetMs) break;
    }
    if (this.acc > TICK * maxSteps) this.acc = TICK * maxSteps;
    return this.acc / TICK;
  }

  step(): void {
    const dt = TICK;
    this.time += dt;
    this.tickCount++;
    this.pathBudget = 24;
    this.pathNodes = 40000;

    for (const u of this.units) {
      u.px = u.x;
      u.pz = u.z;
      u.pfacing = u.facing;
    }
    this.spatial.rebuild(this.units);

    // Units
    const n = this.units.length;
    for (let i = 0; i < n; i++) {
      const u = this.units[i];
      if (!u.alive || u.garrisonedIn) continue;
      updateUnit(this, u, dt);
    }
    resolveCollisions(this);

    // Garrisoned units heal slowly
    if (this.tickCount % 20 === 0) {
      for (const b of this.buildings) {
        if (!b.alive || b.garrison.length === 0) continue;
        for (const id of b.garrison) {
          const u = this.unit(id);
          if (u && u.hp < u.stats.hp) u.hp = Math.min(u.stats.hp, u.hp + 1);
        }
      }
    }

    // Buildings
    for (let i = 0; i < this.buildings.length; i++) {
      const b = this.buildings[i];
      if (!b.alive) continue;
      updateBuilding(this, b, dt);
    }

    updateProjectiles(this);

    // Resources decay
    if (this.tickCount % 20 === 0) {
      for (const r of this.resources) {
        if (!r.alive || r.decay <= 0) continue;
        r.amount -= r.decay;
        if (r.amount <= 0) this.removeResource(r);
      }
    }

    if (this.tickCount % 4 === 0) this.vision.update(false);
    if (this.tickCount % 10 === 3) this.herdCheck();
    if (this.tickCount % 20 === 7) this.checkVictory();

    this.cleanup();
  }

  private cleanup(): void {
    if (this.deadUnits) {
      this.units = this.units.filter((u) => u.alive);
      this.deadUnits = false;
    }
    if (this.deadBuildings) {
      this.buildings = this.buildings.filter((b) => b.alive);
      this.deadBuildings = false;
    }
    if (this.deadResources) {
      this.resources = this.resources.filter((r) => r.alive);
      this.deadResources = false;
    }
  }

  /** Sheep switch owner to whoever has units near them. */
  private herdCheck(): void {
    for (const s of this.units) {
      if (!s.alive || !s.def.herdable || s.garrisonedIn) continue;
      let nearestOther: Unit | null = null;
      let nd = Infinity;
      let ownerNear = false;
      this.spatial.query(s.x, s.z, 4, (v, d2) => {
        if (v === s || v.def.animal || v.owner === 0) return;
        if (v.owner === s.owner) {
          if (d2 < 16) ownerNear = true;
          return;
        }
        if (d2 < 2.5 * 2.5 && d2 < nd) {
          nd = d2;
          nearestOther = v;
        }
      });
      // buildings (e.g. Town Center) also claim sheep
      if (!nearestOther && s.owner === 0) {
        for (const b of this.buildings) {
          if (!b.alive || b.owner === 0 || !b.built) continue;
          if (distToRect(s.x, s.z, b.tx, b.tz, b.tx + b.w, b.tz + b.h) < 3) {
            this.convertUnit(s, b.owner);
            break;
          }
        }
        continue;
      }
      if (nearestOther && (s.owner === 0 || !ownerNear)) this.convertUnit(s, (nearestOther as Unit).owner);
    }
  }

  private checkVictory(): void {
    if (this.over) return;
    for (const p of this.players) {
      if (p.isGaia || p.defeated) continue;
      let alive = false;
      for (const u of this.units) {
        if (u.alive && u.owner === p.id && !u.def.animal) {
          alive = true;
          break;
        }
      }
      if (!alive) {
        for (const b of this.buildings) {
          if (b.alive && b.owner === p.id && !b.def.wall && b.type !== 'farm') {
            alive = true;
            break;
          }
        }
      }
      if (!alive || p.resigned) this.defeatPlayer(p);
    }
    const teams = new Set<number>();
    for (const p of this.players) if (!p.isGaia && !p.defeated) teams.add(p.team);
    if (teams.size <= 1) {
      this.endGame(teams.size === 1 ? [...teams][0] : -1);
      return;
    }
    if (this.setup.victory !== 'conquest') this.checkRelics();
  }

  /** A team that keeps every relic in its temples for 600 seconds wins (standard victory). */
  private checkRelics(): void {
    const relics = this.resources.filter((r) => r.alive && r.type === 'relic');
    let team = -1;
    let all = relics.length > 0;
    for (const r of relics) {
      const b = r.heldBy ? this.building(r.heldBy) : undefined;
      if (!b || b.type !== 'monastery') {
        all = false;
        break;
      }
      const t = this.teamOf[b.owner];
      if (team === -1) team = t;
      else if (team !== t) {
        all = false;
        break;
      }
    }
    if (all) {
      if (this.relicTeam !== team) {
        this.relicTeam = team;
        this.relicTimer = 600;
        this.events.push({ e: 'relics', team, state: 'held' });
      } else {
        this.relicTimer -= 1;
        if (this.relicTimer <= 0) this.endGame(team);
      }
    } else if (this.relicTeam !== -1) {
      this.events.push({ e: 'relics', team: this.relicTeam, state: 'lost' });
      this.relicTeam = -1;
      this.relicTimer = -1;
    }
  }

  defeatPlayer(p: Player): void {
    if (p.defeated) return;
    p.defeated = true;
    this.events.push({ e: 'defeated', owner: p.id });
    // remaining units/buildings crumble
    for (const u of this.units) if (u.alive && u.owner === p.id && !u.def.animal) this.killUnit(u, 0);
    for (const b of this.buildings) if (b.alive && b.owner === p.id) this.destroyBuilding(b, 0);
  }

  endGame(team: number): void {
    if (this.over) return;
    this.over = true;
    this.winnerTeam = team;
    this.events.push({ e: 'gameover', winnerTeam: team });
  }

  /* ------------------------------------------------------------------ */
  /* Helpers for age and techs                                             */
  /* ------------------------------------------------------------------ */

  countBuildings(owner: number, type: string, builtOnly = true): number {
    let c = 0;
    for (const b of this.buildings) if (b.alive && b.owner === owner && b.type === type && (!builtOnly || b.built)) c++;
    return c;
  }

  /** Number of distinct qualifying building types for advancing to `age`. */
  ageRequirementCount(owner: number, age: AgeIndex): number {
    const types = new Set<string>();
    for (const b of this.buildings) {
      if (!b.alive || !b.built || b.owner !== owner) continue;
      if (b.def.ageReqFor === age) {
        if (b.type === 'castle') {
          types.add('castle');
          types.add('castle2');
        } else types.add(b.type);
      }
    }
    return types.size;
  }

  finishConstructionNow(b: Building): void {
    finishConstruction(this, b);
  }
}
