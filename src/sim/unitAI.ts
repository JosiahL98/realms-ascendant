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

/** The unit an order is aimed at (it is not steered round: it is where the unit is going). */
function orderTarget(u: Unit): number {
  const o = u.order as { target?: number };
  return o.target ?? 0;
}

/**
 * Steering round other units: a unit about to walk into another bears off to the side it can pass on, harder the
 * closer it is. Units standing still (working, fighting, waiting) are walked round; one coming the other way is passed
 * on the right (both bear right, so they miss); one walking the same way is followed rather than shoved.
 * Returns the new heading (a unit vector).
 */
function steer(game: Game, u: Unit, dx: number, dz: number): [number, number] {
  const r = u.radius;
  const lx = -dz, lz = dx;   // the unit's left
  const naval = !!u.def.naval;
  const target = orderTarget(u);
  let ax = 0, az = 0;
  game.spatial.query(u.x, u.z, r + 1.4, (v) => {
    if (v === u || !v.alive || v.garrisonedIn || !!v.def.naval !== naval || v.id === target) return;
    const rx = v.x - u.x, rz = v.z - u.z;
    const rr = r + v.radius;
    const along = rx * dx + rz * dz;
    if (along < -0.05 || along > rr + 0.7) return;
    const lat = rx * lx + rz * lz;
    if (Math.abs(lat) >= rr * 0.98) return;
    let side = lat > 0 ? -1 : 1;   // it is on the left: bear right, and the other way round
    if (v.moving) {
      const same = Math.sin(v.facing) * dx + Math.cos(v.facing) * dz;
      if (same > 0.5) return;       // walking the same way: follow
      if (same < -0.5) side = -1;   // coming the other way: keep right
    } else if (Math.abs(lat) < 0.08) {
      side = u.id % 2 === 1 ? 1 : -1;   // standing dead ahead: either side
    }
    const near = 1 - Math.max(0, along - rr * 0.5) / (rr * 0.5 + 0.7);
    const w = (0.35 + 0.65 * near) * (1 - (Math.abs(lat) / rr) * 0.6);
    ax += lx * side * w;
    az += lz * side * w;
  });
  if (ax === 0 && az === 0) return [dx, dz];
  let nx = dx + ax * 1.4, nz = dz + az * 1.4;
  // never turn back on the path: at most a right angle
  const fwd = nx * dx + nz * dz;
  if (fwd < 0) {
    nx -= dx * fwd;
    nz -= dz * fwd;
  }
  const l = Math.hypot(nx, nz);
  return l < 1e-6 ? [dx, dz] : [nx / l, nz / l];
}

/** A walking unit turns at most so far a tick, so bearing round others does not make it twitch. */
function turnToward(from: number, to: number, max = 0.3): number {
  let d = to - from;
  d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
  return Math.abs(d) <= max ? to : from + Math.sign(d) * max;
}

/** Moves to (x, z) if the unit may stand there, or slides along whichever axis is free. False if neither. */
function moveTo(u: Unit, x: number, z: number, canStand: (x: number, z: number) => boolean): boolean {
  if (canStand(x, z)) {
    u.x = x;
    u.z = z;
    return true;
  }
  const mx = Math.abs(x - u.x), mz = Math.abs(z - u.z);
  const order = mx >= mz ? ['x', 'z'] : ['z', 'x'];
  for (const axis of order) {
    if (axis === 'x' && mx > 1e-4 && canStand(x, u.z)) {
      u.x = x;
      return true;
    }
    if (axis === 'z' && mz > 1e-4 && canStand(u.x, z)) {
      u.z = z;
      return true;
    }
  }
  return false;
}

function followPath(game: Game, u: Unit, dt: number): void {
  let step = u.stats.speed * dt;
  if (u.relicId) step *= 0.9;
  const team = game.teamOf[u.owner];
  const pf = game.pathfinder;   // (its domain, land or water, was set by navigate)
  // a unit never walks into a blocked tile (tree, mine, building, water); one already inside may walk out
  const startBlocked = !pf.isPassable(u.x, u.z, team);
  const canStand = (x: number, z: number) => startBlocked || pf.isPassable(x, z, team);
  let steered = false;
  while (step > 1e-6 && u.pathIdx * 2 < u.path.length) {
    const wx = u.path[u.pathIdx * 2], wz = u.path[u.pathIdx * 2 + 1];
    const ddx = wx - u.x, ddz = wz - u.z;
    const d = Math.hypot(ddx, ddz);
    if (d < 1e-4) {
      u.pathIdx++;
      continue;
    }
    const dx = ddx / d, dz = ddz / d;
    const len = Math.min(step, d);
    if (!steered) {
      steered = true;
      let [sx, sz] = steer(game, u, dx, dz);
      let bear = sx * dx + sz * dz < 0.999;
      if (bear && !canStand(u.x + sx * len, u.z + sz * len)) {
        // no room on that side (a tree or water beside): try the other
        const f = sx * dx + sz * dz;
        const ox = 2 * f * dx - sx, oz = 2 * f * dz - sz;
        if (canStand(u.x + ox * len, u.z + oz * len)) [sx, sz] = [ox, oz];
        else bear = false;
      }
      if (bear && moveTo(u, u.x + sx * len, u.z + sz * len, canStand)) {
        // bearing off round someone: that is this tick's move; a waypoint someone stands on counts as reached
        // once close to it (unless it is the last one)
        u.facing = turnToward(u.facing, Math.atan2(sx, sz));
        if (d < u.radius + 0.1 && u.pathIdx * 2 + 2 < u.path.length) u.pathIdx++;
        break;
      }
    }
    u.facing = turnToward(u.facing, Math.atan2(dx, dz));
    const nx = u.x + dx * len, nz = u.z + dz * len;
    if (!moveTo(u, nx, nz, canStand)) {
      // the way ahead is blocked (pushed off the path against a tree, say): plan again from here
      u.path = [];
      u.pathIdx = 0;
      u.navGoalX = NaN;
      u.repathAt = game.time;
      break;
    }
    if (u.x !== nx || u.z !== nz) break;   // slid along an obstacle: that is this tick's move
    if (d <= step) {
      u.x = wx;
      u.z = wz;
      u.pathIdx++;
    }
    step -= len;
  }
  u.moving = true;
  u.setAnim(u.carryAmount > 0 && u.def.gatherer ? 'carry' : 'walk', game.time);
}

/** Is a unit standing still (other than u) within reach of the point? */
function occupied(game: Game, u: Unit, x: number, z: number): boolean {
  let hit = false;
  const naval = !!u.def.naval;
  game.spatial.query(x, z, u.radius + 0.7, (v, d2) => {
    if (hit || v === u || !v.alive || v.garrisonedIn || v.moving || !!v.def.naval !== naval) return;
    const rr = (u.radius + v.radius) * 0.85;
    if (d2 < rr * rr) hit = true;
  });
  return hit;
}

/**
 * Where to stand to reach a rect (a tree, a mine, a building) or a point (a unit to strike) from `off` away: (bx, bz),
 * the nearest place to the unit, unless someone already stands there; then the nearest free place round the target.
 */
function standSpot(game: Game, u: Unit, bx: number, bz: number, rect: Rect | null, gx: number, gz: number, off: number, team: number): [number, number] {
  if (off <= 0 || !occupied(game, u, bx, bz)) return [bx, bz];
  const pf = game.pathfinder;
  let bestX = bx, bestZ = bz, bd = Infinity;
  const consider = (x: number, z: number) => {
    if (!pf.isPassable(x, z, team) || occupied(game, u, x, z)) return;
    const d = Math.hypot(x - u.x, z - u.z);
    if (d < bd) {
      bd = d;
      bestX = x;
      bestZ = z;
    }
  };
  if (rect) {
    const w = rect.x1 - rect.x0, h = rect.z1 - rect.z0;
    const per = 2 * (w + h);
    const n = Math.max(8, Math.ceil(per / 0.3));
    for (let k = 0; k < n; k++) {
      let s = (k / n) * per;
      if (s < w) consider(rect.x0 + s, rect.z0 - off);
      else if ((s -= w) < h) consider(rect.x1 + off, rect.z0 + s);
      else if ((s -= h) < w) consider(rect.x1 - s, rect.z1 + off);
      else consider(rect.x0 - off, rect.z1 - (s - w));
    }
    // the corners, diagonally out
    const dg = off * Math.SQRT1_2;
    consider(rect.x0 - dg, rect.z0 - dg);
    consider(rect.x1 + dg, rect.z0 - dg);
    consider(rect.x1 + dg, rect.z1 + dg);
    consider(rect.x0 - dg, rect.z1 + dg);
  } else {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      consider(gx + Math.cos(a) * off, gz + Math.sin(a) * off);
    }
  }
  return [bestX, bestZ];
}

/** Positions (flat x, z) of units standing still near u, for planning a way round them. */
function standingNear(game: Game, u: Unit, r: number): number[] {
  const out: number[] = [];
  const naval = !!u.def.naval;
  const target = orderTarget(u);
  game.spatial.query(u.x, u.z, r, (v) => {
    if (v === u || !v.alive || v.garrisonedIn || v.moving || !!v.def.naval !== naval || v.id === target) return;
    out.push(v.x, v.z);
  });
  return out;
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
  game.pathfinder.setDomain(!!u.def.naval);
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
    // someone may already stand where this unit would: find a free place round the target
    if (rect) [ax, az] = standSpot(game, u, ax, az, rect, gx, gz, Math.min(range * 0.7, 0.45), team);
    else if (range > 0.3 && d > 1e-4) [ax, az] = standSpot(game, u, ax, az, null, gx, gz, Math.min(range * 0.7, d), team);
    const aroundCrowd = game.time < u.avoidCrowdUntil;
    const direct = !aroundCrowd && d < 14 && pf.lineClear(u.x, u.z, ax, az, team, d < 2 ? 0 : 0.18);
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
      if (aroundCrowd) pf.setCrowd(standingNear(game, u, 10));
      const res = pf.findPath(u.x, u.z, goal, team);
      if (aroundCrowd) pf.clearCrowd();
      const dbg = (globalThis as unknown as { __pathStats?: Map<string, number> }).__pathStats;
      if (dbg) {
        const tgt = 'target' in u.order ? game.get((u.order as { target: number }).target) : undefined;
        const key = `${u.type}:${u.order.t}:${u.returning ? 'ret' : tgt ? (tgt.kind === 'resource' ? tgt.type : tgt.kind === 'building' ? tgt.type : tgt.type) : '-'}:${res.reached ? 'ok' : 'unreach'}`;
        dbg.set(key, (dbg.get(key) ?? 0) + 1);
      }
      if (res.reached && res.path.length === 0) res.path = [ax, az];
      else if (res.reached && (rect || range > 0.3)) {
        // A* ends on a tile centre near the goal: go on to the chosen place to stand (someone may be on the centre)
        const lx = res.path[res.path.length - 2], lz = res.path[res.path.length - 1];
        if (Math.hypot(lx - ax, lz - az) > 0.05 && pf.lineClear(lx, lz, ax, az, team, 0)) res.path.push(ax, az);
      }
      // unreachable and already standing at the closest reachable spot: give up now
      if (!res.reached) {
        const ex = res.path.length ? res.path[res.path.length - 2] : u.x, ez = res.path.length ? res.path[res.path.length - 1] : u.z;
        if (Math.hypot(ex - u.x, ez - u.z) < 0.6) {
          u.navFailed = 2;
          u.path = [];
          return 'failed';
        }
      }
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
        if (u.stuckTime >= 1) {
          // plan again, this time round the units standing in the way
          u.path = [];
          u.pathIdx = 0;
          u.navGoalX = NaN;
          u.repathAt = game.time;
          u.avoidCrowdUntil = game.time + 6;
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
  if (o.t !== 'idle') u.idleSince = -1;
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
    case 'unload':
      doUnload(game, u, o, dt);
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
  // melee units cannot reach across the shoreline
  if (u.stats.range < 1 && !!u.def.naval !== !!v.def.naval) return false;
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
  if (u.def.gatherer) {
    // the player's idle villagers and fishing ships find something to do after a moment
    if (!game.players[u.owner].isHuman) return;
    if (u.idleSince < 0) u.idleSince = game.time;
    if (game.time - u.idleSince > 2 && game.time >= u.scanAt) {
      u.scanAt = game.time + 1.2 + game.rng.next() * 0.6;
      findWork(game, u);
    }
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

/** Resource kinds an idle villager takes up on its own. Hunting and herding are left to the player. */
const AUTO_KINDS: GatherKind[] = ['forage', 'wood', 'gold', 'stone', 'farm'];

/**
 * An idle villager looks for something useful nearby: first an unfinished building of its own side, then the kind of
 * resource it last gathered, then whatever is closest.
 */
function findWork(game: Game, u: Unit): void {
  if (u.def.naval) {
    const fish = findNextResource(game, u, 'fish', u.x, u.z, 0);
    if (fish) setOrder(game, u, { t: 'gather', target: fish.id });
    return;
  }
  if (u.def.builder) {
    let site: Building | null = null;
    let sd = 8;
    for (const b of game.buildings) {
      if (!b.alive || b.built || b.owner !== u.owner) continue;
      const d = distToRect(u.x, u.z, b.tx, b.tz, b.tx + b.w, b.tz + b.h);
      if (d < sd) {
        sd = d;
        site = b;
      }
    }
    if (site) {
      setOrder(game, u, { t: 'build', target: site.id });
      return;
    }
  }
  const last = u.lastGatherKind && AUTO_KINDS.includes(u.lastGatherKind) ? u.lastGatherKind : null;
  let best: ResourceNode | Unit | Building | null = null;
  let bd = Infinity;
  for (const kind of AUTO_KINDS) {
    const r = findNextResource(game, u, kind, u.x, u.z, 0);
    if (!r) continue;
    // keep to the kind it was gathering unless something else is much closer
    const d = Math.hypot(r.x - u.x, r.z - u.z) - (kind === last ? 4 : 0);
    if (d < bd) {
      bd = d;
      best = r;
    }
  }
  if (best) setOrder(game, u, { t: 'gather', target: best.id });
}

/** Idle soldiers close to a unit under attack come to its aid, even if the fight is just beyond their own sight. */
function callForHelp(game: Game, victim: Unit, attacker: Unit): void {
  game.spatial.query(victim.x, victim.z, 6, (v) => {
    if (v === victim || !v.alive || v.owner !== victim.owner || v.order.t !== 'idle' || v.orderQueue.length) return;
    if (!isMilitary(v) || v.stance === 'passive' || v.stance === 'standGround' || !canAttackUnit(v, attacker)) return;
    if (v.stats.minRange > 0 && Math.hypot(attacker.x - v.x, attacker.z - v.z) < v.stats.minRange) return;
    engage(game, v, attacker);
  });
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
  if (!attacker.def.animal && game.isEnemy(u.owner, attacker.owner)) callForHelp(game, u, attacker);
  if (u.def.gatherer) {
    // villagers fight back against animals, and against enemies that come up close, then go back to work
    const t = u.order.t;
    const working = t === 'idle' || t === 'gather' || t === 'build' || t === 'repair' || t === 'dropoff';
    if (!working || !canAttackUnit(u, attacker)) return;
    if (t === 'gather' && u.order.target === attacker.id) return;
    if (!attacker.def.animal && edgeDist(u, attacker) > 2) return;
    u.prevOrder = t === 'idle' ? null : u.order;
    u.order = { t: 'attack', target: attacker.id };
    u.attackWindup = -1;
    resetNav(u);
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
    const cur = game.get(o.target);
    if (!cur || cur.id === attacker.id) return;
    if (cur.kind === 'building' && !o.force) {
      // switch from a building/auto target to the unit hitting us
      u.order = { t: 'attack', target: attacker.id };
      resetNav(u);
      return;
    }
    // the target is out of reach and someone is hitting us from close by: deal with them first, then carry on
    const reach = attackRange(u) + 0.3;
    if (cur.alive && cur.kind !== 'resource' && edgeDist(u, cur) > reach && edgeDist(u, attacker) <= Math.max(reach, 1.5)) {
      if (!u.engagedFrom) u.engagedFrom = o;
      u.order = { t: 'attack', target: attacker.id };
      u.attackWindup = -1;
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
  // villagers fending off an attacker do not chase it away from their work
  if (u.def.gatherer && !o.force && t.kind === 'unit' && !t.def.animal && d > 3) {
    targetLost(game, u, true);
    return;
  }
  // an enemy in the way (in contact while the target is still out of reach) is fought first
  if (d > range + 0.5 && isMilitary(u) && u.stance !== 'passive' && game.time >= u.scanAt) {
    u.scanAt = game.time + 0.3 + game.rng.next() * 0.2;
    const near = findEnemyTarget(game, u, u.radius + 1.1, false);
    if (near && near !== t && near.kind === 'unit' && edgeDist(u, near) <= Math.max(range, 0.6) + 0.3) {
      if (!u.engagedFrom) u.engagedFrom = o;
      u.order = { t: 'attack', target: near.id };
      u.attackWindup = -1;
      resetNav(u);
      return;
    }
  }
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
  if (u.def.selfDestruct) {
    // demolition ship: blast everything around the target, then sink
    const r = u.stats.splash || 2;
    game.spatial.query(t.x, t.z, r + 0.6, (v) => {
      if (!v.alive || v === u || v.garrisonedIn) return;
      if (Math.hypot(v.x - t.x, v.z - t.z) > r + v.radius) return;
      dealDamage(game, v, computeDamage(atk, v), u.owner, u);
    });
    for (const b of game.buildings) {
      if (!b.alive || b.owner === u.owner) continue;
      if (distToRect(t.x, t.z, b.tx, b.tz, b.tx + b.w, b.tz + b.h) <= r) dealDamage(game, b, computeDamage(atk, b), u.owner, u);
    }
    game.events.push({ e: 'hit', x: t.x, z: t.z, kind: 'splash', owner: u.owner });
    game.killUnit(u, 0);
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
  // a fight that got in the way of an ordered attack: go back to the ordered target
  const ef = u.engagedFrom;
  if (ef && ef.t === 'attack' && u.orderQueue.length === 0) {
    const et = game.get(ef.target);
    if (et && et.alive && et.kind !== 'resource') {
      u.order = ef;
      u.engagedFrom = null;
      resetNav(u);
      return;
    }
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
    b = game.nearestDropoff(u.owner, u.carryType, u.x, u.z, !!u.def.naval, u.badDropId) ?? undefined;
    u.dropId = b ? b.id : 0;
    resetNav(u);
  }
  if (!b) {
    halt(u);
    u.setAnim('idle', game.time);
    return false;
  }
  const s = navigate(game, u, b.x, b.z, u.radius + (u.def.naval ? 0.75 : 0.25), rectOf(b), dt);
  if (s === 'arrived') {
    deposit(game, u);
    u.returning = false;
    u.dropId = 0;
    u.badDropId = 0;
    u.farmMoveAt = -1;
    resetNav(u);
    return true;
  }
  if (s === 'failed') {
    // try a different drop-off next time
    u.badDropId = u.dropId;
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
  const body = u.def.naval ? game.map.bodyAt(u.x, u.z) : 0;
  const r = game.findResource(kind, x, z, kind === 'fish' ? (u.def.naval ? 40 : 6) : kind === 'wood' ? 12 : 9, exclude, body);
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
    if (kind === 'fish') range = u.def.naval ? u.radius + 0.5 : 1.7;
    if (u.def.fisher && kind !== 'fish') {
      finishOrder(game, u);
      return;
    }
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
  const cap = p.carryCapacity(kind) + (u.def.fisher ? 5 : 0);
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
    // rams carry infantry; transport ships carry any land unit
    const p = game.players[u.owner];
    const cap = (t.def.garrisonCapacity ?? 0) + (t.def.transport ? (p.hasFlag('careening') ? 5 : 0) + (p.hasFlag('dryDock') ? 5 : 0) : 0);
    const allowed = t.def.transport ? !u.def.naval : u.def.classes.includes('infantry');
    if (t.owner !== u.owner || !allowed || t.cargo.length >= cap) {
      finishOrder(game, u);
      return;
    }
    const reach = u.radius + t.radius + (t.def.transport ? 1.3 : 0.2);
    const dist = Math.hypot(t.x - u.x, t.z - u.z);
    if (dist <= reach) {
      u.garrisonedIn = t.id;
      t.cargo.push(u.id);
      halt(u);
      u.order = { t: 'idle' };
      return;
    }
    const s = navigate(game, u, t.x, t.z, reach - 0.05, null, dt);
    if (s === 'failed') {
      if (t.def.transport) {
        // wait at the shore for the ship
        halt(u);
        resetNav(u);
        u.repathAt = game.time + 1;
      } else finishOrder(game, u);
    }
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
  game.pathfinder.setDomain(false);
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

export function unloadCargo(game: Game, carrier: Unit, tx?: number, tz?: number): void {
  let i = 0;
  game.pathfinder.setDomain(false);
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
    u.order = tx !== undefined && tz !== undefined ? { t: 'move', x: tx + (game.rng.next() - 0.5) * 1.5, z: tz + (game.rng.next() - 0.5) * 1.5 } : { t: 'idle' };
    resetNav(u);
  }
  carrier.cargo = [];
}

/** Transport: sail toward a shore point and put the troops ashore. */
function doUnload(game: Game, u: Unit, o: Extract<Order, { t: 'unload' }>, dt: number): void {
  if (!u.cargo.length) {
    finishOrder(game, u);
    return;
  }
  // close enough to land near the target?
  game.pathfinder.setDomain(false);
  const land = game.pathfinder.nearestPassable(u.x, u.z, game.teamOf[u.owner], 2);
  const nearTarget = Math.hypot(o.x - u.x, o.z - u.z) < 4;
  if (land && (nearTarget || Math.hypot(land.x - u.x, land.z - u.z) < 1.6) && Math.hypot(o.x - u.x, o.z - u.z) < 9) {
    halt(u);
    unloadCargo(game, u, o.x, o.z);
    finishOrder(game, u);
    return;
  }
  const s = navigate(game, u, o.x, o.z, 1.2, null, dt);
  if (s !== 'moving') {
    if (land && Math.hypot(land.x - u.x, land.z - u.z) < 2.5) unloadCargo(game, u, o.x, o.z);
    finishOrder(game, u);
  }
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
  const hub = u.def.naval ? 'dock' : 'market';
  if (!home || !home.alive || home.type !== hub) {
    let best: Building | null = null;
    let bd = Infinity;
    for (const b of game.buildings) {
      if (!b.alive || !b.built || b.type !== hub || b.owner !== u.owner || b === dest) continue;
      const d = Math.hypot(b.x - u.x, b.z - u.z);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    home = best ?? undefined;
    u.tradeHome = home ? home.id : 0;
  }
  if (!dest || !dest.alive || !dest.built || !home || dest.type !== hub || !game.isAlly(u.owner, dest.owner)) {
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
    if (game.pathfinder.setDomain(false).isPassable(nx, nz, 0)) {
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
    const naval = !!u.def.naval;
    game.spatial.query(u.x, u.z, r + 0.8, (v, d2) => {
      if (v === u || !v.alive || v.garrisonedIn || !!v.def.naval !== naval) return;
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
    pf.setDomain(naval);
    const nx = u.x + px, nz = u.z + pz;
    if (pf.isPassable(nx, nz, team)) {
      u.x = nx;
      u.z = nz;
    } else if (pf.isPassable(nx, u.z, team)) u.x = nx;
    else if (pf.isPassable(u.x, nz, team)) u.z = nz;
  }
  pf.setDomain(false);
  // keep inside the map
  const n = game.map.n;
  for (const u of game.units) {
    if (u.x < 0.2) u.x = 0.2;
    if (u.z < 0.2) u.z = 0.2;
    if (u.x > n - 0.2) u.x = n - 0.2;
    if (u.z > n - 0.2) u.z = n - 0.2;
  }
}
