import { BUILDINGS } from '../data/buildings';
import { TECHS } from '../data/techs';
import { UNITS } from '../data/units';
import type { Cost, GatherKind, Res } from '../data/types';
import type { Building, ResourceNode, Unit } from '../sim/entities';
import type { Difficulty, Game } from '../sim/game';
import type { Player } from '../sim/player';
import { buildingAvailable, canPlace, currentBuildingType, issueCommand, unitAvailable, type Command } from '../sim/commands';
import { techAvailable } from '../sim/buildingAI';
import { isMilitary } from '../sim/unitAI';
import { RNG } from '../util/rng';

interface DiffCfg {
  maxVills: number;
  thinkEvery: number;
  firstAttack: number;
  armyMul: number;
  feudalVills: number;
  castleVills: number;
  imperialVills: number;
  /** Earliest game times (s) for going up to the Castle and Imperial ages. */
  castleAt: number;
  imperialAt: number;
  /** Rest (s) between attack waves. */
  waveGap: number;
  /** Pause (s) after each villager before the town centre starts the next one (0: never idle). */
  vilPause: number;
  cheat: number;
}

// Each level is roughly a notch below what it was: a smaller economy, slower reactions, later and smaller attacks,
// later ages (and only a light resource bonus on Hardest).
const DIFF: Record<Difficulty, DiffCfg> = {
  easy: { maxVills: 22, thinkEvery: 6, firstAttack: 1800, armyMul: 0.4, feudalVills: 12, castleVills: 18, imperialVills: 24,
    castleAt: 1100, imperialAt: 2300, waveGap: 300, vilPause: 22, cheat: 0 },
  standard: { maxVills: 45, thinkEvery: 3, firstAttack: 1080, armyMul: 0.7, feudalVills: 18, castleVills: 25, imperialVills: 34,
    castleAt: 900, imperialAt: 1850, waveGap: 220, vilPause: 9, cheat: 0 },
  hard: { maxVills: 65, thinkEvery: 2, firstAttack: 840, armyMul: 0.95, feudalVills: 21, castleVills: 28, imperialVills: 40,
    castleAt: 760, imperialAt: 1600, waveGap: 160, vilPause: 4, cheat: 0 },
  hardest: { maxVills: 85, thinkEvery: 1, firstAttack: 660, armyMul: 1.2, feudalVills: 22, castleVills: 30, imperialVills: 45,
    castleAt: 680, imperialAt: 1450, waveGap: 130, vilPause: 3, cheat: 0.15 },
};

const ECO_TECHS = ['loom', 'doubleBitAxe', 'horseCollar', 'wheelbarrow', 'goldMining', 'bowSaw', 'heavyPlow', 'handCart', 'goldShaftMining',
  'twoManSaw', 'cropRotation', 'stoneMining', 'townWatch', 'masonry', 'treadmillCrane', 'ballistics', 'stoneShaftMining', 'guardTowerUp', 'chemistry',
  'architecture', 'conscription', 'murderHoles', 'keepUp', 'siegeEngineers'];

type Ratio = Record<'food' | 'wood' | 'gold' | 'stone', number>;
const RATIOS: Ratio[] = [
  { food: 0.68, wood: 0.32, gold: 0, stone: 0 },
  { food: 0.48, wood: 0.32, gold: 0.16, stone: 0.04 },
  { food: 0.42, wood: 0.3, gold: 0.21, stone: 0.07 },
  { food: 0.38, wood: 0.3, gold: 0.27, stone: 0.05 },
];

export class AIPlayer {
  game: Game;
  pid: number;
  p: Player;
  cfg: DiffCfg;
  private n = 0;
  private baseX = 0;
  private baseZ = 0;
  private lastPlace = new Map<string, number>();
  private state: 'build' | 'attack' | 'retreat' = 'build';
  private attackStartSize = 0;
  private attackTargetId = 0;
  private waves = 0;
  private lastAttackEnd = -1000;
  private threatUntil = -1;
  private scoutLeg = 0;
  private enemySeen = { cavalry: 0, archer: 0, infantry: 0, siege: 0, spear: 0 };
  private lastRebalance = 0;
  private myUnits: Unit[] = [];
  private myBuildings: Building[] = [];
  private vills: Unit[] = [];
  private army: Unit[] = [];
  private rng: RNG;
  private nextVillAt = 0;

  constructor(game: Game, pid: number, difficulty: Difficulty) {
    this.rng = new RNG(game.setup.seed * 31 + pid * 977);
    this.game = game;
    this.pid = pid;
    this.p = game.players[pid];
    this.cfg = DIFF[difficulty] ?? DIFF.standard;
    const tc = game.buildings.find((b) => b.owner === pid && b.type === 'townCenter');
    if (tc) {
      this.baseX = tc.x;
      this.baseZ = tc.z;
    }
  }

  private cmd(c: Command): boolean {
    return issueCommand(this.game, this.pid, c).ok;
  }

  update(): void {
    this.n++;
    if (this.n % this.cfg.thinkEvery !== 0) return;
    const g = this.game;
    if (this.p.defeated) return;
    if (this.cfg.cheat) {
      const k = this.cfg.cheat * 0.5 * this.cfg.thinkEvery;
      this.p.res.food += k;
      this.p.res.wood += k;
      this.p.res.gold += k * 0.6;
    }
    this.myUnits = g.units.filter((u) => u.alive && u.owner === this.pid);
    this.myBuildings = g.buildings.filter((b) => b.alive && b.owner === this.pid);
    this.vills = this.myUnits.filter((u) => u.def.builder && !u.garrisonedIn);
    this.army = this.myUnits.filter((u) => !u.garrisonedIn && isMilitary(u) && !u.def.animal && !u.def.naval);
    const tc = this.myBuildings.find((b) => b.type === 'townCenter' && b.built);
    if (tc) {
      this.baseX = tc.x;
      this.baseZ = tc.z;
    }
    this.scanEnemies();
    this.defend();
    this.staffFoundations();
    this.trainVillagers();
    this.housing();
    this.herdSheep();
    this.assignVillagers();
    this.ageUp();
    this.construct();
    this.research();
    this.trainMilitary();
    this.monks();
    this.naval();
    this.scout();
    this.attack();
    this.marketTrade();
  }

  /* ---------------------------------------------------------------- helpers */

  private count(type: string, includeUnbuilt = true): number {
    let c = 0;
    for (const b of this.myBuildings) if (b.type === type && (includeUnbuilt || b.built)) c++;
    return c;
  }

  private affordWithReserve(cost: Cost, reserve: Partial<Record<Res, number>> = {}): boolean {
    for (const k of ['food', 'wood', 'gold', 'stone'] as Res[]) {
      if ((cost[k] ?? 0) > 0 && this.p.res[k] - (reserve[k] ?? 0) < (cost[k] ?? 0)) return false;
    }
    return true;
  }

  /** Resources we are saving for the next age. */
  private reserve(): Partial<Record<Res, number>> {
    const p = this.p;
    const nextAge = p.age < 3 ? ['feudalAge', 'castleAge', 'imperialAge'][p.age] : null;
    if (!nextAge || !this.wantsAgeUp()) return {};
    return TECHS[nextAge].cost;
  }

  private wantsAgeUp(): boolean {
    const p = this.p;
    const v = this.vills.length;
    if (p.age === 0) return v >= this.cfg.feudalVills;
    if (p.age === 1) return v >= this.cfg.castleVills && this.game.time > this.cfg.castleAt;
    if (p.age === 2) return v >= this.cfg.imperialVills && this.game.time > this.cfg.imperialAt;
    return false;
  }

  /** Spiral search for a valid building spot near (cx,cz). */
  private findSpot(type: string, cx: number, cz: number, minR: number, maxR: number, margin = 1): { tx: number; tz: number } | null {
    const g = this.game;
    const def = BUILDINGS[type];
    const w = def.size[0], h = def.size[1];
    const m = g.map;
    const best: { tx: number; tz: number; d: number }[] = [];
    for (let r = minR; r <= maxR; r++) {
      for (let k = 0; k < Math.max(8, r * 6); k++) {
        const a = (k / Math.max(8, r * 6)) * Math.PI * 2 + (this.pid * 0.7);
        const tx = Math.round(cx + Math.cos(a) * r - w / 2), tz = Math.round(cz + Math.sin(a) * r - h / 2);
        if (!canPlace(g, this.pid, type, tx, tz)) continue;
        // keep a margin free of other buildings so paths stay open
        let ok = true;
        if (margin > 0 && !def.walkable) {
          for (let z = tz - margin; z < tz + h + margin && ok; z++)
            for (let x = tx - margin; x < tx + w + margin; x++) {
              if (!m.inBounds(x, z)) continue;
              const id = m.obstacle[m.idx(x, z)];
              if (id) {
                const e = g.get(id);
                if (e && e.kind === 'building') {
                  ok = false;
                  break;
                }
              }
              if (m.farmAt[m.idx(x, z)] && type !== 'farm') {
                ok = false;
                break;
              }
            }
        }
        if (ok && !this.reachableFromBase(type, tx, tz)) ok = false;
        if (ok) best.push({ tx, tz, d: r });
        if (best.length >= 3) break;
      }
      if (best.length) break;
    }
    if (!best.length) return null;
    return best[Math.floor(this.rng.next() * Math.min(3, best.length))];
  }

  /** Can villagers walk from the Town Center to this footprint? */
  private reachableFromBase(type: string, tx: number, tz: number): boolean {
    const g = this.game;
    const def = BUILDINGS[type];
    const w = def.size[0], h = def.size[1];
    const pf = g.pathfinder.setDomain(false);
    const start = pf.nearestPassable(this.baseX, this.baseZ + 3, g.teamOf[this.pid], 6);
    if (!start) return true;
    const res = pf.findPath(start.x, start.z, { x0: tx, z0: tz, x1: tx + w, z1: tz + h, range: 0.5 }, g.teamOf[this.pid], 12000);
    return res.reached;
  }

  private place(type: string, spot: { tx: number; tz: number } | null, builders: number): boolean {
    if (!spot) return false;
    const g = this.game;
    const t = currentBuildingType(this.p, type);
    const cost = this.p.buildingCost(t);
    if (!this.p.canAfford(cost)) return false;
    // choose builders: nearest villagers, prefer non-food gatherers
    const cx = spot.tx + BUILDINGS[t].size[0] / 2, cz = spot.tz + BUILDINGS[t].size[1] / 2;
    const cands = this.vills
      .filter((u) => u.order.t !== 'build' && !(u.order.t === 'gather' && u.gatherKind === 'farm'))
      .sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz))
      .slice(0, builders);
    if (!cands.length) return false;
    const r = issueCommand(g, this.pid, { c: 'build', units: cands.map((u) => u.id), building: t, tx: spot.tx, tz: spot.tz });
    if (r.ok) this.lastPlace.set(type, g.time);
    return r.ok;
  }

  private placedRecently(type: string, secs: number): boolean {
    return this.game.time - (this.lastPlace.get(type) ?? -1000) < secs;
  }

  /* ---------------------------------------------------------------- economy */

  /** Unfinished buildings with nobody working on them get the nearest villager. */
  private staffFoundations(): void {
    const g = this.game;
    for (const b of this.myBuildings) {
      if (b.built || b.def.walkable) continue;
      const busy = this.vills.some((u) => (u.order.t === 'build' || u.order.t === 'repair') && u.order.target === b.id);
      if (busy) continue;
      if (this.dangerAt(b.x, b.z)) continue;
      const u = this.vills
        .filter((v) => v.order.t !== 'build' && !(v.order.t === 'gather' && v.gatherKind === 'farm'))
        .sort((a, c) => Math.hypot(a.x - b.x, a.z - b.z) - Math.hypot(c.x - b.x, c.z - b.z))[0];
      if (u) this.cmd({ c: 'repair', units: [u.id], target: b.id });
      void g;
    }
  }

  private trainVillagers(): void {
    const target = this.cfg.maxVills;
    if (this.vills.length + this.queuedVillagers() >= target) return;
    // stop at the age-up population and save food for the next age
    if (this.wantsAgeUp() && this.p.age < 3) {
      const tid = ['feudalAge', 'castleAge', 'imperialAge'][this.p.age];
      if (!this.p.researching.has(tid) && !this.p.canAfford(this.p.techCost(TECHS[tid]))) {
        const cap = [this.cfg.feudalVills, this.cfg.castleVills, this.cfg.imperialVills][this.p.age] + 2;
        if (this.vills.length >= cap) return;
      }
    }
    const pause = this.cfg.vilPause;
    if (pause > 0 && this.game.time < this.nextVillAt) return;
    for (const b of this.myBuildings) {
      if (b.type !== 'townCenter' || !b.built) continue;
      if (b.queue.some((q) => q.kind === 'tech' && TECHS[q.id]?.isAge)) continue;
      // a weaker AI lets its town centre stand idle between villagers
      if (b.queue.length >= (pause > 0 ? 1 : 2)) continue;
      if (this.p.pop >= this.p.popCap) continue;
      if (this.cmd({ c: 'train', building: b.id, unit: 'villager' }) && pause > 0) this.nextVillAt = this.game.time + 25 + pause;
    }
  }

  private queuedVillagers(): number {
    let n = 0;
    for (const b of this.myBuildings) for (const q of b.queue) if (q.id === 'villager') n++;
    return n;
  }

  private housing(): void {
    const p = this.p;
    if (p.popCap >= p.maxPop) return;
    const pending = this.myBuildings.filter((b) => b.type === 'house' && !b.built).length;
    const headroom = p.popCap - p.pop;
    const need = headroom <= (p.age >= 2 ? 8 : 4) ? (p.age >= 2 ? 2 : 1) : 0;
    if (pending >= need || need === 0) return;
    if (this.placedRecently('house', 6)) return;
    const spot = this.findSpot('house', this.baseX, this.baseZ, 6 + Math.floor(this.count('house') / 6) * 2, 22, 1);
    this.place('house', spot, 1);
  }

  private herdSheep(): void {
    const tcX = this.baseX, tcZ = this.baseZ;
    for (const u of this.myUnits) {
      if (!u.def.herdable || u.order.t !== 'idle') continue;
      if (Math.hypot(u.x - tcX, u.z - tcZ) > 6) {
        this.cmd({ c: 'move', units: [u.id], x: tcX + 2.5 + this.rng.next(), z: tcZ + 2.5 + this.rng.next() });
      }
    }
  }

  private gatherGroup(k: GatherKind | null): 'food' | 'wood' | 'gold' | 'stone' | null {
    if (!k) return null;
    if (k === 'wood' || k === 'gold' || k === 'stone') return k;
    return 'food';
  }

  private assignVillagers(): void {
    const g = this.game;
    const counts: Ratio = { food: 0, wood: 0, gold: 0, stone: 0 };
    const idle: Unit[] = [];
    for (const u of this.vills) {
      if (u.order.t === 'idle') idle.push(u);
      else if (u.order.t === 'gather') {
        const grp = this.gatherGroup(u.gatherKind);
        if (grp) counts[grp]++;
      }
    }
    const total = this.vills.length;
    const ratio = { ...RATIOS[this.p.age] };
    // stone for a castle in castle age
    if (this.p.age >= 2 && this.count('castle') === 0) {
      ratio.stone += 0.06;
      ratio.food -= 0.03;
      ratio.wood -= 0.03;
    }
    // adapt to stockpiles: move workers away from hoarded resources toward scarce ones
    let sum = 0;
    for (const k of ['food', 'wood', 'gold', 'stone'] as const) {
      if (ratio[k] <= 0) continue;
      const stock = this.p.res[k];
      const f = Math.max(0.35, Math.min(1.7, 1.45 - stock / (k === 'stone' ? 900 : 1400)));
      ratio[k] *= f;
      sum += ratio[k];
    }
    if (sum > 0) for (const k of ['food', 'wood', 'gold', 'stone'] as const) ratio[k] /= sum;
    const want = (k: keyof Ratio) => Math.round(total * ratio[k]);
    const deficit = (k: keyof Ratio) => want(k) - counts[k];
    const order: (keyof Ratio)[] = ['food', 'wood', 'gold', 'stone'];
    for (const u of idle) {
      order.sort((a, b) => deficit(b) - deficit(a));
      for (const k of order) {
        if (this.sendTo(u, k)) {
          counts[k]++;
          break;
        }
      }
    }
    // periodic rebalance
    if (g.time - this.lastRebalance > 15) {
      this.lastRebalance = g.time;
      const over = order.filter((k) => deficit(k) <= -3);
      const under = order.filter((k) => deficit(k) >= 2).sort((a, b) => deficit(b) - deficit(a));
      if (over.length && under.length) {
        const from = over[0];
        const movers = this.vills.filter((u) => u.order.t === 'gather' && this.gatherGroup(u.gatherKind) === from && !u.returning && u.gatherKind !== 'farm').slice(0, 2);
        for (const u of movers) this.sendTo(u, under[0]);
      }
    }
  }

  private nearestRes(kind: GatherKind, x: number, z: number, maxD: number, filter?: (r: ResourceNode) => boolean): ResourceNode | null {
    let best: ResourceNode | null = null;
    let bd = maxD;
    for (const r of this.game.resources) {
      if (!r.alive || r.gather !== kind || r.amount <= 0 || r.type === 'relic') continue;
      if (filter && !filter(r)) continue;
      const d = Math.hypot(r.x - x, r.z - z);
      if (d < bd) {
        bd = d;
        best = r;
      }
    }
    return best;
  }

  private dropoffNear(res: Res, x: number, z: number, maxD: number): Building | null {
    let best: Building | null = null;
    let bd = maxD;
    for (const b of this.myBuildings) {
      if (!b.def.dropoff?.includes(res)) continue;
      const d = Math.hypot(b.x - x, b.z - z) - Math.max(b.w, b.h) / 2;
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  private sendTo(u: Unit, k: 'food' | 'wood' | 'gold' | 'stone'): boolean {
    const g = this.game;
    const bx = this.baseX, bz = this.baseZ;
    if (k === 'food') {
      // sheep first
      const sheep = this.myUnits.filter((s) => s.def.herdable && s.alive).sort((a, b) => Math.hypot(a.x - bx, a.z - bz) - Math.hypot(b.x - bx, b.z - bz))[0];
      const carcass = this.nearestRes('herd', bx, bz, 12) ?? this.nearestRes('hunt', bx, bz, 12);
      if (carcass) return this.cmd({ c: 'gather', units: [u.id], target: carcass.id });
      if (sheep && Math.hypot(sheep.x - bx, sheep.z - bz) < 16) return this.cmd({ c: 'gather', units: [u.id], target: sheep.id });
      // berries (needs a mill)
      const berryAny = this.nearestRes('forage', bx, bz, 22);
      const foragers = this.vills.filter((v) => v.order.t === 'gather' && v.gatherKind === 'forage').length;
      const bushes = berryAny ? g.resources.filter((r) => r.alive && r.gather === 'forage' && Math.hypot(r.x - berryAny.x, r.z - berryAny.z) < 6).length : 0;
      const berry = berryAny && foragers < bushes * 1.4 + 1 ? (g.findResource('forage', berryAny.x, berryAny.z, 6) ?? berryAny) : null;
      if (berry) {
        if (this.dropoffNear('food', berry.x, berry.z, 5)) return this.cmd({ c: 'gather', units: [u.id], target: berry.id });
        if (!this.placedRecently('mill', 25) && this.p.canAfford(this.p.buildingCost('mill'))) {
          const spot = this.findSpot('mill', berry.x, berry.z, 2, 5, 0);
          if (spot && this.cmd({ c: 'build', units: [u.id], building: 'mill', tx: spot.tx, tz: spot.tz })) {
            this.lastPlace.set('mill', g.time);
            return true;
          }
        }
      }
      // deer / boar near a food drop-off
      if (this.p.age <= 1) {
        const hunters = this.vills.filter((v) => v.order.t === 'gather' && v.gatherKind === 'hunt').length;
        const prey = g.units.filter((d) => d.alive && (d.def.animal === 'deer' || (d.def.animal === 'boar' && hunters >= 3)) && Math.hypot(d.x - bx, d.z - bz) < 20)
          .sort((a, b) => Math.hypot(a.x - bx, a.z - bz) - Math.hypot(b.x - bx, b.z - bz))[0];
        if (prey) {
          if (prey.def.animal === 'boar') {
            const group = this.vills.filter((v) => v.order.t === 'gather' && v.gatherKind === 'hunt').slice(0, 4).map((v) => v.id);
            return this.cmd({ c: 'gather', units: [u.id, ...group], target: prey.id });
          }
          return this.cmd({ c: 'gather', units: [u.id], target: prey.id });
        }
      }
      // farms
      const free = this.myBuildings.find((b) => b.def.foodCapacity && b.built && (!b.farmer || !g.unit(b.farmer)?.alive || (g.unit(b.farmer)!.order.t !== 'gather')));
      if (free) return this.cmd({ c: 'gather', units: [u.id], target: free.id });
      const unbuiltFarm = this.myBuildings.find((b) => b.def.foodCapacity && !b.built && b.builders === 0 && b.buildersPrev === 0);
      if (unbuiltFarm) return this.cmd({ c: 'gather', units: [u.id], target: unbuiltFarm.id });
      if (this.p.res.wood >= 60 && buildingAvailable(g, this.p, 'farm').ok) {
        const spot = this.farmSpot();
        if (spot) return this.cmd({ c: 'build', units: [u.id], building: 'farm', tx: spot.tx, tz: spot.tz });
        // no room left around existing mills: open new farmland with another mill
        if (!this.placedRecently('mill', 60) && this.p.res.wood >= 160 && this.count('mill') < 4) {
          const ms = this.findSpot('mill', this.baseX, this.baseZ, 10, 24, 4);
          if (ms && this.cmd({ c: 'build', units: [u.id], building: 'mill', tx: ms.tx, tz: ms.tz })) {
            this.lastPlace.set('mill', g.time);
            return true;
          }
        }
      }
      if (!this.count('mill') && this.p.canAfford(this.p.buildingCost('mill')) && !this.placedRecently('mill', 25)) {
        const spot = this.findSpot('mill', bx, bz, 5, 10, 1);
        if (spot && this.cmd({ c: 'build', units: [u.id], building: 'mill', tx: spot.tx, tz: spot.tz })) {
          this.lastPlace.set('mill', g.time);
          return true;
        }
      }
      return false;
    }
    if (k === 'wood') {
      const camp = this.myBuildings.filter((b) => b.type === 'lumberCamp' || b.type === 'townCenter');
      let bestTree: ResourceNode | null = null;
      let bd = Infinity;
      for (const c of camp) {
        const t = g.findResource('wood', c.x, c.z, c.type === 'townCenter' ? 7 : 9);
        if (t) {
          const d = Math.hypot(t.x - c.x, t.z - c.z);
          if (d < bd) {
            bd = d;
            bestTree = t;
          }
        }
      }
      if (bestTree && bd < 8) return this.cmd({ c: 'gather', units: [u.id], target: bestTree.id });
      // need a new lumber camp near a forest
      if (!this.placedRecently('lumberCamp', 30) && this.p.canAfford(this.p.buildingCost('lumberCamp'))) {
        const forest = this.bestForest();
        if (forest) {
          const spot = this.findSpot('lumberCamp', forest.x, forest.z, 1, 5, 0);
          if (spot && this.cmd({ c: 'build', units: [u.id], building: 'lumberCamp', tx: spot.tx, tz: spot.tz })) {
            this.lastPlace.set('lumberCamp', g.time);
            return true;
          }
        }
      }
      if (bestTree) return this.cmd({ c: 'gather', units: [u.id], target: bestTree.id });
      const any = g.findResource('wood', u.x, u.z, 45) ?? g.findResource('wood', bx, bz, 60);
      return any ? this.cmd({ c: 'gather', units: [u.id], target: any.id }) : false;
    }
    // gold / stone
    const kind: GatherKind = k;
    if (this.p.age === 0 && k === 'stone') return false;
    const mine = this.nearestRes(kind, bx, bz, 40, (r) => !this.dangerAt(r.x, r.z));
    if (!mine) return false;
    if (this.dropoffNear(k, mine.x, mine.z, 4)) return this.cmd({ c: 'gather', units: [u.id], target: mine.id });
    if (!this.placedRecently('miningCamp', 25) && this.p.canAfford(this.p.buildingCost('miningCamp'))) {
      const spot = this.findSpot('miningCamp', mine.x, mine.z, 2, 4, 0);
      if (spot && this.cmd({ c: 'build', units: [u.id], building: 'miningCamp', tx: spot.tx, tz: spot.tz })) {
        this.lastPlace.set('miningCamp', g.time);
        return true;
      }
    }
    if (this.dropoffNear(k, mine.x, mine.z, 10)) return this.cmd({ c: 'gather', units: [u.id], target: mine.id });
    return false;
  }

  private dangerAt(x: number, z: number): boolean {
    let danger = false;
    this.game.spatial.query(x, z, 7, (v) => {
      if (!danger && this.game.isEnemy(this.pid, v.owner) && isMilitary(v)) danger = true;
    });
    return danger;
  }

  private bestForest(): { x: number; z: number } | null {
    const g = this.game;
    let best: { x: number; z: number } | null = null;
    let bs = -Infinity;
    for (const r of g.resources) {
      if (!r.alive || r.type !== 'tree') continue;
      const d = Math.hypot(r.x - this.baseX, r.z - this.baseZ);
      if (d > 48 || d < 5) continue;
      if (this.rng.next() < 0.6) continue;
      // density
      let dens = 0;
      for (let dz = -3; dz <= 3; dz++)
        for (let dx = -3; dx <= 3; dx++) {
          const id = g.map.inBounds(r.tx + dx, r.tz + dz) ? g.map.obstacle[g.map.idx(r.tx + dx, r.tz + dz)] : 0;
          const e = id ? g.get(id) : undefined;
          if (e && e.kind === 'resource' && e.type === 'tree') dens++;
        }
      // avoid forests already served by a camp
      if (this.dropoffNear('wood', r.x, r.z, 7)) continue;
      const s = dens - d * 0.6;
      if (s > bs) {
        bs = s;
        best = { x: r.x, z: r.z };
      }
    }
    return best;
  }

  private farmSpot(): { tx: number; tz: number } | null {
    const g = this.game;
    const anchors = this.myBuildings.filter((b) => b.built && (b.type === 'townCenter' || b.type === 'mill'));
    let best: { tx: number; tz: number } | null = null;
    let bd = Infinity;
    for (const a of anchors) {
      for (let dz = -9; dz <= 9; dz++)
        for (let dx = -9; dx <= 9; dx++) {
          const tx = a.tx + dx, tz = a.tz + dz;
          // align to a 3-grid relative to the anchor so farms tile neatly
          if (((dx % 3) + 3) % 3 !== (a.type === 'townCenter' ? 2 : 1) || ((dz % 3) + 3) % 3 !== (a.type === 'townCenter' ? 2 : 1)) continue;
          const cx = tx + 1.5, cz = tz + 1.5;
          const d = Math.hypot(cx - a.x, cz - a.z);
          if (d >= bd || d > 9) continue;
          if (!canPlace(g, this.pid, 'farm', tx, tz)) continue;
          bd = d;
          best = { tx, tz };
        }
    }
    return best;
  }

  /* ---------------------------------------------------------------- age & construction */

  private ageUp(): void {
    const p = this.p;
    if (p.age >= 3 || !this.wantsAgeUp()) return;
    const tid = ['feudalAge', 'castleAge', 'imperialAge'][p.age];
    if (p.researching.has(tid)) return;
    const av = techAvailable(this.game, p, tid);
    if (!av.ok) return;
    const tc = this.myBuildings.filter((b) => b.type === 'townCenter' && b.built).sort((a, b) => a.queue.length - b.queue.length)[0];
    if (!tc) return;
    if (!p.canAfford(p.techCost(TECHS[tid]))) return;
    // clear queued villagers (keep the one in progress) so the age starts right after
    for (let i = tc.queue.length - 1; i >= 1; i--) if (tc.queue[i].kind === 'unit') this.cmd({ c: 'cancel', building: tc.id, index: i });
    this.cmd({ c: 'research', building: tc.id, tech: tid });
  }

  private construct(): void {
    const g = this.game;
    const p = this.p;
    const v = this.vills.length;
    const res = this.reserve();
    const want = (type: string, n: number, minVills: number, near?: { x: number; z: number }, r0 = 8, r1 = 22): boolean => {
      if (this.count(type) >= n || v < minVills) return false;
      if (!buildingAvailable(g, p, type).ok) return false;
      if (this.placedRecently(type, 20)) return false;
      if (!this.affordWithReserve(p.buildingCost(type), res)) return false;
      const c = near ?? { x: this.baseX, z: this.baseZ };
      return this.place(type, this.findSpot(type, c.x, c.z, r0, r1, 1), type === 'castle' ? 4 : 2);
    };
    // Dark Age build order: lumber camp and mill early
    if (this.count('lumberCamp') === 0 && v >= 6 && !this.placedRecently('lumberCamp', 20) && p.canAfford(p.buildingCost('lumberCamp'))) {
      const forest = this.bestForest();
      if (forest) this.place('lumberCamp', this.findSpot('lumberCamp', forest.x, forest.z, 1, 6, 0), 2);
    }
    if (this.count('mill') === 0 && v >= 9 && !this.placedRecently('mill', 20) && p.canAfford(p.buildingCost('mill'))) {
      const berry = this.nearestRes('forage', this.baseX, this.baseZ, 24);
      const spot = berry ? this.findSpot('mill', berry.x, berry.z, 2, 5, 0) : this.findSpot('mill', this.baseX, this.baseZ, 7, 12, 1);
      this.place('mill', spot, 1);
    }
    if (p.age >= 1 && this.count('miningCamp') === 0 && !this.placedRecently('miningCamp', 20) && p.canAfford(p.buildingCost('miningCamp'))) {
      const mine = this.nearestRes('gold', this.baseX, this.baseZ, 30);
      if (mine) this.place('miningCamp', this.findSpot('miningCamp', mine.x, mine.z, 2, 4, 0), 1);
    }
    const fav = p.civ.ai.favored;
    const needRange = fav.includes('archer') || fav.includes('cavArcher') || fav.includes('skirmisher');
    const needStable = fav.includes('knight') || fav.includes('camel') || fav.includes('scout');
    // Dark age
    want('barracks', 1, 14);
    // Feudal
    if (p.age >= 1) {
      want('blacksmith', 1, 20);
      if (needRange) want('archeryRange', 1, 18);
      if (needStable) want('stable', 1, 20);
      if (!needRange && !needStable) want('archeryRange', 1, 20);
      want('market', 1, 24);
    }
    // Castle
    if (p.age >= 2) {
      want('university', 1, 28);
      want('siegeWorkshop', 1, 30);
      want('monastery', 1, 32);
      want('castle', 1, 30, undefined, 6, 18);
      if (needRange) want('archeryRange', 2, 35);
      if (needStable) want('stable', 2, 35);
      want('barracks', 2, 40);
      if (this.cfg.maxVills >= 55) want('townCenter', 2, 34, undefined, 16, 30);
      if (this.count('watchTower') + this.count('guardTower') + this.count('keep') < 2) want('watchTower', 2, 30, undefined, 10, 18);
    }
    if (p.age >= 3) {
      if (needRange) want('archeryRange', 3, 50);
      if (needStable) want('stable', 3, 50);
      want('siegeWorkshop', 2, 50);
      if (this.cfg.maxVills >= 75) want('castle', 2, 60, undefined, 8, 20);
    }
  }

  private research(): void {
    const g = this.game;
    const p = this.p;
    const res = this.reserve();
    const tryTech = (tid: string): boolean => {
      const t = TECHS[p.resolveTechId(tid)];
      if (!t) return false;
      const av = techAvailable(g, p, t.id);
      if (!av.ok) return false;
      const cost = p.techCost(t);
      if (!this.affordWithReserve(cost, res)) return false;
      const b = this.myBuildings.find((x) => x.built && x.type === t.building && x.queue.length === 0);
      if (!b) return false;
      return this.cmd({ c: 'research', building: b.id, tech: t.id });
    };
    // loom when threatened or before feudal
    if (p.age === 0 && this.vills.length >= 18) tryTech('loom');
    for (const t of ECO_TECHS) {
      if (TECHS[t]?.age > p.age) continue;
      if (tryTech(t)) break;
    }
    // military upgrades for our lines
    const lines = this.militaryLines();
    const ups: string[] = [];
    for (const line of lines) {
      for (const t of Object.values(TECHS)) {
        for (const e of t.effects) {
          if (e.kind === 'upgrade' && (UNITS[e.from]?.lineOf ?? e.from) === line) ups.push(t.id);
        }
      }
    }
    const bs = ['forging', 'ironCasting', 'blastFurnace', 'scaleMail', 'chainMail', 'plateMail', 'scaleBarding', 'chainBarding', 'plateBarding',
      'fletching', 'bodkinArrow', 'bracer', 'paddedArcherArmor', 'leatherArcherArmor', 'ringArcherArmor', 'bloodlines', 'husbandry', 'thumbRing', 'squires',
      'elite_' + p.civ.uniqueUnit, p.civ.uniqueTechs[0], p.civ.uniqueTechs[1], 'hoardings', 'sanctity', 'fervor', 'redemption'];
    if (this.army.length >= 4 || p.age >= 2) {
      for (const t of [...ups, ...bs]) if (tryTech(t)) break;
    }
  }

  /* ---------------------------------------------------------------- military */

  private militaryLines(): string[] {
    const p = this.p;
    const fav = p.civ.ai.favored.map((l) => (l === 'uniqueUnit' ? p.civ.uniqueUnit : l));
    const lines = [...fav];
    // counters
    const e = this.enemySeen;
    if (e.cavalry > e.archer && e.cavalry > 3) lines.unshift('spearman');
    if (e.archer > 4) lines.unshift('skirmisher');
    if (p.age >= 2 && !lines.includes('ram')) lines.push('ram');
    if (p.age >= 2 && fav.includes('mangonel')) lines.push('mangonel');
    if (p.age >= 3) lines.push('trebuchet');
    return [...new Set(lines)];
  }

  private scanEnemies(): void {
    if (this.n % 20 !== 0) return;
    const g = this.game;
    const s = { cavalry: 0, archer: 0, infantry: 0, siege: 0, spear: 0 };
    for (const u of g.units) {
      if (!u.alive || !g.isEnemy(this.pid, u.owner) || !isMilitary(u)) continue;
      const c = u.def.classes;
      if (c.includes('archer')) s.archer++;
      else if (c.includes('cavalry')) s.cavalry++;
      else if (c.includes('spear')) s.spear++;
      else if (c.includes('infantry')) s.infantry++;
      else if (c.includes('siege')) s.siege++;
    }
    this.enemySeen = s;
  }

  private trainMilitary(): void {
    const g = this.game;
    const p = this.p;
    if (p.age === 0 && g.time < 400) return;
    const res = this.reserve();
    const lines = this.militaryLines();
    const maxMil = Math.round((p.age + 1) * 12 * this.cfg.armyMul) + 6;
    if (this.army.length >= maxMil || p.pop >= p.popCap) return;
    for (const b of this.myBuildings) {
      if (!b.built || !b.def.trains || b.type === 'townCenter' || b.type === 'market' || b.type === 'monastery' || b.type === 'dock') continue;
      if (b.queue.length >= 2) continue;
      const options = (b.def.trains).map((l) => (l === 'uniqueUnit' ? p.civ.uniqueUnit : l)).filter((l) => lines.includes(l) && unitAvailable(g, p, p.currentOf(l)).ok);
      if (!options.length) {
        // train anything useful rather than idling
        const any = (b.def.trains).map((l) => (l === 'uniqueUnit' ? p.civ.uniqueUnit : l)).filter((l) => unitAvailable(g, p, p.currentOf(l)).ok && l !== 'trebuchet' && l !== 'scout');
        if (any.length) options.push(any[0]);
      }
      if (!options.length) continue;
      // rams only a few
      const pick = options[(this.n + b.id) % options.length];
      if (pick === 'ram' && this.myUnits.filter((u) => u.def.classes.includes('ram')).length >= 3) continue;
      if (pick === 'trebuchet' && this.myUnits.filter((u) => u.def.packs).length >= 2) continue;
      const cost = p.unitCost(p.currentOf(pick));
      if (!this.affordWithReserve(cost, { ...res, food: (res.food ?? 0) + 50 })) continue;
      this.cmd({ c: 'train', building: b.id, unit: pick });
    }
  }

  private monks(): void {
    const g = this.game;
    const p = this.p;
    const mon = this.myBuildings.find((b) => b.type === 'monastery' && b.built);
    if (!mon) return;
    const monks = this.myUnits.filter((u) => u.def.monk && !u.garrisonedIn);
    if (monks.length < 3 && mon.queue.length === 0 && this.affordWithReserve(p.unitCost('monk'), this.reserve())) this.cmd({ c: 'train', building: mon.id, unit: 'monk' });
    for (const m of monks) {
      if (m.relicId && m.order.t === 'idle') {
        this.cmd({ c: 'garrison', units: [m.id], target: mon.id });
        continue;
      }
      if (m.order.t !== 'idle') continue;
      const relic = g.resources.filter((r) => r.alive && r.type === 'relic' && !r.heldBy).sort((a, b) => Math.hypot(a.x - m.x, a.z - m.z) - Math.hypot(b.x - m.x, b.z - m.z))[0];
      if (relic && !this.dangerAt(relic.x, relic.z)) this.cmd({ c: 'relic', units: [m.id], target: relic.id });
    }
  }

  private scout(): void {
    const g = this.game;
    const scout = this.myUnits.find((u) => u.type === 'scout' && !u.garrisonedIn);
    if (!scout || this.state === 'attack' || g.time > 600) return;
    if (scout.order.t !== 'idle') return;
    const radii = [11, 17, 24, 30];
    const leg = this.scoutLeg++;
    const r = radii[Math.floor(leg / 6) % radii.length];
    const a = (leg % 6) / 6 * Math.PI * 2 + this.pid;
    const n = g.map.n;
    const x = Math.max(3, Math.min(n - 3, this.baseX + Math.cos(a) * r)), z = Math.max(3, Math.min(n - 3, this.baseZ + Math.sin(a) * r));
    this.cmd({ c: 'move', units: [scout.id], x, z });
  }

  private defend(): void {
    const g = this.game;
    let threat: Unit | null = null;
    let threatCount = 0;
    const anchors = this.myBuildings.filter((b) => b.type === 'townCenter' || b.type === 'castle' || b.def.dropoff);
    for (const a of anchors.length ? anchors : this.myBuildings.slice(0, 3)) {
      g.spatial.query(a.x, a.z, a.type === 'townCenter' ? 18 : 10, (v) => {
        if (!v.alive || !g.isEnemy(this.pid, v.owner) || v.def.animal) return;
        if (!isMilitary(v) && !v.def.monk) return;
        threatCount++;
        if (!threat) threat = v;
      });
    }
    if (!threat) {
      for (const u of this.vills) {
        if (u.lastAttackedAt > g.time - 3 && u.lastAttackerId) {
          const t = g.unit(u.lastAttackerId);
          if (t && t.alive && g.isEnemy(this.pid, t.owner)) {
            threat = t;
            threatCount = Math.max(threatCount, 2);
            break;
          }
        }
      }
    }
    const home = this.army.filter((u) => this.state !== 'attack' || !this.attackGroup.has(u.id));
    if (threat) {
      const t = threat as Unit;
      this.threatUntil = g.time + 10;
      const responders = home.filter((u) => u.order.t === 'idle' || (u.order.t === 'move' && !u.order.attackMove) || u.order.t === 'patrol');
      if (responders.length) this.cmd({ c: 'move', units: responders.map((u) => u.id), x: t.x, z: t.z, attackMove: true });
      // villagers close to enemy soldiers take cover
      if (home.length < threatCount + 2) {
        for (const v of this.vills) {
          if (v.order.t === 'garrison') continue;
          let near = false;
          g.spatial.query(v.x, v.z, 6, (e) => {
            if (!near && e.alive && g.isEnemy(this.pid, e.owner) && isMilitary(e)) near = true;
          });
          if (!near) continue;
          const shelter = this.myBuildings.filter((b) => b.built && b.def.garrison && b.type !== 'monastery' && b.garrison.length < (b.def.garrison ?? 0))
            .sort((a, b) => Math.hypot(a.x - v.x, a.z - v.z) - Math.hypot(b.x - v.x, b.z - v.z))[0];
          if (shelter && Math.hypot(shelter.x - v.x, shelter.z - v.z) < 16) {
            v.prevOrder = v.order.t === 'gather' ? v.order : v.prevOrder;
            this.cmd({ c: 'garrison', units: [v.id], target: shelter.id });
          }
        }
        this.emergencyTroops();
      }
      if (this.state === 'attack' && threatCount >= 6 && home.length < 3) this.state = 'retreat';
    }
    // release sheltered villagers from buildings with no enemies nearby
    for (const b of this.myBuildings) {
      if (!b.garrison.length) continue;
      let danger = false;
      g.spatial.query(b.x, b.z, 9, (e) => {
        if (!danger && e.alive && g.isEnemy(this.pid, e.owner) && isMilitary(e)) danger = true;
      });
      if (danger) {
        this.lastDanger.set(b.id, g.time);
        continue;
      }
      if (g.time - (this.lastDanger.get(b.id) ?? -100) < 8) continue;
      for (const id of [...b.garrison]) {
        const u = g.unit(id);
        if (u && u.def.gatherer) this.cmd({ c: 'ungarrison', building: b.id, unit: id });
      }
    }
  }

  private lastDanger = new Map<number, number>();

  /** Cheap defenders regardless of saving plans. */
  private emergencyTroops(): void {
    const g = this.game;
    const p = this.p;
    if (p.pop >= p.popCap) return;
    for (const b of this.myBuildings) {
      if (!b.built || b.queue.length >= 2) continue;
      let unit: string | null = null;
      if (b.type === 'barracks') unit = unitAvailable(g, p, p.currentOf('spearman')).ok ? 'spearman' : 'militia';
      else if (b.type === 'archeryRange') unit = 'skirmisher';
      else if (b.type === 'castle') unit = p.civ.uniqueUnit;
      if (!unit || !unitAvailable(g, p, p.currentOf(unit)).ok) continue;
      if (p.canAfford(p.unitCost(p.currentOf(unit)))) this.cmd({ c: 'train', building: b.id, unit });
    }
  }

  private attackGroup = new Set<number>();

  private attack(): void {
    const g = this.game;
    const p = this.p;
    if (this.state === 'build') {
      if (g.time < this.cfg.firstAttack || p.age === 0) return;
      if (g.time - this.lastAttackEnd < this.cfg.waveGap) return;
      if (g.time < this.threatUntil) return;
      const threshold = Math.round((p.age === 1 ? 7 : p.age === 2 ? 14 : 22) * this.cfg.armyMul + this.waves * 2);
      const ready = this.army.filter((u) => u.type !== 'scout' || p.age >= 2);
      if (ready.length < threshold) {
        // gather idle army near base toward the enemy
        const idle = ready.filter((u) => u.order.t === 'idle' && Math.hypot(u.x - this.baseX, u.z - this.baseZ) > 14);
        if (idle.length) this.cmd({ c: 'move', units: idle.map((u) => u.id), x: this.baseX + 4, z: this.baseZ + 4 });
        return;
      }
      const target = this.pickTarget();
      if (!target) return;
      this.state = 'attack';
      this.waves++;
      this.attackGroup = new Set(ready.map((u) => u.id));
      this.attackStartSize = ready.length;
      this.attackTargetId = target.id;
      this.sendArmy(ready, target);
      return;
    }
    const group = this.army.filter((u) => this.attackGroup.has(u.id));
    if (this.state === 'retreat' || group.length < Math.max(2, this.attackStartSize * 0.3)) {
      if (group.length) this.cmd({ c: 'move', units: group.map((u) => u.id), x: this.baseX + 3, z: this.baseZ + 3 });
      this.state = 'build';
      this.lastAttackEnd = g.time;
      this.attackGroup.clear();
      return;
    }
    // keep pushing
    let target = g.building(this.attackTargetId);
    if (!target || !target.alive) {
      const nt = this.pickTarget(group[0]);
      if (!nt) {
        this.state = 'build';
        this.lastAttackEnd = g.time;
        return;
      }
      target = nt;
      this.attackTargetId = nt.id;
      this.sendArmy(group, nt);
      return;
    }
    const idle = group.filter((u) => u.order.t === 'idle');
    if (idle.length) this.sendArmy(idle, target);
    // new reinforcements join
    const fresh = this.army.filter((u) => !this.attackGroup.has(u.id) && u.order.t === 'idle' && u.type !== 'scout');
    if (fresh.length >= 5) {
      for (const u of fresh) this.attackGroup.add(u.id);
      this.sendArmy(fresh, target);
    }
  }

  private sendArmy(units: Unit[], target: Building): void {
    const siege = units.filter((u) => u.def.classes.includes('siege'));
    const rest = units.filter((u) => !u.def.classes.includes('siege'));
    if (rest.length) this.cmd({ c: 'move', units: rest.map((u) => u.id), x: target.x, z: target.z, attackMove: true });
    if (siege.length) this.cmd({ c: 'attack', units: siege.map((u) => u.id), target: target.id });
  }

  private pickTarget(from?: Unit): Building | null {
    const g = this.game;
    const fx = from?.x ?? this.baseX, fz = from?.z ?? this.baseZ;
    let best: Building | null = null;
    let bs = Infinity;
    for (const b of g.buildings) {
      if (!b.alive || !g.isEnemy(this.pid, b.owner) || b.def.wall) continue;
      let s = Math.hypot(b.x - fx, b.z - fz);
      if (b.type === 'townCenter') s -= 15;
      if (b.def.attack) s += 5;
      if (b.type === 'farm') s += 10;
      if (s < bs) {
        bs = s;
        best = b;
      }
    }
    return best;
  }

  /** Docks, fishing boats and a small war fleet when the enemy takes to the water. */
  private naval(): void {
    const g = this.game;
    const p = this.p;
    if (this.n % 4 !== 0) return;
    const fish = this.nearestRes('fish', this.baseX, this.baseZ, 30);
    const docks = this.myBuildings.filter((b) => b.type === 'dock');
    if (!docks.length) {
      if (!fish || this.vills.length < 11 || this.placedRecently('dock', 45)) return;
      if (!this.affordWithReserve(p.buildingCost('dock'), this.reserve())) return;
      const spot = this.findSpot('dock', fish.x, fish.z, 1, 9, 0);
      this.place('dock', spot, 2);
      return;
    }
    const dock = docks.find((d) => d.built);
    if (!dock) return;
    const boats = this.myUnits.filter((u) => u.def.fisher && !u.garrisonedIn);
    const dockBody = g.map.bodyAt(dock.x, dock.z);
    const fishLeft = g.resources.filter((r) => r.alive && r.gather === 'fish' && g.map.waterBody[g.map.idx(r.tx, r.tz)] === dockBody && Math.hypot(r.x - dock.x, r.z - dock.z) < 40).length;
    const want = Math.min(fishLeft * 2, p.age === 0 ? 4 : p.age === 1 ? 7 : 10);
    if (boats.length < want && dock.queue.length < 2 && p.pop < p.popCap && this.affordWithReserve(p.unitCost('fishingShip'), this.reserve())) {
      this.cmd({ c: 'train', building: dock.id, unit: 'fishingShip' });
    }
    for (const b of boats) {
      if (b.order.t !== 'idle') continue;
      const f = g.findResource('fish', b.x, b.z, 45, 0, g.map.bodyAt(b.x, b.z));
      if (f) this.cmd({ c: 'gather', units: [b.id], target: f.id });
      else this.cmd({ c: 'delete', ids: [b.id] });
    }
    // war fleet in response to enemy ships
    const enemyShips = g.units.filter((u) => u.alive && u.def.naval && g.isEnemy(this.pid, u.owner) && !u.def.fisher);
    const fleet = this.myUnits.filter((u) => u.def.naval && isMilitary(u) && !u.garrisonedIn);
    if (p.age >= 1 && fleet.length < Math.min(10, enemyShips.length + 2) && enemyShips.length > 0 && dock.queue.length < 2) {
      const unit = p.currentOf('galley');
      if (unitAvailable(g, p, unit).ok && this.affordWithReserve(p.unitCost(unit), this.reserve())) this.cmd({ c: 'train', building: dock.id, unit: 'galley' });
    }
    const idleFleet = fleet.filter((u) => u.order.t === 'idle');
    if (idleFleet.length && enemyShips.length) {
      const t = enemyShips.sort((a, b) => Math.hypot(a.x - dock.x, a.z - dock.z) - Math.hypot(b.x - dock.x, b.z - dock.z))[0];
      this.cmd({ c: 'move', units: idleFleet.map((u) => u.id), x: t.x, z: t.z, attackMove: true });
    }
  }

  private marketTrade(): void {
    if (this.n % 30 !== 0) return;
    if (!this.count('market', false)) return;
    const p = this.p;
    if (p.res.gold < 150) {
      if (p.res.food > 1200) this.cmd({ c: 'market', action: 'sell', res: 'food' });
      else if (p.res.wood > 1200) this.cmd({ c: 'market', action: 'sell', res: 'wood' });
      else if (p.res.stone > 900) this.cmd({ c: 'market', action: 'sell', res: 'stone' });
    }
  }
}
