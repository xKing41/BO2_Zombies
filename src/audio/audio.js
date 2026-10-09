// ─────────────────────────────────────────────────────────────
//  Prozedurales Sound-Design mit der Web Audio API.
//  Jeder Klang wird synthetisiert: Schüsse, Zombies, Musik, Ambiente.
//  3D-Positionierung über HRTF-Panner.
// ─────────────────────────────────────────────────────────────
import { rand, pick, clamp } from '../core/utils.js';
import { jobList, renderJob } from './recipes.js';
import { SCORES, buildScore, renderBuilt, playScoreLive } from './music.js';
import BankWorker from './bankWorker.js?worker&inline';

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
const VOX_CAP = 8; // gleichzeitige Zombie-Stimmen (Handy-tauglich)

export class AudioEngine {
  constructor({ bank = true } = {}) {
    this.ctx = null;
    this.volumes = { master: 0.8, music: 0.6, sfx: 1.0 };
    this.voices = 0;
    this.panningModel = 'HRTF'; // auf Mobilgeräten 'equalpower' (spart viel CPU)
    this.bank = {}; this.scores = {}; this.vox = []; this.steps = []; this.gore = []; this.lastPick = {};
    this.jingle = null;
    // Klangbank schon während des Ladens im Hintergrund rendern
    if (bank) this.startBank();
  }

  // ctx: optional eigener Kontext (z. B. OfflineAudioContext für Tests)
  init(ctx = null) {
    // iOS: Ton auch bei aktiviertem Stummschalter abspielen
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* */ }
    if (this.ctx) { this.ctx.resume(); return; }
    ctx = this.ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain();
    this.master.gain.value = this.volumes.master;
    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = 20000;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4;
    comp.attack.value = 0.003; comp.release.value = 0.25;
    // Begrenzer als Sicherheitsnetz gegen Übersteuern
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -4; lim.knee.value = 0; lim.ratio.value = 20;
    lim.attack.value = 0.0005; lim.release.value = 0.1;
    // Kompressoren heben automatisch an – feste Absenkung danach hält Spitzen unter −1 dBFS
    const trim = ctx.createGain(); trim.gain.value = 0.82;
    this.master.connect(this.lowpass).connect(comp).connect(lim).connect(trim).connect(ctx.destination);

    this.sfx = ctx.createGain(); this.sfx.gain.value = this.volumes.sfx; this.sfx.connect(this.master);
    this.music = ctx.createGain(); this.music.gain.value = this.volumes.music; this.music.connect(this.master);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.6, 2.4);
    this.reverbIn = ctx.createGain(); this.reverbIn.gain.value = 0.5;
    this.reverbIn.connect(this.reverb).connect(this.master);

    this.noiseBuf = this.makeNoise(2);
    this.brownBuf = this.makeNoise(4, true);
    this.distCurve = this.makeDistortion(40);
    // Ambiente auf eigenem Bus (wird bei Stingern abgesenkt)
    this.amb = ctx.createGain(); this.amb.connect(this.music);
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
    if (kind === 'tesla') return this.teslaShot(pap);
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
  // Stimmen aus der vorab gerenderten Bank (je 6–8 Varianten), zufällig
  // in Tonhöhe und Klangfarbe variiert; bis die Bank fertig ist: Live-Synthese
  zombieVoice(pos, kind = 'groan') {
    if (!this.ctx) return;
    const P = { groan: [0.65, 1, 0.3], scream: [0.6, 2, 0.35], attack: [0.75, 3, 0.25] }[kind] || [0.65, 1, 0.3];
    if (!this.has(kind)) return this.voiceLive(pos, kind);
    this.voicePlay(kind in { groan: 1, scream: 1, attack: 1 } ? kind : 'groan', pos, { vol: P[0], prio: P[1], rev: P[2] });
  }

  zombieDeath(pos) {
    if (!this.ctx) return;
    if (!this.has('death')) return this.deathLive(pos);
    this.voicePlay('death', pos, { vol: 0.65, prio: 3, rev: 0.25, rate: [0.88, 1.08] });
  }

  // Beinloser Kriecher: tiefes, nasses Fauchen
  crawlerVoice(pos) {
    if (!this.ctx) return;
    if (!this.has('crawler')) return this.voiceLive(pos, 'groan');
    this.voicePlay('crawler', pos, { vol: 0.6, prio: 1, rev: 0.25, rate: [0.85, 1.1] });
  }

  zombieSwipe(pos) {
    if (!this.ctx) return;
    const b = this.buf('swipe');
    if (!b) return this.swipeLive(pos);
    this.playBuf(b, { pos, vol: 0.55, rate: rand(0.9, 1.15), rev: 0.1 });
  }

  // Schritt eines Zombies (schlurfend oder rennend): billig, ohne HRTF, gedeckelt
  zombieStep(pos, run = false) {
    if (!this.ctx) return;
    const b = this.buf(run ? 'stepRun' : 'stepWalk');
    if (!b) return;
    const now = this.now;
    this.steps = this.steps.filter((x) => x > now);
    if (this.steps.length >= 6) return;
    const c = this.cheapPos(pos, 2, 1.4);
    if (c.d > 25 || c.gain < 0.04) return;
    this.steps.push(now + b.duration);
    this.playBuf(b, { vol: (run ? 0.42 : 0.34) * c.gain, rate: rand(0.85, 1.15), rev: 0, pan: c.pan });
  }

  // Platzender Schädel beim Kopfschuss-Kill
  zombieHeadPop(pos) { this.goreFx('headPop', pos, 1.3); }
  // Abgerissenes Glied
  gib(pos) { this.goreFx('gib', pos, 0.75); }
  goreFx(name, pos, vol) {
    if (!this.ctx) return;
    const b = this.buf(name), now = this.now;
    if (!b) return;
    this.gore = this.gore.filter((x) => x > now);
    if (this.gore.length >= 4) return;
    this.gore.push(now + b.duration);
    this.playBuf(b, { pos, vol, rate: rand(0.88, 1.12), rev: 0.15 });
  }

  // Alte Live-Synthese (nur bis die Klangbank bereit ist)
  voiceLive(pos, kind = 'groan') {
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

  swipeLive(pos) {
    const out = this.out(pos, 0.6, 0.1);
    this.noise(out, this.now, 0.22, { type: 'bandpass', f: 400, f2: 2200, q: 1.2, peak: 0.5 });
  }

  deathLive(pos) {
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
  // Kasse „Ka-Tsching“ (Hebel, Schublade, Glocke, Münzen)
  purchase() {
    if (!this.ctx) return;
    const b = this.buf('purchase');
    if (b) return void this.playBuf(b, { vol: 0.5, rev: 0.12, rate: rand(0.97, 1.03) });
    const out = this.out(null, 0.5, 0.2), t = this.now;
    [2093, 2637, 3136].forEach((f, i) => this.tone(out, t + i * 0.05, 0.5, { type: 'triangle', f, peak: 0.18 }));
    this.noise(out, t, 0.25, { type: 'highpass', f: 6000, peak: 0.15 });
  }

  // Ablehnen: zwei dumpfe Summer-Stöße
  deny() {
    if (!this.ctx) return;
    const b = this.buf('deny');
    if (b) return void this.playBuf(b, { vol: 0.45, rev: 0.05 });
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

  // Strom an: Schütz-Schlag, Generator läuft an, Lichtbänke flackern auf und brummen
  powerOn() {
    if (!this.ctx) return;
    const b = this.buf('powerOn');
    if (b) { this.playBuf(b, { vol: 0.8, rev: 0.5 }); this.duckAmb(5); this.announce('Der Strom ist an.'); return; }
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
  // box: Spieluhr-Klang (Zunge + Biegemode), bell: unharmonische Glocken-Teiltöne
  melody(notes, { type = 'triangle', bpm = 140, vol = 0.18, octave = 0, bell = false, box = false, start = 0 } = {}) {
    if (!this.ctx) return;
    const out = this.ctx.createGain(); out.gain.value = vol; out.connect(this.music);
    const rv = this.ctx.createGain(); rv.gain.value = 0.35; out.connect(rv).connect(this.reverbIn);
    let t = this.now + 0.05 + start;
    const beat = 60 / bpm;
    for (const [n, len] of notes) {
      if (n !== null) {
        const f = NOTE(n + octave * 12);
        if (box) {
          this.tone(out, t, Math.min(1.8, len * beat * 3), { type: 'sine', f, peak: 0.9, a: 0.002 });
          this.tone(out, t, 0.15, { type: 'sine', f: f * 6.27, peak: 0.1, a: 0.001 });
        } else this.tone(out, t, len * beat * 0.95, { type, f, peak: 0.9, a: 0.008 });
        if (bell) {
          this.tone(out, t, len * beat * 1.8, { type: 'sine', f: f * 2.01, peak: 0.25, a: 0.002 });
          this.tone(out, t, len * beat * 0.7, { type: 'sine', f: f * 2.76, peak: 0.1, a: 0.002 });
          this.tone(out, t, len * beat * 0.3, { type: 'sine', f: f * 5.4, peak: 0.05, a: 0.001 });
        }
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
    this.noise(out, this.now + t0, 0.02, { type: 'highpass', f: 2500, peak: 0.25 }); // Anschlag
    this.tone(out, this.now + t0, 1.6, { f: f * 0.5, peak: 0.35, a: 0.02 }); // Sub
  }

  // Rundenstart: Einschlag, Totenglocke, Chor, Glockenmotiv, Metall-Schwall, Schlussschlag
  // (jede 5. Runde größer mit Bläsern und Pauken)
  roundStart(round) {
    if (!this.ctx) return;
    const big = round > 1 && round % 5 === 0;
    this.playScore(big ? 'roundStartBig' : 'roundStart', { vol: 0.8, rev: 0.12 });
    this.duckAmb(6);
    if (big) this.announce(`Runde ${round}`);
  }

  // Rundenende: wehmütiges Walzer-Klagelied
  roundEnd() {
    if (!this.ctx) return;
    this.playScore('roundEnd', { vol: 0.75, rev: 0.12 });
    this.duckAmb(8);
  }

  gameOver() {
    if (!this.ctx) return;
    this.playScore('gameOver', { vol: 0.85, rev: 0.15 });
    this.duckAmb(11);
  }

  // Perk-Jingle. Ohne pos: Kauf (nicht positional, blendet Automaten-Jingle aus).
  // Mit pos: aus dem Automaten, nur wenn gerade kein anderer läuft. true = spielt.
  perkJingle(id, pos = null) {
    const name = 'perk_' + id;
    if (!this.ctx || !SCORES[name]) return false;
    const now = this.now, j = this.jingle;
    if (pos && (this.jingleBusy || now < (this.jingleQuiet || 0))) return false;
    if (!pos && j && j.end > now && j.g) { j.g.gain.setTargetAtTime(0, now, 0.08); try { j.src.stop(now + 0.6); } catch { /* */ } }
    const b = this.scores[name];
    if (b) this.jingle = this.playBuf(b, pos ? { pos, vol: 0.5, rev: 0.2, ref: 3.5, roll: 1.1 } : { vol: 0.45, rev: 0.1, bus: this.music });
    else this.jingle = { end: now + playScoreLive(this.ctx, pos ? this.out(pos, 0.8, 0.2) : this.music, name, 0.5) };
    this.jingleQuiet = this.jingle.end + 20; // danach mindestens 20 s Ruhe für Automaten-Jingles
    return true;
  }
  get jingleBusy() { return !!(this.ctx && this.jingle && this.jingle.end > this.now); }

  // Perk trinken (2,4-s-Animation): Kronkorken, Glas, Schlucke, Flasche splittert, „Aah“/Rülpser
  drink() {
    if (!this.ctx) return;
    const b = this.buf('drink');
    if (b) return void this.playBuf(b, { vol: 0.75, rev: 0.08 });
    const out = this.out(null, 0.5, 0.05), t = this.now;
    this.tone(out, t, 0.08, { type: 'triangle', f: 2600, peak: 0.2 }); // Kronkorken
    for (let i = 0; i < 4; i++) this.noise(out, t + 0.5 + i * 0.28, 0.14, { type: 'lowpass', f: 380, peak: 0.9 });
    this.noise(out, t + 0.2, 0.25, { type: 'highpass', f: 5000, peak: 0.15 });
    this.tone(out, t + 1.9, 0.2, { type: 'triangle', f: 1400, f2: 1200, peak: 0.1 }); // Flasche weg
  }

  // Mystery-Kiste: Deckel knarrt auf, Spieluhr-Walzer (≈ 4,3 s Drehzeit). pos optional
  boxJingle(pos = null) {
    if (!this.ctx) return 4.3;
    this.boxOpen(pos);
    this.playScore('box', { vol: 0.6, rev: 0.25, pos });
    return 4.3;
  }
  boxOpen(pos = null) {
    const b = this.ctx && this.buf('boxOpen');
    if (b) this.playBuf(b, { pos, vol: 0.55, rev: 0.2, ref: 3 });
  }
  // Kiste dreht sich davon: Wind mit Dreh-Tremolo, Zauberton, Puff (≈ 3,2 s)
  boxWhoosh(pos = null, when = 0) {
    const b = this.ctx && this.buf('boxWhoosh');
    if (b) this.playBuf(b, { pos, vol: 0.8, rev: 0.45, ref: 4, when });
  }
  // Teddy: Spielzeug-Lachen, das ausleiert; 2,2 s später fliegt die Kiste davon
  teddyLaugh(pos = null) {
    if (!this.ctx) return;
    const b = this.buf('teddy');
    if (b) this.playBuf(b, { pos, vol: 0.7, rev: 0.35, ref: 3 });
    else {
      const out = this.out(null, 0.8, 0.5), t = this.now;
      for (let i = 0; i < 5; i++) this.tone(out, t + i * 0.18, 0.15, { type: 'sawtooth', f: 260 - i * 25, f2: 180 - i * 20, peak: 0.25 });
    }
    this.boxWhoosh(pos, 2.2);
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
    const b = this.buf('spawn');
    if (b) return void this.playBuf(b, { pos, vol: 0.75, rev: 0.4, ref: 3 });
    const out = this.out(pos, 0.7, 0.4), t = this.now;
    this.tone(out, t, 0.6, { type: 'sine', f: 880, f2: 1760, peak: 0.25 });
    this.tone(out, t, 0.6, { type: 'sine', f: 1320, f2: 2640, peak: 0.15 });
  }

  // Schwebendes Summen eines liegenden Power-Ups (Schleife); liefert { stop(), set(v) }
  powerupLoop(pos) {
    return this.loopAt('puHum', pos, 0.3, 1.5, 1.6, 40);
  }

  // Einsammeln: helles, flirrendes Glas-Arpeggio + Ansager
  powerupGrab(type) {
    if (!this.ctx) return;
    const b = this.buf('grab');
    if (b) this.playBuf(b, { vol: 0.45, rev: 0.4 });
    else {
      const out = this.out(null, 0.6, 0.4), t = this.now;
      [72, 76, 79, 84].forEach((n, i) => this.tone(out, t + i * 0.06, 0.6, { type: 'triangle', f: NOTE(n), peak: 0.2 }));
    }
    const names = { maxammo: 'Volle Munition!', instakill: 'Sofort-Kill!', double: 'Doppelte Punkte!', nuke: 'Atombombe!', carpenter: 'Zimmermann!', firesale: 'Ausverkauf!' };
    this.announce(names[type]);
  }

  // Wucht unter der Ansager-Stimme: Rückwärts-Hall, Sub-Einschlag, dämonisches Brummen.
  // Die Sprachausgabe läuft außerhalb von Web Audio; der Einschlag liegt bei ≈ 0,3 s.
  announcerFx() {
    const b = this.ctx && this.buf('announcer');
    if (b) this.playBuf(b, { vol: 0.65, rev: 0.6 });
  }

  // Ansager per Sprachsynthese (tief, dunkel)
  announce(text, rate = 0.85) {
    try {
      if (this.volumes.master < 0.01) return;
      this.announcerFx();
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
    this.melody(motifs[i % 3], { bpm: 120, vol: 0.22, box: true, octave: 1 });
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
    const ctx = this.ctx, t = this.now, amb = this.amb;
    const loop = (buf, rate = 1) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; return s; };
    const lfo = (f, depth, param) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = f; g.gain.value = depth; o.connect(g).connect(param); return o; };
    // Wind: breites Rauschen mit wanderndem Filter
    const src = loop(this.noiseBuf);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 400; bp.Q.value = 0.8;
    const g = ctx.createGain(); g.gain.value = 0.045;
    src.connect(bp).connect(g).connect(amb);
    // Böen: schmalbandiges Pfeifen, das langsam an- und abschwillt
    const w2 = loop(this.noiseBuf, 0.7);
    const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 950; wf.Q.value = 5;
    const wg = ctx.createGain(); wg.gain.value = 0.012;
    w2.connect(wf).connect(wg).connect(amb);
    // Tiefes Grollen der Stadt
    const rb = loop(this.brownBuf);
    const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 150;
    const rg = ctx.createGain(); rg.gain.value = 0.05;
    rb.connect(rf).connect(rg).connect(amb);
    // Drone (schwebende Sinustöne)
    const dg = ctx.createGain(); dg.gain.value = 0.04; dg.connect(amb);
    for (const f of [41.2, 41.6, 61.7, 82.6]) {
      const o = ctx.createOscillator(); o.frequency.value = f; o.connect(dg); o.start(t);
    }
    [src, w2, rb, lfo(0.07, 250, bp.frequency), lfo(0.11, 0.03, g.gain), lfo(0.043, 500, wf.frequency), lfo(0.067, 0.012, wg.gain)].forEach((x) => x.start(t));
    const tick = () => { this.randomAmbient(); this.ambientTimer = setTimeout(tick, rand(5000, 10000)); };
    this.ambientTimer = setTimeout(tick, 6000);
  }

  // Zufällige Ereignisse in der Ferne: Stöhnen/Schreie, Donner, Knarren, Flüstern, Sirene, Glocke
  randomAmbient() {
    if (!this.ctx || this.ctx.state !== 'running' || !this.enabledAmbient) return;
    const r = Math.random(), L = this.listener;
    const at = (d0, d1) => { const a = Math.random() * Math.PI * 2, d = rand(d0, d1); return { x: L.x + Math.cos(a) * d, y: rand(1, 4), z: L.z + Math.sin(a) * d }; };
    const play = (name, pos, o) => { const b = this.buf(name); if (b) this.playBuf(b, { pos, rate: rand(0.85, 1.08), ...o }); return !!b; };
    if (r < 0.24) {
      this.voicePlay(Math.random() < 0.6 ? 'groan' : 'scream', at(22, 40), { vol: 0.7, prio: 0, rev: 0.9, rate: [0.72, 0.95], lpf: 1600 });
    } else if (r < 0.38) {
      if (!play('thunder', at(40, 60), { vol: 0.8, rev: 0.6, ref: 30, roll: 1 })) {
        const out = this.out(at(30, 40), 0.5, 0.9);
        this.noise(out, this.now, 3, { type: 'lowpass', f: 200, f2: 50, a: 0.4, peak: 0.6, brown: true });
      }
    } else if (r < 0.5) {
      play('creakWood', at(5, 14), { vol: 0.35, rev: 0.6 });
    } else if (r < 0.58) {
      play('creakMetal', at(10, 25), { vol: 0.3, rev: 0.7, ref: 6 });
    } else if (r < 0.67) {
      play('whisper', at(3, 7), { vol: 0.16, rev: 0.8 });
    } else if (r < 0.74) {
      const out = this.out(at(25, 40), 0.3, 0.9);
      this.tone(out, this.now, 2.5, { type: 'sine', f: rand(300, 500), f2: rand(150, 250), a: 0.6, peak: 0.1 }); // ferne Sirene
    } else if (r < 0.8) {
      // ferne Totenglocke
      const out = this.out(at(30, 45), 0.4, 1), f = rand(98, 131);
      for (const [k, a, d] of [[1, 0.2, 4], [2, 0.1, 2.5], [2.76, 0.06, 1.2], [0.5, 0.08, 5]]) this.tone(out, this.now, d, { f: f * k, peak: a, a: 0.003 });
    }
  }

  listener = { x: 0, z: 0, fx: 0, fz: -1 };
  enabledAmbient = false;

  updateListener(cam) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const p = cam.position;
    const f = cam.getWorldDirection(this._fwd || (this._fwd = cam.position.clone()));
    this.listener.x = p.x; this.listener.z = p.z;
    const fl = Math.hypot(f.x, f.z) || 1;
    this.listener.fx = f.x / fl; this.listener.fz = f.z / fl;
    // Verweise auf verklungene Stimmen freigeben (sonst hält die Liste Knoten am Leben)
    const n = this.ctx.currentTime;
    if (n > (this._prune || 0)) {
      this._prune = n + 0.5;
      if (this.vox.length) this.vox = this.vox.filter((v) => v.end > n);
      if (this.jingle && this.jingle.end < n) this.jingle = null;
    }
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

  // ── Klangbank & Wiedergabe ──────────────────────────────────
  // Zombie-Stimmen und Geräusche rendert ein Web Worker in reinem JS (recipes.js),
  // Musik und Jingles der OfflineAudioContext (music.js) – beides abseits des
  // Hauptthreads. Bis etwas fertig ist, greift die alte Live-Synthese bzw. Stille.
  startBank() {
    this.bankStats = { t0: performance.now(), worker: false, done: false, mainMs: 0 };
    const jobs = jobList(), got = new Set();
    const add = (r) => { got.add(r.name + '|' + r.i); (this.bank[r.name] || (this.bank[r.name] = [])).push(this.toBuffer(r)); };
    const fallback = () => this.bankMain(jobs.filter(([n, i]) => !got.has(n + '|' + i)), add);
    try {
      const w = new BankWorker();
      w.onmessage = (e) => {
        if (e.data.done) { this.bankStats.done = true; this.bankStats.ms = performance.now() - this.bankStats.t0; w.terminate(); return; }
        add(e.data);
      };
      w.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); w.terminate(); fallback(); };
      w.postMessage('los');
      this.bankStats.worker = true;
    } catch { fallback(); }
    this.renderScores();
  }

  // Ersatz ohne Worker: kleine Häppchen (≈ 6 ms) in Leerlaufzeiten des Hauptthreads
  bankMain(jobs, add) {
    let k = 0;
    const later = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 150 }) : setTimeout(fn, 16));
    const run = () => {
      const t0 = performance.now();
      while (k < jobs.length && performance.now() - t0 < 6) { try { add(renderJob(...jobs[k])); } catch { /* Variante fehlt dann */ } k++; }
      this.bankStats.mainMs += performance.now() - t0;
      if (k < jobs.length) later(run);
      else { this.bankStats.done = true; this.bankStats.ms = performance.now() - this.bankStats.t0; }
    };
    later(run);
  }

  // Musik offline rendern: alle Graphen gleich beim Laden aufbauen (je eine kleine
  // Aufgabe), gerendert wird zu zweit nebeneinander in eigenen Audio-Threads
  renderScores() {
    if (!(window.OfflineAudioContext || window.webkitOfflineAudioContext)) return;
    const order = ['roundStart', 'perk_phoenix', 'box', 'roundEnd', 'perk_titan', 'perk_blitz', 'perk_doppel', 'perk_sprint', 'roundStartBig', 'gameOver'];
    const built = [];
    let k = 0, running = 0, left = order.length;
    const pump = () => {
      while (running < 2 && built.length) {
        const [name, off] = built.shift();
        running++;
        renderBuilt(off).then((b) => { this.scores[name] = b; }, () => { /* bleibt live */ }).then(() => {
          running--;
          if (--left === 0) this.bankStats.scoresMs = performance.now() - this.bankStats.t0;
          pump();
        });
      }
    };
    const build = () => {
      const name = order[k++];
      try { built.push([name, buildScore(name)]); } catch { left--; }
      pump();
      if (k < order.length) setTimeout(build, 0);
    };
    setTimeout(build, 0);
  }

  toBuffer(r) {
    try {
      const b = new AudioBuffer({ length: r.data.length, sampleRate: r.sr, numberOfChannels: 1 });
      b.copyToChannel(r.data, 0);
      return b;
    } catch { return r; } // ältere Browser: später mit createBuffer
  }
  has(name) { const l = this.bank[name]; return !!(l && l.length); }
  // Zufällige Variante (ohne direkte Wiederholung) oder Variante i
  buf(name, i = -1) {
    const list = this.bank[name];
    if (!list || !list.length) return null;
    let k = i >= 0 ? i % list.length : Math.floor(Math.random() * list.length);
    if (i < 0 && list.length > 1 && k === this.lastPick[name]) k = (k + 1) % list.length;
    this.lastPick[name] = k;
    let b = list[k];
    if (b.data && this.ctx) { const ab = this.ctx.createBuffer(1, b.data.length, b.sr); ab.getChannelData(0).set(b.data); b = list[k] = ab; }
    return b.data ? null : b;
  }

  panner(pos, ref = 2.5, roll = 1.3) {
    const p = this.ctx.createPanner();
    p.panningModel = this.panningModel; p.distanceModel = 'inverse';
    p.refDistance = ref; p.maxDistance = 80; p.rolloffFactor = roll;
    p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
    return p;
  }

  // Puffer abspielen: mit pos über den 3D-Panner, sonst direkt (optional Stereo-pan).
  // Alle Knoten werden am Ende getrennt.
  playBuf(buf, { pos = null, vol = 1, rate = 1, rev = 0.2, bus = null, lp = 0, when = 0, ref = 2.5, roll = 1.3, pan = null } = {}) {
    const ctx = this.ctx, t = this.now + when;
    const src = ctx.createBufferSource(), g = ctx.createGain(), nodes = [src, g];
    src.buffer = buf; src.playbackRate.value = rate; g.gain.value = vol;
    let node = src;
    if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; node.connect(f); node = f; nodes.push(f); }
    node.connect(g); node = g;
    if (pos) { const p = this.panner(pos, ref, roll); g.connect(p); node = p; nodes.push(p); }
    else if (pan !== null && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); node = p; nodes.push(p); }
    node.connect(bus || this.sfx);
    if (rev > 0) { const r = ctx.createGain(); r.gain.value = rev; node.connect(r).connect(this.reverbIn); nodes.push(r); }
    src.onended = () => { for (const n of nodes) n.disconnect(); };
    src.start(t);
    return { src, g, end: t + buf.duration / rate };
  }

  // Richtung/Entfernung ohne HRTF-Panner (für viele kurze Geräusche)
  cheapPos(pos, ref = 2, roll = 1.3) {
    const L = this.listener, dx = pos.x - L.x, dz = pos.z - L.z, d = Math.hypot(dx, dz);
    return { d, gain: ref / (ref + roll * Math.max(0, d - ref)), pan: d > 0.01 ? clamp((dz * L.fx - dx * L.fz) / d, -1, 1) * 0.85 : 0 };
  }

  // Zombie-Stimme mit Deckel: höchstens VOX_CAP gleichzeitig; wichtigere (prio) bzw.
  // nähere Stimmen verdrängen die schwächste. Variation über Tempo und Tiefpass.
  voicePlay(name, pos, { vol = 0.8, prio = 1, rev = 0.3, rate = [0.9, 1.1], lpf = 0 } = {}) {
    if (!this.ctx) return false;
    const L = this.listener, d = pos ? Math.hypot(pos.x - L.x, pos.z - L.z) : 0;
    const b = d < 70 && this.buf(name);
    if (!b) return false;
    const now = this.now;
    this.vox = this.vox.filter((v) => v.end > now);
    if (this.vox.length >= VOX_CAP) {
      let w = null;
      for (const v of this.vox) if (!w || v.prio < w.prio || (v.prio === w.prio && v.d > w.d)) w = v;
      if (w.prio > prio || (w.prio === prio && w.d <= d)) return false;
      w.g.gain.setTargetAtTime(0, now, 0.03);
      try { w.src.stop(now + 0.15); } catch { /* */ }
      this.vox.splice(this.vox.indexOf(w), 1);
    }
    const v = this.playBuf(b, { pos, vol, rate: rand(rate[0], rate[1]), rev, lp: lpf || rand(2600, 9000) });
    v.prio = prio; v.d = d;
    this.vox.push(v);
    return true;
  }

  // Vorgerenderte Musik (oder live als Notlösung); pos = Quelle im Raum
  playScore(name, { vol = 0.6, rev = 0.2, pos = null } = {}) {
    const b = this.scores[name];
    if (b) return this.playBuf(b, { pos, vol, rev, bus: pos ? null : this.music, ref: 4, roll: 1.2 });
    playScoreLive(this.ctx, pos ? this.out(pos, 1, rev) : this.music, name, vol);
    return null;
  }

  // Positionale Schleife aus der Bank; stoppt nach maxSec Audiozeit von selbst
  // (keep() verlängert). Liefert { stop(), set(v), keep(), alive }.
  loopAt(name, pos, vol, ref, roll, maxSec = 40) {
    const b = this.ctx && this.buf(name, 0);
    if (!b) return { stop() {}, set() {}, keep() {}, alive: false };
    const ctx = this.ctx, t = this.now, src = ctx.createBufferSource(), g = ctx.createGain(), p = this.panner(pos, ref, roll);
    src.buffer = b; src.loop = true;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.4);
    src.connect(g).connect(p).connect(this.sfx);
    src.start(t, Math.random() * b.duration);
    let end = t + maxSec;
    src.stop(end);
    const ctl = {
      alive: true,
      stop() {
        if (!ctl.alive) return;
        ctl.alive = false;
        const n = ctx.currentTime;
        g.gain.cancelScheduledValues(n); g.gain.setValueAtTime(g.gain.value, n); g.gain.linearRampToValueAtTime(0, n + 0.2);
        try { src.stop(n + 0.25); } catch { /* */ }
      },
      set(v) { if (ctl.alive) g.gain.setTargetAtTime(vol * v, ctx.currentTime, 0.08); },
      keep(sec = 3) {
        const n = ctx.currentTime;
        if (ctl.alive && n + sec > end + 0.5) { end = n + sec; try { src.stop(end); } catch { /* */ } }
      },
    };
    src.onended = () => { ctl.alive = false; src.disconnect(); g.disconnect(); p.disconnect(); };
    return ctl;
  }

  // Elektrisches Brummen eines Perk-Automaten (Besitzer ruft keep() regelmäßig)
  machineHum(pos) { return this.loopAt('mHum', pos, 0.1, 1.2, 2.2, 3); }

  // Ambiente kurz absenken (Stinger, Strom)
  duckAmb(sec) {
    if (!this.amb) return;
    const g = this.amb.gain, t = this.now;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.35, t + 0.3); g.setValueAtTime(0.35, t + sec); g.linearRampToValueAtTime(1, t + sec + 2);
  }

  // Schreibmaschine für den Intro-Text: sehr billig und leise (kind: 'key' | 'space' | 'return')
  typeClick(kind = 'key') {
    if (!this.ctx) return;
    const b = this.buf(kind === 'space' ? 'typeSpace' : kind === 'return' ? 'typeReturn' : 'typeKey');
    if (!b) return;
    const s = this.ctx.createBufferSource(), g = this.ctx.createGain();
    s.buffer = b; s.playbackRate.value = rand(0.94, 1.06); g.gain.value = kind === 'return' ? 0.22 : 0.1;
    s.connect(g).connect(this.sfx);
    s.onended = () => { s.disconnect(); g.disconnect(); };
    s.start();
  }
}
