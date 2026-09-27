import type { Session } from './session';

const TERRAIN_COLORS = [0x5a8a34, 0x9a9450, 0x8a6a44, 0xd8c088, 0x46642c, 0x6a9aa8, 0x2a5a8a, 0x1a3a6a, 0xe8eef4, 0x9a8a78];

export class Minimap {
  private s: Session;
  private c: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private terrain: HTMLCanvasElement;
  private fog: HTMLCanvasElement;
  private fogData: ImageData;
  private lastDraw = 0;
  private lastTerrainVersion = -1;
  private lastTerrainTime = -100;
  private lastFogVersion = -1;
  private W = 560;
  private H = 300;
  private pad = 6;
  private flashes: { x: number; z: number; t: number }[] = [];
  private dragging = false;

  constructor(s: Session, c: HTMLCanvasElement) {
    this.s = s;
    this.c = c;
    this.ctx = c.getContext('2d')!;
    const n = s.game.map.n;
    this.terrain = document.createElement('canvas');
    this.terrain.width = this.terrain.height = n;
    this.fog = document.createElement('canvas');
    this.fog.width = this.fog.height = n;
    this.fogData = this.fog.getContext('2d')!.createImageData(n, n);
    c.addEventListener('mousedown', this.onDown);
    window.addEventListener('mousemove', this.onMove);
    window.addEventListener('mouseup', this.onUp);
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private get sx(): number {
    return (this.W / 2 - this.pad) / this.s.game.map.n;
  }
  private get sy(): number {
    return (this.H - 2 * this.pad) / (2 * this.s.game.map.n);
  }

  toMini(x: number, z: number): [number, number] {
    return [this.W / 2 + (x - z) * this.sx, this.pad + (x + z) * this.sy];
  }

  toWorld(mx: number, my: number): { x: number; z: number } {
    const a = (mx - this.W / 2) / this.sx, b = (my - this.pad) / this.sy;
    return { x: (a + b) / 2, z: (b - a) / 2 };
  }

  private eventPos(e: MouseEvent): { x: number; z: number } {
    const r = this.c.getBoundingClientRect();
    const mx = ((e.clientX - r.left) / r.width) * this.W, my = ((e.clientY - r.top) / r.height) * this.H;
    return this.toWorld(mx, my);
  }

  private onDown = (e: MouseEvent): void => {
    e.stopPropagation();
    const p = this.eventPos(e);
    if (e.button === 0) {
      this.dragging = true;
      this.s.renderer.centerOn(p.x, p.z);
    } else if (e.button === 2) {
      this.s.input.commandAtGround(p.x, p.z, e.shiftKey);
    }
  };
  private onMove = (e: MouseEvent): void => {
    if (!this.dragging) return;
    const p = this.eventPos(e);
    this.s.renderer.centerOn(p.x, p.z);
  };
  private onUp = (): void => {
    this.dragging = false;
  };

  flash(x: number, z: number): void {
    this.flashes.push({ x, z, t: performance.now() });
  }

  private renderTerrain(): void {
    const g = this.s.game;
    const n = g.map.n;
    const ctx = this.terrain.getContext('2d')!;
    const img = ctx.createImageData(n, n);
    for (let i = 0; i < n * n; i++) {
      let col = TERRAIN_COLORS[g.map.terrain[i]] ?? 0x5a8a34;
      const h = g.map.heights[Math.floor(i / n) * (n + 1) + (i % n)];
      const shade = 0.9 + Math.max(-0.2, Math.min(0.25, h * 0.08));
      let r = ((col >> 16) & 255) * shade, gg = ((col >> 8) & 255) * shade, b = (col & 255) * shade;
      const id = g.map.obstacle[i];
      if (id) {
        const e = g.get(id);
        if (e && e.kind === 'resource' && e.type === 'tree') {
          col = 0x2c4a1c;
          r = (col >> 16) & 255;
          gg = (col >> 8) & 255;
          b = col & 255;
        }
      }
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = gg;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  private renderFog(): void {
    const g = this.s.game;
    const team = this.s.viewTeam();
    const vis = g.vision.visible.get(team), exp = g.vision.explored.get(team);
    const d = this.fogData.data;
    const n = g.map.n;
    for (let i = 0; i < n * n; i++) {
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 0;
      d[i * 4 + 3] = !exp ? 0 : !exp[i] ? 255 : vis && vis[i] ? 0 : 120;
    }
    this.fog.getContext('2d')!.putImageData(this.fogData, 0, 0);
  }

  /** Redraw the fog and markers now (the view changed). */
  refresh(): void {
    this.lastFogVersion = -1;
    this.lastDraw = 0;
  }

  update(now: number): void {
    if (now - this.lastDraw < 200) return;
    this.lastDraw = now;
    const s = this.s;
    const g = s.game;
    if (g.resourcesVersion !== this.lastTerrainVersion && (this.lastTerrainVersion < 0 || g.time - this.lastTerrainTime > 3)) {
      this.lastTerrainVersion = g.resourcesVersion;
      this.lastTerrainTime = g.time;
      this.renderTerrain();
    }
    if (g.vision.version !== this.lastFogVersion) {
      this.lastFogVersion = g.vision.version;
      this.renderFog();
    }
    const ctx = this.ctx;
    const W = this.W, H = this.H;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(this.sx, this.sy, -this.sx, this.sy, W / 2, this.pad);
    ctx.drawImage(this.terrain, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const team = s.viewTeam();
    const vis = g.vision.visible.get(team), exp = g.vision.explored.get(team);
    const n = g.map.n;
    const expAt = (x: number, z: number) => !exp || exp[Math.floor(z) * n + Math.floor(x)] === 1;
    const visAt = (x: number, z: number) => !vis || vis[Math.floor(z) * n + Math.floor(x)] === 1;
    // resources
    for (const r of g.resources) {
      if (!r.alive || r.type === 'tree' || r.type === 'carcass') continue;
      if (r.type === 'relic' && r.heldBy) continue;
      if (!expAt(r.x, r.z)) continue;
      const [mx, my] = this.toMini(r.x, r.z);
      ctx.fillStyle = r.type === 'gold' ? '#f4d020' : r.type === 'stone' ? '#b8b8b0' : r.type === 'berries' ? '#c83a5a' : '#ffffff';
      ctx.fillRect(mx - 2, my - 1.5, 4, 3);
    }
    // buildings
    const bit = 1 << (team & 15);
    for (const b of g.buildings) {
      if (!b.alive) continue;
      if (team >= 0 && g.teamOf[b.owner] !== team && !(b.seenBy & bit)) continue;
      const pts = [this.toMini(b.tx, b.tz), this.toMini(b.tx + b.w, b.tz), this.toMini(b.tx + b.w, b.tz + b.h), this.toMini(b.tx, b.tz + b.h)];
      ctx.fillStyle = g.players[b.owner].color.css;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
      ctx.closePath();
      ctx.fill();
      if (b.w > 1) ctx.stroke();
    }
    // units
    for (const u of g.units) {
      if (!u.alive || u.garrisonedIn) continue;
      if (g.teamOf[u.owner] !== team && !visAt(u.x, u.z)) continue;
      const [mx, my] = this.toMini(u.x, u.z);
      ctx.fillStyle = u.owner === 0 ? (u.def.animal === 'wolf' ? '#a0a0a0' : '#e8dcc0') : g.players[u.owner].color.css;
      const sz = u.def.classes.includes('siege') ? 4 : 3;
      ctx.fillRect(mx - sz / 2, my - sz / 2, sz, sz);
    }
    // fog
    ctx.setTransform(this.sx, this.sy, -this.sx, this.sy, W / 2, this.pad);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.fog, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // map border
    ctx.strokeStyle = 'rgba(216,178,90,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const c0 = this.toMini(0, 0), c1 = this.toMini(n, 0), c2 = this.toMini(n, n), c3 = this.toMini(0, n);
    ctx.moveTo(c0[0], c0[1]);
    ctx.lineTo(c1[0], c1[1]);
    ctx.lineTo(c2[0], c2[1]);
    ctx.lineTo(c3[0], c3[1]);
    ctx.closePath();
    ctx.stroke();
    // camera view
    const poly = s.renderer.getViewPolygon();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    poly.forEach((p, i) => {
      const [mx, my] = this.toMini(p.x, p.z);
      if (i === 0) ctx.moveTo(mx, my);
      else ctx.lineTo(mx, my);
    });
    ctx.closePath();
    ctx.stroke();
    // alert flashes
    const keep: typeof this.flashes = [];
    for (const f of this.flashes) {
      const age = (now - f.t) / 1000;
      if (age > 3) continue;
      keep.push(f);
      const [mx, my] = this.toMini(f.x, f.z);
      ctx.strokeStyle = `rgba(255,60,40,${1 - age / 3})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(mx, my, 4 + ((age * 20) % 16), 0, Math.PI * 2);
      ctx.stroke();
    }
    this.flashes = keep;
  }
}
