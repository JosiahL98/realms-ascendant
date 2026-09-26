import type { ProjectileKind } from '../data/types';
import { distToRect } from '../util/math';
import type { Building, Projectile, Unit } from './entities';
import type { Game } from './game';
import { TICK } from './game';
import { onAttacked } from './unitAI';

export interface AttackInfo {
  attack: number;
  attackType: 'melee' | 'pierce';
  bonus?: Record<string, number>;
}

export function classesOf(t: Unit | Building): string[] {
  return t.def.classes;
}

export function computeDamage(atk: AttackInfo, target: Unit | Building, elevMult = 1): number {
  const s = target.stats;
  const armor = atk.attackType === 'melee' ? s.meleeArmor : s.pierceArmor;
  let dmg = Math.max(0, atk.attack - armor);
  if (atk.bonus) {
    const cls = classesOf(target);
    for (const k in atk.bonus) if (cls.includes(k)) dmg += atk.bonus[k];
  }
  return Math.max(1, dmg * elevMult);
}

export function elevationMult(game: Game, ax: number, az: number, tx: number, tz: number): number {
  const ha = game.map.heightAt(ax, az), ht = game.map.heightAt(tx, tz);
  if (ha - ht > 0.45) return 1.25;
  if (ht - ha > 0.45) return 0.75;
  return 1;
}

/** Apply damage to a unit or building, handling death and alerts. */
export function dealDamage(game: Game, target: Unit | Building, dmg: number, attackerOwner: number, attacker: Unit | Building | null): void {
  if (!target.alive) return;
  target.hp -= dmg;
  const owner = game.players[target.owner];
  if (target.kind === 'unit') {
    target.lastAttackedAt = game.time;
    if (attacker) target.lastAttackerId = attacker.id;
    if (!owner.isGaia && attackerOwner !== 0 && game.time - owner.lastUnderAttackAlert > 12) {
      owner.lastUnderAttackAlert = game.time;
      game.events.push({ e: 'attacked', owner: target.owner, x: target.x, z: target.z, what: target.def.gatherer ? 'villager' : 'military' });
    }
    if (target.hp <= 0) {
      game.killUnit(target, attackerOwner);
      return;
    }
    if (attacker) onAttacked(game, target, attacker);
  } else {
    target.lastAttackedAt = game.time;
    if (!owner.isGaia && attackerOwner !== 0 && game.time - owner.lastUnderAttackAlert > 12) {
      owner.lastUnderAttackAlert = game.time;
      game.events.push({ e: 'attacked', owner: target.owner, x: target.x, z: target.z, what: 'building' });
    }
    if (target.hp <= 0) game.destroyBuilding(target, attackerOwner);
  }
}

const ARC: Record<ProjectileKind, number> = {
  arrow: 0.12, bolt: 0.07, stone: 0.28, bullet: 0.01, javelin: 0.14, fire: 0, cannonball: 0.05, boulder: 0.3,
};

export function unitCenterY(game: Game, u: Unit): number {
  return game.map.surfaceAt(u.x, u.z) + (u.def.classes.includes('mounted') ? 0.75 : u.def.classes.includes('siege') ? 0.5 : 0.45);
}

export function launchProjectile(
  game: Game,
  src: { x: number; z: number; y: number; owner: number; id: number },
  target: Unit | Building,
  atk: AttackInfo,
  kind: ProjectileKind,
  speed: number,
  accuracy: number,
  opts: { splash?: number; friendlyFire?: boolean; passThrough?: boolean; lead?: boolean; spread?: number } = {},
): void {
  let tx: number, tz: number, ty: number;
  const vsBuilding = target.kind === 'building';
  if (target.kind === 'building') {
    // aim at a random point on the footprint
    tx = target.x + (game.rng.next() - 0.5) * target.w * 0.6;
    tz = target.z + (game.rng.next() - 0.5) * target.h * 0.6;
    ty = target.baseY + 0.8;
  } else {
    tx = target.x;
    tz = target.z;
    ty = unitCenterY(game, target);
  }
  const d0 = Math.hypot(tx - src.x, tz - src.z);
  let dur = Math.max(0.15, d0 / speed);
  if (opts.lead && target.kind === 'unit') {
    const vx = (target.x - target.px) / TICK, vz = (target.z - target.pz) / TICK;
    tx += vx * dur;
    tz += vz * dur;
  }
  let hit = true;
  if (!vsBuilding && game.rng.next() > accuracy) {
    hit = false;
    const a = game.rng.range(0, Math.PI * 2);
    const r = game.rng.range(0.5, 1.4);
    tx += Math.cos(a) * r;
    tz += Math.sin(a) * r;
    ty = game.map.surfaceAt(tx, tz);
  }
  if (opts.spread) {
    tx += game.rng.range(-opts.spread, opts.spread);
    tz += game.rng.range(-opts.spread, opts.spread);
  }
  const d = Math.hypot(tx - src.x, tz - src.z);
  dur = Math.max(0.12, d / speed);
  const p: Projectile = {
    id: game.nextId++, kind, owner: src.owner, sourceId: src.id,
    sx: src.x, sy: src.y, sz: src.z, tx, ty, tz, t0: game.time, dur, arc: ARC[kind] * d,
    targetId: target.id, attack: atk.attack, attackType: atk.attackType, bonus: atk.bonus,
    splash: opts.splash ?? 0, friendlyFire: !!opts.friendlyFire, passThrough: !!opts.passThrough, hit,
    elevMult: elevationMult(game, src.x, src.z, target.x, target.z), vsBuilding, done: false,
  };
  game.projectiles.push(p);
  game.events.push({ e: 'shoot', x: src.x, z: src.z, kind, owner: src.owner });
}

/** Fire at a ground point (attack-ground for mangonels and trebuchets). */
export function launchAtPoint(
  game: Game,
  src: { x: number; z: number; y: number; owner: number; id: number },
  x: number,
  z: number,
  atk: AttackInfo,
  kind: ProjectileKind,
  speed: number,
  splash: number,
): void {
  const d = Math.hypot(x - src.x, z - src.z);
  const dur = Math.max(0.12, d / speed);
  game.projectiles.push({
    id: game.nextId++, kind, owner: src.owner, sourceId: src.id,
    sx: src.x, sy: src.y, sz: src.z, tx: x, ty: game.map.surfaceAt(x, z), tz: z, t0: game.time, dur, arc: ARC[kind] * d,
    targetId: 0, attack: atk.attack, attackType: atk.attackType, bonus: atk.bonus,
    splash, friendlyFire: true, passThrough: false, hit: true,
    elevMult: elevationMult(game, src.x, src.z, x, z), vsBuilding: false, done: false,
  });
  game.events.push({ e: 'shoot', x: src.x, z: src.z, kind, owner: src.owner });
}

export function updateProjectiles(game: Game): void {
  let any = false;
  for (const p of game.projectiles) {
    if (p.done) continue;
    if (game.time < p.t0 + p.dur) continue;
    p.done = true;
    any = true;
    resolveProjectile(game, p);
  }
  if (any) game.projectiles = game.projectiles.filter((p) => !p.done);
}

function resolveProjectile(game: Game, p: Projectile): void {
  const atk: AttackInfo = { attack: p.attack, attackType: p.attackType, bonus: p.bonus };
  const src = game.get(p.sourceId);
  const attacker = src && (src.kind === 'unit' || src.kind === 'building') ? src : null;
  if (p.splash > 0) {
    game.events.push({ e: 'hit', x: p.tx, z: p.tz, kind: p.kind === 'fire' ? 'fire' : 'splash', owner: p.owner });
    const r = p.splash;
    game.spatial.query(p.tx, p.tz, r + 0.6, (u, d2) => {
      if (!u.alive || u.garrisonedIn) return;
      const reach = r + u.radius;
      if (d2 > reach * reach) return;
      if (u.owner === p.owner && u.id === p.sourceId) return;
      if (!p.friendlyFire && !game.isEnemy(p.owner, u.owner) && u.owner !== 0) return;
      if (u.owner === 0 && !u.def.animal) return;
      dealDamage(game, u, computeDamage(atk, u, p.elevMult), p.owner, attacker);
    });
    for (const b of game.buildings) {
      if (!b.alive || !game.isEnemy(p.owner, b.owner)) continue;
      if (distToRect(p.tx, p.tz, b.tx, b.tz, b.tx + b.w, b.tz + b.h) <= r) {
        dealDamage(game, b, computeDamage(atk, b, p.elevMult), p.owner, attacker);
      }
    }
    return;
  }
  if (p.passThrough) {
    // damage every enemy along the line
    const dx = p.tx - p.sx, dz = p.tz - p.sz;
    const len = Math.hypot(dx, dz) || 1;
    const ex = p.sx + (dx / len) * (len + 1.5), ez = p.sz + (dz / len) * (len + 1.5);
    const mx = (p.sx + ex) / 2, mz = (p.sz + ez) / 2;
    const half = (len + 1.5) / 2 + 1;
    const hitSet: Unit[] = [];
    game.spatial.query(mx, mz, half, (u) => {
      if (!u.alive || !game.isEnemy(p.owner, u.owner)) return;
      // distance from point to segment
      const t = Math.max(0, Math.min(1, ((u.x - p.sx) * (ex - p.sx) + (u.z - p.sz) * (ez - p.sz)) / ((ex - p.sx) ** 2 + (ez - p.sz) ** 2)));
      const px = p.sx + (ex - p.sx) * t, pz = p.sz + (ez - p.sz) * t;
      if (Math.hypot(u.x - px, u.z - pz) < 0.3 + u.radius) hitSet.push(u);
    });
    for (const u of hitSet) dealDamage(game, u, computeDamage(atk, u, p.elevMult), p.owner, attacker);
    const t = game.get(p.targetId);
    if (t && t.kind === 'building' && t.alive) dealDamage(game, t, computeDamage(atk, t, p.elevMult), p.owner, attacker);
    game.events.push({ e: 'hit', x: p.tx, z: p.tz, kind: 'pierce', owner: p.owner });
    return;
  }
  const t = game.get(p.targetId);
  if (t && t.alive && (t.kind === 'unit' || t.kind === 'building')) {
    if (t.kind === 'building') {
      dealDamage(game, t, computeDamage(atk, t, p.elevMult), p.owner, attacker);
      game.events.push({ e: 'hit', x: p.tx, z: p.tz, kind: 'building', owner: p.owner });
      return;
    }
    if (!t.garrisonedIn && p.hit && Math.hypot(t.x - p.tx, t.z - p.tz) < t.radius + 0.55) {
      dealDamage(game, t, computeDamage(atk, t, p.elevMult), p.owner, attacker);
      game.events.push({ e: 'hit', x: p.tx, z: p.tz, kind: 'pierce', owner: p.owner });
      return;
    }
  }
  // stray projectile may still hit someone
  let stray: Unit | null = null;
  game.spatial.query(p.tx, p.tz, 0.6, (u, d2) => {
    if (stray || !u.alive || u.garrisonedIn) return;
    if (!game.isEnemy(p.owner, u.owner)) return;
    if (d2 < (u.radius + 0.15) ** 2) stray = u;
  });
  if (stray) dealDamage(game, stray, computeDamage(atk, stray, p.elevMult), p.owner, attacker);
}
