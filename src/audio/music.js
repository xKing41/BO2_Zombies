// ─────────────────────────────────────────────────────────────
//  Musik und Jingles – alles eigene Kompositionen.
//  Kleine Instrumente als Web-Audio-Graphen (Röhrenglocke mit
//  unharmonischen Teiltönen, Spieluhr, Chor, Orgel, Bläser,
//  Gitarren, Schlagzeug …) und die Partituren dazu. Gerendert wird
//  vorab im OfflineAudioContext (eigener Audio-Thread); live wird
//  dieselbe Partitur nur als Notlösung gespielt.
// ─────────────────────────────────────────────────────────────
import { rng, pluck, NOTE } from './dsp.js';

export const SRM = 32000;

const noiseCache = new WeakMap();
function noiseBuffer(ctx) {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, b);
  }
  return b;
}
// Raumantwort: Rauschen mit Abklingkurve (Kanäle unkorreliert = breit)
function impulse(ctx, sec, decay, ch = 2, pre = 0) {
  const len = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(ch, len, ctx.sampleRate), p = Math.floor(pre * ctx.sampleRate);
  for (let c = 0; c < ch; c++) {
    const d = b.getChannelData(c);
    for (let i = p; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - (i - p) / (len - p), decay);
  }
  return b;
}
function curveOf(k) {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; c[i] = Math.tanh(x * k) / Math.tanh(k); }
  return c;
}

// ── Instrumente ──────────────────────────────────────────────
export class Kit {
  constructor(ctx, dest, seed = 7) {
    this.ctx = ctx;
    this.out = dest;
    this.R = rng(seed);
    this.nb = noiseBuffer(ctx);
    this.plucks = new Map();
  }
  gain(v = 1, dest = this.out) { const g = this.ctx.createGain(); g.gain.value = v; if (dest) g.connect(dest); return g; }
  pan(x, dest = this.out) {
    if (!this.ctx.createStereoPanner) return this.gain(1, dest);
    const p = this.ctx.createStereoPanner(); p.pan.value = x; p.connect(dest); return p;
  }
  filt(type, f, q = 0.7, dest = null, db = 0) {
    const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = db;
    if (dest) b.connect(dest);
    return b;
  }
  shaper(k, dest) { const s = this.ctx.createWaveShaper(); s.curve = curveOf(k); s.oversample = '2x'; if (dest) s.connect(dest); return s; }
  verb(sec, decay, mixv, dest = this.out, ch = 2) {
    const c = this.ctx.createConvolver(); c.buffer = impulse(this.ctx, sec, decay, ch, 0.01);
    const g = this.gain(mixv, dest); c.connect(g);
    return c;
  }
  // Perkussive Hüllkurve: kurzer Anstieg, exponentielles Abklingen
  perc(param, t, peak, d, a = 0.003) {
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + a);
    param.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  // Halte-Hüllkurve: Anstieg a, halten bis t+hold, Release r
  hold(param, t, peak, a, hold, r) {
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + a);
    param.setValueAtTime(peak, t + Math.max(a, hold));
    param.exponentialRampToValueAtTime(0.0001, t + Math.max(a, hold) + r);
  }
  osc(type, f, t, stop, dest, detune = 0) {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = detune;
    o.connect(dest); o.start(t); o.stop(stop);
    return o;
  }
  noise(t, stop, dest, rate = 1) {
    const s = this.ctx.createBufferSource(); s.buffer = this.nb; s.loop = true; s.playbackRate.value = rate;
    s.connect(dest); s.start(t, this.R() * 1.5); s.stop(stop);
    return s;
  }
  // Partialton mit eigener Abklingzeit
  partial(t, f, a, d, dest, type = 'sine', att = 0.002) {
    const g = this.gain(0, dest);
    this.perc(g.gain, t, a, d, att);
    this.osc(type, f, t, t + d + att + 0.05, g);
  }

  // Röhrenglocke: unharmonische Teiltöne (Summton, Prime, Terz, Quinte, Nominal …) + FM-Anschlag
  bell(t, f, dur, vol, dest = this.out, bright = 1) {
    const P = [[0.5, 0.3, 1], [1, 1, 0.8], [1.19, 0.32, 0.55], [1.5, 0.3, 0.45], [2, 0.55, 0.4], [2.52, 0.35, 0.28], [3.01, 0.2, 0.2], [4.07, 0.16 * bright, 0.13], [5.4, 0.1 * bright, 0.08]];
    for (const [r, a, k] of P) if (f * r < this.ctx.sampleRate * 0.45) this.partial(t, f * r * (1 + (this.R() - 0.5) * 0.002), vol * a, dur * k, dest);
    // metallischer Anschlag (FM, unharmonisches Verhältnis)
    const c = this.ctx.createOscillator(), m = this.ctx.createOscillator(), mg = this.ctx.createGain(), cg = this.gain(0, dest);
    c.frequency.value = f * 2; m.frequency.value = f * 2 * 1.414;
    mg.gain.setValueAtTime(f * 2 * 3 * bright, t); mg.gain.exponentialRampToValueAtTime(1, t + 0.35);
    m.connect(mg).connect(c.frequency); c.connect(cg);
    this.perc(cg.gain, t, vol * 0.22, 0.45, 0.001);
    c.start(t); m.start(t); c.stop(t + 0.6); m.stop(t + 0.6);
  }

  // Spieluhr-Zunge: Grundton + leicht verstimmter Zwilling + Biegemode (6,27×) + Mechanik-Tick
  box(t, f, vol, dest = this.out, wob = null) {
    const d = Math.min(2.4, Math.max(0.7, 2.6 * Math.sqrt(440 / f)));
    const parts = [[1, 1, d], [1.0028, 0.35, d * 0.9], [6.27, 0.13, d * 0.12], [17.55, 0.04, d * 0.05]];
    for (const [r, a, k] of parts) {
      if (f * r > this.ctx.sampleRate * 0.45) continue;
      const g = this.gain(0, dest);
      this.perc(g.gain, t, vol * a, k, 0.0015);
      const o = this.osc('sine', f * r, t, t + k + 0.05, g);
      if (wob) wob.connect(o.detune);
    }
    const tk = this.gain(0, dest), hp = this.filt('highpass', 5000, 0.7, tk);
    this.perc(tk.gain, t, vol * 0.06, 0.012, 0.0005);
    this.noise(t, t + 0.03, hp);
  }

  // Celesta/Glockenspiel: hell, kurz, leicht unharmonisch
  glock(t, f, vol, dest = this.out, d = 1.2) {
    this.partial(t, f, vol, d, dest);
    this.partial(t, f * 2.76, vol * 0.18, d * 0.25, dest);
    this.partial(t, f * 5.4, vol * 0.08, d * 0.1, dest);
  }

  // Vibraphon mit Motor-Tremolo
  vibes(t, f, dur, vol, dest = this.out) {
    const g = this.gain(1, dest), tr = this.ctx.createOscillator(), tg = this.ctx.createGain();
    tr.frequency.value = 5.5; tg.gain.value = 0.25; tr.connect(tg).connect(g.gain); tr.start(t); tr.stop(t + dur + 0.1);
    g.gain.value = 0.75;
    this.partial(t, f, vol, dur, g);
    this.partial(t, f * 4, vol * 0.12, dur * 0.15, g);
    this.partial(t, f * 10, vol * 0.03, 0.05, g);
  }

  // Chor „aah/ooh“: verstimmte Sägezähne mit Vibrato durch Formantfilter
  choir(t, notes, dur, vol, { vowel = 'a', a = 0.8, r = 1.0, dest = this.out, vib = 1, breath = 0.04, pan = 0 } = {}) {
    const F = {
      a: [[650, 1, 6], [1080, 0.5, 8], [2650, 0.2, 11], [2900, 0.12, 12]],
      o: [[450, 1, 6], [800, 0.45, 8], [2830, 0.12, 11]],
      u: [[325, 1, 5], [700, 0.3, 7], [2530, 0.08, 10]],
      e: [[400, 1, 6], [1700, 0.4, 9], [2600, 0.2, 11]],
    }[vowel];
    const env = this.gain(0, pan ? this.pan(pan, dest) : dest);
    this.hold(env.gain, t, vol, a, dur - r, r);
    const bus = this.ctx.createGain();
    for (const [ff, g, q] of F) bus.connect(this.filt('bandpass', ff, q)).connect(this.gain(g * 3.2, env));
    bus.connect(this.filt('lowpass', 500, 0.7)).connect(this.gain(0.25, env));
    const stop = t + dur + 0.1;
    for (const n of notes) {
      const fr = NOTE(n);
      const lfo = this.ctx.createOscillator(), lg = this.ctx.createGain();
      lfo.frequency.value = 4.6 + this.R() * 1.2;
      lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(fr * 0.007 * vib, t + Math.min(1.2, dur * 0.5));
      lfo.connect(lg); lfo.start(t); lfo.stop(stop);
      for (const det of [-11, 0, 10]) {
        const o = this.osc('sawtooth', fr, t, stop, bus, det + (this.R() - 0.5) * 6);
        lg.connect(o.frequency);
      }
    }
    if (breath) { const ng = this.gain(breath, bus); this.noise(t, stop, ng); }
  }

  // Streicher-/Dunkelflächen: Sägezähne durch langsam öffnenden Tiefpass
  pad(t, notes, dur, vol, { cut = 900, a = 0.6, r = 1.2, dest = this.out, type = 'sawtooth' } = {}) {
    const env = this.gain(0, dest);
    this.hold(env.gain, t, vol, a, dur - r, r);
    const lp = this.filt('lowpass', cut * 0.4, 0.8, env);
    lp.frequency.setValueAtTime(cut * 0.4, t); lp.frequency.linearRampToValueAtTime(cut, t + Math.min(dur * 0.5, 2));
    for (const n of notes) for (const det of [-7, 6]) this.osc(type, NOTE(n), t, t + dur + 0.1, lp, det);
  }

  // Tiefer Einschlag: Pitch-Fall-Sinus, Sub, Rauschschlag, leichte Verzerrung
  boom(t, vol, f = 46, dest = this.out, len = 2.2) {
    const sh = this.shaper(1.6, dest), g = this.gain(vol, sh);
    const o = this.ctx.createOscillator(), og = this.gain(0, g);
    o.frequency.setValueAtTime(f * 3, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.14); o.frequency.exponentialRampToValueAtTime(f * 0.7, t + len);
    this.perc(og.gain, t, 1, len, 0.004);
    o.connect(og); o.start(t); o.stop(t + len + 0.1);
    this.partial(t, f * 0.5, 0.5, len * 1.2, g, 'sine', 0.03);
    const ng = this.gain(0, g), lp = this.filt('lowpass', 500, 0.7, ng);
    lp.frequency.setValueAtTime(500, t); lp.frequency.exponentialRampToValueAtTime(70, t + 0.6);
    this.perc(ng.gain, t, 0.9, 0.7, 0.002);
    this.noise(t, t + 0.8, lp);
  }

  // Klavier (tief, gestrichen-hart): leicht gespreizte Teiltöne + Hammergeräusch
  piano(t, f, dur, vol, dest = this.out) {
    for (let k = 1; k <= 8; k++) {
      const fk = f * k * Math.sqrt(1 + 0.0004 * k * k);
      if (fk > this.ctx.sampleRate * 0.45) break;
      this.partial(t, fk, (vol / Math.pow(k, 1.1)) * (k === 1 ? 0.8 : 1), dur / Math.sqrt(k), dest, 'sine', 0.002);
    }
    const ng = this.gain(0, dest), lp = this.filt('lowpass', 1800, 0.7, ng);
    this.perc(ng.gain, t, vol * 0.25, 0.05, 0.001);
    this.noise(t, t + 0.08, lp);
  }

  // Schlagzeug
  kick(t, vol = 1, dest = this.out) {
    const o = this.ctx.createOscillator(), g = this.gain(0, dest);
    o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    this.perc(g.gain, t, vol, 0.32, 0.002);
    o.connect(g); o.start(t); o.stop(t + 0.45);
    const cg = this.gain(0, dest), hp = this.filt('highpass', 2500, 0.7, cg);
    this.perc(cg.gain, t, vol * 0.25, 0.012, 0.0005);
    this.noise(t, t + 0.03, hp);
  }
  snare(t, vol = 1, dest = this.out) {
    const ng = this.gain(0, dest), bp = this.filt('bandpass', 1900, 0.7, ng);
    this.perc(ng.gain, t, vol * 0.8, 0.17, 0.001);
    this.noise(t, t + 0.25, bp);
    const o = this.ctx.createOscillator(), g = this.gain(0, dest);
    o.type = 'triangle'; o.frequency.setValueAtTime(200, t); o.frequency.exponentialRampToValueAtTime(160, t + 0.08);
    this.perc(g.gain, t, vol * 0.5, 0.09, 0.001);
    o.connect(g); o.start(t); o.stop(t + 0.15);
  }
  hat(t, vol = 0.5, open = false, dest = this.out) {
    const g = this.gain(0, dest), hp = this.filt('highpass', 7500, 0.7, g);
    this.perc(g.gain, t, vol, open ? 0.3 : 0.045, 0.0005);
    this.noise(t, t + (open ? 0.4 : 0.08), hp);
  }
  clap(t, vol = 0.8, dest = this.out) {
    const g = this.gain(0, dest), bp = this.filt('bandpass', 1300, 0.9, g);
    g.gain.setValueAtTime(0.0001, t);
    for (let k = 0; k < 3; k++) { g.gain.setValueAtTime(vol, t + k * 0.011); g.gain.exponentialRampToValueAtTime(vol * 0.15, t + k * 0.011 + 0.009); }
    g.gain.setValueAtTime(vol * 0.7, t + 0.034); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    this.noise(t, t + 0.25, bp);
  }
  tamb(t, vol = 0.4, dest = this.out) {
    const g = this.gain(0, dest), hp = this.filt('highpass', 6000, 0.7, g);
    this.perc(g.gain, t, vol, 0.12, 0.001);
    this.noise(t, t + 0.16, hp);
    for (const f of [5200, 6900, 8300]) this.partial(t, f * (1 + this.R() * 0.03), vol * 0.08, 0.08, dest);
  }
  block(t, f = 900, vol = 0.5, dest = this.out) {
    this.partial(t, f, vol, 0.06, dest, 'sine', 0.0008);
    this.partial(t, f * 2.6, vol * 0.25, 0.025, dest, 'sine', 0.0008);
  }
  crash(t, vol = 0.5, dest = this.out, d = 1.6) {
    const g = this.gain(0, dest), hp = this.filt('highpass', 3500, 0.7, g);
    this.perc(g.gain, t, vol, d, 0.002);
    this.noise(t, t + d + 0.1, hp);
    for (const f of [3100, 4300, 5700, 7300]) this.partial(t, f * (1 + this.R() * 0.05), vol * 0.06, d * 0.6, dest);
  }
  tom(t, f = 110, vol = 0.8, dest = this.out) {
    const o = this.ctx.createOscillator(), g = this.gain(0, dest);
    o.frequency.setValueAtTime(f * 1.4, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
    this.perc(g.gain, t, vol, 0.35, 0.002);
    o.connect(g); o.start(t); o.stop(t + 0.45);
  }

  // Bass: gezupft (Sägezahn + Sinus durch schließenden Tiefpass)
  bass(t, f, dur, vol, dest = this.out, bright = 900) {
    const g = this.gain(0, dest), lp = this.filt('lowpass', bright, 2, g);
    lp.frequency.setValueAtTime(bright, t); lp.frequency.exponentialRampToValueAtTime(bright * 0.3, t + Math.max(0.08, dur));
    this.hold(g.gain, t, vol, 0.004, Math.max(0.01, dur - 0.06), 0.08);
    this.osc('sawtooth', f, t, t + dur + 0.2, lp);
    this.osc('sine', f, t, t + dur + 0.2, lp);
  }

  // Verzerrte Gitarre (Powerchord), mute = abgedämpft
  guitar(t, notes, dur, vol, { mute = false, dest = this.out } = {}) {
    const env = this.gain(0, dest);
    this.hold(env.gain, t, vol, 0.003, mute ? 0.02 : Math.max(0.02, dur - 0.1), mute ? 0.09 : 0.25);
    const cab = this.filt('lowpass', mute ? 1300 : 3600, 0.9, env);
    const mid = this.filt('peaking', 1400, 1, cab, 4);
    const hp = this.filt('highpass', 90, 0.7, mid);
    const sh = this.shaper(6, hp), pre = this.gain(2.5, sh);
    const stop = t + dur + 0.4;
    for (const n of notes) { this.osc('sawtooth', NOTE(n), t, stop, pre, -7); this.osc('square', NOTE(n), t, stop, this.gain(0.5, pre), 6); }
  }

  // Blechbläser-Stoß: Sägezähne, Filter öffnet sich, Ton „schiebt“ hinein
  brass(t, notes, dur, vol, dest = this.out) {
    const env = this.gain(0, dest);
    this.hold(env.gain, t, vol, 0.025, Math.max(0.03, dur - 0.1), 0.14);
    const lp = this.filt('lowpass', 300, 1.2, env);
    lp.frequency.setValueAtTime(300, t); lp.frequency.exponentialRampToValueAtTime(3000, t + 0.05); lp.frequency.exponentialRampToValueAtTime(1500, t + 0.35);
    for (const n of notes) for (const det of [-6, 7]) {
      const o = this.osc('sawtooth', NOTE(n), t, t + dur + 0.3, lp, det);
      o.detune.setValueAtTime(det - 35, t); o.detune.linearRampToValueAtTime(det, t + 0.06);
    }
  }

  // Hammond-Orgel: Zugriegel-Sinusse + Perkussion + Leslie-Tremolo (gemeinsamer Bus)
  organBus(dest = this.out, t0 = 0, t1 = 8) {
    const bus = this.gain(1, dest), lfo = this.ctx.createOscillator(), lg = this.ctx.createGain();
    lfo.frequency.value = 6.3; lg.gain.value = 0.22; bus.gain.value = 0.78;
    lfo.connect(lg).connect(bus.gain); lfo.start(t0); lfo.stop(t1);
    return this.shaper(1.4, bus);
  }
  organ(t, notes, dur, vol, bus) {
    const env = this.gain(0, bus);
    this.hold(env.gain, t, vol, 0.006, Math.max(0.02, dur - 0.05), 0.07);
    for (const n of notes) {
      const f = NOTE(n);
      for (const [r, a] of [[0.5, 0.5], [1, 1], [1.5, 0.55], [2, 0.6], [3, 0.3], [4, 0.22]]) this.osc('sine', f * r, t, t + dur + 0.15, this.gain(a * 0.25, env));
      this.partial(t, f * 3, vol * 0.18, 0.18, bus);
    }
    const kc = this.gain(0, bus), bp = this.filt('bandpass', 2500, 1, kc);
    this.perc(kc.gain, t, vol * 0.12, 0.01, 0.0005);
    this.noise(t, t + 0.02, bp);
  }

  // Leadstimme (Rechteck/Sägezahn) mit verzögertem Vibrato
  lead(t, f, dur, vol, { type = 'square', dest = this.out, cut = 3000, vib = 0.012, a = 0.01, r = 0.08 } = {}) {
    const env = this.gain(0, dest), lp = this.filt('lowpass', cut, 0.8, env);
    this.hold(env.gain, t, vol, a, Math.max(0.02, dur - r * 0.5), r);
    const o = this.osc(type, f, t, t + dur + r + 0.1, lp);
    if (vib && dur > 0.25) {
      const l = this.ctx.createOscillator(), lg = this.ctx.createGain();
      l.frequency.value = 5.6; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * vib, t + Math.min(dur, 0.4));
      l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + dur + r + 0.1);
    }
    return o;
  }

  // Pfeifen (Western): Sinus + Atemrauschen + Vibrato
  whistle(t, f, dur, vol, dest = this.out, slide = 0) {
    const o = this.lead(t, f, dur, vol, { type: 'sine', dest, cut: 6000, vib: 0.015, a: 0.04, r: 0.12 });
    if (slide) { o.frequency.setValueAtTime(f * slide, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.08); }
    const ng = this.gain(0, dest), bp = this.filt('bandpass', f * 2, 6, ng);
    this.hold(ng.gain, t, vol * 0.5, 0.04, Math.max(0.02, dur - 0.06), 0.1);
    this.noise(t, t + dur + 0.2, bp);
  }

  // Gezupfte Saite (Karplus-Strong in JS, als Puffer abgespielt)
  pluck(t, f, vol, { bright = 0.6, t60 = 1.4, dest = this.out, dur = 1.6, body = 0 } = {}) {
    const key = `${f.toFixed(2)}|${bright}|${t60}|${dur}|${body}`;
    let buf = this.plucks.get(key);
    if (!buf) {
      const d = pluck(this.R, this.ctx.sampleRate, f, dur, { bright, t60, body });
      let m = 0; for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
      if (m > 0) for (let i = 0; i < d.length; i++) d[i] /= m;
      buf = this.ctx.createBuffer(1, d.length, this.ctx.sampleRate);
      buf.getChannelData(0).set(d);
      this.plucks.set(key, buf);
    }
    const s = this.ctx.createBufferSource(), g = this.gain(vol, dest);
    s.buffer = buf; s.connect(g); s.start(t);
    return g;
  }

  // Aufsteigender Metall-Schwall (rückwärts klingendes Becken + unharmonische Töne)
  swell(t, dur, vol, dest = this.out) {
    const g = this.gain(0, dest);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + dur); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.04);
    const bp = this.filt('bandpass', 300, 1.5, g);
    bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(7000, t + dur);
    this.noise(t, t + dur + 0.1, bp);
    const hp = this.filt('highpass', 2000, 0.7, g);
    this.noise(t, t + dur + 0.1, this.gain(0.6, hp));
    for (let k = 0; k < 5; k++) {
      const f = 900 + this.R() * 3500, o = this.ctx.createOscillator();
      o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.6, t + dur);
      o.connect(this.gain(0.05, g)); o.start(t); o.stop(t + dur + 0.1);
    }
  }

  // Elektrisches Zischen (Blitz-Tonikum)
  zap(t, vol, dest = this.out, up = true) {
    const o = this.ctx.createOscillator(), g = this.gain(0, dest), bp = this.filt('bandpass', 2000, 2, g);
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(up ? 300 : 2400, t); o.frequency.exponentialRampToValueAtTime(up ? 2400 : 200, t + 0.22);
    const am = this.ctx.createOscillator(), ag = this.ctx.createGain(); am.type = 'square'; am.frequency.value = 55; ag.gain.value = 0.5;
    am.connect(ag).connect(g.gain);
    this.perc(g.gain, t, vol, 0.25, 0.005);
    o.connect(bp); o.start(t); o.stop(t + 0.3); am.start(t); am.stop(t + 0.3);
    const ng = this.gain(0, dest), hp = this.filt('highpass', 4000, 0.7, ng);
    this.perc(ng.gain, t, vol * 0.4, 0.18, 0.002);
    this.noise(t, t + 0.25, hp);
  }
}

// ── Hilfen für Partituren ────────────────────────────────────
// Folge von [Note|null|[Noten], Schläge] ab Zeit t0 abspielen
function seq(t0, beat, list, fn) {
  let t = t0;
  for (const [n, len] of list) { if (n !== null) fn(t, n, len * beat); t += len * beat; }
  return t;
}
// Alter Musikautomat: Bandbegrenzung, leichte Sättigung, Federhall, Knistern
function jukebox(K, dest, dur) {
  const ctx = K.ctx;
  const hp = K.filt('highpass', 150, 0.7), hp2 = K.filt('highpass', 150, 0.7), pk = K.filt('peaking', 2400, 0.8, null, 3), lp = K.filt('lowpass', 6500, 0.7);
  const sh = K.shaper(1.8, null), out = K.gain(1, dest);
  hp.connect(hp2).connect(pk).connect(lp).connect(sh).connect(out);
  const sp = K.verb(1.3, 3.2, 0.22, out, 1);
  sh.connect(sp);
  // Knistern der Schallplatte
  const cb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate), d = cb.getChannelData(0);
  for (let i = 0; i < d.length; i++) { const r = Math.random(); d[i] = (r < 0.0012 ? (Math.random() - 0.5) * 0.6 : 0) + (Math.random() - 0.5) * 0.004; }
  const cs = ctx.createBufferSource(); cs.buffer = cb;
  cs.connect(K.filt('highpass', 1200, 0.7, K.gain(0.5, out))); cs.start(0);
  return hp;
}

// ── Partituren ───────────────────────────────────────────────
// Rundenstart: Einschlag, Totenglocke, Chor, Glockenmotiv, Metall-Schwall, Schlussschlag
function roundStart(K, t0, big = false) {
  const hall = K.verb(3.4, 2.6, 0.5);
  const dry = K.gain(1), wet = K.gain(0.6, hall);
  dry.connect(wet);
  K.boom(t0, 0.9, 44, dry);
  K.bell(t0, NOTE(38), 6, 0.32, K.pan(-0.15, dry), 0.8);
  K.pad(t0, [38, 45], 5.4, 0.1, { cut: 420, a: 0.8, r: 1.6, dest: dry });
  K.choir(t0 + 0.05, [50, 57, 62, 65], 4.4, 0.16, { vowel: 'a', a: 1.3, r: 1.4, dest: K.pan(-0.25, dry) });
  K.choir(t0 + 0.3, [69, 74], 4.0, 0.06, { vowel: 'u', a: 1.4, r: 1.2, dest: K.pan(0.3, dry) });
  // Glockenmotiv (eigene Folge: Quinte, Oktave, Leitton, Tritonus)
  const bells = [[0.75, 69], [1.25, 74], [1.75, 73], [2.3, 68]];
  for (const [dt, n] of bells) K.bell(t0 + dt, NOTE(n), 3.2, 0.2, K.pan(dt % 1 > 0.5 ? 0.35 : -0.2, dry), 1);
  K.piano(t0 + 2.9, NOTE(38), 2.5, 0.25, dry); K.piano(t0 + 2.9, NOTE(50), 2.5, 0.18, dry);
  if (big) {
    // jede 5. Runde: Bläser schwellen an, Pauken-Wirbel, hoher Tritonus-Chor
    K.brass(t0 + 1.4, [38, 45, 50, 53], 3.0, 0.1, dry);
    K.choir(t0 + 1.6, [80, 86], 2.8, 0.05, { vowel: 'o', a: 1.6, r: 0.5, dest: K.pan(0.2, dry) });
    for (let k = 0; k < 14; k++) { const tt = 2.6 + 1.7 * (1 - Math.pow(1 - k / 14, 1.6)); K.tom(t0 + tt, k % 2 ? 62 : 58, 0.25 + (k / 14) * 0.45, dry); }
  }
  K.swell(t0 + 2.5, 1.85, big ? 0.32 : 0.26, dry);
  const hit = t0 + 4.35;
  K.boom(hit, big ? 1.0 : 0.8, 40, dry);
  K.piano(hit, NOTE(26), 3, 0.3, dry); K.piano(hit, NOTE(33), 3, 0.22, dry); K.piano(hit, NOTE(38), 3, 0.2, dry);
  K.bell(hit, NOTE(50), 3.5, 0.22, dry, 0.7);
  if (big) { K.crash(hit, 0.35, dry, 3); K.bell(hit, NOTE(26), 5, 0.3, dry, 0.5); K.choir(hit, [38, 50, 57, 62], 2.4, 0.14, { vowel: 'a', a: 0.05, r: 2, dest: dry }); }
}

// Rundenende: wehmütiges Walzer-Klagelied (a-Moll), Celesta + Chor, endet in tiefer Glocke
function roundEnd(K, t0) {
  const hall = K.verb(3.0, 2.4, 0.45);
  const dry = K.gain(1); dry.connect(K.gain(0.55, hall));
  const beat = 0.625;
  const mel = [[76, 1], [81, 1], [79, 0.5], [77, 0.5], [76, 1.5], [74, 0.5], [72, 1], [71, 1], [72, 0.5], [74, 0.5], [68, 1], [69, 3]];
  seq(t0, beat, mel, (t, n, d) => { K.glock(t, NOTE(n), 0.22, K.pan(0.15, dry), 1.4 + d); K.box(t, NOTE(n + 12), 0.05, dry); });
  seq(t0, beat, mel, (t, n, d) => K.whistle(t, NOTE(n - 12), d * 0.95, 0.035, K.pan(-0.2, dry)));
  const chords = [[[57, 60, 64], 45], [[53, 57, 60], 41], [[52, 56, 59, 62], 40], [[57, 60, 64], 33]];
  chords.forEach(([ch, root], k) => {
    const t = t0 + k * 3 * beat, d = k === 3 ? 3.2 : 3 * beat + 0.3;
    K.choir(t, ch, d, 0.07, { vowel: 'o', a: 0.5, r: k === 3 ? 2 : 0.4, dest: dry });
    K.pluck(t, NOTE(root), 0.35, { bright: 0.3, t60: 2.5, dest: dry, dur: 2.5 });
  });
  K.pad(t0, [33, 40], 9 * beat + 3.4, 0.07, { cut: 380, a: 1, r: 2.2, dest: dry });
  K.boom(t0, 0.35, 42, dry, 1.6);
  K.bell(t0 + 9 * beat, NOTE(45), 4, 0.25, dry, 0.6);
  K.choir(t0 + 9 * beat + 0.2, [87], 2.6, 0.018, { vowel: 'u', a: 1.2, r: 1.2, dest: K.pan(0.4, dry), breath: 0.1 });
}

// Spielende: langsamer Trauerzug in d-Moll, Totenglocke, Chor, tiefer Gong
function gameOver(K, t0) {
  const hall = K.verb(3.8, 2.4, 0.55);
  const dry = K.gain(1); dry.connect(K.gain(0.6, hall));
  K.boom(t0, 0.85, 40, dry, 3);
  for (const dt of [0, 3, 6, 9]) K.bell(t0 + dt, NOTE(50), 4.5, 0.2, K.pan(-0.2, dry), 0.7);
  K.bell(t0, NOTE(26), 9, 0.3, dry, 0.5);
  K.pad(t0, [26, 38], 11, 0.1, { cut: 500, a: 1.5, r: 3, dest: dry });
  const ch = [[[50, 57, 62, 65], 0, 4.6], [[55, 58, 62], 4.5, 2.2], [[45, 57, 61, 64], 6.5, 2.6], [[50, 57, 62, 65], 9, 2.4]];
  for (const [notes, dt, d] of ch) K.choir(t0 + dt, notes, d + 0.3, 0.11, { vowel: 'a', a: 0.9, r: dt === 9 ? 1.8 : 0.5, dest: dry });
  seq(t0 + 0.5, 1, [[69, 2], [67, 1], [65, 1], [64, 2], [62, 1.5], [61, 1], [62, 3]], (t, n, d) => {
    K.piano(t, NOTE(n), d + 1.5, 0.22, K.pan(0.15, dry));
    K.piano(t, NOTE(n - 12), d + 1.5, 0.1, dry);
  });
  K.boom(t0 + 9, 0.5, 36, dry, 2.5);
}

// Mystery-Kiste: Spieluhr-Walzer in e-Moll, Feder läuft am Ende langsamer
function boxJingle(K, t0) {
  const room = K.verb(1.2, 3, 0.25, K.out, 1);
  const dry = K.gain(1); dry.connect(room);
  const wob = K.ctx.createOscillator(), wg = K.ctx.createGain();
  wob.frequency.value = 0.9; wg.gain.value = 7; wob.connect(wg); wob.start(t0); wob.stop(t0 + 5);
  const beat = 0.357;
  const mel = [[83, 1], [88, 0.5], [87, 0.5], [88, 1], [91, 1], [90, 0.5], [88, 0.5], [87, 1], [84, 1], [83, 0.5], [82, 0.5], [83, 1]];
  const bass = [[64, [67, 71]], [59, [66, 69]], [57, [60, 64]]];
  let t = t0;
  for (const [n, len] of mel) { K.box(t, NOTE(n), 0.3, dry, wg); t += len * beat; }
  bass.forEach(([b, ch], k) => {
    const tb = t0 + k * 3 * beat;
    K.box(tb, NOTE(b), 0.22, dry, wg);
    for (const s of [1, 2]) for (const n of ch) K.box(tb + s * beat, NOTE(n), 0.1, dry, wg);
  });
  // Schlusston mit Verzögerung (Feder läuft ab)
  const end = t0 + 9 * beat + 0.18;
  K.box(end, NOTE(76), 0.32, dry, wg); K.box(end, NOTE(64), 0.2, dry, wg); K.box(end + 0.02, NOTE(52), 0.14, dry, wg);
  // leises Schnarren des Werks
  const wr = K.gain(0, dry), bp = K.filt('bandpass', 1800, 3, wr);
  K.hold(wr.gain, t0, 0.012, 0.1, 4, 0.3);
  K.noise(t0, t0 + 4.6, bp);
}

// ── Perk-Jingles (eigene Melodien, je eigene Besetzung) ──────
// Titan-Trank: schweres Rock-Riff mit Bläserantwort (e-Moll, 140 bpm)
function perkTitan(K, t0) {
  const out = jukebox(K, K.out, 6.2);
  const beat = 60 / 140, e = beat / 2;
  const riff = [40, 40, 43, 40, 45, 40, 46, 45, 40, 40, 43, 40, 45, 40, 38, 40];
  riff.forEach((n, k) => {
    const t = t0 + k * e, acc = n !== 40;
    K.guitar(t, [n, n + 7, n + 12], e * 0.95, acc ? 0.5 : 0.36, { mute: !acc, dest: out });
    K.bass(t, NOTE(n - 12), e * 0.9, 0.35, out, 500);
  });
  for (let k = 0; k < 8; k++) {
    const t = t0 + k * beat;
    if (k % 2 === 0) K.kick(t, 0.8, out); else K.snare(t, 0.55, out);
    if (k === 3 || k === 7) K.kick(t + e, 0.6, out);
    K.hat(t, 0.18, false, out); K.hat(t + e, 0.12, false, out);
  }
  K.crash(t0, 0.25, out, 1.2);
  seq(t0 + 2 * beat, beat, [[64, 0.5], [67, 0.5], [69, 1]], (t, n, d) => K.brass(t, [n, n - 12], d, 0.22, out));
  seq(t0 + 6 * beat, beat, [[71, 0.5], [69, 0.5], [67, 0.5], [64, 0.5]], (t, n, d) => K.brass(t, [n, n - 12], d, 0.22, out));
  // Schluss: Bläser-Stöße und großer Akkord
  const t3 = t0 + 8 * beat;
  K.brass(t3, [64, 67, 71], e * 0.8, 0.26, out); K.brass(t3 + e, [64, 67, 71], e * 0.8, 0.26, out);
  K.brass(t3 + beat, [64, 67, 71, 76], beat * 2.2, 0.28, out);
  K.guitar(t3 + beat, [40, 47, 52, 55], beat * 3, 0.5, { dest: out });
  K.bass(t3 + beat, NOTE(28), beat * 2.6, 0.4, out, 400);
  K.kick(t3, 0.8, out); K.kick(t3 + e, 0.7, out); K.kick(t3 + beat, 1, out); K.crash(t3 + beat, 0.35, out, 2.2);
}

// Blitz-Tonikum: schnelle Surf-Gitarre mit Tremolo-Picking und Blitzen (a-Moll, 176 bpm)
function perkBlitz(K, t0) {
  const out = jukebox(K, K.out, 5.4);
  const beat = 60 / 176, s16 = beat / 4;
  const mel = [[69, 0.5], [72, 0.5], [76, 1], [74, 0.5], [72, 0.5], [74, 1], [72, 0.5], [71, 0.5], [68, 1], [71, 0.5], [69, 0.5], [64, 1], [69, 0.5], [72, 0.5], [76, 0.5], [81, 0.5], [80, 1], [76, 1]];
  // Tremolo-Picking: jede Note in Sechzehnteln wiederholt
  seq(t0, beat, mel, (t, n, d) => { for (let k = 0; k * s16 < d - 0.01; k++) K.pluck(t + k * s16, NOTE(n), k ? 0.2 : 0.26, { bright: 0.85, t60: 0.5, dest: out, dur: 0.4 }); });
  const bassL = [45, 45, 45, 45, 40, 40, 40, 40, 45, 45, 45, 45, 40, 40, 44, 44];
  bassL.forEach((n, k) => K.bass(t0 + k * beat * 0.75, NOTE(n), beat * 0.6, 0.3, out, 1200));
  for (let k = 0; k < 12; k++) {
    const t = t0 + k * beat;
    if (k % 2 === 0) K.kick(t, 0.7, out); else K.snare(t, 0.5, out);
    K.hat(t, 0.14, false, out); K.hat(t + beat / 2, 0.1, false, out);
  }
  K.tom(t0 + 11 * beat, 160, 0.4, out); K.tom(t0 + 11.25 * beat, 130, 0.45, out); K.tom(t0 + 11.5 * beat, 100, 0.5, out);
  K.zap(t0 + 3.6 * beat, 0.25, out); K.zap(t0 + 7.6 * beat, 0.25, out, false);
  const tEnd = t0 + 12 * beat;
  K.pluck(tEnd, NOTE(81), 0.4, { bright: 0.9, t60: 1.6, dest: out, dur: 1.6 });
  K.pluck(tEnd, NOTE(69), 0.3, { bright: 0.7, t60: 1.6, dest: out, dur: 1.6 });
  K.guitar(tEnd, [45, 52, 57], 1.0, 0.25, { dest: out });
  K.bass(tEnd, NOTE(33), 0.8, 0.35, out, 600);
  K.kick(tEnd, 0.9, out); K.crash(tEnd, 0.3, out, 1.5); K.zap(tEnd + 0.05, 0.3, out);
}

// Doppelschuss: Western-Twang mit Galopp, Pfiff und zwei Schüssen am Ende (d-Moll, 112 bpm)
function perkDoppel(K, t0) {
  const out = jukebox(K, K.out, 6);
  const beat = 60 / 112;
  // Galopp (Holzblock): da-da-DUM
  for (let k = 0; k < 8; k++) { const t = t0 + k * beat; K.block(t, 1100, 0.2, out); K.block(t + beat * 0.25, 1000, 0.15, out); K.block(t + beat * 0.5, 800, 0.3, out); }
  // Bariton-Twang
  const tw = [[50, 0.5], [50, 0.25], [50, 0.25], [53, 0.5], [57, 0.5], [60, 1], [57, 1], [58, 0.5], [57, 0.5], [55, 0.5], [53, 0.5], [52, 1], [45, 1]];
  seq(t0, beat, tw, (t, n, d) => K.pluck(t, NOTE(n), 0.42, { bright: 0.55, t60: 1.8, dest: out, dur: 1.4, body: 220 }));
  // Pfiff darüber
  seq(t0 + 0.5 * beat, beat, [[81, 1.5], [77, 0.5], [76, 0.5], [74, 0.5], [76, 1], [74, 2], [69, 1.5]], (t, n, d) => K.whistle(t, NOTE(n), d * 0.92, 0.12, out, 0.94));
  K.bass(t0, NOTE(38), beat * 3.8, 0.25, out, 500); K.bass(t0 + 4 * beat, NOTE(34), beat * 1.9, 0.25, out, 500); K.bass(t0 + 6 * beat, NOTE(33), beat * 1.9, 0.25, out, 500);
  K.bell(t0, NOTE(86), 1.2, 0.05, out, 1.2); K.bell(t0 + 4 * beat, NOTE(86), 1.2, 0.04, out, 1.2);
  // Schluss: Akkord + zwei Schüsse (Doppelschuss!)
  const tEnd = t0 + 8 * beat;
  K.pluck(tEnd, NOTE(38), 0.45, { bright: 0.5, t60: 2.4, dest: out, dur: 2.2, body: 220 });
  K.pluck(tEnd + 0.03, NOTE(45), 0.35, { bright: 0.5, t60: 2.4, dest: out, dur: 2.2 });
  K.pluck(tEnd + 0.06, NOTE(53), 0.3, { bright: 0.6, t60: 2.4, dest: out, dur: 2.2 });
  for (const dt of [0.42, 0.62]) { K.snare(tEnd + dt, 0.8, out); K.boom(tEnd + dt, 0.25, 70, out, 0.4); }
}

// Phönix-Soda: warme Soul-Orgel mit Laufbass und Gospel-Chor (F-Dur, 100 bpm, geswingt)
function perkPhoenix(K, t0) {
  const out = jukebox(K, K.out, 6.4);
  const beat = 0.6, sw = beat * 0.62;
  const org = K.organBus(out, t0, t0 + 6.5);
  const chords = [[[60, 65, 69], 0], [[62, 65, 70], 2], [[60, 64, 67, 70], 4], [[60, 65, 69, 72], 6]];
  for (const [ch, b] of chords) for (const off of [0, 1]) {
    const t = t0 + (b + off) * beat + sw;
    K.organ(t, ch, beat * 0.3, 0.14, org);
  }
  seq(t0, beat, [[41, 1], [45, 1], [46, 1], [47, 1], [48, 1], [43, 1], [48, 1], [40, 1]], (t, n, d) => K.bass(t, NOTE(n), d * 0.85, 0.32, out, 700));
  for (let k = 0; k < 8; k++) {
    const t = t0 + k * beat;
    if (k % 2 === 0) K.kick(t, 0.55, out); else K.snare(t, 0.35, out);
    K.hat(t, 0.1, false, out); K.hat(t + sw, 0.07, false, out);
  }
  seq(t0, beat, [[72, 1], [69, 0.62], [72, 0.38], [74, 1], [72, 1], [77, 1.62], [76, 0.38], [74, 1], [72, 1]], (t, n, d) => K.organ(t, [n], d * 0.92, 0.2, org));
  const tEnd = t0 + 8 * beat;
  K.organ(tEnd, [53, 60, 65, 69, 72, 76], 1.8, 0.2, org);
  K.choir(tEnd - 0.4, [65, 69, 72, 77], 2.4, 0.09, { vowel: 'o', a: 0.5, r: 1.2, dest: out });
  K.bass(tEnd, NOTE(29), 1.4, 0.35, out, 500);
  K.glock(tEnd + 0.2, NOTE(89), 0.12, out, 1.6); K.glock(tEnd + 0.32, NOTE(93), 0.1, out, 1.6); K.glock(tEnd + 0.44, NOTE(96), 0.1, out, 1.8);
  K.crash(tEnd, 0.15, out, 2);
}

// Sprint-Elixier: hüpfender 60er-Pop mit Klatschen, Tamburin, Vibraphon (G-Dur, 150 bpm)
function perkSprint(K, t0) {
  const out = jukebox(K, K.out, 5.6);
  const beat = 0.4;
  const bassL = [43, 50, 43, 50, 48, 43, 48, 43, 50, 45, 50, 45];
  bassL.forEach((n, k) => K.bass(t0 + k * beat, NOTE(n), beat * 0.45, 0.32, out, 1100));
  for (let k = 0; k < 12; k++) {
    const t = t0 + k * beat;
    if (k % 2 === 0) K.kick(t, 0.55, out); else K.clap(t, 0.35, out);
    K.tamb(t, 0.12, out); K.tamb(t + beat / 2, 0.08, out);
  }
  const offs = [[[59, 62, 67], 0], [[60, 64, 67], 4], [[62, 66, 69], 8]];
  for (const [ch, b] of offs) for (let k = 0; k < 4; k++) K.lead(t0 + (b + k + 0.5) * beat, NOTE(ch[k % ch.length] + 12), beat * 0.3, 0.05, { type: 'square', dest: out, cut: 2500, vib: 0 });
  const mel = [[71, 0.5], [74, 0.5], [79, 1], [78, 0.5], [76, 0.5], [74, 1], [72, 0.5], [76, 0.5], [81, 1], [79, 0.5], [78, 0.5], [76, 1], [74, 0.5], [78, 0.5], [81, 0.5], [84, 0.5], [83, 1], [81, 1]];
  seq(t0, beat, mel, (t, n, d) => { K.vibes(t, NOTE(n), d + 0.5, 0.2, out); K.lead(t, NOTE(n), d * 0.8, 0.035, { type: 'square', dest: out, cut: 2200, vib: 0.008 }); });
  const tEnd = t0 + 12 * beat;
  K.vibes(tEnd, NOTE(79), 1.8, 0.25, out); K.vibes(tEnd, NOTE(83), 1.8, 0.16, out); K.vibes(tEnd, NOTE(86), 1.8, 0.14, out);
  K.bass(tEnd, NOTE(31), 0.9, 0.35, out, 800); K.kick(tEnd, 0.6, out); K.crash(tEnd, 0.18, out, 1.6);
  K.glock(tEnd + 0.12, NOTE(91), 0.1, out, 1.4);
}

// Name → [Dauer s, Kanäle, Funktion]
export const SCORES = {
  roundStart: [5.9, 2, (K, t) => roundStart(K, t, false)],
  roundStartBig: [7.4, 2, (K, t) => roundStart(K, t, true)],
  roundEnd: [9.6, 2, roundEnd],
  gameOver: [12.5, 2, gameOver],
  box: [4.9, 1, boxJingle],
  perk_titan: [6.2, 1, perkTitan],
  perk_blitz: [5.4, 1, perkBlitz],
  perk_doppel: [6.0, 1, perkDoppel],
  perk_phoenix: [6.4, 1, perkPhoenix],
  perk_sprint: [5.6, 1, perkSprint],
};

// Graph einer Partitur im OfflineAudioContext aufbauen (Hauptthread, einige ms)
export function buildScore(name) {
  const [dur, ch, fn] = SCORES[name];
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const off = new OAC(ch, Math.ceil(dur * SRM), SRM);
  const out = off.createGain();
  out.connect(off.destination);
  fn(new Kit(off, out, name.length * 31 + 7), 0.02);
  return off;
}
// Aufgebauten Graph rendern (eigener Audio-Thread) → Promise<AudioBuffer>, auf Spitze 0,9 normiert
export function renderBuilt(off) {
  return new Promise((resolve, reject) => {
    off.oncomplete = (e) => resolve(e.renderedBuffer);
    const p = off.startRendering();
    if (p && p.then) p.then(resolve, reject);
  }).then((buf) => {
    let m = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > m) m = v; } }
    if (m > 0) for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); const k = 0.9 / m; for (let i = 0; i < d.length; i++) d[i] *= k; }
    return buf;
  });
}

// Notlösung: Partitur direkt im Live-Kontext spielen (gleiche Musik, mehr CPU)
export function playScoreLive(ctx, dest, name, vol = 0.5) {
  const [dur, , fn] = SCORES[name];
  const g = ctx.createGain(); g.gain.value = vol * 0.35; g.connect(dest);
  fn(new Kit(ctx, g, 11), ctx.currentTime + 0.05);
  setTimeout(() => g.disconnect(), (dur + 1) * 1000);
  return dur;
}
