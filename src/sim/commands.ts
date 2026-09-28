import { BUILDINGS } from '../data/buildings';
import { TECHS } from '../data/techs';
import { UNITS } from '../data/units';
import type { Res } from '../data/types';
import { AGE_NAMES } from '../data/types';
import type { Building, Stance, Unit } from './entities';
import type { Game } from './game';
import type { Player } from './player';
import { techAvailable } from './buildingAI';
import { canGarrisonIn, resetNav, setOrder, ungarrison, unloadCargo } from './unitAI';

export type Command =
  | { c: 'move'; units: number[]; x: number; z: number; queue?: boolean; attackMove?: boolean }
  | { c: 'attack'; units: number[]; target: number; queue?: boolean }
  | { c: 'attackGround'; units: number[]; x: number; z: number }
  | { c: 'gather'; units: number[]; target: number; queue?: boolean }
  | { c: 'build'; units: number[]; building: string; tx: number; tz: number; rotated?: boolean; queue?: boolean }
  | { c: 'buildLine'; units: number[]; building: string; tiles: [number, number][]; queue?: boolean }
  | { c: 'repair'; units: number[]; target: number; queue?: boolean }
  | { c: 'garrison'; units: number[]; target: number }
  | { c: 'ungarrison'; building: number; unit?: number }
  | { c: 'unload'; unit: number }
  | { c: 'unloadAt'; units: number[]; x: number; z: number }
  | { c: 'train'; building: number; unit: string; count?: number }
  | { c: 'research'; building: number; tech: string }
  | { c: 'cancel'; building: number; index: number }
  | { c: 'rally'; buildings: number[]; x: number; z: number; target?: number }
  | { c: 'stop'; units: number[] }
  | { c: 'delete'; ids: number[] }
  | { c: 'stance'; units: number[]; stance: Stance }
  | { c: 'patrol'; units: number[]; x: number; z: number }
  | { c: 'townBell'; on: boolean }
  | { c: 'market'; action: 'buy' | 'sell'; res: 'food' | 'wood' | 'stone' }
  | { c: 'heal'; units: number[]; target: number }
  | { c: 'convert'; units: number[]; target: number }
  | { c: 'relic'; units: number[]; target: number }
  | { c: 'dropoff'; units: number[]; target: number }
  | { c: 'trade'; units: number[]; target: number }
  | { c: 'follow'; units: number[]; target: number }
  | { c: 'pack'; units: number[] }
  | { c: 'unpack'; units: number[] }
  | { c: 'resign' };

export interface CmdResult {
  ok: boolean;
  err?: string;
  id?: number;
}

const OK: CmdResult = { ok: true };
const fail = (err: string): CmdResult => ({ ok: false, err });

function ownedUnits(game: Game, pid: number, ids: number[]): Unit[] {
  const out: Unit[] = [];
  for (const id of ids) {
    const u = game.unit(id);
    if (u && u.alive && u.owner === pid && !u.garrisonedIn && !u.def.animal) out.push(u);
    else if (u && u.alive && u.owner === pid && u.def.herdable) out.push(u);
  }
  return out;
}

export function missingResource(p: Player, cost: Partial<Record<Res, number>>): Res | null {
  for (const k of ['food', 'wood', 'gold', 'stone'] as Res[]) if ((cost[k] ?? 0) > p.res[k] + 1e-6) return k;
  return null;
}

/** Tower upgrade line resolution. */
export function currentBuildingType(p: Player, type: string): string {
  if (type === 'watchTower') {
    if (p.researched.has('keepUp')) return 'keep';
    if (p.researched.has('guardTowerUp')) return 'guardTower';
  }
  return type;
}

export function buildingAvailable(game: Game, p: Player, type: string): { ok: boolean; visible: boolean; reason?: string } {
  const def = BUILDINGS[type];
  if (!def) return { ok: false, visible: false };
  if (p.isDisabled(type)) return { ok: false, visible: false };
  if (def.age > p.age) return { ok: false, visible: false };
  // a realm that has lost every Town Center may raise a new one in any age (else it could never recover)
  const rebuild = type === 'townCenter' && game.countBuildings(p.id, 'townCenter', false) === 0;
  if (def.buildAge !== undefined && def.buildAge > p.age && !rebuild) return { ok: false, visible: true, reason: `Available in the ${AGE_NAMES[def.buildAge]}` };
  if (def.requires) {
    for (const r of def.requires) {
      if (game.countBuildings(p.id, r) === 0) return { ok: false, visible: true, reason: `Requires a ${BUILDINGS[r].name}` };
    }
  }
  if (def.maxPerPlayer && game.countBuildings(p.id, type, false) >= def.maxPerPlayer) return { ok: false, visible: true, reason: 'Limit reached' };
  return { ok: true, visible: true };
}

export function unitAvailable(game: Game, p: Player, unitId: string): { ok: boolean; visible: boolean } {
  const def = UNITS[unitId];
  if (!def) return { ok: false, visible: false };
  if (!p.unitAllowed(unitId)) return { ok: false, visible: false };
  if (def.age > p.age) return { ok: false, visible: false };
  return { ok: true, visible: true };
}

export function canPlace(game: Game, pid: number, type: string, tx: number, tz: number, rotated = false): boolean {
  const def = BUILDINGS[type];
  const w = rotated ? def.size[1] : def.size[0];
  const h = rotated ? def.size[0] : def.size[1];
  const m = game.map;
  const team = game.teamOf[pid];
  // computer players plan with full map knowledge; humans must explore first
  const exp = game.players[pid]?.isHuman ? game.vision.explored.get(team) : undefined;
  if (tx < 0 || tz < 0 || tx + w > m.n || tz + h > m.n) return false;
  if (def.naval) {
    // docks: every tile open water, touching land somewhere along the edge
    let shore = false;
    for (let z = tz; z < tz + h; z++)
      for (let x = tx; x < tx + w; x++) {
        const i = m.idx(x, z);
        if (m.navalBlocked[i]) return false;
        if (exp && !exp[i]) return false;
      }
    for (const r of game.resources) {
      if (r.alive && r.type === 'fish' && r.tx >= tx && r.tx < tx + w && r.tz >= tz && r.tz < tz + h) return false;
    }
    for (let z = tz - 1; z <= tz + h && !shore; z++)
      for (let x = tx - 1; x <= tx + w; x++) {
        if (x >= tx && x < tx + w && z >= tz && z < tz + h) continue;
        if (m.inBounds(x, z) && !m.tileWater(x, z) && !m.landBlocked[m.idx(x, z)]) {
          shore = true;
          break;
        }
      }
    return shore;
  }
  let minH = Infinity, maxH = -Infinity;
  for (let z = tz; z < tz + h; z++) {
    for (let x = tx; x < tx + w; x++) {
      const i = m.idx(x, z);
      if (m.landBlocked[i] || m.farmAt[i]) return false;
      if (exp && !exp[i]) return false;
    }
  }
  if (!def.wall && !def.gate) {
    for (let z = tz; z <= tz + h; z++)
      for (let x = tx; x <= tx + w; x++) {
        const hh = m.cornerH(x, z);
        if (hh < minH) minH = hh;
        if (hh > maxH) maxH = hh;
      }
    if (maxH - minH > 1.1) return false;
  }
  // Keep buildings from blocking in resource drop-off distance: disallow placing on enemy-visible units? (AoE2 allows)
  return true;
}

/** Formation targets: a loose box facing the direction of travel. */
export function formationTargets(game: Game, units: Unit[], x: number, z: number): { x: number; z: number }[] {
  const n = units.length;
  if (n === 1) return [{ x, z }];
  let cx = 0, cz = 0;
  for (const u of units) {
    cx += u.x;
    cz += u.z;
  }
  cx /= n;
  cz /= n;
  let dx = x - cx, dz = z - cz;
  const dl = Math.hypot(dx, dz);
  if (dl < 0.01) {
    dx = 0;
    dz = 1;
  } else {
    dx /= dl;
    dz /= dl;
  }
  const px = -dz, pz = dx;
  // order: melee in front, ranged behind, siege/support at the back
  const rank = (u: Unit): number => {
    if (u.def.classes.includes('siege')) return 3;
    if (u.def.monk || u.def.gatherer || u.def.trader) return 2;
    if (u.stats.range > 1) return 1;
    return 0;
  };
  const sorted = [...units].sort((a, b) => rank(a) - rank(b));
  const cols = Math.max(2, Math.ceil(Math.sqrt(n * 2.2)));
  const out = new Map<Unit, { x: number; z: number }>();
  const team = game.teamOf[units[0].owner];
  game.pathfinder.setDomain(!!units[0].def.naval);
  let row = 0;
  for (let i = 0; i < sorted.length; i += cols) {
    const rowUnits = sorted.slice(i, i + cols);
    const spacing = Math.max(...rowUnits.map((u) => u.radius * 2 + 0.25));
    // sort row by lateral position to minimise crossing
    rowUnits.sort((a, b) => (a.x * px + a.z * pz) - (b.x * px + b.z * pz));
    const k = rowUnits.length;
    rowUnits.forEach((u, c) => {
      const off = (c - (k - 1) / 2) * spacing;
      let tx = x + px * off - dx * row * spacing;
      let tz = z + pz * off - dz * row * spacing;
      if (!game.pathfinder.isPassable(tx, tz, team)) {
        const p = game.pathfinder.nearestPassable(tx, tz, team, 4);
        if (p) {
          tx = p.x + (game.rng.next() - 0.5) * 0.3;
          tz = p.z + (game.rng.next() - 0.5) * 0.3;
        } else {
          tx = x;
          tz = z;
        }
      }
      out.set(u, { x: tx, z: tz });
    });
    row++;
  }
  game.pathfinder.setDomain(false);
  return units.map((u) => out.get(u)!);
}

export function issueCommand(game: Game, pid: number, cmd: Command): CmdResult {
  const p = game.players[pid];
  if (!p || p.defeated) return fail('defeated');
  switch (cmd.c) {
    case 'move': {
      const us = ownedUnits(game, pid, cmd.units);
      if (!us.length) return fail('no units');
      for (const group of [us.filter((u) => !u.def.naval), us.filter((u) => u.def.naval)]) {
        if (!group.length) continue;
        const targets = formationTargets(game, group, cmd.x, cmd.z);
        group.forEach((u, i) => setOrder(game, u, { t: 'move', x: targets[i].x, z: targets[i].z, attackMove: cmd.attackMove }, cmd.queue));
      }
      return OK;
    }
    case 'attack': {
      const t = game.get(cmd.target);
      if (!t || !t.alive || t.kind === 'resource') return fail('invalid target');
      for (const u of ownedUnits(game, pid, cmd.units)) {
        if (u.def.monk) {
          if (t.kind === 'unit' && game.isEnemy(pid, t.owner)) setOrder(game, u, { t: 'convert', target: t.id }, cmd.queue);
          continue;
        }
        if (u.stats.attack <= 0) continue;
        if (u.def.classes.includes('ram') && t.kind === 'unit' && !t.def.classes.includes('siege')) continue;
        if (u.def.gatherer && t.kind === 'unit' && t.def.animal && t.def.animal !== 'wolf') {
          setOrder(game, u, { t: 'gather', target: t.id }, cmd.queue);
          continue;
        }
        setOrder(game, u, { t: 'attack', target: t.id, force: true }, cmd.queue);
      }
      return OK;
    }
    case 'attackGround': {
      for (const u of ownedUnits(game, pid, cmd.units)) {
        if (u.def.splash || u.def.packs) setOrder(game, u, { t: 'attackGround', x: cmd.x, z: cmd.z });
      }
      return OK;
    }
    case 'gather': {
      const t = game.get(cmd.target);
      if (!t || !t.alive) return fail('invalid target');
      const vills = ownedUnits(game, pid, cmd.units).filter((u) => u.def.gatherer && (!u.def.fisher || (t.kind === 'resource' && t.gather === 'fish')));
      for (const u of vills) {
        const wasGather = u.order.t === 'gather';
        setOrder(game, u, { t: 'gather', target: t.id }, cmd.queue);
        if (!wasGather) u.prevOrder = null;
      }
      return OK;
    }
    case 'build': {
      const type = currentBuildingType(p, cmd.building);
      const def = BUILDINGS[type];
      if (!def) return fail('unknown building');
      const av = buildingAvailable(game, p, type);
      if (!av.ok) return fail(av.reason ?? 'Not available');
      if (!canPlace(game, pid, type, cmd.tx, cmd.tz, !!cmd.rotated)) return fail("You can't build there");
      const cost = p.buildingCost(type);
      const miss = missingResource(p, cost);
      if (miss) return fail(`Not enough ${miss}`);
      p.pay(cost);
      const b = game.createBuilding(type, pid, cmd.tx, cmd.tz, false, !!cmd.rotated);
      assignBuilders(game, pid, cmd.units, b, !!cmd.queue);
      game.events.push({ e: 'placed', owner: pid, x: b.x, z: b.z });
      return { ok: true, id: b.id };
    }
    case 'buildLine': {
      const type = cmd.building;
      const def = BUILDINGS[type];
      if (!def || !(def.wall)) return fail('not a wall');
      const av = buildingAvailable(game, p, type);
      if (!av.ok) return fail(av.reason ?? 'Not available');
      const cost = p.buildingCost(type);
      let first: Building | null = null;
      let placed = 0;
      for (const [tx, tz] of cmd.tiles) {
        if (!canPlace(game, pid, type, tx, tz)) continue;
        if (missingResource(p, cost)) {
          if (!placed) return fail(`Not enough ${missingResource(p, cost)}`);
          break;
        }
        p.pay(cost);
        const b = game.createBuilding(type, pid, tx, tz, false);
        if (!first) first = b;
        placed++;
      }
      if (!first) return fail("You can't build there");
      assignBuilders(game, pid, cmd.units, first, !!cmd.queue);
      game.events.push({ e: 'placed', owner: pid, x: first.x, z: first.z });
      return OK;
    }
    case 'repair': {
      const t = game.get(cmd.target);
      if (!t || !t.alive || t.kind === 'resource') return fail('invalid');
      for (const u of ownedUnits(game, pid, cmd.units)) if (u.def.builder) setOrder(game, u, { t: 'repair', target: t.id }, cmd.queue);
      return OK;
    }
    case 'garrison': {
      const t = game.get(cmd.target);
      if (!t || !t.alive) return fail('invalid');
      for (const u of ownedUnits(game, pid, cmd.units)) {
        if (t.kind === 'building' && !canGarrisonIn(game, u, t) && !(u.relicId && t.type === 'monastery')) continue;
        if (t.kind === 'unit' && (u.def.naval || t.owner !== pid || (!t.def.transport && !t.def.garrisonCapacity))) continue;
        setOrder(game, u, { t: 'garrison', target: t.id });
      }
      return OK;
    }
    case 'ungarrison': {
      const b = game.building(cmd.building);
      if (!b || b.owner !== pid) return fail('invalid');
      ungarrison(game, b, cmd.unit ?? 0);
      return OK;
    }
    case 'unloadAt': {
      for (const u of ownedUnits(game, pid, cmd.units)) if (u.def.transport && u.cargo.length) setOrder(game, u, { t: 'unload', x: cmd.x, z: cmd.z });
      return OK;
    }
    case 'unload': {
      const u = game.unit(cmd.unit);
      if (!u || u.owner !== pid) return fail('invalid');
      unloadCargo(game, u);
      return OK;
    }
    case 'train': {
      const b = game.building(cmd.building);
      if (!b || b.owner !== pid || !b.built) return fail('invalid');
      const trains = b.def.trains ?? [];
      if (!trains.includes(cmd.unit) && !(cmd.unit === p.civ.uniqueUnit && trains.includes('uniqueUnit'))) return fail('cannot train here');
      const unitId = p.currentOf(cmd.unit);
      const av = unitAvailable(game, p, unitId);
      if (!av.ok) return fail('Not available');
      const count = cmd.count ?? 1;
      let queued = 0;
      for (let i = 0; i < count; i++) {
        if (b.queue.length >= 15) break;
        const cost = p.unitCost(unitId);
        const miss = missingResource(p, cost);
        if (miss) {
          if (!queued) return fail(`Not enough ${miss}`);
          break;
        }
        p.pay(cost);
        b.queue.push({ kind: 'unit', id: unitId, paid: { ...cost } });
        queued++;
      }
      return queued ? OK : fail('Queue is full');
    }
    case 'research': {
      const b = game.building(cmd.building);
      if (!b || b.owner !== pid || !b.built) return fail('invalid');
      const techId = p.resolveTechId(cmd.tech);
      const t = TECHS[techId];
      if (!t) return fail('unknown tech');
      const list = (b.def.researches ?? []).map((x) => p.resolveTechId(x));
      if (!list.includes(techId)) return fail('cannot research here');
      const av = techAvailable(game, p, techId);
      if (!av.ok) return fail(av.reason ?? 'Not available');
      if (b.queue.length >= 15) return fail('Queue is full');
      const cost = p.techCost(t);
      const miss = missingResource(p, cost);
      if (miss) return fail(`Not enough ${miss}`);
      p.pay(cost);
      p.researching.add(techId);
      b.queue.push({ kind: 'tech', id: techId, paid: { ...cost } });
      return OK;
    }
    case 'cancel': {
      const b = game.building(cmd.building);
      if (!b || b.owner !== pid) return fail('invalid');
      const item = b.queue[cmd.index];
      if (!item) return fail('invalid');
      b.queue.splice(cmd.index, 1);
      p.refund(item.paid);
      if (item.kind === 'tech') p.researching.delete(item.id);
      if (cmd.index === 0) b.queueTime = 0;
      return OK;
    }
    case 'rally': {
      for (const id of cmd.buildings) {
        const b = game.building(id);
        if (b && b.owner === pid) b.rally = { x: cmd.x, z: cmd.z, target: cmd.target ?? 0 };
      }
      return OK;
    }
    case 'stop': {
      for (const u of ownedUnits(game, pid, cmd.units)) {
        setOrder(game, u, { t: 'idle' });
        u.homeX = u.x;
        u.homeZ = u.z;
      }
      return OK;
    }
    case 'delete': {
      for (const id of cmd.ids) {
        const e = game.get(id);
        if (!e || e.owner !== pid) continue;
        if (e.kind === 'unit') game.killUnit(e, 0);
        else if (e.kind === 'building') {
          if (!e.built && e.progress === 0) p.refund(p.buildingCost(e.type));
          game.destroyBuilding(e, 0);
        }
      }
      return OK;
    }
    case 'stance': {
      for (const u of ownedUnits(game, pid, cmd.units)) {
        u.stance = cmd.stance;
        u.homeX = u.x;
        u.homeZ = u.z;
      }
      return OK;
    }
    case 'patrol': {
      for (const u of ownedUnits(game, pid, cmd.units)) {
        setOrder(game, u, { t: 'patrol', ax: u.x, az: u.z, bx: cmd.x, bz: cmd.z, leg: 0 });
      }
      return OK;
    }
    case 'townBell': {
      if (cmd.on) {
        for (const u of game.units) {
          if (!u.alive || u.owner !== pid || !u.def.gatherer || u.garrisonedIn) continue;
          let best: Building | null = null;
          let bd = Infinity;
          for (const b of game.buildings) {
            if (!b.alive || b.owner !== pid || !b.built || !b.def.garrison || b.type === 'monastery') continue;
            if (!canGarrisonIn(game, u, b)) continue;
            const d = Math.hypot(b.x - u.x, b.z - u.z);
            if (d < bd) {
              bd = d;
              best = b;
            }
          }
          if (best) {
            u.prevOrder = u.order.t === 'gather' ? u.order : u.prevOrder;
            setOrder(game, u, { t: 'garrison', target: best.id });
          }
        }
      } else {
        for (const b of game.buildings) {
          if (!b.alive || b.owner !== pid || !b.garrison.length) continue;
          const vills = b.garrison.filter((id) => game.unit(id)?.def.gatherer);
          for (const id of vills) ungarrison(game, b, id);
        }
      }
      return OK;
    }
    case 'market': {
      if (game.countBuildings(pid, 'market') === 0) return fail('You need a Market');
      const fee = p.hasFlag('guilds') ? 0.15 : 0.3;
      const price = game.market[cmd.res];
      if (cmd.action === 'sell') {
        if (p.res[cmd.res] < 100) return fail(`Not enough ${cmd.res}`);
        p.res[cmd.res] -= 100;
        p.res.gold += Math.floor(price * (1 - fee));
        game.market[cmd.res] = Math.max(20, price - 3);
      } else {
        const cost = Math.ceil(price * (1 + fee));
        if (p.res.gold < cost) return fail('Not enough gold');
        p.res.gold -= cost;
        p.res[cmd.res] += 100;
        game.market[cmd.res] = Math.min(9999, price + 3);
      }
      return OK;
    }
    case 'heal': {
      for (const u of ownedUnits(game, pid, cmd.units)) if (u.def.monk) setOrder(game, u, { t: 'heal', target: cmd.target });
      return OK;
    }
    case 'convert': {
      for (const u of ownedUnits(game, pid, cmd.units)) if (u.def.monk) setOrder(game, u, { t: 'convert', target: cmd.target });
      return OK;
    }
    case 'relic': {
      const monks = ownedUnits(game, pid, cmd.units).filter((u) => u.def.monk && !u.relicId);
      if (monks.length) setOrder(game, monks[0], { t: 'relic', target: cmd.target });
      return OK;
    }
    case 'dropoff': {
      for (const u of ownedUnits(game, pid, cmd.units)) if (u.def.gatherer) setOrder(game, u, { t: 'dropoff', target: cmd.target });
      return OK;
    }
    case 'trade': {
      for (const u of ownedUnits(game, pid, cmd.units)) if (u.def.trader) setOrder(game, u, { t: 'trade', target: cmd.target });
      return OK;
    }
    case 'follow': {
      for (const u of ownedUnits(game, pid, cmd.units)) setOrder(game, u, { t: 'follow', target: cmd.target });
      return OK;
    }
    case 'pack': {
      for (const u of ownedUnits(game, pid, cmd.units)) {
        if (u.def.packs && !u.packed && u.packTimer <= 0) {
          setOrder(game, u, { t: 'idle' });
          u.packTimer = 3.5;
          u.setAnim('pack', game.time);
        }
      }
      return OK;
    }
    case 'unpack': {
      for (const u of ownedUnits(game, pid, cmd.units)) if (u.def.packs && u.packed) setOrder(game, u, { t: 'unpack' });
      return OK;
    }
    case 'resign': {
      p.resigned = true;
      game.defeatPlayer(p);
      return OK;
    }
  }
  return fail('unknown command');
}

function assignBuilders(game: Game, pid: number, ids: number[], b: Building, queue: boolean): void {
  for (const u of ownedUnits(game, pid, ids)) {
    if (!u.def.builder) continue;
    const prev = u.order.t === 'gather' ? u.order : null;
    setOrder(game, u, { t: 'build', target: b.id }, queue);
    if (!queue) {
      u.prevOrder = prev;
      resetNav(u);
    }
  }
}
