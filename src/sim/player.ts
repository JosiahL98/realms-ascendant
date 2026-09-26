import { BUILDINGS, BUILDING_LIST } from '../data/buildings';
import { UNITS, UNIT_LIST } from '../data/units';
import { TECHS } from '../data/techs';
import type { AgeIndex, BuildingDef, CivDef, Cost, Effect, GatherKind, Res, Selector, TechDef, UnitDef } from '../data/types';

export interface UnitStats {
  hp: number;
  attack: number;
  attackType: 'melee' | 'pierce';
  bonus: Record<string, number>;
  range: number;
  minRange: number;
  reload: number;
  speed: number;
  los: number;
  meleeArmor: number;
  pierceArmor: number;
  accuracy: number;
  regen: number;
  splash: number;
  trainTime: number;
  cost: Cost;
  healRate: number;
}

export interface BuildingStats {
  hp: number;
  meleeArmor: number;
  pierceArmor: number;
  los: number;
  cost: Cost;
  buildTime: number;
  popProvided: number;
  attack: { damage: number; range: number; minRange: number; reload: number; arrows: number; bonus: Record<string, number> } | null;
}

export interface PlayerColor {
  name: string;
  hex: number;
  css: string;
}

export const PLAYER_COLORS: PlayerColor[] = [
  { name: 'Blue', hex: 0x2f5fe0, css: '#2f5fe0' },
  { name: 'Red', hex: 0xd42a1e, css: '#d42a1e' },
  { name: 'Green', hex: 0x2fa82f, css: '#2fa82f' },
  { name: 'Yellow', hex: 0xe8d12a, css: '#e8d12a' },
  { name: 'Teal', hex: 0x22b8c8, css: '#22b8c8' },
  { name: 'Purple', hex: 0x9a3cd8, css: '#9a3cd8' },
  { name: 'Grey', hex: 0x9a9a9a, css: '#9a9a9a' },
  { name: 'Orange', hex: 0xf07c14, css: '#f07c14' },
];
export const GAIA_COLOR: PlayerColor = { name: 'Gaia', hex: 0xdddddd, css: '#dddddd' };

export function matchUnit(sel: Selector, def: UnitDef): boolean {
  if (sel.allUnits) return true;
  if (sel.units && sel.units.includes(def.id)) return true;
  if (sel.classes) for (const c of sel.classes) if (def.classes.includes(c)) return true;
  return false;
}
export function matchBuilding(sel: Selector, def: BuildingDef): boolean {
  if (sel.allBuildings) return true;
  if (sel.buildings && sel.buildings.includes(def.id)) return true;
  if (sel.classes) for (const c of sel.classes) if (def.classes.includes(c)) return true;
  return false;
}

const MILITARY_BUILDINGS = ['barracks', 'archeryRange', 'stable', 'siegeWorkshop', 'castle', 'monastery'];

export class Player {
  id: number;
  name: string;
  civ: CivDef;
  color: PlayerColor;
  team: number;
  isHuman: boolean;
  isGaia: boolean;
  res: Record<Res, number> = { food: 0, wood: 0, gold: 0, stone: 0 };
  age: AgeIndex = 0;
  researched = new Set<string>();
  researchOrder: string[] = [];
  researching = new Set<string>();
  pop = 0;
  popCap = 0;
  maxPop = 200;
  unitStats = new Map<string, UnitStats>();
  buildingStats = new Map<string, BuildingStats>();
  gatherMult: Record<GatherKind, number> = { forage: 1, hunt: 1, herd: 1, farm: 1, fish: 1, wood: 1, gold: 1, stone: 1 };
  carryAll = 0;
  carryPer: Partial<Record<GatherKind, number>> = {};
  farmFood = 0;
  buildRate = 1;
  workRate = new Map<string, number>();
  techCostMult = 1;
  flags = new Map<string, number>();
  lineUpgrade = new Map<string, string>();
  enabled = new Set<string>();
  popBonus = new Map<string, number>();
  costMods: { sel: Selector; mult: number; res?: Res }[] = [];
  defeated = false;
  resigned = false;
  /** Statistics for the score screen. */
  stats = {
    unitsKilled: 0, unitsLost: 0, buildingsRazed: 0, buildingsLost: 0, gathered: { food: 0, wood: 0, gold: 0, stone: 0 } as Record<Res, number>,
    techs: 0, feudalTime: -1, castleTime: -1, imperialTime: -1, villagersTrained: 0, militaryTrained: 0,
  };
  /** Idle-player bookkeeping for the UI. */
  lastUnderAttackAlert = -100;

  constructor(id: number, name: string, civ: CivDef, color: PlayerColor, team: number, isHuman: boolean, isGaia = false) {
    this.id = id;
    this.name = name;
    this.civ = civ;
    this.color = color;
    this.team = team;
    this.isHuman = isHuman;
    this.isGaia = isGaia;
    this.recompute();
  }

  hasFlag(f: string): boolean {
    return this.flags.has(f);
  }

  isDisabled(id: string): boolean {
    return this.civ.disabled.includes(id);
  }

  /** Current unit id of an upgrade line (e.g. 'militia' -> 'longSwordsman'). */
  currentOf(baseId: string): string {
    if (baseId === 'uniqueUnit') baseId = this.civ.uniqueUnit;
    return this.lineUpgrade.get(baseId) ?? baseId;
  }

  resolveTechId(id: string): string {
    if (id === 'eliteUnique') return 'elite_' + this.civ.uniqueUnit;
    if (id === 'uniqueTech1') return this.civ.uniqueTechs[0];
    if (id === 'uniqueTech2') return this.civ.uniqueTechs[1];
    return id;
  }

  /** Rebuild all effective stats from base definitions, civ bonuses and techs. */
  recompute(): void {
    this.unitStats.clear();
    this.buildingStats.clear();
    this.gatherMult = { forage: 1, hunt: 1, herd: 1, farm: 1, fish: 1, wood: 1, gold: 1, stone: 1 };
    this.carryAll = 0;
    this.carryPer = {};
    this.farmFood = 0;
    this.buildRate = 1;
    this.workRate.clear();
    this.techCostMult = 1;
    this.flags.clear();
    this.lineUpgrade.clear();
    this.enabled.clear();
    this.popBonus.clear();
    this.costMods = [];

    for (const d of UNIT_LIST) {
      this.unitStats.set(d.id, {
        hp: d.hp, attack: d.attack, attackType: d.attackType, bonus: { ...(d.bonus ?? {}) }, range: d.range,
        minRange: d.minRange ?? 0, reload: d.reload, speed: d.speed, los: d.los, meleeArmor: d.meleeArmor,
        pierceArmor: d.pierceArmor, accuracy: d.accuracy ?? 1, regen: d.regen ?? 0, splash: d.splash ?? 0,
        trainTime: d.trainTime, cost: { ...d.cost }, healRate: d.monk ? 1.2 : 0,
      });
    }
    for (const d of BUILDING_LIST) {
      this.buildingStats.set(d.id, {
        hp: d.hp, meleeArmor: d.meleeArmor, pierceArmor: d.pierceArmor, los: d.los, cost: { ...d.cost },
        buildTime: d.buildTime, popProvided: d.popProvided ?? 0,
        attack: d.attack ? { damage: d.attack.damage, range: d.attack.range, minRange: d.attack.minRange ?? 0, reload: d.attack.reload, arrows: d.attack.arrows, bonus: { ...(d.attack.bonus ?? {}) } } : null,
      });
    }

    const effects: Effect[] = [];
    for (const b of this.civ.bonuses) if ((b.age ?? 0) <= this.age) effects.push(...b.effects);
    for (const t of this.researchOrder) {
      const def = TECHS[t];
      if (def) effects.push(...def.effects);
    }
    for (const e of effects) this.applyEffect(e);

    // Cost modifiers applied last so they compound properly.
    for (const [id, s] of this.unitStats) {
      const def = UNITS[id];
      for (const m of this.costMods) if (matchUnit(m.sel, def)) s.cost = scaleCost(s.cost, m.mult, m.res);
    }
    for (const [id, s] of this.buildingStats) {
      const def = BUILDINGS[id];
      for (const m of this.costMods) if (matchBuilding(m.sel, def)) s.cost = scaleCost(s.cost, m.mult, m.res);
      s.popProvided += this.popBonus.get(id) ?? 0;
    }
  }

  private applyEffect(e: Effect): void {
    switch (e.kind) {
      case 'stat': {
        for (const [id, s] of this.unitStats) {
          if (!matchUnit(e.target, UNITS[id])) continue;
          applyStat(s as unknown as Record<string, number>, e.stat, e.op, e.value);
        }
        for (const [id, s] of this.buildingStats) {
          if (!matchBuilding(e.target, BUILDINGS[id])) continue;
          if (e.stat === 'attack' || e.stat === 'range' || e.stat === 'reload' || e.stat === 'minRange') {
            if (!s.attack) continue;
            const key = e.stat === 'attack' ? 'damage' : e.stat;
            applyStat(s.attack as unknown as Record<string, number>, key, e.op, e.value);
          } else if (e.stat === 'hp' || e.stat === 'meleeArmor' || e.stat === 'pierceArmor' || e.stat === 'los' || e.stat === 'buildTime') {
            applyStat(s as unknown as Record<string, number>, e.stat, e.op, e.value);
          }
        }
        break;
      }
      case 'bonus': {
        for (const [id, s] of this.unitStats) {
          if (!matchUnit(e.target, UNITS[id])) continue;
          s.bonus[e.vs] = (s.bonus[e.vs] ?? 0) + e.value;
        }
        for (const [id, s] of this.buildingStats) {
          if (!s.attack || !matchBuilding(e.target, BUILDINGS[id])) continue;
          s.attack.bonus[e.vs] = (s.attack.bonus[e.vs] ?? 0) + e.value;
        }
        break;
      }
      case 'cost':
        this.costMods.push({ sel: e.target, mult: e.mult, res: e.res });
        break;
      case 'techCost':
        this.techCostMult *= e.mult;
        break;
      case 'upgrade': {
        const base = UNITS[e.from]?.lineOf ?? e.from;
        this.lineUpgrade.set(base, e.to);
        break;
      }
      case 'enable':
        if (e.unit) this.enabled.add(e.unit);
        if (e.building) this.enabled.add(e.building);
        break;
      case 'gather':
        if (e.gather === 'all') for (const k in this.gatherMult) this.gatherMult[k as GatherKind] *= e.mult;
        else this.gatherMult[e.gather] *= e.mult;
        break;
      case 'carry':
        if (e.gather) this.carryPer[e.gather] = (this.carryPer[e.gather] ?? 0) + e.value;
        else this.carryAll += e.value;
        break;
      case 'farmFood':
        this.farmFood += e.value;
        break;
      case 'popBonus':
        this.popBonus.set(e.building, (this.popBonus.get(e.building) ?? 0) + e.value);
        break;
      case 'buildRate':
        this.buildRate *= e.mult;
        break;
      case 'workRate':
        this.workRate.set(e.building, (this.workRate.get(e.building) ?? 1) * e.mult);
        break;
      case 'flag':
        this.flags.set(e.flag, e.value ?? 1);
        break;
      case 'age':
      case 'resource':
        break; // handled on research completion
    }
  }

  carryCapacity(kind: GatherKind | null): number {
    return 10 + this.carryAll + (kind ? this.carryPer[kind] ?? 0 : 0);
  }

  buildingWorkRate(type: string): number {
    let r = this.workRate.get(type) ?? 1;
    if (MILITARY_BUILDINGS.includes(type)) r *= this.workRate.get('military') ?? 1;
    return r;
  }

  techCost(t: TechDef): Cost {
    let mult = this.techCostMult;
    if (t.isAge) mult = 1;
    if (t.building === 'university' && this.hasFlag('cheapUniversity')) mult *= 0.67;
    return scaleCost(t.cost, mult);
  }

  unitCost(unitId: string): Cost {
    return this.unitStats.get(unitId)?.cost ?? UNITS[unitId].cost;
  }
  buildingCost(bId: string): Cost {
    return this.buildingStats.get(bId)?.cost ?? BUILDINGS[bId].cost;
  }

  canAfford(c: Cost): boolean {
    for (const k in c) if ((this.res[k as Res] ?? 0) < (c[k as Res] ?? 0)) return false;
    return true;
  }
  pay(c: Cost): boolean {
    if (!this.canAfford(c)) return false;
    for (const k in c) this.res[k as Res] -= c[k as Res] ?? 0;
    return true;
  }
  refund(c: Cost): void {
    for (const k in c) this.res[k as Res] += c[k as Res] ?? 0;
  }

  /** Is this unit line trainable at all for this civ (ignoring age). */
  unitAllowed(unitId: string): boolean {
    const def = UNITS[unitId];
    if (!def) return false;
    if (this.isDisabled(unitId) || (def.lineOf && this.isDisabled(def.lineOf))) return false;
    if (def.civ && def.civ !== this.civ.id) return false;
    if ((unitId === 'handCannoneer' || unitId === 'bombard' || unitId === 'cannonGalleon') && !this.enabled.has(unitId)) return false;
    return true;
  }

  techAllowed(techId: string): boolean {
    const t = TECHS[techId];
    if (!t) return false;
    if (this.isDisabled(techId)) return false;
    if (t.civ && t.civ !== this.civ.id) return false;
    // Unit-line upgrades require the line itself to be available.
    for (const e of t.effects) {
      if (e.kind === 'upgrade') {
        const base = UNITS[e.from]?.lineOf ?? e.from;
        if (this.isDisabled(base)) return false;
      }
    }
    return true;
  }
}

function applyStat(obj: Record<string, number>, key: string, op: 'add' | 'mul' | 'set', v: number): void {
  const cur = obj[key] ?? 0;
  obj[key] = op === 'add' ? cur + v : op === 'mul' ? cur * v : v;
}

export function scaleCost(c: Cost, mult: number, only?: Res): Cost {
  const out: Cost = {};
  for (const k in c) {
    const r = k as Res;
    const v = c[r] ?? 0;
    out[r] = !only || only === r ? Math.round(v * mult) : v;
  }
  return out;
}

export function costToString(c: Cost): string {
  const parts: string[] = [];
  for (const k of ['food', 'wood', 'gold', 'stone'] as Res[]) if (c[k]) parts.push(`${c[k]} ${k}`);
  return parts.join(', ');
}
