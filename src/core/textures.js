// Prozedurale Texturen – alles wird zur Laufzeit erzeugt, keine externen Assets.
import * as THREE from 'three';
import { ValueNoise, mulberry32 } from './noise.js';
import { clamp, smoothstep } from './utils.js';
import { PERKS } from '../config.js';

let ANISO = 4;
let SCALE = 1; // < 1 auf Mobilgeräten: kleinere Texturen, schnellerer Start, weniger Speicher
export function setAnisotropy(a) { ANISO = a; }
export function setTextureScale(s) { SCALE = s; }

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function toTexture(cv, { srgb = true, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = ANISO;
  t.needsUpdate = true;
  return t;
}

// Pixel-Generator: fn(u, v, out) setzt out.r/g/b (0..1) und out.h (Höhe für Bump)
function pixels(size, fn) {
  size = Math.max(128, Math.round(size * SCALE));
  const col = canvas(size), bmp = canvas(size);
  const cc = col.getContext('2d'), bc = bmp.getContext('2d');
  const ci = cc.createImageData(size, size), bi = bc.createImageData(size, size);
  const o = { r: 0, g: 0, b: 0, h: 0.5 };
  let i = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++, i += 4) {
      fn(x / size, y / size, o);
      ci.data[i] = clamp(o.r, 0, 1) * 255;
      ci.data[i + 1] = clamp(o.g, 0, 1) * 255;
      ci.data[i + 2] = clamp(o.b, 0, 1) * 255;
      ci.data[i + 3] = 255;
      const h = clamp(o.h, 0, 1) * 255;
      bi.data[i] = bi.data[i + 1] = bi.data[i + 2] = h;
      bi.data[i + 3] = 255;
    }
  }
  cc.putImageData(ci, 0, 0);
  bc.putImageData(bi, 0, 0);
  return { col, bmp, cc, bc, size };
}

function finish(p, depth = 0.008) {
  const out = { map: toTexture(p.col), bump: toTexture(p.bmp, { srgb: false }) };
  // Normal-Map aus der Bump-Höhe erst bei Bedarf rechnen (nur Weltmaterialien brauchen sie)
  let normal = null;
  Object.defineProperty(out, 'normal', {
    enumerable: true,
    get() {
      if (!normal) {
        const S = p.size, d = p.bc.getImageData(0, 0, S, S).data, h = new Float32Array(S * S);
        for (let i = 0; i < S * S; i++) h[i] = d[i * 4] / 255;
        normal = toTexture(normalCanvas(h, S, depth), { srgb: false });
      }
      return normal;
    },
  });
  return out;
}

// ── Werkzeuge für Weltoberflächen: Farbe, Höhe (→ Normal-Map) und Rauheit ──────

// Kantenlänge je nach Qualitätsstufe
const sz = (s) => Math.max(128, Math.round(s * SCALE));

// Ganzzahl-Hash → 0..1 (fester Zufallswert pro Ziegel, Fliese, Stein …)
function hash(a, b = 0, c = 0) {
  let h = (Math.imul(a | 0, 0x27d4eb2d) + Math.imul(b | 0, 0x165667b1) + Math.imul(c | 0, 0x9e3779b1) + 0x6a09e667) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Kachelbares fBm-Feld (Value-Noise) für ein ganzes S×S-Raster. Separabel interpoliert und
// damit um ein Vielfaches schneller als fbm() pro Pixel. px/py: Zellen je Kachel, oct: Oktaven.
// Grobe Felder werden auf einem kleineren Raster (≥ 4 Pixel je feinster Zelle) gerechnet und hochskaliert.
function field(seed, S, px, py = px, oct = 4, gain = 0.5) {
  const top = Math.max(px, py) << (oct - 1);
  let R = S;
  while (R % 2 === 0 && R / 2 >= top * 4 && R / 2 >= 32) R /= 2;
  const rnd = mulberry32(seed * 7919 + 101);
  const x0 = new Int32Array(R), x1 = new Int32Array(R), wx = new Float32Array(R);
  const oc = [];
  let amp = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    const PX = px << o, PY = py << o;
    if (PX > R || PY > R) break; // feiner als ein Pixel bringt nichts
    const lat = new Float32Array(PX * PY);
    for (let k = 0; k < lat.length; k++) lat[k] = rnd();
    for (let x = 0; x < R; x++) {
      const g = (x * PX) / R, gi = g | 0, f = g - gi;
      x0[x] = gi; x1[x] = gi + 1 === PX ? 0 : gi + 1; wx[x] = f * f * (3 - 2 * f);
    }
    // Gitterzeilen entlang x vorinterpolieren
    const rows = new Float32Array(PY * R);
    for (let j = 0; j < PY; j++) {
      const lb = j * PX, rb = j * R;
      for (let x = 0; x < R; x++) { const a = lat[lb + x0[x]]; rows[rb + x] = a + (lat[lb + x1[x]] - a) * wx[x]; }
    }
    oc.push([rows, PY, amp]);
    norm += amp; amp *= gain;
  }
  // je Bildzeile alle Oktaven entlang y aufsummieren
  const out = new Float32Array(R * R), acc = new Float64Array(R), inv = 1 / norm;
  for (let y = 0; y < R; y++) {
    acc.fill(0);
    for (const [rows, PY, a] of oc) {
      const g = (y * PY) / R, gi = g | 0, f = g - gi, w = f * f * (3 - 2 * f) * a;
      const r0 = gi * R, r1 = (gi + 1 === PY ? 0 : gi + 1) * R;
      for (let x = 0; x < R; x++) { const v = rows[r0 + x]; acc[x] += v * a + (rows[r1 + x] - v) * w; }
    }
    const ob = y * R;
    for (let x = 0; x < R; x++) out[ob + x] = acc[x] * inv;
  }
  return R === S ? out : upsample(out, R, S);
}

// Feld bilinear und kachelnd von R×R auf S×S vergrößern
function upsample(src, R, S) {
  const f = S / R, tmp = new Float32Array(R * S), out = new Float32Array(S * S);
  const i0 = new Int32Array(S), i1 = new Int32Array(S), w = new Float32Array(S);
  for (let x = 0; x < S; x++) {
    let g = (x + 0.5) / f - 0.5;
    if (g < 0) g += R;
    const gi = g | 0;
    i0[x] = gi; i1[x] = gi + 1 === R ? 0 : gi + 1; w[x] = g - gi;
  }
  for (let y = 0; y < R; y++) {
    const o = y * R, t = y * S;
    for (let x = 0; x < S; x++) { const a = src[o + i0[x]]; tmp[t + x] = a + (src[o + i1[x]] - a) * w[x]; }
  }
  for (let y = 0; y < S; y++) {
    const a0 = i0[y] * S, a1 = i1[y] * S, wy = w[y], o = y * S;
    for (let x = 0; x < S; x++) { const a = tmp[a0 + x]; out[o + x] = a + (tmp[a1 + x] - a) * wy; }
  }
  return out;
}

// Schwelle, unter der der Anteil q eines Feldes liegt (Stichprobe) – für planbare Flächenanteile
function quantile(F, q) {
  const n = 4096, s = new Float32Array(n), step = F.length / n;
  for (let k = 0; k < n; k++) s[k] = F[Math.floor(k * step + step * 0.37)];
  s.sort();
  return s[Math.min(n - 1, Math.floor(q * n))];
}

// Bilinear und kachelnd aus einem Feld lesen (Pixelkoordinaten)
function samp(F, S, x, y) {
  x %= S; y %= S;
  if (x < 0) x += S;
  if (y < 0) y += S;
  const xi = x | 0, yi = y | 0, fx = x - xi, fy = y - yi;
  const xj = xi + 1 === S ? 0 : xi + 1, yj = (yi + 1 === S ? 0 : yi + 1) * S, yo = yi * S;
  const a = F[yo + xi], b = F[yo + xj], c = F[yj + xi], d = F[yj + xj];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

// Kachelnder Box-Weichzeichner, zweimal angewendet ≈ Dreiecksfilter
function blur(src, S, rad, passes = 2) {
  const tmp = new Float32Array(S * S), out = new Float32Array(S * S), acc = new Float64Array(S), k = 1 / (2 * rad + 1);
  const wrapI = new Int32Array(S + 2 * rad + 2);
  for (let j = 0; j < wrapI.length; j++) wrapI[j] = (((j - rad - 1) % S) + S) % S;
  let a = src;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < S; y++) {
      const o = y * S;
      let s = 0;
      for (let d = -rad; d <= rad; d++) s += a[o + wrapI[d + rad + 1]];
      for (let x = 0; x < S; x++) {
        tmp[o + x] = s * k;
        s += a[o + wrapI[x + 2 * rad + 2]] - a[o + wrapI[x + 1]];
      }
    }
    // senkrecht zeilenweise mit laufenden Summen je Spalte (cachefreundlich)
    acc.fill(0);
    for (let d = -rad; d <= rad; d++) { const o = wrapI[d + rad + 1] * S; for (let x = 0; x < S; x++) acc[x] += tmp[o + x]; }
    for (let y = 0; y < S; y++) {
      const o = y * S, ad = wrapI[y + 2 * rad + 2] * S, sb = wrapI[y + 1] * S;
      for (let x = 0; x < S; x++) { out[o + x] = acc[x] * k; acc[x] += tmp[ad + x] - tmp[sb + x]; }
    }
    a = out;
  }
  return out;
}

// Maskenleinwand: Risse, Flecken und Spuren werden additiv in R/G/B gezeichnet (Canvas-2D ist
// schnell und kantengeglättet) und danach als Bytes gelesen
function maskCanvas(S) {
  const c = canvas(S).getContext('2d', { willReadFrequently: true });
  c.fillStyle = '#000'; c.fillRect(0, 0, S, S);
  c.globalCompositeOperation = 'lighter';
  c.lineCap = c.lineJoin = 'round';
  return c;
}
const readMask = (c, S) => c.getImageData(0, 0, S, S).data;

// fn(c) versetzt wiederholen, damit Formen über den Kachelrand nahtlos weiterlaufen
function wrapDraw(c, S, x0, y0, x1, y1, fn) {
  for (let oy = -S; oy <= S; oy += S) for (let ox = -S; ox <= S; ox += S) {
    if (x1 + ox < 0 || x0 + ox > S || y1 + oy < 0 || y0 + oy > S) continue;
    c.save(); c.translate(ox, oy); fn(c); c.restore();
  }
}

// Verzweigter Riss als Zufallsweg (Koordinaten 0..1), wird zum Ende hin dünner
function crack(c, S, r, x, y, a, len, step, w, wig, branch, style) {
  const n = Math.max(2, Math.round(len / step)), pts = [x, y], kids = [];
  let x0 = x, y0 = y, x1 = x, y1 = y;
  for (let s = 0; s < n; s++) {
    a += (r() - 0.5) * wig;
    x += Math.cos(a) * step; y += Math.sin(a) * step;
    pts.push(x, y);
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (r() < branch) kids.push([x, y, a + (r() < 0.5 ? 1 : -1) * (0.5 + r() * 0.8), len * (0.15 + r() * 0.35)]);
  }
  wrapDraw(c, S, x0 * S - 4, y0 * S - 4, x1 * S + 4, y1 * S + 4, (cx) => {
    cx.strokeStyle = style;
    for (let sg = 0; sg < 3; sg++) {
      const a0 = Math.floor((sg * n) / 3), a1 = Math.floor(((sg + 1) * n) / 3);
      cx.lineWidth = Math.max(0.5, w * (1 - sg * 0.3));
      cx.beginPath(); cx.moveTo(pts[a0 * 2] * S, pts[a0 * 2 + 1] * S);
      for (let q = a0 + 1; q <= a1; q++) cx.lineTo(pts[q * 2] * S, pts[q * 2 + 1] * S);
      cx.stroke();
    }
  });
  for (const [kx, ky, ka, kl] of kids) crack(c, S, r, kx, ky, ka, kl, step, w * 0.6, wig, 0, style);
}

// Weicher Fleck (radialer Verlauf) in die Maske, kachelnd
function spot(c, S, x, y, rad, style) {
  wrapDraw(c, S, x - rad, y - rad, x + rad, y + rad, (cx) => {
    const g = cx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, style(1)); g.addColorStop(0.6, style(0.7)); g.addColorStop(1, style(0));
    cx.fillStyle = g; cx.beginPath(); cx.arc(x, y, rad, 0, 7); cx.fill();
  });
}

// Arbeitsfläche einer Oberfläche: Farbe (sRGB-Bytes), Höhe (float) und optional
// Rauheit/Metall (G = Rauheit, B = Metall – so liest three.js roughnessMap/metalnessMap)
function surface(S, data = false) {
  return { size: S, col: new Uint8ClampedArray(S * S * 4), h: new Float32Array(S * S), rm: data ? new Uint8ClampedArray(S * S * 4) : null };
}
function setPx(p, i, r, g, b, rough = 1, metal = 0) {
  const q = i * 4, c = p.col;
  c[q] = r * 255; c[q + 1] = g * 255; c[q + 2] = b * 255; c[q + 3] = 255;
  if (p.rm) { const d = p.rm, s = rough * 255; d[q] = s; d[q + 1] = s; d[q + 2] = metal * 255; d[q + 3] = 255; }
}

// Höhlen abdunkeln, Kanten minimal aufhellen (Höhe minus weichgezeichnete Höhe)
function cavity(p, rad, amount, lo = 0.55, hi = 1.12) {
  const { size: S, h, col } = p, hb = blur(h, S, rad);
  for (let i = 0, q = 0; i < S * S; i++, q += 4) {
    const a = clamp(1 + (h[i] - hb[i]) * amount, lo, hi);
    col[q] *= a; col[q + 1] *= a; col[q + 2] *= a;
  }
}

function imgCanvas(data, S) {
  const cv = canvas(S);
  cv.getContext('2d').putImageData(new ImageData(data, S, S), 0, 0);
  return cv;
}

// Normal-Map (Tangentenraum, OpenGL-Konvention wie three.js) aus der Höhe per Sobel.
// depth: Höhe 1.0 entspricht depth × Kachelbreite. Grün = +v, und v zeigt im Bild nach oben (flipY).
function normalCanvas(h, S, depth) {
  const d = new Uint8ClampedArray(S * S * 4), k = (depth * S) / 8;
  for (let y = 0; y < S; y++) {
    const ym = ((y - 1 + S) % S) * S, y0 = y * S, yp = ((y + 1) % S) * S;
    for (let x = 0; x < S; x++) {
      const xm = x === 0 ? S - 1 : x - 1, xp = x === S - 1 ? 0 : x + 1;
      const tl = h[ym + xm], t = h[ym + x], tr = h[ym + xp], l = h[y0 + xm], r = h[y0 + xp], bl = h[yp + xm], b = h[yp + x], br = h[yp + xp];
      const nx = -((tr + 2 * r + br) - (tl + 2 * l + bl)) * k;
      const ny = ((bl + 2 * b + br) - (tl + 2 * t + tr)) * k;
      const inv = 127.5 / Math.sqrt(nx * nx + ny * ny + 1), q = (y0 + x) * 4;
      d[q] = 127.5 + nx * inv; d[q + 1] = 127.5 + ny * inv; d[q + 2] = 127.5 + inv; d[q + 3] = 255;
    }
  }
  return imgCanvas(d, S);
}

// Fertige Texturen: map (sRGB), normal und rough (linear). Die alte Bump-Map entsteht nur bei Bedarf.
function done(p, depth) {
  const S = p.size, out = { map: toTexture(imgCanvas(p.col, S)) };
  if (depth) out.normal = toTexture(normalCanvas(p.h, S, depth), { srgb: false });
  if (p.rm) out.rough = toTexture(imgCanvas(p.rm, S), { srgb: false });
  let bump = null;
  Object.defineProperty(out, 'bump', {
    enumerable: true,
    get() {
      if (!bump) {
        const d = new Uint8ClampedArray(S * S * 4);
        for (let i = 0, q = 0; i < S * S; i++, q += 4) { d[q] = d[q + 1] = d[q + 2] = p.h[i] * 255; d[q + 3] = 255; }
        bump = toTexture(imgCanvas(d, S), { srgb: false });
      }
      return bump;
    },
  });
  return out;
}

// Betonboden (Kachel = 4 × 4 m): Sägefugen am Kachelrand, Risse, Kellenschliff, Ölflecken,
// Reifen- und Schuhspuren, Pfützen in flachen Senken. dirt 0 … 1 (Werkstatt, Parkplatz),
// res = Kantenlänge bei voller Qualität
export function concrete(seed = 1, tint = [1, 1, 1], dirt = 0, res = 1024) {
  const S = sz(res), k = S / 1024, r = mulberry32(seed);
  const big = field(seed, S, 2, 2, 4), mid = field(seed + 1, S, 10, 10, 3);
  const fine = field(seed + 2, S, 96, 96, 2), grit = field(seed + 3, S, S >> 1, S >> 1, 1);
  const spall = field(seed + 4, S, 32, 32, 2), pf = field(seed + 5, S, 5, 5, 3);
  // Senken für Pfützen: planbarer Flächenanteil unabhängig vom Zufall
  const low = new Float32Array(S * S);
  for (let i = 0; i < low.length; i++) low[i] = big[i] * 0.55 + pf[i] * 0.33 + mid[i] * 0.12 + fine[i] * 0.04;
  const pud = quantile(low, 0.03 + dirt * 0.025), dmp = quantile(low, 0.1 + dirt * 0.06);
  // Masken A: R = Risse, G = Kellenschliff, B = Öl
  const ma = maskCanvas(S);
  for (let n = 0; n < 3 + dirt * 2; n++) crack(ma, S, r, r(), r(), r() * 6.3, 0.18 + r() * 0.4, 0.004, (1.2 + r()) * k, 0.32, 0.012, 'rgba(255,0,0,1)');
  for (let n = 0; n < 10; n++) crack(ma, S, r, r(), r(), r() * 6.3, 0.02 + r() * 0.05, 0.003, 0.8 * k, 0.6, 0, 'rgba(150,0,0,1)');
  for (let n = 0; n < 80; n++) {
    const x = r() * S, y = r() * S, rad = (0.05 + r() * 0.09) * S, a0 = r() * 6.3, a1 = a0 + 0.8 + r() * 2.4;
    const al = 0.05 + r() * 0.08, lw = (8 + r() * 16) * k;
    wrapDraw(ma, S, x - rad - lw, y - rad - lw, x + rad + lw, y + rad + lw, (c) => {
      c.strokeStyle = `rgba(0,255,0,${al})`; c.lineWidth = lw; c.beginPath(); c.arc(x, y, rad, a0, a1); c.stroke();
    });
  }
  for (let n = 0; n < 2 + Math.round(dirt * 5); n++) {
    // wenige große, weiche Flecken – die Form entsteht erst mit dem Rauschen im Pixel-Durchlauf
    const cx = r() * S, cy = r() * S, rad = (0.02 + r() * 0.045) * S;
    for (let q = 0; q < 3; q++) {
      const a = 0.35 + r() * 0.25, ang = r() * 6.3, d = r() * rad * 0.7;
      spot(ma, S, cx + Math.cos(ang) * d, cy + Math.sin(ang) * d, rad * (0.6 + r() * 0.5), (t) => `rgba(0,0,255,${a * t})`);
    }
    for (let q = 0; q < 4; q++) { // Tropfen daneben
      const a = 0.5 + r() * 0.4, ang = r() * 6.3, d = rad * (1.2 + r() * 1.3);
      spot(ma, S, cx + Math.cos(ang) * d, cy + Math.sin(ang) * d, (2 + r() * 3) * k, (t) => `rgba(0,0,255,${a * t})`);
    }
  }
  // Masken B: R = Reifenspuren (Gabelstapler), G = Schuh- und Schleifspuren
  const mb = maskCanvas(S);
  for (let n = 0; n < 2 + dirt; n++) {
    let x = r() * S, y = r() * S, a = r() * 6.3;
    const bend = (r() - 0.5) * 0.012, steps = 40, step = (0.015 + r() * 0.01) * S, gauge = 0.11 * S, pts = [];
    for (let s = 0; s <= steps; s++) { pts.push([x, y, a]); x += Math.cos(a) * step; y += Math.sin(a) * step; a += bend; }
    for (const side of [-1, 1]) {
      for (let st = 0; st < 5; st++) {
        const off = side * gauge + (st - 2) * 0.006 * S, al = 0.04 + r() * 0.07, lw = (3 + r() * 6) * k;
        const line = pts.map(([px, py, pa]) => [px - Math.sin(pa) * off, py + Math.cos(pa) * off]);
        const xs = line.map((q) => q[0]), ys = line.map((q) => q[1]);
        wrapDraw(mb, S, Math.min(...xs) - lw, Math.min(...ys) - lw, Math.max(...xs) + lw, Math.max(...ys) + lw, (c) => {
          c.strokeStyle = `rgba(255,0,0,${al})`; c.lineWidth = lw;
          c.beginPath(); line.forEach(([px, py], j) => (j ? c.lineTo(px, py) : c.moveTo(px, py))); c.stroke();
        });
      }
    }
  }
  for (let n = 0; n < 60 + dirt * 60; n++) {
    const x = r() * S, y = r() * S, a = r() * 6.3, l = (0.006 + r() * 0.02) * S, al = 0.1 + r() * 0.25, lw = (2 + r() * 4) * k;
    wrapDraw(mb, S, x - l, y - l, x + l, y + l, (c) => {
      c.strokeStyle = `rgba(0,255,0,${al})`; c.lineWidth = lw;
      c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + Math.cos(a + 0.4) * l * 0.5, y + Math.sin(a + 0.4) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
    });
  }
  const A = readMask(ma, S), B = readMask(mb, S);
  const p = surface(S, true), h = p.h;
  const jw = Math.max(0.6, 0.7 * k);
  for (let y = 0, i = 0; y < S; y++) {
    const dy = Math.min(y + 0.5, S - y - 0.5);
    for (let x = 0; x < S; x++, i++) {
      const q = i * 4, f = fine[i], m = mid[i], g = grit[i];
      // Sägefuge mit ausgebrochenen Kanten
      const sp = smoothstep(0.6, 0.8, spall[i]) * 3 * k;
      const jd = Math.min(Math.min(x + 0.5, S - x - 0.5), dy);
      const joint = smoothstep(jw + 0.6, jw - 0.4, jd), chip = smoothstep(jw + sp + 0.8, jw + sp - 0.2, jd) * (1 - joint);
      const speck = (g > 0.78 ? (g - 0.78) * 1.6 : 0) - (g < 0.16 ? (0.16 - g) * 2 : 0);
      // ruhiger Grundton, leichte Wolken, scharf begrenzte Verfärbungen (Abbinden, Ausblühungen)
      const blot = smoothstep(0.58, 0.66, m) * 0.025 - smoothstep(0.4, 0.32, m) * 0.02;
      let L = 0.49 + (big[i] - 0.5) * 0.08 + (m - 0.5) * 0.05 + (f - 0.5) * 0.06 + speck * 0.35 + blot;
      const trow = A[q + 1] / 255;
      L += trow * 0.035;
      const grime = smoothstep(0.55, 0.72, m * 0.7 + pf[i] * 0.3 + (big[i] - 0.5) * 0.3) * (0.06 + dirt * 0.14);
      L *= 1 - grime;
      let R = L, G = L * 0.985, Bc = L * 0.955;
      let H = 0.5 + (f - 0.5) * 0.08 + (m - 0.5) * 0.04 + speck * 0.1;
      let rough = 0.84 + (f - 0.5) * 0.12 + (m - 0.5) * 0.08 - trow * 0.14 + grime * 0.1;
      // Reifen-, Schuh- und Schleifspuren (Gummi)
      const tire = B[q] / 255, scuff = B[q + 1] / 255;
      R *= 1 - tire * 0.32 - scuff * 0.45; G *= 1 - tire * 0.32 - scuff * 0.45; Bc *= 1 - tire * 0.3 - scuff * 0.42;
      rough -= tire * 0.12;
      // Öl: dunkel, mit noch dunklerem Rand, glatter
      const oil = smoothstep(0.12, 0.5, A[q + 2] / 255 + (m - 0.5) * 1.6 + (f - 0.5) * 0.5);
      const ring = smoothstep(0.1, 0.25, oil) * smoothstep(0.55, 0.3, oil);
      const ok = 1 - oil * 0.45 - ring * 0.1;
      R *= ok; G *= ok * 0.98; Bc *= ok * 0.94;
      rough += (0.5 - rough) * oil;
      // Risse und Fuge
      const cr = A[q] / 255;
      const ck = 1 - cr * 0.62 - joint * 0.7 - chip * 0.15;
      R *= ck; G *= ck; Bc *= ck;
      H -= cr * 0.3 + joint * 0.45 + chip * 0.18;
      rough += (cr + chip) * 0.08;
      // Nässe: Pfützen in Senken (glatt, dunkel, eben), feuchter Rand, nasse Risse und Fugen
      const wl = low[i];
      const puddle = smoothstep(pud + 0.003, pud - 0.003, wl), damp = smoothstep(dmp, pud, wl - f * 0.04 + 0.02);
      const wk = 1 - damp * 0.2 - puddle * 0.14;
      R *= wk; G *= wk; Bc *= wk * 1.02;
      rough += (0.38 - rough) * damp * 0.8;
      rough += (0.1 - rough) * Math.max(puddle, Math.min(1, (cr + joint) * damp * 1.5));
      H += (0.46 - H) * puddle;
      h[i] = H;
      setPx(p, i, R * tint[0], G * tint[1], Bc * tint[2], rough - puddle * 0.03);
    }
  }
  cavity(p, Math.max(1, Math.round(2 * k)), 2.5);
  return done(p, 0.005);
}

// Alte Putzwand über Ziegeln (Kachel = 4 × 4 m, v = 0 oben). Ziegel 24 × 7 cm mit 1 cm Fuge;
// der Putz platzt vor allem unten (aufsteigende Feuchte) und unter der Decke ab: Anstrich → Putz
// mit leicht aufgewölbtem Rand → rauer Unterputz → Ziegel. Unten ein dunkler Ölsockel mit Trennstrich.
export function plasterWall(seed = 3) {
  const S = sz(1024), k = S / 1024, r = mulberry32(seed);
  const big = field(seed, S, 2, 2, 3), pA = field(seed + 1, S, 6, 6, 4), pB = field(seed + 2, S, 24, 24, 3);
  const mid = field(seed + 3, S, 32, 32, 3), fine = field(seed + 4, S, 128, 128, 2);
  const strk = field(seed + 5, S, 40, 3, 3), stn = field(seed + 6, S, 5, 4, 4);
  const scf = field(seed + 7, S, 8, 96, 2), chip = field(seed + 8, S, 40, 40, 3);
  // Haarrisse im Putz (meist schräg nach unten)
  const mc = maskCanvas(S);
  for (let n = 0; n < 7; n++) crack(mc, S, r, r(), 0.08 + r() * 0.55, Math.PI * (0.3 + r() * 0.4), 0.04 + r() * 0.14, 0.003, (0.8 + r() * 0.7) * k, 0.8, 0.03, 'rgba(255,0,0,1)');
  const mk = readMask(mc, S);
  const p = surface(S, true), h = p.h;
  for (let y = 0, i = 0; y < S; y++) {
    const v = (y + 0.5) / S, hm = 4 * (1 - v); // Meter über dem Boden
    const low = smoothstep(1.5, 0.75, hm) * smoothstep(0.0, 0.3, hm), top = smoothstep(3.25, 3.9, hm);
    const thr = 0.735 - low * 0.125 - top * 0.085; // Schwelle für Abplatzungen
    const row = (v * 48) | 0, fy = v * 48 - row, dy = Math.min(fy, 1 - fy) * 0.0833;
    const off = (row & 1) * 0.5 + (hash(row, 3, seed) - 0.5) * 0.12;
    const grimeH = smoothstep(0.65, 0.0, hm), splashH = smoothstep(0.18, 0.0, hm);
    for (let x = 0; x < S; x++, i++) {
      const u = (x + 0.5) / S, m = mid[i], f = fine[i];
      // Ziegel und Fugen (Abstand zur Fugenkante in Metern, leicht unregelmäßig)
      const bx = u * 16 + off, bi = Math.floor(bx), fx = bx - bi;
      const e = Math.min(Math.min(fx, 1 - fx) * 0.25 - 0.005, dy - 0.006) + (m - 0.5) * 0.004;
      const inB = smoothstep(-0.001, 0.0015, e);
      const id = hash(bi & 15, row, seed), id2 = hash(bi & 15, row, seed + 1);
      let H = 0.27 + (f - 0.5) * 0.05 + inB * (0.1 + 0.07 * smoothstep(0, 0.007, e) + (m - 0.5) * 0.06);
      const kb = 0.8 + id * 0.32;
      let R = 0.43 + (f - 0.5) * 0.05, G = 0.41 + (f - 0.5) * 0.05, B = 0.37 + (f - 0.5) * 0.04;
      R += (kb * (0.36 + id2 * 0.07) - R) * inB; G += (kb * (0.215 + id2 * 0.025) - G) * inB; B += (kb * (0.17 - id2 * 0.015) - B) * inB;
      let rough = 0.95 - inB * 0.06;
      // Putzstaub auf freigelegten Ziegeln
      const dust = smoothstep(0.52, 0.72, m) * 0.3;
      R += (0.5 - R) * dust; G += (0.48 - G) * dust; B += (0.44 - B) * dust;
      // Putzschichten
      const P = pA[i] * 0.62 + pB[i] * 0.38, d = thr - P;
      const aBase = smoothstep(-0.02, -0.013, d), aFin = smoothstep(-0.0015, 0.0015, d);
      if (aBase > 0) {
        const bk = 0.86 + m * 0.26;
        H += (0.53 + (m - 0.5) * 0.14 + (f - 0.5) * 0.06 - H) * aBase;
        R += (0.47 * bk - R) * aBase; G += (0.45 * bk - G) * aBase; B += (0.41 * bk - B) * aBase;
        rough += (0.97 - rough) * aBase;
      }
      if (aFin > 0) {
        const lip = 1 - smoothstep(0.0, 0.012, d);
        H += (0.68 + (f - 0.5) * 0.03 + (pA[i] - 0.5) * 0.06 + lip * 0.035 - H) * aFin;
        R += (0.6 - R) * aFin; G += (0.58 - G) * aFin; B += (0.52 - B) * aFin;
        rough += (0.95 - rough) * aFin;
        // Anstrich, etwas hinter der Putzkante zurückgesetzt
        let aP = smoothstep(0.008, 0.014, d) * aFin;
        const se = 1.15 + (m - 0.5) * 0.008;
        let pr, pg, pb, pRough;
        if (hm < se) {
          // Ölsockel: dunkelgrün, glänzender, abgeplatzt, geschrammt, Gummispuren
          aP *= 1 - smoothstep(0.735, 0.76, chip[i] + smoothstep(0.3, 0.0, hm) * 0.1 + smoothstep(0.05, 0.0, se - hm) * 0.08 + smoothstep(0.03, 0.0, d) * 0.1);
          const sc = smoothstep(0.64, 0.74, scf[i]) * smoothstep(0.06, 0.2, hm) * smoothstep(0.7, 0.45, hm) * 0.8;
          const rub = smoothstep(0.34, 0.26, scf[i]) * smoothstep(0.04, 0.1, hm) * smoothstep(0.55, 0.3, hm);
          const pk = 0.92 + (f - 0.5) * 0.08 + (m - 0.5) * 0.12;
          pr = 0.165 * pk; pg = 0.21 * pk; pb = 0.18 * pk; pRough = 0.56 + (m - 0.5) * 0.1;
          pr += (0.3 - pr) * sc; pg += (0.32 - pg) * sc; pb += (0.29 - pb) * sc; pRough += (0.8 - pRough) * sc;
          pr *= 1 - rub * 0.5; pg *= 1 - rub * 0.5; pb *= 1 - rub * 0.5;
        } else if (hm < se + 0.022) {
          pr = 0.33; pg = 0.14; pb = 0.11; pRough = 0.6; // Trennstrich
        } else {
          const pk = 0.94 + (f - 0.5) * 0.05;
          pr = 0.55 * pk; pg = 0.565 * pk; pb = 0.5 * pk; pRough = 0.88;
        }
        R += (pr - R) * aP; G += (pg - G) * aP; B += (pb - B) * aP; rough += (pRough - rough) * aP;
        // Haarrisse nur im Putz
        const cr = (mk[i * 4] / 255) * aFin;
        R *= 1 - cr * 0.5; G *= 1 - cr * 0.5; B *= 1 - cr * 0.5; H -= cr * 0.06;
      }
      // großflächige Tönung und Vergilbung
      const bg = big[i] - 0.5, kb2 = 1 + bg * 0.32;
      R *= kb2; G *= kb2; B *= kb2 * (1 - bg * 0.12);
      // Wasserläufe von oben (unterschiedlich lang), leicht feucht
      const ws = smoothstep(0.58, 0.76, strk[i] - (4 - hm) * 0.05) * (0.7 + m * 0.6);
      R *= 1 - ws * 0.2; G *= 1 - ws * 0.21; B *= 1 - ws * 0.25; rough -= ws * 0.1;
      // Wasserflecken mit dunklerem Rand unter der Decke
      const st = stn[i] + top * 0.12 - 0.06;
      const wet = smoothstep(0.6, 0.7, st) * 0.12, tide = Math.exp(-(((st - 0.62) / 0.005) ** 2)) * smoothstep(2.6, 3.4, hm) * 0.12;
      R *= 1 - wet * 0.6 - tide; G *= 1 - wet * 0.8 - tide * 1.1; B *= 1 - wet * 1.4 - tide * 1.5;
      // Schmutz und Spritzer über dem Boden
      const g = grimeH * (0.4 + 0.6 * m) * 0.45 + splashH * smoothstep(0.45, 0.62, f) * 0.3;
      R *= 1 - g; G *= 1 - g * 1.06; B *= 1 - g * 1.18;
      h[i] = H;
      setPx(p, i, R, G, B, rough);
    }
  }
  cavity(p, Math.max(1, Math.round(3 * k)), 3.2);
  return done(p, 0.012);
}

// Betondecke (Kachel = 4 × 4 m) mit Abdrücken der Schalbretter (≈ 14 cm), Graten an den Brettfugen,
// Ankerlöchern im Raster, Wasserflecken mit Rand, Ausblühungen, Ruß und Rostspuren
export function ceiling(seed = 5) {
  const S = sz(512), k = S / 512, r = mulberry32(seed), BR = 28;
  const big = field(seed, S, 2, 2, 3), mid = field(seed + 1, S, 12, 12, 3), fine = field(seed + 2, S, 64, 64, 2);
  const grain = field(seed + 3, S, 3, 96, 3), stn = field(seed + 4, S, 4, 4, 4), soot = field(seed + 5, S, 3, 3, 3);
  // Rostflecken mit Ablaufspur (Bewehrung zu nah an der Oberfläche)
  const mc = maskCanvas(S);
  for (let n = 0; n < 4; n++) {
    const x = r() * S, y = r() * S, rad = (2 + r() * 3) * k, len = (10 + r() * 30) * k;
    spot(mc, S, x, y, rad * 2.2, (t) => `rgba(255,0,0,${0.7 * t})`);
    wrapDraw(mc, S, x - 4, y - 4, x + len + 4, y + 4, (c) => {
      const g = c.createLinearGradient(x, y, x + len, y);
      g.addColorStop(0, 'rgba(255,0,0,0.45)'); g.addColorStop(1, 'rgba(255,0,0,0)');
      c.strokeStyle = g; c.lineWidth = rad; c.beginPath(); c.moveTo(x, y); c.lineTo(x + len, y + (r() - 0.5) * 2); c.stroke();
    });
  }
  const mk = readMask(mc, S);
  const p = surface(S, false), h = p.h;
  for (let y = 0, i = 0; y < S; y++) {
    const v = (y + 0.5) / S, bv = v * BR, bi = bv | 0, fv = bv - bi;
    const seamD = Math.min(fv, 1 - fv) * (S / BR); // Pixel zur Brettfuge
    const nseg = 2 + ((hash(bi, 1, seed) * 2) | 0), so = hash(bi, 2, seed);
    const gOff = (hash(bi, 3, seed) * S) | 0, lvl = (hash(bi, 4, seed) - 0.5) * 0.06;
    // Ankerlöcher alle 1 m
    const gy = v * 4 - Math.floor(v * 4) - 0.5;
    for (let x = 0; x < S; x++, i++) {
      const u = (x + 0.5) / S;
      const su = (u + so) * nseg, si = su | 0, sf = su - si;
      const endD = Math.min(sf, 1 - sf) * (S / nseg);
      const seg = hash(bi, si % nseg, seed + 7);
      const gr = grain[y * S + ((x + gOff) % S)];
      const m = mid[i], f = fine[i];
      let L = 0.52 + (big[i] - 0.5) * 0.12 + (m - 0.5) * 0.07 + (seg - 0.5) * 0.06 + (gr - 0.5) * 0.08 + (f - 0.5) * 0.04;
      let H = 0.5 + lvl + (gr - 0.5) * 0.12 + (f - 0.5) * 0.04;
      // Grat an der Brettfuge (Zementleim lief in den Spalt), kleiner Versatz an Stößen
      const ridge = smoothstep(1.3 * k, 0.2, seamD), endJ = smoothstep(1.0 * k, 0.1, endD);
      H += ridge * 0.06 - endJ * 0.05;
      L += ridge * 0.02 - endJ * 0.04;
      const gx = u * 4 - Math.floor(u * 4) - 0.5, hd = Math.hypot(gx, gy) * 1.0; // Meter zum Ankerloch
      const hole = smoothstep(0.016, 0.011, hd), plug = smoothstep(0.011, 0.008, hd) * (hash(Math.floor(u * 4), Math.floor(v * 4), seed) > 0.5 ? 1 : 0);
      H -= hole * 0.3 - plug * 0.22;
      L *= 1 - hole * 0.55 + plug * 0.4;
      let R = L * 1.01, G = L, B = L * 0.97;
      // Wasserflecken (gelblich-braun mit Rand), Ausblühungen an Fugen, Ruß
      const st = stn[i];
      const wet = smoothstep(0.6, 0.66, st), tide = Math.exp(-(((st - 0.63) / 0.006) ** 2));
      R *= 1 - wet * 0.06 - tide * 0.14; G *= 1 - wet * 0.1 - tide * 0.18; B *= 1 - wet * 0.22 - tide * 0.26;
      const eff = smoothstep(0.62, 0.72, st + (1 - smoothstep(0, 3 * k, seamD)) * 0.04) * smoothstep(3 * k, 0, seamD) * 0.35;
      R += (0.82 - R) * eff; G += (0.81 - G) * eff; B += (0.78 - B) * eff;
      const so2 = smoothstep(0.55, 0.78, soot[i]) * 0.32;
      R *= 1 - so2; G *= 1 - so2; B *= 1 - so2 * 0.96;
      const rs = mk[i * 4] / 255;
      R += (0.36 - R) * rs; G += (0.2 - G) * rs; B += (0.11 - B) * rs;
      h[i] = H;
      setPx(p, i, R, G, B);
    }
  }
  cavity(p, Math.max(1, Math.round(2 * k)), 2.5);
  return done(p, 0.006);
}

// Bretter (waagrecht, count Stück je Kachel): Maserung je Brett versetzt, Äste, abgerundete
// und abgegriffene Kanten, dunkle Fugen, verwitterte Stellen, Nägel
export function planks(seed = 7, tint = [1, 1, 1], count = 4) {
  const S = sz(512), k = S / 512;
  const grain = field(seed, S, 2, 128, 3), fig = field(seed + 1, S, 2, 16, 3), wth = field(seed + 2, S, 3, 3, 3), fine = field(seed + 3, S, 64, 64, 2);
  const p = surface(S, false), h = p.h, ph = S / count;
  const nails = [24 * k, S - 24 * k];
  for (let y = 0, i = 0; y < S; y++) {
    const pv = (y + 0.5) / ph, pi = pv | 0, pf = pv - pi;
    const off = hash(pi, 1, seed), gOff = (off * S) | 0, tone = (hash(pi, 2, seed) - 0.5) * 0.12;
    const ed = Math.min(pf, 1 - pf) * ph; // Pixel zur Brettkante
    const gap = smoothstep(1.6 * k, 0.6 * k, ed), round = smoothstep(4 * k, 1.2 * k, ed);
    // Ast je Brett an zufälliger Stelle
    const kx = hash(pi, 3, seed) * S, ky = (pi + 0.3 + hash(pi, 4, seed) * 0.4) * ph, kr = (5 + hash(pi, 5, seed) * 8) * k;
    for (let x = 0; x < S; x++, i++) {
      const xs = (x + gOff) % S, gr = grain[y * S + xs], fg = fig[y * S + xs];
      const ring = Math.sin((pv * 30 + fg * 14 + (x / S) * 3) * 2.0) * 0.5 + 0.5;
      let dx = x - kx;
      if (dx > S / 2) dx -= S; else if (dx < -S / 2) dx += S;
      const kd = Math.hypot(dx * 0.45, y - ky) / kr;
      const knot = smoothstep(1.0, 0.55, kd), kring = Math.sin(kd * 9) * 0.5 * smoothstep(1.8, 0.8, kd);
      const w = smoothstep(0.52, 0.78, wth[i]) * 0.16;
      let g = 0.38 + ring * 0.1 + (gr - 0.5) * 0.3 + tone - knot * 0.17 + kring * 0.04 - w + (fine[i] - 0.5) * 0.04;
      g += round * 0.04; // abgegriffene Kanten etwas heller
      let H = 0.62 + ring * 0.08 + (gr - 0.5) * 0.18 - knot * 0.1 - round * 0.25 + (fine[i] - 0.5) * 0.04;
      g = g * (1 - gap) + 0.05 * gap; H = H * (1 - gap);
      // Nägel
      for (const nx of nails) {
        const nd = Math.hypot(x - nx, y - (pi + 0.5) * ph) / (4 * k);
        if (nd < 1.6) { const nb = smoothstep(1.0, 0.7, nd); g += (0.16 - g) * nb; H += nb * 0.25 - smoothstep(1.6, 1.0, nd) * (1 - nb) * 0.1; }
      }
      h[i] = H;
      setPx(p, i, g * tint[0], g * 0.72 * tint[1], g * 0.48 * tint[2]);
    }
  }
  return done(p, 0.008);
}

// Alte Diner-Fliesen (Kachel = 2 × 2 m, 8 × 8 Fliesen à 25 cm): Creme und Dunkelgrün statt
// Schwarz-Weiß, jede Fliese leicht anders getönt und minimal verkippt, schmutzige Fugen,
// abgeschlagene Ecken, gesprungene Fliesen, Absatzspuren, stumpfe Laufwege, kleine Pfützen
export function checkerTiles(seed = 11) {
  const S = sz(512), k = S / 512, r = mulberry32(seed), TL = 8, tp = S / TL;
  const big = field(seed, S, 2, 2, 4), mid = field(seed + 1, S, 12, 12, 3), fine = field(seed + 2, S, 64, 64, 2);
  const wetF = field(seed + 3, S, 4, 4, 3);
  const pud = quantile(wetF, 0.025), dmp = quantile(wetF, 0.06);
  // Masken: R = Absatz- und Schleifspuren (dunkel), G = Sprünge, B = feine Kratzer (stumpf, hell)
  const mc = maskCanvas(S);
  for (let n = 0; n < 70; n++) {
    const x = r() * S, y = r() * S, a = r() * 6.3, l = (0.01 + r() * 0.03) * S, al = 0.15 + r() * 0.35, lw = (1 + r() * 2.5) * k;
    wrapDraw(mc, S, x - l, y - l, x + l, y + l, (c) => {
      c.strokeStyle = `rgba(255,0,0,${al})`; c.lineWidth = lw;
      c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + Math.cos(a + 0.5) * l * 0.6, y + Math.sin(a + 0.5) * l * 0.6, x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
    });
  }
  for (let n = 0; n < 160; n++) {
    const x = r() * S, y = r() * S, a = r() * 6.3, l = (0.01 + r() * 0.05) * S, al = 0.08 + r() * 0.15;
    wrapDraw(mc, S, x - l, y - l, x + l, y + l, (c) => {
      c.strokeStyle = `rgba(0,0,255,${al})`; c.lineWidth = 0.7 * k;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
    });
  }
  // gesprungene Fliesen: Riss von Kante zu Kante, bleibt in der Fliese
  for (let iv = 0; iv < TL; iv++) for (let iu = 0; iu < TL; iu++) {
    if (hash(iu, iv, seed + 5) > 0.1) continue;
    const x0 = iu * tp, y0 = iv * tp, a = r() * 6.3;
    const cx = x0 + tp * (0.3 + r() * 0.4), cy = y0 + tp * (0.3 + r() * 0.4);
    mc.save(); mc.beginPath(); mc.rect(x0 + 1, y0 + 1, tp - 2, tp - 2); mc.clip();
    for (const dir of [0, Math.PI]) crack(mc, S, r, cx / S, cy / S, a + dir, 0.12, 0.004, 0.9 * k, 0.5, 0.05, 'rgba(0,255,0,1)');
    mc.restore();
  }
  const mk = readMask(mc, S);
  const p = surface(S, true), h = p.h, gw = Math.max(0.7, 1.1 * k);
  for (let y = 0, i = 0; y < S; y++) {
    const iv = (y / tp) | 0, fy = y + 0.5 - iv * tp;
    for (let x = 0; x < S; x++, i++) {
      const iu = (x / tp) | 0, fx = x + 0.5 - iu * tp;
      const id = hash(iu, iv, seed), id2 = hash(iu, iv, seed + 1), id3 = hash(iu, iv, seed + 2);
      const cream = ((iu + iv) & 1) === 0;
      const ed = Math.min(Math.min(fx, tp - fx), Math.min(fy, tp - fy)); // Pixel zur Fuge
      const grout = smoothstep(gw + 0.6, gw - 0.4, ed);
      const bevel = smoothstep(gw + 2.5 * k, gw + 0.3, ed);
      // abgeschlagene Ecken: Abstand zur nächsten Fliesenecke
      const cxd = Math.min(fx, tp - fx), cyd = Math.min(fy, tp - fy);
      const corner = (fx < tp / 2 ? 0 : 1) + (fy < tp / 2 ? 0 : 2);
      const chipR = hash(iu * 4 + corner, iv, seed + 3) < 0.22 ? (3 + hash(iu, iv * 4 + corner, seed + 4) * 7) * k : 0;
      const chip = chipR ? smoothstep(chipR + 0.8, chipR - 0.8, Math.hypot(cxd, cyd) + (fine[i] - 0.5) * 6 * k) * (1 - grout) : 0;
      const m = mid[i], f = fine[i];
      // Grundfarbe je Fliese; selten eine ersetzte, etwas andere Fliese
      const odd = id3 < 0.05 ? 1 : 0;
      let R, G, B;
      if (cream) {
        const t = 0.9 + id * 0.12 - odd * 0.08;
        R = 0.7 * t; G = 0.665 * t; B = (0.565 + odd * 0.04) * t;
      } else {
        const t = 0.85 + id * 0.3 + odd * 0.25;
        R = 0.085 * t; G = 0.112 * t; B = 0.098 * t;
      }
      R += (f - 0.5) * 0.03; G += (f - 0.5) * 0.03; B += (f - 0.5) * 0.025;
      // Glasur: glänzend, je Fliese etwas anders; Laufwege stumpf und schmutzig
      const wear = smoothstep(0.5, 0.72, big[i] + (m - 0.5) * 0.4);
      let rough = 0.2 + id2 * 0.08 + wear * 0.3;
      const scr = mk[i * 4 + 2] / 255;
      R += (0.3 - R) * scr * (cream ? 0 : 0.6); G += (0.3 - G) * scr * (cream ? 0 : 0.6); B += (0.28 - B) * scr * (cream ? 0 : 0.6);
      rough += scr * 0.3;
      const heel = mk[i * 4] / 255;
      R *= 1 - heel * 0.55; G *= 1 - heel * 0.55; B *= 1 - heel * 0.52;
      // Schmutz: in Fugennähe und auf Laufwegen
      const dirtE = smoothstep(gw + 6 * k, gw, ed) * 0.3, dirtW = wear * 0.22 + smoothstep(0.55, 0.75, m) * 0.12;
      const dk = 1 - dirtE - dirtW;
      R *= dk; G *= dk * 0.98; B *= dk * 0.93;
      // leichte Verkippung je Fliese, gerundete Glasurkante
      let H = 0.7 + (id - 0.5) * 0.04 + (id2 - 0.5) * 0.06 * (fx / tp - 0.5) + (id3 - 0.5) * 0.06 * (fy / tp - 0.5) + (f - 0.5) * 0.01;
      H -= bevel * 0.12;
      // abgeschlagen: Scherben-Körper sichtbar, rau, vertieft
      if (chip > 0) {
        const cb = cream ? 0.42 : 0.3;
        R += (cb - R) * chip; G += (cb * 0.95 - G) * chip; B += (cb * 0.86 - B) * chip;
        rough += (0.9 - rough) * chip; H -= chip * 0.2;
      }
      // Sprünge
      const cr = (mk[i * 4 + 1] / 255) * (1 - grout);
      R *= 1 - cr * 0.6; G *= 1 - cr * 0.6; B *= 1 - cr * 0.6; H -= cr * 0.15; rough += cr * 0.2;
      // Fuge: dunkel, schmutzig, vertieft
      const gk = 0.2 + (m - 0.5) * 0.1;
      R += (gk - R) * grout; G += (gk * 0.9 - G) * grout; B += (gk * 0.75 - B) * grout;
      H += (0.3 + (f - 0.5) * 0.05 - H) * grout; rough += (0.92 - rough) * grout;
      // kleine Pfützen (verschüttet, gewischt)
      const puddle = smoothstep(pud + 0.004, pud - 0.004, wetF[i]), damp = smoothstep(dmp, pud, wetF[i]);
      rough += (0.12 - rough) * damp * 0.7;
      rough += (0.05 - rough) * puddle;
      H += (0.72 - H) * puddle;
      const wk = 1 - damp * 0.06 - grout * damp * 0.3;
      h[i] = H;
      setPx(p, i, R * wk, G * wk, B * wk, rough);
    }
  }
  cavity(p, Math.max(1, Math.round(2 * k)), 2.2);
  return done(p, 0.004);
}

// Kopfsteinpflaster (Kachel = 2 × 2 m): Reihen aus Granitsteinen (≈ 15–20 cm), gewölbt,
// gedämpftes Grau/Braun, dunkle Fugen mit Erde und Moos, einige Steine und Senken nass
export function cobble(seed = 13) {
  const S = sz(512), k = S / 512, r = mulberry32(seed), ROWS = 12;
  const mid = field(seed, S, 24, 24, 3), fine = field(seed + 1, S, 96, 96, 2), grit = field(seed + 2, S, S >> 1, S >> 1, 1);
  const moss = field(seed + 3, S, 6, 6, 3), wetF = field(seed + 4, S, 3, 3, 4), wav = field(seed + 5, S, 3, 3, 2);
  const pud = quantile(wetF, 0.07), wetT = quantile(wetF, 0.2);
  // je Reihe Steine mit zufälliger Breite (Summe = Kachelbreite), Reihen gegeneinander versetzt
  const rowE = [], rowO = [];
  for (let j = 0; j < ROWS; j++) {
    const n = 10 + Math.floor(r() * 4), w = [];
    let sum = 0;
    for (let q = 0; q < n; q++) { w.push(0.75 + r() * 0.5); sum += w[q]; }
    const e = [0];
    for (let q = 0; q < n; q++) e.push(e[q] + w[q] / sum);
    rowE.push(e); rowO.push(r());
  }
  const p = surface(S, true), h = p.h, RH = 2 / ROWS; // Reihenhöhe in Metern
  for (let y = 0, i = 0; y < S; y++) {
    for (let x = 0; x < S; x++, i++) {
      const u = (x + 0.5) / S, v = (y + 0.5) / S;
      const vw = v + (wav[i] - 0.5) * 0.012; // Reihen leicht gewellt
      const rv = vw * ROWS, row = Math.floor(rv), fy = rv - row, rj = ((row % ROWS) + ROWS) % ROWS;
      const e = rowE[rj];
      let uu = u + rowO[rj];
      uu -= Math.floor(uu);
      let q = 1;
      while (q < e.length - 1 && e[q] <= uu) q++;
      const s0 = e[q - 1], s1 = e[q], W = (s1 - s0) * 2; // Steinbreite in Metern
      const sid = hash(rj, q, seed), sid2 = hash(rj, q, seed + 1), sid3 = hash(rj, q, seed + 2);
      // abgerundetes Rechteck mit unruhigem Rand
      const lx = ((uu - s0) / (s1 - s0) - 0.5) * W, ly = (fy - 0.5) * RH;
      const jt = 0.008 + sid3 * 0.006, rad = 0.02 + sid2 * 0.02;
      const qx = Math.abs(lx) - (W / 2 - jt - rad), qy = Math.abs(ly) - (RH / 2 - jt - rad);
      const sdf = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad + (mid[i] - 0.5) * 0.014;
      const inS = smoothstep(0.0015, -0.0015, sdf), ein = Math.max(0, -sdf);
      const g = grit[i], speck = (g > 0.75 ? (g - 0.75) * 1.5 : 0) - (g < 0.2 ? (0.2 - g) * 1.2 : 0);
      // Steinfarbe: Granitgrau, warmes Grau oder dunkler Basalt
      let R, G, B;
      if (sid < 0.58) { R = 0.42; G = 0.415; B = 0.4; } else if (sid < 0.85) { R = 0.44; G = 0.4; B = 0.35; } else { R = 0.28; G = 0.28; B = 0.29; }
      const t = 0.82 + sid2 * 0.3 + (mid[i] - 0.5) * 0.15 + speck * 0.5 + (fine[i] - 0.5) * 0.06;
      const top = smoothstep(0.02, 0.05, ein); // abgelaufene Oberseite: heller, glatter
      R *= t + top * 0.05; G *= t + top * 0.05; B *= t + top * 0.05;
      let H = 0.3 + 0.42 * Math.pow(smoothstep(0, 0.04, ein), 0.7) + (sid3 - 0.5) * 0.08 + (fine[i] - 0.5) * 0.05 + speck * 0.04;
      let rough = 0.82 - top * 0.16 + (fine[i] - 0.5) * 0.08;
      // Fuge: Erde, Sand, Moos
      const mo = smoothstep(0.5, 0.68, moss[i]) * (1 - inS * smoothstep(0.012, 0.0, ein));
      const jR = 0.13 + mo * 0.0, jG = 0.11 + mo * 0.04, jB = 0.085 - mo * 0.01, jk = 0.85 + (fine[i] - 0.5) * 0.4;
      R += (jR * jk - R) * (1 - inS) + (0.12 - R) * mo * inS * 0.6;
      G += (jG * jk - G) * (1 - inS) + (0.15 - G) * mo * inS * 0.6;
      B += (jB * jk - B) * (1 - inS) + (0.07 - B) * mo * inS * 0.6;
      H = H * inS + (0.12 + (fine[i] - 0.5) * 0.06) * (1 - inS);
      rough += (0.95 - rough) * (1 - inS);
      // Nässe: nasse Steine dunkler und glänzend, in Senken Wasser bis über die Fugen
      const wet = smoothstep(wetT, pud, wetF[i] + (sid - 0.5) * 0.02);
      const wl = smoothstep(pud + 0.02, pud - 0.03, wetF[i]) * 0.62; // Wasserstand
      const water = wl > 0.05 ? smoothstep(-0.01, 0.015, wl - H) : 0;
      const wk = 1 - wet * 0.38;
      R *= wk; G *= wk; B *= wk;
      rough += (0.2 - rough) * wet;
      rough += (0.04 - rough) * water;
      H += (wl - H) * water;
      h[i] = H;
      setPx(p, i, R, G, B, rough);
    }
  }
  cavity(p, Math.max(1, Math.round(2 * k)), 2.4);
  return done(p, 0.008);
}

// Erdboden (Kachel ≈ 5 m): Kiesel mit Schatten, trockene und feuchte Stellen, vereinzelte
// Grasbüschel, kleine Pfützen in Senken
export function dirt(seed = 17) {
  const S = sz(512), k = S / 512, CELL = 24; // Kiesel-Raster je Kachel
  const big = field(seed, S, 2, 2, 4), mid = field(seed + 1, S, 8, 8, 4), fine = field(seed + 2, S, 64, 64, 2);
  const grs = field(seed + 3, S, 6, 6, 3);
  const pud = quantile(big, 0.035), dmp = quantile(big, 0.12);
  const p = surface(S, true), h = p.h, cs = S / CELL;
  for (let y = 0, i = 0; y < S; y++) {
    const cy = (y / cs) | 0;
    for (let x = 0; x < S; x++, i++) {
      const cx = (x / cs) | 0;
      const m = mid[i], f = fine[i];
      // Kiesel: je Rasterzelle höchstens einer, versetzt und unterschiedlich groß
      let peb = 0, pid = 0;
      for (let j = -1; j <= 1; j++) for (let q = -1; q <= 1; q++) {
        const gx = (cx + q + CELL) % CELL, gy = (cy + j + CELL) % CELL;
        const hh = hash(gx, gy, seed);
        if (hh > 0.2) continue;
        const px = (cx + q + 0.2 + hash(gx, gy, seed + 1) * 0.6) * cs, py = (cy + j + 0.2 + hash(gx, gy, seed + 2) * 0.6) * cs;
        const rad = (0.14 + hh * 1.3) * cs;
        const d = Math.hypot(x + 0.5 - px, (y + 0.5 - py) * 1.25) / rad + (f - 0.5) * 0.9; // unregelmäßiger Umriss
        if (d < 1) { const t = 1 - d * d; if (t > peb) { peb = t; pid = hh; } }
      }
      let L = 0.21 + (big[i] - 0.5) * 0.08 + (m - 0.5) * 0.12 + (f - 0.5) * 0.05;
      let R = L * 1.08, G = L * 0.93, B = L * 0.74;
      let H = 0.45 + (m - 0.5) * 0.2 + (f - 0.5) * 0.12;
      let rough = 0.93;
      if (peb > 0) {
        const pk = 0.17 + pid * 0.35 + (f - 0.5) * 0.08, pe = smoothstep(0, 0.45, peb) * 0.8; // Kiesel nur wenig heller als der Boden
        R += (pk * 1.02 - R) * pe; G += (pk * 0.98 - G) * pe; B += (pk * 0.9 - B) * pe;
        H += Math.sqrt(peb) * 0.3;
        rough -= pe * 0.15;
      }
      // Grasbüschel (dunkles Oliv)
      const gr = smoothstep(0.64, 0.72, grs[i] + (f - 0.5) * 0.3);
      R += (0.17 - R) * gr; G += (0.19 - G) * gr; B += (0.09 - B) * gr; H += gr * 0.12;
      // Nässe
      const puddle = smoothstep(pud + 0.004, pud - 0.004, big[i]), damp = smoothstep(dmp, pud, big[i] + (f - 0.5) * 0.03);
      const wk = 1 - damp * 0.3;
      R *= wk; G *= wk; B *= wk;
      rough += (0.45 - rough) * damp;
      rough += (0.05 - rough) * puddle;
      H += (0.42 - H) * puddle;
      h[i] = H;
      setPx(p, i, R, G, B, rough);
    }
  }
  cavity(p, Math.max(1, Math.round(2 * k)), 2.4);
  return done(p, 0.007);
}

// Blech: gebürstet, Kratzer, Rostflecken. rough-Karte: G = Rauheit, B = Metall (Rost ist kein Metall)
export function metal(seed = 19, rust = 0.4, base = [0.32, 0.33, 0.35]) {
  const S = sz(512), k = S / 512, r = mulberry32(seed);
  const f8 = field(seed, S, 8, 8, 4), rf = field(seed + 1, S, 4, 4, 5), br = field(seed + 2, S, 4, 128, 2);
  // Kratzer (hell, glatter) in die Maske
  const mc = maskCanvas(S);
  for (let n = 0; n < 70; n++) {
    const x = r() * S, y = r() * S, a = r() * Math.PI, l = (8 + r() * 40) * k, al = 0.15 + r() * 0.35, lw = (0.6 + r() * 0.8) * k;
    wrapDraw(mc, S, x - l, y - l, x + l, y + l, (c) => {
      c.strokeStyle = `rgba(255,0,0,${al})`; c.lineWidth = lw;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
    });
  }
  const mk = readMask(mc, S);
  const p = surface(S, true), h = p.h, t0 = 1 - rust * 0.6;
  for (let i = 0; i < S * S; i++) {
    const f = f8[i], b = (br[i] - 0.5) * 0.08;
    const rv = rf[i] + (f - 0.5) * 0.15;
    const rs = smoothstep(t0, t0 + 0.12, rv), pit = smoothstep(t0 + 0.05, t0 + 0.25, rv);
    let R = base[0] + (f - 0.5) * 0.1 + b, G = base[1] + (f - 0.5) * 0.1 + b, B = base[2] + (f - 0.5) * 0.1 + b;
    const sc = mk[i * 4] / 255 * (1 - rs);
    R += sc * 0.18; G += sc * 0.18; B += sc * 0.19;
    R += (0.34 + f * 0.14 - R) * rs; G += (0.16 + f * 0.06 - G) * rs; B += (0.075 - B) * rs;
    R *= 1 - pit * 0.3; G *= 1 - pit * 0.35; B *= 1 - pit * 0.4;
    h[i] = 0.5 + (f - 0.5) * 0.12 + rs * 0.12 + pit * (f - 0.5) * 0.5 + b * 0.5;
    setPx(p, i, R, G, B, 0.42 + (f - 0.5) * 0.1 - sc * 0.15 + rs * 0.45, 1 - rs * 0.9);
  }
  return done(p, 0.004);
}

// Rollgitter / Rolltor: Lamellen, Rost von unten und in Flecken
export function shutter(seed = 23) {
  const S = sz(512);
  const f6 = field(seed, S, 6, 6, 4), rf = field(seed + 1, S, 3, 3, 5);
  const p = surface(S, true), h = p.h;
  for (let y = 0, i = 0; y < S; y++) {
    const v = (y + 0.5) / S, lv = v * 24, lf = lv - Math.floor(lv);
    // Lamellenprofil: gewölbt, mit Falz
    const prof = Math.sin(lf * Math.PI), fold = smoothstep(0.08, 0.0, lf) + smoothstep(0.92, 1.0, lf);
    for (let x = 0; x < S; x++, i++) {
      const f = f6[i];
      const rs = smoothstep(0.47, 0.64, rf[i] + (v > 0.85 ? 0.15 : 0) + fold * 0.06);
      const g = 0.33 + prof * 0.07 + (f - 0.5) * 0.12 - fold * 0.12;
      const R = g * (1 - rs) + rs * (0.37 + f * 0.1), G = g * (1 - rs) + rs * 0.18, B = g * 1.04 * (1 - rs) + rs * 0.08;
      h[i] = 0.25 + prof * 0.55 - fold * 0.2 + rs * (f - 0.5) * 0.2;
      setPx(p, i, R, G, B, 0.45 + rs * 0.42 + (f - 0.5) * 0.08, 1 - rs * 0.9);
    }
  }
  return done(p, 0.012);
}

export function fabric(seed, base, blood = 0.5) {
  const n = new ValueNoise(seed), r = mulberry32(seed);
  const p = pixels(256, (u, v, o) => {
    const weave = (Math.sin(u * 256 * 1.6) * Math.sin(v * 256 * 1.6)) * 0.04;
    const f = n.fbm(u * 6, v * 6, 4, 6);
    const dirtA = smoothstep(0.5, 0.8, n.fbm(u * 3 + 4, v * 3, 4, 3)) * 0.35;
    const bl = smoothstep(1 - blood * 0.5, 1 - blood * 0.5 + 0.08, n.fbm(u * 5 + 9, v * 5 + 1, 5, 5));
    const tear = smoothstep(0.83, 0.86, n.fbm(u * 7 + 2, v * 7 + 6, 4, 7));
    let cr = base[0] * (0.85 + f * 0.3) + weave, cg = base[1] * (0.85 + f * 0.3) + weave, cb = base[2] * (0.85 + f * 0.3) + weave;
    const k = 1 - dirtA;
    cr *= k; cg *= k; cb *= k;
    cr = cr * (1 - bl) + bl * 0.22; cg = cg * (1 - bl) + bl * 0.02; cb = cb * (1 - bl) + bl * 0.02;
    if (tear) { cr = 0.05; cg = 0.03; cb = 0.03; }
    o.r = cr + (r() - 0.5) * 0.02; o.g = cg; o.b = cb;
    o.h = 0.5 + weave * 4 - tear * 0.5;
  });
  return finish(p);
}

export function skin(seed, base = [0.52, 0.55, 0.47]) {
  const n = new ValueNoise(seed), r = mulberry32(seed);
  const p = pixels(256, (u, v, o) => {
    const f = n.fbm(u * 6, v * 6, 5, 6);
    const bruise = smoothstep(0.55, 0.75, n.fbm(u * 3 + 2, v * 3, 4, 3));
    const vein = smoothstep(0.47, 0.5, n.fbm(u * 10, v * 10, 3, 10)) * smoothstep(0.53, 0.5, n.fbm(u * 10, v * 10, 3, 10));
    const bl = smoothstep(0.7, 0.76, n.fbm(u * 5 + 7, v * 5 + 3, 5, 5));
    let cr = base[0] * (0.8 + f * 0.4), cg = base[1] * (0.8 + f * 0.4), cb = base[2] * (0.8 + f * 0.4);
    cr = cr * (1 - bruise * 0.45) + bruise * 0.1; cg *= 1 - bruise * 0.45; cb = cb * (1 - bruise * 0.45) + bruise * 0.06;
    cr -= vein * 0.1; cg -= vein * 0.09; cb -= vein * 0.05;
    cr = cr * (1 - bl) + bl * 0.25; cg = cg * (1 - bl) + bl * 0.02; cb = cb * (1 - bl) + bl * 0.02;
    o.r = cr + (r() - 0.5) * 0.03; o.g = cg; o.b = cb;
    o.h = f;
  });
  return finish(p);
}

export function bloodDecal(seed = 29) {
  const r = mulberry32(seed);
  const cv = canvas(256);
  const c = cv.getContext('2d');
  const blob = (x, y, rad, a) => {
    const g = c.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(70,0,0,${a})`);
    g.addColorStop(0.7, `rgba(55,0,0,${a * 0.9})`);
    g.addColorStop(1, 'rgba(40,0,0,0)');
    c.fillStyle = g; c.beginPath(); c.arc(x, y, rad, 0, 7); c.fill();
  };
  for (let i = 0; i < 18; i++) blob(128 + (r() - 0.5) * 70, 128 + (r() - 0.5) * 70, 20 + r() * 35, 0.85);
  for (let i = 0; i < 40; i++) {
    const a = r() * Math.PI * 2, d = 50 + r() * 70;
    blob(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 2 + r() * 7, 0.9);
  }
  return toTexture(cv, { repeat: false });
}

export function bulletHole() {
  const cv = canvas(64), c = cv.getContext('2d');
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.25, 'rgba(10,8,6,0.95)');
  g.addColorStop(0.45, 'rgba(40,35,30,0.6)');
  g.addColorStop(1, 'rgba(40,35,30,0)');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  return toTexture(cv, { repeat: false });
}

export function glow() {
  const cv = canvas(128), c = cv.getContext('2d');
  const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.6)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.15)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, 128, 128);
  return toTexture(cv, { repeat: false });
}

export function muzzleFlash(seed = 31) {
  const r = mulberry32(seed);
  const cv = canvas(256), c = cv.getContext('2d');
  c.translate(128, 128);
  c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + r() * 0.3;
    const len = 60 + r() * 60;
    const g = c.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
    g.addColorStop(0, 'rgba(255,240,200,0.9)');
    g.addColorStop(0.4, 'rgba(255,160,60,0.5)');
    g.addColorStop(1, 'rgba(255,90,20,0)');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(Math.cos(a + 1.5) * 8, Math.sin(a + 1.5) * 8);
    c.lineTo(Math.cos(a) * len, Math.sin(a) * len);
    c.lineTo(Math.cos(a - 1.5) * 8, Math.sin(a - 1.5) * 8);
    c.fill();
  }
  const g = c.createRadialGradient(0, 0, 0, 0, 0, 50);
  g.addColorStop(0, 'rgba(255,255,240,1)');
  g.addColorStop(0.4, 'rgba(255,200,120,0.6)');
  g.addColorStop(1, 'rgba(255,120,40,0)');
  c.fillStyle = g; c.beginPath(); c.arc(0, 0, 50, 0, 7); c.fill();
  return toTexture(cv, { repeat: false });
}

// Kreidezeichnung einer Waffe (Wall-Buy)
export function chalkWeapon(cls, seed = 37) {
  const r = mulberry32(seed + cls.length * 13);
  const cv = canvas(512, 256), c = cv.getContext('2d');
  const shapes = CHALK_SHAPES[cls] || CHALK_SHAPES.ar;
  c.lineCap = 'round';
  for (let pass = 0; pass < 3; pass++) {
    for (const s of shapes) {
      c.strokeStyle = `rgba(235,232,220,${0.35 + r() * 0.3})`;
      c.lineWidth = 2 + r() * 2.5;
      c.beginPath();
      s.forEach(([x, y], i) => {
        const jx = x * 4.8 + 16 + (r() - 0.5) * 3, jy = y * 2.4 + 8 + (r() - 0.5) * 3;
        i ? c.lineTo(jx, jy) : c.moveTo(jx, jy);
      });
      c.stroke();
    }
  }
  // Kreidestaub
  for (let i = 0; i < 400; i++) {
    c.fillStyle = `rgba(230,230,220,${r() * 0.12})`;
    c.fillRect(40 + r() * 430, 40 + r() * 170, 1.5, 1.5);
  }
  return toTexture(cv, { repeat: false });
}

const CHALK_SHAPES = {
  rifle: [[[0, 40], [20, 36], [60, 36], [62, 42], [96, 42], [96, 46], [60, 48], [40, 50], [22, 62], [2, 60], [0, 40]], [[52, 48], [56, 66], [62, 66], [60, 48]], [[62, 40], [98, 40]]],
  shotgun2: [[[0, 44], [24, 38], [40, 40], [98, 40], [98, 47], [40, 47], [30, 52], [6, 62], [0, 44]], [[40, 43.5], [98, 43.5]], [[34, 47], [36, 56], [40, 56]]],
  smg: [[[10, 40], [30, 36], [70, 36], [70, 46], [52, 46], [50, 74], [44, 74], [44, 46], [34, 46], [32, 58], [26, 58], [26, 46], [10, 46], [10, 40]], [[70, 40], [86, 40]], [[0, 38], [10, 40], [10, 46], [0, 48], [0, 38]]],
  shotgun: [[[0, 42], [22, 37], [44, 38], [98, 38], [98, 44], [44, 45], [34, 50], [8, 62], [0, 42]], [[56, 46], [86, 46], [86, 51], [56, 51], [56, 46]]],
  grenade: [[[40, 30], [52, 26], [62, 30], [66, 44], [62, 62], [52, 68], [42, 62], [38, 44], [40, 30]], [[50, 26], [50, 18], [60, 18], [62, 26]], [[56, 18], [66, 12], [70, 16]]],
  ar: [[[0, 42], [24, 36], [62, 36], [62, 40], [96, 40], [96, 44], [62, 46], [48, 46], [46, 64], [40, 64], [38, 46], [24, 50], [2, 58], [0, 42]], [[30, 36], [32, 30], [52, 30], [54, 36]]],
};

export function perkSign(name, color) {
  const cv = canvas(512, 160), c = cv.getContext('2d');
  c.fillStyle = '#0b0a0a'; c.fillRect(0, 0, 512, 160);
  c.strokeStyle = color; c.lineWidth = 6; c.shadowColor = color; c.shadowBlur = 18;
  c.strokeRect(12, 12, 488, 136);
  c.font = 'bold 54px Oswald, Impact, sans-serif';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = '#fff';
  c.fillText(name.toUpperCase(), 256, 84);
  c.shadowBlur = 30; c.fillStyle = color; c.globalAlpha = 0.6;
  c.fillText(name.toUpperCase(), 256, 84);
  return toTexture(cv, { repeat: false });
}

export function textSign(text, color, bg = '#0b0a0a', w = 512, h = 160, font = 'bold 72px Oswald, Impact, sans-serif') {
  const cv = canvas(w, h), c = cv.getContext('2d');
  c.fillStyle = bg; c.fillRect(0, 0, w, h);
  c.font = font; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.shadowColor = color; c.shadowBlur = 24; c.fillStyle = color;
  c.fillText(text, w / 2, h / 2 + 4);
  c.shadowBlur = 0; c.fillStyle = '#fff'; c.globalAlpha = 0.85;
  c.fillText(text, w / 2, h / 2 + 4);
  return toTexture(cv, { repeat: false });
}

export function papCamo(seed = 41) {
  const n = new ValueNoise(seed);
  const p = pixels(256, (u, v, o) => {
    const f = n.fbm(u * 4, v * 4, 5, 4);
    const s = Math.sin((f * 6 + u * 2) * Math.PI * 2) * 0.5 + 0.5;
    const k = smoothstep(0.3, 1.0, s);
    const vein = smoothstep(0.85, 1.0, s);
    o.r = 0.08 + k * 0.25 + vein * 0.5; o.g = 0.03 + k * 0.08 + vein * 0.4; o.b = 0.2 + k * 0.4 + vein * 0.5;
    o.h = k;
  });
  return toTexture(p.col);
}

export function boxSide() {
  const cv = canvas(512, 256), c = cv.getContext('2d');
  c.clearRect(0, 0, 512, 256);
  c.font = 'bold 170px Creepster, Impact, serif';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.shadowColor = '#7fe8ff'; c.shadowBlur = 25; c.fillStyle = '#c8f6ff';
  c.fillText('?', 140, 140); c.fillText('?', 372, 140);
  return toTexture(cv, { repeat: false });
}

export function powerupIcon(type) {
  const cv = canvas(256), c = cv.getContext('2d');
  c.translate(128, 128);
  c.shadowColor = '#7dff7a'; c.shadowBlur = 30;
  c.fillStyle = '#f2d36b'; c.strokeStyle = '#f2d36b'; c.lineWidth = 10;
  if (type === 'maxammo') {
    for (let i = -1; i <= 1; i++) {
      c.beginPath(); c.roundRect(i * 42 - 14, -40, 28, 90, 6); c.fill();
      c.beginPath(); c.ellipse(i * 42, -42, 14, 30, 0, Math.PI, 0); c.fill();
    }
  } else if (type === 'instakill') {
    c.beginPath(); c.ellipse(0, -15, 70, 66, 0, 0, Math.PI * 2); c.fill();
    c.fillRect(-40, 30, 80, 45);
    c.globalCompositeOperation = 'destination-out';
    c.beginPath(); c.ellipse(-26, -12, 18, 22, 0, 0, 7); c.fill();
    c.beginPath(); c.ellipse(26, -12, 18, 22, 0, 0, 7); c.fill();
    c.beginPath(); c.moveTo(0, 18); c.lineTo(-10, 34); c.lineTo(10, 34); c.fill();
    for (let i = -2; i <= 2; i++) c.fillRect(i * 15 - 3, 52, 6, 24);
  } else if (type === 'double') {
    c.font = 'bold 150px Oswald, Impact, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('×2', 0, 8);
  } else if (type === 'nuke') {
    c.beginPath(); c.ellipse(0, 10, 52, 70, 0, 0, Math.PI * 2); c.fill();
    c.fillRect(-36, -95, 72, 30);
    c.globalCompositeOperation = 'destination-out';
    c.lineWidth = 6;
    c.beginPath(); c.arc(0, 10, 14, 0, 7); c.fill();
    for (let i = 0; i < 3; i++) {
      c.beginPath(); c.moveTo(0, 10); c.arc(0, 10, 44, i * 2.094 - 0.5, i * 2.094 + 0.5); c.closePath(); c.fill();
    }
  } else if (type === 'carpenter') {
    c.save(); c.rotate(-0.6);
    c.fillRect(-10, -20, 20, 120);
    c.beginPath(); c.roundRect(-55, -55, 110, 38, 8); c.fill();
    c.restore();
  } else if (type === 'firesale') {
    // Preisschild mit Loch, darüber eine Flamme, darauf „10“
    c.save(); c.rotate(-0.25);
    c.beginPath();
    c.moveTo(-62, -18); c.lineTo(-30, -52); c.lineTo(66, -52); c.lineTo(66, 58); c.lineTo(-30, 58); c.lineTo(-62, 24);
    c.closePath(); c.fill();
    c.globalCompositeOperation = 'destination-out';
    c.beginPath(); c.arc(-36, 3, 10, 0, 7); c.fill();
    c.font = 'bold 74px Oswald, Impact, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('10', 20, 6);
    c.restore();
    c.globalCompositeOperation = 'source-over';
    c.beginPath();
    c.moveTo(-6, -64);
    c.bezierCurveTo(-40, -82, -22, -110, -14, -124);
    c.bezierCurveTo(-4, -104, 10, -110, 6, -128);
    c.bezierCurveTo(34, -108, 38, -80, 14, -64);
    c.closePath(); c.fill();
  }
  return toTexture(cv, { repeat: false });
}

export function moon() {
  const n = new ValueNoise(43);
  const cv = canvas(256), c = cv.getContext('2d');
  const img = c.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const dx = (x - 128) / 100, dy = (y - 128) / 100, d = Math.hypot(dx, dy);
    const i = (y * 256 + x) * 4;
    const f = n.fbm(x / 32, y / 32, 5, 8);
    const a = d < 1 ? 1 : Math.max(0, 1 - (d - 1) * 3) * 0.4;
    const g = d < 1 ? 0.75 + f * 0.35 - smoothstep(0.55, 0.7, f) * 0.25 : 0.8;
    img.data[i] = g * 255; img.data[i + 1] = g * 250; img.data[i + 2] = g * 235; img.data[i + 3] = a * 255;
  }
  c.putImageData(img, 0, 0);
  return toTexture(cv, { repeat: false });
}

export function poster(seed, title) {
  const r = mulberry32(seed);
  const cv = canvas(256, 360), c = cv.getContext('2d');
  c.fillStyle = `hsl(${30 + r() * 20},25%,${60 + r() * 15}%)`; c.fillRect(0, 0, 256, 360);
  c.fillStyle = '#5a1010'; c.font = 'bold 40px Oswald, Impact, sans-serif'; c.textAlign = 'center';
  c.fillText(title, 128, 60);
  c.fillStyle = '#222'; c.font = '16px "Special Elite", Courier, monospace';
  for (let i = 0; i < 12; i++) c.fillRect(30, 100 + i * 18, 196 * (0.5 + r() * 0.5), 6);
  c.fillStyle = 'rgba(80,40,10,0.35)';
  for (let i = 0; i < 6; i++) { c.beginPath(); c.arc(r() * 256, r() * 360, 10 + r() * 40, 0, 7); c.fill(); }
  return toTexture(cv, { repeat: false });
}

// Stahltür mit Warnstreifen und Beschriftung (Strom- bzw. Turbinentüren)
export function hazardDoor(label, color) {
  const cv = canvas(512, 512), c = cv.getContext('2d');
  const r = mulberry32(label.length * 31);
  c.fillStyle = '#3a3c3e'; c.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 900; i++) { c.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${r() * 0.06})`; c.fillRect(r() * 512, r() * 512, 3, 3); }
  // Nieten und Paneele
  c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 6;
  for (const y of [130, 380]) { c.beginPath(); c.moveTo(0, y); c.lineTo(512, y); c.stroke(); }
  // Warnstreifen unten und oben
  for (const y0 of [0, 452]) {
    c.save(); c.beginPath(); c.rect(0, y0, 512, 60); c.clip();
    for (let x = -60; x < 560; x += 60) { c.fillStyle = color; c.beginPath(); c.moveTo(x, y0 + 60); c.lineTo(x + 30, y0 + 60); c.lineTo(x + 60, y0); c.lineTo(x + 30, y0); c.fill(); }
    c.restore();
  }
  c.font = 'bold 64px Oswald, Impact, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = '#111'; c.fillRect(96, 216, 320, 80);
  c.shadowColor = color; c.shadowBlur = 16; c.fillStyle = color;
  c.fillText(label, 256, 258);
  // Rost
  for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(110,50,20,${0.1 + r() * 0.2})`; c.beginPath(); c.arc(r() * 512, r() * 512, 4 + r() * 20, 0, 7); c.fill(); }
  return toTexture(cv, { repeat: false });
}

// ── Texturen für große Außenkarten ─────────────────────────────

// Wiese (Kachel ≈ 6 m): verdorrte Grasbüschel mit strahlenförmigen Halmen, dazwischen Streu,
// Mischung aus Oliv und Stroh, kahle Erdstellen
export function grass(seed = 51) {
  const S = sz(512), C = 40, cs = S / C;
  const big = field(seed, S, 2, 2, 4), mid = field(seed + 1, S, 8, 8, 3), fine = field(seed + 2, S, 96, 96, 2);
  const bare = quantile(mid, 0.86), thin = quantile(mid, 0.7);
  // Büschel je Rasterzelle: Mittelpunkt, Radius, Farbton; in kahlen Stellen fehlen sie
  const n = C * C, ox = new Float32Array(n), oy = new Float32Array(n), rad = new Float32Array(n), hue = new Float32Array(n), on = new Uint8Array(n);
  for (let j = 0; j < C; j++) for (let q = 0; q < C; q++) {
    const c = j * C + q;
    ox[c] = (0.15 + hash(q, j, seed) * 0.7) * cs; oy[c] = (0.15 + hash(q, j, seed + 1) * 0.7) * cs;
    rad[c] = (0.6 + hash(q, j, seed + 2) * 0.55) * cs; hue[c] = hash(q, j, seed + 3);
    const mv = mid[Math.min(S - 1, (j * cs + oy[c]) | 0) * S + Math.min(S - 1, (q * cs + ox[c]) | 0)];
    on[c] = hash(q, j, seed + 4) > smoothstep(thin, bare, mv) * 0.9 ? 1 : 0;
  }
  const p = surface(S, false), h = p.h;
  for (let y = 0, i = 0; y < S; y++) {
    const gy = (y / cs) | 0;
    for (let x = 0; x < S; x++, i++) {
      const gx = (x / cs) | 0;
      let best = 9, bc = -1, bdx = 0, bdy = 0;
      for (let j = -1; j <= 1; j++) for (let q = -1; q <= 1; q++) {
        const cx = (gx + q + C) % C, cy = (gy + j + C) % C, c = cy * C + cx;
        if (!on[c]) continue;
        const dx = x + 0.5 - ((gx + q) * cs + ox[c]), dy = y + 0.5 - ((gy + j) * cs + oy[c]);
        const d = Math.sqrt(dx * dx + dy * dy) / rad[c];
        if (d < best) { best = d; bc = c; bdx = dx; bdy = dy; }
      }
      const f = fine[i], m = mid[i];
      // Streu und Erde zwischen den Büscheln, kahle Stellen heller und brauner
      const bareK = smoothstep(thin, bare, m);
      let L = 0.12 + (f - 0.5) * 0.05;
      let R = L * 1.12 + bareK * 0.09, G = L * 0.98 + bareK * 0.06, B = L * 0.68 + bareK * 0.035;
      let H = 0.12 + (f - 0.5) * 0.08;
      if (best < 1) {
        const inC = 1 - best;
        // Halme strahlen vom Büschelmittelpunkt aus
        const phi = Math.atan2(bdy, bdx) * 4.456 + hue[bc] * 40;
        const bl = hash(Math.floor(phi), bc, seed + 5), blf = phi - Math.floor(phi);
        const stripe = (0.65 + bl * 0.5) * (0.75 + 0.25 * Math.sin(blf * Math.PI));
        const t = clamp((big[i] - 0.5) * 2.2 + 0.45 + (hue[bc] - 0.5) * 0.7, 0, 1); // 0 oliv … 1 Stroh
        const kk = (0.5 + 0.62 * inC) * stripe * (0.94 + (f - 0.5) * 0.25);
        const cR = (0.25 + t * 0.17) * kk, cG = (0.27 + t * 0.09) * kk, cB = (0.13 + t * 0.08) * kk;
        const cov = smoothstep(0.0, 0.35, inC);
        R += (cR - R) * cov; G += (cG - G) * cov; B += (cB - B) * cov;
        H += (0.2 + inC * 0.55 + (stripe - 0.9) * 0.25 - H) * cov;
      }
      h[i] = H;
      setPx(p, i, R, G, B);
    }
  }
  return done(p, 0.004);
}

// Asphalt; v läuft entlang der Straße (eine Kachel ≈ 8 m), u quer (0 … 1 = ganze Breite 8 m).
// Dunklere, glattere Fahrspuren mit Spurrinnen (dort Pfützen), Längs- und Querrisse, vergossene
// Risse (Bitumen), Flickstellen, Ölspur in Fahrstreifenmitte, abgefahrene Markierung, Bankett
export function asphalt(seed = 53) {
  const S = sz(512), k = S / 512, r = mulberry32(seed);
  const mid = field(seed, S, 6, 6, 4), fine = field(seed + 1, S, 64, 64, 2), grit = field(seed + 2, S, S >> 1, S >> 1, 1);
  const wetF = field(seed + 3, S, 6, 2, 3), wear = field(seed + 4, S, 40, 40, 2);
  // Masken: R = Risse, G = Bitumenverguss, B = Flickstellen
  const mc = maskCanvas(S);
  for (let n = 0; n < 5; n++) { // Längsrisse am Rand der Fahrspuren und an der Mittelnaht
    const u0 = [0.115, 0.385, 0.5, 0.615, 0.885][n] + (r() - 0.5) * 0.03;
    crack(mc, S, r, u0, r(), Math.PI / 2 + (r() - 0.5) * 0.2, 0.3 + r() * 0.5, 0.005, (1.2 + r()) * k, 0.25, 0.02, 'rgba(255,0,0,1)');
  }
  for (let n = 0; n < 4; n++) crack(mc, S, r, 0.05 + r() * 0.9, r(), (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.4, 0.15 + r() * 0.35, 0.005, (1 + r()) * k, 0.35, 0.03, 'rgba(255,0,0,1)');
  for (let n = 0; n < 3; n++) { // vergossene Risse: breiter, schwarz, glänzend
    const u0 = 0.1 + r() * 0.8, v0 = r();
    crack(mc, S, r, u0, v0, Math.PI / 2 + (r() - 0.5) * 0.4, 0.2 + r() * 0.4, 0.006, (4 + r() * 3) * k, 0.2, 0, 'rgba(0,255,0,0.9)');
  }
  for (let n = 0; n < 2; n++) { // Flickstellen
    const x = (0.1 + r() * 0.8) * S, y = r() * S, w = (0.12 + r() * 0.15) * S, hh = (0.08 + r() * 0.2) * S, a = (r() - 0.5) * 0.1;
    wrapDraw(mc, S, x - w, y - hh, x + w, y + hh, (c) => {
      c.save(); c.translate(x, y); c.rotate(a); c.fillStyle = 'rgba(0,0,255,1)'; c.fillRect(-w / 2, -hh / 2, w, hh); c.restore();
    });
  }
  const mk = readMask(mc, S);
  // Alligatorrisse in einer Fahrspur: Zellmuster nur in einem Bereich
  const AL = 22, aPts = [];
  for (let q = 0; q < AL * AL; q++) aPts.push([r(), r()]);
  const ay0 = r();
  const p = surface(S, true), h = p.h;
  const pud = quantile(wetF, 0.07), dmp = quantile(wetF, 0.16);
  for (let y = 0, i = 0; y < S; y++) {
    const v = (y + 0.5) / S;
    // Mittellinie gestrichelt (Periode 4 m)
    const dash = (v * 2) % 1 < 0.55;
    for (let x = 0; x < S; x++, i++) {
      const u = (x + 0.5) / S, f = fine[i], m = mid[i], g = grit[i], q4 = i * 4;
      // Rollspuren (je Fahrstreifen zwei), Ölspur in der Mitte des Fahrstreifens
      let wp = 0;
      for (const c of [0.155, 0.345, 0.655, 0.845]) { const d = (u - c) / 0.045; wp += Math.exp(-d * d); }
      let oilL = 0;
      for (const c of [0.25, 0.75]) { const d = (u - c) / 0.02; oilL += Math.exp(-d * d); }
      const speck = (g > 0.74 ? (g - 0.74) * 1.4 : 0) - (g < 0.2 ? (0.2 - g) * 0.6 : 0);
      let L = 0.16 + (m - 0.5) * 0.06 + (f - 0.5) * 0.04 + speck * 0.25 * (1 - wp * 0.5);
      L *= 1 - wp * 0.14 - oilL * smoothstep(0.4, 0.65, m) * 0.25;
      let rough = 0.9 - wp * 0.2 - oilL * 0.1 + (f - 0.5) * 0.06;
      let H = 0.5 + (f - 0.5) * 0.12 + speck * 0.15 - wp * 0.1;
      // Flickstelle: schwärzer, feiner, leicht erhaben
      const pt = mk[q4 + 2] / 255;
      L += (0.12 + (f - 0.5) * 0.02 - L) * pt; rough += (0.78 - rough) * pt; H += pt * 0.04;
      let R = L, G = L, B = L * 1.04;
      // Alligatorrisse im Bereich einer Rollspur
      let al = 0;
      const av = (v - ay0 + 1) % 1;
      if (av < 0.3 && Math.abs(u - 0.345) < 0.06) {
        const ax = u * AL, ayy = v * AL, ix = Math.floor(ax), iy = Math.floor(ayy);
        let d1 = 9, d2 = 9;
        for (let j = -1; j <= 1; j++) for (let qq = -1; qq <= 1; qq++) {
          const cx = ix + qq, cy = iy + j, pp = aPts[((cy % AL + AL) % AL) * AL + ((cx % AL + AL) % AL)];
          const d = Math.hypot(ax - cx - pp[0], ayy - cy - pp[1]);
          if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
        }
        al = smoothstep(0.07, 0.02, d2 - d1) * smoothstep(0.3, 0.2, av) * smoothstep(0.0, 0.05, av) * smoothstep(0.06, 0.03, Math.abs(u - 0.345));
      }
      // Markierung: Randlinien durchgezogen, Mittellinie gestrichelt, abgefahren
      const wv = smoothstep(0.35, 0.65, wear[i]);
      const edge = smoothstep(0.012, 0.009, Math.min(Math.abs(u - 0.06), Math.abs(u - 0.94))) * wv;
      const cen = dash ? smoothstep(0.014, 0.011, Math.abs(u - 0.5)) * wv : 0;
      R += (0.62 - R) * edge; G += (0.61 - G) * edge; B += (0.58 - B) * edge;
      R += (0.6 - R) * cen; G += (0.55 - G) * cen; B += (0.36 - B) * cen;
      rough += (0.65 - rough) * (edge + cen); H += (edge + cen) * 0.03;
      // Risse und Verguss
      const cr = Math.max(mk[q4] / 255, al), sl = mk[q4 + 1] / 255;
      R *= 1 - cr * 0.55; G *= 1 - cr * 0.55; B *= 1 - cr * 0.55; H -= cr * 0.3; rough += cr * 0.05;
      R += (0.06 - R) * sl; G += (0.06 - G) * sl; B += (0.065 - B) * sl; rough += (0.35 - rough) * sl; H += sl * 0.03;
      // Bankett: Schotter und Erde
      const sh = smoothstep(0.03, 0.036, Math.min(u, 1 - u));
      if (sh < 1) {
        const sk = 0.2 + (f - 0.5) * 0.12 + speck * 0.5;
        R += (sk * 1.05 - R) * (1 - sh); G += (sk * 0.95 - G) * (1 - sh); B += (sk * 0.75 - B) * (1 - sh);
        rough += (0.95 - rough) * (1 - sh); H += (0.5 + speck * 0.4 + (f - 0.5) * 0.3 - H) * (1 - sh);
      }
      // Nässe: Pfützen bevorzugt in den Spurrinnen und am Rand
      const wl = wetF[i] - wp * 0.03 - (1 - sh) * 0.02;
      const puddle = smoothstep(pud + 0.004, pud - 0.004, wl), damp = smoothstep(dmp, pud, wl + (f - 0.5) * 0.02);
      const wk = 1 - damp * 0.25;
      R *= wk; G *= wk; B *= wk;
      rough += (0.3 - rough) * damp * 0.8;
      rough += (0.04 - rough) * Math.max(puddle, cr * damp);
      H += (0.4 - H) * puddle;
      h[i] = H;
      setPx(p, i, R, G, B, rough);
    }
  }
  cavity(p, Math.max(1, Math.round(1.5 * k)), 2);
  return done(p, 0.0025);
}

// Ziegelmauer (Kachel = 4 × 4 m, v = 0 oben): Ziegel 24 × 7 cm mit 1 cm Fuge im Läuferverband,
// einzelne dunkle Klinker, leicht gerundete Kanten, Regenläufe von oben, Ausblühungen und Schmutz unten.
export function brick(seed = 55, tint = [0.42, 0.18, 0.13]) {
  const S = sz(512), k = S / 512, ROWS = 48, COLS = 16;
  const mid = field(seed, S, 16, 16, 3), fine = field(seed + 1, S, 96, 96, 2), big = field(seed + 2, S, 2, 2, 3);
  const strk = field(seed + 3, S, 36, 3, 3), eff = field(seed + 4, S, 18, 18, 3);
  const p = surface(S, true), h = p.h;
  for (let y = 0, i = 0; y < S; y++) {
    const v = (y + 0.5) / S, hm = 4 * (1 - v); // Meter über dem Boden
    const row = (v * ROWS) | 0, fy = v * ROWS - row, dy = Math.min(fy, 1 - fy) * (4 / ROWS);
    const off = (row & 1) * 0.5;
    const grime = smoothstep(0.7, 0.0, hm), splash = smoothstep(0.25, 0.0, hm);
    for (let x = 0; x < S; x++, i++) {
      const u = (x + 0.5) / S, m = mid[i], f = fine[i];
      const bx = u * COLS + off, bi = Math.floor(bx), fx = bx - bi;
      // Abstand zur Fuge in Metern (leicht unregelmäßig)
      const e = Math.min(Math.min(fx, 1 - fx) * (4 / COLS), dy) - 0.005 + (m - 0.5) * 0.003;
      const inB = smoothstep(-0.001, 0.0015, e);
      const id = hash(bi % COLS, row, seed), id2 = hash(bi % COLS, row, seed + 7);
      const kb = (0.78 + id * 0.36) * (id2 > 0.88 ? 0.62 : 1);
      let R = 0.44 + (f - 0.5) * 0.05, G = 0.42 + (f - 0.5) * 0.05, B = 0.39 + (f - 0.5) * 0.04; // Mörtel
      R += (tint[0] * kb * (1 + (f - 0.5) * 0.18) - R) * inB;
      G += (tint[1] * kb * (1 + (f - 0.5) * 0.15) - G) * inB;
      B += (tint[2] * kb * (1 + (f - 0.5) * 0.12) - B) * inB;
      const H = 0.25 + (f - 0.5) * 0.05 + inB * (0.25 + 0.15 * smoothstep(0, 0.006, e) + (m - 0.5) * 0.08 + (f - 0.5) * 0.05);
      let rough = 0.95 - inB * 0.08;
      const t = 1 + (big[i] - 0.5) * 0.25;
      R *= t; G *= t; B *= t;
      // Regenläufe von oben (unterschiedlich lang)
      const ws = smoothstep(0.6, 0.78, strk[i] - (4 - hm) * 0.04) * (0.6 + m * 0.6);
      R *= 1 - ws * 0.22; G *= 1 - ws * 0.22; B *= 1 - ws * 0.2; rough -= ws * 0.12;
      // Ausblühungen (Salz) vor allem unten
      const ef = smoothstep(0.7, 0.8, eff[i] + smoothstep(1.2, 0.2, hm) * 0.12 - smoothstep(1.2, 2.0, hm) * 0.3) * 0.3;
      R += (0.62 - R) * ef; G += (0.6 - G) * ef; B += (0.56 - B) * ef;
      // Schmutz und Spritzwasser über dem Boden
      const g = grime * (0.35 + 0.5 * m) * 0.5 + splash * smoothstep(0.45, 0.6, f) * 0.3;
      R *= 1 - g; G *= 1 - g * 1.05; B *= 1 - g * 1.12;
      h[i] = H;
      setPx(p, i, R, G, B, rough);
    }
  }
  cavity(p, Math.max(1, Math.round(2 * k)), 3);
  return done(p, 0.01);
}

// Holzverkleidung als Stülpschalung (Kachel = 4 × 4 m, v = 0 oben): überlappende Bretter mit
// Schattenkante, Stoßfugen, Farbe blättert an den Unterkanten ab, Regenläufe, Schmutz über dem Boden.
export function siding(seed = 57, base = [0.62, 0.6, 0.55], boards = 16) {
  const S = sz(512), k = S / 512;
  const grain = field(seed, S, 3, 48, 3), mid = field(seed + 1, S, 12, 12, 3), fine = field(seed + 2, S, 96, 96, 2);
  const big = field(seed + 3, S, 2, 2, 3), strk = field(seed + 4, S, 30, 3, 3), chip = field(seed + 5, S, 64, 64, 3);
  const p = surface(S, true), h = p.h;
  for (let y = 0, i = 0; y < S; y++) {
    const v = (y + 0.5) / S, hm = 4 * (1 - v);
    const bv = v * boards, bi = bv | 0, bf = bv - bi; // bf: 0 oben … 1 Unterkante des Bretts
    const bk = 0.93 + hash(bi % boards, 1, seed) * 0.12, jx = hash(bi % boards, 2, seed);
    const shade = 0.55 + 0.45 * smoothstep(0.0, 0.12, bf); // Schatten unter dem Brett darüber
    const edge = smoothstep(0.72, 1.0, bf); // Unterkante: hier blättert die Farbe zuerst
    const grime = smoothstep(0.6, 0.0, hm);
    for (let x = 0; x < S; x++, i++) {
      const u = (x + 0.5) / S, m = mid[i], f = fine[i], gr = grain[i];
      const du = Math.abs(u - jx), jd = Math.min(du, 1 - du) * 4; // Abstand zur Stoßfuge in Metern
      const joint = 1 - smoothstep(0.002, 0.006, jd);
      let H = 0.3 + bf * 0.45 + (gr - 0.5) * 0.05 - joint * 0.12;
      // Anstrich mit leichter Maserung darunter
      const pk = bk * (0.93 + gr * 0.12) * (1 + (big[i] - 0.5) * 0.2);
      let R = base[0] * pk, G = base[1] * pk, B = base[2] * pk, rough = 0.72 + (m - 0.5) * 0.1;
      // abgeblätterte Farbe → graues, verwittertes Holz
      const bare = smoothstep(0.8, 0.84, chip[i] + edge * 0.2 + smoothstep(0.6, 0.0, hm) * 0.1);
      const wood = 0.47 + gr * 0.1;
      R += (wood * 1.05 - R) * bare; G += (wood - G) * bare; B += (wood * 0.86 - B) * bare;
      rough += (0.92 - rough) * bare; H -= bare * 0.04;
      // Regenläufe von oben, Schmutz unten
      const ws = smoothstep(0.62, 0.8, strk[i] - (4 - hm) * 0.045) * (0.6 + m * 0.6);
      const g = grime * (0.35 + 0.5 * m) * 0.45 + ws * 0.18;
      const sh = shade * (1 - joint * 0.45);
      R *= sh * (1 - g); G *= sh * (1 - g * 1.05); B *= sh * (1 - g * 1.12);
      h[i] = H + (f - 0.5) * 0.02;
      setPx(p, i, R, G, B, rough);
    }
  }
  cavity(p, Math.max(1, Math.round(2 * k)), 2);
  return done(p, 0.01);
}

// Betonplatten mit Fugen und Wasserflecken (Kraftwerk, Tunnel)
export function concretePanels(seed = 59) {
  const n = new ValueNoise(seed), r = mulberry32(seed);
  const p = pixels(512, (u, v, o) => {
    const fu = (u * 2) % 1, fv = (v * 2) % 1;
    const joint = fu < 0.01 || fv < 0.01;
    const f = n.fbm(u * 8, v * 8, 5, 8);
    const streak = smoothstep(0.6, 0.85, n.noise(u * 48, v * 2, 48)) * 0.2;
    const holes = smoothstep(0.82, 0.86, n.noise(u * 64, v * 64, 64)) * 0.25;
    let g = 0.42 + (f - 0.5) * 0.18 - streak - holes + (r() - 0.5) * 0.04;
    if (joint) g = 0.2;
    o.r = g; o.g = g * 0.99; o.b = g * 0.96;
    o.h = joint ? 0.1 : 0.5 + (f - 0.5) * 0.4 - holes;
  });
  return finish(p);
}

// Glühende Glut-Risse (Lava); Farbe über emissiveMap
export function lava(seed = 61) {
  const n = new ValueNoise(seed);
  const p = pixels(256, (u, v, o) => {
    const f = n.fbm(u * 4, v * 4, 5, 4);
    const cell = Math.abs(Math.sin(f * 18));
    const hot = smoothstep(0.75, 0.97, 1 - cell) + smoothstep(0.62, 0.75, n.fbm(u * 2, v * 2, 3, 2)) * 0.6;
    const k = Math.min(1, hot);
    o.r = 0.05 + k * 1.0; o.g = 0.02 + k * 0.42; o.b = 0.01 + k * 0.08;
    o.h = 1 - k;
  });
  const t = toTexture(p.col);
  return t;
}

// Haltestellen-/Ortsschild
export function placeSign(title, sub = '', bg = '#e9d27a', fg = '#1a1a1a', w = 512, h = 192) {
  const cv = canvas(w, h), c = cv.getContext('2d');
  c.fillStyle = bg; c.fillRect(0, 0, w, h);
  c.strokeStyle = fg; c.lineWidth = 10; c.strokeRect(10, 10, w - 20, h - 20);
  c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = `bold ${sub ? 58 : 72}px Oswald, Impact, sans-serif`;
  c.fillText(title, w / 2, sub ? h * 0.4 : h / 2);
  if (sub) { c.font = '34px Oswald, Impact, sans-serif'; c.fillText(sub, w / 2, h * 0.74); }
  // Rost und Schmutz
  const r = mulberry32(title.length * 13 + 7);
  for (let i = 0; i < 26; i++) { c.fillStyle = `rgba(90,45,15,${0.08 + r() * 0.2})`; c.beginPath(); c.arc(r() * w, r() * h, 3 + r() * 16, 0, 7); c.fill(); }
  return toTexture(cv, { repeat: false });
}

// Dachziegel (Schindeln) mit Moos
export function roofTiles(seed = 63, tint = [0.32, 0.16, 0.12]) {
  const n = new ValueNoise(seed), r = mulberry32(seed);
  const rows = 16, cols = 10;
  const p = pixels(512, (u, v, o) => {
    const row = Math.floor(v * rows);
    const bu = u * cols + (row % 2) * 0.5;
    const fu = bu - Math.floor(bu), fv = v * rows - row;
    const id = Math.floor(bu) * 13 + row * 7;
    const k = ((Math.sin(id * 12.9898) * 43758.5453) % 1 + 1) % 1;
    const f = n.fbm(u * 8, v * 8, 4, 8);
    const moss = smoothstep(0.55, 0.75, n.fbm(u * 3 + 5, v * 3, 4, 3)) * 0.55;
    const edge = fv > 0.86 ? 0.45 : 1 - (1 - fv) * 0.18;
    const gap = fu < 0.03 ? 0.55 : 1;
    const s = (0.8 + k * 0.4) * edge * gap;
    let cr = tint[0] * s, cg = tint[1] * s, cb = tint[2] * s;
    cr = cr * (1 - moss) + moss * 0.16; cg = cg * (1 - moss) + moss * 0.2; cb = cb * (1 - moss) + moss * 0.09;
    o.r = cr + (f - 0.5) * 0.05 + (r() - 0.5) * 0.02; o.g = cg + (f - 0.5) * 0.04; o.b = cb + (f - 0.5) * 0.03;
    o.h = fv > 0.86 ? 0.2 : 0.4 + fv * 0.5 + (f - 0.5) * 0.2;
  });
  return finish(p);
}

// Wellblech mit Rost (Scheune, Hütte, Werkstatt)
export function corrugated(seed = 65, base = [0.36, 0.37, 0.38], rust = 0.6) {
  const n = new ValueNoise(seed), r = mulberry32(seed);
  const waves = 24;
  const p = pixels(512, (u, v, o) => {
    const w = Math.sin(u * waves * Math.PI * 2);
    const f = n.fbm(u * 6, v * 6, 5, 6);
    const rs = smoothstep(0.62 - rust * 0.2, 0.8 - rust * 0.2, n.fbm(u * 4 + 3, v * 4, 4, 4)) + smoothstep(0.4, 1, v) * rust * 0.4;
    const k = Math.min(1, rs);
    const sh = 0.75 + w * 0.25;
    o.r = (base[0] * (1 - k) + 0.36 * k) * sh + (f - 0.5) * 0.06 + (r() - 0.5) * 0.02;
    o.g = (base[1] * (1 - k) + 0.17 * k) * sh + (f - 0.5) * 0.05;
    o.b = (base[2] * (1 - k) + 0.08 * k) * sh + (f - 0.5) * 0.04;
    o.h = 0.5 + w * 0.45;
  });
  return finish(p);
}

// Maschendraht (für alphaTest)
export function chainLink() {
  const cv = canvas(256), c = cv.getContext('2d');
  c.clearRect(0, 0, 256, 256);
  c.strokeStyle = '#a4aaae'; c.lineWidth = 3.5;
  for (let i = -256; i < 512; i += 32) {
    c.beginPath(); c.moveTo(i, 0); c.lineTo(i + 256, 256); c.stroke();
    c.beginPath(); c.moveTo(i + 256, 0); c.lineTo(i, 256); c.stroke();
  }
  return toTexture(cv);
}

// Unregelmäßige Fleck-Maske (weiß innen, ausgefranster Rand) – z. B. für Glutfelder
export function blobMask(seed = 67) {
  const n = new ValueNoise(seed);
  const cv = canvas(256), c = cv.getContext('2d');
  const img = c.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const u = x / 256, v = y / 256;
    const dx = Math.max(0, Math.abs(u - 0.5) * 2 - 0.55) / 0.45, dy = Math.max(0, Math.abs(v - 0.5) * 2 - 0.55) / 0.45;
    const d = Math.hypot(dx, dy) + (n.fbm(u * 6, v * 6, 4, 6) - 0.5) * 0.9;
    const a = d < 0.75 ? 255 : 0;
    const i = (y * 256 + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = a; img.data[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  return toTexture(cv, { srgb: false, repeat: false });
}

// Haltestellenschild: grüner Kreis mit gelbem H, darunter Name
export function busStopSign(name) {
  const cv = canvas(256, 384), c = cv.getContext('2d');
  c.clearRect(0, 0, 256, 384);
  c.fillStyle = '#f2c200'; c.beginPath(); c.arc(128, 112, 104, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#1d7a3a'; c.beginPath(); c.arc(128, 112, 92, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#f2c200'; c.font = 'bold 150px Oswald, Impact, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('H', 128, 122);
  c.fillStyle = '#f4f1e6'; c.fillRect(14, 236, 228, 132);
  c.strokeStyle = '#1d7a3a'; c.lineWidth = 6; c.strokeRect(17, 239, 222, 126);
  c.fillStyle = '#1a1a1a';
  const words = name.split(' ');
  const l1 = words.slice(0, Math.ceil(words.length / 2)).join(' '), l2 = words.slice(Math.ceil(words.length / 2)).join(' ');
  c.font = 'bold 34px Oswald, Impact, sans-serif';
  c.fillText(l1, 128, l2 ? 278 : 296);
  if (l2) c.fillText(l2, 128, 316);
  c.font = '22px Oswald, Impact, sans-serif'; c.fillStyle = '#1d7a3a';
  c.fillText('LINIE 13', 128, 350);
  const r = mulberry32(name.length * 7);
  for (let i = 0; i < 18; i++) { c.fillStyle = `rgba(90,45,15,${0.06 + r() * 0.16})`; c.beginPath(); c.arc(r() * 256, r() * 384, 3 + r() * 12, 0, 7); c.fill(); }
  return toTexture(cv, { repeat: false });
}

// Abfahrtstafel mit orangefarbener LED-Schrift
export function departureBoard(rows) {
  const cv = canvas(1024, 384), c = cv.getContext('2d');
  c.fillStyle = '#050505'; c.fillRect(0, 0, 1024, 384);
  c.strokeStyle = '#2a2a2a'; c.lineWidth = 10; c.strokeRect(5, 5, 1014, 374);
  c.font = 'bold 44px "Courier New", monospace'; c.textBaseline = 'middle';
  c.shadowColor = '#ff8a1a'; c.shadowBlur = 12; c.fillStyle = '#ffb04a';
  rows.forEach((row, i) => {
    c.textAlign = 'left'; c.fillText(row[0], 36, 52 + i * 66);
    c.textAlign = 'right'; c.fillText(row[1], 990, 52 + i * 66);
  });
  return toTexture(cv, { repeat: false });
}

// ── Zombies ──────────────────────────────────────────────────
// Wie pixels(), zusätzlich eine Färbemaske o.m (1 = pro Zombie eingefärbt, 0 = feste Farbe
// wie Blut oder Wunden). Sie liegt im G-Kanal der Bump-Map – die Bump-Map selbst nutzt nur R.
function pixelsM(size, fn) {
  size = Math.max(128, Math.round(size * SCALE));
  const col = canvas(size), bmp = canvas(size);
  const cc = col.getContext('2d'), bc = bmp.getContext('2d');
  const ci = cc.createImageData(size, size), bi = bc.createImageData(size, size);
  const o = { r: 0, g: 0, b: 0, h: 0.5, m: 1 };
  let i = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++, i += 4) {
      o.m = 1;
      fn(x / size, y / size, o);
      ci.data[i] = clamp(o.r, 0, 1) * 255; ci.data[i + 1] = clamp(o.g, 0, 1) * 255; ci.data[i + 2] = clamp(o.b, 0, 1) * 255; ci.data[i + 3] = 255;
      bi.data[i] = clamp(o.h, 0, 1) * 255; bi.data[i + 1] = clamp(o.m, 0, 1) * 255; bi.data[i + 2] = 0; bi.data[i + 3] = 255;
    }
  }
  cc.putImageData(ci, 0, 0);
  bc.putImageData(bi, 0, 0);
  return { col, bmp, cc, bc, size, k: size / 512 };
}

// Weicher Fleck auf Farb- und Bump-Leinwand, horizontal umlaufend (nahtlos um Gliedmaßen).
// col/bmp: Farbverläufe [[pos, 'rgba(..)'], ...]; Koordinaten in 512er-Einheiten
function blob(p, x, y, rad, col, bmp, sy = 1, rot = 0) {
  x *= p.k; y *= p.k; rad *= p.k;
  for (const dx of [-p.size, 0, p.size]) {
    const X = x + dx;
    if (X + rad * 2 < 0 || X - rad * 2 > p.size) continue;
    for (const [ctx, stops] of [[p.cc, col], [p.bc, bmp]]) {
      if (!stops) continue;
      ctx.save();
      ctx.translate(X, y); ctx.rotate(rot); ctx.scale(1, sy);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
      for (const [o, c] of stops) g.addColorStop(o, c);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, rad, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
}

const BLOOD_C = (a = 1) => [[0, `rgba(58,4,3,${a})`], [0.6, `rgba(48,4,3,${a * 0.9})`], [0.85, `rgba(32,3,2,${a * 0.6})`], [1, 'rgba(32,3,2,0)']];
const BLOOD_B = (a = 1) => [[0, `rgba(150,0,0,${a})`], [0.85, `rgba(140,0,0,${a * 0.9})`], [1, 'rgba(140,0,0,0)']];

// Verschmierter Blutfleck aus mehreren Klecksen
function bloodStain(p, r, x, y, size, a = 1) {
  const n = 4 + Math.floor(r() * 5);
  for (let i = 0; i < n; i++) {
    const bx = x + (r() - 0.5) * size * 1.4, by = y + (r() - 0.5) * size, br = size * (0.3 + r() * 0.45);
    blob(p, bx, by, br, BLOOD_C(a * (0.75 + r() * 0.25)), BLOOD_B(a), 0.6 + r() * 0.6, r() * 3);
  }
  for (let i = 0; i < n; i++) {
    const ang = r() * Math.PI * 2, d = size * (0.6 + r() * 0.6);
    blob(p, x + Math.cos(ang) * d, y + Math.sin(ang) * d * 0.7, 1.2 + r() * 2.5, BLOOD_C(a * 0.8), BLOOD_B(a));
  }
}

// Herablaufendes Blut (verjüngt sich nach unten)
function bloodDrip(p, r, x, y, len, w, a = 1) {
  let cx = x, cy = y, ww = w;
  const steps = Math.ceil(len / 2);
  for (let i = 0; i < steps; i++) {
    blob(p, cx, cy, ww, BLOOD_C(a), BLOOD_B(a));
    cy += 2; cx += (r() - 0.5) * 0.9;
    ww = Math.max(0.9, ww * (0.985 - r() * 0.01));
  }
  blob(p, cx, cy + 1, ww * 1.6, BLOOD_C(a), BLOOD_B(a));
}

// Offene Wunde: dunkles Zentrum, rohes Fleisch, wulstiger Rand
function wound(p, r, x, y, size) {
  const sy = 0.45 + r() * 0.6, rot = r() * Math.PI;
  blob(p, x, y, size * 1.5, [[0, 'rgba(70,12,10,0.95)'], [0.6, 'rgba(60,20,16,0.6)'], [1, 'rgba(50,20,16,0)']], [[0, 'rgba(120,0,0,0.9)'], [1, 'rgba(120,0,0,0)']], sy, rot);
  blob(p, x, y, size, [[0, 'rgba(25,2,2,1)'], [0.45, 'rgba(120,22,18,1)'], [0.75, 'rgba(150,48,40,1)'], [1, 'rgba(90,20,16,0)']], [[0, 'rgba(10,0,0,1)'], [0.6, 'rgba(70,0,0,1)'], [1, 'rgba(110,0,0,0)']], sy, rot);
  for (let i = 0; i < 3; i++) bloodDrip(p, r, x + (r() - 0.5) * size, y + size * sy * 0.5, 10 + r() * 40, 1.6 + r() * 1.6, 0.9);
}

function finishM(p) {
  return { map: toTexture(p.col), bump: toTexture(p.bmp, { srgb: false }) };
}

const mix = (a, b, t) => a + (b - a) * t;

// Haut: fahl (Grundton ~0.62, Farbe kommt pro Zombie), Fäulnis, Adern, Blut, Wunden
export function zombieSkin(seed = 60) {
  const n = new ValueNoise(seed), r = mulberry32(seed);
  const p = pixelsM(512, (u, v, o) => {
    const f = n.fbm(u * 8, v * 8, 5, 8);
    const rot = smoothstep(0.55, 0.7, n.fbm(u * 3 + 5, v * 3, 4, 3));
    const vn = n.fbm(u * 12 + 3, v * 5 + 1, 4, 12);
    const vein = smoothstep(0.022, 0, Math.abs(vn - 0.5)) * smoothstep(0.42, 0.6, n.fbm(u * 4 + 1, v * 4 + 7, 3, 4));
    const bl = smoothstep(0.67, 0.7, n.fbm(u * 6 + 11, v * 6 + 2, 5, 6));
    const pore = (n.noise(u * 180, v * 180, 180) - 0.5) * 0.06;
    let c = 0.62 * (0.8 + f * 0.4) + pore;
    let cr = c * (1 - rot * 0.42), cg = c * (1 - rot * 0.3), cb = c * 0.97 * (1 - rot * 0.5);
    cr = mix(cr, 0.27, vein * 0.75); cg = mix(cg, 0.22, vein * 0.75); cb = mix(cb, 0.34, vein * 0.75);
    cr = mix(cr, 0.3, bl); cg = mix(cg, 0.02, bl); cb = mix(cb, 0.02, bl);
    o.r = cr; o.g = cg; o.b = cb;
    o.m = clamp(1 - vein * 0.6 - bl - rot * 0.25, 0, 1);
    o.h = 0.5 + (f - 0.5) * 0.6 - vein * 0.2 + pore * 2;
  });
  for (let i = 0; i < 7; i++) wound(p, r, r() * 512, 40 + r() * 430, 9 + r() * 14);
  for (let i = 0; i < 6; i++) bloodStain(p, r, r() * 512, r() * 512, 14 + r() * 22, 0.85);
  for (let i = 0; i < 10; i++) bloodDrip(p, r, r() * 512, r() * 380, 30 + r() * 110, 1.4 + r() * 2.2, 0.9);
  return finishM(p);
}

// Gesicht (Kugel-UV, Gesicht in der Mitte): Augenhöhlen, Mund, Blutspuren; unten Kinn für den Unterkiefer
export function zombieHead(seed = 62) {
  const n = new ValueNoise(seed), r = mulberry32(seed);
  const p = pixelsM(512, (u, v, o) => {
    const f = n.fbm(u * 8, v * 8, 5, 8);
    const rot = smoothstep(0.55, 0.72, n.fbm(u * 4 + 5, v * 4, 4, 4));
    const vn = n.fbm(u * 12 + 3, v * 8 + 1, 4, 12);
    const vein = smoothstep(0.02, 0, Math.abs(vn - 0.5)) * smoothstep(0.5, 0.65, n.fbm(u * 4 + 1, v * 4 + 7, 3, 4));
    const pore = (n.noise(u * 200, v * 200, 200) - 0.5) * 0.05;
    let c = 0.62 * (0.82 + f * 0.36) + pore;
    // Kopfhaut oben: dunkler, stoppelig
    const scalp = smoothstep(0.3, 0.12, v) * 0.35;
    c *= 1 - scalp * (0.6 + n.noise(u * 300, v * 300, 300) * 0.4);
    let cr = c * (1 - rot * 0.4), cg = c * (1 - rot * 0.28), cb = c * 0.97 * (1 - rot * 0.5);
    cr = mix(cr, 0.27, vein * 0.7); cg = mix(cg, 0.22, vein * 0.7); cb = mix(cb, 0.34, vein * 0.7);
    o.r = cr; o.g = cg; o.b = cb;
    o.m = clamp(1 - vein * 0.5 - rot * 0.2, 0, 1);
    o.h = 0.5 + (f - 0.5) * 0.5 + pore * 2;
  });
  const dark = (a) => [[0, `rgba(14,8,7,${a})`], [0.55, `rgba(24,14,12,${a * 0.75})`], [1, 'rgba(30,18,16,0)']];
  const darkB = (a) => [[0, `rgba(30,60,0,${a})`], [1, 'rgba(60,60,0,0)']];
  // Augenhöhlen mit Augenringen
  for (const ex of [225, 287]) {
    blob(p, ex, 252, 22, [[0, 'rgba(70,24,36,0.5)'], [1, 'rgba(70,24,36,0)']], null, 0.6);
    blob(p, ex, 236, 30, dark(0.95), darkB(0.9), 0.82);
    blob(p, ex, 236, 15, dark(1), darkB(1), 0.9);
  }
  // Nase: Schatten seitlich, Nasenlöcher
  for (const sx of [244, 268]) blob(p, sx, 268, 12, [[0, 'rgba(20,12,10,0.35)'], [1, 'rgba(20,12,10,0)']], null, 2.2);
  for (const sx of [250, 262]) blob(p, sx, 297, 5, dark(1), darkB(1), 0.7);
  // Eingefallene Wangen
  for (const sx of [205, 307]) blob(p, sx, 300, 26, [[0, 'rgba(18,12,10,0.4)'], [1, 'rgba(18,12,10,0)']], null, 1.3);
  // Mundhöhle (dunkel) und zerfetzte Lippen
  blob(p, 256, 356, 72, [[0, 'rgba(10,2,2,1)'], [0.62, 'rgba(26,4,4,1)'], [0.85, 'rgba(60,10,8,0.9)'], [1, 'rgba(60,10,8,0)']], [[0, 'rgba(20,0,0,1)'], [0.8, 'rgba(40,0,0,1)'], [1, 'rgba(60,0,0,0)']], 0.62);
  blob(p, 256, 314, 46, [[0, 'rgba(70,14,12,0.9)'], [0.7, 'rgba(60,12,10,0.6)'], [1, 'rgba(60,12,10,0)']], [[0, 'rgba(110,0,0,0.9)'], [1, 'rgba(110,0,0,0)']], 0.22);
  // Blut um den Mund, blutige Tränen
  bloodStain(p, r, 240, 322, 18, 0.9);
  bloodStain(p, r, 276, 330, 14, 0.85);
  for (const ex of [225, 287]) for (let i = 0; i < 2; i++) bloodDrip(p, r, ex + (r() - 0.5) * 16, 250, 30 + r() * 50, 1.3 + r(), 0.85);
  // Wunden: aufgerissene Wange, Stirn, Hinterkopf
  wound(p, r, 322, 286, 13);
  wound(p, r, 268, 168, 9);
  wound(p, r, 30 + r() * 60, 200 + r() * 80, 12);
  // Unterkiefer-Bereich (unten): oben dunkler Mundraum, darunter Kinn mit Blut
  p.cc.fillStyle = 'rgba(28,6,5,1)'; p.cc.fillRect(196 * p.k, 432 * p.k, 120 * p.k, 18 * p.k);
  p.bc.fillStyle = 'rgba(40,0,0,1)'; p.bc.fillRect(196 * p.k, 432 * p.k, 120 * p.k, 18 * p.k);
  for (let i = 0; i < 7; i++) bloodDrip(p, r, 214 + r() * 84, 452, 12 + r() * 46, 1.4 + r() * 2.2, 0.95);
  bloodStain(p, r, 256, 458, 16, 0.9);
  return finishM(p);
}

// Kleidung (Hemd/Hose): Gewebe, Dreck, durchgeblutete Flecken, Risse (darin Haut im Schatten), Einschusslöcher
export function zombieCloth(seed, kind = 'shirt') {
  const n = new ValueNoise(seed), n2 = new ValueNoise(seed + 5), r = mulberry32(seed);
  const pants = kind === 'pants';
  const p = pixelsM(512, (u, v, o) => {
    const X = u * 512, Y = v * 512;
    const weave = pants
      ? Math.sin((X + Y) * 1.9) * 0.03 + (n.noise(u * 256, v * 64, 256) - 0.5) * 0.07
      : Math.sin(X * 2.4) * Math.sin(Y * 2.4) * 0.025 + (n.noise(u * 200, v * 200, 200) - 0.5) * 0.035;
    const f = n.fbm(u * 6, v * 6, 4, 6);
    const dirt = smoothstep(0.45, 0.8, n.fbm(u * 3 + 4, v * 3, 4, 3)) * 0.38 + smoothstep(0.55, 1, v) * (pants ? 0.3 : 0.18);
    // Blut: durchgeweichte Flecken mit weichem Rand, beim Hemd am Kragen und vorne gehäuft
    const collar = pants ? 0 : Math.exp(-(((u - 0.5) / 0.22) ** 2)) * smoothstep(0.45, 0.0, v) * 0.2;
    const bf = n.fbm(u * 3.5 + 9, v * 3.5 + 1, 5, 4) + collar - (pants ? 0.03 : 0);
    const soak = smoothstep(0.6, 0.7, bf), wet = smoothstep(0.66, 0.74, bf);
    // Risse (in die Länge gezogen): innen dunkle Haut im Schatten, Rand ausgefranst
    const tf = n2.fbm(u * 5, v * 2.6, 4, 5) + (pants ? smoothstep(0.75, 0.95, v) * 0.05 : 0);
    const tear = smoothstep(0.735, 0.745, tf), fray = smoothstep(0.71, 0.735, tf) * (1 - tear);
    // Falten: in die Länge gezogene Wellen, in den Mulden dunkler
    const fw = n2.fbm(u * 3 + 7, v * 1.2, 3, 3);
    const fold = Math.sin((pants ? Y * 0.11 : X * 0.07) + fw * 9 + n.noise(u * 24, v * 6, 24) * 2.5);
    const crease = smoothstep(0.55, 1, -fold) * 0.22;
    let c = 0.72 * (0.86 + f * 0.28) + weave;
    c *= (1 - dirt) * (1 - crease);
    let cr = c, cg = c, cb = c, m = 1;
    if (pants) { // Matsch unten am Hosenbein
      const mud = smoothstep(0.82, 0.98, v) * smoothstep(0.4, 0.6, n.fbm(u * 8, v * 8, 3, 8));
      cr = mix(cr, 0.2, mud); cg = mix(cg, 0.15, mud); cb = mix(cb, 0.09, mud);
      m = 1 - mud * 0.8;
    }
    // Blut: Stoff dunkelt ein, Kern fast schwarzrot
    const br = 0.2 + f * 0.05 - wet * 0.07;
    cr = mix(cr, br, soak); cg = mix(cg, 0.018, soak); cb = mix(cb, 0.014, soak);
    m *= 1 - soak;
    // Ausgefranster Rand (helle Fäden), Riss innen dunkel
    const thread = n.noise(u * 320, v * 80, 320) > 0.55 ? 1 : 0.35;
    cr += fray * 0.1 * thread; cg += fray * 0.09 * thread; cb += fray * 0.07 * thread;
    const deep = smoothstep(0.745, 0.79, tf);
    const sk = (0.2 + f * 0.08) * (0.55 + deep * 0.45);
    cr = mix(cr, sk * 1.05, tear); cg = mix(cg, sk, tear); cb = mix(cb, sk * 0.85, tear);
    m *= 1 - tear;
    o.r = cr; o.g = cg; o.b = cb; o.m = clamp(m, 0, 1);
    o.h = 0.5 + weave * 3 + fold * 0.12 - tear * 0.4 + fray * 0.12 + soak * 0.03;
  });
  // Einschusslöcher mit Brandrand
  for (let i = 0; i < 10; i++) {
    const x = r() * 512, y = r() * 512;
    blob(p, x, y, 6, [[0, 'rgba(8,4,3,1)'], [0.4, 'rgba(20,8,6,0.9)'], [0.7, 'rgba(40,20,10,0.5)'], [1, 'rgba(40,20,10,0)']], [[0, 'rgba(0,0,0,1)'], [0.5, 'rgba(60,0,0,1)'], [1, 'rgba(120,255,0,0)']]);
    if (r() < 0.5) bloodDrip(p, r, x, y + 3, 16 + r() * 40, 1.3 + r(), 0.8);
  }
  if (!pants) for (let i = 0; i < 9; i++) bloodDrip(p, r, 170 + r() * 172, 20 + r() * 90, 50 + r() * 140, 1.4 + r() * 1.8, 0.85);
  return finishM(p);
}

// Kochschürze: schmutzig weiß, Fett, viel Blut und Handabdrücke (feste Farbe)
export function zombieApron(seed = 66) {
  const n = new ValueNoise(seed), r = mulberry32(seed);
  const p = pixelsM(256, (u, v, o) => {
    const f = n.fbm(u * 6, v * 6, 4, 6);
    const grease = smoothstep(0.55, 0.75, n.fbm(u * 3 + 2, v * 3 + 5, 4, 3));
    const c = 0.8 * (0.9 + f * 0.2);
    o.r = c * (1 - grease * 0.25); o.g = c * (1 - grease * 0.3); o.b = c * (0.92 - grease * 0.4);
    o.h = 0.5 + (f - 0.5) * 0.3;
  });
  for (let i = 0; i < 8; i++) bloodStain(p, r, r() * 512, r() * 512, 20 + r() * 30, 0.9);
  for (let i = 0; i < 16; i++) bloodDrip(p, r, r() * 512, r() * 300, 40 + r() * 150, 2 + r() * 3, 0.9);
  // Handabdrücke
  for (let i = 0; i < 3; i++) {
    const x = 80 + r() * 350, y = 80 + r() * 300, a = (r() - 0.5) * 1.2;
    blob(p, x, y, 26, BLOOD_C(0.85), BLOOD_B(0.85), 0.9, a);
    for (let k = 0; k < 4; k++) {
      const fa = a - 0.6 + k * 0.4 - Math.PI / 2;
      for (let s = 0; s < 5; s++) blob(p, x + Math.cos(fa) * (28 + s * 7), y + Math.sin(fa) * (28 + s * 7), 6, BLOOD_C(0.85), BLOOD_B(0.85));
    }
  }
  return finishM(p);
}

// Bauhelm: gelber Kunststoff mit Kratzern und Dreck
export function hardhatTex(seed = 68) {
  const n = new ValueNoise(seed), r = mulberry32(seed);
  const p = pixels(256, (u, v, o) => {
    const f = n.fbm(u * 5, v * 5, 4, 5);
    const d = smoothstep(0.5, 0.8, n.fbm(u * 3 + 4, v * 3, 4, 3)) * 0.45;
    o.r = (0.78 + f * 0.1) * (1 - d); o.g = (0.6 + f * 0.08) * (1 - d); o.b = 0.08 * (1 - d);
    o.h = 0.5 + (f - 0.5) * 0.2;
  });
  for (let i = 0; i < 60; i++) {
    const x = r() * p.size, y = r() * p.size, a = r() * Math.PI, l = 6 + r() * 30;
    p.cc.strokeStyle = `rgba(${r() < 0.5 ? '240,230,200' : '30,25,20'},${0.2 + r() * 0.4})`; p.cc.lineWidth = 0.8;
    p.cc.beginPath(); p.cc.moveTo(x, y); p.cc.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); p.cc.stroke();
  }
  return finish(p);
}

// Kronkorken-Symbol eines Perks (HUD und Automaten-Logo)
export function perkIconCanvas(id, size = 128) {
  const P = PERKS[id];
  const cv = canvas(size);
  const c = cv.getContext('2d');
  c.scale(size / 128, size / 128);
  c.translate(64, 64);
  // gezackter Rand
  c.beginPath();
  for (let i = 0; i <= 42; i++) {
    const a = (i / 42) * Math.PI * 2, r = i % 2 ? 58 : 62;
    c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const rim = c.createRadialGradient(-18, -22, 6, 0, 0, 62);
  rim.addColorStop(0, '#fff'); rim.addColorStop(0.35, P.color); rim.addColorStop(1, '#120606');
  c.fillStyle = rim; c.fill();
  c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,0.6)'; c.stroke();
  // Innenfläche
  const g = c.createRadialGradient(-14, -18, 4, 0, 0, 50);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.18, P.color); g.addColorStop(1, '#1a0707');
  c.beginPath(); c.arc(0, 0, 48, 0, Math.PI * 2); c.fillStyle = g; c.fill();
  c.lineWidth = 3; c.strokeStyle = 'rgba(255,255,255,0.55)'; c.stroke();
  // Symbol
  c.fillStyle = '#fff'; c.strokeStyle = '#fff'; c.lineJoin = 'round'; c.lineCap = 'round';
  c.shadowColor = 'rgba(0,0,0,0.7)'; c.shadowBlur = 6; c.shadowOffsetY = 2;
  c.beginPath();
  if (id === 'titan') { // Schild mit Kreuz
    c.moveTo(0, -30); c.lineTo(24, -20); c.lineTo(20, 10); c.quadraticCurveTo(12, 26, 0, 32); c.quadraticCurveTo(-12, 26, -20, 10); c.lineTo(-24, -20); c.closePath(); c.fill();
    c.fillStyle = P.color; c.shadowBlur = 0; c.fillRect(-4, -18, 8, 34); c.fillRect(-14, -6, 28, 8);
  } else if (id === 'blitz') { // Blitz
    c.moveTo(6, -32); c.lineTo(-18, 4); c.lineTo(-2, 4); c.lineTo(-8, 32); c.lineTo(18, -6); c.lineTo(2, -6); c.closePath(); c.fill();
  } else if (id === 'doppel') { // zwei Patronen
    for (const x of [-11, 11]) { c.beginPath(); c.moveTo(x - 7, 26); c.lineTo(x - 7, -8); c.quadraticCurveTo(x - 7, -30, x, -32); c.quadraticCurveTo(x + 7, -30, x + 7, -8); c.lineTo(x + 7, 26); c.closePath(); c.fill(); }
    c.fillStyle = P.color; c.shadowBlur = 0; c.fillRect(-20, 8, 40, 4);
  } else if (id === 'phoenix') { // aufsteigender Flügel
    c.moveTo(-26, 22); c.quadraticCurveTo(-24, -10, 4, -30); c.quadraticCurveTo(-4, -12, 14, -20); c.quadraticCurveTo(6, -2, 26, -6); c.quadraticCurveTo(12, 14, -26, 22); c.fill();
  } else if (id === 'sprint') { // Doppelpfeil
    c.lineWidth = 9;
    for (const x of [-12, 8]) { c.beginPath(); c.moveTo(x - 6, -22); c.lineTo(x + 12, 0); c.lineTo(x - 6, 22); c.stroke(); }
  }
  return cv;
}

