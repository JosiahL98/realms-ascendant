import { GATHER_RES, type GatherKind } from '../data/types';
import { clamp, distToRect } from '../util/math';
import { computeDamage, dealDamage, elevationMult, launchAtPoint, launchProjectile, unitCenterY } from './combat';
import type { Building, Order, ResourceNode, Unit, WorkTool } from './entities';
import { GATHER_RATES, type Game } from './game';
import { finishConstruction } from './buildingAI';

type Nav = 'moving' | 'arrived' | 'failed';
interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

const MELEE_REACH = 0.12;

/* ====================================================================== */
/* Order management                                                         */
/* ====================================================================== */

export function resetNav(u: Unit): void {
  u.path = [];
  u.pathIdx = 0;
  u.navGoalX = NaN;
  u.navGoalZ = NaN;
  u.navFailed = 0;
  u.repathAt = 0;
  u.stuckTime = 0;
}

function releaseClaims(game: Game, u: Unit): void {
  if (u.order.t === 'gather') {
    const f = game.building(u.order.target);
    if (f && f.farmer === u.id) f.farmer = 0;
  }
}

export function setOrder(game: Game, u: Unit, order: Order, queue = false): void {
  if (queue && (u.order.t !== 'idle' || u.orderQueue.length)) {
    u.orderQueue.push(order);
    return;
  }
  releaseClaims(game, u);
  u.orderQueue = [];
  u.order = order;
  u.engagedFrom = null;
  u.attackWindup = -1;
  u.returning = false;
  u.convertTime = 0;
  resetNav(u);
  if (order.t === 'move' || order.t === 'patrol') {
    u.homeX = order.t === 'move' ? order.x : order.bx;
    u.homeZ = order.t === 'move' ? order.z : order.bz;
  }
}

function finishOrder(game: Game, u: Unit): void {
  releaseClaims(game, u);
  u.attackWindup = -1;
  u.returning = false;
  resetNav(u);
  if (u.orderQueue.length) {
    u.order = u.orderQueue.shift()!;
    return;
  }
  if (u.engagedFrom) {
    u.order = u.engagedFrom;
    u.engagedFrom = null;
    return;
  }
  u.order = { t: 'idle' };
  u.homeX = u.x;
  u.homeZ = u.z;
}

function halt(u: Unit): void {
  u.moving = false;
  u.path.length = 0;
  u.pathIdx = 0;
}

function faceTo(u: Unit, x: number, z: number): void {
  const dx = x - u.x, dz = z - u.z;
  if (dx * dx + dz * dz > 1e-6) u.facing = Math.atan2(dx, dz);
}

/* ====================================================================== */
/* Navigation                                                               */
/* ====================================================================== */

function followPath(game: Game, u: Unit, dt: number): void {
  let step = u.stats.speed * dt;
  if (u.relicId) step *= 0.9;
  while (step > 1e-6 && u.pathIdx * 2 < u.path.length) {
    const wx = u.path[u.pathIdx * 2], wz = u.path[u.pathIdx * 2 + 1];
    const dx = wx - u.x, dz = wz - u.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-4) {
      u.pathIdx++;
      continue;
    }
    u.facing = Math.atan2(dx, dz);
    if (d <= step) {
      u.x = wx;
      u.z = wz;
      step -= d;
      u.pathIdx++;
    } else {
      u.x += (dx / d) * step;
      u.z += (dz / d) * step;
      step = 0;
    }
  }
  u.moving = true;
  u.setAnim(u.carryAmount > 0 && u.def.gatherer ? 'carry' : 'walk', game.time);
}

function navigate(game: Game, u: Unit, gx: number, gz: number, range: number, rect: Rect | null, dt: number): Nav {
  const d = rect ? distToRect(u.x, u.z, rect.x0, rect.z0, rect.x1, rect.z1) : Math.hypot(gx - u.x, gz - u.z);
  if (d <= range) {
    halt(u);
    u.stuckTime = 0;
    return 'arrived';
  }
  // Trebuchets must pack before moving.
  if (u.def.packs) {
    if (u.packTimer > 0) {
      u.moving = false;
      return 'moving';
    }
    if (!u.packed) {
      u.packTimer = 3.5;
      u.setAnim('pack', game.time);
      u.moving = false;
      return 'moving';
    }
  }
  const team = game.teamOf[u.owner];
  let ax = gx, az = gz;
  if (rect) {
    ax = clamp(u.x, rect.x0, rect.x1);
    az = clamp(u.z, rect.z0, rect.z1);
    // stand just off the footprint edge so the aim point lies in a walkable tile
    const ox = u.x - ax, oz = u.z - az;
    const ol = Math.hypot(ox, oz);
    const off = Math.min(range * 0.7, 0.45);
    if (ol > 1e-4) {
      ax += (ox / ol) * off;
      az += (oz / ol) * off;
    }
  } else if (range > 0.3 && d > 1e-4) {
    // chase point: stop a little short of the target
    const off = Math.min(range * 0.7, d);
    ax = gx + ((u.x - gx) / d) * off;
    az = gz + ((u.z - gz) / d) * off;
  }
  const goalChanged = !(Math.abs(gx - u.navGoalX) < 0.8 && Math.abs(gz - u.navGoalZ) < 0.8 && Math.abs(u.navGoalR - range) < 0.3);
  const pathDone = u.pathIdx * 2 >= u.path.length;
  const pf = game.pathfinder;

  if (goalChanged || pathDone) {
    const direct = d < 14 && pf.lineClear(u.x, u.z, ax, az, team, d < 2 ? 0 : 0.18);
    if (direct) {
      u.path = [ax, az];
      u.pathIdx = 0;
      u.navGoalX = gx;
      u.navGoalZ = gz;
      u.navGoalR = range;
      u.navReachable = true;
    } else if (game.time >= u.repathAt && game.takePathBudget()) {
      const goal = rect
        ? { x0: rect.x0, z0: rect.z0, x1: rect.x1, z1: rect.z1, range: Math.max(0, range) }
        : { x0: gx, z0: gz, x1: gx, z1: gz, range: Math.max(0, range - 0.5) };
      const res = pf.findPath(u.x, u.z, goal, team);
      if (res.reached && res.path.length === 0) res.path = [ax, az];
      u.path = res.path;
      u.pathIdx = 0;
      u.navGoalX = gx;
      u.navGoalZ = gz;
      u.navGoalR = range;
      u.navReachable = res.reached;
      u.repathAt = game.time + 0.7;
      if (res.path.length === 0) {
        u.navFailed++;
        if (u.navFailed >= 2) return 'failed';
        u.moving = false;
        return 'moving';
      }
    } else if (pathDone) {
      // waiting for a pathfinding slot
      u.moving = false;
      if (!u.navReachable && u.navFailed > 0 && game.time >= u.repathAt) return 'failed';
      return 'moving';
    }
  }

  if (u.pathIdx * 2 < u.path.length) {
    followPath(game, u, dt);
    // stuck detection
    if (game.time >= u.navCheckAt) {
      if (u.navCheckAt > 0 && u.navCheckD - d < 0.15) {
        u.stuckTime++;
        if (u.stuckTime >= 2) {
          u.path = [];
          u.pathIdx = 0;
          u.navGoalX = NaN;
          u.repathAt = game.time;
        }
        if (u.stuckTime >= 6) return 'failed';
      } else u.stuckTime = 0;
      u.navCheckAt = game.time + 1;
      u.navCheckD = d;
    }
    return 'moving';
  }
  // Path finished but not in range.
  if (!u.navReachable) {
    u.navFailed++;
    if (u.navFailed >= 2) return 'failed';
  }
  u.moving = false;
  u.navGoalX = NaN;
  return 'moving';
}

function rectOf(b: Building): Rect {
  return { x0: b.tx, z0: b.tz, x1: b.tx + b.w, z1: b.tz + b.h };
}
function rectOfRes(r: ResourceNode): Rect | null {
  if (!r.blocks) return null;
  return { x0: r.tx, z0: r.tz, x1: r.tx + 1, z1: r.tz + 1 };
}

/* ====================================================================== */
/* Main update                                                              */
/* ====================================================================== */

export function updateUnit(game: Game, u: Unit, dt: number): void {
  if (u.cooldown > 0) u.cooldown -= dt;
  if (u.stats.regen > 0 && u.hp < u.stats.hp) {
    u.hp = Math.min(u.stats.hp, u.hp + (u.stats.regen / 60) * dt);
  }
  if (u.def.monk && u.faith < 100) {
    const p = game.players[u.owner];
    let rate = 100 / 62;
    if (p.hasFlag('illumination')) rate *= 1.5;
    if (p.hasFlag('theocracy')) rate *= 1.3;
    u.faith = Math.min(100, u.faith + rate * dt);
  }
  if (u.packTimer > 0) {
    u.packTimer -= dt;
    if (u.packTimer <= 0) {
      u.packTimer = 0;
      u.packed = !u.packed;
    }
    u.moving = false;
    return;
  }
  u.moving = false;
  const o = u.order;
  switch (o.t) {
    case 'idle':
      doIdle(game, u, dt);
      break;
    case 'move':
      doMove(game, u, o, dt);
      break;
    case 'attack':
      doAttack(game, u, o, dt);
      break;
    case 'attackGround':
      doAttackGround(game, u, o, dt);
      break;
    case 'gather':
      doGather(game, u, o, dt);
      break;
    case 'build':
      doBuild(game, u, o, dt);
      break;
    case 'repair':
      doRepair(game, u, o, dt);
      break;
    case 'garrison':
      doGarrison(game, u, o, dt);
      break;
    case 'dropoff':
      doDropoffOrder(game, u, o, dt);
      break;
    case 'heal':
      doHeal(game, u, o, dt);
      break;
    case 'convert':
      doConvert(game, u, o, dt);
      break;
    case 'patrol':
      doPatrol(game, u, o, dt);
      break;
    case 'follow':
      doFollow(game, u, o, dt);
      break;
    case 'trade':
      doTrade(game, u, o, dt);
      break;
    case 'relic':
      doRelic(game, u, o, dt);
      break;
    case 'flee':
      doFlee(game, u, o, dt);
      break;
    case 'unpack':
      if (u.def.packs && u.packed) {
        u.packTimer = 3.5;
        u.setAnim('unpack', game.time);
      }
      finishOrder(game, u);
      break;
  }
  if (!u.moving && u.anim === 'walk') u.setAnim('idle', game.time);
  if (!u.moving && u.anim === 'carry') u.setAnim('idle', game.time);
}

/* ====================================================================== */
/* Idle & targeting                                                         */
/* ====================================================================== */

export function isMilitary(u: Unit): boolean {
  return !u.def.gatherer && !u.def.monk && !u.def.trader && !u.def.animal && u.stats.attack > 0;
}

function canAttackUnit(u: Unit, v: Unit): boolean {
  if (u.def.classes.includes('ram')) return v.def.classes.includes('siege');
  if (u.def.packs) return false;
  if (u.stats.attack <= 0) return false;
  return true;
}

function canAutoAttackBuildings(u: Unit): boolean {
  return u.def.classes.includes('ram') || !!u.def.packs;
}

function isHostileUnit(game: Game, u: Unit, v: Unit): boolean {
  if (v.def.animal) return v.def.animal === 'wolf' && !u.def.animal;
  return game.isEnemy(u.owner, v.owner);
}

export function findEnemyTarget(game: Game, u: Unit, radius: number, allowBuildings: boolean): Unit | Building | null {
  const team = game.teamOf[u.owner];
  let best: Unit | Building | null = null;
  let bs = Infinity;
  const minR = u.stats.minRange;
  game.spatial.query(u.x, u.z, radius + 0.5, (v, d2) => {
    if (!v.alive || v === u) return;
    if (!isHostileUnit(game, u, v)) return;
    if (!canAttackUnit(u, v)) return;
    if (!game.vision.isVisible(team, v.x, v.z)) return;
    const d = Math.sqrt(d2);
    if (minR > 0 && d < minR) return;
    let s = d;
    if (v.id === u.lastAttackerId) s -= 3;
    if (v.def.gatherer || v.def.trader) s += 1.5;
    if (v.def.monk) s -= 0.5;
    if (s < bs) {
      bs = s;
      best = v;
    }
  });
  if (!best && (allowBuildings || canAutoAttackBuildings(u))) {
    for (const b of game.buildings) {
      if (!b.alive || !game.isEnemy(u.owner, b.owner)) continue;
      if (!(b.seenBy & (1 << (team & 15)))) continue;
      const d = distToRect(u.x, u.z, b.tx, b.tz, b.tx + b.w, b.tz + b.h);
      if (d > radius) continue;
      let s = d;
      if (b.def.wall) s += 6;
      if (b.def.attack) s -= 2;
      if (s < bs) {
        bs = s;
        best = b;
      }
    }
  }
  return best;
}

function engage(game: Game, u: Unit, t: Unit | Building): void {
  const prev = u.order;
  if (prev.t === 'move' && prev.attackMove) u.engagedFrom = prev;
  else if (prev.t === 'patrol') u.engagedFrom = prev;
  else if (u.stance === 'defensive' && !u.engagedFrom) u.engagedFrom = { t: 'move', x: u.homeX, z: u.homeZ };
  u.order = { t: 'attack', target: t.id };
  u.attackWindup = -1;
  resetNav(u);
}

function doIdle(game: Game, u: Unit, dt: number): void {
  if (u.orderQueue.length) {
    u.order = u.orderQueue.shift()!;
    return;
  }
  if (u.anim !== 'die' && u.anim !== 'pack' && u.anim !== 'unpack') u.setAnim('idle', game.time);
  if (u.def.animal) {
    animalIdle(game, u, dt);
    return;
  }
  if (game.time < u.scanAt) return;
  u.scanAt = game.time + 0.4 + game.rng.next() * 0.4;
  if (u.def.monk) {
    const heal = findHealTarget(game, u, u.stats.los);
    if (heal) u.order = { t: 'heal', target: heal.id };
    return;
  }
  if (!isMilitary(u) || u.stance === 'passive') return;
  const r = u.stance === 'standGround' ? Math.max(1, u.stats.range + u.radius + 0.3) : u.stats.los;
  const t = findEnemyTarget(game, u, r, false);
  if (t) engage(game, u, t);
}

export function onAttacked(game: Game, u: Unit, attacker: Unit | Building): void {
  if (!u.alive) return;
  if (u.def.animal) {
    if (u.def.animal === 'deer' || u.def.animal === 'sheep') {
      if (u.def.animal === 'deer') {
        const dx = u.x - attacker.x, dz = u.z - attacker.z;
        const l = Math.hypot(dx, dz) || 1;
        u.order = { t: 'flee', x: u.x + (dx / l) * 3, z: u.z + (dz / l) * 3, until: game.time + 2.5 };
        resetNav(u);
      }
      return;
    }
    if (attacker.kind === 'unit' && u.order.t !== 'attack') {
      u.order = { t: 'attack', target: attacker.id };
      resetNav(u);
    }
    return;
  }
  if (attacker.kind !== 'unit') return;
  if (u.def.gatherer) {
    // villagers defend themselves against animals when idle or hunting
    if (attacker.def.animal && (u.order.t === 'idle' || u.order.t === 'gather')) {
      if (u.order.t === 'gather' && u.order.target === attacker.id) return;
      u.prevOrder = u.order.t === 'gather' ? u.order : null;
      u.order = { t: 'attack', target: attacker.id };
      resetNav(u);
    }
    return;
  }
  if (!isMilitary(u) || u.stance === 'passive' || !canAttackUnit(u, attacker)) return;
  const o = u.order;
  if (o.t === 'idle' || (o.t === 'move' && o.attackMove) || o.t === 'patrol') {
    if (u.stance === 'standGround') {
      const d = Math.hypot(attacker.x - u.x, attacker.z - u.z) - u.radius - attacker.radius;
      if (d > u.stats.range + 0.3) return;
    }
    engage(game, u, attacker);
  } else if (o.t === 'attack') {
    // switch from a building/auto target to the unit hitting us (only for auto-engagements)
    const cur = game.get(o.target);
    if (cur && cur.kind === 'building' && !o.force) {
      u.order = { t: 'attack', target: attacker.id };
      resetNav(u);
    }
  }
}

/* ====================================================================== */
/* Move / patrol / follow / flee                                            */
/* ====================================================================== */

function doMove(game: Game, u: Unit, o: Extract<Order, { t: 'move' }>, dt: number): void {
  if (o.attackMove && isMilitary(u) && game.time >= u.scanAt) {
    u.scanAt = game.time + 0.5 + game.rng.next() * 0.3;
    const t = findEnemyTarget(game, u, u.stats.los, true);
    if (t) {
      engage(game, u, t);
      return;
    }
  }
  const s = navigate(game, u, o.x, o.z, 0.2, null, dt);
  if (s !== 'moving') finishOrder(game, u);
}

function doPatrol(game: Game, u: Unit, o: Extract<Order, { t: 'patrol' }>, dt: number): void {
  if (isMilitary(u) && game.time >= u.scanAt) {
    u.scanAt = game.time + 0.5 + game.rng.next() * 0.3;
    const t = findEnemyTarget(game, u, u.stats.los, false);
    if (t) {
      engage(game, u, t);
      return;
    }
  }
  const tx = o.leg === 0 ? o.bx : o.ax, tz = o.leg === 0 ? o.bz : o.az;
  const s = navigate(game, u, tx, tz, 0.3, null, dt);
  if (s !== 'moving') {
    o.leg = o.leg === 0 ? 1 : 0;
    resetNav(u);
  }
}

function doFollow(game: Game, u: Unit, o: Extract<Order, { t: 'follow' }>, dt: number): void {
  const t = game.unit(o.target);
  if (!t || !t.alive || t.garrisonedIn) {
    finishOrder(game, u);
    return;
  }
  const d = Math.hypot(t.x - u.x, t.z - u.z);
  if (d < 1.6) {
    halt(u);
    return;
  }
  navigate(game, u, t.x, t.z, 1.2, null, dt);
}

function doFlee(game: Game, u: Unit, o: Extract<Order, { t: 'flee' }>, dt: number): void {
  if (game.time > o.until) {
    finishOrder(game, u);
    return;
  }
  const s = navigate(game, u, o.x, o.z, 0.3, null, dt);
  if (s !== 'moving') finishOrder(game, u);
}

/* ====================================================================== */
/* Combat                                                                   */
/* ====================================================================== */

function edgeDist(u: Unit, t: Unit | Building): number {
  if (t.kind === 'unit') return Math.hypot(t.x - u.x, t.z - u.z) - u.radius - t.radius;
  return distToRect(u.x, u.z, t.tx, t.tz, t.tx + t.w, t.tz + t.h) - u.radius;
}

function attackRange(u: Unit): number {
  return u.stats.range > 0 ? u.stats.range : MELEE_REACH;
}

function doAttack(game: Game, u: Unit, o: Extract<Order, { t: 'attack' }>, dt: number): void {
  const t = game.get(o.target);
  if (!t || !t.alive || t.kind === 'resource' || (t.kind === 'unit' && t.garrisonedIn)) {
    targetLost(game, u);
    return;
  }
  if (t.kind === 'unit' && !o.force && !isHostileUnit(game, u, t) && !(u.def.animal && t.owner !== 0) && !t.def.animal) {
    // converted or allied now
    targetLost(game, u);
    return;
  }
  if (t.kind === 'building' && !game.isEnemy(u.owner, t.owner) && !o.force) {
    targetLost(game, u);
    return;
  }
  const team = game.teamOf[u.owner];
  if (t.kind === 'unit' && !u.def.animal && !game.vision.isVisible(team, t.x, t.z)) {
    targetLost(game, u);
    return;
  }
  // defensive leash
  if (u.stance === 'defensive' && u.engagedFrom && Math.hypot(u.x - u.homeX, u.z - u.homeZ) > 7) {
    targetLost(game, u, true);
    return;
  }
  if (u.def.animal && u.def.animal === 'boar' && Math.hypot(u.x - u.homeX, u.z - u.homeZ) > 12) {
    u.order = { t: 'move', x: u.homeX, z: u.homeZ };
    return;
  }
  const d = edgeDist(u, t);
  const range = attackRange(u);
  if (d > range) {
    if (u.stance === 'standGround' && !o.force && u.order === o && u.engagedFrom === null && isMilitary(u)) {
      targetLost(game, u);
      return;
    }
    u.attackWindup = -1;
    const nav = t.kind === 'unit'
      ? navigate(game, u, t.x, t.z, range + u.radius + t.radius - 0.02, null, dt)
      : navigate(game, u, t.x, t.z, range + u.radius - 0.02, rectOf(t), dt);
    if (nav === 'failed') targetLost(game, u);
    return;
  }
  if (u.stats.minRange > 0 && d < u.stats.minRange && !(t.kind === 'building')) {
    // too close for this weapon
    targetLost(game, u);
    return;
  }
  halt(u);
  faceTo(u, t.x, t.z);
  if (u.def.packs && u.packed) {
    u.packTimer = 3.5;
    u.setAnim('unpack', game.time);
    return;
  }
  performAttackCycle(game, u, t, dt);
}

function performAttackCycle(game: Game, u: Unit, t: Unit | Building, dt: number): void {
  if (u.attackWindup < 0) {
    if (u.cooldown > 0) {
      if (u.anim !== 'attack' || game.time - u.animStart > 1.2) u.setAnim('idle', game.time);
      return;
    }
    u.attackWindup = u.def.attackDelay ?? (u.stats.range > 0 ? 0.35 : 0.45);
    u.anim = 'attack';
    u.animStart = game.time;
  }
  u.attackWindup -= dt;
  if (u.attackWindup <= 0) {
    u.attackWindup = -1;
    u.cooldown = Math.max(0.1, u.stats.reload - (u.def.attackDelay ?? 0.4));
    strike(game, u, t);
  }
}

function strike(game: Game, u: Unit, t: Unit | Building): void {
  const s = u.stats;
  const p = game.players[u.owner];
  const atk = { attack: s.attack, attackType: s.attackType, bonus: s.bonus };
  if (s.range > 0 && u.def.projectile) {
    const y = unitCenterY(game, u) + 0.2;
    launchProjectile(game, { x: u.x, z: u.z, y, owner: u.owner, id: u.id }, t, atk, u.def.projectile, u.def.projectileSpeed ?? 7, s.accuracy, {
      splash: s.splash, friendlyFire: u.def.friendlyFire, passThrough: u.def.passThrough, lead: p.hasFlag('ballistics'),
    });
    return;
  }
  const dmg = computeDamage(atk, t, elevationMult(game, u.x, u.z, t.x, t.z));
  dealDamage(game, t, dmg, u.owner, u);
  game.events.push({ e: 'hit', x: t.x, z: t.z, kind: t.kind === 'building' ? 'building' : 'melee', owner: u.owner });
  if (u.def.trample && t.kind === 'unit') {
    const tr = dmg * u.def.trample;
    game.spatial.query(t.x, t.z, 0.9, (v) => {
      if (v === t || !v.alive || !game.isEnemy(u.owner, v.owner)) return;
      dealDamage(game, v, Math.max(1, tr), u.owner, u);
    });
  }
}

function targetLost(game: Game, u: Unit, noRescan = false): void {
  u.attackWindup = -1;
  // villagers go back to work after fending off animals
  if (u.def.gatherer && u.prevOrder && u.orderQueue.length === 0) {
    const po = u.prevOrder;
    u.prevOrder = null;
    u.order = po;
    resetNav(u);
    return;
  }
  if (!noRescan && isMilitary(u) && u.stance !== 'passive' && u.orderQueue.length === 0) {
    const r = u.stance === 'standGround' ? Math.max(1, u.stats.range + u.radius + 0.3) : u.stats.los;
    const allowB = !!(u.engagedFrom && u.engagedFrom.t === 'move' && u.engagedFrom.attackMove);
    const nt = findEnemyTarget(game, u, r, allowB);
    if (nt) {
      u.order = { t: 'attack', target: nt.id };
      resetNav(u);
      return;
    }
  }
  if (u.def.animal) {
    u.order = { t: 'idle' };
    return;
  }
  finishOrder(game, u);
}

function doAttackGround(game: Game, u: Unit, o: Extract<Order, { t: 'attackGround' }>, dt: number): void {
  const d = Math.hypot(o.x - u.x, o.z - u.z);
  if (d > u.stats.range) {
    const s = navigate(game, u, o.x, o.z, u.stats.range - 0.1, null, dt);
    if (s === 'failed') finishOrder(game, u);
    return;
  }
  halt(u);
  faceTo(u, o.x, o.z);
  if (u.def.packs && u.packed) {
    u.packTimer = 3.5;
    u.setAnim('unpack', game.time);
    return;
  }
  if (u.attackWindup < 0) {
    if (u.cooldown > 0) return;
    u.attackWindup = u.def.attackDelay ?? 0.5;
    u.anim = 'attack';
    u.animStart = game.time;
  }
  u.attackWindup -= dt;
  if (u.attackWindup <= 0) {
    u.attackWindup = -1;
    u.cooldown = u.stats.reload;
    const s = u.stats;
    launchAtPoint(game, { x: u.x, z: u.z, y: unitCenterY(game, u) + 0.3, owner: u.owner, id: u.id }, o.x, o.z,
      { attack: s.attack, attackType: s.attackType, bonus: s.bonus }, u.def.projectile ?? 'stone', u.def.projectileSpeed ?? 6,
      Math.max(0.6, s.splash));
  }
}

/* ====================================================================== */
/* Economy                                                                  */
/* ====================================================================== */

export function toolFor(kind: GatherKind | null): WorkTool {
  switch (kind) {
    case 'wood': return 'axe';
    case 'gold':
    case 'stone': return 'pick';
    case 'farm': return 'hoe';
    case 'forage': return 'basket';
    case 'hunt':
    case 'herd': return 'spear';
    case 'fish': return 'rod';
    default: return null;
  }
}

function deposit(game: Game, u: Unit): void {
  if (u.carryAmount > 0 && u.carryType) {
    const p = game.players[u.owner];
    p.res[u.carryType] += u.carryAmount;
    p.stats.gathered[u.carryType] += u.carryAmount;
  }
  u.carryAmount = 0;
  u.carryType = null;
}

/** Walk to the nearest drop-off; returns true when deposited. */
function returnResources(game: Game, u: Unit, dt: number): boolean {
  if (!u.carryType || u.carryAmount <= 0) {
    u.returning = false;
    return true;
  }
  let b = game.building(u.dropId);
  if (!b || !b.alive || !b.built || !b.def.dropoff?.includes(u.carryType)) {
    b = game.nearestDropoff(u.owner, u.carryType, u.x, u.z) ?? undefined;
    u.dropId = b ? b.id : 0;
    resetNav(u);
  }
  if (!b) {
    halt(u);
    u.setAnim('idle', game.time);
    return false;
  }
  const s = navigate(game, u, b.x, b.z, u.radius + 0.25, rectOf(b), dt);
  if (s === 'arrived') {
    deposit(game, u);
    u.returning = false;
    u.dropId = 0;
    u.farmMoveAt = -1;
    resetNav(u);
    return true;
  }
  if (s === 'failed') {
    u.dropId = 0;
    resetNav(u);
    u.repathAt = game.time + 1;
  }
  return false;
}

function findNextResource(game: Game, u: Unit, kind: GatherKind, x: number, z: number, exclude: number): ResourceNode | Unit | Building | null {
  if (kind === 'farm') {
    let best: Building | null = null;
    let bd = 12;
    for (const b of game.buildings) {
      if (!b.alive || b.owner !== u.owner || !b.def.foodCapacity) continue;
      if (b.farmer && b.farmer !== u.id) {
        const f = game.unit(b.farmer);
        if (f && f.alive && f.order.t === 'gather' && f.order.target === b.id) continue;
      }
      const d = Math.hypot(b.x - x, b.z - z);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }
  const r = game.findResource(kind, x, z, kind === 'wood' ? 12 : 9, exclude);
  if (r) return r;
  if (kind === 'herd') {
    let best: Unit | null = null;
    let bd = 12;
    for (const s of game.units) {
      if (!s.alive || !s.def.herdable || (s.owner !== u.owner && s.owner !== 0)) continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }
  return null;
}

function doGather(game: Game, u: Unit, o: Extract<Order, { t: 'gather' }>, dt: number): void {
  const p = game.players[u.owner];
  if (u.returning) {
    if (returnResources(game, u, dt)) {
      // continue to resource
      const t = game.get(o.target);
      if (!t || !t.alive) {
        const c = game.carcassOf.get(o.target);
        if (c && game.get(c)) o.target = c;
      }
    }
    return;
  }
  let t = game.get(o.target);
  if (!t || !t.alive) {
    const c = game.carcassOf.get(o.target);
    const ce = c ? game.get(c) : undefined;
    if (ce && ce.alive) {
      o.target = ce.id;
      t = ce;
    } else {
      const kind = u.lastGatherKind ?? u.gatherKind;
      const next = kind ? findNextResource(game, u, kind, u.lastGatherX || u.x, u.lastGatherZ || u.z, o.target) : null;
      if (next) {
        o.target = next.id;
        resetNav(u);
        return;
      }
      if (u.carryAmount > 0) {
        u.returning = true;
        o.target = 0;
        return;
      }
      finishOrder(game, u);
      return;
    }
  }

  // Hunting / herding live animals
  if (t.kind === 'unit') {
    if (!t.def.animal) {
      finishOrder(game, u);
      return;
    }
    hunt(game, u, t, dt);
    return;
  }

  let kind: GatherKind;
  let amountLeft: number;
  let rect: Rect | null;
  let gx: number, gz: number, range: number;
  if (t.kind === 'building') {
    if (!t.def.foodCapacity || t.owner !== u.owner) {
      finishOrder(game, u);
      return;
    }
    if (!t.built) {
      u.prevOrder = { t: 'gather', target: t.id };
      u.order = { t: 'build', target: t.id };
      resetNav(u);
      return;
    }
    if (t.farmer && t.farmer !== u.id) {
      const f = game.unit(t.farmer);
      if (f && f.alive && f.order.t === 'gather' && f.order.target === t.id) {
        const next = findNextResource(game, u, 'farm', t.x, t.z, t.id);
        if (next && next.id !== t.id) {
          o.target = next.id;
          resetNav(u);
        } else finishOrder(game, u);
        return;
      }
    }
    t.farmer = u.id;
    kind = 'farm';
    amountLeft = t.food;
    if (u.farmSpotX < t.tx || u.farmSpotX > t.tx + t.w || u.farmSpotZ < t.tz || u.farmSpotZ > t.tz + t.h || u.farmMoveAt < 0) {
      // work the part of the field closest to the drop-off
      const drop = game.nearestDropoff(u.owner, 'food', t.x, t.z);
      const ax = drop ? drop.x : t.x, az = drop ? drop.z : t.z;
      u.farmSpotX = clamp(ax, t.tx + 0.6, t.tx + t.w - 0.6) + (game.rng.next() - 0.5) * 0.6;
      u.farmSpotZ = clamp(az, t.tz + 0.6, t.tz + t.h - 0.6) + (game.rng.next() - 0.5) * 0.6;
      u.farmMoveAt = 0;
    }
    rect = null;
    gx = u.farmSpotX;
    gz = u.farmSpotZ;
    range = 0.25;
  } else {
    if (t.type === 'relic') {
      finishOrder(game, u);
      return;
    }
    kind = t.gather;
    amountLeft = t.amount;
    rect = rectOfRes(t);
    gx = t.x;
    gz = t.z;
    range = rect ? u.radius + 0.12 : u.radius + 0.35;
  }

  const res = GATHER_RES[kind];
  if (u.carryType && u.carryType !== res) {
    u.carryAmount = 0;
    u.carryType = null;
  }
  u.gatherKind = kind;
  u.lastGatherKind = kind;
  u.lastGatherId = t.id;
  u.lastGatherX = t.x;
  u.lastGatherZ = t.z;
  u.tool = toolFor(kind);
  const cap = p.carryCapacity(kind);
  if (u.carryAmount >= cap - 1e-6) {
    u.returning = true;
    u.dropId = 0;
    resetNav(u);
    return;
  }
  const nav = navigate(game, u, gx, gz, range, rect, dt);
  if (nav === 'moving') return;
  if (nav === 'failed') {
    const next = findNextResource(game, u, kind, t.x, t.z, t.id);
    if (next && next.id !== t.id) {
      o.target = next.id;
      resetNav(u);
    } else if (u.carryAmount > 0) {
      u.returning = true;
    } else finishOrder(game, u);
    return;
  }
  // Working
  faceTo(u, t.kind === 'building' ? u.x + Math.sin(u.facing) : t.x, t.kind === 'building' ? u.z + Math.cos(u.facing) : t.z);
  if (u.anim !== 'work') u.setAnim('work', game.time);
  const rate = GATHER_RATES[kind] * p.gatherMult[kind];
  let amt = rate * dt;
  amt = Math.min(amt, cap - u.carryAmount, Math.max(0, amountLeft));
  u.carryAmount += amt;
  u.carryType = res;
  if (t.kind === 'building') {
    t.food -= amt;
    if (t.food <= 0.001) farmExhausted(game, t, u);
  } else {
    if (t.gatherTick !== game.tickCount) {
      t.gatherers = t.gatherTick === game.tickCount - 1 ? t.gatherCount : 0;
      t.gatherTick = game.tickCount;
      t.gatherCount = 0;
    }
    t.gatherCount++;
    if (t.type === 'tree' && !t.felled) {
      t.felled = true;
      t.fellAngle = Math.atan2(t.x - u.x, t.z - u.z);
      game.events.push({ e: 'fell', id: t.id });
    }
    t.amount -= amt;
    if (t.amount <= 0.001) game.removeResource(t);
  }
  if (u.carryAmount >= cap - 1e-6) {
    u.returning = true;
    u.dropId = 0;
    resetNav(u);
  }
}

function farmExhausted(game: Game, farm: Building, u: Unit): void {
  const p = game.players[farm.owner];
  const cost = p.buildingCost('farm');
  if (p.pay(cost)) {
    farm.food = (farm.def.foodCapacity ?? 175) + p.farmFood;
    game.msg(farm.owner, 'Farm reseeded', 'info');
  } else {
    game.msg(farm.owner, 'A farm has been exhausted and you cannot afford to reseed it', 'error');
    game.destroyBuilding(farm, 0);
    if (u.carryAmount > 0) u.returning = true;
  }
}

function hunt(game: Game, u: Unit, animal: Unit, dt: number): void {
  const p = game.players[u.owner];
  if (u.carryType && u.carryType !== 'food') {
    u.carryAmount = 0;
    u.carryType = null;
  }
  const kind: GatherKind = animal.def.herdable ? 'herd' : 'hunt';
  u.gatherKind = kind;
  u.lastGatherKind = kind;
  u.lastGatherX = animal.x;
  u.lastGatherZ = animal.z;
  u.tool = 'spear';
  if (u.carryAmount >= p.carryCapacity(kind) - 1e-6) {
    u.returning = true;
    return;
  }
  const ranged = !animal.def.herdable;
  const range = ranged ? 2.8 : MELEE_REACH;
  const d = Math.hypot(animal.x - u.x, animal.z - u.z) - u.radius - animal.radius;
  if (d > range) {
    u.attackWindup = -1;
    const nav = navigate(game, u, animal.x, animal.z, range + u.radius + animal.radius - 0.02, null, dt);
    if (nav === 'failed') finishOrder(game, u);
    return;
  }
  halt(u);
  faceTo(u, animal.x, animal.z);
  if (u.attackWindup < 0) {
    if (u.cooldown > 0) return;
    u.attackWindup = 0.45;
    u.anim = 'attack';
    u.animStart = game.time;
  }
  u.attackWindup -= dt;
  if (u.attackWindup <= 0) {
    u.attackWindup = -1;
    u.cooldown = 1.5;
    const atk = { attack: u.stats.attack + 1, attackType: 'melee' as const, bonus: undefined };
    if (ranged) {
      launchProjectile(game, { x: u.x, z: u.z, y: unitCenterY(game, u) + 0.2, owner: u.owner, id: u.id }, animal, { ...atk, attackType: 'pierce' }, 'javelin', 7, 1);
    } else {
      dealDamage(game, animal, computeDamage(atk, animal), u.owner, u);
    }
  }
}

function doDropoffOrder(game: Game, u: Unit, o: Extract<Order, { t: 'dropoff' }>, dt: number): void {
  const b = game.building(o.target);
  if (!b || !b.alive || !u.carryType || !b.def.dropoff?.includes(u.carryType)) {
    finishOrder(game, u);
    return;
  }
  const s = navigate(game, u, b.x, b.z, u.radius + 0.25, rectOf(b), dt);
  if (s === 'arrived') {
    deposit(game, u);
    const last = u.lastGatherId && game.get(u.lastGatherId);
    if (last && last.alive && u.orderQueue.length === 0) {
      u.order = { t: 'gather', target: u.lastGatherId };
      resetNav(u);
    } else finishOrder(game, u);
  } else if (s === 'failed') finishOrder(game, u);
}

/* ====================================================================== */
/* Construction                                                             */
/* ====================================================================== */

function doBuild(game: Game, u: Unit, o: Extract<Order, { t: 'build' }>, dt: number): void {
  const b = game.building(o.target);
  if (!b || !b.alive || !game.isAlly(u.owner, b.owner)) {
    afterBuild(game, u, null);
    return;
  }
  if (b.built) {
    afterBuild(game, u, b);
    return;
  }
  const s = navigate(game, u, b.x, b.z, u.radius + 0.22, rectOf(b), dt);
  if (s === 'moving') return;
  if (s === 'failed') {
    finishOrder(game, u);
    return;
  }
  faceTo(u, b.x, b.z);
  u.tool = 'hammer';
  if (u.anim !== 'work') u.setAnim('work', game.time);
  b.builders++;
  const p = game.players[u.owner];
  const n = Math.max(1, b.buildersPrev);
  const total = (n + 2) / 3 / b.stats.buildTime;
  const inc = (total / n) * p.buildRate * dt;
  b.progress = Math.min(1, b.progress + inc);
  b.hp = Math.min(b.stats.hp, b.hp + b.stats.hp * inc);
  if (b.progress >= 1) {
    finishConstruction(game, b);
    afterBuild(game, u, b);
  }
}

function afterBuild(game: Game, u: Unit, b: Building | null): void {
  resetNav(u);
  if (u.orderQueue.length) {
    u.order = u.orderQueue.shift()!;
    return;
  }
  if (b && b.alive) {
    // continue on adjacent wall foundations
    if (b.def.wall || b.def.gate) {
      let best: Building | null = null;
      let bd = 4.5;
      for (const o of game.buildings) {
        if (!o.alive || o.built || o.owner !== u.owner || !(o.def.wall || o.def.gate)) continue;
        const d = Math.hypot(o.x - u.x, o.z - u.z);
        if (d < bd) {
          bd = d;
          best = o;
        }
      }
      if (best) {
        u.order = { t: 'build', target: best.id };
        return;
      }
    }
    if (b.def.foodCapacity) {
      if (!b.farmer) {
        u.order = { t: 'gather', target: b.id };
        u.prevOrder = null;
        return;
      }
    }
    const drop = b.def.dropoff;
    if (drop && b.type !== 'townCenter') {
      let kinds: GatherKind[] = [];
      if (b.type === 'lumberCamp') kinds = ['wood'];
      else if (b.type === 'miningCamp') kinds = ['gold', 'stone'];
      else if (b.type === 'mill') kinds = ['forage', 'farm'];
      let best: ResourceNode | Building | Unit | null = null;
      let bd = Infinity;
      for (const k of kinds) {
        const r = findNextResource(game, u, k, b.x, b.z, 0);
        if (!r) continue;
        const d = Math.hypot(r.x - b.x, r.z - b.z);
        if (d < bd && d < 10) {
          bd = d;
          best = r;
        }
      }
      if (best) {
        u.order = { t: 'gather', target: best.id };
        u.prevOrder = null;
        return;
      }
    }
  }
  if (u.prevOrder) {
    const po = u.prevOrder;
    u.prevOrder = null;
    const tt = 'target' in po ? game.get(po.target) : undefined;
    if (po.t !== 'gather' || (tt && tt.alive)) {
      u.order = po;
      return;
    }
    if (po.t === 'gather' && u.lastGatherKind) {
      const next = findNextResource(game, u, u.lastGatherKind, u.lastGatherX, u.lastGatherZ, 0);
      if (next) {
        u.order = { t: 'gather', target: next.id };
        return;
      }
    }
  }
  u.order = { t: 'idle' };
}

function doRepair(game: Game, u: Unit, o: Extract<Order, { t: 'repair' }>, dt: number): void {
  const t = game.get(o.target);
  if (!t || !t.alive || t.kind === 'resource' || !game.isAlly(u.owner, t.owner)) {
    finishOrder(game, u);
    return;
  }
  if (t.kind === 'building' && !t.built) {
    u.order = { t: 'build', target: t.id };
    return;
  }
  const max = t.kind === 'building' ? t.stats.hp : t.stats.hp;
  if (t.hp >= max) {
    finishOrder(game, u);
    return;
  }
  const s = t.kind === 'building'
    ? navigate(game, u, t.x, t.z, u.radius + 0.22, rectOf(t), dt)
    : navigate(game, u, t.x, t.z, u.radius + t.radius + 0.15, null, dt);
  if (s === 'moving') return;
  if (s === 'failed') {
    finishOrder(game, u);
    return;
  }
  faceTo(u, t.x, t.z);
  u.tool = 'hammer';
  if (u.anim !== 'work') u.setAnim('work', game.time);
  const p = game.players[u.owner];
  const rate = (t.kind === 'building' ? 7.5 : 2.5) * p.buildRate;
  const hpGain = Math.min(rate * dt, max - t.hp);
  // repair costs half the build cost in proportion to HP restored
  const cost = t.kind === 'building' ? t.stats.cost : t.stats.cost;
  const frac = (hpGain / max) * 0.5;
  const need: Partial<Record<'food' | 'wood' | 'gold' | 'stone', number>> = {};
  for (const k of ['wood', 'stone'] as const) if (cost[k]) need[k] = (cost[k] ?? 0) * frac;
  if (!p.canAfford(need)) {
    game.msg(u.owner, 'Not enough resources to repair', 'error');
    finishOrder(game, u);
    return;
  }
  for (const k in need) p.res[k as 'wood'] -= need[k as 'wood'] ?? 0;
  t.hp += hpGain;
}

/* ====================================================================== */
/* Garrison                                                                 */
/* ====================================================================== */

export function canGarrisonIn(game: Game, u: Unit, b: Building): boolean {
  if (!b.built || !b.def.garrison || b.owner !== u.owner) return false;
  if (u.def.noGarrison || u.def.animal) return false;
  if (b.garrison.length >= b.def.garrison) return false;
  if (b.type === 'monastery') return !!u.def.monk;
  if (b.type === 'castle') return true;
  return !u.def.classes.includes('cavalry') && !u.def.classes.includes('siege');
}

function doGarrison(game: Game, u: Unit, o: Extract<Order, { t: 'garrison' }>, dt: number): void {
  const t = game.get(o.target);
  if (!t || !t.alive) {
    finishOrder(game, u);
    return;
  }
  if (t.kind === 'unit') {
    // rams carry infantry
    const cap = t.def.garrisonCapacity ?? 0;
    if (t.owner !== u.owner || !u.def.classes.includes('infantry') || t.cargo.length >= cap) {
      finishOrder(game, u);
      return;
    }
    const s = navigate(game, u, t.x, t.z, u.radius + t.radius + 0.2, null, dt);
    if (s === 'arrived') {
      u.garrisonedIn = t.id;
      t.cargo.push(u.id);
      halt(u);
      u.order = { t: 'idle' };
    } else if (s === 'failed') finishOrder(game, u);
    return;
  }
  if (t.kind !== 'building') {
    finishOrder(game, u);
    return;
  }
  if (!canGarrisonIn(game, u, t)) {
    // monks can still drop relics at a full monastery
    if (!(u.relicId && t.type === 'monastery' && t.owner === u.owner)) {
      finishOrder(game, u);
      return;
    }
  }
  const s = navigate(game, u, t.x, t.z, u.radius + 0.3, rectOf(t), dt);
  if (s === 'arrived') {
    if (u.relicId && t.type === 'monastery') {
      const r = game.get(u.relicId);
      if (r && r.kind === 'resource') {
        r.heldBy = t.id;
        t.relics.push(r.id);
      }
      u.relicId = 0;
    }
    if (canGarrisonIn(game, u, t)) {
      u.garrisonedIn = t.id;
      t.garrison.push(u.id);
      u.order = { t: 'idle' };
      u.orderQueue = [];
      halt(u);
    } else finishOrder(game, u);
  } else if (s === 'failed') finishOrder(game, u);
}

export function ungarrison(game: Game, b: Building, onlyId = 0): void {
  const keep: number[] = [];
  let i = 0;
  for (const id of b.garrison) {
    if (onlyId && id !== onlyId) {
      keep.push(id);
      continue;
    }
    const u = game.unit(id);
    if (!u) continue;
    u.garrisonedIn = 0;
    const tx = b.rally ? b.rally.x : b.x;
    const tz = b.rally ? b.rally.z : b.z + b.h;
    // spawn at the edge of the building nearest the rally point
    const ex = clamp(tx, b.tx - 0.6, b.tx + b.w + 0.6);
    const ez = clamp(tz, b.tz - 0.6, b.tz + b.h + 0.6);
    const p = game.pathfinder.nearestPassable(ex + ((i % 3) - 1) * 0.4, ez + (Math.floor(i / 3) % 3 - 1) * 0.4, game.teamOf[u.owner], 8);
    i++;
    if (p) {
      u.x = u.px = p.x;
      u.z = u.pz = p.z;
    }
    u.order = { t: 'idle' };
    resetNav(u);
    if (b.rally) {
      const rt = b.rally.target ? game.get(b.rally.target) : undefined;
      if (rt && rt.alive && u.def.gatherer && (rt.kind === 'resource' || (rt.kind === 'building' && rt.def.foodCapacity))) {
        u.order = { t: 'gather', target: rt.id };
      } else u.order = { t: 'move', x: b.rally.x, z: b.rally.z };
    } else if (u.def.gatherer && u.lastGatherId && game.get(u.lastGatherId)?.alive) {
      u.order = { t: 'gather', target: u.lastGatherId };
    }
  }
  b.garrison = keep;
}

export function unloadCargo(game: Game, carrier: Unit): void {
  let i = 0;
  for (const id of carrier.cargo) {
    const u = game.unit(id);
    if (!u) continue;
    u.garrisonedIn = 0;
    const a = (i++ / Math.max(1, carrier.cargo.length)) * Math.PI * 2;
    const p = game.pathfinder.nearestPassable(carrier.x + Math.cos(a) * 0.7, carrier.z + Math.sin(a) * 0.7, game.teamOf[u.owner], 6);
    if (p) {
      u.x = u.px = p.x;
      u.z = u.pz = p.z;
    }
    u.order = { t: 'idle' };
  }
  carrier.cargo = [];
}

/* ====================================================================== */
/* Monks                                                                    */
/* ====================================================================== */

function findHealTarget(game: Game, u: Unit, r: number): Unit | null {
  return game.spatial.best(u.x, u.z, r, (v, d2) => {
    if (v === u || !v.alive || !game.isAlly(u.owner, v.owner) || v.def.animal) return -1;
    if (v.hp >= v.stats.hp - 0.5 || v.def.classes.includes('siege')) return -1;
    return d2;
  });
}

function doHeal(game: Game, u: Unit, o: Extract<Order, { t: 'heal' }>, dt: number): void {
  const t = game.unit(o.target);
  if (!t || !t.alive || t.garrisonedIn || t.hp >= t.stats.hp || !game.isAlly(u.owner, t.owner)) {
    const next = findHealTarget(game, u, u.stats.los);
    if (next && u.orderQueue.length === 0) {
      o.target = next.id;
      resetNav(u);
    } else finishOrder(game, u);
    return;
  }
  const range = 4;
  const d = Math.hypot(t.x - u.x, t.z - u.z) - u.radius - t.radius;
  if (d > range) {
    const s = navigate(game, u, t.x, t.z, range + u.radius + t.radius - 0.1, null, dt);
    if (s === 'failed') finishOrder(game, u);
    return;
  }
  halt(u);
  faceTo(u, t.x, t.z);
  if (u.anim !== 'work') u.setAnim('work', game.time);
  t.hp = Math.min(t.stats.hp, t.hp + u.stats.healRate * dt);
}

function convertible(game: Game, u: Unit, t: Unit): boolean {
  const p = game.players[u.owner];
  if (t.def.monk && !p.hasFlag('atonement')) return false;
  if (t.def.classes.includes('siege') && !p.hasFlag('redemption')) return false;
  if (t.def.animal) return false;
  return true;
}

function doConvert(game: Game, u: Unit, o: Extract<Order, { t: 'convert' }>, dt: number): void {
  const t = game.unit(o.target);
  if (!t || !t.alive || t.garrisonedIn || !game.isEnemy(u.owner, t.owner)) {
    finishOrder(game, u);
    return;
  }
  if (!convertible(game, u, t)) {
    game.msg(u.owner, t.def.monk ? 'Research Atonement to convert priests' : 'Research Redemption to convert siege weapons', 'error');
    finishOrder(game, u);
    return;
  }
  if (u.relicId) {
    finishOrder(game, u);
    return;
  }
  const range = u.stats.range;
  const d = Math.hypot(t.x - u.x, t.z - u.z) - u.radius - t.radius;
  if (d > range) {
    u.convertTime = 0;
    const s = navigate(game, u, t.x, t.z, range + u.radius + t.radius - 0.2, null, dt);
    if (s === 'failed') finishOrder(game, u);
    return;
  }
  halt(u);
  faceTo(u, t.x, t.z);
  if (u.faith < 100) {
    u.setAnim('idle', game.time);
    return;
  }
  if (u.anim !== 'work') u.setAnim('work', game.time);
  if (u.convertTime === 0) {
    const faith = game.players[t.owner].hasFlag('faith') ? 1.5 : 1;
    // AoE-style: at least 4s, usually 4-10s
    u.convertNeed = (4 + game.rng.next() * 6) * faith;
  }
  u.convertTime += dt;
  if (u.convertTime >= u.convertNeed) {
    const from = t.owner;
    game.convertUnit(t, u.owner);
    game.events.push({ e: 'convert', id: t.id, from, to: u.owner, x: t.x, z: t.z });
    u.faith = 0;
    u.convertTime = 0;
    finishOrder(game, u);
  }
}

function doRelic(game: Game, u: Unit, o: Extract<Order, { t: 'relic' }>, dt: number): void {
  const r = game.get(o.target);
  if (!r || r.kind !== 'resource' || r.type !== 'relic' || r.heldBy || u.relicId) {
    finishOrder(game, u);
    return;
  }
  const s = navigate(game, u, r.x, r.z, 0.4, null, dt);
  if (s === 'arrived') {
    r.heldBy = u.id;
    u.relicId = r.id;
    game.msg(u.owner, 'Your priest has picked up a relic. Bring it to a Temple.', 'info');
    finishOrder(game, u);
  } else if (s === 'failed') finishOrder(game, u);
}

/* ====================================================================== */
/* Trade                                                                    */
/* ====================================================================== */

function doTrade(game: Game, u: Unit, o: Extract<Order, { t: 'trade' }>, dt: number): void {
  const dest = game.building(o.target);
  let home = game.building(u.tradeHome);
  if (!home || !home.alive || home.type !== 'market') {
    let best: Building | null = null;
    let bd = Infinity;
    for (const b of game.buildings) {
      if (!b.alive || !b.built || b.type !== 'market' || b.owner !== u.owner || b === dest) continue;
      const d = Math.hypot(b.x - u.x, b.z - u.z);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    home = best ?? undefined;
    u.tradeHome = home ? home.id : 0;
  }
  if (!dest || !dest.alive || !dest.built || !home || dest.type !== 'market' || !game.isAlly(u.owner, dest.owner)) {
    finishOrder(game, u);
    return;
  }
  const goingOut = u.tradeGold <= 0;
  const b = goingOut ? dest : home;
  const s = navigate(game, u, b.x, b.z, u.radius + 0.3, rectOf(b), dt);
  if (s === 'arrived') {
    if (goingOut) {
      const d = Math.hypot(dest.x - home.x, dest.z - home.z);
      const n = game.map.n;
      let gold = 0.95 * d * (d / n + 0.3);
      const p = game.players[u.owner];
      if (p.hasFlag('coinage')) gold *= 1.2;
      if (p.hasFlag('silkRoad')) gold *= 1.25;
      if (p.civ.id === 'carthaginians' || game.players.some((q) => q.civ.id === 'carthaginians' && game.isAlly(q.id, u.owner))) gold *= 1.1;
      u.tradeGold = Math.max(1, gold);
    } else {
      const p = game.players[u.owner];
      p.res.gold += u.tradeGold;
      p.stats.gathered.gold += u.tradeGold;
      u.tradeGold = 0;
    }
    resetNav(u);
  } else if (s === 'failed') finishOrder(game, u);
}

/* ====================================================================== */
/* Animals                                                                  */
/* ====================================================================== */

function animalIdle(game: Game, u: Unit, dt: number): void {
  const a = u.def.animal;
  if (a === 'wolf' && game.time >= u.scanAt) {
    u.scanAt = game.time + 0.6;
    const t = game.spatial.best(u.x, u.z, 5, (v, d2) => {
      if (!v.alive || v.def.animal || v.owner === 0 || v.def.classes.includes('siege')) return -1;
      return d2 + (v.def.gatherer ? -2 : 0);
    });
    if (t) {
      u.order = { t: 'attack', target: t.id };
      resetNav(u);
      return;
    }
  }
  if (game.time >= u.wanderAt) {
    u.wanderAt = game.time + 6 + game.rng.next() * 10;
    if (a === 'sheep' && u.owner !== 0) return;
    if (a === 'boar' && game.rng.next() < 0.6) return;
    const r = a === 'wolf' ? 3 : a === 'deer' ? 2 : 1;
    const nx = u.homeX + game.rng.range(-r, r), nz = u.homeZ + game.rng.range(-r, r);
    if (game.pathfinder.isPassable(nx, nz, 0)) {
      u.order = { t: 'move', x: nx, z: nz };
      resetNav(u);
    }
  }
}

/* ====================================================================== */
/* Collisions                                                               */
/* ====================================================================== */

function mass(u: Unit): number {
  let m = 1;
  const c = u.def.classes;
  if (c.includes('siege') || c.includes('elephant')) m = 5;
  else if (c.includes('mounted')) m = 2;
  if (u.moving) m *= 0.6;
  else if (u.anim === 'work' || u.anim === 'attack' || u.order.t === 'attack') m *= 3;
  else if (u.order.t === 'idle') m *= 0.5;
  return m;
}

export function resolveCollisions(game: Game): void {
  const pf = game.pathfinder;
  for (const u of game.units) {
    if (!u.alive || u.garrisonedIn) continue;
    // farmers and builders overlap freely on fields
    let px = 0, pz = 0;
    const r = u.radius;
    const mu = mass(u);
    game.spatial.query(u.x, u.z, r + 0.6, (v, d2) => {
      if (v === u || !v.alive || v.garrisonedIn) return;
      const rr = (r + v.radius) * 0.9;
      if (d2 >= rr * rr) return;
      let d = Math.sqrt(d2);
      let nx: number, nz: number;
      if (d < 1e-4) {
        const a = ((u.id * 7919) % 628) / 100;
        nx = Math.cos(a);
        nz = Math.sin(a);
        d = 0;
      } else {
        nx = (u.x - v.x) / d;
        nz = (u.z - v.z) / d;
      }
      const overlap = rr - d;
      const mv = mass(v);
      const share = mv / (mu + mv);
      px += nx * overlap * share;
      pz += nz * overlap * share;
    });
    const pl = Math.hypot(px, pz);
    if (pl < 1e-5) continue;
    const maxPush = 0.05;
    if (pl > maxPush) {
      px *= maxPush / pl;
      pz *= maxPush / pl;
    }
    const team = game.teamOf[u.owner];
    const nx = u.x + px, nz = u.z + pz;
    if (pf.isPassable(nx, nz, team)) {
      u.x = nx;
      u.z = nz;
    } else if (pf.isPassable(nx, u.z, team)) u.x = nx;
    else if (pf.isPassable(u.x, nz, team)) u.z = nz;
  }
  // keep inside the map
  const n = game.map.n;
  for (const u of game.units) {
    if (u.x < 0.2) u.x = 0.2;
    if (u.z < 0.2) u.z = 0.2;
    if (u.x > n - 0.2) u.x = n - 0.2;
    if (u.z > n - 0.2) u.z = n - 0.2;
  }
}
