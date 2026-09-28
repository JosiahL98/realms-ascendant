import { CIVS, CIV_LIST, WORLD_LORE } from '../data/civs';
import { UNITS } from '../data/units';
import { TECHS } from '../data/techs';
import type { Difficulty, GameSetup, PlayerSetup } from '../sim/game';
import { MAP_SIZES, MAP_TYPES, type MapType } from '../sim/mapgen';
import { PLAYER_COLORS } from '../sim/player';
import { civEmblem, unitIcon } from './icons';
import type { AudioSys } from '../audio/audio';
import { deleteSave, listSaves, saveListHtml, type SaveMeta } from './saves';

const dataUri = (s: string) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);

const AI_NAMES = ['Hanno the Navigator', 'Brennus', 'Queen Amanirenas', 'Mithridates', 'Arminius', 'Seleucus', 'Cao Cao', 'Vercingetorix', 'Sophonisba', 'Tanaquil', 'Ariovistus', 'Artabanus'];

interface SetupState {
  players: (PlayerSetup & { random: boolean })[];
  mapType: MapType;
  mapSize: number;
  resources: 'standard' | 'medium' | 'high';
  popLimit: number;
  victory: 'standard' | 'conquest';
  reveal: 'normal' | 'explored' | 'all';
  startAge?: number;
  /** Watch computer players instead of playing. */
  spectate?: boolean;
}

export class Menus {
  private root: HTMLElement;
  private audio: AudioSys;
  private onStart: (setup: GameSetup) => void;
  private onLoad: (id: string) => void;
  private state: SetupState;

  constructor(root: HTMLElement, audio: AudioSys, onStart: (s: GameSetup) => void, onLoad: (id: string) => void) {
    this.root = root;
    this.audio = audio;
    this.onStart = onStart;
    this.onLoad = onLoad;
    this.state = this.loadState();
  }

  private loadState(): SetupState {
    try {
      const raw = localStorage.getItem('ra-setup');
      if (raw) {
        const s = JSON.parse(raw) as SetupState;
        if (s.players?.length) return s;
      }
    } catch {
      /* ignore */
    }
    return {
      players: [
        { name: 'You', civ: 'carthaginians', color: 0, team: 1, human: true, difficulty: 'standard', random: false },
        { name: AI_NAMES[1], civ: 'gauls', color: 1, team: 2, human: false, difficulty: 'standard', random: true },
      ],
      mapType: 'steppe',
      mapSize: 120,
      resources: 'standard',
      popLimit: 200,
      victory: 'standard',
      reveal: 'normal',
    };
  }

  private saveState(): void {
    try {
      localStorage.setItem('ra-setup', JSON.stringify(this.state));
    } catch {
      /* ignore */
    }
  }

  private frame(inner: string): HTMLElement {
    this.root.innerHTML = `<div id="menu-root"><div class="menu-bg"></div><div class="menu-inner">${inner}</div></div>`;
    const el = this.root.querySelector('#menu-root') as HTMLElement;
    el.addEventListener('mousedown', () => this.audio.unlock());
    return el;
  }

  showMain(): void {
    const el = this.frame(`
      <div class="title">${WORLD_LORE.title}</div>
      <div class="subtitle">${WORLD_LORE.subtitle}</div>
      <div class="lore">${WORLD_LORE.intro.map((p) => `<p>${p}</p>`).join('')}</div>
      <div class="menu-buttons">
        <button class="mbtn" data-a="play">Single Player</button>
        <button class="mbtn" data-a="quick">Quick Battle</button>
        <button class="mbtn" data-a="load">Load Game</button>
        <button class="mbtn" data-a="watch">Watch a Match</button>
        <button class="mbtn" data-a="civs">The Eight Realms</button>
        <button class="mbtn" data-a="help">How to Play</button>
      </div>
      <div style="text-align:center;margin-top:30px;display:flex;gap:10px;justify-content:center">${CIV_LIST.map((c) => `<img title="${c.realm}" src="${dataUri(civEmblem(c))}" style="width:46px;height:46px">`).join('')}</div>
    `);
    el.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => {
      this.audio.unlock();
      this.audio.play('click');
      const a = (b as HTMLElement).dataset.a;
      if (a === 'play' || a === 'watch') {
        this.state.spectate = a === 'watch';
        this.saveState();
        this.showSetup();
      }
      else if (a === 'quick') this.start(true);
      else if (a === 'load') void this.showLoad();
      else if (a === 'civs') this.showCivs();
      else if (a === 'help') this.showHelp();
    }));
  }

  showHelp(): void {
    const el = this.frame(`<h2 style="font-family:Cinzel;color:#f2d98c;text-align:center">How to Play</h2><div class="box wood trim help" style="padding:18px 24px;border-radius:6px">
      <p>Realms Ascendant plays like the classic real-time strategy games of old. You begin in the <b>Dark Age</b> with a Town Center, a few villagers and a scout.</p>
      <p><b>Gather.</b> Select villagers and right-click sheep, berries, trees, gold or stone. Villagers carry their load to the nearest drop-off: the Town Center, a Mill (food), Lumber Camp (wood) or Mining Camp (gold and stone). Keep your Town Center busy training villagers!</p>
      <p><b>Build.</b> Select villagers and use the Build buttons (<kbd>Q</kbd> economic, <kbd>W</kbd> military). Houses raise your population limit by 5. Farms need a Mill and are reseeded automatically.</p>
      <p><b>Advance.</b> At the Town Center, research the next age once you own two buildings of your current age. Each age unlocks stronger units, buildings and technologies. In the Castle Age you can build a Castle to train your realm's unique unit.</p>
      <p><b>Fight.</b> Spearmen counter cavalry, cavalry counters archers, archers counter infantry, skirmishers counter archers, rams and trebuchets destroy buildings. Priests heal and convert, and carry relics to your Temple for a steady income of gold.</p>
      <p><b>Win</b> by destroying all enemy units and buildings, or by building a Wonder and defending it for 600 seconds.</p>
      <p><b>Saving:</b> save and load from the in-game Menu (<kbd>F10</kbd>) or load from the main menu. The game also saves itself every five minutes of play (the Autosave). Saves are kept in this browser.</p>
      <p><b>Controls:</b> left-click/drag to select, right-click to command, <kbd>Shift</kbd> to queue, arrow keys or screen edges to scroll, wheel to zoom, <kbd>H</kbd> Town Center, <kbd>.</kbd> idle villager, <kbd>Space</kbd> last alert, <kbd>Ctrl+1-9</kbd> groups, <kbd>F3</kbd> pause, <kbd>F10</kbd> menu. Command buttons use the grid <kbd>Q W E R T</kbd> / <kbd>A S D F G</kbd> / <kbd>Z X C V B</kbd>.</p>
      </div><div class="menu-buttons" style="margin-top:16px"><button class="mbtn" data-a="back">Back</button></div>`);
    (el.querySelector('[data-a=back]') as HTMLElement).addEventListener('click', () => this.showMain());
  }

  showCivs(): void {
    const cards = CIV_LIST.map((c) => {
      const uu = UNITS[c.uniqueUnit];
      return `<div class="box wood trim"><div class="civcard"><img src="${dataUri(civEmblem(c))}">
        <div><div class="cn">${c.name}</div><div class="cr">${c.realm} — “${c.motto}”</div></div></div>
        <p style="font-size:15px;margin:8px 0">${c.lore}</p>
        <div style="font-size:14px"><b>${c.specialty} civilization.</b></div>
        <ul style="font-size:14px;margin:4px 0;padding-left:18px">${c.bonuses.filter((b) => b.text).map((b) => `<li>${b.text}</li>`).join('')}</ul>
        <div style="display:flex;gap:10px;align-items:center;font-size:14px"><img src="${unitIcon(uu.model, PLAYER_COLORS[0].hex)}" style="width:48px;height:48px;border:1px solid #8a6a28">
          <div><b>${uu.name}:</b> ${uu.description.replace(/^[A-Za-z]+ unique unit\. /, '')}<br><i>${c.uniqueTechs.map((t) => TECHS[t].name).join(' · ')}</i></div></div>
        <div style="font-size:13px;margin-top:4px;color:#c9b68e">Team bonus: ${c.teamBonus.text}</div></div>`;
    }).join('');
    const el = this.frame(`<h2 style="font-family:Cinzel;color:#f2d98c;text-align:center;font-size:32px">The Eight Realms</h2>
      <p class="lore">${WORLD_LORE.intro[2]}</p><div class="civgrid">${cards}</div>
      <div class="menu-buttons" style="margin-top:16px"><button class="mbtn" data-a="back">Back</button></div>`);
    (el.querySelector('[data-a=back]') as HTMLElement).addEventListener('click', () => this.showMain());
  }

  showSetup(): void {
    const s = this.state;
    const civOpts = (sel: string, random: boolean) => `<option value="random" ${random ? 'selected' : ''}>Random</option>` + CIV_LIST.map((c) => `<option value="${c.id}" ${!random && c.id === sel ? 'selected' : ''}>${c.name}</option>`).join('');
    const rows = s.players.map((p, i) => `<tr data-i="${i}">
      <td><span class="colorsw" style="background:${PLAYER_COLORS[p.color].css}"></span>
        <select data-f="color">${PLAYER_COLORS.map((c, ci) => `<option value="${ci}" ${ci === p.color ? 'selected' : ''}>${c.name}</option>`).join('')}</select></td>
      <td><input data-f="name" value="${p.name.replace(/"/g, '&quot;')}" size="14"></td>
      <td><select data-f="civ">${civOpts(p.civ, p.random)}</select></td>
      <td><select data-f="team">${[1, 2, 3, 4].map((t) => `<option value="${t}" ${t === p.team ? 'selected' : ''}>Team ${t}</option>`).join('')}</select></td>
      <td>${p.human && !s.spectate ? '<i>Human</i>' : `<select data-f="difficulty">${(['easy', 'standard', 'hard', 'hardest'] as Difficulty[]).map((d) => `<option value="${d}" ${d === p.difficulty ? 'selected' : ''}>${d[0].toUpperCase() + d.slice(1)}</option>`).join('')}</select>`}</td>
      <td>${p.human ? '' : `<button class="mbtn small" data-f="remove">✕</button>`}</td></tr>`).join('');
    const human = s.players.find((p) => p.human)!;
    const hc = CIVS[human.civ] ?? CIVS.carthaginians;
    const el = this.frame(`<h2 style="font-family:Cinzel;color:#f2d98c;text-align:center;font-size:32px">${s.spectate ? 'Watch a Match' : 'Standard Game'}</h2>
      <div class="setup">
        <div class="box wood trim"><h3>Players</h3><table>${rows}</table>
          <button class="mbtn small" data-a="add" ${s.players.length >= 8 ? 'disabled' : ''}>+ Add computer player</button>
          <div class="civcard"><img src="${human.random ? '' : dataUri(civEmblem(hc))}" style="${human.random ? 'display:none' : ''}">
            <div>${human.random ? '<div class="cn">Random civilization</div>' : `<div class="cn">${hc.realm}</div><div class="cr">${hc.name} — ${hc.specialty}</div>
            <ul>${hc.bonuses.filter((b) => b.text).map((b) => `<li>${b.text}</li>`).join('')}</ul><div style="font-size:14px">Unique unit: <b>${UNITS[hc.uniqueUnit].name}</b></div>`}</div></div>
        </div>
        <div class="box wood trim"><h3>Game Settings</h3>
          <div class="row">Mode <select data-g="spectate"><option value="play" ${!s.spectate ? 'selected' : ''}>Play</option><option value="watch" ${s.spectate ? 'selected' : ''}>Spectate (every player is a computer)</option></select></div>
          <div class="row">Map <select data-g="mapType">${MAP_TYPES.map((m) => `<option value="${m.id}" ${m.id === s.mapType ? 'selected' : ''}>${m.name}</option>`).join('')}</select></div>
          <div style="font-size:13px;color:#c9b68e;margin:-2px 0 6px">${MAP_TYPES.find((m) => m.id === s.mapType)?.description ?? ''}</div>
          <div class="row">Map size <select data-g="mapSize">${MAP_SIZES.map((m) => `<option value="${m.size}" ${m.size === s.mapSize ? 'selected' : ''}>${m.name}</option>`).join('')}</select></div>
          <div class="row">Resources <select data-g="resources">${['standard', 'medium', 'high'].map((r) => `<option value="${r}" ${r === s.resources ? 'selected' : ''}>${r[0].toUpperCase() + r.slice(1)}</option>`).join('')}</select></div>
          <div class="row">Population <select data-g="popLimit">${[75, 100, 150, 200, 250].map((r) => `<option value="${r}" ${r === s.popLimit ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
          <div class="row">Starting age <select data-g="startAge">${['Dark Age', 'Feudal Age', 'Castle Age', 'Imperial Age'].map((a, i) => `<option value="${i}" ${(s.startAge ?? 0) === i ? 'selected' : ''}>${a}</option>`).join('')}</select></div>
          <div class="row">Victory <select data-g="victory"><option value="standard" ${s.victory === 'standard' ? 'selected' : ''}>Standard (conquest or wonder)</option><option value="conquest" ${s.victory === 'conquest' ? 'selected' : ''}>Conquest</option></select></div>
          <div class="row">Reveal map <select data-g="reveal"><option value="normal" ${s.reveal === 'normal' ? 'selected' : ''}>Normal</option><option value="explored" ${s.reveal === 'explored' ? 'selected' : ''}>Explored</option><option value="all" ${s.reveal === 'all' ? 'selected' : ''}>All visible</option></select></div>
          <button class="mbtn" data-a="start" style="margin-top:18px">Start Game</button>
          <button class="mbtn" data-a="back">Back</button>
        </div>
      </div>`);
    el.querySelectorAll('tr[data-i]').forEach((tr) => {
      const i = Number((tr as HTMLElement).dataset.i);
      tr.querySelectorAll('[data-f]').forEach((f) => {
        const field = (f as HTMLElement).dataset.f!;
        const handler = () => {
          const p = s.players[i];
          const v = (f as HTMLInputElement).value;
          if (field === 'color') {
            const other = s.players.find((o) => o.color === Number(v));
            if (other) other.color = p.color;
            p.color = Number(v);
          } else if (field === 'name') p.name = v.slice(0, 24) || 'Player';
          else if (field === 'civ') {
            p.random = v === 'random';
            if (!p.random) p.civ = v;
          } else if (field === 'team') p.team = Number(v);
          else if (field === 'difficulty') p.difficulty = v as Difficulty;
          else if (field === 'remove') s.players.splice(i, 1);
          this.saveState();
          if (field !== 'name') this.showSetup();
        };
        if (field === 'remove') f.addEventListener('click', handler);
        else f.addEventListener('change', handler);
      });
    });
    el.querySelectorAll('[data-g]').forEach((f) => f.addEventListener('change', () => {
      const k = (f as HTMLElement).dataset.g as keyof SetupState;
      const v = (f as HTMLSelectElement).value;
      (s as unknown as Record<string, unknown>)[k] = k === 'spectate' ? v === 'watch' : k === 'mapSize' || k === 'popLimit' || k === 'startAge' ? Number(v) : v;
      this.saveState();
      this.showSetup();
    }));
    (el.querySelector('[data-a=add]') as HTMLElement).addEventListener('click', () => {
      if (s.players.length >= 8) return;
      const used = new Set(s.players.map((p) => p.color));
      const color = [...Array(8).keys()].find((c) => !used.has(c)) ?? 0;
      const name = AI_NAMES.find((n) => !s.players.some((p) => p.name === n)) ?? `Rival ${s.players.length}`;
      s.players.push({ name, civ: CIV_LIST[s.players.length % CIV_LIST.length].id, color, team: s.players.length + 1, human: false, difficulty: 'standard', random: true });
      const sizes = [120, 120, 144, 168, 168, 200, 200, 220, 220];
      s.mapSize = Math.max(s.mapSize, sizes[s.players.length]);
      this.saveState();
      this.showSetup();
    });
    (el.querySelector('[data-a=back]') as HTMLElement).addEventListener('click', () => this.showMain());
    (el.querySelector('[data-a=start]') as HTMLElement).addEventListener('click', () => this.start(false));
  }

  private start(quick: boolean): void {
    const s = this.state;
    let players: PlayerSetup[];
    if (quick) {
      const civs = CIV_LIST.map((c) => c.id);
      const pick = () => civs[Math.floor(Math.random() * civs.length)];
      const human = s.players.find((p) => p.human)!;
      players = [
        { name: human.name, civ: human.random ? pick() : human.civ, color: human.color, team: 1, human: true, difficulty: 'standard' },
        { name: AI_NAMES[Math.floor(Math.random() * AI_NAMES.length)], civ: pick(), color: human.color === 1 ? 0 : 1, team: 2, human: false, difficulty: 'standard' },
      ];
    } else {
      const teams = new Set(s.players.map((p) => p.team));
      if (teams.size < 2) {
        alert('At least two teams are needed.');
        return;
      }
      players = s.players.map((p) => ({ ...p, human: p.human && !s.spectate, civ: p.random ? CIV_LIST[Math.floor(Math.random() * CIV_LIST.length)].id : p.civ }));
    }
    const setup: GameSetup = {
      seed: Math.floor(Math.random() * 1e9),
      mapType: quick ? (['steppe', 'highlands', 'mediterranean', 'oasis'] as MapType[])[Math.floor(Math.random() * 4)] : s.mapType,
      mapSize: quick ? 120 : s.mapSize,
      players,
      resources: quick ? 'standard' : s.resources,
      popLimit: quick ? 200 : s.popLimit,
      reveal: quick ? 'normal' : s.reveal,
      victory: quick ? 'standard' : s.victory,
      startAge: (quick ? 0 : s.startAge ?? 0) as GameSetup['startAge'],
      spectator: !quick && !!s.spectate,
    };
    this.onStart(setup);
  }

  /** The saved games, newest first: load one, or delete it. */
  async showLoad(message = ''): Promise<void> {
    let saves: SaveMeta[] = [];
    let err = message;
    try {
      saves = await listSaves();
    } catch (e) {
      err = (e as Error).message;
    }
    const el = this.frame(`<h2 style="font-family:Cinzel;color:#f2d98c;text-align:center;font-size:32px">Load Game</h2>
      <div class="save-panel">${err ? `<p class="save-err">${err.replace(/</g, '&lt;')}</p>` : ''}${saveListHtml(saves, 'load')}</div>
      <div class="menu-buttons" style="margin-top:16px"><button class="mbtn" data-a="back">Back</button></div>`);
    (el.querySelector('[data-a=back]') as HTMLElement).addEventListener('click', () => this.showMain());
    el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
      this.audio.play('click');
      const id = ((b as HTMLElement).closest('.save-row') as HTMLElement).dataset.id!;
      const meta = saves.find((x) => x.id === id);
      if ((b as HTMLElement).dataset.act === 'delete') {
        if (!meta || !confirm(`Delete "${meta.name}"? This cannot be undone.`)) return;
        await deleteSave(id);
        void this.showLoad();
      } else this.onLoad(id);
    }));
  }

  showLoading(text: string): void {
    this.root.innerHTML = `<div class="loading"><div class="title" style="font-size:42px">${WORLD_LORE.title}</div><div class="subtitle">${text}</div><div class="bar"><div style="width:30%"></div></div></div>`;
  }
}
