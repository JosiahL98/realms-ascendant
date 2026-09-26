import { AGE_NAMES, type Cost, type Res } from '../data/types';
import { TECHS } from '../data/techs';
import { UNITS } from '../data/units';
import { formatTime } from '../util/math';
import type { Building, Entity, Unit } from '../sim/entities';
import { computeButtons, entityIcon, GRID_KEYS, type CmdButton } from './commandPanel';
import { resIcon, unitIcon, techIcon, civEmblem } from './icons';
import type { Session } from './session';

const RES_ORDER: Res[] = ['wood', 'food', 'gold', 'stone'];

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
  selBox: HTMLElement;
  private lastUpdate = 0;
  private cmdSig = '';
  private infoSig = '';
  private buttons: CmdButton[] = [];
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
        <button class="topbtn" id="btn-civ">Civilization</button>
        <button class="topbtn" id="btn-help">Help</button>
        <button class="topbtn" id="btn-menu">Menu</button>
      </div>
      <div id="messages"></div>
      <div id="scores"></div>
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
    (root.querySelector('#btn-menu') as HTMLElement).addEventListener('click', () => this.showMenu());
    (root.querySelector('#btn-help') as HTMLElement).addEventListener('click', () => this.showHelp());
    (root.querySelector('#btn-civ') as HTMLElement).addEventListener('click', () => this.showCivInfo());
    this.pausedEl = document.createElement('div');
    this.pausedEl.className = 'paused-banner';
    this.pausedEl.textContent = 'Paused';
    this.pausedEl.style.display = 'none';
    root.appendChild(this.pausedEl);
    // resource tooltips
    root.querySelectorAll('.res').forEach((el) => {
      el.addEventListener('mouseenter', () => {
        const k = (el as HTMLElement).dataset.tip!;
        const names: Record<string, string> = { wood: 'Wood', food: 'Food', gold: 'Gold', stone: 'Stone', pop: 'Population' };
        const vc = this.s.villagerCounts();
        const desc = k === 'pop' ? `Units / population capacity. Build houses to raise it (max ${this.s.game.players[this.s.local].maxPop}). Idle villagers: ${vc.idle}, building: ${vc.build}.`
          : `Villagers gathering ${names[k].toLowerCase()}: ${vc[k as Res]}`;
        this.showTip(el as HTMLElement, `<div class="tt-title">${names[k]}</div><div>${desc}</div>`);
      });
      el.addEventListener('mouseleave', () => this.hideTip());
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
    this.updateCommands();
    this.updateInfo();
  }

  private updateScores(): void {
    const g = this.s.game;
    const rows: string[] = [];
    for (const p of g.players) {
      if (p.isGaia) continue;
      const score = Math.floor(scoreOf(this.s, p.id));
      rows.push(`<div class="${p.defeated ? 'dead' : ''}" style="color:${p.color.css}">${escapeHtml(p.name)} (${p.civ.name}) — ${AGE_NAMES[p.age].split(' ')[0]} · ${score}</div>`);
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
      const d = document.createElement('div');
      d.className = 'cbtn';
      if (!b.enabled) d.classList.add('off');
      else if (b.cost && !affordable(p.res, b.cost)) d.classList.add('poor');
      if (b.active) d.classList.add('on');
      d.style.backgroundImage = `url("${b.icon}")`;
      d.innerHTML = `<span class="hk">${GRID_KEYS[i]}</span>${b.badge ? `<span class="badge">${b.badge}</span>` : ''}${b.progress !== undefined ? `<div class="prog" style="width:${(b.progress * 100).toFixed(0)}%"></div>` : ''}`;
      d.addEventListener('mousedown', (ev) => {
        ev.stopPropagation();
        if (ev.button === 0) {
          if (!b.enabled) {
            if (b.reason) this.message(b.reason, 'err');
            this.s.audio.play('error');
            return;
          }
          b.action(ev.shiftKey);
          this.refreshCommands();
        } else if (ev.button === 2 && b.rightAction) {
          b.rightAction();
          this.refreshCommands();
        }
      });
      d.addEventListener('contextmenu', (ev) => ev.preventDefault());
      d.addEventListener('mouseenter', () => this.showTip(d, this.buttonTip(b, GRID_KEYS[i])));
      d.addEventListener('mouseleave', () => this.hideTip());
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

  private buttonTip(b: CmdButton, key: string): string {
    const p = this.s.game.players[this.s.local];
    let html = `<div class="tt-title">${b.title} <span class="tt-hk">(${key})</span></div>`;
    if (b.cost) html += costHtml(b.cost, p.res);
    if (b.desc) html += `<div>${b.desc}</div>`;
    if (!b.enabled && b.reason) html += `<div class="tt-reason">${b.reason}</div>`;
    if (b.rightAction) html += `<div class="tt-hk">Shift-click: queue 5 · Right-click: cancel one</div>`;
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
    this.tipEl.style.top = `${y}px`;
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
        d.addEventListener('mousedown', (ev) => {
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
        d.addEventListener('mousedown', (ev) => {
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
        d.addEventListener('mousedown', (ev) => {
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
        ${[1, 1.5, 2, 3].map((v) => `<button class="mbtn small" data-speed="${v}" style="${s.speed === v ? 'color:#fff;border-color:#fff' : ''}">${v}×</button>`).join('')}</div>
      <div style="text-align:center;margin:8px 0">Sound:
        <button class="mbtn small" data-a="sfx">${s.audio.sfxOn ? 'Effects on' : 'Effects off'}</button>
        <button class="mbtn small" data-a="music">${s.audio.musicOn ? 'Music on' : 'Music off'}</button></div>
      <button class="mbtn" data-a="help">How to play</button>
      <button class="mbtn" data-a="resign">Resign</button>
      <button class="mbtn" data-a="quit">Quit to main menu</button>`);
    m.querySelectorAll('[data-speed]').forEach((el) => el.addEventListener('click', () => {
      s.speed = Number((el as HTMLElement).dataset.speed);
      this.showMenu();
    }));
    m.querySelectorAll('[data-a]').forEach((el) => el.addEventListener('click', () => {
      const a = (el as HTMLElement).dataset.a;
      if (a === 'resume') {
        this.closeModal();
        s.paused = false;
      } else if (a === 'help') this.showHelp();
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

  showHelp(): void {
    const m = this.openModal(`<h2>How to Play</h2><div class="help" style="max-width:760px">
      <p><b>Goal:</b> gather resources, grow your population, advance through the four ages, and destroy every enemy unit and building — or build a Wonder and defend it.</p>
      <p><b>Mouse:</b> Left-click to select, drag to box-select, double-click to select all of a type on screen. Right-click to move, attack, gather, build, repair or garrison depending on what you click. Hold <kbd>Shift</kbd> to queue orders or to place several buildings. Drag walls to draw a line.</p>
      <p><b>Camera:</b> <kbd>Arrow keys</kbd> or move the mouse to the screen edge; middle-drag to pan; mouse wheel to zoom; click the minimap.</p>
      <p><b>Hotkeys:</b> The command grid uses <kbd>Q W E R T</kbd> / <kbd>A S D F G</kbd> / <kbd>Z X C V B</kbd>. <kbd>H</kbd> selects your Town Center, <kbd>.</kbd> next idle villager, <kbd>,</kbd> idle military, <kbd>Space</kbd> jumps to the last alert, <kbd>Ctrl+1-9</kbd> makes a control group, <kbd>1-9</kbd> recalls it, <kbd>Del</kbd> deletes, <kbd>Esc</kbd> cancels, <kbd>F3</kbd> or <kbd>P</kbd> pauses, <kbd>+</kbd>/<kbd>-</kbd> change game speed, <kbd>R</kbd> rotates a gate while placing.</p>
      <p><b>Economy:</b> Villagers carry 10 of a resource to the nearest drop-off (Town Center, Mill, Lumber Camp, Mining Camp). Herd sheep to your Town Center, hunt deer and boar (boar fight back!), forage berries, then build farms around a Mill. Houses give 5 population each.</p>
      <p><b>Ages:</b> Research the next age at the Town Center once you have two buildings of the current age.</p>
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
    const rows = g.players.filter((p) => !p.isGaia).map((p) => `<tr><td style="color:${p.color.css}">${escapeHtml(p.name)} (${p.civ.name})</td>
      <td>${Math.floor(scoreOf(s, p.id))}</td><td>${p.stats.unitsKilled}</td><td>${p.stats.unitsLost}</td><td>${p.stats.buildingsRazed}</td>
      <td>${Math.floor(p.stats.gathered.food + p.stats.gathered.wood + p.stats.gathered.gold + p.stats.gathered.stone)}</td><td>${p.stats.techs}</td>
      <td>${p.stats.feudalTime >= 0 ? formatTime(p.stats.feudalTime) : '—'}</td><td>${p.stats.castleTime >= 0 ? formatTime(p.stats.castleTime) : '—'}</td><td>${p.stats.imperialTime >= 0 ? formatTime(p.stats.imperialTime) : '—'}</td></tr>`).join('');
    const m = this.openModal(`<h2>${won ? 'Victory!' : 'Defeat'}</h2>
      <p style="text-align:center;font-size:18px">${won ? 'Your realm is ascendant. The chroniclers will sing of this day.' : 'Your realm has fallen. Others will write its history.'}</p>
      <table class="stats-table"><tr><th>Player</th><th>Score</th><th>Kills</th><th>Losses</th><th>Razed</th><th>Gathered</th><th>Techs</th><th>Feudal</th><th>Castle</th><th>Imperial</th></tr>${rows}</table>
      <p style="text-align:center">Game time: ${formatTime(g.time)}</p>
      <button class="mbtn" data-a="watch">Keep watching</button>
      <button class="mbtn" data-a="quit">Return to main menu</button>`);
    s.audio.play(won ? 'victory' : 'defeat');
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
