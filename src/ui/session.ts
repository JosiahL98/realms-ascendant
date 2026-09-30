import { Game, type GameSetup, TICK } from '../sim/game';
import { restoreGame, snapshotGame, type SaveData } from '../sim/save';
import { AUTOSAVE_ID, formatClock, newSaveId, writeSave, type SaveMeta } from './saves';
import type { Building, Entity, Unit } from '../sim/entities';
import { issueCommand, type Command, type CmdResult } from '../sim/commands';
import { Renderer } from '../render/renderer';
import { getRig } from '../render/models/units';
import { bakedHeight } from '../render/models/baked';
import { buildingModel } from '../render/models/buildings';
import { TECHS } from '../data/techs';
import { UNITS } from '../data/units';
import { BUILDINGS } from '../data/buildings';
import { AGE_NAMES } from '../data/types';
import { Hud } from './hud';
import { Input } from './input';
import { Minimap } from './minimap';
import { AudioSys } from '../audio/audio';
import type { TextureAssets } from '../render/assets';

export type TargetMode = 'attackMove' | 'patrol' | 'follow' | 'garrison' | 'repair' | 'attackGround' | 'rally' | 'heal' | 'convert' | 'unloadAt';

export interface AIController {
  update(): void;
  /** Plans and memory to keep in a saved game, and to take back up on loading it. */
  saveState?(): Record<string, unknown>;
  loadState?(s: Record<string, unknown>): void;
}

/** Game speeds offered (the + and - keys step through them). */
export const SPEEDS = [0.5, 1, 1.5, 2, 3, 4, 5, 7, 10];

/** Game time between autosaves (s). */
const AUTOSAVE_EVERY = 300;

export class Session {
  game: Game;
  renderer: Renderer;
  hud: Hud;
  input: Input;
  minimap: Minimap;
  audio: AudioSys;
  local: number;
  /** Watching a match of computer players: nothing can be commanded. */
  spectator: boolean;
  /** Spectating with everything visible, rather than through one player's eyes. */
  viewAll = false;
  selection: number[] = [];
  panelMode: 'main' | 'buildEco' | 'buildMil' = 'main';
  placing: { type: string; rotated: boolean } | null = null;
  targeting: TargetMode | null = null;
  groups: number[][] = Array.from({ length: 10 }, () => []);
  speed = 1.5;
  paused = false;
  lastAlert: { x: number; z: number; t: number } | null = null;
  ais: { pid: number; ai: AIController }[] = [];
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  overlay: HTMLCanvasElement;
  private octx: CanvasRenderingContext2D;
  private raf = 0;
  private last = 0;
  private alpha = 0;
  private onExit: () => void;
  ended = false;
  selVersion = 0;
  private fxTimer = 0;
  /** Loading a saved game from the in-game menu (set by main.ts, which starts a new session for it). */
  onLoadGame: ((id: string) => void) | null = null;
  private nextAutosave = AUTOSAVE_EVERY;
  private saving = false;
  private resizeObserver: ResizeObserver;

  /** `restore`: a saved game to go on with, instead of a new one from `setup`. */
  constructor(root: HTMLElement, setup: GameSetup, makeAI: (game: Game, pid: number) => AIController | null, onExit: () => void, audio: AudioSys,
    assets: TextureAssets | null = null, restore: SaveData | null = null) {
    this.root = root;
    this.onExit = onExit;
    this.audio = audio;
    this.game = restore ? restoreGame(restore) : new Game(setup);
    this.spectator = !!setup.spectator;
    this.local = this.spectator ? 1 : setup.players.findIndex((p) => p.human) + 1 || 1;
    this.viewAll = this.spectator;
    this.nextAutosave = this.game.time + AUTOSAVE_EVERY;
    root.innerHTML = `<canvas id="view"></canvas><div id="vignette"></div><canvas id="overlay"></canvas><div id="hud"></div>`;
    this.canvas = root.querySelector('#view') as HTMLCanvasElement;
    this.overlay = root.querySelector('#overlay') as HTMLCanvasElement;
    this.octx = this.overlay.getContext('2d')!;
    this.renderer = new Renderer(this.canvas, this.game, this.local, assets);
    // Start touch devices with a wider view of the town and surrounding terrain.
    // Restoring a save below still restores the player's chosen zoom.
    if (matchMedia('(pointer: coarse)').matches) {
      this.renderer.setZoom(28);
    }
    this.hud = new Hud(this, root.querySelector('#hud') as HTMLElement);
    this.minimap = new Minimap(this, this.hud.minimapCanvas);
    this.input = new Input(this);
    for (const p of this.game.players) {
      if (p.isGaia || p.isHuman) continue;
      const ai = makeAI(this.game, p.id);
      if (!ai) continue;
      const saved = restore?.ai.find(([pid]) => pid === p.id);
      if (saved && ai.loadState) ai.loadState(saved[1]);
      this.ais.push({ pid: p.id, ai });
    }
    const tc = this.game.buildings.find((b) => b.owner === this.local && b.type === 'townCenter');
    if (this.spectator) {
      this.renderer.setViewTeam(-1);
      this.renderer.centerOn(this.game.map.n / 2, this.game.map.n / 2);
    } else if (tc) this.renderer.centerOn(tc.x + 1, tc.z + 1);
    if (restore) this.restoreView(restore.view);
    this.resize();
    // Mobile browser chrome can resize the dynamic viewport without a window resize.
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(root);
    window.addEventListener('resize', this.resize);
    (window as unknown as Record<string, unknown>).__session = this;
    (window as unknown as Record<string, unknown>).__game = this.game;
    if (restore) {
      this.hud.message(`Game loaded: ${formatClock(this.game.time)} into the ${this.spectator ? 'match' : 'game'}.`, 'good');
    } else if (this.spectator) {
      this.hud.message('You are watching the computer players. Choose whose eyes to see through at the top of the screen.', 'good');
    } else {
      this.hud.message(`Welcome, ${this.game.players[this.local].name} of ${this.game.players[this.local].civ.realm.replace(/^The /, "the ")}.`, "good");
      this.hud.message('Gather resources, advance through the ages and conquer your rivals.', 'info');
    }
    this.audio.startMusic();
  }

  resize = (): void => {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.overlay.width = this.root.clientWidth * dpr;
    this.overlay.height = this.root.clientHeight * dpr;
    this.octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.renderer.resize();
  };

  start(): void {
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    this.resizeObserver.disconnect();
    this.input.dispose();
    this.minimap.dispose();
    this.audio.stopMusic();
    this.renderer.post?.dispose();
    this.renderer.gl.dispose();
  }

  exit(): void {
    this.stop();
    this.onExit();
  }

  /* ------------------------------------------------------------------ */
  /* Saved games                                                          */
  /* ------------------------------------------------------------------ */

  /** The whole game as it stands, with the computer players' plans and the view. */
  snapshot(): SaveData {
    const ai: [number, Record<string, unknown>][] = [];
    for (const { pid, ai: c } of this.ais) if (c.saveState) ai.push([pid, c.saveState()]);
    const view = {
      local: this.local, viewAll: this.viewAll, speed: this.speed, groups: this.groups,
      camX: this.renderer.camX, camZ: this.renderer.camZ, zoom: this.renderer.zoom,
    };
    return snapshotGame(this.game, ai, view);
  }

  private restoreView(v: Record<string, unknown>): void {
    if (typeof v.speed === 'number') this.speed = v.speed;
    if (Array.isArray(v.groups)) this.groups = (v.groups as number[][]).map((g) => g.filter((id) => this.game.get(id)?.alive));
    if (this.spectator && typeof v.viewAll === 'boolean') {
      this.viewAll = v.viewAll;
      if (typeof v.local === 'number') this.local = v.local;
      this.renderer.setViewTeam(this.viewAll ? -1 : this.game.teamOf[this.local]);
    }
    if (typeof v.zoom === 'number') this.renderer.setZoom(v.zoom);
    if (typeof v.camX === 'number' && typeof v.camZ === 'number') this.renderer.centerOn(v.camX, v.camZ);
  }

  /** What the save list shows for this game. */
  private saveMeta(id: string, name: string, auto: boolean): SaveMeta {
    const g = this.game;
    const me = g.players[this.local];
    return {
      id, name, savedAt: Date.now(), gameTime: g.time, auto,
      realm: this.spectator ? 'Watching a match' : me.civ.realm, civ: me.civ.id, color: this.spectator ? '#f2d98c' : me.color.css,
      mapType: g.setup.mapType, mapSize: g.setup.mapSize,
      players: g.players.filter((p) => !p.isGaia).map((p) => p.civ.name).join(' vs '),
      age: AGE_NAMES[me.age] ?? '',
      thumb: this.thumbnail(),
    };
  }

  /** A small picture of the view for the save list (drawn afresh: the canvas does not keep its last frame). */
  private thumbnail(): string {
    try {
      this.renderer.render(this.paused ? 1 : this.alpha);
      const W = 256, H = 144;
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const src = this.canvas;
      let w = src.width, h = src.width * H / W;
      if (h > src.height) {
        h = src.height;
        w = h * W / H;
      }
      c.getContext('2d')!.drawImage(src, (src.width - w) / 2, (src.height - h) / 2, w, h, 0, 0, W, H);
      return c.toDataURL('image/jpeg', 0.75);
    } catch {
      return '';
    }
  }

  /** Saves the game under `name` (a new save, or over `id`). */
  async save(name: string, id = newSaveId(), auto = false): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    try {
      await writeSave(this.saveMeta(id, name, auto), this.snapshot());
      if (!auto) this.hud.message(`Game saved: ${name}`, 'good');
    } catch (e) {
      this.hud.message(`The game could not be saved: ${(e as Error).message}`, 'err');
    } finally {
      this.saving = false;
    }
  }

  private autosave(): void {
    if (this.game.over || this.ended) return;
    this.nextAutosave = this.game.time + AUTOSAVE_EVERY;
    void this.save('Autosave', AUTOSAVE_ID, true);
  }

  private frame(now: number): void {
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    this.input.update(dt);
    if (!this.paused && !this.ended) {
      const before = this.game.tickCount;
      // fast speeds need many ticks a frame; a wall-clock budget keeps the screen responsive when the simulation
      // cannot keep up (the game then simply runs as fast as it can)
      this.alpha = this.game.update(dt * this.speed, Math.max(10, Math.ceil(this.speed * 4)), 45);
      const ticks = this.game.tickCount - before;
      if (ticks > 0) {
        for (const { pid, ai } of this.ais) {
          if (this.game.players[pid].defeated) continue;
          // stagger AI thinking: roughly every 0.5s of game time
          for (let t = before + 1; t <= this.game.tickCount; t++) {
            if ((t + pid * 3) % 10 === 0) ai.update();
          }
        }
      }
    }
    this.processEvents();
    if (this.game.time >= this.nextAutosave) this.autosave();
    this.renderer.selectedIds = new Set(this.selection);
    this.ambientFx(dt);
    this.renderer.render(this.paused ? 1 : this.alpha);
    this.drawOverlay();
    this.hud.update(now);
    this.minimap.update(now);
  }

  /* ------------------------------------------------------------------ */
  /* Selection                                                            */
  /* ------------------------------------------------------------------ */

  selectedEntities(): Entity[] {
    const out: Entity[] = [];
    for (const id of this.selection) {
      const e = this.game.get(id);
      if (!e || !e.alive) continue;
      if (e.kind === 'unit' && e.garrisonedIn) continue;
      out.push(e);
    }
    return out;
  }

  select(ids: number[], additive = false): void {
    this.input.touchMode = 'auto';
    if (additive) {
      const set = new Set(this.selection);
      for (const id of ids) {
        if (set.has(id)) set.delete(id);
        else set.add(id);
      }
      this.selection = [...set];
    } else this.selection = ids.slice(0, 60);
    this.panelMode = 'main';
    this.selVersion++;
    this.hud.refreshCommands();
    const first = this.game.get(this.selection[0]);
    if (first && first.alive && first.owner === this.local) this.audio.selectSound(first);
  }

  cleanSelection(): void {
    const before = this.selection.length;
    this.selection = this.selection.filter((id) => {
      const e = this.game.get(id);
      return e && e.alive && !(e.kind === 'unit' && e.garrisonedIn);
    });
    if (this.selection.length !== before) this.selVersion++;
  }

  ownSelectedUnits(): Unit[] {
    return this.selectedEntities().filter((e): e is Unit => e.kind === 'unit' && e.owner === this.local);
  }

  /* ------------------------------------------------------------------ */
  /* Commands                                                             */
  /* ------------------------------------------------------------------ */

  issue(cmd: Command): CmdResult {
    if (this.spectator) return { ok: false };
    const r = issueCommand(this.game, this.local, cmd);
    if (!r.ok && r.err && r.err !== 'no units') {
      this.hud.message(r.err, 'err');
      this.audio.play('error');
    }
    return r;
  }

  setPanel(mode: 'main' | 'buildEco' | 'buildMil'): void {
    this.input.setTouchMode('auto');
    this.panelMode = mode;
    this.placing = null;
    this.targeting = null;
    this.renderer.showGhost(null);
    this.audio.play('click');
  }

  beginPlacement(type: string): void {
    this.input.setTouchMode('auto');
    this.placing = { type, rotated: false };
    this.targeting = null;
    this.audio.play('click');
  }

  beginTargeting(mode: TargetMode): void {
    this.input.setTouchMode('auto');
    this.targeting = mode;
    this.placing = null;
    this.renderer.showGhost(null);
    this.audio.play('click');
  }

  cancelModes(): boolean {
    if (this.placing || this.targeting) {
      this.placing = null;
      this.targeting = null;
      this.renderer.showGhost(null);
      return true;
    }
    if (this.panelMode !== 'main') {
      this.panelMode = 'main';
      return true;
    }
    return false;
  }

  deleteSelected(): void {
    const ids = this.selectedEntities().filter((e) => e.owner === this.local).map((e) => e.id);
    if (ids.length) this.issue({ c: 'delete', ids });
  }

  train(blds: Building[], line: string, count: number): void {
    let ok = false;
    for (let i = 0; i < count; i++) {
      const b = [...blds].filter((x) => x.alive && x.built).sort((a, c) => a.queue.length - c.queue.length)[0];
      if (!b) return;
      const r = this.issue({ c: 'train', building: b.id, unit: line });
      if (!r.ok) break;
      ok = true;
    }
    if (ok) this.audio.play('click');
  }

  cancelLast(blds: Building[], line: string): void {
    for (const b of blds) {
      for (let i = b.queue.length - 1; i >= 0; i--) {
        const q = b.queue[i];
        if (q.kind === 'unit' && (UNITS[q.id].lineOf ?? q.id) === (UNITS[line]?.lineOf ?? line)) {
          this.issue({ c: 'cancel', building: b.id, index: i });
          return;
        }
      }
    }
  }

  research(blds: Building[], tid: string): void {
    const b = [...blds].sort((a, c) => a.queue.length - c.queue.length)[0];
    const r = this.issue({ c: 'research', building: b.id, tech: tid });
    if (r.ok) this.audio.play('click');
  }

  jumpToAlert(): void {
    if (this.lastAlert) this.renderer.centerOn(this.lastAlert.x, this.lastAlert.z);
  }

  /* ------------------------------------------------------------------ */
  /* Events -> effects, sounds, messages                                  */
  /* ------------------------------------------------------------------ */

  /** The team whose view is shown (-1: everything, when spectating). */
  viewTeam(): number {
    return this.viewAll ? -1 : this.game.teamOf[this.local];
  }

  /** Spectating: see through one player's eyes (0 = everyone). */
  setView(pid: number): void {
    if (!this.spectator) return;
    this.viewAll = pid === 0;
    if (pid) this.local = pid;
    this.renderer.setViewTeam(this.viewTeam());
    this.minimap.refresh();
    this.hud.refreshView();
  }

  /** Whether an event concerns the player being played (or watched). */
  private mine(owner: number): boolean {
    return !this.viewAll && owner === this.local;
  }

  private visibleToMe(x: number, z: number): boolean {
    const team = this.viewTeam();
    return team < 0 || this.game.vision.isVisible(team, x, z);
  }

  private processEvents(): void {
    const g = this.game;
    const r = this.renderer;
    const fx = r.fx;
    for (const ev of g.events) {
      switch (ev.e) {
        case 'death': {
          r.units.addCorpse(g, ev.type, ev.owner, ev.x, ev.z, ev.facing);
          if (this.visibleToMe(ev.x, ev.z)) {
            const def = UNITS[ev.type];
            if (def?.classes.includes('siege')) fx.dust(ev.x, g.map.heightAt(ev.x, ev.z) + 0.3, ev.z, 10, true);
            this.audio.at('death', ev.x, ev.z, def);
          }
          break;
        }
        case 'bdestroy': {
          r.buildings.addRubble(g, ev.x, ev.z, ev.w, ev.h);
          if (this.visibleToMe(ev.x, ev.z) || this.mine(ev.owner)) {
            const y = g.map.heightAt(ev.x, ev.z);
            fx.dust(ev.x, y + 0.5, ev.z, 20 + ev.w * 6, true);
            fx.smoke(ev.x, y + 0.5, ev.z, 10, true);
            this.audio.at('collapse', ev.x, ev.z);
          }
          if (this.mine(ev.owner) && BUILDINGS[ev.type] && !BUILDINGS[ev.type].wall && ev.type !== 'farm') this.hud.message(`Your ${BUILDINGS[ev.type].name} was destroyed!`, 'alert');
          break;
        }
        case 'bcomplete':
          if (this.mine(ev.owner)) {
            this.audio.play('built');
            const b = g.building(ev.id);
            if (b) fx.dust(b.x, b.baseY + 0.2, b.z, 12, true);
          }
          break;
        case 'trained':
          if (this.mine(ev.owner)) this.audio.play('trained');
          break;
        case 'research':
          if (this.mine(ev.owner) && !TECHS[ev.tech]?.isAge) {
            this.hud.message(`${TECHS[ev.tech]?.name ?? ev.tech} researched.`, 'good');
            this.audio.play('research');
          }
          break;
        case 'age': {
          const p = g.players[ev.owner];
          this.hud.message(`${p.name} has advanced to the ${AGE_NAMES[ev.age]}.`, this.mine(ev.owner) ? 'good' : 'info');
          this.audio.play(this.mine(ev.owner) ? 'ageUp' : 'ageUpOther');
          break;
        }
        case 'attacked':
          if (this.mine(ev.owner)) {
            this.lastAlert = { x: ev.x, z: ev.z, t: g.time };
            this.hud.message(ev.what === 'villager' ? 'Your villagers are under attack! (Space to view)' : ev.what === 'building' ? 'Your town is under attack! (Space to view)' : 'Your army is under attack! (Space to view)', 'alert');
            this.audio.play('alarm');
            this.minimap.flash(ev.x, ev.z);
          }
          break;
        case 'hit':
          if (this.renderer.inView(ev.x, ev.z, 1) && this.visibleToMe(ev.x, ev.z)) {
            const y = g.map.heightAt(ev.x, ev.z);
            if (ev.kind === 'melee') {
              fx.sparks(ev.x, y + 0.5, ev.z, 3);
              this.audio.at('melee', ev.x, ev.z);
            } else if (ev.kind === 'building') {
              fx.dust(ev.x, y + 0.6, ev.z, 3);
              this.audio.at('buildingHit', ev.x, ev.z);
            } else if (ev.kind === 'splash') {
              fx.dust(ev.x, y + 0.2, ev.z, 14, true);
              this.audio.at('boom', ev.x, ev.z);
            } else if (ev.kind === 'fire') {
              fx.fire(ev.x, y + 0.4, ev.z, 12);
            } else this.audio.at('arrowHit', ev.x, ev.z);
          }
          break;
        case 'shoot':
          if (this.renderer.inView(ev.x, ev.z, 1) && this.visibleToMe(ev.x, ev.z)) {
            this.audio.at(ev.kind === 'bullet' || ev.kind === 'cannonball' ? 'gun' : ev.kind === 'stone' || ev.kind === 'boulder' ? 'catapult' : ev.kind === 'fire' ? 'fireLance' : 'bow', ev.x, ev.z);
            if (ev.kind === 'bullet' || ev.kind === 'cannonball' || ev.kind === 'fire') fx.smoke(ev.x, g.map.heightAt(ev.x, ev.z) + 0.6, ev.z, ev.kind === 'cannonball' ? 8 : 3);
          }
          break;
        case 'convert':
          if (this.visibleToMe(ev.x, ev.z)) fx.glow(ev.x, g.map.heightAt(ev.x, ev.z) + 0.5, ev.z, 16);
          if (this.mine(ev.from)) this.hud.message('One of your units has been converted!', 'alert');
          if (this.mine(ev.to)) this.audio.play('convert');
          break;
        case 'defeated':
          this.hud.message(`${g.players[ev.owner].name} has been defeated.`, this.mine(ev.owner) ? 'alert' : 'good');
          break;
        case 'gameover':
          this.ended = true;
          setTimeout(() => this.hud.showGameOver(), 1500);
          break;
        case 'msg':
          if (this.mine(ev.owner)) this.hud.message(ev.text, ev.kind === 'error' ? 'err' : 'info');
          break;
        case 'placed':
          if (this.mine(ev.owner)) this.audio.play('place');
          break;
        case 'fell':
          r.props.markDirty();
          break;
        case 'relics': {
          const mine = !this.viewAll && ev.team === g.teamOf[this.local];
          const names = g.players.filter((p) => !p.isGaia && p.team === ev.team).map((p) => p.name).join(' & ');
          if (ev.state === 'held') this.hud.message(mine ? 'You control every relic! Hold them for 600 seconds to win.' : `${names} control every relic! Victory in 600 seconds unless you take one.`, mine ? 'good' : 'alert');
          else this.hud.message(mine ? 'You no longer hold every relic.' : `${names} no longer hold every relic.`, 'info');
          break;
        }
        case 'wonder': {
          const p = g.players[ev.owner];
          if (ev.state === 'built') this.hud.message(`${p.name} has completed a Wonder! It must be destroyed within 600 seconds.`, 'alert');
          if (ev.state === 'destroyed') this.hud.message(`${p.name}'s Wonder has been destroyed.`, 'good');
          break;
        }
      }
    }
    g.events.length = 0;
    this.cleanSelection();
  }

  /** Smoke from chimneys, fire on damaged buildings. */
  private ambientFx(dt: number): void {
    this.fxTimer += dt;
    if (this.fxTimer < 0.12) return;
    this.fxTimer = 0;
    const g = this.game;
    const r = this.renderer;
    const team = this.viewTeam();
    const bit = 1 << (team & 15);
    for (const b of g.buildings) {
      if (!b.alive || !b.built) continue;
      if (team >= 0 && g.teamOf[b.owner] !== team && !(b.seenBy & bit)) continue;
      if (!r.inView(b.x, b.z, 3)) continue;
      const frac = b.hp / b.stats.hp;
      const h = buildingModel(b.type, g.players[b.owner].civ.style).height;
      if (frac < 0.66 && !b.def.walkable) {
        const n = frac < 0.25 ? 3 : frac < 0.5 ? 2 : 1;
        for (let i = 0; i < n; i++) {
          const x = b.tx + Math.random() * b.w, z = b.tz + Math.random() * b.h;
          r.fx.fire(x, b.baseY + h * (0.3 + Math.random() * 0.5), z, 1);
          if (Math.random() < 0.5) r.fx.smoke(x, b.baseY + h * 0.8, z, 1, true);
        }
      }
      if (b.type === 'blacksmith' && Math.random() < 0.5) r.fx.smoke(b.x - 0.9 + 1.5 - 1.5, b.baseY + h + 0.1, b.z - 0.9, 1);
      if (b.type === 'townCenter' && Math.random() < 0.15) r.fx.smoke(b.x - 0.4, b.baseY + 2.2, b.z - 0.4, 1);
    }
    // work particles
    for (const u of this.renderer.units.drawn) {
      if (u.anim !== 'work' || Math.random() > 0.25) continue;
      const y = g.map.heightAt(u.x, u.z);
      const fx = u.x + Math.sin(u.facing) * 0.3, fz = u.z + Math.cos(u.facing) * 0.3;
      if (u.tool === 'axe') r.fx.chips(fx, y + 0.3, fz, [0.75, 0.6, 0.35]);
      else if (u.tool === 'pick') r.fx.chips(fx, y + 0.2, fz, u.gatherKind === 'gold' ? [0.95, 0.8, 0.2] : [0.7, 0.7, 0.66]);
      else if (u.tool === 'hammer' && Math.random() < 0.4) r.fx.dust(fx, y + 0.1, fz, 1);
      else if (u.tool === 'hoe' && Math.random() < 0.3) r.fx.dust(u.x, y + 0.05, u.z, 1);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Overlay                                                              */
  /* ------------------------------------------------------------------ */

  private drawOverlay(): void {
    const ctx = this.octx;
    const w = this.root.clientWidth, h = this.root.clientHeight;
    ctx.clearRect(0, 0, w, h);
    const g = this.game;
    const r = this.renderer;
    const scale = r.zoom / 62;
    const drawBar = (x: number, y: number, frac: number, width: number, col: string) => {
      const bw = width * scale, bh = Math.max(3, 4 * scale);
      ctx.fillStyle = 'rgba(0,0,0,0.8)';
      ctx.fillRect(x - bw / 2 - 1, y - 1, bw + 2, bh + 2);
      ctx.fillStyle = '#8a1a10';
      ctx.fillRect(x - bw / 2, y, bw, bh);
      ctx.fillStyle = col;
      ctx.fillRect(x - bw / 2, y, bw * Math.max(0, Math.min(1, frac)), bh);
    };
    for (const e of this.selectedEntities()) {
      if (e.kind === 'unit') {
        const x = e.px + (e.x - e.px) * this.alpha, z = e.pz + (e.z - e.pz) * this.alpha;
        if (!r.inView(x, z, 1)) continue;
        const height = bakedHeight(e.def.model) ?? getRig(e.def.model).height;
        const p = r.project(x, g.map.surfaceAt(x, z) + height + 0.12, z);
        const col = e.owner === this.local ? '#3ae02a' : g.isEnemy(this.local, e.owner) ? '#e8401a' : '#e8e0a0';
        drawBar(p.x, p.y, e.hp / e.stats.hp, 32, col);
        if (e.def.monk && e.faith < 100) drawBar(p.x, p.y + 6 * scale, e.faith / 100, 32, '#5ab0ff');
      } else if (e.kind === 'building') {
        if (!r.inView(e.x, e.z, 3)) continue;
        const hgt = buildingModel(e.type, g.players[e.owner].civ.style).height;
        const p = r.project(e.x, e.baseY + (e.built ? hgt : hgt * e.progress) + 0.3, e.z);
        const col = e.owner === this.local ? '#3ae02a' : g.isEnemy(this.local, e.owner) ? '#e8401a' : '#e8e0a0';
        drawBar(p.x, p.y, e.hp / e.stats.hp, 20 + e.w * 12, col);
        if (!e.built) drawBar(p.x, p.y + 7 * scale, e.progress, 20 + e.w * 12, '#e8c040');
      }
    }
    // placement footprint for walls drag
    this.input.drawOverlay(ctx);
  }

  /** Village summary for the HUD. */
  villagerCounts(): Record<'food' | 'wood' | 'gold' | 'stone' | 'idle' | 'build', number> {
    const c = { food: 0, wood: 0, gold: 0, stone: 0, idle: 0, build: 0 };
    for (const u of this.game.units) {
      if (!u.alive || u.owner !== this.local || !u.def.gatherer || u.garrisonedIn) continue;
      if (u.order.t === 'idle') c.idle++;
      else if (u.order.t === 'build' || u.order.t === 'repair') c.build++;
      else if (u.order.t === 'gather' && u.gatherKind) {
        const k = u.gatherKind;
        if (k === 'wood') c.wood++;
        else if (k === 'gold') c.gold++;
        else if (k === 'stone') c.stone++;
        else c.food++;
      }
    }
    return c;
  }

  idleVillagers(): Unit[] {
    return this.game.units.filter((u) => u.alive && u.owner === this.local && u.def.gatherer && !u.garrisonedIn && u.order.t === 'idle');
  }

  timeScale(): number {
    return TICK;
  }
}

export type { GameSetup };
