import { AGE_NAMES, type Cost, type Res } from '../data/types';
import { TECHS } from '../data/techs';
import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';
import { formatTime } from '../util/math';
import type { Building, Entity, Unit } from '../sim/entities';
import { computeButtons, entityIcon, GRID_KEYS, type CmdButton } from './commandPanel';
import { resIcon, unitIcon, techIcon, civEmblem } from './icons';
import type { Session } from './session';
import { deleteSave, formatClock, listSaves, saveListHtml, type SaveMeta } from './saves';

const RES_ORDER: Res[] = ['wood', 'food', 'gold', 'stone'];
/** How long a touch must rest on a command button to show its tooltip. */
const HOLD_MS = 450;

export class Hud {
  s: Session;
  root: HTMLElement;
  minimapCanvas: HTMLCanvasElement;
  private resEls: Record<string, HTMLElement> = {};
  private vcEls: Record<string, HTMLElement> = {};
  private popEl: HTMLElement;
  private ageEl: HTMLElement;
  private ageProg: HTMLElement;
  private clockEl: HTMLElement;
  private msgEl: HTMLElement;
  private cmdEl: HTMLElement;
  private infoEl: HTMLElement;
  private tipEl: HTMLElement;
  private idleEl: HTMLElement;
  private scoresEl: HTMLElement;
  private specEl: HTMLElement | null = null;
  selBox: HTMLElement;
  private lastUpdate = 0;
  private cmdSig = '';
  private infoSig = '';
  private buttons: CmdButton[] = [];
  private pressedCommand: HTMLElement | null = null;
  private tipOwner: HTMLElement | null = null;
  private modal: HTMLElement | null = null;
  private pausedEl: HTMLElement;

  constructor(s: Session, root: HTMLElement) {
    this.s = s;
    this.root = root;
    const p = s.game.players[s.local];
    root.innerHTML = `
      <div id="topbar" class="wood">
        ${RES_ORDER.map((r) => `<div class="res" data-tip="${r}" id="res-${r}"><img src="${resIcon(r)}"><span class="val">0</span><span class="vc"></span></div>`).join('')}
        <div class="res" id="res-pop" data-tip="pop"><img src="${resIcon('pop')}"><span class="val">0/0</span></div>
        <div id="age-box"><span id="age-name">Dark Age</span> <span class="civ">— ${p.civ.name}</span><div id="age-prog"><div></div></div></div>
        <span id="clock">00:00:00</span>
        ${s.spectator ? `<label id="viewpick">Watching <select id="viewsel"><option value="0">Everyone</option>${s.game.players.filter((q) => !q.isGaia).map((q) => `<option value="${q.id}">${escapeHtml(q.name)} (${q.civ.name})</option>`).join('')}</select></label>` : ''}
        <button class="topbtn" id="btn-civ">Civilization</button>
        <button class="topbtn" id="btn-help">Help</button>
        <button class="topbtn" id="btn-menu">Menu</button>
      </div>
      <div id="messages"></div>
      <div id="scores"></div>
      ${s.spectator ? '<div id="specboard" class="wood"></div>' : ''}
      <div id="touch-controls" role="group" aria-label="Touch controls">
        <div id="touch-hint" role="status">Drag to pan · Pinch to zoom · Help for gestures</div>
        <button class="touchbtn" id="touch-select" type="button" aria-pressed="false" aria-label="Select units with the next drag">Select</button>
        <button class="touchbtn" id="touch-command" type="button" aria-pressed="false" aria-label="Interact with a friendly unit or building instead of selecting it" disabled>Interact</button>
        <button class="touchbtn" id="touch-rotate" type="button" hidden aria-label="Rotate gate">Rotate</button>
        <button class="touchbtn" id="touch-cancel" type="button" disabled>Deselect</button>
      </div>
      <div id="bottom" class="wood">
        <div id="cmd"></div>
        <div id="info"></div>
        <div id="mapwrap"><canvas id="minimap" width="560" height="300"></canvas><div id="idlebtn" title="Idle villager (.)"><span class="n">0</span></div></div>
      </div>
      <div id="tooltip"></div>
      <div id="selbox"></div>
    `;
    for (const r of RES_ORDER) {
      this.resEls[r] = root.querySelector(`#res-${r} .val`) as HTMLElement;
      this.vcEls[r] = root.querySelector(`#res-${r} .vc`) as HTMLElement;
    }
    this.popEl = root.querySelector('#res-pop .val') as HTMLElement;
    this.ageEl = root.querySelector('#age-name') as HTMLElement;
    this.ageProg = root.querySelector('#age-prog') as HTMLElement;
    this.clockEl = root.querySelector('#clock') as HTMLElement;
    this.msgEl = root.querySelector('#messages') as HTMLElement;
    this.cmdEl = root.querySelector('#cmd') as HTMLElement;
    this.infoEl = root.querySelector('#info') as HTMLElement;
    this.tipEl = root.querySelector('#tooltip') as HTMLElement;
    this.idleEl = root.querySelector('#idlebtn') as HTMLElement;
    this.scoresEl = root.querySelector('#scores') as HTMLElement;
    this.selBox = root.querySelector('#selbox') as HTMLElement;
    this.minimapCanvas = root.querySelector('#minimap') as HTMLCanvasElement;
    this.idleEl.style.backgroundImage = `url(${unitIcon('villager', p.color.hex)})`;
    this.idleEl.addEventListener('click', () => this.s.input.selectIdleVillager());
    this.specEl = root.querySelector('#specboard');
    const viewSel = root.querySelector('#viewsel') as HTMLSelectElement | null;
    if (viewSel) {
      viewSel.addEventListener('change', () => this.s.setView(Number(viewSel.value)));
      // the game's hotkeys should not fire while choosing
      viewSel.addEventListener('keydown', (e) => e.stopPropagation());
    }
    if (s.spectator) this.refreshView();
    (root.querySelector('#btn-menu') as HTMLElement).addEventListener('click', () => this.showMenu());
    (root.querySelector('#btn-help') as HTMLElement).addEventListener('click', () => this.showHelp());
    (root.querySelector('#btn-civ') as HTMLElement).addEventListener('click', () => this.showCivInfo());
    for (const mode of ['select', 'command'] as const) {
      root.querySelector(`#touch-${mode}`)!.addEventListener('click', () => {
        this.s.input.setTouchMode(this.s.input.touchMode === mode ? 'auto' : mode);
        this.updateTouchControls();
      });
    }
    root.querySelector('#touch-cancel')!.addEventListener('click', () => {
      this.s.input.cancelTouchAction();
      this.refreshCommands();
      this.updateTouchControls();
    });
    root.querySelector('#touch-rotate')!.addEventListener('click', () => {
      if (this.s.placing && BUILDINGS[this.s.placing.type].gate) {
        this.s.placing.rotated = !this.s.placing.rotated;
      }
    });
    this.pausedEl = document.createElement('div');
    this.pausedEl.className = 'paused-banner';
    this.pausedEl.textContent = 'Paused';
    this.pausedEl.style.display = 'none';
    root.appendChild(this.pausedEl);
    // resource tooltips
    root.querySelectorAll('.res').forEach((el) => {
      el.addEventListener('pointerenter', (event) => {
        if ((event as PointerEvent).pointerType !== 'mouse') return;
        const k = (el as HTMLElement).dataset.tip!;
        const names: Record<string, string> = { wood: 'Wood', food: 'Food', gold: 'Gold', stone: 'Stone', pop: 'Population' };
        const vc = this.s.villagerCounts();
        const desc = k === 'pop' ? `Units / population capacity. Build houses to raise it (max ${this.s.game.players[this.s.local].maxPop}). Idle villagers: ${vc.idle}, building: ${vc.build}.`
          : `Villagers gathering ${names[k].toLowerCase()}: ${vc[k as Res]}`;
        this.showTip(el as HTMLElement, `<div class="tt-title">${names[k]}</div><div>${desc}</div>`);
      });
      el.addEventListener('pointerleave', () => this.hideTip());
    });
  }

  /* ------------------------------------------------------------------ */
  message(text: string, kind: 'info' | 'err' | 'alert' | 'good' = 'info'): void {
    const el = document.createElement('div');
    el.className = 'msg ' + kind;
    el.textContent = text;
    this.msgEl.appendChild(el);
    while (this.msgEl.children.length > 7) this.msgEl.removeChild(this.msgEl.firstChild!);
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 1000);
    }, kind === 'err' ? 3500 : 9000);
  }

  /* ------------------------------------------------------------------ */
  update(now: number): void {
    this.pausedEl.style.display = this.s.paused && !this.modal ? 'block' : 'none';
    if (now - this.lastUpdate < 120) return;
    this.lastUpdate = now;
    const g = this.s.game;
    const p = g.players[this.s.local];
    const vc = this.s.villagerCounts();
    for (const r of RES_ORDER) {
      this.resEls[r].textContent = String(Math.floor(p.res[r]));
      this.vcEls[r].textContent = vc[r] ? String(vc[r]) : '';
    }
    this.popEl.textContent = `${p.pop}/${p.popCap}`;
    (this.popEl.parentElement as HTMLElement).classList.toggle('warn', p.pop >= p.popCap);
    this.ageEl.textContent = AGE_NAMES[p.age];
    // age research progress
    let ageFrac = -1;
    for (const b of g.buildings) {
      if (b.owner !== this.s.local || !b.queue[0] || b.queue[0].kind !== 'tech') continue;
      const t = TECHS[b.queue[0].id];
      if (t?.isAge) ageFrac = b.queueTime / t.time;
    }
    this.ageProg.style.display = ageFrac >= 0 ? 'block' : 'none';
    if (ageFrac >= 0) {
      (this.ageProg.firstElementChild as HTMLElement).style.width = `${(ageFrac * 100).toFixed(1)}%`;
      this.ageEl.textContent = `${AGE_NAMES[p.age]} → ${AGE_NAMES[Math.min(3, p.age + 1)]}`;
    }
    this.clockEl.textContent = formatTime(g.time);
    const idle = vc.idle;
    (this.idleEl.firstElementChild as HTMLElement).textContent = idle ? String(idle) : '';
    this.idleEl.classList.toggle('none', idle === 0);
    this.updateScores();
    this.updateSpectator();
    this.updateCommands();
    this.updateInfo();
    this.updateTouchControls();
  }

  private updateTouchControls(): void {
    const s = this.s;
    const mode = s.input.touchMode;
    for (const name of ['select', 'command'] as const) {
      this.root.querySelector(`#touch-${name}`)!.setAttribute('aria-pressed', String(mode === name));
    }
    const hasSelection = s.selection.length > 0;
    const ownSelection = s.selectedEntities().filter((e) => e.owner === s.local);
    const hasUnits = ownSelection.some((e) => e.kind === 'unit');
    const canRally = ownSelection.some((e) => e.kind === 'building' && (!!e.def.trains?.length || e.type === 'townCenter'));
    const canCommand = !s.spectator && !s.game.players[s.local].defeated && (hasUnits || canRally);
    const command = this.root.querySelector('#touch-command') as HTMLButtonElement;
    command.disabled = !canCommand;
    command.textContent = !hasUnits && canRally ? 'Rally' : 'Interact';
    const commandHelp = !hasUnits && canRally ? 'Set the selected building\'s rally point with the next tap'
      : 'Interact with a friendly unit or building instead of selecting it';
    command.setAttribute('aria-label', commandHelp);
    command.title = commandHelp;
    (this.root.querySelector('#touch-rotate') as HTMLButtonElement).hidden = !s.placing || !BUILDINGS[s.placing.type].gate || s.spectator;
    const hasAction = mode !== 'auto' || !!s.placing || !!s.targeting || s.panelMode !== 'main';
    const cancel = this.root.querySelector('#touch-cancel') as HTMLButtonElement;
    cancel.textContent = hasAction ? 'Cancel' : 'Deselect';
    cancel.disabled = !hasSelection && !hasAction;
    let hint = 'Drag to pan · Pinch to zoom · Help for gestures';
    if (s.placing) hint = BUILDINGS[s.placing.type].wall ? 'Drag to draw a wall · Cancel to go back' : `Tap to place ${BUILDINGS[s.placing.type].name}`;
    else if (mode === 'command') hint = !hasUnits && canRally ? 'Tap where new units should gather' : 'Tap a friendly target to interact with it';
    else if (s.targeting) hint = 'Tap a target to command · Cancel to go back';
    else if (mode === 'select') hint = 'Drag a box around units to select';
    else if (canCommand) hint = hasUnits
      ? 'Tap ground, resources or enemies to command'
      : 'Use Rally, then tap where new units should gather';
    const hintEl = this.root.querySelector('#touch-hint')!;
    if (hintEl.textContent !== hint) hintEl.textContent = hint;
  }

  /** Spectating: the top bar shows the watched player's resources, or nothing when watching everyone. */
  refreshView(): void {
    const s = this.s;
    const p = s.game.players[s.local];
    this.root.querySelectorAll('#topbar .res, #age-box').forEach((el) => { (el as HTMLElement).style.display = s.viewAll ? 'none' : ''; });
    const civ = this.root.querySelector('#age-box .civ') as HTMLElement | null;
    if (civ) civ.textContent = `— ${p.civ.name}`;
    this.idleEl.style.backgroundImage = `url(${unitIcon('villager', p.color.hex)})`;
    this.idleEl.style.display = s.spectator ? 'none' : '';
    const pick = this.root.querySelector('#viewsel') as HTMLSelectElement | null;
    if (pick) pick.value = String(s.viewAll ? 0 : s.local);
    this.infoSig = '';
    this.lastUpdate = 0;
  }

  /** Spectating: every player's standing at a glance. */
  private updateSpectator(): void {
    if (!this.specEl) return;
    const g = this.s.game;
    const rows = g.players.filter((p) => !p.isGaia).map((p) => {
      let vills = 0, mil = 0;
      for (const u of g.units) {
        if (!u.alive || u.owner !== p.id) continue;
        if (u.def.gatherer) vills++;
        else if (!u.def.animal) mil++;
      }
      const r = p.res;
      const watched = !this.s.viewAll && p.id === this.s.local;
      return `<tr class="${p.defeated ? 'dead' : ''}${watched ? ' watched' : ''}" data-pid="${p.id}"><td><span class="sw" style="background:${p.color.css}"></span>${escapeHtml(p.name)}</td>
        <td>${AGE_NAMES[p.age].split(' ')[0]}</td><td>${p.pop}/${p.popCap}</td><td>${vills}</td><td>${mil}</td>
        <td>${Math.floor(r.food)}</td><td>${Math.floor(r.wood)}</td><td>${Math.floor(r.gold)}</td><td>${Math.floor(r.stone)}</td>
        <td>${p.stats.unitsKilled}</td><td>${Math.floor(scoreOf(this.s, p.id))}</td></tr>`;
    }).join('');
    const html = `<table><tr><th>Player</th><th>Age</th><th>Pop</th><th>Vill</th><th>Army</th><th>Food</th><th>Wood</th><th>Gold</th><th>Stone</th><th>Kills</th><th>Score</th></tr>${rows}</table>`;
    if (this.specEl.innerHTML !== html) this.specEl.innerHTML = html;
  }

  private updateScores(): void {
    const g = this.s.game;
    const rows: string[] = [];
    for (const p of g.players) {
      if (p.isGaia) continue;
      const score = Math.floor(scoreOf(this.s, p.id));
      rows.push(`<div class="${p.defeated ? 'dead' : ''}" style="color:${p.color.css}">${escapeHtml(p.name)} (${p.civ.name}) — ${AGE_NAMES[p.age].split(' ')[0]} · ${score}</div>`);
    }
    for (const b of g.buildings) {
      if (b.alive && b.type === 'wonder' && b.built && b.wonderTimer > 0) {
        const p = g.players[b.owner];
        rows.push(`<div style="color:${p.color.css};font-weight:600">Wonder — ${escapeHtml(p.name)}: ${Math.ceil(b.wonderTimer)}</div>`);
      }
    }
    if (g.relicTeam >= 0 && g.relicTimer > 0) {
      const p = g.players.find((q) => !q.isGaia && q.team === g.relicTeam);
      if (p) rows.push(`<div style="color:${p.color.css};font-weight:600">Relics — ${escapeHtml(p.name)}: ${Math.ceil(g.relicTimer)}</div>`);
    }
    const html = rows.join('');
    if (this.scoresEl.innerHTML !== html) this.scoresEl.innerHTML = html;
  }

  /* ------------------------------------------------------------------ */
  /* Command grid                                                         */
  /* ------------------------------------------------------------------ */

  refreshCommands(): void {
    this.cmdSig = '';
    this.updateCommands();
  }

  private updateCommands(): void {
    // Progress updates must not replace the button between a touch press and release.
    if (this.pressedCommand?.isConnected) return;
    this.pressedCommand = null;
    const s = this.s;
    const btns = computeButtons(s);
    const p = s.game.players[s.local];
    const sig = btns.map((b) => `${b.slot}:${b.title}:${b.enabled}:${b.active}:${b.badge}:${b.progress?.toFixed(2)}:${b.cost ? affordable(p.res, b.cost) : 1}`).join('|') + s.panelMode + s.selVersion;
    if (sig === this.cmdSig) return;
    this.cmdSig = sig;
    this.buttons = btns;
    const bySlot = new Map<number, CmdButton>();
    for (const b of btns) if (!bySlot.has(b.slot)) bySlot.set(b.slot, b);
    this.cmdEl.innerHTML = '';
    for (let i = 0; i < 15; i++) {
      const b = bySlot.get(i);
      if (!b) {
        const d = document.createElement('div');
        d.className = 'cslot';
        this.cmdEl.appendChild(d);
        continue;
      }
      const d = document.createElement('button');
      d.type = 'button';
      d.className = 'cbtn';
      d.setAttribute('aria-label', b.title + (b.reason ? `: ${b.reason}` : ''));
      d.setAttribute('aria-disabled', String(!b.enabled));
      d.title = b.title;
      if (!b.enabled) d.classList.add('off');
      else if (b.cost && !affordable(p.res, b.cost)) d.classList.add('poor');
      if (b.active) d.classList.add('on');
      d.style.backgroundImage = `url("${b.icon}")`;
      d.innerHTML = `<span class="hk">${GRID_KEYS[i]}</span>${b.badge ? `<span class="badge">${b.badge}</span>` : ''}${b.progress !== undefined ? `<div class="prog" style="width:${(b.progress * 100).toFixed(0)}%"></div>` : ''}`;
      // Touch has no hover: holding a button shows its tooltip instead of pressing it.
      let holdTimer = 0;
      let held = false;
      let holdX = 0, holdY = 0;
      const endHold = () => {
        clearTimeout(holdTimer);
        if (held) this.hideTip();
      };
      d.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.hideTip();
        if (held) {
          held = false;
          return;
        }
        if (!b.enabled) {
          if (b.reason) this.message(b.reason, 'err');
          this.s.audio.play('error');
          return;
        }
        b.action(ev.shiftKey);
        this.refreshCommands();
      });
      d.addEventListener('pointerdown', (ev) => {
        if (ev.button === 0) this.pressedCommand = d;
        if (ev.pointerType === 'mouse' && ev.button === 2 && b.rightAction) {
          ev.stopPropagation();
          b.rightAction();
          this.refreshCommands();
        }
        if (ev.pointerType !== 'mouse') {
          // a browser may skip the click after a long press, so never carry `held` into a new press
          held = false;
          holdX = ev.clientX;
          holdY = ev.clientY;
          clearTimeout(holdTimer);
          holdTimer = window.setTimeout(() => {
            held = true;
            this.showTip(d, this.buttonTip(b, GRID_KEYS[i], true));
          }, HOLD_MS);
        }
      });
      d.addEventListener('pointermove', (ev) => {
        if (ev.pointerType !== 'mouse' && Math.hypot(ev.clientX - holdX, ev.clientY - holdY) > 10) clearTimeout(holdTimer);
      });
      const release = () => {
        if (this.pressedCommand === d) this.pressedCommand = null;
        endHold();
      };
      d.addEventListener('pointerup', release);
      d.addEventListener('pointercancel', () => {
        release();
        held = false;
      });
      d.addEventListener('contextmenu', (ev) => ev.preventDefault());
      d.addEventListener('pointerenter', (ev) => {
        if (ev.pointerType === 'mouse') this.showTip(d, this.buttonTip(b, GRID_KEYS[i]));
      });
      d.addEventListener('pointerleave', () => {
        release();
        this.hideTip();
      });
      this.cmdEl.appendChild(d);
    }
    if (this.tipOwner && !this.tipOwner.isConnected) this.hideTip();
  }

  /** Execute the button bound to a grid hotkey. Returns true if handled. */
  hotkey(key: string, shift: boolean): boolean {
    const slot = GRID_KEYS.indexOf(key.toUpperCase());
    if (slot < 0) return false;
    this.updateCommands();
    const b = this.buttons.find((x) => x.slot === slot);
    if (!b) return false;
    if (!b.enabled) {
      if (b.reason) this.message(b.reason, 'err');
      return true;
    }
    b.action(shift);
    this.refreshCommands();
    return true;
  }

  private buttonTip(b: CmdButton, key: string, touch = false): string {
    const p = this.s.game.players[this.s.local];
    let html = `<div class="tt-title">${b.title}${touch ? '' : ` <span class="tt-hk">(${key})</span>`}</div>`;
    if (b.cost) html += costHtml(b.cost, p.res);
    if (b.desc) html += `<div>${b.desc}</div>`;
    if (!b.enabled && b.reason) html += `<div class="tt-reason">${b.reason}</div>`;
    if (b.rightAction && !touch) html += `<div class="tt-hk">Shift-click: queue 5 · Right-click: cancel one</div>`;
    return html;
  }

  showTip(anchor: HTMLElement, html: string): void {
    this.tipOwner = anchor;
    this.tipEl.innerHTML = html;
    this.tipEl.style.display = 'block';
    const r = anchor.getBoundingClientRect();
    const tw = this.tipEl.offsetWidth, th = this.tipEl.offsetHeight;
    let x = r.left, y = r.top - th - 8;
    if (y < 40) y = r.bottom + 8;
    if (x + tw > window.innerWidth - 8) x = window.innerWidth - tw - 8;
    this.tipEl.style.left = `${Math.max(4, x)}px`;
    this.tipEl.style.top = `${Math.max(4, Math.min(y, window.innerHeight - th - 4))}px`;
  }
  hideTip(): void {
    this.tipOwner = null;
    this.tipEl.style.display = 'none';
  }

  /* ------------------------------------------------------------------ */
  /* Info panel                                                           */
  /* ------------------------------------------------------------------ */

  private updateInfo(): void {
    const s = this.s;
    const sel = s.selectedEntities();
    const g = s.game;
    if (!sel.length && s.viewAll) {
      // spectating everyone: who is in the match
      const players = g.players.filter((q) => !q.isGaia);
      const sig = 'match:' + players.map((q) => q.id + (q.defeated ? 'x' : '')).join(',');
      if (sig !== this.infoSig) {
        this.infoSig = sig;
        this.infoEl.innerHTML = `<div class="col"><div class="name">Spectating</div><div class="sub">${players.length} computer players · click a unit or building to inspect it</div>
          <div class="flavor">${players.map((q) => `<span style="color:${q.color.css};${q.defeated ? 'text-decoration:line-through' : ''}">${escapeHtml(q.name)}</span> — ${q.civ.realm} (${q.civ.name}, ${q.civ.specialty})`).join('<br>')}</div></div>`;
      }
      return;
    }
    if (!sel.length) {
      const p = g.players[s.local];
      const sig = 'none:' + p.civ.id;
      if (sig !== this.infoSig) {
        this.infoSig = sig;
        this.infoEl.innerHTML = `<div class="portrait" style="background-image:url('data:image/svg+xml;charset=utf-8,${encodeURIComponent(civEmblem(p.civ))}');background-color:#2a1c10"></div>
          <div class="col"><div class="name">${p.civ.realm}</div><div class="sub">${p.civ.name} · ${p.civ.specialty} civilization</div>
          <div class="flavor">“${p.civ.motto}” ${p.civ.lore}</div></div>`;
      }
      return;
    }
    if (sel.length > 1) {
      const units = sel.slice(0, 40);
      const frac = (e: Entity) => (e.kind === 'resource' ? 1 : e.hp / e.stats.hp);
      const sig = 'multi:' + units.map((e) => `${e.id}:${Math.ceil(frac(e) * 10)}`).join(',');
      if (sig === this.infoSig) return;
      this.infoSig = sig;
      const counts = new Map<string, number>();
      for (const e of sel) counts.set(e.kind === 'unit' ? e.def.name : e.kind === 'building' ? e.def.name : e.type, (counts.get(e.kind === 'unit' ? e.def.name : e.kind === 'building' ? e.def.name : e.type) ?? 0) + 1);
      this.infoEl.innerHTML = `<div class="col" style="flex:1"><div class="sub">${sel.length} selected — ${[...counts].map(([k, v]) => `${v} ${k}`).join(', ')}</div><div class="grid"></div></div>`;
      const grid = this.infoEl.querySelector('.grid') as HTMLElement;
      for (const e of units) {
        const d = document.createElement('div');
        d.className = 'gu';
        d.style.backgroundImage = `url("${entityIcon(s, e)}")`;
        d.innerHTML = `<div class="ghp"><div style="width:${(Math.max(0, frac(e)) * 100).toFixed(0)}%"></div></div>`;
        d.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (ev.shiftKey) s.select([e.id], true);
          else s.select([e.id]);
        });
        grid.appendChild(d);
      }
      return;
    }
    const e = sel[0];
    this.single(e);
  }

  private single(e: Entity): void {
    const s = this.s;
    const g = s.game;
    if (e.kind === 'resource') {
      const sig = `res:${e.id}:${Math.floor(e.amount)}`;
      if (sig === this.infoSig) return;
      this.infoSig = sig;
      const names: Record<string, string> = { tree: 'Tree', gold: 'Gold Mine', stone: 'Stone Mine', berries: 'Forage Bush', carcass: 'Carcass', relic: 'Relic' };
      const res: Record<string, string> = { tree: 'wood', gold: 'gold', stone: 'stone', berries: 'food', carcass: 'food', relic: 'gold' };
      const desc = e.type === 'relic' ? 'A sacred relic. Pick it up with a priest and bring it to a Temple to generate gold.' : `${Math.floor(e.amount)} ${res[e.type]} remaining.`;
      this.infoEl.innerHTML = `<div class="portrait" style="background-image:url('${entityIcon(s, e)}')"></div>
        <div class="col"><div class="name">${names[e.type] ?? e.type}</div><div class="stats"><span class="stat"><img src="${resIcon(res[e.type] ?? 'food')}"> ${e.type === 'relic' ? '' : Math.floor(e.amount)}</span></div><div class="flavor">${desc}</div></div>`;
      return;
    }
    const owner = g.players[e.owner];
    const ownerLine = owner.isGaia ? 'Gaia' : `<span style="color:${owner.color.css}">${escapeHtml(owner.name)}</span> · ${owner.civ.name}`;
    if (e.kind === 'unit') {
      const u = e;
      const st = u.stats;
      const def = u.def;
      const task = unitTask(u, s);
      const sig = `u:${u.id}:${Math.ceil(u.hp)}:${Math.floor(u.carryAmount)}:${task}:${st.attack}:${st.meleeArmor}:${st.pierceArmor}:${st.range}:${u.stance}:${Math.floor(u.faith / 10)}:${u.cargo.length}:${u.type}`;
      if (sig === this.infoSig) return;
      this.infoSig = sig;
      const bonus = (v: number, base: number) => (v > base ? `<span class="bonus">+${+(v - base).toFixed(1)}</span>` : '');
      let stats = '';
      if (st.attack > 0) stats += `<span class="stat" title="Attack"><img src="${resIcon('sword')}">${Math.round(UNITS[u.type].attack)}${bonus(st.attack, UNITS[u.type].attack)}</span>`;
      stats += `<span class="stat" title="Melee armor / Pierce armor"><img src="${resIcon('shield')}">${UNITS[u.type].meleeArmor}${bonus(st.meleeArmor, UNITS[u.type].meleeArmor)}/${UNITS[u.type].pierceArmor}${bonus(st.pierceArmor, UNITS[u.type].pierceArmor)}</span>`;
      if (st.range > 1 || def.monk) stats += `<span class="stat" title="Range"><img src="${resIcon('range')}">${Math.round(st.range)}</span>`;
      stats += `<span class="stat" title="Line of sight"><img src="${resIcon('los')}">${Math.round(st.los)}</span>`;
      stats += `<span class="stat" title="Speed"><img src="${resIcon('speed')}">${st.speed.toFixed(2)}</span>`;
      if (def.gatherer && u.carryAmount > 0.5 && u.carryType) stats += `<span class="stat" title="Carrying"><img src="${resIcon(u.carryType)}">${Math.floor(u.carryAmount)}</span>`;
      if (def.trader && u.tradeGold > 0) stats += `<span class="stat" title="Gold carried"><img src="${resIcon('gold')}">${Math.floor(u.tradeGold)}</span>`;
      const bonusText = st.bonus && Object.keys(st.bonus).length ? `Bonus: ${Object.entries(st.bonus).filter(([, v]) => v > 0).map(([k, v]) => `+${v} vs ${k}`).join(', ')}` : '';
      this.infoEl.innerHTML = `<div class="portrait" style="background-image:url('${entityIcon(s, u)}')"></div>
        <div class="col"><div class="name">${def.name}</div><div class="sub">${ownerLine}</div>
        <div class="hpbar"><div style="width:${((u.hp / st.hp) * 100).toFixed(0)}%"></div></div><div class="hptext">${Math.ceil(u.hp)} / ${Math.round(st.hp)}</div>
        <div class="stats">${stats}</div>
        <div class="flavor">${task}${bonusText && u.owner === s.local ? ` · ${bonusText}` : ''}${def.monk ? ` · Faith ${Math.floor(u.faith)}%` : ''}${u.cargo.length ? ` · Carrying ${u.cargo.length} troops` : ''}</div></div>`;
      return;
    }
    const b = e as Building;
    const p = g.players[b.owner];
    const st = b.stats;
    const q = b.queue;
    const sig = `b:${b.id}:${Math.ceil(b.hp)}:${b.built}:${(b.progress * 100).toFixed(0)}:${q.map((x) => x.id).join(',')}:${(b.queueTime).toFixed(0)}:${b.garrison.length}:${Math.floor(b.food)}:${b.relics.length}:${b.blockedByPop}:${Math.floor(b.wonderTimer)}`;
    if (sig === this.infoSig) return;
    this.infoSig = sig;
    let stats = '';
    if (st.attack) stats += `<span class="stat" title="Attack"><img src="${resIcon('sword')}">${st.attack.damage}</span><span class="stat" title="Range"><img src="${resIcon('range')}">${st.attack.range}</span>`;
    stats += `<span class="stat" title="Melee / Pierce armor"><img src="${resIcon('shield')}">${st.meleeArmor}/${st.pierceArmor}</span>`;
    if (b.def.garrison) stats += `<span class="stat" title="Garrison"><img src="${resIcon('pop')}">${b.garrison.length}/${b.def.garrison}</span>`;
    if (b.def.foodCapacity) stats += `<span class="stat" title="Food"><img src="${resIcon('food')}">${Math.floor(b.food)}</span>`;
    if (b.relics.length) stats += `<span class="stat" title="Relics"><img src="${resIcon('gold')}">${b.relics.length} relic${b.relics.length > 1 ? 's' : ''}</span>`;
    if (st.popProvided) stats += `<span class="stat" title="Population provided"><img src="${resIcon('pop')}">+${st.popProvided}</span>`;
    let extra = '';
    if (!b.built) extra = `<div class="flavor">Under construction: ${(b.progress * 100).toFixed(0)}%</div>`;
    else if (q.length && b.owner === s.local) {
      extra = `<div class="queue"></div>`;
      if (b.blockedByPop) extra += `<div class="flavor" style="color:#a0200a">Waiting for population space…</div>`;
    } else if (b.type === 'wonder' && b.wonderTimer > 0) extra = `<div class="flavor">Victory in ${Math.ceil(b.wonderTimer)} seconds unless destroyed.</div>`;
    else extra = `<div class="flavor">${b.def.description}</div>`;
    this.infoEl.innerHTML = `<div class="portrait" style="background-image:url('${entityIcon(s, b)}')"></div>
      <div class="col" style="flex:1"><div class="name">${b.def.name}</div><div class="sub">${ownerLine}</div>
      <div class="hpbar"><div style="width:${((b.hp / st.hp) * 100).toFixed(0)}%"></div></div><div class="hptext">${Math.ceil(b.hp)} / ${Math.round(st.hp)}</div>
      <div class="stats">${stats}</div>${extra}${b.garrison.length && b.owner === s.local ? '<div class="garr"></div>' : ''}</div>`;
    const qEl = this.infoEl.querySelector('.queue') as HTMLElement | null;
    if (qEl) {
      q.forEach((item, i) => {
        const d = document.createElement('div');
        d.className = 'qi';
        const icon = item.kind === 'unit' ? unitIcon(UNITS[item.id].model, p.color.hex) : techIcon(TECHS[item.id].icon, p.color.hex, civEmblem(p.civ));
        d.style.backgroundImage = `url("${icon}")`;
        if (i === 0) {
          const total = item.kind === 'unit' ? p.unitStats.get(item.id)!.trainTime : TECHS[item.id].time;
          d.innerHTML = `<div class="qp" style="width:${Math.min(100, (b.queueTime / total) * 100).toFixed(0)}%"></div>`;
        }
        d.title = 'Click to cancel';
        d.addEventListener('click', (ev) => {
          ev.stopPropagation();
          s.issue({ c: 'cancel', building: b.id, index: i });
        });
        qEl.appendChild(d);
      });
    }
    const gEl = this.infoEl.querySelector('.garr') as HTMLElement | null;
    if (gEl) {
      for (const id of b.garrison) {
        const u = g.unit(id);
        if (!u) continue;
        const d = document.createElement('div');
        d.className = 'gi';
        d.style.backgroundImage = `url("${entityIcon(s, u)}")`;
        d.title = `${u.def.name} — click to ungarrison`;
        d.addEventListener('click', (ev) => {
          ev.stopPropagation();
          s.issue({ c: 'ungarrison', building: b.id, unit: id });
        });
        gEl.appendChild(d);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Modals                                                               */
  /* ------------------------------------------------------------------ */

  closeModal(): void {
    if (this.modal) {
      this.modal.remove();
      this.modal = null;
    }
  }

  isModalOpen(): boolean {
    return !!this.modal;
  }

  private openModal(html: string, pause = true): HTMLElement {
    this.closeModal();
    this.hideTip();
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal wood trim">${html}</div>`;
    this.root.appendChild(back);
    this.modal = back;
    if (pause) this.s.paused = true;
    back.addEventListener('mousedown', (e) => e.stopPropagation());
    return back;
  }

  showMenu(): void {
    const s = this.s;
    const m = this.openModal(`<h2>Game Menu</h2>
      <button class="mbtn" data-a="resume">Resume</button>
      <div style="text-align:center;margin:8px 0">Game speed:
        ${[1, 1.5, 2, 3, 5, 10].map((v) => `<button class="mbtn small" data-speed="${v}" style="${s.speed === v ? 'color:#fff;border-color:#fff' : ''}">${v}×</button>`).join('')}</div>
      <div style="text-align:center;margin:8px 0">Graphics:
        ${(['low', 'medium', 'high'] as const).map((q) => `<button class="mbtn small" data-quality="${q}" style="${s.renderer.quality === q ? 'color:#fff;border-color:#fff' : ''}">${q[0].toUpperCase() + q.slice(1)}</button>`).join('')}</div>
      <div style="text-align:center;margin:8px 0">Sound:
        <button class="mbtn small" data-a="sfx">${s.audio.sfxOn ? 'Effects on' : 'Effects off'}</button>
        <button class="mbtn small" data-a="music">${s.audio.musicOn ? 'Music on' : 'Music off'}</button></div>
      <button class="mbtn" data-a="save">Save game</button>
      <button class="mbtn" data-a="load">Load game</button>
      <button class="mbtn" data-a="help">How to play</button>
      <button class="mbtn" data-a="resign">Resign</button>
      <button class="mbtn" data-a="quit">Quit to main menu</button>`);
    m.querySelectorAll('[data-speed]').forEach((el) => el.addEventListener('click', () => {
      s.speed = Number((el as HTMLElement).dataset.speed);
      this.showMenu();
    }));
    m.querySelectorAll('[data-quality]').forEach((el) => el.addEventListener('click', () => {
      s.renderer.setQuality((el as HTMLElement).dataset.quality as 'low' | 'medium' | 'high');
      this.showMenu();
    }));
    m.querySelectorAll('[data-a]').forEach((el) => el.addEventListener('click', () => {
      const a = (el as HTMLElement).dataset.a;
      if (a === 'resume') {
        this.closeModal();
        s.paused = false;
      } else if (a === 'help') this.showHelp();
      else if (a === 'save') void this.showSave();
      else if (a === 'load') void this.showLoad();
      else if (a === 'sfx') {
        s.audio.sfxOn = !s.audio.sfxOn;
        this.showMenu();
      } else if (a === 'music') {
        s.audio.toggleMusic();
        this.showMenu();
      } else if (a === 'resign') {
        this.closeModal();
        s.paused = false;
        s.issue({ c: 'resign' });
      } else if (a === 'quit') {
        this.closeModal();
        s.exit();
      }
    }));
  }

  /** Save: a name for a new save, or an existing one to save over. */
  async showSave(): Promise<void> {
    const s = this.s;
    let saves: SaveMeta[] = [];
    let err = '';
    try {
      saves = await listSaves();
    } catch (e) {
      err = (e as Error).message;
    }
    const me = s.game.players[s.local];
    const suggested = `${s.spectator ? 'Match' : me.civ.name} — ${AGE_NAMES[me.age]}, ${formatClock(s.game.time)}`;
    const m = this.openModal(`<h2>Save Game</h2>
      ${err ? `<p class="save-err">${escapeHtml(err)}</p>` : ''}
      <div class="save-new"><input id="save-name" maxlength="60" value="${escapeHtml(suggested)}">
        <button class="mbtn small" data-a="new">Save</button></div>
      ${saves.some((x) => !x.auto) ? '<div class="save-head">Or save over an earlier game:</div>' + saveListHtml(saves.filter((x) => !x.auto), 'save') : ''}
      <button class="mbtn" data-a="back">Back</button>`);
    const input = m.querySelector('#save-name') as HTMLInputElement;
    input.focus();
    input.select();
    // typing a name must not trigger the game's hotkeys
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') (m.querySelector('[data-a=new]') as HTMLElement).click();
    });
    const finish = async (name: string, id?: string) => {
      m.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = true));
      await s.save(name.trim() || suggested, id);
      this.closeModal();
      s.paused = false;
    };
    (m.querySelector('[data-a=new]') as HTMLElement).addEventListener('click', () => void finish(input.value));
    (m.querySelector('[data-a=back]') as HTMLElement).addEventListener('click', () => this.showMenu());
    m.querySelectorAll('[data-act=overwrite]').forEach((b) => b.addEventListener('click', () => {
      const row = (b as HTMLElement).closest('.save-row') as HTMLElement;
      const old = saves.find((x) => x.id === row.dataset.id);
      if (old && confirm(`Save over "${old.name}"?`)) void finish(input.value, old.id);
    }));
  }

  /** Load: the saved games, newest first. */
  async showLoad(): Promise<void> {
    const s = this.s;
    let saves: SaveMeta[] = [];
    let err = '';
    try {
      saves = await listSaves();
    } catch (e) {
      err = (e as Error).message;
    }
    const m = this.openModal(`<h2>Load Game</h2>
      ${err ? `<p class="save-err">${escapeHtml(err)}</p>` : ''}
      ${saveListHtml(saves, 'load')}
      <p class="save-note">The game in progress is not saved when you load another.</p>
      <button class="mbtn" data-a="back">Back</button>`);
    (m.querySelector('[data-a=back]') as HTMLElement).addEventListener('click', () => this.showMenu());
    m.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
      const row = (b as HTMLElement).closest('.save-row') as HTMLElement;
      const id = row.dataset.id!;
      const meta = saves.find((x) => x.id === id);
      if ((b as HTMLElement).dataset.act === 'delete') {
        if (!meta || !confirm(`Delete "${meta.name}"? This cannot be undone.`)) return;
        await deleteSave(id);
        void this.showLoad();
      } else if (s.onLoadGame) {
        this.closeModal();
        s.onLoadGame(id);
      }
    }));
  }

  showHelp(): void {
    const m = this.openModal(`<h2>How to Play</h2><div class="help" style="max-width:760px">
      <p><b>Goal:</b> gather resources, grow your population, advance through the four ages, and destroy every enemy unit and building — or build a Wonder and defend it.</p>
      <p><b>Touch:</b> drag one finger to pan; pinch to zoom. Tap a unit or building to select it. To select a group, double-tap, hold the second tap and drag a box, or tap <b>Select</b> and then drag. Tap ground, resources or enemies to command selected units. Tapping your own unit or building selects it; use <b>Interact</b> first to garrison, repair, trade or work there instead. With a production building selected, use <b>Rally</b> and tap where new units should gather. Tap the minimap to jump across the map.</p>
      <p><b>Touch building:</b> select villagers, tap a Build button, choose a building, then tap the map to place it. Drag to lay walls; tap <b>Rotate</b> to turn a gate. <b>Cancel</b> leaves the current action; <b>Deselect</b> clears your selection. Tap an item in a building's training queue to cancel it. Press and hold a command button to see what it does and what it costs.</p>
      <p><b>Mouse:</b> Left-click to select, drag to box-select, double-click to select all of a type on screen. Right-click to move, attack, gather, build, repair or garrison depending on what you click. Hold <kbd>Shift</kbd> to queue orders or to place several buildings. Drag walls to draw a line.</p>
      <p><b>Camera:</b> <kbd>W A S D</kbd> or move the mouse to the screen edge; middle-drag to pan; mouse wheel to zoom; click the minimap.</p>
      <p><b>Hotkeys:</b> The command grid uses <kbd>${GRID_KEYS.slice(0, 5).join(' ')}</kbd> / <kbd>${GRID_KEYS.slice(5, 10).join(' ')}</kbd> / <kbd>${GRID_KEYS.slice(10).join(' ')}</kbd>. <kbd>H</kbd> selects your Town Center, <kbd>.</kbd> next idle villager, <kbd>,</kbd> idle military, <kbd>Space</kbd> jumps to the last alert, <kbd>Ctrl+1-9</kbd> makes a control group, <kbd>1-9</kbd> recalls it, <kbd>Del</kbd> deletes, <kbd>Esc</kbd> cancels, <kbd>F3</kbd> or <kbd>P</kbd> pauses, <kbd>+</kbd>/<kbd>-</kbd> change game speed, <kbd>R</kbd> rotates a gate while placing.</p>
      <p><b>Economy:</b> Villagers carry 10 of a resource to the nearest drop-off (Town Center, Mill, Lumber Camp, Mining Camp). Herd sheep to your Town Center, hunt deer and boar (boar fight back!), forage berries, then build farms around a Mill. Houses give 5 population each.</p>
      <p><b>Ages:</b> Research the next age at the Town Center once you have two buildings of the current age.</p>
      <p><b>Saving:</b> save and load from the in-game Menu (<kbd>F10</kbd>) or load from the main menu. The game also saves itself every five minutes of play (the Autosave). Saves are kept in this browser.</p>
      <p><b>Combat:</b> Spears beat cavalry, cavalry beats archers, archers beat infantry, skirmishers beat archers, siege beats buildings. Temple priests heal and convert; bring relics home for gold.</p>
      </div><button class="mbtn" data-a="close">Close</button>`);
    (m.querySelector('[data-a=close]') as HTMLElement).addEventListener('click', () => {
      this.closeModal();
      this.s.paused = false;
    });
  }

  showCivInfo(): void {
    const p = this.s.game.players[this.s.local];
    const civ = p.civ;
    const m = this.openModal(`<h2>${civ.realm}</h2><div class="civcard"><img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(civEmblem(civ))}">
      <div><div class="cn">${civ.name}</div><div class="cr">“${civ.motto}” — ${civ.specialty}</div><p>${civ.lore}</p>
      <ul>${civ.bonuses.filter((b) => b.text).map((b) => `<li>${b.text}</li>`).join('')}</ul>
      <p><b>Team bonus:</b> ${civ.teamBonus.text}</p>
      <p><b>Unique unit:</b> ${UNITS[civ.uniqueUnit].name} — ${UNITS[civ.uniqueUnit].description}</p>
      <p><b>Unique technologies:</b> ${civ.uniqueTechs.map((t) => `${TECHS[t].name} (${TECHS[t].description})`).join('; ')}</p></div></div>
      <button class="mbtn" data-a="close">Close</button>`);
    (m.querySelector('[data-a=close]') as HTMLElement).addEventListener('click', () => {
      this.closeModal();
      this.s.paused = false;
    });
  }

  showGameOver(): void {
    const s = this.s;
    const g = s.game;
    const won = g.winnerTeam === g.teamOf[s.local];
    const winners = g.players.filter((p) => !p.isGaia && p.team === g.winnerTeam).map((p) => escapeHtml(p.name)).join(' and ');
    const rows = g.players.filter((p) => !p.isGaia).map((p) => `<tr><td style="color:${p.color.css}">${escapeHtml(p.name)} (${p.civ.name})</td>
      <td>${Math.floor(scoreOf(s, p.id))}</td><td>${p.stats.unitsKilled}</td><td>${p.stats.unitsLost}</td><td>${p.stats.buildingsRazed}</td>
      <td>${Math.floor(p.stats.gathered.food + p.stats.gathered.wood + p.stats.gathered.gold + p.stats.gathered.stone)}</td><td>${p.stats.techs}</td>
      <td>${p.stats.feudalTime >= 0 ? formatTime(p.stats.feudalTime) : '—'}</td><td>${p.stats.castleTime >= 0 ? formatTime(p.stats.castleTime) : '—'}</td><td>${p.stats.imperialTime >= 0 ? formatTime(p.stats.imperialTime) : '—'}</td></tr>`).join('');
    const title = s.spectator ? (winners ? `${winners} ${winners.includes(' and ') ? 'win' : 'wins'}` : 'The match is over') : won ? 'Victory!' : 'Defeat';
    const line = s.spectator ? 'The chroniclers have seen enough.' : won ? 'Your realm is ascendant. The chroniclers will sing of this day.' : 'Your realm has fallen. Others will write its history.';
    const m = this.openModal(`<h2>${title}</h2>
      <p style="text-align:center;font-size:18px">${line}</p>
      <table class="stats-table"><tr><th>Player</th><th>Score</th><th>Kills</th><th>Losses</th><th>Razed</th><th>Gathered</th><th>Techs</th><th>Feudal</th><th>Castle</th><th>Imperial</th></tr>${rows}</table>
      <p style="text-align:center">Game time: ${formatTime(g.time)}</p>
      <button class="mbtn" data-a="watch">Keep watching</button>
      <button class="mbtn" data-a="quit">Return to main menu</button>`);
    s.audio.play(won || s.spectator ? 'victory' : 'defeat');
    (m.querySelector('[data-a=quit]') as HTMLElement).addEventListener('click', () => {
      this.closeModal();
      s.exit();
    });
    (m.querySelector('[data-a=watch]') as HTMLElement).addEventListener('click', () => {
      this.closeModal();
      s.paused = false;
      s.ended = false;
      s.game.over = true;
    });
  }
}

export function scoreOf(s: Session, pid: number): number {
  const p = s.game.players[pid];
  const gathered = p.stats.gathered.food + p.stats.gathered.wood + p.stats.gathered.gold + p.stats.gathered.stone;
  let military = 0;
  for (const u of s.game.units) if (u.alive && u.owner === pid && !u.def.gatherer && !u.def.animal) military += (u.stats.cost.food ?? 0) + (u.stats.cost.wood ?? 0) + (u.stats.cost.gold ?? 0);
  return gathered * 0.1 + military * 0.2 + p.stats.unitsKilled * 5 + p.stats.buildingsRazed * 20 + p.stats.techs * 20 + p.age * 100;
}

function unitTask(u: Unit, s: Session): string {
  const o = u.order;
  if (u.owner !== s.local) return '';
  switch (o.t) {
    case 'idle': return 'Idle';
    case 'move': return o.attackMove ? 'Attack-moving' : 'Moving';
    case 'attack': return 'Attacking';
    case 'gather': {
      if (u.returning) return 'Returning resources';
      const k = u.gatherKind;
      const names: Record<string, string> = { forage: 'Forager', hunt: 'Hunter', herd: 'Shepherd', farm: 'Farmer', fish: 'Fisherman', wood: 'Lumberjack', gold: 'Gold miner', stone: 'Stone miner' };
      return k ? names[k] : 'Gathering';
    }
    case 'build': return 'Builder';
    case 'repair': return 'Repairing';
    case 'garrison': return 'Garrisoning';
    case 'heal': return 'Healing';
    case 'convert': return 'Converting';
    case 'patrol': return 'Patrolling';
    case 'trade': return 'Trading';
    case 'follow': return 'Following';
    default: return '';
  }
}

function affordable(res: Record<Res, number>, cost: Cost): boolean {
  for (const k in cost) if ((res[k as Res] ?? 0) < (cost[k as Res] ?? 0)) return false;
  return true;
}

function costHtml(cost: Cost, res: Record<Res, number>): string {
  const parts: string[] = [];
  for (const k of ['food', 'wood', 'gold', 'stone'] as Res[]) {
    const v = cost[k];
    if (!v) continue;
    parts.push(`<span class="${res[k] < v ? 'poor' : ''}"><img src="${resIcon(k)}">${v}</span>`);
  }
  return parts.length ? `<div class="tt-cost">${parts.join('')}</div>` : '';
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
