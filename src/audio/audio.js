// ─────────────────────────────────────────────────────────────
//  Prozedurales Sound-Design mit der Web Audio API.
//  Jeder Klang wird synthetisiert: Schüsse, Zombies, Musik, Ambiente.
//  3D-Positionierung über HRTF-Panner.
// ─────────────────────────────────────────────────────────────
import { rand, pick, clamp } from '../core/utils.js';

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.volumes = { master: 0.8, music: 0.6, sfx: 1.0 };
    this.voices = 0;
    this.panningModel = 'HRTF'; // auf Mobilgeräten 'equalpower' (spart viel CPU)
  }

  init() {
    // iOS: Ton auch bei aktiviertem Stummschalter abspielen
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* */ }
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.gain.value = this.volumes.master;
    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = 20000;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4;
    comp.attack.value = 0.003; comp.release.value = 0.25;
    this.master.connect(this.lowpass).connect(comp).connect(ctx.destination);

    this.sfx = ctx.createGain(); this.sfx.gain.value = this.volumes.sfx; this.sfx.connect(this.master);
    this.music = ctx.createGain(); this.music.gain.value = this.volumes.music; this.music.connect(this.master);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.6, 2.4);
    this.reverbIn = ctx.createGain(); this.reverbIn.gain.value = 0.5;
    this.reverbIn.connect(this.reverb).connect(this.master);

    this.noiseBuf = this.makeNoise(2);
    this.brownBuf = this.makeNoise(4, true);
    this.distCurve = this.makeDistortion(40);
    this.startAmbience();
  }

  setVolumes(v) {
    Object.assign(this.volumes, v);
    if (!this.ctx) return;
    this.master.gain.value = this.volumes.master;
    this.music.gain.value = this.volumes.music;
    this.sfx.gain.value = this.volumes.sfx;
  }

  get now() { return this.ctx.currentTime; }

  makeNoise(sec, brown = false) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return buf;
  }

  impulse(sec, decay) {
    const ctx = this.ctx;
    const len = ctx.sampleRate * sec;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  makeDistortion(k) {
    const n = 1024, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; c[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x)); }
    return c;
  }

  // ── Bausteine ───────────────────────────────────────────────
  out(pos, vol = 1, reverb = 0.25) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = vol;
    let node = g;
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = this.panningModel;
      p.distanceModel = 'inverse';
      p.refDistance = 2.5;
      p.maxDistance = 80;
      p.rolloffFactor = 1.3;
      p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
      g.connect(p);
      node = p;
    }
    node.connect(this.sfx);
    if (reverb > 0) {
      const r = ctx.createGain(); r.gain.value = reverb;
      node.connect(r).connect(this.reverbIn);
    }
    return g;
  }

  env(param, t, a, peak, d, end = 0.0001) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + a);
    param.exponentialRampToValueAtTime(Math.max(end, 0.0001), t + a + d);
  }

  noise(dest, t, dur, { type = 'lowpass', f = 1000, f2 = null, q = 0.7, a = 0.002, peak = 1, brown = false } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = brown ? this.brownBuf : this.noiseBuf;
    src.loop = true;
    const fl = ctx.createBiquadFilter();
    fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ctx.createGain();
    this.env(g.gain, t, a, peak, dur);
    src.connect(fl).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + a + dur + 0.05);
    return g;
  }

  tone(dest, t, dur, { type = 'sine', f = 440, f2 = null, a = 0.005, peak = 0.5, detune = 0, curve = 'exp' } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
    if (f2) {
      if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(f2, t + dur);
      else o.frequency.linearRampToValueAtTime(f2, t + dur);
    }
    const g = ctx.createGain();
    this.env(g.gain, t, a, peak, dur);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + a + dur + 0.05);
    return o;
  }

  // ── Waffen ──────────────────────────────────────────────────
  // Schuss: Knall (Transiente), Körper (gefiltertes Rauschen, angezerrt), Tiefdruck (Sinus-Sweep),
  // Mechanik (Verschluss), Raum (Hall + Echo), Zufallsvariation, PaP-Schicht
  gunshot(kind, pap = false) {
    if (!this.ctx) return;
    if (kind === 'ray') return this.rayShot(pap);
    if (kind === 'tesla') return this.teslaBlast(pap);
    const P = {
      pistol: { vol: 0.9, crack: 0.016, cf: 4300, body: 0.11, bf: 2700, thump: 140, td: 0.1, tail: 0.32, drive: 2.2, mech: 'slide', echo: 0.16 },
      rifle: { vol: 1.05, crack: 0.024, cf: 3400, body: 0.2, bf: 2200, thump: 108, td: 0.16, tail: 0.5, drive: 2.8, mech: 'oprod', echo: 0.26 },
      smg: { vol: 0.72, crack: 0.011, cf: 4900, body: 0.07, bf: 3100, thump: 155, td: 0.07, tail: 0.24, drive: 2.0, mech: 'tick', echo: 0.12 },
      ar: { vol: 0.86, crack: 0.015, cf: 3900, body: 0.12, bf: 2450, thump: 122, td: 0.11, tail: 0.34, drive: 2.4, mech: 'bolt', echo: 0.18 },
      lmg: { vol: 0.95, crack: 0.019, cf: 3300, body: 0.15, bf: 2050, thump: 96, td: 0.13, tail: 0.4, drive: 2.6, mech: 'belt', echo: 0.22 },
      shotgun: { vol: 1.25, crack: 0.03, cf: 2600, body: 0.32, bf: 1750, thump: 74, td: 0.24, tail: 0.6, drive: 3.2, mech: null, echo: 0.34 },
      sniper: { vol: 1.45, crack: 0.04, cf: 2900, body: 0.45, bf: 1800, thump: 54, td: 0.36, tail: 0.9, drive: 3.4, mech: 'heavy', echo: 0.5 },
    }[kind] || null;
    if (!P) return;
    const ctx = this.ctx, t = this.now, v = rand(0.92, 1.08);
    const rapid = t - (this.wLastShot || 0) < 0.11;
    this.wLastShot = t;
    const out = this.out(null, P.vol * rand(0.94, 1.04), rapid ? P.tail * 0.6 : P.tail);
    // Angezerrter Körper für Biss
    const drive = ctx.createGain(); drive.gain.value = P.drive;
    const ws = ctx.createWaveShaper(); ws.curve = this.distCurve;
    const make = ctx.createGain(); make.gain.value = 2.1;
    drive.connect(ws).connect(make).connect(out);
    setTimeout(() => { try { drive.disconnect(); make.disconnect(); } catch { /* */ } }, (P.body + 0.4) * 1000);
    // Transiente
    this.noise(out, t, P.crack, { type: 'highpass', f: P.cf * v, peak: 1.0, a: 0.0006 });
    this.tone(out, t, 0.014, { type: 'square', f: P.cf * 0.32 * v, f2: 260, peak: 0.22, a: 0.0005 });
    // Körper
    this.noise(drive, t, P.body, { type: 'lowpass', f: P.bf * v, f2: 220, peak: 1.0, a: 0.001 });
    this.noise(out, t + 0.002, P.body * 0.7, { type: 'bandpass', f: P.bf * 0.45 * v, f2: 170, q: 0.9, peak: 0.55 });
    // Tiefdruck
    this.tone(out, t, P.td, { f: P.thump * 1.9 * v, f2: P.thump * 0.35, peak: 1.0, a: 0.002 });
    // Raum: Nachhall und Echo von den Wänden
    this.noise(out, t + 0.01, P.body * 2.4, { type: 'bandpass', f: 520, f2: 110, q: 0.5, peak: 0.22, brown: true });
    if (!rapid) this.noise(out, t + P.echo * rand(0.85, 1.12), P.body * 1.8, { type: 'lowpass', f: 950, f2: 150, peak: 0.15, a: 0.012, brown: true });
    this.wMech(out, t, P.mech, v);
    if (pap) {
      this.tone(out, t, 0.22, { type: 'sawtooth', f: 2400 * v, f2: 260, peak: 0.07 });
      this.tone(out, t, 0.3, { type: 'sine', f: 3400 * v, f2: 800, peak: 0.1 });
      this.tone(out, t + 0.01, 0.25, { type: 'sine', f: 95, f2: 40, peak: 0.45 });
      this.noise(out, t, 0.18, { type: 'bandpass', f: 5200, f2: 1800, q: 3, peak: 0.12 });
    }
  }

  // Verschluss-Mechanik nach dem Schuss
  wMech(out, t, type, v = 1) {
    const c = (dt, f, p, d = 0.018, q = 4) => this.noise(out, t + dt, d, { type: 'bandpass', f: f * v, q, peak: p, a: 0.0005 });
    switch (type) {
      case 'slide': c(0.028, 2600, 0.35); c(0.062, 1700, 0.28, 0.022); break;
      case 'bolt': c(0.03, 2100, 0.22); this.tone(out, t + 0.034, 0.05, { type: 'triangle', f: 3600 * v, peak: 0.03 }); break;
      case 'tick': c(0.022, 2900, 0.18, 0.012); break;
      case 'belt': c(0.025, 1900, 0.2); c(0.048, 3100, 0.12, 0.01); break;
      case 'oprod': c(0.035, 1800, 0.3, 0.025); c(0.075, 2400, 0.22); break;
      case 'heavy': c(0.05, 1300, 0.35, 0.035, 3); c(0.11, 2000, 0.25, 0.025); break;
    }
  }

  // Kurzes metallisches Klicken (Baustein der Nachlade-Geräusche)
  wClick(out, t, f, peak = 0.5, dur = 0.018, q = 4) {
    this.noise(out, t, dur, { type: 'bandpass', f, q, peak, a: 0.0006 });
    this.tone(out, t, dur * 1.6, { type: 'square', f: f / 3, f2: f / 6, peak: peak * 0.08 });
  }

  rayShot(pap) {
    if (!this.ctx) return;
    const t = this.now, out = this.out(null, 0.75, 0.45), b = (pap ? 820 : 1250) * rand(0.97, 1.03);
    this.tone(out, t, 0.3, { type: 'sawtooth', f: b * 2, f2: b * 0.18, peak: 0.2 });
    this.tone(out, t, 0.3, { type: 'sawtooth', f: b * 2.02, f2: b * 0.19, peak: 0.14, detune: 25 });
    this.tone(out, t, 0.32, { type: 'square', f: b, f2: b * 0.14, peak: 0.08, detune: -12 });
    this.tone(out, t, 0.22, { type: 'sine', f: 260, f2: 55, peak: 0.7 });
    this.noise(out, t, 0.12, { type: 'bandpass', f: 3200, f2: 700, q: 2, peak: 0.28 });
    this.tone(out, t + 0.05, 0.4, { type: 'sine', f: b * 3.1, f2: b * 1.2, peak: 0.05 });
  }

  // Gewitter-Werfer: Entladung, Knistern, Donner
  teslaBlast(pap) {
    if (!this.ctx) return;
    const t = this.now, out = this.out(null, 1.0, 0.55);
    this.noise(out, t, 0.06, { type: 'highpass', f: 3000, peak: 1.0, a: 0.001 });
    this.noise(out, t, 0.45, { type: 'highpass', f: 2200, f2: 5000, a: 0.004, peak: 0.45 });
    for (let i = 0; i < 12; i++) this.noise(out, t + rand(0, 0.4), 0.025, { type: 'bandpass', f: rand(2000, 7000), q: 3, peak: rand(0.3, 0.75) });
    this.tone(out, t, 0.5, { type: 'sawtooth', f: pap ? 85 : 115, f2: 38, peak: 0.45 });
    this.tone(out, t, 0.18, { type: 'square', f: pap ? 240 : 320, f2: 60, peak: 0.12 });
    this.noise(out, t + 0.04, 1.5, { type: 'lowpass', f: 320, f2: 50, a: 0.03, peak: 1.0, brown: true });
  }

  emptyClick() {
    if (!this.ctx) return;
    const out = this.out(null, 0.55, 0.04), t = this.now;
    this.noise(out, t, 0.008, { type: 'bandpass', f: 3800, q: 6, peak: 0.9, a: 0.0004 });
    this.noise(out, t + 0.012, 0.012, { type: 'bandpass', f: 2200, q: 5, peak: 0.4 });
    this.tone(out, t, 0.03, { type: 'square', f: 1700, f2: 900, peak: 0.05 });
  }

  // Nachladen: Magazin raus, rein, Verschluss
  reload(cls, dur) {
    if (!this.ctx) return;
    const t = this.now;
    const out = this.out(null, 0.55, 0.1);
    const click = (dt, f, p = 0.5) => {
      this.noise(out, t + dt, 0.03, { type: 'bandpass', f, q: 3, peak: p });
      this.tone(out, t + dt, 0.04, { type: 'square', f: f / 3, f2: f / 6, peak: 0.06 });
    };
    if (cls === 'shotgun' || cls === 'shotgun2') {
      const n = cls === 'shotgun2' ? 2 : 5;
      click(dur * 0.1, 1500, 0.4);
      for (let i = 0; i < n; i++) click(dur * (0.2 + (i / n) * 0.55), 2200, 0.35);
      click(dur * 0.85, 1200, 0.6); click(dur * 0.9, 1800, 0.5);
    } else if (cls === 'ray') {
      click(dur * 0.2, 2500);
      this.tone(out, t + dur * 0.5, dur * 0.4, { type: 'sine', f: 200, f2: 1600, peak: 0.12 });
      click(dur * 0.85, 3200, 0.4);
    } else {
      click(dur * 0.15, 1400);
      this.noise(out, t + dur * 0.2, 0.08, { type: 'bandpass', f: 700, q: 1, peak: 0.15 });
      click(dur * 0.6, 1800, 0.6);
      click(dur * 0.82, 2600, 0.5);
      click(dur * 0.86, 1600, 0.45);
    }
  }

  pumpAction() {
    if (!this.ctx) return;
    const out = this.out(null, 0.5, 0.1), t = this.now + 0.15;
    this.noise(out, t, 0.06, { type: 'bandpass', f: 1200, q: 2, peak: 0.5 });
    this.noise(out, t + 0.12, 0.05, { type: 'bandpass', f: 1800, q: 2, peak: 0.5 });
  }

  // ── Animations-synchrone Waffengeräusche ──
  magOut(cls = 'ar') {
    if (!this.ctx) return;
    const out = this.out(null, 0.55, 0.08), t = this.now, v = rand(0.94, 1.06);
    if (cls === 'ray' || cls === 'tesla') {
      this.tone(out, t, 0.14, { type: 'sawtooth', f: 900 * v, f2: 90, peak: 0.12 });
      this.noise(out, t, 0.18, { type: 'highpass', f: 4000, f2: 1500, peak: 0.12 });
      this.wClick(out, t + 0.02, 2600, 0.4);
      return;
    }
    const heavy = cls === 'lmg' || cls === 'sniper';
    this.wClick(out, t, (heavy ? 1800 : 2600) * v, 0.55, 0.014, 5);
    this.noise(out, t + 0.012, heavy ? 0.12 : 0.07, { type: 'bandpass', f: (heavy ? 900 : 1300) * v, f2: (heavy ? 600 : 900) * v, q: 2, peak: 0.28 });
    this.tone(out, t + 0.01, 0.06, { type: 'triangle', f: (heavy ? 420 : 700) * v, f2: 300, peak: 0.06 });
  }

  magIn(cls = 'ar') {
    if (!this.ctx) return;
    const out = this.out(null, 0.6, 0.1), t = this.now, v = rand(0.94, 1.06);
    if (cls === 'ray' || cls === 'tesla') {
      this.wClick(out, t, 2400 * v, 0.5);
      this.tone(out, t + 0.04, 0.55, { type: 'sine', f: 220, f2: cls === 'ray' ? 2600 : 1800, peak: 0.12 });
      this.tone(out, t + 0.04, 0.55, { type: 'square', f: 110, f2: cls === 'ray' ? 1300 : 900, peak: 0.025 });
      if (cls === 'tesla') for (let i = 0; i < 5; i++) this.noise(out, t + 0.1 + rand(0, 0.4), 0.02, { type: 'bandpass', f: rand(3000, 6500), q: 3, peak: 0.3 });
      return;
    }
    const heavy = cls === 'lmg' || cls === 'sniper';
    this.noise(out, t, 0.05, { type: 'bandpass', f: 900 * v, f2: 1600 * v, q: 2, peak: 0.22 });
    this.wClick(out, t + 0.045, (heavy ? 1700 : 2300) * v, 0.75, 0.02, 4);
    this.tone(out, t + 0.045, 0.07, { f: heavy ? 150 : 210, f2: 70, peak: 0.35 });
    this.tone(out, t + 0.05, 0.08, { type: 'triangle', f: 2600 * v, f2: 2200, peak: 0.03 });
  }

  boltBack(cls = 'ar') {
    if (!this.ctx) return;
    const out = this.out(null, 0.55, 0.08), t = this.now, v = rand(0.95, 1.05);
    if (cls === 'lmgCover') { this.noise(out, t, 0.12, { type: 'bandpass', f: 700, f2: 1100, q: 3, peak: 0.25 }); this.wClick(out, t + 0.1, 1900, 0.4); return; }
    const f = cls === 'pistol' ? 2000 : cls === 'sniper' || cls === 'lmg' ? 1200 : 1600;
    this.noise(out, t, 0.07, { type: 'bandpass', f: f * v, f2: f * 1.5 * v, q: 3, peak: 0.35 });
    this.wClick(out, t + 0.065, f * 1.3 * v, 0.45);
    this.tone(out, t + 0.06, 0.05, { type: 'triangle', f: 3200 * v, f2: 2600, peak: 0.035 });
  }

  boltForward(cls = 'ar') {
    if (!this.ctx) return;
    const out = this.out(null, 0.7, 0.12), t = this.now, v = rand(0.95, 1.05);
    if (cls === 'lmgCover') { this.wClick(out, t, 1500 * v, 0.8, 0.03, 3); this.tone(out, t, 0.09, { f: 170, f2: 70, peak: 0.45 }); return; }
    const f = cls === 'pistol' ? 2400 : cls === 'sniper' || cls === 'lmg' ? 1300 : 1800;
    this.noise(out, t, 0.03, { type: 'bandpass', f: f * 0.8 * v, f2: f * 1.2 * v, q: 2, peak: 0.25 });
    this.wClick(out, t + 0.025, f * v, 0.9, 0.025, 3.5);
    this.tone(out, t + 0.025, 0.08, { f: cls === 'pistol' ? 240 : 170, f2: 70, peak: 0.45 });
    this.tone(out, t + 0.03, 0.12, { type: 'triangle', f: 3000 * v, f2: 2400, peak: 0.04 });
  }

  pumpBack() {
    if (!this.ctx) return;
    const out = this.out(null, 0.62, 0.1), t = this.now, v = rand(0.95, 1.05);
    this.noise(out, t, 0.075, { type: 'bandpass', f: 1000 * v, f2: 1500 * v, q: 2.5, peak: 0.5 });
    this.wClick(out, t + 0.07, 1700 * v, 0.6, 0.02, 3);
    this.tone(out, t + 0.07, 0.06, { f: 190, f2: 80, peak: 0.3 });
  }

  pumpForward() {
    if (!this.ctx) return;
    const out = this.out(null, 0.65, 0.1), t = this.now, v = rand(0.95, 1.05);
    this.noise(out, t, 0.06, { type: 'bandpass', f: 1400 * v, f2: 1000 * v, q: 2.5, peak: 0.45 });
    this.wClick(out, t + 0.055, 2100 * v, 0.75, 0.02, 3.5);
    this.tone(out, t + 0.055, 0.07, { f: 220, f2: 90, peak: 0.35 });
  }

  shellInsert() {
    if (!this.ctx) return;
    const out = this.out(null, 0.5, 0.06), t = this.now, v = rand(0.92, 1.08);
    this.noise(out, t, 0.04, { type: 'bandpass', f: 1300 * v, f2: 1900 * v, q: 2, peak: 0.25 });
    this.wClick(out, t + 0.035, 2000 * v, 0.5, 0.016, 4);
    this.tone(out, t + 0.035, 0.05, { type: 'triangle', f: 900 * v, f2: 600, peak: 0.06 });
  }

  breakOpen() {
    if (!this.ctx) return;
    const out = this.out(null, 0.6, 0.1), t = this.now;
    this.wClick(out, t, 1500, 0.55, 0.02, 3);
    this.noise(out, t + 0.02, 0.12, { type: 'bandpass', f: 700, f2: 450, q: 2.5, peak: 0.3 });
    this.tone(out, t + 0.1, 0.07, { f: 260, f2: 120, peak: 0.25 });
    this.wClick(out, t + 0.12, 2400, 0.35);
  }

  breakClose() {
    if (!this.ctx) return;
    const out = this.out(null, 0.8, 0.14), t = this.now;
    this.noise(out, t, 0.03, { type: 'bandpass', f: 900, f2: 1500, q: 2, peak: 0.25 });
    this.wClick(out, t + 0.025, 1700, 1.0, 0.03, 3);
    this.tone(out, t + 0.025, 0.1, { f: 200, f2: 75, peak: 0.55 });
    this.tone(out, t + 0.03, 0.14, { type: 'triangle', f: 2700, f2: 2300, peak: 0.04 });
  }

  // Hülse springt auf dem Boden (Messing klingelt, Schrothülse klackt)
  shellTink(pos, kind = 'rifle') {
    if (!this.ctx) return;
    const out = this.out(pos, kind === 'big' ? 0.4 : 0.28, 0.12), t = this.now;
    if (kind === 'shell') {
      this.tone(out, t, 0.05, { type: 'triangle', f: rand(700, 1000), f2: 500, peak: 0.25 });
      this.noise(out, t, 0.03, { type: 'bandpass', f: rand(1500, 2200), q: 3, peak: 0.25 });
      return;
    }
    const f = kind === 'big' ? rand(2200, 2800) : kind === 'pistol' ? rand(4600, 5600) : rand(3800, 4800);
    this.tone(out, t, rand(0.08, 0.16), { type: 'sine', f, f2: f * 0.98, peak: 0.16, a: 0.001 });
    this.tone(out, t, 0.06, { type: 'sine', f: f * 2.7, f2: f * 2.6, peak: 0.06, a: 0.001 });
    this.noise(out, t, 0.01, { type: 'highpass', f: 6000, peak: 0.2, a: 0.0005 });
  }

  weaponSwitch() {
    if (!this.ctx) return;
    const out = this.out(null, 0.38, 0.05), t = this.now;
    this.noise(out, t, 0.14, { type: 'bandpass', f: 800, f2: 1300, q: 0.9, peak: 0.25, a: 0.02 });
    this.noise(out, t + 0.16, 0.02, { type: 'bandpass', f: 2600, q: 4, peak: 0.35 });
    this.tone(out, t + 0.16, 0.05, { type: 'triangle', f: 1900, f2: 1500, peak: 0.04 });
  }

  // Erstes Ziehen einer Waffe: Stoff, Klappern
  weaponDraw(cls = 'ar') {
    if (!this.ctx) return;
    const out = this.out(null, 0.45, 0.06), t = this.now;
    this.noise(out, t, 0.22, { type: 'bandpass', f: 700, f2: 1500, q: 0.8, peak: 0.25, a: 0.04 });
    const f = cls === 'pistol' ? 2600 : cls === 'ray' || cls === 'tesla' ? 3200 : 1900;
    this.wClick(out, t + 0.12, f, 0.25, 0.015, 4);
    this.wClick(out, t + 0.2, f * 0.8, 0.2, 0.012, 4);
  }

  knife() {
    if (!this.ctx) return;
    const out = this.out(null, 0.65, 0.08), t = this.now;
    this.noise(out, t + 0.04, 0.16, { type: 'bandpass', f: 500, f2: 4200, q: 1.6, peak: 0.55, a: 0.03 });
    this.noise(out, t + 0.06, 0.12, { type: 'highpass', f: 5000, f2: 2500, peak: 0.12, a: 0.02 });
    this.noise(out, t, 0.06, { type: 'bandpass', f: 900, q: 1, peak: 0.12 });
  }

  // Messer trifft: dumpfer, feuchter Stich
  knifeHit(pos) {
    if (!this.ctx) return;
    const out = this.out(pos, 0.9, 0.06), t = this.now;
    this.noise(out, t, 0.09, { type: 'lowpass', f: 1100, f2: 180, peak: 0.9, a: 0.002 });
    this.noise(out, t + 0.01, 0.16, { type: 'bandpass', f: 600, f2: 260, q: 3, peak: 0.45 });
    this.tone(out, t, 0.09, { f: 140, f2: 55, peak: 0.6 });
    this.noise(out, t, 0.012, { type: 'highpass', f: 4000, peak: 0.25 });
  }

  // Granate geworfen: Luftzug, Bügel springt ab
  nadeThrow() {
    if (!this.ctx) return;
    const out = this.out(null, 0.5, 0.08), t = this.now;
    this.noise(out, t, 0.25, { type: 'bandpass', f: 380, f2: 1600, q: 1.2, peak: 0.4, a: 0.05 });
    this.wClick(out, t + 0.02, 2800, 0.2);
  }

  // ── Treffer ─────────────────────────────────────────────────
  hitFlesh(pos, head = false) {
    if (!this.ctx) return;
    const out = this.out(pos, head ? 0.9 : 0.6, 0.05), t = this.now;
    this.noise(out, t, 0.08, { type: 'lowpass', f: 900, f2: 200, peak: 0.8 });
    this.tone(out, t, 0.06, { f: 160, f2: 60, peak: 0.6 });
    if (head) {
      this.noise(out, t + 0.01, 0.2, { type: 'bandpass', f: 1200, f2: 300, q: 2, peak: 0.5 });
      this.tone(out, t, 0.12, { type: 'triangle', f: 500, f2: 120, peak: 0.25 });
    }
  }

  hitmarker() {
    if (!this.ctx) return;
    const out = this.out(null, 0.25, 0);
    this.tone(out, this.now, 0.03, { type: 'square', f: 2400, peak: 0.12 });
  }

  impact(pos, mat = 'stone') {
    if (!this.ctx || Math.random() < 0.4) return;
    const out = this.out(pos, 0.25, 0.1);
    this.noise(out, this.now, 0.05, { type: 'bandpass', f: mat === 'wood' ? 900 : mat === 'metal' ? 3500 : 2200, q: 2, peak: 0.5 });
    if (mat === 'metal') this.tone(out, this.now, 0.2, { type: 'sine', f: rand(2500, 4000), peak: 0.06 });
  }

  explosion(pos, big = 1) {
    if (!this.ctx) return;
    const out = this.out(pos, 1.3 * big, 0.6), t = this.now;
    this.noise(out, t, 1.6 * big, { type: 'lowpass', f: 2200, f2: 120, peak: 1.0, brown: false });
    this.noise(out, t, 2.2 * big, { type: 'lowpass', f: 400, f2: 40, peak: 1.0, brown: true });
    this.tone(out, t, 0.9, { f: 90, f2: 25, peak: 1.0 });
    for (let i = 0; i < 6; i++) this.noise(out, t + 0.3 + Math.random() * 0.9, 0.05, { type: 'bandpass', f: rand(1500, 4000), q: 3, peak: 0.12 });
  }

  bounce(pos) {
    if (!this.ctx) return;
    const out = this.out(pos, 0.4, 0.1);
    this.tone(out, this.now, 0.08, { type: 'triangle', f: rand(1800, 2600), f2: 1200, peak: 0.25 });
    this.noise(out, this.now, 0.03, { type: 'bandpass', f: 3000, q: 2, peak: 0.3 });
  }

  grenadePin() {
    if (!this.ctx) return;
    const out = this.out(null, 0.4, 0.05);
    this.tone(out, this.now, 0.15, { type: 'triangle', f: 3200, f2: 2800, peak: 0.15 });
    this.noise(out, this.now + 0.2, 0.1, { type: 'bandpass', f: 800, q: 1, peak: 0.3 });
  }

  // ── Zombies ─────────────────────────────────────────────────
  zombieVoice(pos, kind = 'groan') {
    if (!this.ctx || this.voices > 7) return;
    const ctx = this.ctx, t = this.now;
    const dur = kind === 'scream' ? rand(0.6, 1.1) : kind === 'attack' ? rand(0.35, 0.6) : rand(0.9, 1.8);
    const f0 = kind === 'scream' ? rand(180, 280) : kind === 'attack' ? rand(110, 160) : rand(65, 115);
    const out = this.out(pos, kind === 'scream' ? 0.9 : 0.75, 0.3);
    this.voices++;
    setTimeout(() => this.voices--, dur * 1000 + 100);

    const src = ctx.createOscillator();
    src.type = 'sawtooth';
    src.frequency.setValueAtTime(f0 * rand(0.9, 1.2), t);
    src.frequency.linearRampToValueAtTime(f0 * rand(0.7, 1.3), t + dur * 0.5);
    src.frequency.linearRampToValueAtTime(f0 * rand(0.5, 0.9), t + dur);
    const vib = ctx.createOscillator();
    vib.frequency.value = rand(4, 9);
    const vibG = ctx.createGain(); vibG.gain.value = f0 * rand(0.04, 0.12);
    vib.connect(vibG).connect(src.frequency);
    // Rauheit: amplitudenmodulierte "Gurgel"-Komponente
    const am = ctx.createOscillator(); am.frequency.value = rand(18, 32);
    const amG = ctx.createGain(); amG.gain.value = 0.35;
    const vca = ctx.createGain(); vca.gain.value = 0.65;
    am.connect(amG).connect(vca.gain);
    const shaper = ctx.createWaveShaper(); shaper.curve = this.distCurve;
    const env = ctx.createGain();
    this.env(env.gain, t, dur * 0.15, 0.6, dur * 0.85);
    src.connect(vca).connect(shaper);
    // Formanten (Vokal "aa"/"oo" gemischt)
    const vowels = [[700, 1100, 2500], [450, 800, 2400], [600, 1000, 2300], [350, 650, 2200]];
    const fm = pick(vowels);
    fm.forEach((f, i) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = 6 + i * 2;
      bp.frequency.setValueAtTime(f * rand(0.9, 1.1), t);
      bp.frequency.linearRampToValueAtTime(f * rand(0.8, 1.2), t + dur);
      const g = ctx.createGain(); g.gain.value = [1.0, 0.6, 0.25][i];
      shaper.connect(bp).connect(g).connect(env);
    });
    env.connect(out);
    this.noise(out, t, dur * 0.9, { type: 'bandpass', f: kind === 'scream' ? 2400 : 1200, q: 1.5, a: dur * 0.2, peak: kind === 'scream' ? 0.3 : 0.12 });
    [src, vib, am].forEach((o) => { o.start(t); o.stop(t + dur + 0.1); });
  }

  zombieSwipe(pos) {
    if (!this.ctx) return;
    const out = this.out(pos, 0.6, 0.1);
    this.noise(out, this.now, 0.22, { type: 'bandpass', f: 400, f2: 2200, q: 1.2, peak: 0.5 });
  }

  zombieDeath(pos) {
    if (!this.ctx || this.voices > 9) return;
    const ctx = this.ctx, t = this.now;
    const out = this.out(pos, 0.7, 0.25);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(rand(110, 160), t);
    o.frequency.exponentialRampToValueAtTime(rand(40, 60), t + 0.9);
    const am = ctx.createOscillator(); am.frequency.value = rand(22, 35);
    const amG = ctx.createGain(); amG.gain.value = 0.5;
    const vca = ctx.createGain(); vca.gain.value = 0.5;
    am.connect(amG).connect(vca.gain);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(1400, t); lp.frequency.exponentialRampToValueAtTime(200, t + 0.9);
    const env = ctx.createGain(); this.env(env.gain, t, 0.03, 0.6, 0.9);
    o.connect(vca).connect(lp).connect(env).connect(out);
    [o, am].forEach((x) => { x.start(t); x.stop(t + 1.0); });
    this.noise(out, t, 0.3, { type: 'lowpass', f: 600, peak: 0.4, brown: true });
  }

  boardRip(pos) {
    if (!this.ctx) return;
    const out = this.out(pos, 0.9, 0.3), t = this.now;
    this.noise(out, t, 0.12, { type: 'bandpass', f: 1800, q: 1.2, peak: 0.9 });
    this.tone(out, t, 0.25, { type: 'square', f: 210, f2: 90, peak: 0.08 });
    this.noise(out, t + 0.05, 0.4, { type: 'lowpass', f: 700, f2: 150, peak: 0.4 });
    this.tone(out, t + 0.02, 0.15, { type: 'triangle', f: 3000, f2: 2500, peak: 0.05 });
  }

  boardPlace(pos) {
    if (!this.ctx) return;
    const out = this.out(pos, 0.8, 0.25), t = this.now;
    this.tone(out, t, 0.18, { f: 180, f2: 80, peak: 0.6 });
    this.noise(out, t, 0.1, { type: 'bandpass', f: 1000, q: 1, peak: 0.6 });
    for (let i = 0; i < 3; i++) this.noise(out, t + 0.12 + i * 0.09, 0.03, { type: 'bandpass', f: 3500, q: 3, peak: 0.35 });
  }

  // ── Spieler ─────────────────────────────────────────────────
  footstep(surface = 'stone', sprint = false) {
    if (!this.ctx) return;
    const out = this.out(null, sprint ? 0.28 : 0.18, 0.05), t = this.now;
    const f = { tiles: 1600, cobble: 900, grass: 420, wood: 650, metal: 1300 }[surface] || 700;
    this.noise(out, t, surface === 'grass' ? 0.12 : 0.07, { type: 'lowpass', f: f * rand(0.8, 1.2), peak: 0.8 });
    this.tone(out, t, 0.05, { f: rand(70, 100), f2: 40, peak: surface === 'grass' ? 0.2 : 0.4 });
    if (surface === 'tiles') this.noise(out, t, 0.02, { type: 'highpass', f: 4000, peak: 0.2 });
    if (surface === 'grass') this.noise(out, t + 0.02, 0.09, { type: 'highpass', f: 3000, peak: 0.12 });
    if (surface === 'metal') { this.tone(out, t, 0.18, { type: 'triangle', f: rand(380, 460), peak: 0.06 }); this.tone(out, t, 0.12, { type: 'sine', f: rand(1100, 1300), peak: 0.03 }); }
    if (surface === 'wood') this.tone(out, t, 0.09, { type: 'triangle', f: rand(160, 220), f2: 120, peak: 0.12 });
  }

  jumpLand() {
    if (!this.ctx) return;
    const out = this.out(null, 0.35, 0.05);
    this.noise(out, this.now, 0.12, { type: 'lowpass', f: 500, peak: 0.9 });
  }

  playerHurt() {
    if (!this.ctx) return;
    const out = this.out(null, 0.8, 0.1), t = this.now;
    this.noise(out, t, 0.15, { type: 'lowpass', f: 600, peak: 1 });
    this.tone(out, t, 0.12, { f: 120, f2: 50, peak: 0.8 });
    // kurzes Stöhnen
    this.tone(out, t + 0.02, 0.25, { type: 'sawtooth', f: 160, f2: 110, peak: 0.08 });
  }

  heartbeat() {
    if (!this.ctx) return;
    const out = this.out(null, 0.6, 0);
    const t = this.now;
    this.tone(out, t, 0.12, { f: 60, f2: 35, peak: 0.9 });
    this.tone(out, t + 0.22, 0.12, { f: 55, f2: 30, peak: 0.6 });
  }

  setMuffle(amount) {
    if (!this.ctx) return;
    const f = 20000 * Math.pow(1 - clamp(amount, 0, 0.92), 3) + 300;
    this.lowpass.frequency.setTargetAtTime(f, this.now, 0.1);
  }

  // ── Kaufen & Interaktion ────────────────────────────────────
  purchase() {
    if (!this.ctx) return;
    const out = this.out(null, 0.5, 0.2), t = this.now;
    [2093, 2637, 3136].forEach((f, i) => this.tone(out, t + i * 0.05, 0.5, { type: 'triangle', f, peak: 0.18 }));
    this.noise(out, t, 0.25, { type: 'highpass', f: 6000, peak: 0.15 });
  }

  deny() {
    if (!this.ctx) return;
    const out = this.out(null, 0.4, 0.05), t = this.now;
    this.tone(out, t, 0.18, { type: 'square', f: 140, peak: 0.12 });
    this.tone(out, t + 0.2, 0.25, { type: 'square', f: 110, peak: 0.12 });
  }

  doorOpen(pos) {
    if (!this.ctx) return;
    const out = this.out(pos, 1.0, 0.5), t = this.now;
    this.noise(out, t, 1.6, { type: 'lowpass', f: 300, f2: 120, a: 0.1, peak: 0.9, brown: true });
    for (let i = 0; i < 14; i++) this.noise(out, t + i * 0.09, 0.05, { type: 'bandpass', f: rand(1500, 3000), q: 4, peak: 0.22 });
    this.tone(out, t + 1.5, 0.6, { f: 70, f2: 35, peak: 0.8 });
    this.noise(out, t + 1.5, 0.3, { type: 'bandpass', f: 2500, q: 2, peak: 0.4 });
  }

  powerOn() {
    if (!this.ctx) return;
    const out = this.out(null, 1.0, 0.6), t = this.now;
    this.tone(out, t, 1.2, { f: 60, f2: 30, peak: 1.0 });
    this.noise(out, t, 1.5, { type: 'lowpass', f: 600, f2: 60, peak: 0.8, brown: true });
    this.tone(out, t + 0.3, 3.5, { type: 'sawtooth', f: 30, f2: 60, a: 1.5, peak: 0.12, curve: 'lin' });
    for (let i = 0; i < 10; i++) this.noise(out, t + 0.5 + i * 0.25, 0.08, { type: 'highpass', f: 5000, peak: 0.12 * Math.random() });
    this.announce('Der Strom ist an.');
  }

  lever() {
    if (!this.ctx) return;
    const out = this.out(null, 0.7, 0.2), t = this.now;
    this.noise(out, t, 0.3, { type: 'bandpass', f: 600, f2: 300, q: 1, peak: 0.5 });
    this.tone(out, t + 0.3, 0.3, { type: 'square', f: 90, f2: 50, peak: 0.2 });
  }

  // ── Musik / Jingles ─────────────────────────────────────────
  melody(notes, { type = 'triangle', bpm = 140, vol = 0.18, octave = 0, bell = false, start = 0 } = {}) {
    if (!this.ctx) return;
    const out = this.ctx.createGain(); out.gain.value = vol; out.connect(this.music);
    const rv = this.ctx.createGain(); rv.gain.value = 0.35; out.connect(rv).connect(this.reverbIn);
    let t = this.now + 0.05 + start;
    const beat = 60 / bpm;
    for (const [n, len] of notes) {
      if (n !== null) {
        const f = NOTE(n + octave * 12);
        this.tone(out, t, len * beat * 0.95, { type, f, peak: 0.9, a: 0.008 });
        if (bell) this.tone(out, t, len * beat * 1.8, { type: 'sine', f: f * 2.01, peak: 0.25, a: 0.002 });
      }
      t += len * beat;
    }
    return t - this.now;
  }

  pad(notes, dur, { vol = 0.12, cutoff = 900, type = 'sawtooth', start = 0 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = this.now + start;
    const out = ctx.createGain(); out.connect(this.music);
    out.gain.setValueAtTime(0.0001, t);
    out.gain.linearRampToValueAtTime(vol, t + dur * 0.3);
    out.gain.setValueAtTime(vol, t + dur * 0.6);
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(cutoff * 0.3, t); lp.frequency.linearRampToValueAtTime(cutoff, t + dur * 0.5);
    lp.connect(out);
    const rv = ctx.createGain(); rv.gain.value = 0.6; out.connect(rv).connect(this.reverbIn);
    for (const n of notes) for (const d of [-8, 7]) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = NOTE(n); o.detune.value = d;
      o.connect(lp); o.start(t); o.stop(t + dur + 0.1);
    }
  }

  drum(t0, f = 60, vol = 0.9) {
    const out = this.ctx.createGain(); out.gain.value = vol; out.connect(this.music);
    const rv = this.ctx.createGain(); rv.gain.value = 0.7; out.connect(rv).connect(this.reverbIn);
    this.tone(out, this.now + t0, 0.8, { f: f * 2, f2: f * 0.5, peak: 1 });
    this.noise(out, this.now + t0, 0.4, { type: 'lowpass', f: 400, f2: 80, peak: 0.6, brown: true });
  }

  roundStart(round) {
    if (!this.ctx) return;
    this.drum(0, 55); this.drum(0.55, 52); this.drum(1.1, 48, 1.0);
    this.pad([38, 45, 50, 53], 5.5, { vol: 0.09, cutoff: 1100, start: 0.1 });
    this.melody([[62, 1], [61, 1], [58, 1.5], [57, 3]], { type: 'sine', bpm: 80, vol: 0.12, bell: true, start: 1.4 });
    // gespenstischer Chor
    this.pad([74, 77, 81], 5, { vol: 0.03, cutoff: 3000, type: 'sine', start: 1.0 });
    if (round > 1 && round % 5 === 0) this.announce(`Runde ${round}`);
  }

  roundEnd() {
    if (!this.ctx) return;
    this.melody([[57, 1], [60, 1], [64, 1], [63, 1.5], [62, 0.5], [57, 3]], { type: 'triangle', bpm: 96, vol: 0.14, bell: true });
    this.pad([33, 40, 45, 48], 7, { vol: 0.08, cutoff: 800 });
    this.drum(0, 45, 0.6); this.drum(3.8, 40, 0.8);
  }

  gameOver() {
    if (!this.ctx) return;
    this.pad([33, 40, 44, 48, 52], 9, { vol: 0.12, cutoff: 1400 });
    this.melody([[69, 2], [67, 1], [65, 1], [64, 2], [62, 2], [57, 4]], { type: 'sine', bpm: 60, vol: 0.15, bell: true, start: 0.5 });
    this.drum(0, 40, 1);
  }

  perkJingle(id) {
    const J = {
      titan: [[[55, 0.5], [55, 0.5], [58, 0.5], [62, 1], [60, 0.5], [58, 0.5], [55, 2]], 'square'],
      blitz: [[[72, 0.25], [74, 0.25], [76, 0.25], [79, 0.5], [76, 0.25], [79, 0.25], [84, 1]], 'triangle'],
      doppel: [[[60, 0.5], [60, 0.5], [67, 0.5], [67, 0.5], [65, 0.5], [64, 0.5], [60, 1.5]], 'sawtooth'],
      phoenix: [[[67, 0.5], [71, 0.5], [74, 0.5], [79, 1], [78, 0.5], [74, 1.5]], 'triangle'],
      sprint: [[[64, 0.33], [66, 0.33], [68, 0.33], [69, 0.5], [71, 0.5], [73, 0.5], [76, 1.5]], 'square'],
    }[id];
    if (!J || !this.ctx) return;
    this.melody(J[0], { type: J[1], bpm: 150, vol: 0.09, bell: true });
  }

  drink() {
    if (!this.ctx) return;
    const out = this.out(null, 0.5, 0.05), t = this.now;
    this.tone(out, t, 0.08, { type: 'triangle', f: 2600, peak: 0.2 }); // Kronkorken
    for (let i = 0; i < 4; i++) this.noise(out, t + 0.5 + i * 0.28, 0.14, { type: 'lowpass', f: 380, peak: 0.9 });
    this.noise(out, t + 0.2, 0.25, { type: 'highpass', f: 5000, peak: 0.15 });
    this.tone(out, t + 1.9, 0.2, { type: 'triangle', f: 1400, f2: 1200, peak: 0.1 }); // Flasche weg
  }

  boxJingle() {
    // Original-Spieluhr-Melodie (Mystery-Kiste)
    return this.melody([
      [76, 0.5], [79, 0.5], [83, 0.5], [82, 0.5], [79, 0.5], [76, 0.5], [74, 1],
      [76, 0.5], [79, 0.5], [83, 0.5], [86, 0.5], [84, 1], [83, 1.5],
    ], { type: 'sine', bpm: 190, vol: 0.2, bell: true });
  }

  teddyLaugh() {
    if (!this.ctx) return;
    const out = this.out(null, 0.8, 0.5), t = this.now;
    for (let i = 0; i < 5; i++) {
      this.tone(out, t + i * 0.18, 0.15, { type: 'sawtooth', f: 260 - i * 25, f2: 180 - i * 20, peak: 0.25 });
    }
    this.announce('Bye bye!', 0.4);
  }

  papMachine() {
    if (!this.ctx) return;
    const out = this.out(null, 0.8, 0.5), t = this.now;
    this.tone(out, t, 3.2, { type: 'sawtooth', f: 40, f2: 120, a: 0.5, peak: 0.12, curve: 'lin' });
    for (let i = 0; i < 9; i++) {
      this.noise(out, t + 0.4 + i * 0.28, 0.08, { type: 'bandpass', f: 1600, q: 3, peak: 0.6 });
      this.tone(out, t + 0.4 + i * 0.28, 0.3, { type: 'sine', f: rand(1800, 2400), peak: 0.08 });
    }
    this.tone(out, t + 3.1, 1.2, { type: 'sine', f: 880, f2: 1760, peak: 0.25 });
    this.melody([[69, 0.5], [72, 0.5], [76, 0.5], [81, 2]], { type: 'square', bpm: 160, vol: 0.06, start: 3.1 });
  }

  powerupSpawn(pos) {
    if (!this.ctx) return;
    const out = this.out(pos, 0.7, 0.4), t = this.now;
    this.tone(out, t, 0.6, { type: 'sine', f: 880, f2: 1760, peak: 0.25 });
    this.tone(out, t, 0.6, { type: 'sine', f: 1320, f2: 2640, peak: 0.15 });
  }

  powerupGrab(type) {
    if (!this.ctx) return;
    const out = this.out(null, 0.6, 0.4), t = this.now;
    [72, 76, 79, 84].forEach((n, i) => this.tone(out, t + i * 0.06, 0.6, { type: 'triangle', f: NOTE(n), peak: 0.2 }));
    const names = { maxammo: 'Volle Munition!', instakill: 'Sofort-Kill!', double: 'Doppelte Punkte!', nuke: 'Atombombe!', carpenter: 'Zimmermann!' };
    this.announce(names[type]);
  }

  // Ansager per Sprachsynthese (tief, dunkel)
  announce(text, rate = 0.85) {
    try {
      if (this.volumes.master < 0.01) return;
      // Android-App: Die WebView kennt keine Web-Sprachausgabe → Android-Stimme
      const app = window.NachtfallApp;
      if (app) { app.speak(text, 0.5, rate, this.volumes.master, true); return; }
      if (!('speechSynthesis' in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'de-DE'; u.pitch = 0.1; u.rate = rate; u.volume = this.volumes.master;
      const v = speechSynthesis.getVoices().find((x) => x.lang && x.lang.startsWith('de'));
      if (v) u.voice = v;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch { /* optional */ }
  }

  // ── Linie 13: Sprache, Bus, Erde ────────────────────────────
  // Sprachausgabe für Figuren (OTTO, Funkstimme); stapelt nicht und unterbricht nur auf Wunsch
  say(text, { pitch = 1, rate = 1, interrupt = false, voice = 1 } = {}) {
    try {
      if (this.volumes.master < 0.01) return;
      const app = window.NachtfallApp;
      if (app) {
        if (!interrupt && app.isSpeaking()) return;
        app.speak(text, pitch, rate, this.volumes.master, !!interrupt);
        return;
      }
      if (!('speechSynthesis' in window)) return;
      if (interrupt) speechSynthesis.cancel();
      else if (speechSynthesis.pending) return;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'de-DE'; u.pitch = pitch; u.rate = rate; u.volume = this.volumes.master;
      const vs = speechSynthesis.getVoices().filter((x) => x.lang && x.lang.startsWith('de'));
      if (vs.length) u.voice = vs[Math.min(voice, vs.length - 1)];
      speechSynthesis.speak(u);
    } catch { /* optional */ }
  }

  // Dauerhaftes Motorgeräusch (Bus); liefert Steuerobjekt
  engineLoop() {
    const ctx = this.ctx;
    const out = ctx.createGain(); out.gain.value = 0;
    const pan = ctx.createPanner();
    pan.panningModel = this.panningModel; pan.distanceModel = 'inverse'; pan.refDistance = 4; pan.maxDistance = 120; pan.rolloffFactor = 1.1;
    out.connect(pan).connect(this.sfx);
    const rv = ctx.createGain(); rv.gain.value = 0.15; pan.connect(rv).connect(this.reverbIn);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400; lp.Q.value = 2.5;
    const vca = ctx.createGain(); vca.gain.value = 0.7;
    lp.connect(vca).connect(out);
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 32;
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 64;
    const g2 = ctx.createGain(); g2.gain.value = 0.25;
    o1.connect(lp); o2.connect(g2).connect(lp);
    const am = ctx.createOscillator(); am.frequency.value = 12;
    const amg = ctx.createGain(); amg.gain.value = 0.3;
    am.connect(amg).connect(vca.gain);
    const n = ctx.createBufferSource(); n.buffer = this.brownBuf; n.loop = true;
    const nb = ctx.createBiquadFilter(); nb.type = 'bandpass'; nb.frequency.value = 170; nb.Q.value = 0.7;
    const ng = ctx.createGain(); ng.gain.value = 0.55;
    n.connect(nb).connect(ng).connect(out);
    const nodes = [o1, o2, am, n];
    nodes.forEach((x) => x.start());
    return {
      update(pos, sp, on, inside) {
        const t = ctx.currentTime;
        pan.positionX.setTargetAtTime(pos.x, t, 0.05); pan.positionY.setTargetAtTime(1, t, 0.05); pan.positionZ.setTargetAtTime(pos.z, t, 0.05);
        const rpm = 0.25 + sp * 0.75;
        o1.frequency.setTargetAtTime(26 + rpm * 44, t, 0.25);
        o2.frequency.setTargetAtTime(52 + rpm * 88, t, 0.25);
        am.frequency.setTargetAtTime(8 + rpm * 20, t, 0.25);
        lp.frequency.setTargetAtTime(inside ? 240 + rpm * 260 : 360 + rpm * 650, t, 0.25);
        out.gain.setTargetAtTime(on ? (inside ? 0.35 : 0.75) * (0.55 + sp * 0.45) : 0, t, 0.3);
      },
      stop() { nodes.forEach((x) => { try { x.stop(); } catch { /* */ } }); out.disconnect(); },
    };
  }

  horn(pos, vol = 1) {
    if (!this.ctx) return;
    const out = this.out(pos, 1.2 * vol, 0.4), t = this.now;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800; lp.connect(out);
    for (const f of [311, 392]) { this.tone(lp, t, 0.55, { type: 'sawtooth', f, a: 0.02, peak: 0.22 }); this.tone(lp, t, 0.55, { type: 'square', f: f * 1.003, a: 0.02, peak: 0.08 }); }
  }

  busDoor(pos, open) {
    if (!this.ctx) return;
    const out = this.out(pos, 0.9, 0.2), t = this.now;
    this.noise(out, t, 0.55, { type: 'highpass', f: 2600, a: 0.03, peak: 0.5 });
    this.noise(out, t, 0.35, { type: 'bandpass', f: 900, q: 1, peak: 0.25 });
    this.tone(out, t + (open ? 0.5 : 0.8), 0.2, { f: 110, f2: 50, peak: 0.6 });
    this.noise(out, t + (open ? 0.5 : 0.8), 0.08, { type: 'bandpass', f: 1800, q: 2, peak: 0.4 });
  }

  busChime(pos) {
    if (!this.ctx) return;
    const out = this.out(pos, 0.7, 0.3), t = this.now;
    this.tone(out, t, 0.8, { type: 'sine', f: 988, peak: 0.25 });
    this.tone(out, t + 0.35, 1.0, { type: 'sine', f: 784, peak: 0.25 });
  }

  brakeSqueal(pos) {
    if (!this.ctx) return;
    const out = this.out(pos, 0.35, 0.3), t = this.now;
    const o = this.tone(out, t, 0.9, { type: 'sine', f: rand(2400, 2900), a: 0.1, peak: 0.12 });
    const vib = this.ctx.createOscillator(); vib.frequency.value = 7;
    const vg = this.ctx.createGain(); vg.gain.value = 40;
    vib.connect(vg).connect(o.frequency); vib.start(t); vib.stop(t + 1);
    this.noise(out, t, 0.9, { type: 'bandpass', f: 3000, q: 4, a: 0.1, peak: 0.1 });
  }

  busHit(pos) {
    if (!this.ctx) return;
    const out = this.out(pos, 1.1, 0.25), t = this.now;
    this.tone(out, t, 0.25, { f: 90, f2: 35, peak: 1 });
    this.noise(out, t, 0.18, { type: 'lowpass', f: 900, peak: 0.9 });
    this.noise(out, t + 0.03, 0.12, { type: 'bandpass', f: 2400, q: 2, peak: 0.4 });
  }

  dirtRise(pos) {
    if (!this.ctx) return;
    const out = this.out(pos, 0.7, 0.2), t = this.now;
    this.noise(out, t, 1.3, { type: 'lowpass', f: 320, f2: 120, a: 0.2, peak: 0.8, brown: true });
    for (let i = 0; i < 5; i++) this.noise(out, t + rand(0, 1), 0.05, { type: 'bandpass', f: rand(800, 1600), q: 2, peak: 0.25 });
  }

  // ── Linie 13: Wunderwaffe, Baupläne, Gefahren ───────────────
  teslaShot(pap) {
    const t = this.now;
    const out = this.out(null, 0.9, 0.5);
    this.noise(out, t, 0.5, { type: 'highpass', f: 2500, a: 0.005, peak: 0.6 });
    for (let i = 0; i < 9; i++) this.noise(out, t + rand(0, 0.35), 0.03, { type: 'bandpass', f: rand(2000, 6000), q: 3, peak: rand(0.3, 0.7) });
    this.tone(out, t, 0.45, { type: 'sawtooth', f: pap ? 90 : 120, f2: 40, peak: 0.5 });
    this.noise(out, t + 0.05, 1.4, { type: 'lowpass', f: 300, f2: 60, a: 0.03, peak: 0.9, brown: true }); // Donner
  }

  teslaZap(pos) {
    if (!this.ctx) return;
    const out = this.out(pos, 0.7, 0.3), t = this.now;
    for (let i = 0; i < 5; i++) this.noise(out, t + rand(0, 0.15), 0.025, { type: 'bandpass', f: rand(2500, 7000), q: 2, peak: 0.6 });
    this.tone(out, t, 0.15, { type: 'square', f: rand(60, 90), f2: 30, peak: 0.25 });
  }

  teslaPickup() {
    if (!this.ctx) return;
    const out = this.out(null, 0.7, 0.5), t = this.now;
    this.tone(out, t, 1.2, { type: 'sawtooth', f: 60, f2: 480, peak: 0.15 });
    for (let i = 0; i < 8; i++) this.noise(out, t + 0.1 + i * 0.1, 0.03, { type: 'bandpass', f: 4000, q: 3, peak: 0.4 });
    this.melody([[62, 0.5], [65, 0.5], [69, 0.5], [74, 1.5]], { type: 'square', bpm: 180, vol: 0.06, start: 0.9 });
  }

  partPickup() {
    if (!this.ctx) return;
    const out = this.out(null, 0.5, 0.2), t = this.now;
    this.noise(out, t, 0.08, { type: 'bandpass', f: 1400, q: 2, peak: 0.5 });
    this.tone(out, t + 0.05, 0.3, { type: 'triangle', f: 880, f2: 1320, peak: 0.15 });
  }

  buildStep(pos) {
    if (!this.ctx) return;
    const out = this.out(pos, 0.45, 0.1), t = this.now;
    this.noise(out, t, 0.04, { type: 'bandpass', f: rand(2500, 3500), q: 4, peak: 0.6 });
    this.tone(out, t, 0.05, { type: 'square', f: rand(300, 420), peak: 0.05 });
  }

  buildDone() {
    if (!this.ctx) return;
    this.melody([[67, 0.5], [71, 0.5], [74, 0.5], [79, 1.5]], { type: 'triangle', bpm: 170, vol: 0.12, bell: true });
  }

  turbineStart(pos) {
    if (!this.ctx) return;
    const out = this.out(pos, 0.8, 0.3), t = this.now;
    this.tone(out, t, 1.5, { type: 'sawtooth', f: 40, f2: 220, peak: 0.12, curve: 'lin' });
    this.noise(out, t, 1.5, { type: 'bandpass', f: 300, f2: 1200, q: 1, a: 0.3, peak: 0.3 });
  }

  turbineWhir(pos) {
    if (!this.ctx) return;
    const out = this.out(pos, 0.35, 0.1), t = this.now;
    this.noise(out, t, 0.4, { type: 'bandpass', f: 900, q: 2, a: 0.15, peak: 0.25 });
    this.tone(out, t, 0.4, { type: 'sine', f: 220, peak: 0.05 });
  }

  lavaSizzle() {
    if (!this.ctx) return;
    const out = this.out(null, 0.4, 0.05);
    this.noise(out, this.now, 0.3, { type: 'highpass', f: 3500, a: 0.02, peak: 0.6 });
  }

  ignite(pos) {
    if (!this.ctx) return;
    const out = this.out(pos, 0.7, 0.2), t = this.now;
    this.noise(out, t, 0.6, { type: 'bandpass', f: 600, f2: 1800, q: 0.8, a: 0.05, peak: 0.6 });
  }

  fireBurst(pos) {
    if (!this.ctx) return;
    const out = this.out(pos, 1.0, 0.4), t = this.now;
    this.noise(out, t, 0.9, { type: 'lowpass', f: 1800, f2: 200, a: 0.01, peak: 1 });
    this.tone(out, t, 0.4, { f: 80, f2: 30, peak: 0.7 });
  }

  crawlerScreech(pos) {
    if (!this.ctx) return;
    const out = this.out(pos, 0.9, 0.5), t = this.now;
    const o = this.tone(out, t, 0.7, { type: 'sawtooth', f: 900, f2: 2200, a: 0.02, peak: 0.12, curve: 'lin' });
    o.detune.setValueAtTime(0, t); o.detune.linearRampToValueAtTime(-600, t + 0.7);
    this.noise(out, t, 0.6, { type: 'bandpass', f: 3500, q: 3, peak: 0.25 });
  }

  crawlerChatter(pos) {
    if (!this.ctx) return;
    const out = this.out(pos, 0.5, 0.3), t = this.now;
    for (let i = 0; i < 6; i++) this.noise(out, t + i * 0.05, 0.03, { type: 'bandpass', f: rand(1500, 3000), q: 5, peak: 0.4 });
  }

  crawlerLatch() {
    if (!this.ctx) return;
    const out = this.out(null, 1.0, 0.2), t = this.now;
    this.tone(out, t, 0.5, { type: 'sawtooth', f: 1400, f2: 500, peak: 0.2 });
    this.noise(out, t, 0.3, { type: 'bandpass', f: 1200, q: 1, peak: 0.6 });
  }

  crawlerBite() {
    if (!this.ctx) return;
    const out = this.out(null, 0.6, 0.05), t = this.now;
    this.noise(out, t, 0.08, { type: 'bandpass', f: 900, q: 2, peak: 0.6 });
  }

  crawlerDeath(pos) {
    if (!this.ctx) return;
    const out = this.out(pos, 0.8, 0.3), t = this.now;
    this.tone(out, t, 0.4, { type: 'sawtooth', f: 1800, f2: 300, peak: 0.15 });
    this.noise(out, t, 0.2, { type: 'lowpass', f: 800, peak: 0.6 });
  }

  coins(pos) {
    if (!this.ctx) return;
    const out = this.out(pos, 0.5, 0.2), t = this.now;
    for (let i = 0; i < 6; i++) this.tone(out, t + i * 0.045, 0.25, { type: 'triangle', f: rand(2600, 3600), peak: 0.1 });
  }

  locker(pos) {
    if (!this.ctx) return;
    const out = this.out(pos, 0.7, 0.2), t = this.now;
    this.noise(out, t, 0.15, { type: 'bandpass', f: 1200, q: 2, peak: 0.5 });
    this.tone(out, t + 0.15, 0.2, { f: 150, f2: 70, peak: 0.5 });
  }

  // ── Linie 13: Funk, Seelen, Signal, Spieluhren ──────────────
  radioStatic(pos, dur = 2) {
    if (!this.ctx) return;
    const out = this.out(pos, 0.45, 0.15), t = this.now;
    this.noise(out, t, dur, { type: 'bandpass', f: 2200, q: 0.6, a: 0.05, peak: 0.35 });
    for (let i = 0; i < dur * 6; i++) this.noise(out, t + rand(0, dur), 0.04, { type: 'highpass', f: 5000, peak: 0.3 });
  }

  radioTune(pos) {
    if (!this.ctx) return;
    const out = this.out(pos, 0.5, 0.1), t = this.now;
    this.tone(out, t, 0.25, { type: 'sine', f: rand(600, 1400), f2: rand(400, 2000), peak: 0.12 });
    this.noise(out, t, 0.2, { type: 'bandpass', f: 2500, q: 1, peak: 0.25 });
    this.noise(out, t, 0.02, { type: 'bandpass', f: 4000, q: 4, peak: 0.4 });
  }

  tapeClick() {
    if (!this.ctx) return;
    const out = this.out(null, 0.6, 0.05), t = this.now;
    this.noise(out, t, 0.05, { type: 'bandpass', f: 1500, q: 3, peak: 0.7 });
    this.noise(out, t + 0.1, 4, { type: 'highpass', f: 4000, a: 0.2, peak: 0.08 });
  }

  soulCollect(pos) {
    if (!this.ctx) return;
    const out = this.out(pos, 0.6, 0.6), t = this.now;
    this.tone(out, t, 0.6, { type: 'sine', f: 300, f2: 1200, peak: 0.15 });
    this.tone(out, t + 0.05, 0.6, { type: 'triangle', f: 600, f2: 2400, peak: 0.05 });
  }

  signalPulse(pos) {
    if (!this.ctx) return;
    const out = this.out(pos, 0.8, 0.6), t = this.now;
    this.tone(out, t, 0.3, { type: 'sine', f: 1046, peak: 0.2 });
    this.tone(out, t + 0.32, 0.3, { type: 'sine', f: 1318, peak: 0.2 });
    this.noise(out, t, 0.6, { type: 'bandpass', f: 800, q: 4, peak: 0.15 });
  }

  signalFinale() {
    if (!this.ctx) return;
    this.pad([38, 45, 50, 57, 62], 9, { vol: 0.16, cutoff: 2600 });
    this.pad([74, 78, 81], 8, { vol: 0.05, cutoff: 4000, type: 'sine', start: 1 });
    this.drum(0, 45, 1); this.drum(2.2, 40, 1);
    this.melody([[62, 1], [66, 1], [69, 1], [74, 3], [73, 1], [74, 4]], { type: 'triangle', bpm: 90, vol: 0.14, bell: true, start: 0.5 });
    const out = this.out(null, 0.8, 0.9);
    this.noise(out, this.now, 4, { type: 'lowpass', f: 200, f2: 40, a: 0.3, peak: 0.9, brown: true });
  }

  achievement() {
    if (!this.ctx) return;
    this.melody([[67, 0.5], [72, 0.5], [76, 0.5], [79, 1], [76, 0.5], [79, 2]], { type: 'square', bpm: 160, vol: 0.08, bell: true });
  }

  musicBox(i) {
    if (!this.ctx) return;
    const motifs = [
      [[74, 0.5], [77, 0.5], [81, 1], [79, 1]],
      [[70, 0.5], [74, 0.5], [77, 1], [76, 1]],
      [[69, 0.5], [73, 0.5], [76, 1], [74, 2]],
    ];
    this.melody(motifs[i % 3], { type: 'sine', bpm: 120, vol: 0.2, bell: true, octave: 1 });
  }

  // Geheimes Lied "Nebelfahrt" – kleiner Sequenzer mit Vorausplanung
  secretSong() {
    if (!this.ctx || this.song) return 0;
    const ctx = this.ctx;
    const bpm = 96, beat = 60 / bpm, bar = beat * 4;
    const bus = ctx.createGain(); bus.gain.value = 0.9; bus.connect(this.music);
    const rv = ctx.createGain(); rv.gain.value = 0.35; bus.connect(rv).connect(this.reverbIn);
    const dist = ctx.createWaveShaper(); dist.curve = this.makeDistortion(220);
    const gtrLp = ctx.createBiquadFilter(); gtrLp.type = 'lowpass'; gtrLp.frequency.value = 2400;
    const gtrG = ctx.createGain(); gtrG.gain.value = 0.11;
    dist.connect(gtrLp).connect(gtrG).connect(bus);
    const VERSE = [[38, [50, 53, 57]], [34, [50, 53, 58]], [41, [53, 57, 60]], [36, [52, 55, 60]], [43, [50, 55, 58]], [34, [50, 53, 58]], [33, [49, 52, 57]], [38, [50, 53, 57]]];
    const CHORUS = [[34, [50, 53, 58]], [36, [52, 55, 60]], [38, [50, 53, 57]], [38, [50, 53, 57]], [34, [50, 53, 58]], [36, [52, 55, 60]], [33, [49, 52, 57]], [33, [49, 52, 57]]];
    const LEAD_V = [[[74, 1], [77, 0.5], [76, 0.5], [74, 1], [72, 1]], [[70, 1.5], [72, 0.5], [74, 2]], [[74, 1], [77, 0.5], [79, 0.5], [81, 1], [79, 0.5], [77, 0.5]], [[76, 2], [null, 1], [72, 1]],
      [[70, 1], [74, 0.5], [72, 0.5], [70, 1], [69, 1]], [[67, 1.5], [69, 0.5], [70, 2]], [[69, 1], [70, 0.5], [72, 0.5], [74, 1], [76, 1]], [[74, 3], [null, 1]]];
    const LEAD_C = [[[77, 1], [79, 1], [81, 2]], [[79, 1], [77, 1], [76, 2]], [[74, 1], [76, 1], [77, 1.5], [76, 0.5]], [[74, 4]],
      [[77, 1], [79, 1], [81, 1], [84, 1]], [[82, 2], [81, 1], [79, 1]], [[76, 1], [77, 1], [79, 1], [81, 1]], [[81, 2], [null, 2]]];
    // Abschnitte: [Art, Takte]
    const form = [['intro', 4], ['verse', 8], ['chorus', 8], ['verse', 8], ['chorus', 8], ['outro', 4]];
    const events = [];
    let t0 = 0;
    for (const [kind, bars] of form) {
      for (let b = 0; b < bars; b++) {
        const ts = t0 + b * bar;
        const ch = (kind === 'chorus' ? CHORUS : VERSE)[b % 8];
        events.push({ t: ts, kind, b, ch, lead: kind === 'verse' ? LEAD_V[b % 8] : kind === 'chorus' ? LEAD_C[b % 8] : null });
      }
      t0 += bars * bar;
    }
    const total = t0;
    const start = ctx.currentTime + 0.3;
    let next = 0;
    const N = (n) => 440 * Math.pow(2, (n - 69) / 12);
    const env = (g, t, a, p, d) => { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(p, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
    const osc = (type, f, t, dur, peak, dest, a = 0.01) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
      const g = ctx.createGain(); env(g, t, a, peak, dur);
      o.connect(g).connect(dest); o.start(t); o.stop(t + a + dur + 0.05);
      return o;
    };
    const kick = (t) => { this.tone(bus, t, 0.3, { f: 130, f2: 42, peak: 0.9 }); };
    const snare = (t) => { this.noise(bus, t, 0.16, { type: 'bandpass', f: 1900, q: 0.8, peak: 0.45 }); this.tone(bus, t, 0.1, { type: 'triangle', f: 190, f2: 140, peak: 0.25 }); };
    const hat = (t, v = 0.12) => this.noise(bus, t, 0.035, { type: 'highpass', f: 7500, peak: v });
    const schedule = (ev) => {
      const T = start + ev.t;
      const [root, chord] = ev.ch;
      if (ev.kind === 'intro' || ev.kind === 'outro') {
        for (let i = 0; i < 16; i++) { const n = chord[i % 3] + 24; osc('sine', N(n), T + i * beat / 4, 0.5, 0.1, bus, 0.003); osc('sine', N(n) * 2.01, T + i * beat / 4, 0.8, 0.03, bus, 0.002); }
        if (ev.kind === 'intro') for (const n of chord) osc('triangle', N(n), T, bar, 0.035, bus, bar * 0.4);
        return;
      }
      const loud = ev.kind === 'chorus';
      for (let i = 0; i < 4; i++) {
        if (i % 2 === 0) kick(T + i * beat); else snare(T + i * beat);
        if (loud && i === 3) kick(T + i * beat + beat / 2);
        for (let k = 0; k < 2; k++) hat(T + i * beat + k * beat / 2, k ? 0.07 : 0.12);
      }
      for (let i = 0; i < 8; i++) {
        const n = root + (i % 4 === 2 ? 12 : 0);
        const o = osc('sawtooth', N(n), T + i * beat / 2, beat / 2 * 0.85, 0.16, bus, 0.005);
        o.detune.value = -5;
      }
      if (loud) for (const n of [root + 12, root + 19, root + 24]) for (let i = 0; i < 8; i++) osc('sawtooth', N(n), T + i * beat / 2, beat / 2 * 0.9, 0.5, dist, 0.005);
      else for (const n of chord) osc('triangle', N(n), T, bar * 0.95, 0.03, bus, 0.3);
      if (ev.lead) {
        let tt = T;
        for (const [n, len] of ev.lead) {
          if (n !== null) {
            const o = osc(loud ? 'sawtooth' : 'square', N(n), tt, len * beat * 0.92, loud ? 0.07 : 0.05, bus, 0.01);
            const vib = ctx.createOscillator(); vib.frequency.value = 5.5;
            const vg = ctx.createGain(); vg.gain.value = 6; vib.connect(vg).connect(o.detune); vib.start(tt + 0.15); vib.stop(tt + len * beat + 0.1);
          }
          tt += len * beat;
        }
      }
    };
    const timer = setInterval(() => {
      const now = ctx.currentTime - start;
      while (next < events.length && events[next].t < now + 1.2) schedule(events[next++]);
      if (now > total + 2) this.stopSong();
    }, 250);
    this.song = { timer, bus, end: start + total };
    return total;
  }

  stopSong() {
    if (!this.song) return;
    clearInterval(this.song.timer);
    try { this.song.bus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3); } catch { /* */ }
    const b = this.song.bus;
    setTimeout(() => b.disconnect(), 1500);
    this.song = null;
  }

  // ── Atmosphäre ──────────────────────────────────────────────
  startAmbience() {
    const ctx = this.ctx, t = this.now;
    // Wind
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 400; bp.Q.value = 0.8;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain(); lfoG.gain.value = 250; lfo.connect(lfoG).connect(bp.frequency);
    const g = ctx.createGain(); g.gain.value = 0.05;
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.11;
    const lfo2G = ctx.createGain(); lfo2G.gain.value = 0.03; lfo2.connect(lfo2G).connect(g.gain);
    src.connect(bp).connect(g).connect(this.music);
    // Drone (schwebende Sinustöne)
    const dg = ctx.createGain(); dg.gain.value = 0.045; dg.connect(this.music);
    for (const f of [41.2, 41.6, 61.7, 82.6]) {
      const o = ctx.createOscillator(); o.frequency.value = f; o.connect(dg); o.start(t);
    }
    [src, lfo, lfo2].forEach((x) => x.start(t));
    this.ambientTimer = setInterval(() => this.randomAmbient(), 7000);
  }

  randomAmbient() {
    if (!this.ctx || this.ctx.state !== 'running' || !this.enabledAmbient) return;
    const r = Math.random();
    const far = { x: this.listener.x + rand(-40, 40), y: 2, z: this.listener.z + rand(-40, 40) };
    if (r < 0.3) {
      const out = this.out(far, 0.5, 0.9);
      this.noise(out, this.now, 3, { type: 'lowpass', f: 200, f2: 50, a: 0.4, peak: 0.6, brown: true }); // Donner
    } else if (r < 0.55) {
      this.zombieVoice(far, 'scream');
    } else if (r < 0.7) {
      const out = this.out(far, 0.3, 0.9);
      this.tone(out, this.now, 2.5, { type: 'sine', f: rand(300, 500), f2: rand(150, 250), a: 0.6, peak: 0.1 }); // ferne Sirene
    } else if (r < 0.8) {
      // Metallisches Knarzen
      const out = this.out(far, 0.25, 0.8);
      this.tone(out, this.now, 1.2, { type: 'sawtooth', f: rand(80, 140), f2: rand(60, 90), a: 0.2, peak: 0.08 });
    }
  }

  listener = { x: 0, z: 0 };
  enabledAmbient = false;

  updateListener(cam) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const p = cam.position;
    const f = cam.getWorldDirection(this._fwd || (this._fwd = cam.position.clone()));
    this.listener.x = p.x; this.listener.z = p.z;
    if (l.positionX) {
      const t = this.now;
      l.positionX.setTargetAtTime(p.x, t, 0.02); l.positionY.setTargetAtTime(p.y, t, 0.02); l.positionZ.setTargetAtTime(p.z, t, 0.02);
      l.forwardX.setTargetAtTime(f.x, t, 0.02); l.forwardY.setTargetAtTime(f.y, t, 0.02); l.forwardZ.setTargetAtTime(f.z, t, 0.02);
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(f.x, f.y, f.z, 0, 1, 0);
    }
  }

  suspend() {
    if (this.ctx) this.ctx.suspend();
    try { speechSynthesis.cancel(); } catch { /* */ }
    try { if (window.NachtfallApp) window.NachtfallApp.stopSpeaking(); } catch { /* */ }
  }
  resume() { if (this.ctx) this.ctx.resume(); }
}
