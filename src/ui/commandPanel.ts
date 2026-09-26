import { BUILDINGS, BUILDING_LIST } from '../data/buildings';
import { TECHS } from '../data/techs';
import { UNITS } from '../data/units';
import type { Cost } from '../data/types';
import type { Building, Entity, Unit } from '../sim/entities';
import { buildingAvailable, currentBuildingType, unitAvailable } from '../sim/commands';
import { techAvailable } from '../sim/buildingAI';
import { buildingIcon, civEmblem, glyphIcon, techIcon, unitIcon } from './icons';
import type { Session } from './session';

export const GRID_KEYS = ['Q', 'W', 'E', 'R', 'T', 'A', 'S', 'D', 'F', 'G', 'Z', 'X', 'C', 'V', 'B'];

export interface CmdButton {
  slot: number;
  icon: string;
  title: string;
  desc?: string;
  cost?: Cost;
  enabled: boolean;
  reason?: string;
  active?: boolean;
  badge?: string;
  progress?: number;
  action: (shift: boolean) => void;
  rightAction?: () => void;
}

function unitModel(id: string): string {
  return UNITS[id]?.model ?? 'militia';
}

export function computeButtons(s: Session): CmdButton[] {
  const g = s.game;
  const p = g.players[s.local];
  const sel = s.selectedEntities().filter((e) => e.owner === s.local);
  if (!sel.length || p.defeated) return [];
  const color = p.color.hex;
  const units = sel.filter((e): e is Unit => e.kind === 'unit');
  const blds = sel.filter((e): e is Building => e.kind === 'building');
  const out: CmdButton[] = [];

  if (units.length) {
    const vills = units.filter((u) => u.def.gatherer);
    const allVills = vills.length === units.length;
    if (allVills && s.panelMode !== 'main') {
      const menu = s.panelMode === 'buildEco' ? 'eco' : 'mil';
      for (const def of BUILDING_LIST) {
        if (def.menu !== menu || def.upgradesFrom) continue;
        const type = currentBuildingType(p, def.id);
        const av = buildingAvailable(g, p, type);
        if (!av.visible) continue;
        const cost = p.buildingCost(type);
        out.push({
          slot: def.slot, icon: buildingIcon(type, p.civ.style, color), title: `Build ${BUILDINGS[type].name}`,
          desc: BUILDINGS[type].description, cost, enabled: av.ok, reason: av.reason,
          action: () => s.beginPlacement(type),
        });
      }
      out.push({ slot: 14, icon: glyphIcon('back', 'cmd'), title: 'Back', enabled: true, action: () => s.setPanel('main') });
      return out;
    }
    if (allVills) {
      out.push({ slot: 0, icon: glyphIcon('buildEco', 'cmd'), title: 'Build Economic Building', desc: 'Houses, mills, camps, farms, markets and more.', enabled: true, action: () => s.setPanel('buildEco') });
      out.push({ slot: 1, icon: glyphIcon('buildMil', 'cmd'), title: 'Build Military Building', desc: 'Barracks, ranges, stables, towers, walls and castles.', enabled: true, action: () => s.setPanel('buildMil') });
      out.push({ slot: 2, icon: glyphIcon('repair', 'cmd'), title: 'Repair', desc: 'Repair a damaged building or siege weapon. Costs resources.', enabled: true, action: () => s.beginTargeting('repair') });
      out.push({ slot: 3, icon: glyphIcon('garrison', 'cmd'), title: 'Garrison', desc: 'Garrison inside a Town Center, tower or castle.', enabled: true, action: () => s.beginTargeting('garrison') });
      out.push({ slot: 4, icon: glyphIcon('stop', 'cmd'), title: 'Stop', enabled: true, action: () => s.issue({ c: 'stop', units: units.map((u) => u.id) }) });
      out.push({ slot: 14, icon: glyphIcon('delete', 'cmd'), title: 'Delete', desc: 'Kill the selected units.', enabled: true, action: () => s.deleteSelected() });
      return out;
    }
    const ids = units.map((u) => u.id);
    const stance = units[0].stance;
    out.push({ slot: 0, icon: glyphIcon('attackMove', 'cmd'), title: 'Attack Move', desc: 'Move to a point, attacking any enemies met on the way.', enabled: true, action: () => s.beginTargeting('attackMove') });
    out.push({ slot: 1, icon: glyphIcon('patrol', 'cmd'), title: 'Patrol', desc: 'Patrol between here and a point, engaging enemies.', enabled: true, action: () => s.beginTargeting('patrol') });
    out.push({ slot: 2, icon: glyphIcon('follow', 'cmd'), title: 'Follow', desc: 'Follow a unit.', enabled: true, action: () => s.beginTargeting('follow') });
    out.push({ slot: 3, icon: glyphIcon('garrison', 'cmd'), title: 'Garrison', desc: 'Garrison inside a building (or infantry inside a ram).', enabled: true, action: () => s.beginTargeting('garrison') });
    out.push({ slot: 4, icon: glyphIcon('stop', 'cmd'), title: 'Stop', enabled: true, action: () => s.issue({ c: 'stop', units: ids }) });
    const st = (slot: number, key: 'aggressive' | 'defensive' | 'standGround' | 'passive', title: string, desc: string) =>
      out.push({ slot, icon: glyphIcon(key, 'cmd'), title, desc, enabled: true, active: stance === key, action: () => s.issue({ c: 'stance', units: ids, stance: key }) });
    st(5, 'aggressive', 'Aggressive Stance', 'Attack any enemy in sight and chase it.');
    st(6, 'defensive', 'Defensive Stance', 'Attack enemies nearby but do not chase far.');
    st(7, 'standGround', 'Stand Ground', 'Hold position; attack only enemies in range.');
    st(8, 'passive', 'No Attack', 'Never attack, even when attacked.');
    if (units.some((u) => u.def.packs)) {
      const packed = units.find((u) => u.def.packs)!.packed;
      out.push(packed
        ? { slot: 9, icon: glyphIcon('unpack', 'cmd'), title: 'Unpack', desc: 'Unpack the trebuchet so it can fire.', enabled: true, action: () => s.issue({ c: 'unpack', units: ids }) }
        : { slot: 9, icon: glyphIcon('pack', 'cmd'), title: 'Pack', desc: 'Pack the trebuchet so it can move.', enabled: true, action: () => s.issue({ c: 'pack', units: ids }) });
      out.push({ slot: 10, icon: glyphIcon('attackGround', 'cmd'), title: 'Attack Ground', desc: 'Bombard an area.', enabled: true, action: () => s.beginTargeting('attackGround') });
    } else if (units.some((u) => u.def.splash && u.def.classes.includes('siege'))) {
      out.push({ slot: 9, icon: glyphIcon('attackGround', 'cmd'), title: 'Attack Ground', desc: 'Bombard an area.', enabled: true, action: () => s.beginTargeting('attackGround') });
    }
    if (units.some((u) => u.cargo.length)) {
      out.push({ slot: 12, icon: glyphIcon('unload', 'cmd'), title: 'Unload', desc: 'Release the garrisoned troops.', enabled: true, action: () => units.forEach((u) => u.cargo.length && s.issue({ c: 'unload', unit: u.id })) });
    }
    if (units.some((u) => u.def.monk)) {
      out.push({ slot: 9, icon: glyphIcon('heal', 'cmd'), title: 'Heal', desc: 'Heal a wounded ally.', enabled: true, action: () => s.beginTargeting('heal') });
      out.push({ slot: 10, icon: glyphIcon('convert', 'rel'), title: 'Convert', desc: 'Convert an enemy unit to your faith.', enabled: true, action: () => s.beginTargeting('convert') });
    }
    out.push({ slot: 14, icon: glyphIcon('delete', 'cmd'), title: 'Delete', desc: 'Kill the selected units.', enabled: true, action: () => s.deleteSelected() });
    return out;
  }

  // Buildings: only when all selected are the same type
  const type = blds[0].type;
  if (!blds.every((b) => b.type === type)) return [];
  const b = blds[0];
  const def = b.def;
  if (!b.built) {
    out.push({ slot: 14, icon: glyphIcon('delete', 'cmd'), title: 'Cancel construction', desc: 'Cancel and delete this foundation.', enabled: true, action: () => s.deleteSelected() });
    return out;
  }
  const occupied = new Set<number>();
  for (const base of def.trains ?? []) {
    const line = base === 'uniqueUnit' ? p.civ.uniqueUnit : base;
    const uid = p.currentOf(line);
    const av = unitAvailable(g, p, uid);
    if (!av.visible) continue;
    const ud = UNITS[uid];
    const slot = base === 'uniqueUnit' ? 0 : ud.slot ?? 0;
    occupied.add(slot);
    const queued = blds.reduce((n, bb) => n + bb.queue.filter((q) => q.kind === 'unit' && (UNITS[q.id].lineOf ?? q.id) === (ud.lineOf ?? uid)).length, 0);
    out.push({
      slot, icon: unitIcon(unitModel(uid), color), title: `Train ${ud.name}`, desc: ud.description, cost: p.unitCost(uid), enabled: true,
      badge: queued ? String(queued) : undefined,
      action: (shift) => s.train(blds, line, shift ? 5 : 1),
      rightAction: () => s.cancelLast(blds, line),
    });
  }
  const emblem = civEmblem(p.civ);
  for (const raw of def.researches ?? []) {
    const tid = p.resolveTechId(raw);
    const t = TECHS[tid];
    if (!t) continue;
    let av = techAvailable(g, p, tid);
    // show techs being researched right now with progress
    let progress: number | undefined;
    for (const bb of g.buildings) {
      if (bb.owner === s.local && bb.queue[0]?.kind === 'tech' && bb.queue[0].id === tid) progress = bb.queueTime / t.time;
    }
    if (p.researching.has(tid)) av = { ok: false, visible: true, reason: 'Being researched' };
    if (!av.visible) continue;
    if (occupied.has(t.slot)) continue;
    occupied.add(t.slot);
    out.push({
      slot: t.slot, icon: techIcon(t.icon, color, emblem), title: `Research ${t.name}`, desc: t.description + (t.civ ? ' (unique technology)' : ''),
      cost: p.techCost(t), enabled: av.ok, reason: av.reason, progress,
      action: () => s.research(blds, tid),
    });
  }
  if (type === 'market') {
    const fee = p.hasFlag('guilds') ? 0.15 : 0.3;
    const mk = g.market;
    ([['food', 1, 11], ['wood', 2, 12], ['stone', 3, 13]] as const).forEach(([res, sellSlot, buySlot]) => {
      const R = res[0].toUpperCase() + res.slice(1);
      out.push({ slot: sellSlot, icon: glyphIcon('sell' + R, 'eco'), title: `Sell 100 ${res}`, desc: `Receive ${Math.floor(mk[res] * (1 - fee))} gold.`, enabled: true, action: () => s.issue({ c: 'market', action: 'sell', res }) });
      out.push({ slot: buySlot, icon: glyphIcon('buy' + R, 'eco'), title: `Buy 100 ${res}`, desc: `Costs ${Math.ceil(mk[res] * (1 + fee))} gold.`, enabled: true, action: () => s.issue({ c: 'market', action: 'buy', res }) });
    });
  }
  if (def.trains?.length || type === 'townCenter') {
    out.push({ slot: 10, icon: glyphIcon('rally', 'cmd'), title: 'Set Gather Point', desc: 'Set where newly created units go. You can also right-click with the building selected.', enabled: true, action: () => s.beginTargeting('rally') });
  }
  if (type === 'townCenter') {
    const anyGarrisoned = g.buildings.some((bb) => bb.owner === s.local && bb.garrison.some((id) => g.unit(id)?.def.gatherer));
    out.push(anyGarrisoned
      ? { slot: 11, icon: glyphIcon('allClear', 'cmd'), title: 'All Clear', desc: 'Villagers leave their shelters and return to work.', enabled: true, action: () => s.issue({ c: 'townBell', on: false }) }
      : { slot: 11, icon: glyphIcon('townBell', 'cmd'), title: 'Ring Town Bell', desc: 'All villagers garrison in the nearest Town Center, tower or castle.', enabled: true, action: () => s.issue({ c: 'townBell', on: true }) });
  }
  if (def.garrison && blds.some((bb) => bb.garrison.length)) {
    out.push({ slot: 12, icon: glyphIcon('ungarrison', 'cmd'), title: 'Ungarrison', desc: 'Release all garrisoned units.', enabled: true, action: () => blds.forEach((bb) => s.issue({ c: 'ungarrison', building: bb.id })) });
  }
  out.push({ slot: 14, icon: glyphIcon('delete', 'cmd'), title: 'Delete', desc: 'Destroy this building.', enabled: true, action: () => s.deleteSelected() });
  return out;
}

export function entityIcon(s: Session, e: Entity): string {
  const g = s.game;
  if (e.kind === 'unit') return unitIcon(e.def.model === 'villager' && e.id % 2 ? 'villagerF' : e.def.model, g.players[e.owner].color.hex);
  if (e.kind === 'building') return buildingIcon(e.type, g.players[e.owner].civ.style, g.players[e.owner].color.hex);
  const map: Record<string, string> = { tree: 'axe1', gold: 'gold1', stone: 'stone1', berries: 'cropRotation', carcass: 'heavyPlow', relic: 'redemption' };
  return glyphIcon(map[e.type] ?? 'axe1', 'eco');
}
