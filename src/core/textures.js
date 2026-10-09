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
    const peel = smoothstep(0.62, 0.68, n.fbm(u * 5, v * 5 + 2, 4, 5)) * 0.8;
    const dirtA = smoothstep(0.5, 0, 1 - v) * 0.3 + smoothstep(0.55, 0.8, n.fbm(u * 2, v * 2, 3, 2)) * 0.3;
    let cr = base[0] * (0.85 + grain * 0.3), cg = base[1] * (0.85 + grain * 0.3), cb = base[2] * (0.85 + grain * 0.3);
    cr = cr * (1 - peel) + peel * 0.42; cg = cg * (1 - peel) + peel * 0.34; cb = cb * (1 - peel) + peel * 0.25;
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

