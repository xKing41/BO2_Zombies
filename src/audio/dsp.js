// ─────────────────────────────────────────────────────────────
//  DSP-Werkzeugkasten in reinem JavaScript (ohne Web Audio).
//  Stimmsynthese für die Untoten: Stimmlippen-Pulse mit Jitter und
//  Shimmer, Taschenfalten-Subharmonische (Growl), Knarrstimme,
//  bewegliche Formanten (Mund), Hauchrauschen und nasses Gurgeln.
//  Dazu Bausteine für Geräusche (Moden, Rauschen, Saiten).
//  Alles deterministisch über einen Seed – läuft auch in Node.
// ─────────────────────────────────────────────────────────────

export const TAU = Math.PI * 2;
export const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

// Zufallsgenerator mit Seed (mulberry32) plus Komfortfunktionen
export function rng(seed) {
  let a = seed >>> 0 || 1;
  const r = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + r() * (hi - lo);
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.gauss = () => (r() + r() + r() - 1.5) * 2; // grob normalverteilt, σ ≈ 1
  r.int = () => ((r() * 2147483646) | 0) + 1; // für Xorshift-Zustände (kleine Ganzzahl)
  return r;
}

// Schnelle tanh-Näherung (weiche Sättigung)
export const sat = (x) => (x > 3 ? 1 : x < -3 ? -1 : (x * (27 + x * x)) / (27 + 9 * x * x));

// Sinus-Tabelle: Phase in Umdrehungen (0..1 wiederholt)
const TN = 4096;
const SIN = new Float32Array(TN + 1);
for (let i = 0; i <= TN; i++) SIN[i] = Math.sin((TAU * i) / TN);
export function sinT(ph) {
  const x = (ph - Math.floor(ph)) * TN, k = x | 0;
  return SIN[k] + (SIN[k + 1] - SIN[k]) * (x - k);
}
// Glottis-Formen: Öffnen (halber Kosinus) und Schließen (Viertelkosinus)
const GN = 1024;
const UP = new Float32Array(GN + 2), DN = new Float32Array(GN + 2);
for (let i = 0; i <= GN + 1; i++) { const x = Math.min(1, i / GN); UP[i] = 0.5 - 0.5 * Math.cos(Math.PI * x); DN[i] = Math.cos(1.5707963 * x); }

// Stützstellen-Kurve: [[t, v], …] mit t in 0..1, weich interpoliert; Zahl = konstant
export function kf(p, t) {
  if (typeof p === 'number') return p;
  if (t <= p[0][0]) return p[0][1];
  for (let i = 1; i < p.length; i++) {
    if (t <= p[i][0]) {
      const t0 = p[i - 1][0], v0 = p[i - 1][1], k = (t - t0) / (p[i][0] - t0 || 1);
      return v0 + (p[i][1] - v0) * k * k * (3 - 2 * k);
    }
  }
  return p[p.length - 1][1];
}
// Kurve als Array mit n Werten (schnell, ohne Suche pro Sample)
export function curve(p, n) {
  const out = new Float32Array(n);
  if (typeof p === 'number') return out.fill(p);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const t = i / Math.max(1, n - 1);
    while (s < p.length - 1 && t > p[s + 1][0]) s++;
    if (s >= p.length - 1 || t <= p[0][0]) { out[i] = t <= p[0][0] ? p[0][1] : p[p.length - 1][1]; continue; }
    const t0 = p[s][0], k = (t - t0) / (p[s + 1][0] - t0 || 1);
    out[i] = p[s][1] + (p[s + 1][1] - p[s][1]) * k * k * (3 - 2 * k);
  }
  return out;
}

// Glattes Zufallssignal (-1..1), etwa `rate` neue Zielwerte pro Sekunde, Abtastrate `cr`
export function wander(R, len, cr, rate) {
  const out = new Float32Array(len);
  const step = Math.max(1, cr / Math.max(0.01, rate));
  let a = R() * 2 - 1, b = R() * 2 - 1, k = 0;
  for (let i = 0; i < len; i++) {
    const s = k / step;
    out[i] = a + (b - a) * s * s * (3 - 2 * s);
    if (++k >= step) { k = 0; a = b; b = R() * 2 - 1; }
  }
  return out;
}

// ── Filter ───────────────────────────────────────────────────
// Biquad nach RBJ; arbeitet blockweise auf Float32Arrays
export class Biquad {
  constructor(type, f, q = 0.707, sr = 48000, db = 0) { this.z1 = 0; this.z2 = 0; this.set(type, f, q, sr, db); }
  set(type, f, q, sr, db = 0) {
    const w = (TAU * Math.min(f, sr * 0.49)) / sr, cw = Math.cos(w), sw = Math.sin(w), al = sw / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    const A = Math.pow(10, db / 40);
    switch (type) {
      case 'hp': b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
      case 'bp': b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
      case 'peak': b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; break;
      default: b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  run(buf, from = 0, to = buf.length) {
    const b0 = this.b0, b1 = this.b1, b2 = this.b2, a1 = this.a1, a2 = this.a2;
    let z1 = this.z1, z2 = this.z2;
    for (let i = from; i < to; i++) {
      const x = buf[i], y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2;
      z2 = b2 * x - a2 * y;
      buf[i] = y;
    }
    this.z1 = z1; this.z2 = z2;
    return buf;
  }
}

export const lp = (buf, f, sr, q = 0.707) => new Biquad('lp', f, q, sr).run(buf);
export const hp = (buf, f, sr, q = 0.707) => new Biquad('hp', f, q, sr).run(buf);
export const bp = (buf, f, sr, q = 1) => new Biquad('bp', f, q, sr).run(buf);
export const peq = (buf, f, sr, q, db) => new Biquad('peak', f, q, sr, db).run(buf);

// Zeitvariables Filter: Frequenz-Kurve [[t, Hz], …], alle 32 Samples nachgeführt
export function sweep(buf, sr, type, fc, q = 1) {
  const f = new Biquad(type, kf(fc, 0), q, sr);
  for (let i = 0; i < buf.length; i += 32) {
    f.set(type, kf(fc, i / buf.length), q, sr);
    f.run(buf, i, Math.min(buf.length, i + 32));
  }
  return buf;
}

// ── Puffer-Helfer ─────────────────────────────────────────────
export function peakOf(buf) { let m = 0; for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > m) m = v; } return m; }
export function normalize(buf, peak = 0.9) {
  const m = peakOf(buf);
  if (m > 1e-9) { const k = peak / m; for (let i = 0; i < buf.length; i++) buf[i] *= k; }
  return buf;
}
export function fade(buf, sr, fin = 0.004, fout = 0.02) {
  const a = Math.min(buf.length, Math.floor(fin * sr)), b = Math.min(buf.length, Math.floor(fout * sr));
  for (let i = 0; i < a; i++) buf[i] *= i / a;
  for (let i = 0; i < b; i++) buf[buf.length - 1 - i] *= i / b;
  return buf;
}
export function mix(dst, src, at = 0, gain = 1) {
  const o = Math.max(0, Math.floor(at)), n = Math.min(src.length, dst.length - o);
  for (let i = 0; i < n; i++) dst[o + i] += src[i] * gain;
  return dst;
}
export function mul(buf, env) { for (let i = 0; i < buf.length; i++) buf[i] *= env[i]; return buf; }
export const secs = (sr, s) => new Float32Array(Math.max(1, Math.floor(s * sr)));

// Weiche, leicht asymmetrische Sättigung (Rachenrauheit), Pegel bleibt ~gleich
export function drive(buf, amount = 2, bias = 0.15) {
  if (amount <= 0) return buf;
  normalize(buf, 1);
  const off = sat(bias), k = 1 / sat(amount + bias);
  for (let i = 0; i < buf.length; i++) buf[i] = (sat(buf[i] * amount + bias) - off) * k;
  return buf;
}

// Abschluss: DC raus, Präsenz-Anhebung, Sättigung, Tiefpass, Fades, Normierung
// pre: [Hz, dB] – hebt vor der Sättigung an (Rachen-Rauheit statt Dumpfheit)
export function finish(buf, sr, { drv = 0, bias = 0.15, lpf = 0, hpf = 40, peak = 0.9, fin = 0.003, fout = 0.03, pre = null } = {}) {
  if (hpf) hp(buf, hpf, sr);
  if (pre) peq(buf, pre[0], sr, 0.7, pre[1]);
  if (drv) drive(buf, drv, bias);
  if (lpf) lp(buf, lpf, sr);
  fade(buf, sr, fin, fout);
  return normalize(buf, peak);
}

// ── Geräusch-Bausteine ───────────────────────────────────────
// Weißes Rauschen; env: Funktion (t∈0..1, Sekunden) oder Stützstellen-Kurve
export function noise(R, sr, dur, env = null) {
  const b = secs(sr, dur), n = b.length;
  const E = env && typeof env !== 'function' ? curve(env, n) : null;
  let s = R.int();
  for (let i = 0; i < n; i++) {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    b[i] = s * 4.656612873e-10 * (E ? E[i] : env ? env(i / n, i / sr) : 1);
  }
  return b;
}

// Abklingende Sinus-Moden: [{f, a, d (Abklingzeit s), f2 (Ziel-f), att (Anstieg s)}]
export function modes(sr, dur, list, buf = null, at = 0) {
  const b = buf || secs(sr, dur);
  const o = Math.max(0, Math.floor(at * sr));
  for (const m of list) {
    const n = Math.min(b.length - o, Math.floor(Math.min(dur, m.d * 7) * sr));
    const dec = Math.exp(-1 / (m.d * sr));
    const glide = m.f2 ? Math.pow(m.f2 / m.f, 1 / Math.max(1, n)) : 1;
    let a = m.a, inc = m.f / sr, ph = 0;
    const att = Math.max(1, Math.floor((m.att || 0.0005) * sr));
    for (let i = 0; i < n; i++) {
      const x = ph * TN, k = x | 0;
      b[o + i] += (SIN[k] + (SIN[k + 1] - SIN[k]) * (x - k)) * a * (i < att ? i / att : 1);
      ph += inc; if (ph >= 1) ph -= 1;
      inc *= glide; a *= dec;
    }
  }
  return b;
}

// Blasen (Minnaert): kurze, nach oben gleitende Sinus-Pings
export function bubbles(R, sr, n, rate, { fmin = 250, fmax = 1400, amp = 1, dmin = 0.006, dmax = 0.025 } = {}) {
  const b = new Float32Array(n);
  const cr = 64;
  for (let c = 0; c < n; c += cr) {
    if (R() < (kf(rate, c / n) * cr) / sr) {
      // Tonhöhe steigt beim Aufsteigen der Blase
      const d = R.range(dmin, dmax), f = fmin * Math.pow(fmax / fmin, R());
      modes(sr, d * 6, [{ f, f2: f * R.range(1.3, 2.2), a: amp * R.range(0.3, 1), d }], b, c / sr);
    }
  }
  return b;
}

// Körniges Rauschen: kurze Rauschkörner, Dichte (Körner/s) als Kurve
export function grains(R, sr, dur, density, { gmin = 0.002, gmax = 0.01, amp = 1 } = {}) {
  const b = secs(sr, dur), n = b.length;
  let s = R.int();
  for (let i = 0; i < n; i += 16) {
    if (R() < (kf(density, i / n) * 16) / sr) {
      const len = Math.max(2, Math.floor(R.range(gmin, gmax) * sr)), a = amp * R.range(0.3, 1), inc = 0.5 / len;
      for (let j = 0; j < len && i + j < n; j++) {
        s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
        b[i + j] += s * 4.656612873e-10 * a * sinT(j * inc);
      }
    }
  }
  return b;
}

// Wiedergabe mit veränderlicher Geschwindigkeit (Bandmaschine/leere Batterie)
export function varispeed(buf, rate) {
  const n = buf.length, out = [];
  for (let p = 0; p < n - 1; p += Math.max(0.05, kf(rate, p / n))) {
    const i = p | 0;
    out.push(buf[i] + (buf[i + 1] - buf[i]) * (p - i));
  }
  return Float32Array.from(out);
}

// Knarren (Haft-Gleit-Reibung): Impulsfolge mit wandernder Rate durch Resonanzen
// md: [[Hz, Güte, Pegel], …]
export function creak(R, sr, dur, { rate = 90, jit = 0.2, md = [[400, 10], [900, 12, 0.6]], amp = [[0, 0], [0.1, 1], [0.9, 1], [1, 0]] } = {}) {
  const src = secs(sr, dur), n = src.length;
  for (let i = 0, next = 0; i < n; i++) {
    if (i >= next) { src[i] = kf(amp, i / n) * R.range(0.4, 1); next = i + (sr / kf(rate, i / n)) * Math.max(0.3, 1 + jit * R.gauss()); }
  }
  const out = secs(sr, dur);
  for (const [f, q, g = 1] of md) mix(out, bp(Float32Array.from(src), f, sr, q), 0, g);
  return out;
}

// Wellenform-Tabelle aus Obertönen [[k, a], …] (eine Periode, 2048 Punkte)
export function wavetable(harm) {
  const N = 2048, t = new Float32Array(N + 1);
  for (const [k, a, ph = 0] of harm) for (let i = 0; i <= N; i++) t[i] += Math.sin((TAU * k * i) / N + ph) * a;
  return t;
}
// Oszillator über eine Tabelle; f: Zahl oder Array (Hz pro Sample), addiert in out ab Sample `at`
export function oscT(tab, sr, n, f, env = null, out = null, at = 0, gain = 1) {
  const b = out || new Float32Array(n), N = tab.length - 1, o = Math.floor(at);
  const fa = typeof f === 'number' ? null : f;
  let ph = 0;
  for (let i = 0; i < n && o + i < b.length; i++) {
    const x = ph * N, k = x | 0;
    b[o + i] += (tab[k] + (tab[k + 1] - tab[k]) * (x - k)) * (env ? env[i] : 1) * gain;
    ph += (fa ? fa[i] : f) / sr;
    if (ph >= 1) ph -= 1;
  }
  return b;
}

// Karplus-Strong-Saite (Twang, Surf-Gitarre, Zupfbass). t60: Nachklingzeit in s
export function pluck(R, sr, f, dur, { bright = 0.5, t60 = 1.5, pickPos = 0.18, body = 0 } = {}) {
  const b = secs(sr, dur), n = b.length;
  const bb = 0.5 - bright * 0.42; // Gewicht des Schleifen-Tiefpasses (0.5 = dumpf)
  const L = sr / f, N = Math.max(2, Math.floor(L - bb - 0.1)), d = L - bb - N;
  const ap = (1 - d) / (1 + d); // Allpass für die Feinstimmung
  const decay = Math.pow(0.001, 1 / (t60 * f));
  const line = new Float32Array(N);
  // Anschlag: gefiltertes Rauschen, Kammfilter = Anschlagposition
  let s = R.int(), z = 0, mean = 0;
  const k = 0.25 + bright * 0.75;
  for (let i = 0; i < N; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; z += (s * 4.656612873e-10 - z) * k; line[i] = z; }
  const pp = Math.max(1, Math.floor(N * pickPos));
  for (let i = N - 1; i >= pp; i--) line[i] -= line[i - pp];
  for (let i = 0; i < N; i++) mean += line[i];
  mean /= N;
  for (let i = 0; i < N; i++) line[i] -= mean;
  let idx = 0, prevOut = 0, apx = 0, apy = 0;
  for (let i = 0; i < n; i++) {
    const cur = line[idx];
    b[i] = cur;
    const v = decay * ((1 - bb) * cur + bb * prevOut);
    prevOut = cur;
    const y = ap * (v - apy) + apx;
    apx = v; apy = y;
    line[idx] = y;
    if (++idx >= N) idx = 0;
  }
  if (body) peq(b, body, sr, 1.2, 6);
  hp(b, f * 0.5, sr);
  return b;
}

// ── Stimme ───────────────────────────────────────────────────
// Formanten F1–F5 (Hz) für Vokale eines großen Erwachsenen
export const VOWELS = {
  a: [730, 1090, 2440, 3400, 4200],
  o: [570, 840, 2410, 3300, 4100],
  u: [320, 800, 2240, 3300, 4100],
  U: [440, 1020, 2240, 3300, 4100],
  e: [530, 1840, 2480, 3500, 4300],
  i: [280, 2250, 2900, 3500, 4300],
  ae: [660, 1720, 2410, 3400, 4200],
  uh: [520, 1190, 2390, 3400, 4200],
  er: [490, 1350, 1690, 3300, 4100],
  ng: [300, 1100, 2300, 3300, 4100],
};
const BW = [80, 100, 160, 240, 320];

const V = (x) => (typeof x === 'string' ? VOWELS[x] : x);
function vowelAt(p, t, out) {
  if (t <= p[0][0] || p.length === 1) { const v = V(p[0][1]); for (let k = 0; k < 5; k++) out[k] = v[k]; return out; }
  for (let i = 1; i < p.length; i++) {
    if (t <= p[i][0]) {
      const t0 = p[i - 1][0], k0 = (t - t0) / (p[i][0] - t0 || 1), s = k0 * k0 * (3 - 2 * k0);
      const a = V(p[i - 1][1]), b = V(p[i][1]);
      for (let k = 0; k < 5; k++) out[k] = a[k] + (b[k] - a[k]) * s;
      return out;
    }
  }
  const v = V(p[p.length - 1][1]); for (let k = 0; k < 5; k++) out[k] = v[k];
  return out;
}

/*
  Stimmsynthese (Quelle-Filter-Modell). Rückgabe: roher Puffer (vor finish()).
  o.dur        Dauer s
  o.f0         Grundton Hz (Zahl oder [[t, Hz], …])
  o.vib        [Rate Hz, Tiefe relativ]          o.drift  langsames Wandern (relativ)
  o.jitter     Periodenschwankung (relativ)      o.shimmer Amplitudenschwankung (relativ)
  o.sub        Subharmonische 0..1 (Growl)       o.fry    Knarren 0..1 (unregelmäßige Pulse)
  o.oq         Öffnungsquotient (0.3 gepresst … 0.8 hauchig)   o.sq Öffnen/Schließen-Verhältnis
  o.vowels     [[t, 'a'], [t, 'o'], …]           o.tract  Formant-Skalierung (Kopfgröße)
  o.bw         Bandbreiten-Faktor                o.fwob   Formant-Zittern (relativ)
  o.amp        Hüllkurve [[t, v], …]             o.asp / o.breath  Hauch (pulssynchron / frei)
  o.gurgle     Amplituden-Flattern 0..1          o.gurgleRate  Hz
  o.flutter    schnelles Formant-Flattern (Gurgeln im Rachen)
  o.cracks     Tonsprünge pro Sekunde (Kreischen) o.voiced Anteil der Stimmlippen (0 = Flüstern)
*/
export function voice(R, sr, o) {
  const n = Math.max(1, Math.floor(o.dur * sr));
  const out = new Float32Array(n);
  const CR = 32, nc = Math.ceil(n / CR) + 2, crate = sr / CR;
  const drift = wander(R, nc, crate, o.driftRate ?? 2.5);
  const gurg = wander(R, nc, crate, o.gurgleRate ?? 16);
  const fw0 = wander(R, nc, crate, 5), fw1 = wander(R, nc, crate, 6.5), fw2 = wander(R, nc, crate, 4.5);
  const vib = o.vib || [5, 0.01], vibW = vib[0] / sr, vibD = vib[1];
  const tract = o.tract ?? 1, bwk = o.bw ?? 1.25, fwob = o.fwob ?? 0.04;
  const sq = o.sq ?? 2.5, dr = o.drift ?? 0.03, voiced = o.voiced ?? 1, flut = o.flutter || 0;
  const cracks = o.cracks || 0, ampK = o.amp ?? 1, gurK = o.gurgle ?? 0, vow = o.vowels || [[0, 'uh']];
  const f0K = o.f0, aspK = o.asp ?? 0.1, brK = o.breath ?? 0, subK = o.sub ?? 0, fryK = o.fry ?? 0, oqK = o.oq ?? 0.6;
  const jitK = o.jitter ?? 0.02, shimK = o.shimmer ?? 0.1;
  const rf = [Math.exp((-Math.PI * BW[0] * bwk) / sr), Math.exp((-Math.PI * BW[1] * bwk) / sr), Math.exp((-Math.PI * BW[2] * bwk) / sr), Math.exp((-Math.PI * BW[3] * bwk) / sr), Math.exp((-Math.PI * BW[4] * bwk) / sr)];
  const F = [0, 0, 0, 0, 0];
  // Formant-Resonatoren (Kaskade, Gleichanteil-Verstärkung 1)
  let a0 = 0, b0 = 0, c0 = 0, a1 = 0, b1 = 0, c1 = 0, a2 = 0, b2 = 0, c2 = 0, a3 = 0, b3 = 0, c3 = 0, a4 = 0, b4 = 0, c4 = 0;
  let y10 = 0, y20 = 0, y11 = 0, y21 = 0, y12 = 0, y22 = 0, y13 = 0, y23 = 0, y14 = 0, y24 = 0;
  let T = sr / kf(f0K, 0), pos = T, A = 1, To = 50, Tp = 30, Tn = 20, invTp = 1, invTn = 1, idx = 0, prev = 0, scale = 1;
  let amp = kf(ampK, 0), gl = 1 + kf(gurK, 0) * gurg[0];
  let jump = 1, jumpLeft = 0;
  let s1 = R.int(), s2 = R.int();
  const co = new Float64Array(3);
  const rcoef = (k, f) => { const r = rf[k], b = 2 * r * Math.cos((TAU * Math.min(sr * 0.45, f)) / sr); co[0] = 1 - b + r * r; co[1] = b; co[2] = -r * r; };
  for (let c = 0, i = 0; i < n; c++) {
    // ── Steuergrößen (alle 32 Samples) ──
    const t = i / n, tn = Math.min(1, (i + CR) / n);
    const ampInc = (kf(ampK, tn) - amp) / CR, glInc = (1 + kf(gurK, tn) * gurg[c + 1] - gl) / CR;
    const asp = kf(aspK, t), br = kf(brK, t), sub = kf(subK, t), fry = kf(fryK, t), oq = kf(oqK, t);
    const jit = kf(jitK, t), shim = kf(shimK, t), dcur = drift[c];
    vowelAt(vow, t, F);
    if (flut) { const g = gurg[c] * flut; F[0] *= 1 + g; F[1] *= 1 + g * 0.6; }
    rcoef(0, F[0] * tract * (1 + fw0[c] * fwob)); a0 = co[0]; b0 = co[1]; c0 = co[2];
    rcoef(1, F[1] * tract * (1 + fw1[c] * fwob)); a1 = co[0]; b1 = co[1]; c1 = co[2];
    rcoef(2, F[2] * tract * (1 + fw2[c] * fwob)); a2 = co[0]; b2 = co[1]; c2 = co[2];
    rcoef(3, F[3] * tract); a3 = co[0]; b3 = co[1]; c3 = co[2];
    rcoef(4, F[4] * tract); a4 = co[0]; b4 = co[1]; c4 = co[2];
    if (cracks && jumpLeft <= 0 && R() < (cracks * CR) / sr) { jump = R.pick([0.5, 0.62, 0.75, 1.3, 1.5, 1.8]); jumpLeft = R.range(0.04, 0.16) * sr; }
    if (jumpLeft > 0) { jumpLeft -= CR; if (jumpLeft <= 0) jump = 1; }
    const end = Math.min(n, i + CR);
    for (; i < end; i++) {
      // ── Neue Stimmlippen-Periode ──
      if (pos >= T) {
        pos -= T; if (pos > T) pos = 0;
        idx++;
        const f0 = kf(f0K, i / n) * (1 + dcur * dr) * (1 + sinT(vibW * i) * vibD) * jump;
        T = (sr / f0) * (1 + jit * R.gauss());
        if (fry > 0 && R() < fry * 0.5) T *= 1 + R() * 1.7 * fry;
        A = 1 + shim * R.gauss();
        if (idx & 1) { A *= 1 - sub; T *= 1 + sub * 0.14; } else T *= 1 - sub * 0.1;
        if (fry > 0 && R() < fry * 0.18) A *= 0.25;
        if (A < 0.05) A = 0.05;
        if (T < 6) T = 6; else if (T > sr / 18) T = sr / 18;
        To = oq * T; Tp = (To * sq) / (1 + sq); Tn = Math.max(1, To - Tp);
        invTp = GN / Tp; invTn = GN / Tn;
        scale = T * 0.08 * voiced;
      }
      let flow = 0;
      if (pos < Tp) { const x = pos * invTp, k = x | 0; flow = UP[k] + (UP[k + 1] - UP[k]) * (x - k); }
      else if (pos < To) { const x = (pos - Tp) * invTn, k = x | 0; flow = DN[k] + (DN[k + 1] - DN[k]) * (x - k); }
      flow *= A;
      let e = (flow - prev) * scale;
      prev = flow;
      s1 ^= s1 << 13; s1 ^= s1 >>> 17; s1 ^= s1 << 5;
      s2 ^= s2 << 13; s2 ^= s2 >>> 17; s2 ^= s2 << 5;
      e += s1 * 4.656612873e-10 * asp * (0.2 + (0.8 * flow) / (A + 0.001)) + s2 * 4.656612873e-10 * br;
      e *= amp * gl;
      amp += ampInc; gl += glInc;
      // Vokaltrakt
      let y = a0 * e + b0 * y10 + c0 * y20; y20 = y10; y10 = y;
      y = a1 * y + b1 * y11 + c1 * y21; y21 = y11; y11 = y;
      y = a2 * y + b2 * y12 + c2 * y22; y22 = y12; y12 = y;
      y = a3 * y + b3 * y13 + c3 * y23; y23 = y13; y13 = y;
      y = a4 * y + b4 * y14 + c4 * y24; y24 = y14; y14 = y;
      out[i] = y;
      pos++;
    }
  }
  return out;
}
