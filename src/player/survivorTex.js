// ─────────────────────────────────────────────────────────────
//  Überlebende: ein Textur-Atlas je Figur (Gesicht, Haare, Kleidung,
//  Haut, Schuhe, Zubehör) – alles prozedural auf Canvas gemalt, ohne
//  Pixel-Schleifen über den ganzen Atlas (schnell genug, um eine Figur
//  auch mitten in der Partie zu erzeugen).
//  Bereiche in Pixeln eines 1024er-Atlas: [x, y, Breite, Höhe], y nach unten.
//  Im Bereich: s waagerecht (um den Körper: 0 hinten, .25 links, .5 vorn,
//  .75 rechts), t senkrecht (0 = oben bzw. am körpernahen Gelenk).
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { ValueNoise, mulberry32 } from '../core/noise.js';
import { toTexture } from '../core/textures.js';
import { IS_MOBILE } from '../core/platform.js';

export const REG = {
  torso: [0, 0, 512, 512],
  head: [512, 0, 512, 384],
  hair: [512, 384, 256, 128],
  hair2: [768, 384, 256, 128],
  thigh: [0, 512, 256, 256],
  shin: [256, 512, 256, 256],
  armUL: [512, 512, 128, 256],
  armUR: [640, 512, 128, 256],
  armF: [768, 512, 128, 256],
  hand: [896, 512, 128, 128],
  sw: [896, 640, 128, 128],
  foot: [0, 768, 256, 128],
  shaft: [0, 896, 256, 128],
  extra: [256, 768, 512, 256],
  extra2: [768, 768, 256, 256],
};

// Höhenbereich des Rumpfs (Standardfigur, Meter): t = 0 am Hals, t = 1 im Schritt
export const TORSO = { y0: 0.79, y1: 1.56 };
// Längsbereich der Gliedmaßen-Röhren (Abstand vom körpernahen Gelenk, Meter)
export const LIMB = { upper: [-0.07, 0.32], fore: [-0.045, 0.29], thigh: [-0.06, 0.47], shin: [-0.04, 0.43] };
export const torsoT = (y) => (TORSO.y1 - y) / (TORSO.y1 - TORSO.y0);
export const limbT = (k, h) => (h - LIMB[k][0]) / (LIMB[k][1] - LIMB[k][0]);

// UV-Rechteck eines Bereichs [u0, v0, u1, v1] (1 px Rand gegen Ausbluten)
export function uvRect(name) {
  const [x, y, w, h] = REG[name];
  const e = 1.5;
  return [(x + e) / 1024, 1 - (y + h - e) / 1024, (x + w - e) / 1024, 1 - (y + e) / 1024];
}
// UV-Mitte eines Farbfelds (4 × 4 Felder à 32 px im Bereich 'sw')
export function swatchUV(i) {
  const [x, y] = REG.sw;
  return [(x + (i % 4) * 32 + 16) / 1024, 1 - (y + Math.floor(i / 4) * 32 + 16) / 1024];
}
// Kopf-Richtung (Blick nach -z) → (s, t) im Gesichtsbereich
export function headST(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  let a = Math.atan2(-x / l, z / l);
  if (a < 0) a += Math.PI * 2;
  return [a / (Math.PI * 2), Math.acos(Math.max(-1, Math.min(1, y / l))) / Math.PI];
}

const SIZE = IS_MOBILE ? 512 : 1024;

function cv(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Kachelbares Graustufen-Rauschen (für Stoffstruktur, Schmutz, Haut)
function noiseTile(seed, size, freq, oct, contrast = 1) {
  const n = new ValueNoise(seed);
  const c = cv(size), x = c.getContext('2d'), img = x.createImageData(size, size);
  for (let j = 0, i = 0; j < size; j++) {
    for (let k = 0; k < size; k++, i += 4) {
      const v = 128 + (n.fbm((k / size) * freq, (j / size) * freq, oct, freq) - 0.5) * 255 * contrast;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, v));
      img.data[i + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  return c;
}

const gray = (r) => { const v = Math.round(Math.max(0, Math.min(1, r)) * 255); return `rgb(${v},${v},${v})`; };
const hex2 = (h) => { const c = new THREE.Color(h); return [c.r * 255, c.g * 255, c.b * 255]; };
const rgba = (h, a) => { const [r, g, b] = hex2(h); return `rgba(${r | 0},${g | 0},${b | 0},${a})`; };
// Farbe aufhellen (+) oder abdunkeln (-)
const shade = (h, k) => {
  const [r, g, b] = hex2(h);
  const f = (v) => Math.max(0, Math.min(255, k >= 0 ? v + (255 - v) * k : v * (1 + k))) | 0;
  return `rgb(${f(r)},${f(g)},${f(b)})`;
};

// ── Maler ─────────────────────────────────────────────────────
class Painter {
  constructor(seed) {
    this.size = SIZE;
    this.k = SIZE / 1024;
    this.col = cv(SIZE); this.rgh = cv(SIZE);
    this.c = this.col.getContext('2d'); this.r = this.rgh.getContext('2d');
    this.rnd = mulberry32(seed);
    this.fine = noiseTile(seed, 128, 16, 3, 1.4);
    this.coarse = noiseTile(seed + 11, 128, 4, 4, 1.6);
    this.c.fillStyle = '#6b665e'; this.c.fillRect(0, 0, SIZE, SIZE);
    this.r.fillStyle = gray(0.85); this.r.fillRect(0, 0, SIZE, SIZE);
    this.pat = new Map();
  }

  // Bereich → Pixelrechteck (normierte Teilfläche)
  box(reg, s0 = 0, t0 = 0, s1 = 1, t1 = 1) {
    const [x, y, w, h] = REG[reg], k = this.k;
    return [(x + s0 * w) * k, (y + t0 * h) * k, (s1 - s0) * w * k, (t1 - t0) * h * k];
  }
  // Punkt im Bereich → Pixel
  pt(reg, s, t) { const [x, y, w, h] = REG[reg], k = this.k; return [(x + s * w) * k, (y + t * h) * k]; }
  // Maßstab: normierte Breite/Höhe → Pixel
  sx(reg, v) { return v * REG[reg][2] * this.k; }
  sy(reg, v) { return v * REG[reg][3] * this.k; }

  clip(reg, fn) {
    const b = this.box(reg);
    for (const ctx of [this.c, this.r]) { ctx.save(); ctx.beginPath(); ctx.rect(...b); ctx.clip(); }
    fn();
    this.c.restore(); this.r.restore();
  }

  fill(reg, color, rough = 0.85, s0 = 0, t0 = 0, s1 = 1, t1 = 1) {
    const b = this.box(reg, s0, t0, s1, t1);
    this.c.fillStyle = color; this.c.fillRect(...b);
    if (rough !== null) { this.r.fillStyle = gray(rough); this.r.fillRect(...b); }
  }

  // Rauschen über einen Bereich legen (multiply = dunkler, overlay = Kontrast, screen = heller)
  noise(reg, amt = 0.3, coarse = false, op = 'overlay', s0 = 0, t0 = 0, s1 = 1, t1 = 1, scale = 1) {
    const src = coarse ? this.coarse : this.fine;
    const key = (coarse ? 'c' : 'f') + scale;
    let p = this.pat.get(key);
    if (!p) {
      p = this.c.createPattern(src, 'repeat');
      p.setTransform(new DOMMatrix().scale(this.k * scale * 2, this.k * scale * 2));
      this.pat.set(key, p);
    }
    const b = this.box(reg, s0, t0, s1, t1);
    this.c.save();
    this.c.globalAlpha = amt; this.c.globalCompositeOperation = op;
    this.c.fillStyle = p; this.c.fillRect(...b);
    this.c.restore();
  }

  // Verlauf (senkrecht oder waagerecht) über eine Teilfläche
  grad(reg, stops, vertical = true, op = 'source-over', s0 = 0, t0 = 0, s1 = 1, t1 = 1) {
    const [x, y, w, h] = this.box(reg, s0, t0, s1, t1);
    const g = vertical ? this.c.createLinearGradient(0, y, 0, y + h) : this.c.createLinearGradient(x, 0, x + w, 0);
    for (const [o, col] of stops) g.addColorStop(o, col);
    this.c.save(); this.c.globalCompositeOperation = op;
    this.c.fillStyle = g; this.c.fillRect(x, y, w, h);
    this.c.restore();
  }

  // Weicher, elliptischer Fleck (Radien normiert im Bereich)
  blob(reg, s, t, rs, rt, color, alpha = 1, op = 'source-over', rough = null) {
    const [px, py] = this.pt(reg, s, t);
    const rx = Math.max(0.5, this.sx(reg, rs)), ry = Math.max(0.5, this.sy(reg, rt));
    for (const [ctx, col] of rough === null ? [[this.c, color]] : [[this.c, color], [this.r, gray(rough)]]) {
      ctx.save();
      ctx.globalCompositeOperation = ctx === this.c ? op : 'source-over';
      ctx.translate(px, py); ctx.scale(1, ry / rx);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      g.addColorStop(0, rgba(col, alpha)); g.addColorStop(0.55, rgba(col, alpha * 0.7)); g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  // Harte Ellipse
  ell(reg, s, t, rs, rt, color, rough = null, rot = 0) {
    const [px, py] = this.pt(reg, s, t);
    for (const [ctx, col] of rough === null ? [[this.c, color]] : [[this.c, color], [this.r, gray(rough)]]) {
      ctx.fillStyle = col; ctx.beginPath();
      ctx.ellipse(px, py, Math.max(0.4, this.sx(reg, rs)), Math.max(0.4, this.sy(reg, rt)), rot, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Linienzug (Punkte normiert), Breite in Atlas-Pixeln (1024er)
  line(reg, pts, color, width = 2, dash = null, alpha = 1, rough = null) {
    for (const [ctx, col] of rough === null ? [[this.c, color]] : [[this.c, color], [this.r, gray(rough)]]) {
      ctx.save();
      ctx.globalAlpha = alpha; ctx.strokeStyle = col; ctx.lineWidth = width * this.k; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (dash) ctx.setLineDash(dash.map((d) => d * this.k));
      ctx.beginPath();
      pts.forEach(([s, t], i) => { const [x, y] = this.pt(reg, s, t); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke();
      ctx.restore();
    }
  }

  // Wiederholte Streifen (Cord, Rippenstrick, Nadelstreifen) über eine Teilfläche
  stripes(reg, n, color, width, alpha = 1, vertical = true, s0 = 0, t0 = 0, s1 = 1, t1 = 1, op = 'source-over') {
    const [x, y, w, h] = this.box(reg, s0, t0, s1, t1);
    this.c.save();
    this.c.globalAlpha = alpha; this.c.globalCompositeOperation = op; this.c.fillStyle = color;
    for (let i = 0; i < n; i++) {
      if (vertical) this.c.fillRect(x + (i + 0.5) * (w / n) - (width * this.k) / 2, y, width * this.k, h);
      else this.c.fillRect(x, y + (i + 0.5) * (h / n) - (width * this.k) / 2, w, width * this.k);
    }
    this.c.restore();
  }

  // Karomuster (Flanell): zwei Streifenscharen in mehreren Farben
  plaid(reg, base, bands, cells = 8, s0 = 0, t0 = 0, s1 = 1, t1 = 1) {
    this.fill(reg, base, 0.92, s0, t0, s1, t1);
    for (const [col, wid, off, a] of bands) {
      for (const v of [true, false]) {
        const [x, y, w, h] = this.box(reg, s0, t0, s1, t1);
        const n = v ? cells : Math.round(cells * (h / w));
        const step = (v ? w : h) / n;
        this.c.save(); this.c.globalAlpha = a; this.c.fillStyle = col; this.c.globalCompositeOperation = 'multiply';
        for (let i = 0; i < n; i++) {
          if (v) this.c.fillRect(x + i * step + off * step, y, wid * step, h);
          else this.c.fillRect(x, y + i * step + off * step, w, wid * step);
        }
        this.c.restore();
      }
    }
  }

  // Naht (gestrichelt, hell oder dunkel)
  seam(reg, pts, color = 'rgba(0,0,0,0.5)', width = 1.6) { this.line(reg, pts, color, width, [5, 4]); }

  // Weiche Schmutz-/Fettflecken
  stains(reg, n, color, size = 0.06, alpha = 0.35, s0 = 0, t0 = 0, s1 = 1, t1 = 1) {
    for (let i = 0; i < n; i++) {
      const s = s0 + this.rnd() * (s1 - s0), t = t0 + this.rnd() * (t1 - t0), r = size * (0.5 + this.rnd());
      this.blob(reg, s, t, r, r * (0.6 + this.rnd() * 0.8), color, alpha * (0.6 + this.rnd() * 0.4), 'multiply');
    }
  }

  // Farbfeld (Zubehör): Farbe + Rauheit
  swatch(i, color, rough = 0.6) {
    const [x, y] = REG.sw, k = this.k;
    const px = (x + (i % 4) * 32) * k, py = (y + Math.floor(i / 4) * 32) * k;
    this.c.fillStyle = color; this.c.fillRect(px, py, 32 * k, 32 * k);
    this.r.fillStyle = gray(rough); this.r.fillRect(px, py, 32 * k, 32 * k);
  }

  textures() {
    const map = toTexture(this.col, { repeat: false });
    const rough = toTexture(this.rgh, { srgb: false, repeat: false });
    for (const t of [map, rough]) { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; }
    return { map, rough };
  }
}

// ── Gesicht ───────────────────────────────────────────────────
// Winkel vom Gesichtsmittelpunkt (ax: + = rechts der Figur, ay: + = oben) → (s, t)
function fst(ax, ay) {
  const x = Math.sin(ax) * Math.cos(ay), y = Math.sin(ay), z = -Math.cos(ax) * Math.cos(ay);
  return headST(x, y, z);
}
// Winkelmaß → normierte Bereichsgröße (waagerecht 2π, senkrecht π)
const AS = (a) => a / (Math.PI * 2), AT = (a) => a / Math.PI;

function paintFace(P, o) {
  const R = 'head';
  const skin = o.skin;
  P.fill(R, skin, 0.62);
  P.noise(R, 0.18, false, 'overlay');
  P.noise(R, 0.12, true, 'overlay');
  // Schatten: Hals/Kinnunterseite dunkler, Scheitel heller
  P.grad(R, [[0, 'rgba(255,240,225,0.10)'], [0.55, 'rgba(0,0,0,0)'], [0.8, 'rgba(70,35,25,0.12)'], [1, 'rgba(40,20,15,0.45)']], true, 'source-over');
  const both = (fn) => { fn(1); fn(-1); };
  // Wangen, Nase, Ohren (leicht gerötet)
  both((sd) => { const [s, t] = fst(sd * 0.55, -0.22); P.blob(R, s, t, AS(0.28), AT(0.2), o.blush || '#c06a5a', o.blushA ?? 0.22, 'multiply'); });
  { const [s, t] = fst(0, -0.14); P.blob(R, s, t, AS(0.12), AT(0.12), '#c0705f', 0.22, 'multiply'); }
  both((sd) => { const [s, t] = fst(sd * 1.57, 0.0); P.blob(R, s, t, AS(0.2), AT(0.24), '#b0604f', 0.3, 'multiply'); });
  // Nasenflügel-Schatten und Nasenlöcher
  both((sd) => { const [s, t] = fst(sd * 0.1, -0.1); P.blob(R, s, t, AS(0.05), AT(0.16), '#5a3428', 0.28, 'multiply'); });
  both((sd) => { const [s, t] = fst(sd * 0.055, -0.235); P.ell(R, s, t, AS(0.026), AT(0.016), 'rgba(55,25,20,0.75)'); });
  // Augenhöhlen-Schatten
  both((sd) => { const [s, t] = fst(sd * 0.37, 0.12); P.blob(R, s, t, AS(0.24), AT(0.13), o.socket || '#6a4a40', 0.32, 'multiply'); });
  // Augen: Weiß, Iris, Pupille, Oberlid
  both((sd) => {
    const [s, t] = fst(sd * 0.37, 0.115);
    P.ell(R, s, t, AS(0.11), AT(0.045), '#d9d0c4', 0.3);
    P.ell(R, s + AS(0.01) * sd * 0, t, AS(0.05), AT(0.045), o.iris || '#4a3626', 0.2);
    P.ell(R, s, t, AS(0.022), AT(0.022), '#0d0a08', 0.15);
    P.ell(R, s - AS(0.02), t - AT(0.015), AS(0.012), AT(0.01), 'rgba(255,255,255,0.8)');
    const lid = o.lid || '#2a1a14';
    P.line(R, [fst(sd * 0.25, 0.13), fst(sd * 0.33, 0.165), fst(sd * 0.42, 0.165), fst(sd * 0.49, 0.125)], lid, o.female ? 3.2 : 2.4);
    P.line(R, [fst(sd * 0.27, 0.095), fst(sd * 0.37, 0.075), fst(sd * 0.47, 0.095)], 'rgba(80,45,35,0.45)', 1.5);
    if (o.bags) P.line(R, [fst(sd * 0.27, 0.06), fst(sd * 0.37, 0.035), fst(sd * 0.47, 0.06)], 'rgba(90,50,40,0.35)', 2);
  });
  // Augenbrauen
  both((sd) => {
    const b = o.brow;
    const pts = [fst(sd * 0.21, 0.22 + b.arch * 0.2), fst(sd * 0.36, 0.26 + b.arch), fst(sd * 0.52, 0.22)];
    P.line(R, pts, b.color, b.w, null, 0.95);
    if (b.bushy) for (let i = 0; i < 14; i++) {
      const k = i / 13, ax = sd * (0.2 + k * 0.33), ay = 0.23 + Math.sin(k * Math.PI) * 0.035;
      P.line(R, [fst(ax, ay - 0.02), fst(ax + sd * 0.03, ay + 0.035)], b.color, 1.6, null, 0.8);
    }
  });
  // Mund
  {
    const L = o.lips || '#9a5a4c';
    P.line(R, [fst(-0.17, -0.425), fst(-0.08, -0.43), fst(0, -0.425), fst(0.08, -0.43), fst(0.17, -0.425)], 'rgba(60,25,20,0.85)', 1.8);
    P.blob(R, ...fst(0, -0.46), AS(0.13), AT(0.03), L, 0.75);
    P.blob(R, ...fst(0, -0.405), AS(0.11), AT(0.02), L, 0.5);
    P.blob(R, ...fst(0, -0.53), AS(0.12), AT(0.04), '#6a3a30', 0.2, 'multiply');
  }
  // Alter: Stirnfalten, Krähenfüße, Nasolabialfalten
  if (o.age > 0) {
    const a = o.age;
    for (let i = 0; i < 3; i++) P.line(R, [fst(-0.3, 0.42 + i * 0.07), fst(0, 0.44 + i * 0.07), fst(0.3, 0.42 + i * 0.07)], 'rgba(90,50,40,1)', 1.5, null, 0.35 * a);
    both((sd) => {
      for (let i = 0; i < 3; i++) P.line(R, [fst(sd * 0.5, 0.14 + (i - 1) * 0.05), fst(sd * 0.6, 0.12 + (i - 1) * 0.08)], 'rgba(90,50,40,1)', 1.3, null, 0.45 * a);
      P.line(R, [fst(sd * 0.13, -0.22), fst(sd * 0.2, -0.35), fst(sd * 0.21, -0.45)], 'rgba(90,45,35,1)', 2, null, 0.4 * a);
    });
  }
  // Bartschatten / Bartgrund
  if (o.stubble) {
    const [s, t] = fst(0, -0.6);
    P.blob(R, s, t, AS(0.7), AT(0.32), o.stubble, o.stubbleA ?? 0.35, 'multiply');
    P.noise(R, 0.25, false, 'multiply', s - AS(0.6), t - AT(0.25), s + AS(0.6), t + AT(0.3));
  }
  // Sommersprossen
  if (o.freckles) {
    for (let i = 0; i < o.freckles; i++) {
      const ax = (P.rnd() - 0.5) * 0.9, ay = -0.05 - P.rnd() * 0.25;
      P.ell(R, ...fst(ax, ay), AS(0.012), AT(0.008), 'rgba(140,70,40,0.45)');
    }
  }
  // Haaransatz/Nacken: Grundfarbe der Haare (falls die Haarkappe Lücken lässt)
  if (o.hair) {
    P.grad(R, [[0, o.hair], [o.hairline || 0.24, o.hair], [(o.hairline || 0.24) + 0.05, rgba(o.hair, 0)]], true, 'source-over', 0, 0, 0.32, 1);
    P.grad(R, [[0, o.hair], [o.hairline || 0.24, o.hair], [(o.hairline || 0.24) + 0.05, rgba(o.hair, 0)]], true, 'source-over', 0.68, 0, 1, 1);
    P.grad(R, [[0, o.hair], [Math.max(0.05, (o.hairline || 0.24) - 0.1), o.hair], [o.hairline || 0.24, rgba(o.hair, 0)]], true, 'source-over', 0.32, 0, 0.68, 1);
  }
}

// Haare: Grundton + Strähnen in Wuchsrichtung (t = vom Scheitel nach unten)
function paintHair(P, reg, base, dark, light, n = 120, curly = false) {
  P.fill(reg, base, 0.78);
  P.noise(reg, 0.35, true, 'overlay');
  for (let i = 0; i < n; i++) {
    const s = P.rnd(), len = 0.25 + P.rnd() * 0.6, t0 = P.rnd() * 0.5;
    const col = P.rnd() < 0.55 ? dark : light;
    if (curly) {
      const pts = [];
      for (let k = 0; k <= 6; k++) pts.push([s + Math.sin(k * 1.9 + i) * 0.012, t0 + (k / 6) * len * 0.5]);
      P.line(reg, pts, col, 2.2, null, 0.55);
    } else P.line(reg, [[s, t0], [s + (P.rnd() - 0.5) * 0.03, t0 + len]], col, 1.6 + P.rnd() * 1.6, null, 0.5);
  }
}

// Haut für Arme/Hände
function paintSkin(P, reg, skin, s0 = 0, t0 = 0, s1 = 1, t1 = 1, hair = null) {
  P.fill(reg, skin, 0.6, s0, t0, s1, t1);
  P.noise(reg, 0.16, false, 'overlay', s0, t0, s1, t1);
  P.noise(reg, 0.12, true, 'overlay', s0, t0, s1, t1);
  if (hair) for (let i = 0; i < 40; i++) {
    const s = s0 + P.rnd() * (s1 - s0), t = t0 + P.rnd() * (t1 - t0);
    P.line(reg, [[s, t], [s + 0.01, t + 0.02]], hair, 1, null, 0.35);
  }
}

// Stoff: Grundfarbe, Struktur, Abnutzung
function cloth(P, reg, color, rough = 0.9, s0 = 0, t0 = 0, s1 = 1, t1 = 1, weave = 'plain') {
  P.fill(reg, color, rough, s0, t0, s1, t1);
  if (weave === 'cord') P.stripes(reg, Math.round((s1 - s0) * 70), 'rgba(0,0,0,0.28)', 1.6, 1, true, s0, t0, s1, t1);
  if (weave === 'knit') P.stripes(reg, Math.round((s1 - s0) * 50), 'rgba(0,0,0,0.3)', 2.2, 1, true, s0, t0, s1, t1);
  if (weave === 'denim') {
    const [x, y, w, h] = P.box(reg, s0, t0, s1, t1);
    P.c.save(); P.c.beginPath(); P.c.rect(x, y, w, h); P.c.clip();
    P.c.strokeStyle = 'rgba(255,255,255,0.08)'; P.c.lineWidth = 1.2 * P.k;
    for (let i = -h; i < w; i += 4 * P.k) { P.c.beginPath(); P.c.moveTo(x + i, y); P.c.lineTo(x + i + h, y + h); P.c.stroke(); }
    P.c.restore();
  }
  P.noise(reg, 0.22, false, 'overlay', s0, t0, s1, t1);
  P.noise(reg, 0.2, true, 'overlay', s0, t0, s1, t1);
}

// ── Figuren ───────────────────────────────────────────────────
// Hanne Brückner – Kfz-Mechanikerin: Blaumann, aufgekrempelte Ärmel,
// Schweißerbrille auf der Stirn, rotbrauner Pferdeschwanz, rotes Putztuch
function paintHanne(P) {
  const blue = '#2f4a78', blueD = '#1d2f50', blueL = '#5a76a4', skin = '#d9a787', hair = '#7a3a1c';
  // Rumpf: Overall
  cloth(P, 'torso', blue, 0.88);
  P.stains(P, 0, '#000'); // (Platzhalter für gleiche Zufallsfolge)
  P.stains('torso', 14, '#1a1410', 0.05, 0.4, 0, 0.1, 1, 1);
  // T-Shirt-Kragen und Overall-Kragen
  P.fill('torso', '#d8d4cc', 0.9, 0.38, 0, 0.62, 0.07);
  P.fill('torso', blueD, 0.85, 0, 0.04, 1, 0.1);
  P.fill('torso', '#d8d4cc', 0.9, 0.45, 0.04, 0.55, 0.16);
  // Knopfleiste vorne, Brusttasche links, Namensschild rechts
  P.fill('torso', blueD, 0.85, 0.49, 0.1, 0.51, 0.95);
  for (let i = 0; i < 7; i++) P.ell('torso', 0.5, 0.17 + i * 0.1, 0.006, 0.006, '#c9c2b0', 0.4);
  P.fill('torso', shade(blue, -0.15), 0.85, 0.37, 0.22, 0.46, 0.33);
  P.seam('torso', [[0.37, 0.22], [0.46, 0.22], [0.46, 0.33], [0.37, 0.33], [0.37, 0.22]], 'rgba(220,200,150,0.5)');
  P.ell('torso', 0.585, 0.25, 0.035, 0.028, '#e8e2d2', 0.6);
  P.line('torso', [[0.565, 0.25], [0.605, 0.25]], '#b0281f', 2.2);
  // Taillennaht mit Gürtelschlaufen, Hüfttaschen, Gesäßtaschen
  P.fill('torso', blueD, 0.85, 0, 0.6, 1, 0.635);
  for (const s of [0.1, 0.3, 0.42, 0.58, 0.7, 0.9]) P.fill('torso', blueD, 0.85, s - 0.006, 0.59, s + 0.006, 0.65);
  for (const s of [0.33, 0.67]) P.line('torso', [[s - 0.04, 0.66], [s + 0.02, 0.74]], 'rgba(0,0,0,0.5)', 2);
  for (const s of [0.07, 0.93]) { P.fill('torso', shade(blue, -0.1), 0.85, s - 0.05, 0.72, s + 0.05, 0.88); P.seam('torso', [[s - 0.05, 0.72], [s + 0.05, 0.72]], 'rgba(220,200,150,0.5)'); }
  P.seam('torso', [[0.2, 0.1], [0.2, 0.6]], 'rgba(220,200,150,0.35)');
  P.seam('torso', [[0.8, 0.1], [0.8, 0.6]], 'rgba(220,200,150,0.35)');
  P.stains('torso', 10, '#0d0b09', 0.035, 0.55, 0.3, 0.5, 0.7, 0.9);
  P.grad('torso', [[0, 'rgba(0,0,0,0.25)'], [0.15, 'rgba(0,0,0,0)'], [0.9, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.3)']]);
  // Arme: Overall bis zum Ellbogen, Ärmel aufgekrempelt, Unterarme nackt mit Öl
  for (const reg of ['armUL', 'armUR']) {
    cloth(P, reg, blue, 0.88, 0, 0, 1, 0.8);
    P.fill(reg, blueL, 0.9, 0, 0.8, 1, 1);
    P.stripes(reg, 3, 'rgba(0,0,0,0.35)', 2.5, 1, false, 0, 0.8, 1, 1);
    P.stains(reg, 4, '#0d0b09', 0.08, 0.4);
  }
  P.fill('armUL', '#d8d8d8', 0.5, 0, 0.42, 1, 0.56); // Reflexband (Spielerfarbe)
  paintSkin(P, 'armF', skin);
  P.fill('armF', blueL, 0.9, 0, 0, 1, 0.13);
  P.stripes('armF', 2, 'rgba(0,0,0,0.35)', 2.5, 1, false, 0, 0, 1, 0.13);
  P.stains('armF', 9, '#1c140e', 0.06, 0.45, 0, 0.3, 1, 1);
  paintSkin(P, 'hand', skin);
  P.stains('hand', 10, '#1c140e', 0.12, 0.5);
  // Beine: Overall, Kniebesatz, Ölflecken
  cloth(P, 'thigh', blue, 0.88);
  P.stains('thigh', 8, '#0d0b09', 0.06, 0.45);
  P.seam('thigh', [[0.25, 0], [0.25, 1]], 'rgba(220,200,150,0.35)');
  P.seam('thigh', [[0.75, 0], [0.75, 1]], 'rgba(220,200,150,0.35)');
  P.fill('thigh', shade(blue, -0.1), 0.85, 0.66, 0.25, 0.8, 0.5);
  cloth(P, 'shin', blue, 0.88);
  P.fill('shin', shade(blue, -0.2), 0.85, 0.35, 0.0, 0.65, 0.28);
  P.stains('shin', 8, '#0d0b09', 0.06, 0.5);
  P.grad('shin', [[0, 'rgba(0,0,0,0)'], [0.75, 'rgba(0,0,0,0)'], [1, 'rgba(40,30,20,0.6)']]);
  P.fill('shin', blueD, 0.85, 0, 0.9, 1, 1);
  // Arbeitsstiefel
  P.fill('foot', '#2a1d14', 0.55);
  P.noise('foot', 0.3, true, 'overlay');
  P.fill('foot', '#111', 0.8, 0, 0.82, 1, 1);
  P.stains('foot', 8, '#7a6a55', 0.08, 0.25);
  for (let i = 0; i < 5; i++) P.line('foot', [[0.42, 0.15 + i * 0.1], [0.58, 0.2 + i * 0.1]], '#c9b48a', 2);
  P.fill('shaft', '#2a1d14', 0.55);
  // Kopf
  paintFace(P, { skin, iris: '#3d5a3a', brow: { color: '#5a2a14', w: 3.4, arch: 0.03 }, lips: '#a5544a', female: true, freckles: 26, hair, hairline: 0.22, blushA: 0.28 });
  paintHair(P, 'hair', hair, '#4a200c', '#a0552a', 140);
  paintHair(P, 'hair2', hair, '#4a200c', '#a0552a', 90);
  // Schweißerbrille: Gurt, Messingfassung, grünes Glas; Haargummi; Putztuch
  P.swatch(0, '#141414', 0.7);
  P.swatch(1, '#8a6a30', 0.35);
  P.swatch(2, '#13302a', 0.12);
  P.swatch(3, '#1a1a1a', 0.6);
  P.swatch(4, '#9c2018', 0.9);
  P.swatch(5, '#d8d8d8', 0.5);
}

// Willi Strobel – Bergmann a. D. und Nebenerwerbsbauer: Schiebermütze,
// grauer Vollbart, Cordjoppe über Karohemd, Gummistiefel
function paintWilli(P) {
  const cord = '#5c4329', cordD = '#3b2a19', skin = '#c99178', grey = '#9b978e';
  cloth(P, 'torso', cord, 0.92, 0, 0, 1, 1, 'cord');
  P.noise('torso', 0.2, true, 'multiply');
  // Karohemd im V-Ausschnitt
  P.c.save();
  {
    const [x0, y0] = P.pt('torso', 0.38, 0.0), [x1, y1] = P.pt('torso', 0.62, 0.0), [xm, ym] = P.pt('torso', 0.5, 0.62);
    P.c.beginPath(); P.c.moveTo(x0, y0); P.c.lineTo(x1, y1); P.c.lineTo(xm + 8 * P.k, ym); P.c.lineTo(xm - 8 * P.k, ym); P.c.closePath(); P.c.clip();
    P.plaid('torso', '#8a2a1e', [['#2a1a14', 0.35, 0, 0.8], ['#c9a46a', 0.08, 0.6, 0.6], ['#1a2a3a', 0.15, 0.3, 0.5]], 30, 0.36, 0, 0.64, 0.66);
  }
  P.c.restore();
  // Joppen-Kanten mit Knöpfen, Taschen, Saum
  P.line('torso', [[0.385, 0.0], [0.485, 0.62], [0.485, 0.86]], cordD, 4);
  P.line('torso', [[0.615, 0.0], [0.515, 0.62], [0.515, 0.86]], cordD, 4);
  for (let i = 0; i < 3; i++) P.ell('torso', 0.53, 0.5 + i * 0.12, 0.008, 0.008, '#2a1d12', 0.4);
  for (const s of [0.33, 0.67]) {
    P.fill('torso', shade(cord, -0.12), 0.92, s - 0.06, 0.6, s + 0.06, 0.78);
    P.fill('torso', cordD, 0.92, s - 0.065, 0.6, s + 0.065, 0.63);
    P.seam('torso', [[s - 0.06, 0.64], [s - 0.06, 0.78], [s + 0.06, 0.78], [s + 0.06, 0.64]], 'rgba(230,210,170,0.35)');
  }
  P.fill('torso', cordD, 0.92, 0, 0.84, 1, 0.87);
  cloth(P, 'torso', '#34332f', 0.9, 0, 0.87, 1, 1);
  P.stains('torso', 10, '#2a2218', 0.06, 0.35, 0, 0.2, 1, 0.85);
  P.grad('torso', [[0, 'rgba(0,0,0,0.2)'], [0.2, 'rgba(0,0,0,0)'], [0.8, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.3)']]);
  // Ärmel: Cord mit Lederflicken am Ellbogen, Bündchen
  for (const reg of ['armUL', 'armUR']) {
    cloth(P, reg, cord, 0.92, 0, 0, 1, 1, 'cord');
    P.ell(reg, 0.0, 0.9, 0.12, 0.1, '#3a2614', 0.6);
    P.ell(reg, 1.0, 0.9, 0.12, 0.1, '#3a2614', 0.6);
  }
  P.fill('armUL', '#d8d8d8', 0.5, 0, 0.42, 1, 0.56);
  cloth(P, 'armF', cord, 0.92, 0, 0, 1, 1, 'cord');
  P.ell('armF', 0.0, 0.08, 0.12, 0.08, '#3a2614', 0.6);
  P.ell('armF', 1.0, 0.08, 0.12, 0.08, '#3a2614', 0.6);
  P.fill('armF', cordD, 0.92, 0, 0.84, 1, 0.92);
  P.plaid('armF', '#8a2a1e', [['#2a1a14', 0.35, 0, 0.8]], 6, 0, 0.92, 1, 1);
  paintSkin(P, 'hand', skin);
  P.blob('hand', 0.5, 0.5, 0.5, 0.5, '#b0604a', 0.25, 'multiply');
  // Arbeitshose, Gummistiefel
  cloth(P, 'thigh', '#34332f', 0.9);
  P.fill('thigh', shade('#34332f', 0.12), 0.9, 0.62, 0.45, 0.82, 0.75);
  P.stains('thigh', 8, '#4a3a28', 0.07, 0.3);
  cloth(P, 'shin', '#34332f', 0.9);
  P.stains('shin', 10, '#4a3a28', 0.08, 0.35);
  const rubber = '#2f4128';
  P.fill('foot', rubber, 0.38);
  P.noise('foot', 0.2, true, 'overlay');
  P.fill('foot', '#191c15', 0.6, 0, 0.8, 1, 1);
  P.stains('foot', 12, '#4a3a22', 0.1, 0.55, 0, 0.4, 1, 1);
  P.fill('shaft', rubber, 0.38);
  P.noise('shaft', 0.2, true, 'overlay');
  P.fill('shaft', shade(rubber, -0.3), 0.4, 0, 0, 1, 0.1);
  P.stains('shaft', 10, '#4a3a22', 0.09, 0.5, 0, 0.6, 1, 1);
  // Kopf
  paintFace(P, { skin, iris: '#4a6a80', brow: { color: '#d0ccc4', w: 5.5, arch: 0.02, bushy: true }, lips: '#8a4a42', age: 1, bags: true, stubble: '#9a958c', stubbleA: 0.55, hair: grey, hairline: 0.2, blush: '#c05040', blushA: 0.35 });
  paintHair(P, 'hair', grey, '#6a665e', '#d8d4cc', 120);
  // Bart: grau-weiß mit Strähnen
  paintHair(P, 'hair2', '#b5b0a6', '#77736b', '#e5e1d8', 160, true);
  // Mütze (Fischgrat), Halstuch
  P.fill('extra2', '#4b4640', 0.95);
  for (let i = 0; i < 30; i++) {
    const t = i / 30;
    P.line('extra2', [[0, t], [1, t]], i % 2 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.18)', 3);
  }
  P.noise('extra2', 0.3, false, 'overlay');
  P.swatch(0, '#2a2622', 0.9);
  P.swatch(1, '#8a2418', 0.9);
  P.swatch(2, '#3b2a19', 0.9);
  P.swatch(5, '#d8d8d8', 0.5);
  cloth(P, 'extra', cord, 0.92, 0, 0, 1, 1, 'cord');
}

// Dr. Konrad Albers – Landtierarzt: langer, fleckiger Kittel, hellblaues
// Hemd mit Krawatte, Nickelbrille, zurückgekämmtes Haar mit grauen Schläfen
function paintAlbers(P) {
  const coat = '#d6d1c3', coatD = '#a9a393', skin = '#dcb09a', hair = '#2e2620';
  cloth(P, 'torso', coat, 0.85);
  // Hemd + Krawatte im V
  P.c.save();
  {
    const [x0, y0] = P.pt('torso', 0.4, 0.0), [x1, y1] = P.pt('torso', 0.6, 0.0), [xm, ym] = P.pt('torso', 0.5, 0.55);
    P.c.beginPath(); P.c.moveTo(x0, y0); P.c.lineTo(x1, y1); P.c.lineTo(xm, ym); P.c.closePath(); P.c.clip();
    cloth(P, 'torso', '#90a9c2', 0.8, 0.38, 0, 0.62, 0.6);
    P.fill('torso', '#5a1a20', 0.6, 0.485, 0.04, 0.515, 0.6);
    P.stripes('torso', 1, 'rgba(255,220,180,0.25)', 3, 1, false, 0.485, 0.15, 0.515, 0.25);
    P.ell('torso', 0.5, 0.06, 0.018, 0.02, '#4a141a', 0.6);
  }
  P.c.restore();
  // Revers-Kanten, Knöpfe, Brusttasche mit Stiften, Stethoskop
  P.line('torso', [[0.395, 0.0], [0.495, 0.56], [0.495, 1]], coatD, 3);
  P.line('torso', [[0.605, 0.0], [0.505, 0.56], [0.505, 1]], coatD, 3);
  for (let i = 0; i < 3; i++) P.ell('torso', 0.52, 0.6 + i * 0.12, 0.007, 0.007, '#8a8478', 0.4);
  P.seam('torso', [[0.36, 0.28], [0.44, 0.28], [0.44, 0.4], [0.36, 0.4], [0.36, 0.28]], 'rgba(0,0,0,0.3)');
  P.fill('torso', '#1a3a8a', 0.4, 0.375, 0.24, 0.382, 0.3);
  P.fill('torso', '#a01818', 0.4, 0.39, 0.25, 0.397, 0.3);
  P.line('torso', [[0.42, 0.0], [0.43, 0.1], [0.44, 0.3]], '#1e1e1e', 4, null, 1, 0.4);
  P.line('torso', [[0.58, 0.0], [0.57, 0.1], [0.56, 0.24], [0.55, 0.32]], '#1e1e1e', 4, null, 1, 0.4);
  P.ell('torso', 0.548, 0.34, 0.013, 0.014, '#b8b8b8', 0.25);
  // Flecken: Jod, Erde, Tierisches
  P.stains('torso', 14, '#8a6a3a', 0.05, 0.35, 0.25, 0.3, 0.75, 1);
  P.stains('torso', 6, '#6a4a2a', 0.03, 0.45, 0.3, 0.5, 0.7, 1);
  P.stains('torso', 5, '#a07a2a', 0.04, 0.35, 0, 0.2, 1, 0.9);
  P.grad('torso', [[0, 'rgba(0,0,0,0.12)'], [0.2, 'rgba(0,0,0,0)'], [0.85, 'rgba(0,0,0,0)'], [1, 'rgba(60,50,30,0.3)']]);
  // Kittelschoß (unterer Mantel)
  cloth(P, 'extra', coat, 0.85);
  P.stains('extra', 20, '#8a6a3a', 0.04, 0.35, 0, 0.2, 1, 1);
  P.stains('extra', 8, '#5a4428', 0.03, 0.4, 0, 0.5, 1, 1);
  P.grad('extra', [[0, 'rgba(0,0,0,0)'], [0.7, 'rgba(0,0,0,0)'], [1, 'rgba(80,60,30,0.45)']]);
  for (const s of [0.18, 0.82]) { P.seam('extra', [[s - 0.07, 0.08], [s + 0.07, 0.08], [s + 0.07, 0.3], [s - 0.07, 0.3], [s - 0.07, 0.08]], 'rgba(0,0,0,0.3)'); }
  P.seam('extra', [[0.5, 0], [0.5, 1]], 'rgba(0,0,0,0.25)');
  // Ärmel weiß, Hemdmanschette am Handgelenk
  for (const reg of ['armUL', 'armUR']) { cloth(P, reg, coat, 0.85); P.stains(reg, 4, '#8a6a3a', 0.08, 0.3); }
  P.fill('armUL', '#d8d8d8', 0.5, 0, 0.42, 1, 0.56);
  cloth(P, 'armF', coat, 0.85, 0, 0, 1, 0.86);
  P.stains('armF', 6, '#7a5a30', 0.08, 0.35, 0, 0.4, 1, 0.86);
  P.fill('armF', coatD, 0.85, 0, 0.8, 1, 0.86);
  cloth(P, 'armF', '#90a9c2', 0.8, 0, 0.86, 1, 1);
  paintSkin(P, 'hand', skin, 0, 0, 1, 1, '#4a3a30');
  // Hose (Flanell braun-grau), Halbschuhe
  cloth(P, 'thigh', '#5a4c3e', 0.88);
  P.line('thigh', [[0.5, 0], [0.5, 1]], 'rgba(0,0,0,0.25)', 2);
  cloth(P, 'shin', '#5a4c3e', 0.88);
  P.line('shin', [[0.5, 0], [0.5, 1]], 'rgba(0,0,0,0.25)', 2);
  P.grad('shin', [[0, 'rgba(0,0,0,0)'], [0.8, 'rgba(0,0,0,0)'], [1, 'rgba(60,45,30,0.5)']]);
  P.fill('foot', '#3a2214', 0.35);
  P.noise('foot', 0.25, true, 'overlay');
  P.fill('foot', '#120c08', 0.6, 0, 0.82, 1, 1);
  P.fill('shaft', '#5a4c3e', 0.88);
  // Kopf
  paintFace(P, { skin, iris: '#5a6a72', brow: { color: '#2a221c', w: 3.2, arch: 0.04 }, lips: '#9a5e52', age: 0.55, stubble: '#5a4a40', stubbleA: 0.18, hair, hairline: 0.16 });
  // Schnurrbart (schmal)
  P.line('head', [fst(-0.15, -0.36), fst(-0.05, -0.335), fst(0, -0.34), fst(0.05, -0.335), fst(0.15, -0.36)], '#2a221c', 6, null, 0.9);
  paintHair(P, 'hair', hair, '#15100c', '#4a4038', 160);
  // graue Schläfen (Seiten der Haarkappe)
  for (const s of [0.25, 0.75]) P.blob('hair', s, 0.75, 0.12, 0.3, '#9a958e', 0.8);
  P.swatch(0, '#b89a50', 0.25); // Brillengestell (Messing/Nickel)
  P.swatch(1, '#dcd8cc', 0.85); // Kittelkragen
  P.swatch(2, '#1e1e1e', 0.4);
  P.swatch(5, '#d8d8d8', 0.5);
}

// Kai Lindner – Funkamateur: Bomberjacke (orange Futter), graue Kapuze,
// Stonewashed-Jeans, weiße Turnschuhe, Kopfhörer um den Hals
function paintKai(P) {
  const jacket = '#2c3628', jacketD = '#1a2018', knit = '#151a14', skin = '#e0b293', hair = '#5a3a22', jeans = '#56739a';
  cloth(P, 'torso', jacket, 0.62);
  P.noise('torso', 0.25, true, 'overlay');
  // Steppung / Falten der Bomberjacke
  for (let i = 0; i < 9; i++) P.line('torso', [[0, 0.1 + i * 0.065], [1, 0.1 + i * 0.065 + 0.01]], 'rgba(0,0,0,0.22)', 3, null, 0.8);
  P.grad('torso', [[0, 'rgba(255,255,255,0.05)'], [1, 'rgba(0,0,0,0.2)']], false, 'source-over', 0.25, 0, 0.5, 1);
  // offener Reißverschluss: graues Kapuzenshirt, orangefarbenes Futter, Kordeln
  P.c.save();
  {
    const [x0, y0] = P.pt('torso', 0.43, 0.0), [x1, y1] = P.pt('torso', 0.57, 0.0), [xb, yb] = P.pt('torso', 0.515, 0.62), [xa] = P.pt('torso', 0.485, 0.62);
    P.c.beginPath(); P.c.moveTo(x0, y0); P.c.lineTo(x1, y1); P.c.lineTo(xb, yb); P.c.lineTo(xa, yb); P.c.closePath(); P.c.clip();
    cloth(P, 'torso', '#7a7c80', 0.95, 0.4, 0, 0.6, 0.7, 'knit');
  }
  P.c.restore();
  P.line('torso', [[0.43, 0.0], [0.485, 0.62]], '#d8701e', 3.5);
  P.line('torso', [[0.57, 0.0], [0.515, 0.62]], '#d8701e', 3.5);
  P.line('torso', [[0.485, 0.62], [0.485, 0.72]], '#a8a8a8', 2.2, [3, 2]);
  P.line('torso', [[0.47, 0.06], [0.475, 0.3]], '#d0d0d0', 2.2);
  P.line('torso', [[0.53, 0.06], [0.525, 0.28]], '#d0d0d0', 2.2);
  // Strickbund am Saum und Kragen
  cloth(P, 'torso', knit, 0.95, 0, 0.66, 1, 0.74, 'knit');
  P.stripes('torso', 2, '#c86018', 3, 0.8, false, 0, 0.68, 1, 0.72);
  cloth(P, 'torso', knit, 0.95, 0, 0.0, 0.42, 0.06, 'knit');
  cloth(P, 'torso', knit, 0.95, 0.58, 0.0, 1, 0.06, 'knit');
  // Seitentaschen (Pattentaschen)
  for (const s of [0.33, 0.67]) { P.fill('torso', jacketD, 0.6, s - 0.05, 0.5, s + 0.05, 0.53); P.seam('torso', [[s - 0.05, 0.53], [s + 0.05, 0.53]], 'rgba(255,255,255,0.15)'); }
  // Jeans unterhalb des Bunds
  cloth(P, 'torso', jeans, 0.9, 0, 0.74, 1, 1, 'denim');
  P.fill('torso', '#3a2a1e', 0.6, 0, 0.74, 1, 0.77);
  P.ell('torso', 0.5, 0.755, 0.02, 0.012, '#b0a890', 0.3);
  P.blob('torso', 0.5, 0.95, 0.12, 0.08, '#a8c0d8', 0.35);
  // Ärmel: Bomber (Stifttasche am linken Oberarm), Strickbündchen
  for (const reg of ['armUL', 'armUR']) {
    cloth(P, reg, jacket, 0.62);
    for (let i = 0; i < 4; i++) P.line(reg, [[0, 0.2 + i * 0.2], [1, 0.22 + i * 0.2]], 'rgba(0,0,0,0.25)', 3);
  }
  P.fill('armUL', jacketD, 0.6, 0.38, 0.18, 0.62, 0.36);
  P.line('armUL', [[0.42, 0.2], [0.58, 0.2]], '#a0a0a0', 1.6);
  P.fill('armUL', '#d8d8d8', 0.5, 0, 0.42, 1, 0.56);
  cloth(P, 'armF', jacket, 0.62, 0, 0, 1, 0.82);
  for (let i = 0; i < 3; i++) P.line('armF', [[0, 0.15 + i * 0.22], [1, 0.17 + i * 0.22]], 'rgba(0,0,0,0.25)', 3);
  cloth(P, 'armF', knit, 0.95, 0, 0.82, 1, 1, 'knit');
  paintSkin(P, 'hand', skin);
  // Jeans, Turnschuhe (weiß, blauer Streifen), Socken
  cloth(P, 'thigh', jeans, 0.9, 0, 0, 1, 1, 'denim');
  P.blob('thigh', 0.5, 0.45, 0.16, 0.3, '#b8cde0', 0.4);
  P.blob('thigh', 0.5, 0.95, 0.12, 0.08, '#b8cde0', 0.35);
  P.seam('thigh', [[0.25, 0], [0.25, 1]], 'rgba(230,180,90,0.5)');
  P.seam('thigh', [[0.75, 0], [0.75, 1]], 'rgba(230,180,90,0.5)');
  cloth(P, 'shin', jeans, 0.9, 0, 0, 1, 1, 'denim');
  P.blob('shin', 0.5, 0.05, 0.14, 0.12, '#b8cde0', 0.35);
  P.seam('shin', [[0.25, 0], [0.25, 1]], 'rgba(230,180,90,0.5)');
  P.seam('shin', [[0.75, 0], [0.75, 1]], 'rgba(230,180,90,0.5)');
  P.fill('shin', shade(jeans, 0.15), 0.9, 0, 0.88, 1, 1);
  P.fill('foot', '#e4e2dc', 0.6);
  P.noise('foot', 0.15, true, 'overlay');
  P.fill('foot', '#b8b4aa', 0.7, 0, 0.82, 1, 1);
  P.line('foot', [[0.15, 0.25], [0.45, 0.6]], '#1f4fa0', 7);
  P.line('foot', [[0.85, 0.25], [0.55, 0.6]], '#1f4fa0', 7);
  P.fill('shaft', '#e4e2dc', 0.7);
  P.fill('shaft', '#c02a1e', 0.7, 0, 0.1, 1, 0.2);
  // Kopf
  paintFace(P, { skin, iris: '#5a4030', brow: { color: '#3a2414', w: 3.6, arch: 0.025 }, lips: '#a8645a', freckles: 14, hair, hairline: 0.2, blushA: 0.2, stubble: '#7a5a40', stubbleA: 0.08 });
  paintHair(P, 'hair', hair, '#3a2414', '#7a5232', 150, true);
  paintHair(P, 'hair2', hair, '#3a2414', '#7a5232', 120, true);
  // Kapuze (grau), Kopfhörer, Funkgerät
  cloth(P, 'extra', '#7a7c80', 0.95, 0, 0, 1, 1, 'knit');
  P.grad('extra', [[0, 'rgba(0,0,0,0.3)'], [0.5, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.2)']]);
  P.swatch(0, '#111111', 0.45);
  P.swatch(1, '#d8701e', 0.95);
  P.swatch(2, '#9a9a9a', 0.3);
  P.swatch(3, '#1d1d1d', 0.6);
  P.swatch(5, '#d8d8d8', 0.5);
}

const PAINTERS = { hanne: paintHanne, willi: paintWilli, albers: paintAlbers, kai: paintKai };

// Atlas einer Figur malen → { map, rough }
export function paintSurvivor(id, seed = 1) {
  const P = new Painter(seed * 131 + 7);
  (PAINTERS[id] || paintKai)(P);
  return P.textures();
}
