import type { Entity, Unit } from '../sim/entities';
import type { UnitDef } from '../data/types';

type SfxName =
  | 'click' | 'error' | 'place' | 'built' | 'trained' | 'research' | 'ageUp' | 'ageUpOther' | 'alarm' | 'convert'
  | 'death' | 'collapse' | 'melee' | 'buildingHit' | 'boom' | 'arrowHit' | 'bow' | 'gun' | 'catapult' | 'fireLance'
  | 'victory' | 'defeat';

/**
 * All audio is synthesized with WebAudio: effects from filtered noise and oscillators,
 * music from Karplus-Strong plucked strings over a drone in a modal scale.
 */
export class AudioSys {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noise!: AudioBuffer;
  sfxOn = true;
  musicOn = true;
  private musicTimer = 0;
  private lastPlayed = new Map<string, number>();
  private pluckCache = new Map<number, AudioBuffer>();
  private musicStarted = false;
  private listener: { x: number; z: number; range: number } = { x: 0, z: 0, range: 20 };
  private ambTimer = 0;

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(c.destination);
    this.sfxBus = c.createGain();
    this.sfxBus.gain.value = 0.55;
    this.sfxBus.connect(this.master);
    this.musicBus = c.createGain();
    this.musicBus.gain.value = 0.22;
    this.musicBus.connect(this.master);
    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    if (this.musicStarted && this.musicOn) this.scheduleMusic();
    this.ambTimer = window.setInterval(() => this.ambient(), 3000);
  }

  setListener(x: number, z: number, range: number): void {
    this.listener = { x, z, range };
  }

  /* ------------------------------------------------------------------ */
  /* primitives                                                           */
  /* ------------------------------------------------------------------ */

  private env(g: GainNode, t: number, a: number, peak: number, d: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, when = 0, bus?: AudioNode, slide = 0): void {
    const c = this.ctx!;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    const g = c.createGain();
    this.env(g, t, 0.005, vol, dur);
    o.connect(g).connect(bus ?? this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noiseBurst(dur: number, vol: number, filter: BiquadFilterType, freq: number, q = 1, when = 0, sweepTo = 0, bus?: AudioNode): void {
    const c = this.ctx!;
    const t = c.currentTime + when;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = c.createGain();
    this.env(g, t, 0.004, vol, dur);
    src.connect(f).connect(g).connect(bus ?? this.sfxBus);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private brass(freq: number, dur: number, vol: number, when: number): void {
    const c = this.ctx!;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(freq * 0.98, t);
    o.frequency.linearRampToValueAtTime(freq, t + 0.06);
    const lfo = c.createOscillator();
    lfo.frequency.value = 5.5;
    const lg = c.createGain();
    lg.gain.value = freq * 0.006;
    lfo.connect(lg).connect(o.frequency);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(600, t);
    f.frequency.linearRampToValueAtTime(2400, t + 0.08);
    f.frequency.linearRampToValueAtTime(1400, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.05);
    g.gain.setValueAtTime(vol, t + dur - 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(this.sfxBus);
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);
  }

  /** Very small formant "voice" blip for unit acknowledgements. */
  private voice(pitch: number, formants: number[], dur: number, vol: number, when = 0): void {
    const c = this.ctx!;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(pitch, t);
    o.frequency.linearRampToValueAtTime(pitch * (0.85 + Math.random() * 0.3), t + dur);
    const g = c.createGain();
    this.env(g, t, 0.02, vol, dur);
    for (const fr of formants) {
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = fr;
      f.Q.value = 8;
      o.connect(f).connect(g);
    }
    g.connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /* ------------------------------------------------------------------ */
  /* public api                                                           */
  /* ------------------------------------------------------------------ */

  private throttle(name: string, ms: number): boolean {
    const now = performance.now();
    const last = this.lastPlayed.get(name) ?? 0;
    if (now - last < ms) return false;
    this.lastPlayed.set(name, now);
    return true;
  }

  play(name: SfxName, vol = 1): void {
    if (!this.ctx || !this.sfxOn) return;
    const minGap: Partial<Record<SfxName, number>> = { melee: 45, bow: 40, arrowHit: 50, death: 90, buildingHit: 80, boom: 90, gun: 60, catapult: 80 };
    if (!this.throttle(name, minGap[name] ?? 30)) return;
    const v = vol;
    switch (name) {
      case 'click':
        this.tone(1400, 0.03, 'square', 0.05 * v);
        break;
      case 'error':
        this.tone(160, 0.18, 'sawtooth', 0.12 * v);
        this.tone(120, 0.2, 'sawtooth', 0.1 * v, 0.1);
        break;
      case 'place':
        this.noiseBurst(0.12, 0.3 * v, 'lowpass', 600);
        this.tone(90, 0.15, 'sine', 0.3 * v);
        break;
      case 'built':
        [523, 659, 784].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.12 * v, i * 0.09));
        this.noiseBurst(0.3, 0.12 * v, 'lowpass', 400);
        break;
      case 'trained':
        this.tone(392, 0.25, 'triangle', 0.1 * v);
        this.tone(587, 0.35, 'triangle', 0.1 * v, 0.1);
        break;
      case 'research':
        [659, 880, 1046].forEach((f, i) => this.tone(f, 0.5, 'sine', 0.09 * v, i * 0.08));
        break;
      case 'ageUp': {
        const seq = [[392, 0.25], [392, 0.12], [523, 0.5], [659, 0.3], [784, 0.9]];
        let t = 0;
        for (const [f, d] of seq) {
          this.brass(f, d, 0.12 * v, t);
          this.brass(f / 2, d, 0.06 * v, t);
          t += d * 0.9;
        }
        break;
      }
      case 'ageUpOther':
        this.brass(330, 0.3, 0.08 * v, 0);
        this.brass(440, 0.6, 0.08 * v, 0.25);
        break;
      case 'alarm':
        this.brass(220, 0.45, 0.14 * v, 0);
        this.brass(220, 0.7, 0.14 * v, 0.55);
        break;
      case 'convert':
        [0, 0.18, 0.36].forEach((w, i) => this.voice(180 + i * 30, [700, 1100, 2400], 0.2, 0.25 * v, w));
        break;
      case 'death':
        this.voice(150 + Math.random() * 80, [500, 900], 0.28, 0.2 * v);
        this.noiseBurst(0.15, 0.08 * v, 'lowpass', 500);
        break;
      case 'collapse':
        this.noiseBurst(1.8, 0.5 * v, 'lowpass', 900, 1, 0, 80);
        this.noiseBurst(0.6, 0.3 * v, 'bandpass', 300, 0.8, 0.3);
        break;
      case 'melee':
        this.noiseBurst(0.08, 0.2 * v, 'bandpass', 3000 + Math.random() * 1500, 3);
        this.tone(1800 + Math.random() * 900, 0.12, 'triangle', 0.04 * v);
        break;
      case 'buildingHit':
        this.noiseBurst(0.1, 0.22 * v, 'lowpass', 700);
        this.tone(110, 0.1, 'sine', 0.15 * v);
        break;
      case 'boom':
        this.noiseBurst(0.7, 0.5 * v, 'lowpass', 1200, 1, 0, 90);
        this.tone(60, 0.4, 'sine', 0.35 * v, 0, undefined, 0.5);
        break;
      case 'arrowHit':
        this.noiseBurst(0.05, 0.1 * v, 'bandpass', 1500, 2);
        break;
      case 'bow':
        this.noiseBurst(0.12, 0.08 * v, 'highpass', 2000, 1, 0, 800);
        this.tone(220 + Math.random() * 40, 0.08, 'triangle', 0.05 * v, 0, undefined, 0.6);
        break;
      case 'gun':
        this.noiseBurst(0.35, 0.45 * v, 'lowpass', 2500, 1, 0, 200);
        this.tone(80, 0.25, 'sine', 0.3 * v, 0, undefined, 0.5);
        break;
      case 'catapult':
        this.noiseBurst(0.35, 0.15 * v, 'bandpass', 500, 1.5, 0, 150);
        this.tone(140, 0.2, 'triangle', 0.1 * v, 0.05, undefined, 0.5);
        break;
      case 'fireLance':
        this.noiseBurst(0.5, 0.25 * v, 'bandpass', 900, 0.8, 0, 300);
        break;
      case 'victory': {
        const seq = [523, 659, 784, 1046, 784, 1046];
        seq.forEach((f, i) => this.brass(f, 0.4, 0.1, i * 0.28));
        break;
      }
      case 'defeat': {
        const seq = [392, 349, 311, 262];
        seq.forEach((f, i) => this.brass(f, 0.6, 0.1, i * 0.45));
        break;
      }
    }
  }

  /** Positional one-shot, attenuated by distance from the camera. */
  at(name: SfxName, x: number, z: number, _def?: UnitDef): void {
    if (!this.ctx || !this.sfxOn) return;
    const d = Math.hypot(x - this.listener.x, z - this.listener.z);
    const r = this.listener.range;
    if (d > r * 1.6) return;
    const vol = Math.max(0.08, 1 - d / (r * 1.6));
    this.play(name, vol);
  }

  selectSound(e: Entity): void {
    if (!this.ctx || !this.sfxOn || !this.throttle('select', 150)) return;
    if (e.kind === 'building') {
      if (e.type === 'house') this.tone(300, 0.15, 'triangle', 0.08);
      else if (e.type === 'barracks' || e.type === 'castle') this.brass(196, 0.3, 0.06, 0);
      else if (e.type === 'monastery') this.voice(200, [700, 1150, 2500], 0.5, 0.18);
      else if (e.type === 'blacksmith') this.noiseBurst(0.08, 0.15, 'bandpass', 3500, 5);
      else if (e.type === 'farm') this.noiseBurst(0.2, 0.06, 'highpass', 3000);
      else if (e.type === 'townCenter') this.tone(440, 0.2, 'sine', 0.06);
      else this.tone(330, 0.12, 'triangle', 0.06);
      return;
    }
    if (e.kind === 'unit') this.unitVoice(e, 'select');
  }

  ackSound(u: Unit, kind: 'move' | 'attack' | 'work'): void {
    if (!this.ctx || !this.sfxOn || !this.throttle('ack', 200)) return;
    this.unitVoice(u, kind === 'attack' ? 'attack' : 'ack');
  }

  private unitVoice(u: Unit, kind: 'select' | 'ack' | 'attack'): void {
    const d = u.def;
    if (d.animal) {
      if (d.animal === 'sheep') this.voice(420, [900, 2200], 0.3, 0.15);
      return;
    }
    if (d.classes.includes('siege')) {
      this.noiseBurst(0.25, 0.1, 'bandpass', 400, 2);
      return;
    }
    const female = d.gatherer && u.id % 2 === 1;
    const base = female ? 230 : d.monk ? 140 : 120;
    const vowels = [[730, 1090], [530, 1840], [270, 2290], [570, 840], [440, 1020]];
    const n = kind === 'attack' ? 2 : 1 + (u.id % 2);
    for (let i = 0; i < n; i++) {
      const v = vowels[(u.id + i * 3 + (kind === 'ack' ? 1 : 0)) % vowels.length];
      this.voice(base * (kind === 'attack' ? 1.25 : 1) * (1 + i * 0.08), v, kind === 'attack' ? 0.14 : 0.12, 0.28, i * 0.13);
    }
  }

  /* ------------------------------------------------------------------ */
  /* ambience & music                                                     */
  /* ------------------------------------------------------------------ */

  private ambient(): void {
    if (!this.ctx || !this.sfxOn || this.ctx.state !== 'running') return;
    if (Math.random() < 0.5) {
      const base = 2200 + Math.random() * 1500;
      const n = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) this.tone(base * (1 + Math.random() * 0.2), 0.07, 'sine', 0.015, i * 0.11, undefined, 0.75 + Math.random() * 0.4);
    }
  }

  private pluckBuffer(freq: number): AudioBuffer {
    const key = Math.round(freq * 10);
    const c = this.pluckCache.get(key);
    if (c) return c;
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const dur = 2.2;
    const buf = ctx.createBuffer(1, Math.floor(sr * dur), sr);
    const d = buf.getChannelData(0);
    const N = Math.max(2, Math.round(sr / freq));
    const ring = new Float32Array(N);
    for (let i = 0; i < N; i++) ring[i] = Math.random() * 2 - 1;
    let idx = 0;
    let prev = 0;
    for (let i = 0; i < d.length; i++) {
      const cur = ring[idx];
      const nxt = 0.4985 * (cur + ring[(idx + 1) % N]) + 0.001 * prev;
      ring[idx] = nxt;
      prev = cur;
      d[i] = cur * 0.6;
      idx = (idx + 1) % N;
    }
    this.pluckCache.set(key, buf);
    return buf;
  }

  private pluck(freq: number, when: number, vol: number): void {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.pluckBuffer(freq);
    const g = c.createGain();
    g.gain.value = vol;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2600;
    src.connect(f).connect(g).connect(this.musicBus);
    src.start(when);
  }

  private drone(freq: number, when: number, dur: number): void {
    const c = this.ctx!;
    for (const [mul, type, vol] of [[1, 'sawtooth', 0.025], [1.5, 'triangle', 0.02], [0.5, 'sine', 0.05]] as [number, OscillatorType, number][]) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = freq * mul;
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 700;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(vol, when + 1.5);
      g.gain.setValueAtTime(vol, when + dur - 1.5);
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      o.connect(f).connect(g).connect(this.musicBus);
      o.start(when);
      o.stop(when + dur + 0.1);
    }
  }

  private drum(when: number, low: boolean, vol: number): void {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(low ? 110 : 190, when);
    o.frequency.exponentialRampToValueAtTime(low ? 50 : 90, when + 0.18);
    const g = c.createGain();
    this.env(g, when, 0.003, vol, 0.25);
    o.connect(g).connect(this.musicBus);
    o.start(when);
    o.stop(when + 0.35);
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = low ? 300 : 1800;
    const g2 = c.createGain();
    this.env(g2, when, 0.002, vol * 0.4, 0.08);
    src.connect(f).connect(g2).connect(this.musicBus);
    src.start(when, Math.random());
    src.stop(when + 0.15);
  }

  /** Generates ~24s phrases of modal music and schedules the next one. */
  private scheduleMusic(): void {
    if (!this.ctx || !this.musicOn) return;
    const c = this.ctx;
    const start = c.currentTime + 0.2;
    // Phrygian dominant / Dorian flavoured scales around D
    const modes = [
      [0, 1, 4, 5, 7, 8, 10], // phrygian dominant
      [0, 2, 3, 5, 7, 9, 10], // dorian
      [0, 2, 3, 5, 7, 8, 10], // aeolian
    ];
    const mode = modes[Math.floor(Math.random() * modes.length)];
    const root = 146.83; // D3
    const note = (deg: number, oct = 0) => {
      const o = Math.floor(deg / 7);
      const s = mode[((deg % 7) + 7) % 7];
      return root * Math.pow(2, (s + 12 * (o + oct)) / 12);
    };
    const beat = 0.42;
    const bars = 14;
    const len = bars * 4 * beat;
    this.drone(root / 2, start, len);
    let deg = 7;
    for (let b = 0; b < bars; b++) {
      for (let i = 0; i < 4; i++) {
        const t = start + (b * 4 + i) * beat;
        if (i === 0) this.drum(t, true, 0.35);
        if (i === 2 && Math.random() < 0.7) this.drum(t, false, 0.18);
        if (Math.random() < 0.3) this.drum(t + beat / 2, false, 0.1);
        // melody: stepwise random walk, occasional rests and ornaments
        if (Math.random() < 0.82) {
          deg += Math.random() < 0.7 ? (Math.random() < 0.5 ? 1 : -1) : Math.random() < 0.5 ? 2 : -2;
          deg = Math.max(3, Math.min(13, deg));
          this.pluck(note(deg), t, 0.5);
          if (Math.random() < 0.25) this.pluck(note(deg + 1), t + beat / 2, 0.35);
        }
        if (i === 0 && b % 2 === 0) this.pluck(note(0), t, 0.3);
      }
    }
    // rest a while between phrases
    const gap = 8 + Math.random() * 10;
    this.musicTimer = window.setTimeout(() => this.scheduleMusic(), (len + gap) * 1000);
  }

  startMusic(): void {
    this.musicStarted = true;
    if (this.ctx && this.musicOn && !this.musicTimer) this.scheduleMusic();
  }

  stopMusic(): void {
    clearTimeout(this.musicTimer);
    this.musicTimer = 0;
    this.musicStarted = false;
  }

  toggleMusic(): void {
    this.musicOn = !this.musicOn;
    if (this.ctx) this.musicBus.gain.value = this.musicOn ? 0.22 : 0;
    if (this.musicOn && this.musicStarted && !this.musicTimer) this.scheduleMusic();
  }
}
