import { BUILDINGS } from '../data/buildings';
import type { Building, Entity, Unit } from '../sim/entities';
import { canPlace } from '../sim/commands';
import { canGarrisonIn, isMilitary } from '../sim/unitAI';
import type { Session } from './session';

interface DownState {
  x: number;
  y: number;
  button: number;
  shift: boolean;
  ctrl: boolean;
  time: number;
}

export class Input {
  private s: Session;
  mx = -1;
  my = -1;
  private down: DownState | null = null;
  private dragging = false;
  private mid: { x: number; y: number; camX: number; camZ: number } | null = null;
  private keys = new Set<string>();
  private lastClick = { time: 0, id: 0 };
  private wallStart: { tx: number; tz: number } | null = null;
  private lastGroupKey = { k: -1, t: 0 };
  private inWindow = true;
  private tcCycle = 0;
  private idleCycle = 0;
  private milCycle = 0;

  constructor(s: Session) {
    this.s = s;
    const c = s.canvas;
    c.addEventListener('mousedown', this.onDown);
    window.addEventListener('mousemove', this.onMove);
    window.addEventListener('mouseup', this.onUp);
    c.addEventListener('wheel', this.onWheel, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mouseleave', this.onLeave);
    document.addEventListener('mouseenter', this.onEnter);
    window.addEventListener('blur', this.onBlur);
  }

  dispose(): void {
    const c = this.s.canvas;
    c.removeEventListener('mousedown', this.onDown);
    window.removeEventListener('mousemove', this.onMove);
    window.removeEventListener('mouseup', this.onUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mouseleave', this.onLeave);
    document.removeEventListener('mouseenter', this.onEnter);
    window.removeEventListener('blur', this.onBlur);
  }

  private onLeave = (): void => {
    this.inWindow = false;
  };
  private onEnter = (): void => {
    this.inWindow = true;
  };
  private onBlur = (): void => {
    this.keys.clear();
  };

  /* ------------------------------------------------------------------ */
  /* Camera                                                               */
  /* ------------------------------------------------------------------ */

  private pan(dxScreen: number, dyScreen: number): void {
    const r = this.s.renderer;
    // screen right = world (1,0,-1)/sqrt2, screen up = world (-1,0,-1)/sqrt2 (ground compresses 2:1 vertically)
    const k = 1 / r.zoom / Math.SQRT2;
    const up = -dyScreen * 2;
    r.centerOn(r.camX + (dxScreen - up) * k, r.camZ + (-dxScreen - up) * k);
  }

  update(dt: number): void {
    const s = this.s;
    if (s.hud.isModalOpen()) return;
    let dx = 0, dy = 0;
    const speed = 1100 * dt;
    if (this.keys.has('ArrowLeft')) dx -= speed;
    if (this.keys.has('ArrowRight')) dx += speed;
    if (this.keys.has('ArrowUp')) dy -= speed;
    if (this.keys.has('ArrowDown')) dy += speed;
    if (this.inWindow && this.mx >= 0 && !this.mid && !this.down) {
      const w = window.innerWidth, h = window.innerHeight, e = 6;
      if (this.mx <= e) dx -= speed;
      if (this.mx >= w - e) dx += speed;
      if (this.my <= e) dy -= speed;
      if (this.my >= h - e) dy += speed;
    }
    if (dx || dy) this.pan(dx, dy * 0.8);
    // placement ghost
    if (s.placing && this.mx >= 0 && !this.overHud()) {
      const t = this.placementTile();
      if (this.wallStart && BUILDINGS[s.placing.type].wall) {
        s.renderer.showGhost(s.placing.type, t.tx, t.tz, canPlace(s.game, s.local, s.placing.type, t.tx, t.tz), false);
      } else {
        const ok = canPlace(s.game, s.local, s.placing.type, t.tx, t.tz, s.placing.rotated);
        s.renderer.showGhost(s.placing.type, t.tx, t.tz, ok, s.placing.rotated);
      }
    } else if (!s.placing) s.renderer.showGhost(null);
    // cursor
    const c = s.canvas;
    const cur = s.targeting ? 'crosshair' : s.placing ? 'cell' : 'default';
    if (c.style.cursor !== cur) c.style.cursor = cur;
  }

  private overHud(): boolean {
    const el = document.elementFromPoint(this.mx, this.my);
    return !!el && el !== this.s.canvas && el.id !== 'overlay';
  }

  private placementTile(): { tx: number; tz: number } {
    const s = this.s;
    const def = BUILDINGS[s.placing!.type];
    const g = s.renderer.screenToGround(this.mx, this.my);
    const w = s.placing!.rotated ? def.size[1] : def.size[0];
    const h = s.placing!.rotated ? def.size[0] : def.size[1];
    return { tx: Math.round(g.x - w / 2), tz: Math.round(g.z - h / 2) };
  }

  /* ------------------------------------------------------------------ */
  /* Mouse                                                                */
  /* ------------------------------------------------------------------ */

  private onDown = (e: MouseEvent): void => {
    const s = this.s;
    if (s.hud.isModalOpen()) return;
    this.mx = e.clientX;
    this.my = e.clientY;
    s.audio.unlock();
    if (e.button === 1) {
      e.preventDefault();
      this.mid = { x: e.clientX, y: e.clientY, camX: s.renderer.camX, camZ: s.renderer.camZ };
      return;
    }
    if (e.button === 2) {
      if (s.placing || s.targeting) {
        s.cancelModes();
        this.wallStart = null;
        return;
      }
      this.rightClick(e.shiftKey);
      return;
    }
    if (e.button !== 0) return;
    if (s.placing) {
      const def = BUILDINGS[s.placing.type];
      const t = this.placementTile();
      if (def.wall) {
        this.wallStart = t;
        return;
      }
      const units = s.ownSelectedUnits().filter((u) => u.def.builder).map((u) => u.id);
      const r = s.issue({ c: 'build', units, building: s.placing.type, tx: t.tx, tz: t.tz, rotated: s.placing.rotated, queue: e.shiftKey });
      if (r.ok && !e.shiftKey) {
        s.placing = null;
        s.renderer.showGhost(null);
        s.panelMode = 'main';
      }
      return;
    }
    if (s.targeting) {
      this.applyTargeting(e.shiftKey);
      if (!e.shiftKey) s.targeting = null;
      return;
    }
    this.down = { x: e.clientX, y: e.clientY, button: 0, shift: e.shiftKey, ctrl: e.ctrlKey, time: performance.now() };
    this.dragging = false;
  };

  private onMove = (e: MouseEvent): void => {
    this.mx = e.clientX;
    this.my = e.clientY;
    this.inWindow = true;
    if (this.mid) {
      const r = this.s.renderer;
      const k = 1 / r.zoom / Math.SQRT2;
      const dx = -(e.clientX - this.mid.x), dy = -(e.clientY - this.mid.y);
      const up = -dy * 2;
      r.centerOn(this.mid.camX + (dx - up) * k, this.mid.camZ + (-dx - up) * k);
      return;
    }
    if (this.down && !this.dragging && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 5) this.dragging = true;
    const box = this.s.hud.selBox;
    if (this.down && this.dragging) {
      const x0 = Math.min(this.down.x, e.clientX), y0 = Math.min(this.down.y, e.clientY);
      box.style.display = 'block';
      box.style.left = `${x0}px`;
      box.style.top = `${y0}px`;
      box.style.width = `${Math.abs(e.clientX - this.down.x)}px`;
      box.style.height = `${Math.abs(e.clientY - this.down.y)}px`;
    }
  };

  private onUp = (e: MouseEvent): void => {
    const s = this.s;
    if (e.button === 1) {
      this.mid = null;
      return;
    }
    if (e.button !== 0) return;
    if (this.wallStart && s.placing) {
      const end = this.placementTile();
      const tiles = lineTiles(this.wallStart.tx, this.wallStart.tz, end.tx, end.tz);
      const units = s.ownSelectedUnits().filter((u) => u.def.builder).map((u) => u.id);
      const r = s.issue({ c: 'buildLine', units, building: s.placing.type, tiles, queue: e.shiftKey });
      this.wallStart = null;
      if (r.ok && !e.shiftKey) {
        s.placing = null;
        s.renderer.showGhost(null);
        s.panelMode = 'main';
      }
      return;
    }
    const d = this.down;
    this.down = null;
    s.hud.selBox.style.display = 'none';
    if (!d) return;
    if (this.dragging) {
      this.dragging = false;
      this.boxSelect(d.x, d.y, e.clientX, e.clientY, d.shift);
      return;
    }
    this.clickSelect(e.clientX, e.clientY, d.shift, d.ctrl);
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const r = this.s.renderer;
    const before = r.screenToGround(e.clientX, e.clientY);
    r.setZoom(r.zoom * Math.pow(1.1, -e.deltaY / 100));
    const after = r.screenToGround(e.clientX, e.clientY);
    r.centerOn(r.camX + before.x - after.x, r.camZ + before.z - after.z);
  };

  /* ------------------------------------------------------------------ */
  /* Selection                                                            */
  /* ------------------------------------------------------------------ */

  private visibleEntity(e: Entity): boolean {
    return true;
  }

  private clickSelect(x: number, y: number, shift: boolean, ctrl: boolean): void {
    const s = this.s;
    const e = s.renderer.pick(x, y, (en) => this.visibleEntity(en));
    if (!e) {
      if (!shift) s.select([]);
      return;
    }
    const now = performance.now();
    const dbl = now - this.lastClick.time < 350 && this.lastClick.id === e.id;
    this.lastClick = { time: now, id: e.id };
    if ((dbl || ctrl) && e.owner === s.local && e.kind !== 'resource') {
      // all of this type on screen
      const same: number[] = [];
      if (e.kind === 'unit') {
        for (const u of s.renderer.units.drawn) if (u.owner === s.local && u.type === e.type) same.push(u.id);
      } else {
        for (const b of s.game.buildings) if (b.alive && b.owner === s.local && b.type === e.type && s.renderer.inView(b.x, b.z, 0)) same.push(b.id);
      }
      s.select(same, shift);
      return;
    }
    s.select([e.id], shift);
  }

  private boxSelect(x0: number, y0: number, x1: number, y1: number, shift: boolean): void {
    const s = this.s;
    const units = s.renderer.unitsInRect(x0, y0, x1, y1);
    let own = units.filter((u) => u.owner === s.local);
    // livestock only when nothing else is in the box
    if (own.some((u) => !u.def.animal)) own = own.filter((u) => !u.def.animal);
    let pick: Unit[] = own;
    if (!own.length) pick = units.filter((u) => !u.def.animal).slice(0, 1);
    if (!pick.length && !shift) {
      s.select([]);
      return;
    }
    s.select(pick.map((u) => u.id), shift);
  }

  selectIdleVillager(): void {
    const s = this.s;
    const idle = s.idleVillagers();
    if (!idle.length) return;
    const u = idle[this.idleCycle++ % idle.length];
    s.select([u.id]);
    s.renderer.centerOn(u.x, u.z);
  }

  selectIdleMilitary(): void {
    const s = this.s;
    const idle = s.game.units.filter((u) => u.alive && u.owner === s.local && !u.garrisonedIn && isMilitary(u) && u.order.t === 'idle');
    if (!idle.length) return;
    const u = idle[this.milCycle++ % idle.length];
    s.select([u.id]);
    s.renderer.centerOn(u.x, u.z);
  }

  selectTC(): void {
    const s = this.s;
    const tcs = s.game.buildings.filter((b) => b.alive && b.owner === s.local && b.type === 'townCenter');
    if (!tcs.length) return;
    const b = tcs[this.tcCycle++ % tcs.length];
    s.select([b.id]);
    s.renderer.centerOn(b.x, b.z);
  }

  /* ------------------------------------------------------------------ */
  /* Commands                                                             */
  /* ------------------------------------------------------------------ */

  private applyTargeting(shift: boolean): void {
    const s = this.s;
    const g = s.renderer.screenToGround(this.mx, this.my);
    const target = s.renderer.pick(this.mx, this.my);
    const units = s.ownSelectedUnits().map((u) => u.id);
    const fx = s.renderer.fx;
    switch (s.targeting) {
      case 'attackMove':
        s.issue({ c: 'move', units, x: g.x, z: g.z, attackMove: true, queue: shift });
        fx.addMarker(g.x, g.z, performance.now() / 1000, 0xff4040);
        break;
      case 'patrol':
        s.issue({ c: 'patrol', units, x: g.x, z: g.z });
        fx.addMarker(g.x, g.z, performance.now() / 1000, 0xffe040);
        break;
      case 'follow':
        if (target && target.kind === 'unit') s.issue({ c: 'follow', units, target: target.id });
        break;
      case 'garrison':
        if (target && (target.kind === 'building' || target.kind === 'unit')) s.issue({ c: 'garrison', units, target: target.id });
        break;
      case 'repair':
        if (target && target.kind !== 'resource') s.issue({ c: 'repair', units, target: target.id, queue: shift });
        break;
      case 'attackGround':
        s.issue({ c: 'attackGround', units, x: g.x, z: g.z });
        fx.addMarker(g.x, g.z, performance.now() / 1000, 0xff4040);
        break;
      case 'heal':
        if (target && target.kind === 'unit') s.issue({ c: 'heal', units, target: target.id });
        break;
      case 'convert':
        if (target && target.kind === 'unit') s.issue({ c: 'convert', units, target: target.id });
        break;
      case 'unloadAt':
        s.issue({ c: 'unloadAt', units, x: g.x, z: g.z });
        fx.addMarker(g.x, g.z, performance.now() / 1000, 0x40ff40);
        break;
      case 'rally': {
        const blds = s.selectedEntities().filter((e): e is Building => e.kind === 'building' && e.owner === s.local).map((b) => b.id);
        s.issue({ c: 'rally', buildings: blds, x: g.x, z: g.z, target: target && target.kind !== 'unit' ? target.id : 0 });
        break;
      }
    }
  }

  private rightClick(shift: boolean): void {
    const s = this.s;
    const target = s.renderer.pick(this.mx, this.my);
    const g = s.renderer.screenToGround(this.mx, this.my);
    this.smartCommand(target, g.x, g.z, shift);
  }

  commandAtGround(x: number, z: number, shift: boolean): void {
    this.smartCommand(null, x, z, shift);
  }

  smartCommand(target: Entity | null, x: number, z: number, queue: boolean): void {
    const s = this.s;
    const game = s.game;
    const me = s.local;
    const units = s.ownSelectedUnits();
    const fx = s.renderer.fx;
    const now = performance.now() / 1000;
    if (!units.length) {
      const blds = s.selectedEntities().filter((e): e is Building => e.kind === 'building' && e.owner === me && (!!e.def.trains?.length || e.type === 'townCenter'));
      if (blds.length) {
        s.issue({ c: 'rally', buildings: blds.map((b) => b.id), x, z, target: target && target.kind !== 'unit' ? target.id : target && target.kind === 'unit' && target.def.animal ? target.id : 0 });
        fx.addMarker(x, z, now, 0x40ff40);
        s.audio.play('click');
      }
      return;
    }
    const vills = units.filter((u) => u.def.gatherer);
    const monks = units.filter((u) => u.def.monk);
    const traders = units.filter((u) => u.def.trader);
    const others = units.filter((u) => !u.def.gatherer && !u.def.monk && !u.def.trader);
    const ids = (a: Unit[]) => a.map((u) => u.id);
    const moveAll = (list: Unit[]) => {
      if (list.length) s.issue({ c: 'move', units: ids(list), x, z, queue });
    };
    let acked = false;
    const ack = (kind: 'move' | 'attack' | 'work') => {
      if (acked) return;
      acked = true;
      s.audio.ackSound(units[0], kind);
    };
    if (!target) {
      // loaded transports clicked onto land put their troops ashore there
      const onLand = !game.map.tileWater(Math.floor(x), Math.floor(z));
      const transports = units.filter((u) => u.def.transport && u.cargo.length);
      if (onLand && transports.length) {
        s.issue({ c: 'unloadAt', units: ids(transports), x, z });
        moveAll(units.filter((u) => !transports.includes(u)));
      } else moveAll(units);
      fx.addMarker(x, z, now, 0x40ff40);
      ack('move');
      return;
    }
    if (target.kind === 'unit') {
      const t = target;
      const enemy = game.isEnemy(me, t.owner);
      if (enemy || t.def.animal === 'wolf') {
        if (others.length) s.issue({ c: 'attack', units: ids(others), target: t.id, queue });
        if (vills.length) s.issue({ c: 'attack', units: ids(vills), target: t.id, queue });
        if (monks.length) s.issue({ c: enemy ? 'convert' : 'attack', units: ids(monks), target: t.id } as never);
        moveAll(traders);
        fx.addMarker(t.x, t.z, now, 0xff4040);
        ack('attack');
        return;
      }
      if (t.def.animal) {
        if (vills.length) s.issue({ c: 'gather', units: ids(vills), target: t.id, queue });
        if (others.length) {
          if (t.def.herdable && t.owner === me) moveAll(others);
          else s.issue({ c: 'attack', units: ids(others), target: t.id, queue });
        }
        moveAll(monks);
        moveAll(traders);
        ack('work');
        return;
      }
      // own / allied unit
      if (monks.length && t.hp < t.stats.hp) s.issue({ c: 'heal', units: ids(monks), target: t.id });
      else moveAll(monks);
      if (t.def.transport && t.owner === me) {
        const land = units.filter((u) => !u.def.naval);
        if (land.length) s.issue({ c: 'garrison', units: ids(land), target: t.id });
        fx.addMarker(t.x, t.z, now, 0x40ff40);
        ack('move');
        return;
      }
      if (t.def.garrisonCapacity && t.owner === me) {
        const inf = [...others, ...vills].filter((u) => u.def.classes.includes('infantry'));
        if (inf.length) s.issue({ c: 'garrison', units: ids(inf), target: t.id });
        moveAll([...others, ...vills].filter((u) => !u.def.classes.includes('infantry')));
      } else {
        moveAll(others);
        moveAll(vills);
      }
      moveAll(traders);
      fx.addMarker(x, z, now, 0x40ff40);
      ack('move');
      return;
    }
    if (target.kind === 'building') {
      const b = target;
      if (game.isEnemy(me, b.owner)) {
        const attackers = [...others, ...vills];
        if (attackers.length) s.issue({ c: 'attack', units: ids(attackers), target: b.id, queue });
        moveAll(monks);
        moveAll(traders);
        fx.addMarker(b.x, b.z, now, 0xff4040);
        ack('attack');
        return;
      }
      // own or allied
      if (vills.length) {
        if (!b.built) s.issue({ c: 'repair', units: ids(vills), target: b.id, queue });
        else if (b.def.foodCapacity && b.owner === me) s.issue({ c: 'gather', units: ids(vills), target: b.id, queue });
        else if (b.hp < b.stats.hp - 0.5) s.issue({ c: 'repair', units: ids(vills), target: b.id, queue });
        else {
          const carriers = vills.filter((u) => u.carryType && b.def.dropoff?.includes(u.carryType));
          if (carriers.length) s.issue({ c: 'dropoff', units: ids(carriers), target: b.id });
          const rest = vills.filter((u) => !carriers.includes(u));
          const garr = rest.filter((u) => canGarrisonIn(game, u, b));
          if (garr.length && b.owner === me && b.def.garrison && b.type !== 'monastery') s.issue({ c: 'garrison', units: ids(garr), target: b.id });
          else moveAll(rest);
        }
      }
      if (monks.length) {
        if (b.type === 'monastery' && b.owner === me) s.issue({ c: 'garrison', units: ids(monks), target: b.id });
        else moveAll(monks);
      }
      if (traders.length) {
        const carts = traders.filter((u) => !u.def.naval), cogs = traders.filter((u) => u.def.naval);
        if (b.type === 'market' && b.built && carts.length) s.issue({ c: 'trade', units: ids(carts), target: b.id });
        else moveAll(carts);
        if (b.type === 'dock' && b.built && cogs.length) s.issue({ c: 'trade', units: ids(cogs), target: b.id });
        else moveAll(cogs);
      }
      if (others.length) {
        const garr = others.filter((u) => b.owner === me && canGarrisonIn(game, u, b));
        if (garr.length) s.issue({ c: 'garrison', units: ids(garr), target: b.id });
        const rest = others.filter((u) => !garr.includes(u));
        if (rest.length) {
          if (b.hp < b.stats.hp && rest.some((u) => u.def.classes.includes('siege'))) moveAll(rest);
          else moveAll(rest);
        }
      }
      fx.addMarker(b.x, b.z, now, 0x40ff40);
      ack('work');
      return;
    }
    // resource
    const r = target;
    if (r.type === 'relic') {
      if (monks.length) s.issue({ c: 'relic', units: ids(monks), target: r.id });
      moveAll([...vills, ...others, ...traders]);
      ack('work');
      return;
    }
    if (vills.length) s.issue({ c: 'gather', units: ids(vills), target: r.id, queue });
    moveAll([...others, ...monks, ...traders]);
    fx.addMarker(r.x, r.z, now, 0x40ff40);
    ack('work');
  }

  /* ------------------------------------------------------------------ */
  /* Keyboard                                                             */
  /* ------------------------------------------------------------------ */

  private onKeyDown = (e: KeyboardEvent): void => {
    const s = this.s;
    if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
    this.keys.add(e.key);
    if (e.key === 'F10' || (e.key === 'Escape' && s.hud.isModalOpen())) {
      e.preventDefault();
      if (s.hud.isModalOpen()) {
        s.hud.closeModal();
        s.paused = false;
      } else s.hud.showMenu();
      return;
    }
    if (s.hud.isModalOpen()) return;
    if (e.key === 'Escape') {
      if (!s.cancelModes()) {
        if (s.selection.length) s.select([]);
      }
      this.wallStart = null;
      return;
    }
    if (e.key === 'F3' || e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      s.paused = !s.paused;
      return;
    }
    if (e.key === '+' || e.key === '=') {
      s.speed = Math.min(4, +(s.speed + 0.5).toFixed(1));
      s.hud.message(`Game speed ${s.speed}×`);
      return;
    }
    if (e.key === '-' || e.key === '_') {
      s.speed = Math.max(0.5, +(s.speed - 0.5).toFixed(1));
      s.hud.message(`Game speed ${s.speed}×`);
      return;
    }
    if (e.key === 'Delete') {
      s.deleteSelected();
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      s.jumpToAlert();
      return;
    }
    if (e.key === '.') {
      this.selectIdleVillager();
      return;
    }
    if (e.key === ',') {
      this.selectIdleMilitary();
      return;
    }
    if (e.key === 'Home') {
      const sel = s.selectedEntities()[0];
      if (sel) s.renderer.centerOn(sel.x, sel.z);
      return;
    }
    if (/^[0-9]$/.test(e.key)) {
      const k = Number(e.key);
      if (e.ctrlKey) {
        e.preventDefault();
        s.groups[k] = s.selection.filter((id) => s.game.get(id)?.owner === s.local);
        s.hud.message(`Group ${k} assigned`);
      } else {
        const ids = s.groups[k].filter((id) => s.game.get(id)?.alive);
        if (ids.length) {
          s.select(ids, e.shiftKey);
          const now = performance.now();
          if (this.lastGroupKey.k === k && now - this.lastGroupKey.t < 400) {
            const first = s.game.get(ids[0]);
            if (first) s.renderer.centerOn(first.x, first.z);
          }
          this.lastGroupKey = { k, t: now };
        }
      }
      return;
    }
    if ((e.key === 'r' || e.key === 'R') && s.placing && BUILDINGS[s.placing.type].gate) {
      s.placing.rotated = !s.placing.rotated;
      return;
    }
    if (e.key === 'h' || e.key === 'H') {
      if (!e.ctrlKey) {
        this.selectTC();
        return;
      }
    }
    if (e.key.length === 1 && s.hud.hotkey(e.key, e.shiftKey)) {
      e.preventDefault();
      return;
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key);
  };

  /** Draw wall-line preview on the 2D overlay. */
  drawOverlay(ctx: CanvasRenderingContext2D): void {
    const s = this.s;
    if (!this.wallStart || !s.placing) return;
    const end = this.placementTile();
    const tiles = lineTiles(this.wallStart.tx, this.wallStart.tz, end.tx, end.tz);
    const r = s.renderer;
    for (const [tx, tz] of tiles) {
      const ok = canPlace(s.game, s.local, s.placing.type, tx, tz);
      const y = s.game.map.heightAt(tx + 0.5, tz + 0.5);
      const pts = [[tx, tz], [tx + 1, tz], [tx + 1, tz + 1], [tx, tz + 1]].map(([x, z]) => r.project(x, y + 0.05, z));
      ctx.fillStyle = ok ? 'rgba(80,255,80,0.35)' : 'rgba(255,60,60,0.35)';
      ctx.strokeStyle = ok ? 'rgba(80,255,80,0.9)' : 'rgba(255,60,60,0.9)';
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }
}

/** 4-connected tiles on a straight line, used for wall dragging. */
export function lineTiles(x0: number, z0: number, x1: number, z1: number): [number, number][] {
  const out: [number, number][] = [[x0, z0]];
  const n = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
  let px = x0, pz = z0;
  for (let i = 1; i <= n && i < 200; i++) {
    const t = i / n;
    const x = Math.round(x0 + (x1 - x0) * t), z = Math.round(z0 + (z1 - z0) * t);
    if (x !== px && z !== pz) out.push([x, pz]);
    if (x !== px || z !== pz) out.push([x, z]);
    px = x;
    pz = z;
  }
  return out;
}
