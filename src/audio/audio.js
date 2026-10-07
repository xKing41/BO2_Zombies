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
  gunshot(kind, pap = false) {
    if (!this.ctx) return;
    const t = this.now;
    const P = {
      pistol: { crack: 0.09, body: 0.18, thump: 150, tf: 3200, vol: 0.8, tail: 0.35 },
      rifle: { crack: 0.12, body: 0.3, thump: 110, tf: 2600, vol: 1.0, tail: 0.5 },
      smg: { crack: 0.06, body: 0.14, thump: 140, tf: 3600, vol: 0.65, tail: 0.25 },
      ar: { crack: 0.08, body: 0.22, thump: 120, tf: 2800, vol: 0.8, tail: 0.35 },
      lmg: { crack: 0.1, body: 0.26, thump: 95, tf: 2200, vol: 0.9, tail: 0.4 },
      shotgun: { crack: 0.14, body: 0.5, thump: 70, tf: 1800, vol: 1.2, tail: 0.6 },
      sniper: { crack: 0.2, body: 0.8, thump: 55, tf: 2000, vol: 1.4, tail: 0.9 },
    }[kind];
    if (kind === 'ray') return this.rayShot(pap);
    const out = this.out(null, P.vol, P.tail);
    const v = rand(0.9, 1.1);
    this.noise(out, t, P.crack, { type: 'highpass', f: P.tf * v, peak: 0.9 });
    this.noise(out, t, P.body, { type: 'lowpass', f: 1800 * v, f2: 300, peak: 1.0 });
    this.tone(out, t, P.body * 0.8, { f: P.thump * 1.6, f2: P.thump * 0.4, peak: 1.0 });
    this.noise(out, t + 0.01, P.body * 1.6, { type: 'bandpass', f: 600, f2: 120, q: 0.6, peak: 0.25, brown: true });
    if (pap) {
      this.tone(out, t, 0.25, { type: 'sawtooth', f: 1800, f2: 400, peak: 0.08 });
      this.tone(out, t, 0.35, { type: 'sine', f: 3200, f2: 900, peak: 0.12 });
    }
    // Mechanik
    this.noise(out, t + 0.04, 0.02, { type: 'bandpass', f: 5000, q: 3, peak: 0.15 });
  }

  rayShot(pap) {
    const t = this.now;
    const out = this.out(null, 0.7, 0.4);
    const base = pap ? 900 : 1300;
    this.tone(out, t, 0.28, { type: 'sawtooth', f: base * 2, f2: base * 0.2, peak: 0.25 });
    this.tone(out, t, 0.3, { type: 'square', f: base, f2: base * 0.15, peak: 0.12, detune: 15 });
    this.tone(out, t, 0.2, { type: 'sine', f: 220, f2: 60, peak: 0.6 });
    this.noise(out, t, 0.15, { type: 'bandpass', f: 3000, f2: 600, q: 2, peak: 0.25 });
  }

  emptyClick() {
    if (!this.ctx) return;
    const out = this.out(null, 0.5, 0.05);
    this.noise(out, this.now, 0.015, { type: 'bandpass', f: 4000, q: 4, peak: 0.6 });
    this.tone(out, this.now, 0.03, { type: 'square', f: 1800, f2: 900, peak: 0.08 });
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

  weaponSwitch() {
    if (!this.ctx) return;
    const out = this.out(null, 0.35, 0.05);
    this.noise(out, this.now, 0.12, { type: 'bandpass', f: 900, q: 1, peak: 0.3 });
    this.noise(out, this.now + 0.2, 0.03, { type: 'bandpass', f: 2500, q: 3, peak: 0.4 });
  }

  knife() {
    if (!this.ctx) return;
    const out = this.out(null, 0.6, 0.1);
    this.noise(out, this.now, 0.18, { type: 'bandpass', f: 600, f2: 3500, q: 1.5, peak: 0.6 });
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
    const f = surface === 'tiles' ? 1600 : surface === 'cobble' ? 900 : 700;
    this.noise(out, t, 0.07, { type: 'lowpass', f: f * rand(0.8, 1.2), peak: 0.8 });
    this.tone(out, t, 0.05, { f: rand(70, 100), f2: 40, peak: 0.4 });
    if (surface === 'tiles') this.noise(out, t, 0.02, { type: 'highpass', f: 4000, peak: 0.2 });
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
      if (!('speechSynthesis' in window) || this.volumes.master < 0.01) return;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'de-DE'; u.pitch = 0.1; u.rate = rate; u.volume = this.volumes.master;
      const v = speechSynthesis.getVoices().find((x) => x.lang && x.lang.startsWith('de'));
      if (v) u.voice = v;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch { /* optional */ }
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

  suspend() { if (this.ctx) this.ctx.suspend(); try { speechSynthesis.cancel(); } catch { /* */ } }
  resume() { if (this.ctx) this.ctx.resume(); }
}
