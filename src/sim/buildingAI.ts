import { BUILDINGS } from '../data/buildings';
import { TECHS } from '../data/techs';
import { UNITS } from '../data/units';
import { AGE_NAMES } from '../data/types';
import { clamp } from '../util/math';
import { launchProjectile } from './combat';
import type { Building, Unit } from './entities';
import type { Game } from './game';
import type { Player } from './player';
import { resetNav } from './unitAI';

export function finishConstruction(game: Game, b: Building): void {
  if (b.built) return;
  b.built = true;
  b.progress = 1;
  b.hp = Math.min(b.stats.hp, Math.max(b.hp, b.stats.hp * 0.98));
  if (b.def.gate) {
    for (let z = b.tz; z < b.tz + b.h; z++) for (let x = b.tx; x < b.tx + b.w; x++) game.map.gateOwner[game.map.idx(x, z)] = b.owner;
    game.map.version++;
  }
  if (b.def.foodCapacity) b.food = b.def.foodCapacity + game.players[b.owner].farmFood;
  game.buildingsVersion++;
  game.recomputePop(b.owner);
  game.invalidateDropoffs(b.owner);
  game.events.push({ e: 'bcomplete', id: b.id, type: b.type, owner: b.owner });
  if (b.type === 'wonder') {
    b.wonderTimer = 600;
    game.events.push({ e: 'wonder', owner: b.owner, state: 'built' });
  }
}

export function updateBuilding(game: Game, b: Building, dt: number): void {
  b.buildersPrev = b.builders;
  b.builders = 0;
  if (!b.built) return;
  const p = game.players[b.owner];

  if (b.type === 'wonder' && b.wonderTimer > 0 && game.setup.victory !== 'conquest') {
    b.wonderTimer -= dt;
    if (b.wonderTimer <= 0) game.endGame(game.teamOf[b.owner]);
  }
  if (b.relics.length) {
    const g = 0.5 * b.relics.length * dt;
    p.res.gold += g;
    p.stats.gathered.gold += g;
  }
  if (b.def.gate) {
    let open = false;
    game.spatial.query(b.x, b.z, 2.2, (u) => {
      if (!open && game.isAlly(u.owner, b.owner)) open = true;
    });
    b.gateOpen = clamp(b.gateOpen + (open ? dt * 2 : -dt * 2), 0, 1);
  }

  // Production
  if (b.queue.length) {
    const item = b.queue[0];
    const rate = p.buildingWorkRate(b.type);
    if (item.kind === 'unit') {
      const type = p.currentOf(UNITS[item.id].lineOf ?? item.id);
      const def = UNITS[type];
      const stats = p.unitStats.get(type)!;
      if (p.pop + def.pop > p.popCap && (b.queueTime === 0 || b.queueTime >= stats.trainTime)) {
        if (!b.blockedByPop) {
          b.blockedByPop = true;
          if (p.popCap >= p.maxPop) game.msg(b.owner, 'Population limit reached', 'error');
          else game.msg(b.owner, 'You need to build more houses', 'error');
        }
      } else {
        b.blockedByPop = false;
        b.queueTime += dt * rate;
        if (b.queueTime >= stats.trainTime) {
          b.queue.shift();
          b.queueTime = 0;
          spawnTrained(game, b, type);
        }
      }
    } else {
      const t = TECHS[item.id];
      b.queueTime += dt * rate;
      if (b.queueTime >= t.time) {
        b.queue.shift();
        b.queueTime = 0;
        completeTech(game, p, t.id);
      }
    }
  }

  // Attack
  const atk = b.stats.attack;
  if (atk) {
    if (b.attackCooldown > 0) b.attackCooldown -= dt;
    if (b.attackCooldown <= 0) {
      const t = findBuildingTarget(game, b, atk.range, p.hasFlag('murderHoles') ? 0 : atk.minRange);
      if (t) {
        let arrows = atk.arrows;
        for (const id of b.garrison) {
          const g = game.unit(id);
          if (g && (g.def.gatherer || g.def.classes.includes('infantry') || g.def.classes.includes('archer'))) arrows++;
        }
        if (b.type === 'townCenter' && b.garrison.length === 0) arrows = atk.arrows;
        const y = b.baseY + (b.type === 'castle' ? 3.2 : b.type === 'townCenter' ? 2.6 : b.def.size[0] === 1 ? 3 : 2);
        for (let i = 0; i < arrows; i++) {
          launchProjectile(game, { x: b.x, z: b.z, y, owner: b.owner, id: b.id }, t,
            { attack: atk.damage, attackType: 'pierce', bonus: atk.bonus }, 'arrow', 8, 0.85,
            { lead: p.hasFlag('ballistics'), spread: i === 0 ? 0 : 0.25 });
        }
        b.attackCooldown = atk.reload;
      } else b.attackCooldown = 0.5;
    }
  }
}

function findBuildingTarget(game: Game, b: Building, range: number, minRange: number): Unit | null {
  const team = game.teamOf[b.owner];
  const reach = range + Math.max(b.w, b.h) / 2;
  let best: Unit | null = null;
  let bd = Infinity;
  game.spatial.query(b.x, b.z, reach + 0.5, (u) => {
    if (!u.alive) return;
    const hostile = u.def.animal ? u.def.animal === 'wolf' : game.isEnemy(b.owner, u.owner);
    if (!hostile) return;
    if (!game.vision.isVisible(team, u.x, u.z)) return;
    const dx = Math.max(b.tx - u.x, 0, u.x - (b.tx + b.w));
    const dz = Math.max(b.tz - u.z, 0, u.z - (b.tz + b.h));
    const d = Math.hypot(dx, dz);
    if (d > range || d < minRange) return;
    let s = d;
    if (u.def.classes.includes('siege')) s -= 2;
    if (s < bd) {
      bd = s;
      best = u;
    }
  });
  return best;
}

/** Find a free tile next to the building, preferring the side facing (tx,tz). */
export function exitPoint(game: Game, b: Building, tx: number, tz: number, team: number, naval = false): { x: number; z: number } {
  const ex = clamp(tx, b.tx - 0.5, b.tx + b.w + 0.5);
  const ez = clamp(tz, b.tz - 0.5, b.tz + b.h + 0.5);
  // push the point just outside the footprint
  let px = ex, pz = ez;
  if (px > b.tx && px < b.tx + b.w && pz > b.tz && pz < b.tz + b.h) pz = b.tz + b.h + 0.5;
  const p = game.pathfinder.setDomain(naval).nearestPassable(px, pz, team, 10);
  game.pathfinder.setDomain(false);
  return p ?? { x: b.x, z: b.tz + b.h + 0.5 };
}

function spawnTrained(game: Game, b: Building, type: string): void {
  const p = game.players[b.owner];
  const team = game.teamOf[b.owner];
  const rx = b.rally ? b.rally.x : b.x + 1;
  const rz = b.rally ? b.rally.z : b.tz + b.h + 2;
  const pos = exitPoint(game, b, rx, rz, team, !!UNITS[type].naval);
  const jitter = () => (game.rng.next() - 0.5) * 0.3;
  const u = game.spawnUnit(type, b.owner, pos.x + jitter(), pos.z + jitter());
  u.facing = Math.atan2(rx - u.x, rz - u.z);
  if (u.def.gatherer) p.stats.villagersTrained++;
  else p.stats.militaryTrained++;
  if (b.rally) {
    const t = b.rally.target ? game.get(b.rally.target) : undefined;
    if (t && t.alive && u.def.gatherer && (t.kind === 'resource' || (t.kind === 'building' && t.def.foodCapacity && t.owner === b.owner) || (t.kind === 'unit' && t.def.animal))) {
      u.order = { t: 'gather', target: t.id };
    } else if (t && t.alive && t.kind === 'building' && t.owner === b.owner && !t.built && u.def.builder) {
      u.order = { t: 'build', target: t.id };
    } else if (t && t.alive && t.kind === 'building' && t.owner === b.owner && t.def.garrison) {
      u.order = { t: 'garrison', target: t.id };
    } else {
      u.order = { t: 'move', x: b.rally.x + jitter() * 3, z: b.rally.z + jitter() * 3 };
    }
    resetNav(u);
  }
  if (u.def.trader) {
    u.tradeHome = b.id;
  }
  game.recomputePop(b.owner);
  game.events.push({ e: 'trained', id: u.id, type, owner: b.owner });
}

export function completeTech(game: Game, p: Player, techId: string): void {
  const t = TECHS[techId];
  if (!t || p.researched.has(techId)) return;
  p.researched.add(techId);
  p.researchOrder.push(techId);
  p.researching.delete(techId);
  p.stats.techs++;
  const oldUnitHp = new Map<string, number>();
  for (const [id, s] of p.unitStats) oldUnitHp.set(id, s.hp);
  const oldBldHp = new Map<string, number>();
  for (const [id, s] of p.buildingStats) oldBldHp.set(id, s.hp);
  for (const e of t.effects) {
    if (e.kind === 'age') {
      p.age = e.age;
      if (e.age === 1) p.stats.feudalTime = game.time;
      if (e.age === 2) p.stats.castleTime = game.time;
      if (e.age === 3) p.stats.imperialTime = game.time;
      game.events.push({ e: 'age', owner: p.id, age: e.age });
    } else if (e.kind === 'resource') {
      p.res[e.res] += e.value;
    }
  }
  p.recompute();
  refreshPlayerRefs(game, p, oldUnitHp, oldBldHp);
  // Unit upgrades
  for (const e of t.effects) {
    if (e.kind !== 'upgrade') continue;
    for (const u of game.units) {
      if (!u.alive || u.owner !== p.id || u.type !== e.from) continue;
      const frac = u.hp / u.stats.hp;
      u.type = e.to;
      u.def = UNITS[e.to];
      u.stats = p.unitStats.get(e.to)!;
      u.hp = Math.max(1, frac * u.stats.hp);
    }
  }
  // Tower upgrades
  const towerUp: [string, string, string][] = [['guardTowerUp', 'watchTower', 'guardTower'], ['keepUp', 'guardTower', 'keep']];
  for (const [tid, from, to] of towerUp) {
    if (tid !== techId) continue;
    for (const b of game.buildings) {
      if (!b.alive || b.owner !== p.id || b.type !== from) continue;
      const frac = b.hp / b.stats.hp;
      b.type = to;
      b.def = BUILDINGS[to];
      b.stats = p.buildingStats.get(to)!;
      b.hp = Math.max(1, frac * b.stats.hp);
    }
    game.buildingsVersion++;
  }
  game.recomputePop(p.id);
  game.events.push({ e: 'research', tech: techId, owner: p.id });
  if (t.isAge) game.msg(p.id, `${p.name} advanced to the ${AGE_NAMES[p.age]}`, 'info');
}

function refreshPlayerRefs(game: Game, p: Player, oldUnitHp: Map<string, number>, oldBldHp: Map<string, number>): void {
  for (const u of game.units) {
    if (!u.alive || u.owner !== p.id) continue;
    const s = p.unitStats.get(u.type)!;
    const old = oldUnitHp.get(u.type) ?? s.hp;
    u.stats = s;
    if (s.hp > old) u.hp += s.hp - old;
    if (u.hp > s.hp) u.hp = s.hp;
  }
  for (const b of game.buildings) {
    if (!b.alive || b.owner !== p.id) continue;
    const s = p.buildingStats.get(b.type)!;
    const old = oldBldHp.get(b.type) ?? s.hp;
    b.stats = s;
    if (b.built && s.hp > old) b.hp += s.hp - old;
    if (b.hp > s.hp) b.hp = s.hp;
  }
}

/** Resolve which tech ids a building currently offers for a player (after placeholder mapping). */
export function buildingTechs(p: Player, type: string): string[] {
  const def = BUILDINGS[type];
  return (def.researches ?? []).map((t) => p.resolveTechId(t));
}

export function techAvailable(game: Game, p: Player, techId: string): { ok: boolean; visible: boolean; reason?: string } {
  const t = TECHS[techId];
  if (!t || !p.techAllowed(techId)) return { ok: false, visible: false };
  if (p.researched.has(techId)) return { ok: false, visible: false };
  if (p.researching.has(techId)) return { ok: false, visible: false, reason: 'Researching' };
  if (t.requires) for (const r of t.requires) if (!p.researched.has(r)) return { ok: false, visible: false };
  if (t.isAge && t.age !== p.age) return { ok: false, visible: false };
  if (t.age > p.age) return { ok: false, visible: false };
  if (t.requiresBuildings) {
    const have = game.ageRequirementCount(p.id, t.requiresBuildings.age);
    if (have < t.requiresBuildings.count) {
      return { ok: false, visible: true, reason: `Requires ${t.requiresBuildings.count} ${AGE_NAMES[t.requiresBuildings.age - 1]} buildings (${have}/${t.requiresBuildings.count})` };
    }
  }
  if (techId === 'bombard' || techId === 'handCannoneer') return { ok: false, visible: false };
  return { ok: true, visible: true };
}
