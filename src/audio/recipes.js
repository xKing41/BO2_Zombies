// ─────────────────────────────────────────────────────────────
//  Rezepte der vorab berechneten Klangbank (reines JS, siehe dsp.js):
//  Zombie-Stimmen, Gore, Schritte, Trinken, Teddy, Schreibmaschine,
//  Kasse, Kiste, Strom, Ansager-Wucht, Power-Ups und Ambiente.
//  Jedes Rezept liefert pro Aufruf eine Variante als Float32Array.
// ─────────────────────────────────────────────────────────────
import {
  rng, NOTE, voice, finish, noise, modes, bubbles, grains, sweep, varispeed, creak, wavetable, oscT, curve, sinT,
  mix, secs, lp, hp, bp, peq, normalize, drive,
} from './dsp.js';

export const SRV = 24000; // Stimmen
export const SRF = 32000; // Geräusche

// Wellenformen (bandbegrenzt)
const SINE = wavetable([[1, 1]]);
const SAW8 = wavetable([1, 2, 3, 4, 5, 6, 7, 8].map((k) => [k, 1 / k]));
const SQUARE = wavetable([1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25].map((k) => [k, 1 / k]));

// Vokal-Pfad gleichmäßig (leicht zufällig) über die Dauer verteilen
function path(R, list, t0 = 0, t1 = 1) {
  const n = list.length;
  return list.map((v, i) => [t0 + ((t1 - t0) * i) / Math.max(1, n - 1) + (i > 0 && i < n - 1 ? R.range(-0.06, 0.06) : 0), v]);
}
// Nasse Blasen unter eine Stimme mischen
function wet(R, sr, b, rate, amount, o) {
  normalize(b, 1);
  return mix(b, bubbles(R, sr, b.length, rate, o), 0, amount);
}
// Kurzer Klick (Rauschimpuls)
function click(R, sr, b, t, f, a, dur = 0.004) {
  const c = noise(R, sr, dur, (x) => (1 - x) ** 2);
  bp(c, f, sr, 1.5);
  return mix(b, c, t * sr, a);
}
// Exponentiell abklingender Rauschstoß, gefiltert
function thump(R, sr, b, t, f, a, dur = 0.08, k = 6) {
  const c = noise(R, sr, dur, (x) => Math.exp(-x * k) * Math.min(1, x * 60));
  lp(c, f, sr);
  return mix(b, c, t * sr, a);
}

// ── Zombies ──────────────────────────────────────────────────
const GROAN_V = [['uh', 'a', 'o'], ['o', 'a', 'uh', 'u'], ['u', 'o', 'a'], ['a', 'uh', 'er'], ['uh', 'o', 'u', 'o'], ['er', 'a', 'o'], ['o', 'u', 'o', 'a', 'uh'], ['a', 'o', 'U']];

// Stöhnen: tief, knarrend, mit Taschenfalten-Growl und wanderndem Mund
function groan(R, i, sr) {
  const kind = i % 4, dur = R.range(1.2, 2.0), f = R.range(58, 98);
  const P = [
    { amp: [[0, 0], [0.2, 0.85], [0.5, 1], [0.82, 0.7], [1, 0]], f0: [[0, f * 0.92], [0.45, f * 1.15], [1, f * 0.7]] },
    { amp: [[0, 0], [0.1, 0.75], [0.28, 0.55], [0.36, 0.12], [0.46, 1], [0.78, 0.8], [1, 0]], f0: [[0, f], [0.3, f * 0.86], [0.42, f * 1.28], [1, f * 0.74]] },
    { amp: [[0, 0], [0.07, 0.9], [0.55, 1], [0.85, 0.6], [1, 0]], f0: [[0, f * 1.06], [0.5, f * 0.96], [1, f * 0.8]] },
    { amp: [[0, 0], [0.15, 0.7], [0.3, 0.9], [0.45, 0.5], [0.6, 0.95], [0.8, 0.6], [1, 0]], f0: [[0, f * 0.9], [0.3, f * 1.1], [0.6, f * 1.05], [1, f * 0.68]] },
  ][kind];
  const b = voice(R, sr, {
    dur, ...P, vib: [R.range(3, 6), R.range(0.01, 0.03)], drift: 0.05,
    jitter: R.range(0.025, 0.05), shimmer: R.range(0.15, 0.3),
    sub: kind === 2 ? [[0, 0.3], [0.5, 0.75], [1, 0.45]] : R.range(0.15, 0.45),
    fry: [[0, 0.12], [0.7, 0.2], [1, 0.75]], oq: R.range(0.45, 0.58), sq: R.range(3.2, 4.2),
    vowels: path(R, GROAN_V[i % GROAN_V.length]), tract: R.range(0.82, 0.95), bw: R.range(1.2, 1.6), fwob: 0.05,
    asp: R.range(0.25, 0.45), breath: R.range(0.03, 0.08), gurgle: R.range(0.15, 0.4), gurgleRate: R.range(10, 25), flutter: R.range(0.03, 0.08),
  });
  wet(R, sr, b, R.range(2, 7), R.range(0.04, 0.09), { fmin: 200, fmax: 900 });
  return finish(b, sr, { pre: [R.range(1500, 2200), R.range(7, 10)], drv: R.range(2, 3.5), lpf: 7000, hpf: 45 });
}

// Sprinter-Kreischen: hoch, gepresst, zweistimmig, mit Tonsprüngen und Fauchen
function scream(R, i, sr) {
  const dur = R.range(0.7, 1.2), f = R.range(300, 520);
  const b = secs(sr, dur);
  const vv = [['a', 'ae', 'a'], ['ae', 'e', 'a'], ['a', 'o'], ['ae', 'a', 'uh'], ['e', 'ae', 'a']][i % 5];
  for (let L = 0; L < 2; L++) {
    const fl = f * (L ? R.range(0.68, 0.82) : 1);
    const v = voice(R, sr, {
      dur, f0: [[0, fl * 0.55], [0.09, fl * 1.12], [0.35, fl], [0.7, fl * 0.93], [1, fl * 0.5]],
      amp: [[0, 0], [0.05, 1], [0.65, 0.9], [1, 0]], vib: [R.range(6, 10), R.range(0.03, 0.06)], drift: 0.06,
      jitter: R.range(0.01, 0.022), shimmer: 0.25, sub: R.range(0.15, 0.5), oq: 0.35, sq: 3.8,
      vowels: path(R, vv), tract: R.range(1.0, 1.15), bw: 1.3, fwob: 0.08,
      asp: 0.15, breath: 0.04, gurgle: 0.25, gurgleRate: 30, cracks: R.range(1, 3),
    });
    normalize(v, 1);
    mix(b, v, 0, L ? 0.6 : 1);
  }
  const h = noise(R, sr, dur, [[0, 0], [0.06, 1], [0.7, 0.6], [1, 0]]);
  bp(h, 4000, sr, 0.6);
  mix(b, h, 0, 0.08);
  return finish(b, sr, { pre: [2500, 6], drv: R.range(3, 5), lpf: 9000, hpf: 160 });
}

// Angriffs-Brüllen: kurz, laut, starker Growl
function attack(R, i, sr) {
  const dur = R.range(0.45, 0.8), f = R.range(105, 165);
  const b = voice(R, sr, {
    dur, f0: [[0, f * 0.75], [0.2, f * 1.15], [0.6, f], [1, f * 0.7]], amp: [[0, 0], [0.04, 1], [0.6, 0.9], [1, 0]],
    vib: [R.range(5, 8), 0.02], jitter: 0.04, shimmer: 0.25, sub: R.range(0.5, 0.8), oq: 0.42, sq: 3.8,
    vowels: path(R, [['a', 'o'], ['ae', 'a', 'o'], ['a', 'uh'], ['o', 'a', 'o'], ['uh', 'a', 'o']][i % 5]), tract: R.range(0.85, 0.98), bw: 1.4,
    asp: 0.35, breath: 0.05, gurgle: 0.25, gurgleRate: 22,
  });
  normalize(b, 1);
  const h = noise(R, sr, 0.08, (t) => Math.exp(-t * 5));
  bp(h, 1200, sr, 0.8);
  mix(b, h, 0, 0.35);
  return finish(b, sr, { pre: [1600, 7], drv: R.range(4, 6.5), lpf: 8000, hpf: 70 });
}

// Todesröcheln: Würgen, fallender Ton, Knarren, Blasen im Rachen
function death(R, i, sr) {
  const dur = R.range(0.9, 1.5), f = R.range(120, 165);
  const b = voice(R, sr, {
    dur, f0: [[0, f * 1.1], [0.12, f], [0.5, f * 0.6], [1, f * 0.3]],
    amp: [[0, 0], [0.03, 1], [0.12, 0.55], [0.2, 0.9], [0.7, 0.5], [1, 0]],
    jitter: [[0, 0.04], [1, 0.14]], shimmer: [[0, 0.2], [1, 0.4]], sub: 0.4, fry: [[0, 0.05], [0.5, 0.3], [1, 0.9]], oq: [[0, 0.45], [1, 0.7]],
    vowels: path(R, [['a', 'o', 'u', 'U'], ['ae', 'a', 'o', 'u'], ['a', 'uh', 'o'], ['o', 'a', 'uh', 'u']][i % 4]), tract: R.range(0.85, 0.95), bw: 1.6,
    asp: [[0, 0.2], [1, 0.5]], breath: [[0, 0.02], [0.7, 0.05], [1, 0.15]], gurgle: [[0, 0.3], [1, 0.7]], gurgleRate: 20, flutter: 0.12,
  });
  wet(R, sr, b, [[0, 8], [0.5, 30], [1, 45]], R.range(0.1, 0.18), { fmin: 180, fmax: 1100 });
  const k = noise(R, sr, 0.05, (t) => Math.exp(-t * 6));
  hp(k, 800, sr);
  mix(b, k, 0, 0.4);
  return finish(b, sr, { pre: [1500, 7], drv: R.range(2, 3.2), lpf: 6500, hpf: 50 });
}

// Kriecher ohne Beine: tiefes, nasses Fauchen und Gurgeln
function crawler(R, i, sr) {
  const dur = R.range(0.7, 1.3), f = R.range(32, 55);
  const b = voice(R, sr, {
    dur, f0: [[0, f], [0.5, f * 1.2], [1, f * 0.8]], amp: [[0, 0], [0.12, 0.9], [0.5, 1], [0.8, 0.8], [1, 0]],
    jitter: 0.12, shimmer: 0.4, sub: 0.35, fry: 0.75, oq: 0.6,
    vowels: path(R, [['uh', 'er', 'o'], ['er', 'uh', 'er'], ['o', 'er', 'uh'], ['uh', 'U', 'er']][i % 4]), tract: R.range(0.75, 0.88), bw: 2,
    asp: 0.4, breath: R.range(0.5, 0.8), gurgle: 0.6, gurgleRate: R.range(18, 30), flutter: 0.2,
  });
  wet(R, sr, b, R.range(14, 28), 0.18, { fmin: 200, fmax: 800 });
  return finish(b, sr, { pre: [1800, 5], drv: 2, lpf: 5000, hpf: 70 });
}

// Prankenhieb: Luftzug mit Stoff-Flattern
function swipe(R, i, sr) {
  const dur = R.range(0.28, 0.4), fl = R.range(25, 45) / sr;
  const b = noise(R, sr, dur, [[0, 0], [0.35, 1], [1, 0]]);
  for (let j = 0; j < b.length; j++) b[j] *= 0.75 + 0.25 * sinT(fl * j);
  sweep(b, sr, 'bp', [[0, 350], [0.45, R.range(1500, 2200)], [1, 600]], 1.4);
  return finish(b, sr, { hpf: 100, fout: 0.05 });
}

// Schlurfender Schritt: dumpfer Auftritt + nachgezogener Fuß
function stepWalk(R, i, sr) {
  const dur = R.range(0.22, 0.36), b = secs(sr, dur);
  thump(R, sr, b, 0, R.range(280, 520), 1, 0.07, 7);
  modes(sr, 0.12, [{ f: R.range(65, 100), f2: 45, a: 0.5, d: 0.025 }], b, 0);
  const at = R.range(0.02, 0.05);
  const sc = grains(R, sr, dur - at, [[0, 900], [0.3, 600], [1, 50]], { gmin: 0.001, gmax: 0.004 });
  for (let j = 0; j < sc.length; j++) sc[j] *= (1 - j / sc.length) ** 1.4;
  bp(sc, R.range(1100, 2300), sr, 0.6);
  mix(b, sc, at * sr, R.range(0.3, 0.55));
  return finish(b, sr, { hpf: 40, fout: 0.04 });
}
// Rennender Schritt: schwerer Aufprall, kurzes Kratzen
function stepRun(R, i, sr) {
  const dur = R.range(0.14, 0.2), b = secs(sr, dur);
  thump(R, sr, b, 0, R.range(500, 800), 1, 0.06, 6);
  modes(sr, 0.1, [{ f: R.range(80, 120), f2: 50, a: 0.8, d: 0.03 }], b, 0);
  const sc = grains(R, sr, 0.09, [[0, 1200], [1, 100]], { gmin: 0.001, gmax: 0.003 });
  bp(sc, R.range(1500, 2800), sr, 0.7);
  mix(b, sc, 0.01 * sr, 0.35);
  return finish(b, sr, { hpf: 40, fout: 0.03 });
}

// Platzender Schädel: Knochenknacken, nasser Platscher, Matsch-Wumms, Spritzer
function headPop(R, i, sr) {
  const b = secs(sr, 0.9);
  const n = 2 + Math.floor(R() * 3);
  for (let k = 0; k < n; k++) {
    const at = k * R.range(0.003, 0.011);
    const c = noise(R, sr, 0.006, (t) => (1 - t) ** 3);
    hp(c, 1800, sr);
    mix(b, c, at * sr, R.range(0.6, 1));
    modes(sr, 0.15, [{ f: R.range(1500, 3200), a: 0.35, d: 0.01 }, { f: R.range(700, 1300), a: 0.4, d: 0.018 }, { f: R.range(3800, 6000), a: 0.2, d: 0.005 }], b, at);
  }
  const sp = grains(R, sr, 0.4, [[0, 2500], [0.25, 900], [1, 60]], { gmin: 0.002, gmax: 0.012 });
  for (let j = 0; j < sp.length; j++) sp[j] *= Math.exp(-j / (0.09 * sr));
  lp(sp, R.range(1800, 3000), sr);
  peq(sp, R.range(500, 800), sr, 1, 6);
  mix(b, sp, 0.004 * sr, 1.6);
  modes(sr, 0.25, [{ f: R.range(120, 170), f2: 50, a: 0.9, d: 0.045 }], b, 0.002);
  mix(b, bubbles(R, sr, b.length, [[0, 0], [0.1, 45], [0.45, 12], [1, 0]], { fmin: 600, fmax: 2600, amp: 0.4, dmin: 0.002, dmax: 0.008 }), 0, 0.6);
  return finish(b, sr, { drv: 1.4, hpf: 45, lpf: 11000, fout: 0.15 });
}

// Abgerissenes Glied: Reißen, Sehnen-Schnalzer, Knochen, nasser Klatscher
function gib(R, i, sr) {
  const b = secs(sr, 0.7);
  const len = R.range(0.18, 0.32);
  const tear = grains(R, sr, len, [[0, 60], [0.5, R.range(500, 900)], [1, 80]], { gmin: 0.0015, gmax: 0.006 });
  sweep(tear, sr, 'bp', [[0, R.range(700, 1000)], [1, R.range(1500, 2400)]], 0.9);
  mix(b, tear, 0, 1.4);
  const snap = len * R.range(0.6, 0.95);
  const c = noise(R, sr, 0.005, (t) => (1 - t) ** 3);
  hp(c, 2500, sr);
  mix(b, c, snap * sr, 0.9);
  modes(sr, 0.1, [{ f: R.range(1800, 3000), a: 0.3, d: 0.008 }, { f: R.range(900, 1300), a: 0.3, d: 0.015 }], b, snap);
  const sp = grains(R, sr, 0.3, [[0, 1800], [1, 50]], { gmin: 0.002, gmax: 0.01 });
  for (let j = 0; j < sp.length; j++) sp[j] *= Math.exp(-j / (0.07 * sr));
  lp(sp, 2200, sr);
  mix(b, sp, (snap + 0.01) * sr, 1.2);
  modes(sr, 0.2, [{ f: R.range(100, 150), f2: 55, a: 0.6, d: 0.04 }], b, snap);
  mix(b, bubbles(R, sr, b.length, [[0, 5], [0.4, 25], [1, 0]], { fmin: 400, fmax: 1800, amp: 0.3 }), 0, 0.5);
  return finish(b, sr, { drv: 1.3, hpf: 50, lpf: 10000, fout: 0.12 });
}

// ── Perk trinken (passend zur 2,4-s-Animation) ───────────────
function gulp(R, sr, b, t) {
  thump(R, sr, b, t, 350, 0.55, 0.07, 5);
  modes(sr, 0.15, [{ f: R.range(170, 230), f2: R.range(380, 480), a: 0.35, d: 0.03, att: 0.008 }], b, t + 0.015);
  modes(sr, 0.1, [{ f: R.range(90, 120), f2: 60, a: 0.4, d: 0.025 }], b, t);
  mix(b, bubbles(R, sr, Math.floor(0.2 * sr), [[0, 60], [1, 0]], { fmin: 350, fmax: 1300, amp: 0.25, dmin: 0.004, dmax: 0.012 }), (t + 0.03) * sr, 0.6);
}
function shatter(R, sr, b, t, vol) {
  const nb = noise(R, sr, 0.35, (x) => Math.exp(-x * 9));
  hp(nb, 1800, sr);
  mix(b, nb, t * sr, vol * 0.5);
  for (let k = 0; k < 24; k++) modes(sr, 0.3, [{ f: R.range(2200, 9000), a: vol * R.range(0.05, 0.25), d: R.range(0.01, 0.06) }], b, t + R() ** 2 * 0.3);
}
function aah(R, sr) {
  const v = voice(R, sr, {
    dur: 0.6, f0: [[0, 140], [0.25, 128], [1, 96]], amp: [[0, 0], [0.12, 1], [0.55, 0.7], [1, 0]],
    jitter: 0.015, shimmer: 0.06, oq: 0.72, vowels: [[0, 'a'], [0.7, 'a'], [1, 'uh']], tract: 1.0, bw: 1.1,
    asp: 0.5, breath: [[0, 0.5], [0.15, 0.15], [1, 0.3]],
  });
  return finish(v, sr, { lpf: 6000, hpf: 80, peak: 1 });
}
function burp(R, sr) {
  const v = voice(R, sr, {
    dur: 0.5, f0: [[0, 100], [0.4, 82], [1, 62]], amp: [[0, 0], [0.05, 1], [0.6, 0.8], [1, 0]],
    jitter: 0.05, shimmer: 0.25, sub: 0.3, fry: [[0, 0.2], [1, 0.6]], oq: 0.5, vowels: [[0, 'o'], [0.5, 'U'], [1, 'u']], tract: 0.92, bw: 1.4,
    asp: 0.2, gurgle: 0.35, gurgleRate: 25,
  });
  return finish(v, sr, { drv: 1.5, lpf: 5000, hpf: 60, peak: 1 });
}
// Variante 0: zufriedenes „Aah“, Variante 1: Rülpser
function drink(R, i, sr) {
  const b = secs(sr, 2.75);
  // 0,15 s Kronkorken: Plopp, Zischen, Blech-Ping
  click(R, sr, b, 0.15, 1400, 0.8, 0.012);
  modes(sr, 0.1, [{ f: R.range(500, 700), f2: 320, a: 0.5, d: 0.012 }], b, 0.15);
  const hiss = noise(R, sr, 0.5, (t) => Math.exp(-t * 6) * Math.min(1, t * 40));
  hp(hiss, 3500, sr);
  mix(b, hiss, 0.16 * sr, 0.22);
  modes(sr, 0.4, [{ f: R.range(3800, 4600), a: 0.12, d: 0.06 }, { f: R.range(6200, 7400), a: 0.08, d: 0.04 }, { f: R.range(2400, 2900), a: 0.06, d: 0.08 }], b, 0.24);
  // 0,4 s Glas klirrt
  modes(sr, 0.6, [{ f: R.range(2700, 3100), a: 0.16, d: 0.15 }, { f: R.range(4500, 4900), a: 0.1, d: 0.09 }, { f: R.range(6800, 7400), a: 0.05, d: 0.05 }, { f: R.range(1500, 1700), a: 0.05, d: 0.12 }], b, 0.4);
  // Schlucke zwischen 0,6 und 1,6 s
  const n = 3 + (R() < 0.5 ? 1 : 0);
  for (let k = 0; k < n; k++) gulp(R, sr, b, 0.62 + (k * 0.95) / (n - 1) + R.range(-0.03, 0.03));
  // 1,85 s Wurf, 1,97 s Splittern (weiter weg)
  const w = noise(R, sr, 0.18, (t) => Math.sin(Math.PI * t) ** 2);
  sweep(w, sr, 'bp', [[0, 600], [1, 1800]], 1.2);
  mix(b, w, 1.8 * sr, 0.12);
  shatter(R, sr, b, 1.97, 0.35);
  // 2,1 s zufrieden
  mix(b, i % 2 ? burp(R, sr) : aah(R, sr), 2.08 * sr, 0.5);
  return finish(b, sr, { hpf: 40, fout: 0.05, peak: 0.85 });
}

// ── Mystery-Kiste ────────────────────────────────────────────
// Spielzeug-Teddy: hohes „ha-ha-ha“, Lautsprecher klirrt, Batterie leiert aus
function teddy(R, i, sr) {
  const syl = 5 + (i % 2), sd = R.range(0.13, 0.16), tail = 0.55;
  const dur = syl * sd + tail, base = R.range(330, 420);
  const amp = [[0, 0]], f0 = [[0, base]], asp = [[0, 0.9]];
  for (let k = 0; k < syl; k++) {
    const t0 = (k * sd) / dur, t1 = ((k + 0.25) * sd) / dur, t2 = ((k + 0.7) * sd) / dur, t3 = ((k + 0.98) * sd) / dur;
    amp.push([t0, 0.05], [t1, 1], [t2, 0.8], [t3, 0.05]);
    asp.push([t0 + 0.001, 0.9], [t1, 0.25]);
    f0.push([t1, base * (1 - k * 0.05)]);
  }
  const tl = (syl * sd) / dur;
  amp.push([tl + 0.04, 1], [tl + 0.7 * (1 - tl), 0.7], [1, 0]);
  f0.push([tl + 0.04, base * 0.92], [1, base * 0.5]);
  let v = voice(R, sr, { dur, f0, amp, asp, breath: 0.05, jitter: 0.02, shimmer: 0.1, oq: 0.55, vowels: [[0, 'ae'], [1, 'a']], tract: 1.35, bw: 1.2, vib: [7, 0.02] });
  normalize(v, 1);
  v = varispeed(v, [[0, 1], [0.6, 1], [1, 0.55]]);
  hp(v, 450, sr); lp(v, 3800, sr); peq(v, 1700, sr, 1.5, 8);
  drive(v, 3, 0.1);
  // Zugschnur-Klick und Surren der Mechanik
  const b = secs(sr, v.length / sr + 0.15);
  mix(b, v, 0.06 * sr, 1);
  click(R, sr, b, 0, 2500, 0.5, 0.006);
  const wh = noise(R, sr, v.length / sr, (t, s) => 0.6 + 0.4 * sinT(31 * s));
  bp(wh, 900, sr, 2);
  mix(b, wh, 0.06 * sr, 0.05);
  return finish(b, sr, { lpf: 5000, hpf: 300, fout: 0.08 });
}

// Deckel-Knarren mit Anschlag
function boxOpen(R, i, sr) {
  const dur = R.range(0.45, 0.6), b = secs(sr, dur + 0.25);
  mix(b, creak(R, sr, dur, {
    rate: [[0, 55], [0.3, 140], [0.7, 95], [1, 70]], jit: 0.25,
    md: [[R.range(380, 460), 9], [R.range(850, 1000), 11, 0.7], [R.range(1700, 2000), 12, 0.4], [R.range(2900, 3300), 14, 0.2]],
    amp: [[0, 0], [0.1, 1], [0.8, 0.8], [1, 0]],
  }), 0, 1);
  thump(R, sr, b, dur, 700, 0.6, 0.06, 6);
  modes(sr, 0.2, [{ f: R.range(180, 240), a: 0.5, d: 0.04 }, { f: R.range(520, 640), a: 0.25, d: 0.03 }], b, dur);
  return finish(b, sr, { hpf: 80, fout: 0.05 });
}

// Kiste fliegt davon: Wind mit Dreh-Tremolo, aufsteigender Zauberton, Puff
function boxWhoosh(R, i, sr) {
  const b = secs(sr, 3.5);
  const w = noise(R, sr, 3.1, [[0, 0], [0.15, 0.6], [0.9, 1], [1, 0]]);
  let ph = 0;
  for (let j = 0; j < w.length; j++) {
    const t = j / w.length;
    ph += (0.35 + 2.25 * t * t) / sr; // halbe Drehzahl: |sin| ergibt zwei Stöße pro Umdrehung
    w[j] *= 0.35 + 0.65 * Math.abs(sinT(ph));
  }
  sweep(w, sr, 'bp', [[0, 300], [1, 2400]], 1.6);
  mix(b, w, 0, 1);
  const n = Math.floor(3.05 * sr), env = curve([[0, 0], [0.3, 0.5], [0.95, 1], [1, 0]], n), fr = new Float32Array(n);
  for (const [det, a] of [[1, 0.12], [1.007, 0.1], [2.003, 0.04]]) {
    for (let j = 0; j < n; j++) fr[j] = 180 * det * Math.pow(7, j / n);
    oscT(SINE, sr, n, fr, env, b, 0, a);
  }
  thump(R, sr, b, 3.0, 1500, 0.8, 0.5, 7);
  modes(sr, 0.4, [{ f: 90, f2: 40, a: 0.6, d: 0.08 }], b, 3.0);
  return finish(b, sr, { hpf: 60, fout: 0.2, peak: 0.85 });
}

// ── Oberfläche ───────────────────────────────────────────────
// Schreibmaschine: Typenhebel-Klack, Walzen-Pochen, Tastenrückfederung
function typeKey(R, i, sr) {
  const b = secs(sr, 0.12);
  click(R, sr, b, 0, 4000, 0.9);
  modes(sr, 0.12, [{ f: R.range(1900, 2700), a: 0.4, d: 0.012 }, { f: R.range(3600, 5200), a: 0.25, d: 0.006 }, { f: R.range(650, 950), a: 0.35, d: 0.018 }], b, 0.0008);
  thump(R, sr, b, 0.002, 450, 0.6, 0.03, 8);
  modes(sr, 0.06, [{ f: R.range(120, 170), a: 0.4, d: 0.012 }], b, 0.002);
  click(R, sr, b, R.range(0.035, 0.06), 3000, 0.25, 0.003);
  return finish(b, sr, { hpf: 60, fout: 0.02 });
}
function typeSpace(R, i, sr) {
  const b = secs(sr, 0.16);
  click(R, sr, b, 0, 2500, 0.6);
  thump(R, sr, b, 0.001, 300, 1, 0.05, 6);
  modes(sr, 0.1, [{ f: R.range(90, 120), a: 0.5, d: 0.02 }, { f: R.range(700, 900), a: 0.2, d: 0.015 }], b, 0.001);
  click(R, sr, b, R.range(0.06, 0.08), 2000, 0.3);
  return finish(b, sr, { hpf: 50, fout: 0.03 });
}
function typeReturn(R, i, sr) {
  const b = secs(sr, 1.1), f = 2650;
  modes(sr, 1.1, [{ f, a: 0.5, d: 0.35 }, { f: f * 1.004, a: 0.3, d: 0.33 }, { f: f * 2.76, a: 0.2, d: 0.12 }, { f: f * 5.4, a: 0.1, d: 0.05 }], b, 0);
  for (let k = 0; k < 14; k++) click(R, sr, b, 0.25 + k * 0.028 + R.range(-0.003, 0.003), R.range(2500, 4000), 0.3, 0.003);
  thump(R, sr, b, 0.66, 400, 0.9, 0.06, 6);
  modes(sr, 0.15, [{ f: 140, a: 0.4, d: 0.03 }, { f: 1300, a: 0.15, d: 0.02 }], b, 0.66);
  return finish(b, sr, { hpf: 60, fout: 0.05, peak: 0.85 });
}

// Kasse „Ka-Tsching“: Hebel-Ratsche, Schublade, Glocke, Münzen
function purchase(R, i, sr) {
  const b = secs(sr, 1.1);
  for (let k = 0; k < 6; k++) click(R, sr, b, k * 0.016, R.range(2000, 3800), 0.35);
  thump(R, sr, b, 0.1, 600, 0.7, 0.09, 4);
  modes(sr, 0.2, [{ f: 140, f2: 90, a: 0.5, d: 0.04 }, { f: R.range(900, 1100), a: 0.15, d: 0.05 }], b, 0.1);
  const f = R.range(2350, 2550);
  modes(sr, 1.0, [{ f, a: 0.45, d: 0.4 }, { f: f * 1.003, a: 0.3, d: 0.38 }, { f: f * 2.76, a: 0.22, d: 0.16 }, { f: f * 5.4, a: 0.1, d: 0.07 }, { f: f * 0.5, a: 0.06, d: 0.3 }], b, 0.105);
  for (let k = 0; k < 7; k++) modes(sr, 0.3, [{ f: R.range(4500, 8000), a: R.range(0.04, 0.1), d: R.range(0.02, 0.06) }], b, 0.14 + R() * 0.25);
  return finish(b, sr, { hpf: 80, fout: 0.08, peak: 0.85 });
}

// Ablehnen: zwei tiefe Summer-Stöße
function deny(R, i, sr) {
  const b = secs(sr, 0.55);
  for (const [t0, f, d] of [[0, 155, 0.14], [0.2, 125, 0.22]]) {
    const n = Math.floor(d * sr), env = new Float32Array(n);
    for (let j = 0; j < n; j++) env[j] = 0.6 * Math.min(1, j / (0.004 * sr)) * Math.min(1, (n - j) / (0.02 * sr));
    oscT(SQUARE, sr, n, f, env, b, t0 * sr);
  }
  bp(b, 650, sr, 0.9);
  peq(b, 300, sr, 1, 4);
  click(R, sr, b, 0, 2500, 0.3);
  return finish(b, sr, { drv: 1.5, hpf: 80, lpf: 4000, fout: 0.03, peak: 0.8 });
}

// ── Strom an: Schütz, Generator läuft an, Lichtbänke flackern auf ──
function powerOn(R, i, sr) {
  const dur = 6.5, b = secs(sr, dur), n = b.length;
  // Großer Schalter: KA-WUMM mit Lichtbogen
  thump(R, sr, b, 0, 800, 1, 0.18, 4);
  modes(sr, 0.5, [{ f: 80, f2: 42, a: 1, d: 0.09 }, { f: R.range(420, 480), a: 0.25, d: 0.06 }, { f: R.range(1050, 1150), a: 0.18, d: 0.08 }, { f: R.range(2200, 2400), a: 0.1, d: 0.12 }], b, 0);
  const arc = grains(R, sr, 0.35, [[0, 1500], [1, 100]], { gmin: 0.0005, gmax: 0.002 });
  hp(arc, 2000, sr);
  mix(b, arc, 0.01 * sr, 0.6);
  // Generator: Grundton 12 → 52 Hz (sägezahnartig) und Turbinen-Heulen
  const prog = curve([[0, 0], [0.55, 1], [1, 1]], n), env = curve([[0, 0], [0.04, 0.5], [0.4, 1], [0.6, 0.8], [1, 0.25]], n);
  const f1 = new Float32Array(n), f2 = new Float32Array(n), mot = new Float32Array(n);
  for (let j = 0; j < n; j++) { f1[j] = 12 + 40 * prog[j]; f2[j] = 150 + 750 * prog[j]; }
  oscT(SAW8, sr, n, f1, env, mot, 0, 0.5);
  oscT(SINE, sr, n, f2, env, mot, 0, 0.12);
  lp(mot, 900, sr);
  mix(b, mot, 0, 0.8);
  // Vier Lichtbänke: Relais, Starter-Ticken, dann Brummen (100 Hz, eine Periode gekachelt)
  const per = sr / 100, one = new Float32Array(per);
  for (let k = 1; k < 30; k++) { const a = 1 / Math.pow(k, 0.9); for (let j = 0; j < per; j++) one[j] += sinT((k * j) / per) * a; }
  const hum = new Float32Array(n);
  for (let j = 0; j < n; j++) hum[j] = one[j % per];
  const level = new Float32Array(n);
  for (let k = 0; k < 4; k++) {
    const t = 1.0 + k * 0.55 + R.range(-0.05, 0.05);
    click(R, sr, b, t, R.range(1500, 3000), 0.6, 0.006);
    modes(sr, 0.1, [{ f: R.range(1800, 2600), a: 0.15, d: 0.015 }], b, t);
    for (let q = 0; q < 3; q++) click(R, sr, b, t + 0.05 + q * R.range(0.03, 0.08), R.range(4000, 6000), 0.15, 0.002);
    const t0 = Math.floor((t + 0.25) * sr);
    for (let j = t0; j < n; j++) {
      const age = (j - t0) / sr;
      const flick = age < 0.35 ? (Math.sin(age * 90 + k) > 0.2 ? 1 : 0.2) : 1;
      level[j] += 0.25 * flick * Math.min(1, age * 8);
    }
  }
  const fadeK = curve([[0, 1], [0.6, 1], [1, 0.4]], n);
  for (let j = 0; j < n; j++) hum[j] *= level[j] * fadeK[j];
  bp(hum, 1200, sr, 0.5);
  mix(b, hum, 0, 0.035);
  return finish(b, sr, { hpf: 25, fout: 0.8, peak: 0.9 });
}

// ── Ansager-Wucht: Rückwärts-Hall, Sub-Einschlag, dämonisches Brummen ──
function announcer(R, i, sr) {
  const b = secs(sr, 2.8), hit = 0.32;
  const rv = noise(R, sr, hit, (t) => Math.pow(t, 2.5));
  sweep(rv, sr, 'lp', [[0, 400], [1, 6000]], 0.8);
  mix(b, rv, 0, 0.5);
  modes(sr, 2.4, [{ f: 75, f2: 32, a: 1, d: 0.5, att: 0.01 }, { f: 48, a: 0.6, d: 0.9, att: 0.05 }], b, hit);
  thump(R, sr, b, hit, 300, 0.6, 0.4, 6);
  const g = voice(R, sr, {
    dur: 2.2, f0: [[0, 46], [0.5, 42], [1, 34]], amp: [[0, 0], [0.08, 1], [0.6, 0.6], [1, 0]],
    jitter: 0.04, shimmer: 0.2, sub: 0.6, fry: 0.2, oq: 0.5, vowels: [[0, 'o'], [0.6, 'u'], [1, 'ng']], tract: 0.68, bw: 1.3, asp: 0.15, gurgle: 0.2,
  });
  finish(g, sr, { drv: 2.5, lpf: 2500, hpf: 25, peak: 1 });
  mix(b, g, hit * sr, 0.45);
  const hb = noise(R, sr, 0.25, (t) => Math.exp(-t * 10));
  bp(hb, 1800, sr, 0.5);
  mix(b, hb, hit * sr, 0.25);
  return finish(b, sr, { hpf: 20, fout: 0.3, peak: 0.9 });
}

// ── Power-Ups ────────────────────────────────────────────────
// Einsammeln: aufsteigendes Glas-Arpeggio mit Flirren
function grabChime(R, i, sr) {
  const b = secs(sr, 1.6);
  [76, 81, 84, 88, 93].forEach((nn, k) => {
    const f = NOTE(nn);
    modes(sr, 1.4, [{ f, a: 0.3, d: 0.35 }, { f: f * 1.004, a: 0.2, d: 0.3 }, { f: f * 2.0, a: 0.1, d: 0.15 }, { f: f * 3.01, a: 0.05, d: 0.08 }], b, k * 0.045);
  });
  const sp = noise(R, sr, 1.0, (t, s) => Math.exp(-t * 3) * (0.5 + 0.5 * sinT(22 * s)));
  hp(sp, 6000, sr);
  mix(b, sp, 0, 0.12);
  modes(sr, 0.8, [{ f: 220, a: 0.15, d: 0.2, att: 0.02 }], b, 0);
  return finish(b, sr, { hpf: 100, fout: 0.2, peak: 0.85 });
}
// Erscheinen: magisches Plopp, zwei Töne, Luftzug
function spawnChime(R, i, sr) {
  const b = secs(sr, 1.1);
  modes(sr, 0.2, [{ f: 300, f2: 900, a: 0.4, d: 0.04 }], b, 0);
  const n1 = NOTE(81), n2 = NOTE(88);
  modes(sr, 1, [{ f: n1, a: 0.25, d: 0.25 }, { f: n1 * 2.01, a: 0.08, d: 0.12 }], b, 0.04);
  modes(sr, 1, [{ f: n2, a: 0.25, d: 0.35 }, { f: n2 * 2.01, a: 0.08, d: 0.15 }, { f: n2 * 1.005, a: 0.15, d: 0.3 }], b, 0.13);
  const w = noise(R, sr, 0.5, (t) => Math.sin(Math.PI * t) * Math.exp(-t * 2));
  sweep(w, sr, 'bp', [[0, 800], [1, 4000]], 1.5);
  mix(b, w, 0, 0.15);
  return finish(b, sr, { hpf: 100, fout: 0.15, peak: 0.85 });
}

// ── Nahtlose Schleifen ───────────────────────────────────────
// Rauschen, dessen Ende weich in den Anfang übergeht
function loopNoise(R, sr, len, xf) {
  const n = Math.floor(len * sr), x = Math.floor(xf * sr);
  const z = noise(R, sr, (n + x) / sr), out = new Float32Array(n);
  for (let j = 0; j < n; j++) out[j] = z[j];
  for (let j = 0; j < x; j++) { const k = j / x; out[j] = z[j] * Math.sqrt(k) + z[n + j] * Math.sqrt(1 - k); }
  return out;
}
// Summen eines Power-Ups (2 s, alle Frequenzen passen ganzzahlig hinein)
function powerupHum(R, i, sr) {
  const n = 2 * sr, b = new Float32Array(n);
  for (const [f, a] of [[110, 0.5], [110.5, 0.45], [220, 0.35], [221, 0.3], [330, 0.12], [331.5, 0.1], [440, 0.08], [880, 0.05], [1320.5, 0.03]]) {
    const inc = f / sr, ph = R();
    for (let j = 0; j < n; j++) b[j] += sinT(ph + inc * j) * a;
  }
  for (let j = 0; j < n; j++) { const t = j / sr; b[j] *= (0.75 + 0.25 * sinT(0.5 * t)) * (0.85 + 0.15 * sinT(4 * t)); }
  const nz = loopNoise(R, sr, 2, 0.25);
  bp(nz, 3000, sr, 0.7);
  normalize(b, 1);
  mix(b, nz, 0, 0.12);
  return normalize(b, 0.9);
}
// Elektrisches Brummen eines Automaten (1 s, 50-Hz-Netz; eine Periode, gekachelt)
function machineHum(R, i, sr) {
  const n = sr, per = sr / 50, one = new Float32Array(per), b = new Float32Array(n);
  const H = [[1, 0.2], [2, 1], [4, 0.5], [6, 0.4], [8, 0.2], [10, 0.15], [12, 0.12], [16, 0.06], [20, 0.05], [24, 0.04]];
  for (let k = 40; k < 120; k += 2) H.push([k, R.range(0.002, 0.012)]);
  for (const [k, a] of H) { const ph = R(); for (let j = 0; j < per; j++) one[j] += sinT(ph + (k * j) / per) * a; }
  for (let j = 0; j < n; j++) b[j] = one[j % per] * (0.9 + 0.1 * sinT(j / sr));
  return normalize(b, 0.9);
}

// ── Ambiente ─────────────────────────────────────────────────
function creakWood(R, i, sr) {
  const c = creak(R, sr, R.range(0.8, 1.6), {
    rate: [[0, R.range(20, 40)], [0.5, R.range(60, 120)], [1, R.range(25, 50)]], jit: 0.35,
    md: [[R.range(300, 400), 8], [R.range(700, 900), 10, 0.6], [R.range(1400, 1800), 12, 0.3]], amp: [[0, 0], [0.2, 1], [0.7, 0.8], [1, 0]],
  });
  return finish(c, sr, { hpf: 100, fout: 0.1 });
}
function creakMetal(R, i, sr) {
  const c = creak(R, sr, R.range(1.2, 2.2), {
    rate: [[0, R.range(80, 140)], [0.5, R.range(160, 260)], [1, R.range(90, 150)]], jit: 0.08,
    md: [[R.range(250, 320), 30], [R.range(610, 700), 40, 0.6], [R.range(1130, 1300), 45, 0.4], [R.range(2100, 2400), 50, 0.25]], amp: [[0, 0], [0.3, 1], [0.8, 0.7], [1, 0]],
  });
  return finish(c, sr, { hpf: 80, fout: 0.2, drv: 1.2 });
}
// Unverständliches Flüstern (zwei Stimmen)
function whisper(R, i, sr) {
  const dur = R.range(1.4, 2.4), b = secs(sr, dur);
  for (let L = 0; L < 2; L++) {
    const syl = Math.floor(dur * R.range(4, 6)), vw = [], amp = [[0, 0]];
    for (let k = 0; k < syl; k++) {
      vw.push([(k + 0.5) / syl, R.pick(['a', 'e', 'i', 'o', 'u', 'uh', 'er'])]);
      amp.push([(k + 0.05) / syl, R.range(0.1, 0.4)], [(k + 0.5) / syl, R.range(0.6, 1)]);
    }
    amp.push([1, 0]);
    const v = voice(R, sr, { dur, f0: 100, amp, vowels: vw, voiced: 0, asp: 0, breath: 1, tract: R.range(1.0, 1.2), bw: 1.2, fwob: 0.1 });
    normalize(v, 1);
    for (let k = 0; k < syl; k++) {
      if (R() < 0.35) {
        const s = noise(R, sr, R.range(0.06, 0.14), (t) => Math.sin(Math.PI * t));
        hp(s, R.pick([3500, 5000]), sr);
        mix(v, s, (k / syl) * dur * sr, 0.3);
      }
    }
    mix(b, v, L * R.range(0.05, 0.2) * sr, L ? 0.6 : 1);
  }
  return finish(b, sr, { hpf: 200, lpf: 7000, fout: 0.15 });
}
// Fernes Donnergrollen
function thunder(R, i, sr) {
  const dur = R.range(4.5, 7), n = Math.floor(dur * sr), b = new Float32Array(n), env = new Float32Array(n);
  const rolls = 3 + Math.floor(R() * 3);
  for (let k = 0; k < rolls; k++) {
    const t0 = R.range(0, 0.45) * dur * (k ? 1 : 0.15), a = R.range(0.4, 1), rise = R.range(0.12, 0.4), d = R.range(0.6, 2.2);
    for (let j = Math.floor(t0 * sr); j < n; j++) {
      const t = j / sr - t0;
      env[j] += a * (t < rise ? t / rise : Math.exp(-(t - rise) / d));
    }
  }
  let s = R.int(), z = 0;
  for (let j = 0; j < n; j++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; z = (z + 0.03 * (s | 0) * 4.656612873e-10) * 0.985; b[j] = z * env[j]; }
  lp(b, R.range(300, 600), sr);
  if (i === 0) { const cr = grains(R, sr, 0.6, [[0, 300], [1, 0]], { gmin: 0.001, gmax: 0.004 }); hp(cr, 1500, sr); normalize(b, 1); mix(b, cr, 0.05 * sr, 0.3); }
  return finish(b, sr, { hpf: 25, fout: 0.5 });
}

// ── Liste: Name, Varianten, Abtastrate, Funktion ─────────────
// Reihenfolge = Priorität beim Rendern (Runde 1 braucht Stöhnen zuerst)
export const RECIPES = [
  { name: 'groan', n: 8, sr: SRV, fn: groan },
  { name: 'attack', n: 8, sr: SRV, fn: attack },
  { name: 'death', n: 8, sr: SRV, fn: death },
  { name: 'stepWalk', n: 6, sr: SRF, fn: stepWalk },
  { name: 'stepRun', n: 4, sr: SRF, fn: stepRun },
  { name: 'swipe', n: 4, sr: SRF, fn: swipe },
  { name: 'purchase', n: 2, sr: SRF, fn: purchase },
  { name: 'deny', n: 1, sr: SRF, fn: deny },
  { name: 'drink', n: 2, sr: SRF, fn: drink },
  { name: 'scream', n: 8, sr: SRV, fn: scream },
  { name: 'headPop', n: 4, sr: SRF, fn: headPop },
  { name: 'gib', n: 4, sr: SRF, fn: gib },
  { name: 'crawler', n: 6, sr: SRV, fn: crawler },
  { name: 'boxOpen', n: 2, sr: SRF, fn: boxOpen },
  { name: 'teddy', n: 3, sr: SRV, fn: teddy },
  { name: 'boxWhoosh', n: 1, sr: SRF, fn: boxWhoosh },
  { name: 'announcer', n: 1, sr: SRF, fn: announcer },
  { name: 'grab', n: 1, sr: SRF, fn: grabChime },
  { name: 'spawn', n: 1, sr: SRF, fn: spawnChime },
  { name: 'puHum', n: 1, sr: SRF, fn: powerupHum },
  { name: 'mHum', n: 1, sr: SRF, fn: machineHum },
  { name: 'powerOn', n: 1, sr: SRF, fn: powerOn },
  { name: 'typeKey', n: 6, sr: SRF, fn: typeKey },
  { name: 'typeSpace', n: 2, sr: SRF, fn: typeSpace },
  { name: 'typeReturn', n: 1, sr: SRF, fn: typeReturn },
  { name: 'creakWood', n: 3, sr: SRF, fn: creakWood },
  { name: 'creakMetal', n: 2, sr: SRF, fn: creakMetal },
  { name: 'whisper', n: 3, sr: SRV, fn: whisper },
  { name: 'thunder', n: 3, sr: 16000, fn: thunder },
];

// ── Aufträge ─────────────────────────────────────────────────
// Fester Seed je Rezept und Variante (gleicher Klang in Worker und Hauptthread)
export function seedOf(name, i) {
  let h = 2166136261;
  for (let k = 0; k < name.length; k++) h = Math.imul(h ^ name.charCodeAt(k), 16777619);
  return ((h >>> 0) + i * 7919) >>> 0;
}
// Reihenfolge: erst je eine Variante pro Rezept, dann die übrigen
export function jobList() {
  const jobs = [], max = Math.max(...RECIPES.map((r) => r.n));
  for (let i = 0; i < max; i++) for (const r of RECIPES) if (i < r.n) jobs.push([r.name, i]);
  return jobs;
}
export function renderJob(name, i) {
  const r = RECIPES.find((x) => x.name === name);
  return { name, i, sr: r.sr, data: r.fn(rng(seedOf(name, i)), i, r.sr) };
}
