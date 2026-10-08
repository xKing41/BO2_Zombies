// Prozedurale Texturen – alles wird zur Laufzeit erzeugt, keine externen Assets.
import * as THREE from 'three';
import { ValueNoise, mulberry32 } from './noise.js';
import { clamp, smoothstep } from './utils.js';

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

function finish(p) {
  return { map: toTexture(p.col), bump: toTexture(p.bmp, { srgb: false }) };
}

function cracks(p, rnd, count, color = 'rgba(15,14,12,0.7)') {
  const { cc, bc, size } = p;
  for (let k = 0; k < count; k++) {
    let x = rnd() * size, y = rnd() * size, a = rnd() * Math.PI * 2;
    const len = 20 + rnd() * 80;
    cc.strokeStyle = color;
    bc.strokeStyle = 'rgba(0,0,0,0.8)';
    cc.lineWidth = bc.lineWidth = 0.6 + rnd() * 1.2;
    cc.beginPath(); bc.beginPath();
    cc.moveTo(x, y); bc.moveTo(x, y);
    for (let s = 0; s < len; s++) {
      a += (rnd() - 0.5) * 0.6;
      x += Math.cos(a) * 2; y += Math.sin(a) * 2;
      cc.lineTo(x, y); bc.lineTo(x, y);
    }
    cc.stroke(); bc.stroke();
  }
}

export function concrete(seed = 1, tint = [1, 1, 1], dirt = 0) {
  const n = new ValueNoise(seed), r = mulberry32(seed);
  const p = pixels(512, (u, v, o) => {
    const f = n.fbm(u * 8, v * 8, 5, 8);
    const s = n.fbm(u * 3 + 1, v * 3 + 1, 4, 3);
    const stain = smoothstep(0.52, 0.72, s);
    const oil = dirt ? smoothstep(0.6, 0.7, n.fbm(u * 2 + 3, v * 2, 3, 2)) * dirt : 0;
    const grain = (r() - 0.5) * 0.07;
    const g = 0.44 + (f - 0.5) * 0.45 + grain - stain * 0.16 - oil * 0.25;
    o.r = g * tint[0]; o.g = g * tint[1]; o.b = g * tint[2];
    o.h = 0.5 + (f - 0.5) * 0.8 + grain * 1.5;
  });
  cracks(p, r, 7);
  return finish(p);
}

// Alte Putzwand über Ziegeln, unten dunkler gestrichener Sockel, Wasserflecken
export function plasterWall(seed = 3) {
  const n = new ValueNoise(seed), r = mulberry32(seed);
  const size = 1024, rows = 48, cols = 16;
  const p = pixels(size, (u, v, o) => {
    const height = 4 * (1 - v); // Meter über Boden
    // Ziegel
    const row = Math.floor(v * rows);
    const bu = u * cols + (row % 2) * 0.5;
    const fu = bu - Math.floor(bu), fv = v * rows - row;
    const mortar = fu < 0.04 || fv < 0.1;
    const brickId = Math.floor(bu) * 13 + row * 7;
    const bvar = ((Math.sin(brickId * 12.9898) * 43758.5453) % 1 + 1) % 1;
    const bn = n.fbm(u * 32, v * 32, 3, 32);
    let br = mortar ? 0.3 : 0.24 + bvar * 0.1 + (bn - 0.5) * 0.1;
    let bg = mortar ? 0.28 : 0.13 + bvar * 0.04 + (bn - 0.5) * 0.05;
    let bb = mortar ? 0.25 : 0.1 + bvar * 0.03;
    let h = mortar ? 0.25 : 0.55 + (bn - 0.5) * 0.3;
    // Putz
    const peel = n.fbm(u * 4, v * 4, 5, 4) + (height < 1.2 ? -0.06 : 0);
    const plaster = peel > 0.34;
    if (plaster) {
      const pn = n.fbm(u * 16 + 2, v * 16, 4, 16);
      const lower = height < 1.15;
      const stripe = Math.abs(height - 1.15) < 0.03;
      let pr = lower ? 0.17 : 0.42, pg = lower ? 0.22 : 0.43, pb = lower ? 0.2 : 0.37;
      if (stripe) { pr = 0.5; pg = 0.12; pb = 0.08; }
      const d = (pn - 0.5) * 0.18;
      br = pr + d; bg = pg + d; bb = pb + d;
      const edge = smoothstep(0.34, 0.37, peel);
      h = 0.5 + edge * 0.35 + d;
    }
    // Wasserflecken von oben, Dreck von unten
    const streak = smoothstep(0.6, 0.9, n.noise(u * 64, v * 3, 64)) * smoothstep(0.0, 0.6, 1 - v) * 0.18;
    const grime = smoothstep(1.4, 0, height) * 0.45;
    const blot = smoothstep(0.62, 0.8, n.fbm(u * 2 + 5, v * 2 + 5, 3, 2)) * 0.25;
    const k = 1 - streak - grime - blot;
    const grain = (r() - 0.5) * 0.05;
    o.r = br * k + grain; o.g = bg * k + grain; o.b = bb * k * 0.97 + grain;
    o.h = h + grain;
  });
  cracks(p, r, 10, 'rgba(20,18,15,0.6)');
  return finish(p);
}

export function ceiling(seed = 5) {
  const n = new ValueNoise(seed), r = mulberry32(seed);
  const p = pixels(512, (u, v, o) => {
    const f = n.fbm(u * 6, v * 6, 5, 6);
    const st = smoothstep(0.55, 0.75, n.fbm(u * 2, v * 2 + 3, 4, 2));
    const ring = Math.abs(Math.sin(n.fbm(u * 2, v * 2 + 3, 4, 2) * 40)) < 0.15 ? 0.06 : 0;
    const g = 0.36 + (f - 0.5) * 0.3 - st * 0.14 - ring * st + (r() - 0.5) * 0.04;
    o.r = g * 1.02; o.g = g; o.b = g * 0.92;
    o.h = f;
  });
  return finish(p);
}

export function planks(seed = 7, tint = [1, 1, 1], count = 4) {
  const n = new ValueNoise(seed), r = mulberry32(seed);
  const p = pixels(512, (u, v, o) => {
    const pv = v * count;
    const pi = Math.floor(pv), pf = pv - pi;
    const off = ((Math.sin(pi * 78.233) * 43758.5453) % 1 + 1) % 1;
    const gap = pf < 0.025 || pf > 0.975;
    const grain = n.fbm(u * 2 + off * 7, pv * 8, 4, 2);
    const ring = Math.sin((pv * 30 + grain * 12 + u * 3) * 2.0) * 0.5 + 0.5;
    const knot = smoothstep(0.78, 0.9, n.noise(u * 24 + off * 50, pv * 6, 24));
    let g = 0.38 + ring * 0.12 + (grain - 0.5) * 0.25 - knot * 0.2 + (off - 0.5) * 0.12;
    const weather = smoothstep(0.5, 0.8, n.fbm(u * 3, v * 3 + 9, 3, 3)) * 0.18;
    g -= weather;
    if (gap) g = 0.06;
    o.r = g * 1.0 * tint[0]; o.g = g * 0.72 * tint[1]; o.b = g * 0.48 * tint[2];
    o.h = gap ? 0.0 : 0.6 + ring * 0.2 - knot * 0.2;
    o.r += (r() - 0.5) * 0.03;
  });
  // Nägel
  const { cc, bc, size } = p;
  const k = size / 512;
  for (let i = 0; i < count; i++) {
    for (const x of [24 * k, 488 * k]) {
      const y = (i + 0.5) * (size / count);
      cc.fillStyle = '#2a2622'; cc.beginPath(); cc.arc(x, y, 4 * k, 0, 7); cc.fill();
      bc.fillStyle = '#fff'; bc.beginPath(); bc.arc(x, y, 4 * k, 0, 7); bc.fill();
    }
  }
  return finish(p);
}

export function checkerTiles(seed = 11) {
  const n = new ValueNoise(seed), r = mulberry32(seed);
  const tiles = 8;
  const p = pixels(512, (u, v, o) => {
    const tu = u * tiles, tv = v * tiles;
    const iu = Math.floor(tu), iv = Math.floor(tv);
    const fu = tu - iu, fv = tv - iv;
    const grout = fu < 0.035 || fv < 0.035;
    const white = (iu + iv) % 2 === 0;
    const f = n.fbm(u * 8, v * 8, 4, 8);
    const grime = smoothstep(0.45, 0.8, n.fbm(u * 3, v * 3, 4, 3)) * 0.35;
    const tvar = ((Math.sin((iu * 31 + iv * 17) * 12.9898) * 43758.5453) % 1 + 1) % 1;
    let c = white ? 0.78 - tvar * 0.08 : 0.06 + tvar * 0.03;
    c += (f - 0.5) * 0.08;
    let cr = c * (white ? 1.0 : 1), cg = c * (white ? 0.97 : 1), cb = c * (white ? 0.88 : 1.05);
    if (grout) { cr = 0.2; cg = 0.19; cb = 0.17; }
    const k = 1 - grime;
    o.r = cr * k + (r() - 0.5) * 0.02; o.g = cg * k; o.b = cb * k * 0.95;
    o.h = grout ? 0.2 : 0.7 + (f - 0.5) * 0.1;
  });
  cracks(p, r, 6, 'rgba(10,10,10,0.6)');
  return finish(p);
}

export function cobble(seed = 13) {
  const n = new ValueNoise(seed), rr = mulberry32(seed);
  const G = 8;
  const pts = [];
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) pts.push([i + 0.2 + rr() * 0.6, j + 0.2 + rr() * 0.6, rr()]);
  const p = pixels(512, (u, v, o) => {
    const x = u * G, y = v * G;
    const cx = Math.floor(x), cy = Math.floor(y);
    let d1 = 9, d2 = 9, id = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const gx = cx + i, gy = cy + j;
      const wx = ((gx % G) + G) % G, wy = ((gy % G) + G) % G;
      const pt = pts[wy * G + wx];
      const px = pt[0] + (gx - wx), py = pt[1] + (gy - wy);
      const d = Math.hypot(x - px, y - py);
      if (d < d1) { d2 = d1; d1 = d; id = pt[2]; } else if (d < d2) d2 = d;
    }
    const edge = d2 - d1;
    const mortar = 1 - smoothstep(0.04, 0.12, edge);
    const f = n.fbm(u * 16, v * 16, 4, 16);
    const moss = smoothstep(0.55, 0.75, n.fbm(u * 4, v * 4, 4, 4)) * mortar;
    let g = 0.3 + id * 0.14 + (f - 0.5) * 0.2;
    g *= 1 - mortar * 0.75;
    o.r = g + moss * 0.02; o.g = g * 0.98 + moss * 0.08; o.b = g * 0.95;
    o.h = (1 - mortar) * (0.5 + smoothstep(0, 0.4, edge) * 0.5) + (f - 0.5) * 0.15;
  });
  return finish(p);
}

export function dirt(seed = 17) {
  const n = new ValueNoise(seed), r = mulberry32(seed);
  const p = pixels(512, (u, v, o) => {
    const f = n.fbm(u * 8, v * 8, 6, 8);
    const w = n.fbm(u * 2, v * 2, 3, 2);
    const peb = smoothstep(0.72, 0.78, n.noise(u * 96, v * 96, 96));
    const grass = smoothstep(0.6, 0.75, n.fbm(u * 4 + 7, v * 4, 4, 4));
    let g = 0.22 + (f - 0.5) * 0.3 + (w - 0.5) * 0.1 + peb * 0.12;
    o.r = g * 1.05 + grass * 0.02; o.g = g * 0.92 + grass * 0.05; o.b = g * 0.75;
    o.h = f + peb * 0.4 + (r() - 0.5) * 0.1;
  });
  return finish(p);
}

export function metal(seed = 19, rust = 0.4, base = [0.32, 0.33, 0.35]) {
  const n = new ValueNoise(seed), r = mulberry32(seed);
  const p = pixels(512, (u, v, o) => {
    const f = n.fbm(u * 8, v * 8, 5, 8);
    const rs = smoothstep(1 - rust * 0.6, 1 - rust * 0.6 + 0.15, n.fbm(u * 4 + 3, v * 4, 5, 4));
    const brushed = n.noise(u * 4, v * 256, 4) * 0.06;
    let cr = base[0] + (f - 0.5) * 0.12 + brushed, cg = base[1] + (f - 0.5) * 0.12 + brushed, cb = base[2] + (f - 0.5) * 0.12 + brushed;
    cr = cr * (1 - rs) + rs * (0.36 + f * 0.15);
    cg = cg * (1 - rs) + rs * (0.17 + f * 0.06);
    cb = cb * (1 - rs) + rs * (0.08);
    o.r = cr + (r() - 0.5) * 0.02; o.g = cg; o.b = cb;
    o.h = 0.5 + rs * 0.3 + (f - 0.5) * 0.2;
  });
  // Kratzer
  const { cc, size } = p;
  for (let i = 0; i < 60; i++) {
    cc.strokeStyle = `rgba(200,200,205,${0.05 + r() * 0.12})`;
    cc.lineWidth = 0.5 + r();
    const x = r() * size, y = r() * size, a = r() * Math.PI, l = (size / 512) * 40;
    cc.beginPath(); cc.moveTo(x, y); cc.lineTo(x + Math.cos(a) * l * r(), y + Math.sin(a) * l * r()); cc.stroke();
  }
  return finish(p);
}

export function shutter(seed = 23) {
  const n = new ValueNoise(seed);
  const p = pixels(512, (u, v, o) => {
    const rib = Math.sin(v * Math.PI * 2 * 24);
    const f = n.fbm(u * 6, v * 6, 5, 6);
    const rs = smoothstep(0.45, 0.65, n.fbm(u * 3, v * 3 + 2, 5, 3) + (v > 0.85 ? 0.15 : 0));
    let g = 0.36 + rib * 0.06 + (f - 0.5) * 0.12;
    o.r = g * (1 - rs) + rs * (0.38 + f * 0.1);
    o.g = g * (1 - rs) + rs * 0.18;
    o.b = g * 1.04 * (1 - rs) + rs * 0.08;
    o.h = 0.5 + rib * 0.45;
  });
  return finish(p);
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

export function grass(seed = 51) {
  const n = new ValueNoise(seed), r = mulberry32(seed);
  const p = pixels(512, (u, v, o) => {
    const f = n.fbm(u * 8, v * 8, 5, 8);
    const patch = n.fbm(u * 2 + 3, v * 2, 4, 2);
    const dirtA = smoothstep(0.58, 0.72, patch);
    const blade = n.noise(u * 160, v * 160, 160);
    let g = 0.2 + (f - 0.5) * 0.18 + blade * 0.06;
    // verdorrtes Gras (oliv/braun) mit Erdflecken
    let cr = g * 0.95, cg = g * 0.98, cb = g * 0.62;
    cr = cr * (1 - dirtA) + dirtA * (0.2 + f * 0.08); cg = cg * (1 - dirtA) + dirtA * (0.16 + f * 0.06); cb = cb * (1 - dirtA) + dirtA * 0.1;
    o.r = cr + (r() - 0.5) * 0.03; o.g = cg; o.b = cb;
    o.h = 0.4 + blade * 0.4 + (f - 0.5) * 0.3;
  });
  return finish(p);
}

// Asphalt; v läuft entlang der Straße (eine Kachel = 8 m), u quer (0 … 1 = ganze Breite)
export function asphalt(seed = 53) {
  const n = new ValueNoise(seed), r = mulberry32(seed);
  const p = pixels(512, (u, v, o) => {
    const f = n.fbm(u * 8, v * 8, 5, 8);
    const crack = smoothstep(0.62, 0.66, n.fbm(u * 6 + 4, v * 6, 4, 6)) * smoothstep(0.7, 0.66, n.fbm(u * 6 + 4, v * 6, 4, 6));
    const patchy = smoothstep(0.55, 0.7, n.fbm(u * 3, v * 3 + 7, 4, 3));
    let g = 0.15 + (f - 0.5) * 0.1 + (r() - 0.5) * 0.05 - crack * 0.08 + patchy * 0.04;
    // Mittellinie gestrichelt, Randlinien durchgezogen (abgefahren)
    const wear = 0.55 + n.noise(u * 40, v * 40, 40) * 0.45;
    const center = Math.abs(u - 0.5) < 0.012 && (v * 2) % 1 < 0.55;
    const edge = Math.abs(u - 0.06) < 0.01 || Math.abs(u - 0.94) < 0.01;
    if (center) g = g * (1 - wear) + 0.62 * wear;
    let cr = g, cg = g, cb = g * 1.04;
    if (edge) { cr = g * (1 - wear) + 0.6 * wear; cg = cr; cb = cr * 0.95; }
    if (center) { cr = g; cg = g * 0.96; cb = g * 0.6; cr += 0.05 * wear; } // gelblich
    const shoulder = u < 0.035 || u > 0.965;
    if (shoulder) { cr = 0.2 + f * 0.05; cg = 0.18; cb = 0.13; }
    o.r = cr; o.g = cg; o.b = cb;
    o.h = 0.5 + (f - 0.5) * 0.5 - crack * 0.4;
  });
  return finish(p);
}

export function brick(seed = 55, tint = [0.42, 0.18, 0.13]) {
  const n = new ValueNoise(seed), r = mulberry32(seed);
  const rows = 40, cols = 12;
  const p = pixels(512, (u, v, o) => {
    const row = Math.floor(v * rows);
    const bu = u * cols + (row % 2) * 0.5;
    const fu = bu - Math.floor(bu), fv = v * rows - row;
    const mortar = fu < 0.05 || fv < 0.12;
    const id = Math.floor(bu) * 17 + row * 5;
    const k = ((Math.sin(id * 12.9898) * 43758.5453) % 1 + 1) % 1;
    const f = n.fbm(u * 16, v * 16, 4, 16);
    const soot = smoothstep(0.55, 0.8, n.fbm(u * 3, v * 3, 4, 3)) * 0.35 + smoothstep(0.4, 0, 1 - v) * 0.2;
    let cr = mortar ? 0.33 : tint[0] * (0.8 + k * 0.4) + (f - 0.5) * 0.08;
    let cg = mortar ? 0.31 : tint[1] * (0.8 + k * 0.4) + (f - 0.5) * 0.05;
    let cb = mortar ? 0.28 : tint[2] * (0.8 + k * 0.4);
    o.r = cr * (1 - soot) + (r() - 0.5) * 0.02; o.g = cg * (1 - soot); o.b = cb * (1 - soot);
    o.h = mortar ? 0.2 : 0.6 + (f - 0.5) * 0.2;
  });
  return finish(p);
}

// Holzverkleidung (waagrechte Bretter), z. B. Bauernhaus oder Scheune
export function siding(seed = 57, base = [0.62, 0.6, 0.55], boards = 16) {
  const n = new ValueNoise(seed), r = mulberry32(seed);
  const p = pixels(512, (u, v, o) => {
    const bv = v * boards, bi = Math.floor(bv), bf = bv - bi;
    const shadow = bf > 0.86 ? 0.55 : 1;
    const grain = n.fbm(u * 3 + bi * 1.7, bv * 6, 4, 3);
    const peel = smoothstep(0.58, 0.64, n.fbm(u * 5, v * 5 + 2, 4, 5));
    const dirtA = smoothstep(0.5, 0, 1 - v) * 0.3 + smoothstep(0.55, 0.8, n.fbm(u * 2, v * 2, 3, 2)) * 0.3;
    let cr = base[0] * (0.85 + grain * 0.3), cg = base[1] * (0.85 + grain * 0.3), cb = base[2] * (0.85 + grain * 0.3);
    cr = cr * (1 - peel) + peel * 0.3; cg = cg * (1 - peel) + peel * 0.24; cb = cb * (1 - peel) + peel * 0.18;
    const k = shadow * (1 - dirtA);
    o.r = cr * k + (r() - 0.5) * 0.02; o.g = cg * k; o.b = cb * k;
    o.h = bf > 0.86 ? 0.15 : 0.6 + (grain - 0.5) * 0.3 - peel * 0.2;
  });
  return finish(p);
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
