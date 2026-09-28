import { BUILDINGS } from '../data/buildings';
import { CIVS } from '../data/civs';
import { UNITS } from '../data/units';
import { Building, ResourceNode, Unit, type Projectile } from './entities';
import { Game, type GameSetup } from './game';
import { GAIA_COLOR, PLAYER_COLORS } from './player';

/*
 * Saved games. A snapshot holds everything the simulation cannot work out again: the entities, each player's
 * resources, research and score, the terrain and what stands on it, what each team has explored, the random number
 * state, and the computer players' plans. What can be derived is rebuilt on loading: stats after technologies (from
 * the research order), passability and water bodies (from terrain and obstacles), current visibility, the spatial
 * index and path caches.
 *
 * Snapshots use the structured clone types (Map, Set, typed arrays, NaN), so IndexedDB stores them as they are.
 */

export const SAVE_VERSION = 1;

type Plain = Record<string, unknown>;

export interface SaveData {
  version: number;
  setup: GameSetup;
  game: Plain;
  map: { terrain: Uint8Array; heights: Float32Array; obstacle: Int32Array; gateOwner: Int8Array; farmAt: Int32Array; version: number };
  explored: [number, Uint8Array][];
  players: Plain[];
  units: Plain[];
  buildings: Plain[];
  /** Resource nodes as rows of values under one list of field names (there are thousands of trees). */
  resources: { keys: string[]; rows: unknown[][] };
  projectiles: Projectile[];
  /** Computer players' own state, by player id. */
  ai: [number, Plain][];
  /** The viewer: whose eyes, the camera, control groups, game speed. */
  view: Plain;
}

/** Fields a player works out again from civilisation, age and research (Player.recompute). */
const PLAYER_DERIVED = new Set(['civ', 'color', 'unitStats', 'buildingStats', 'gatherMult', 'carryAll', 'carryPer', 'farmFood',
  'buildRate', 'workRate', 'techCostMult', 'flags', 'lineUpgrade', 'enabled', 'popBonus', 'costMods']);
/** Entity fields relinked from the definitions and the owner's stats. */
const ENTITY_DERIVED = new Set(['kind', 'def', 'stats']);

/** A shallow copy of an object's own fields, leaving some out (the snapshot is deep-copied once at the end). */
function fields(o: object, skip: Set<string>): Plain {
  const out: Plain = {};
  for (const [k, v] of Object.entries(o)) if (!skip.has(k)) out[k] = v;
  return out;
}

function table(rows: Plain[]): { keys: string[]; rows: unknown[][] } {
  const keys = rows.length ? Object.keys(rows[0]) : [];
  return { keys, rows: rows.map((r) => keys.map((k) => r[k])) };
}

function untable(t: { keys: string[]; rows: unknown[][] }): Plain[] {
  return t.rows.map((row) => Object.fromEntries(t.keys.map((k, i) => [k, row[i]])));
}

/**
 * A snapshot of the game (and, through `ai` and `view`, of the session around it), independent of the live game:
 * it can be kept or stored while play goes on.
 */
export function snapshotGame(g: Game, ai: [number, Plain][], view: Plain): SaveData {
  const priv = g as unknown as Record<string, unknown>;
  const save: SaveData = {
    version: SAVE_VERSION,
    setup: g.setup,
    game: {
      time: g.time, tickCount: g.tickCount, nextId: g.nextId, market: g.market, winnerTeam: g.winnerTeam, over: g.over,
      relicTeam: g.relicTeam, relicTimer: g.relicTimer, carcassOf: g.carcassOf, buildingsVersion: g.buildingsVersion,
      resourcesVersion: g.resourcesVersion, acc: priv.acc, rng: (g.rng as unknown as { s: number }).s,
    },
    map: {
      terrain: g.map.terrain, heights: g.map.heights, obstacle: g.map.obstacle, gateOwner: g.map.gateOwner, farmAt: g.map.farmAt,
      version: g.map.version,
    },
    explored: [...g.vision.explored.entries()],
    players: g.players.map((p) => ({ ...fields(p, PLAYER_DERIVED), civId: p.civ.id, colorHex: p.color.hex })),
    units: g.units.filter((u) => u.alive).map((u) => fields(u, ENTITY_DERIVED)),
    buildings: g.buildings.filter((b) => b.alive).map((b) => fields(b, ENTITY_DERIVED)),
    resources: table(g.resources.filter((r) => r.alive).map((r) => fields(r, ENTITY_DERIVED))),
    projectiles: g.projectiles.filter((p) => !p.done),
    ai,
    view,
  };
  return structuredClone(save);
}

/** A game rebuilt from a snapshot, ready to go on from the moment it was saved. */
export function restoreGame(d: SaveData): Game {
  if (d.version !== SAVE_VERSION) throw new Error(`This save is from a different version of the game (${d.version}).`);
  const g = new Game(d.setup, true);
  const priv = g as unknown as Record<string, unknown>;
  const gs = d.game;
  g.time = gs.time as number;
  g.tickCount = gs.tickCount as number;
  g.nextId = gs.nextId as number;
  g.market = gs.market as Game['market'];
  g.winnerTeam = gs.winnerTeam as number;
  g.over = gs.over as boolean;
  g.relicTeam = gs.relicTeam as number;
  g.relicTimer = gs.relicTimer as number;
  g.carcassOf = gs.carcassOf as Map<number, number>;
  g.buildingsVersion = gs.buildingsVersion as number;
  g.resourcesVersion = gs.resourcesVersion as number;
  priv.acc = gs.acc ?? 0;
  (g.rng as unknown as { s: number }).s = gs.rng as number;

  // terrain and what stands on it; passability and water bodies follow from them
  const m = g.map;
  m.terrain.set(d.map.terrain);
  m.heights.set(d.map.heights);
  m.obstacle.set(d.map.obstacle);
  m.gateOwner.set(d.map.gateOwner);
  m.farmAt.set(d.map.farmAt);
  m.refreshAll();
  m.labelWaterBodies();
  m.version = d.map.version + 1;

  // players: their own state, then their stats worked out again from civilisation, age and research
  d.players.forEach((s, i) => {
    const p = g.players[i];
    if (!p) return;
    const { civId, colorHex, ...rest } = s;
    Object.assign(p, rest);
    p.civ = CIVS[civId as string] ?? p.civ;
    p.color = p.isGaia ? GAIA_COLOR : PLAYER_COLORS.find((c) => c.hex === colorHex) ?? p.color;
    p.recompute();
  });

  for (const s of d.units) {
    const def = UNITS[s.type as string];
    if (!def) continue;
    const u = new Unit(s.id as number, def, s.owner as number, s.x as number, s.z as number);
    Object.assign(u, s);
    u.def = UNITS[u.type] ?? def;
    u.stats = g.players[u.owner].unitStats.get(u.type)!;
    g.entities.set(u.id, u);
    g.units.push(u);
  }
  for (const s of d.buildings) {
    const def = BUILDINGS[s.type as string];
    if (!def) continue;
    const b = new Building(s.id as number, def, s.owner as number, s.tx as number, s.tz as number, s.rotated as boolean);
    Object.assign(b, s);
    b.def = BUILDINGS[b.type] ?? def;
    b.stats = g.players[b.owner].buildingStats.get(b.type)!;
    g.entities.set(b.id, b);
    g.buildings.push(b);
  }
  for (const s of untable(d.resources)) {
    const r = new ResourceNode(s.id as number, s.type as ResourceNode['type'], s.gather as ResourceNode['gather'], s.maxAmount as number,
      s.tx as number, s.tz as number, s.blocks as boolean);
    Object.assign(r, s);
    g.entities.set(r.id, r);
    g.resources.push(r);
  }
  g.projectiles = d.projectiles;

  for (const [team, arr] of d.explored) g.vision.explored.get(team)?.set(arr);
  for (const p of g.players) g.recomputePop(p.id);
  g.spatial.rebuild(g.units);
  g.vision.update(false);
  g.events.length = 0;
  return g;
}
