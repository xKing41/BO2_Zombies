// ─────────────────────────────────────────────────────────────
//  Waffen-Texturen & -Materialien: brünierter Stahl mit Kratzern,
//  Polymer mit Stippling, Nussbaum, Fischhaut-Griffschalen, Atlas für
//  Handschuhe/Ärmel/Haut, Mündungsfeuer, Rauch und Flaschenetiketten.
//  Alles prozedural auf Canvas – keine externen Dateien.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { ValueNoise, mulberry32 } from '../core/noise.js';
import { toTexture } from '../core/textures.js';
import { IS_MOBILE } from '../core/platform.js';
import { clamp, smoothstep } from '../core/utils.js';

const RES = IS_MOBILE ? 256 : 512;

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Pixel-Generator: Farbkarte (sRGB) + Datenkarte (R Höhe, G Rauheit, B Abrieb-Maske)
function gen(size, fn) {
  const col = canvas(size), dat = canvas(size);
  const cc = col.getContext('2d'), dc = dat.getContext('2d');
  const ci = cc.createImageData(size, size), di = dc.createImageData(size, size);
  const o = { r: 1, g: 1, b: 1, h: 0.5, rough: 0.5, wear: 0 };
  let i = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++, i += 4) {
      o.r = o.g = o.b = 1; o.h = 0.5; o.rough = 0.5; o.wear = 0;
      fn(x / size, y / size, o);
      ci.data[i] = clamp(o.r, 0, 1) * 255; ci.data[i + 1] = clamp(o.g, 0, 1) * 255; ci.data[i + 2] = clamp(o.b, 0, 1) * 255; ci.data[i + 3] = 255;
      di.data[i] = clamp(o.h, 0, 1) * 255; di.data[i + 1] = clamp(o.rough, 0, 1) * 255; di.data[i + 2] = clamp(o.wear, 0, 1) * 255; di.data[i + 3] = 255;
    }
  }
  cc.putImageData(ci, 0, 0); dc.putImageData(di, 0, 0);
  return { col, dat, cc, dc, size };
}

const finish = (p) => ({ map: toTexture(p.col), data: toTexture(p.dat, { srgb: false }) });

// Zeichnet kachelbar (Striche am Rand erscheinen auf der Gegenseite wieder)
function wrapped(ctx, size, x, y, reach, draw) {
  for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
    if (x + ox < -reach || x + ox > size + reach || y + oy < -reach || y + oy > size + reach) continue;
    draw(ctx, x + ox, y + oy);
  }
}

// Kratzer: Rille in der Höhe, glatter, blankes Metall in der Abrieb-Maske
function scratches(p, rnd, count, { len = 34, along = 0.8, wear = 255, depth = 'rgb(120,175,255)', color = null } = {}) {
  const { cc, dc, size } = p;
  const k = size / 512;
  for (let i = 0; i < count; i++) {
    const x = rnd() * size, y = rnd() * size;
    const a = rnd() < along ? (rnd() - 0.5) * 0.4 : rnd() * Math.PI;
    const l = (5 + rnd() * rnd() * len * 2) * k;
    const w = (0.5 + rnd() * 0.9) * k;
    const bend = (rnd() - 0.5) * l * 0.25;
    const ex = Math.cos(a) * l, ey = Math.sin(a) * l;
    const path = (ctx, px, py) => {
      ctx.beginPath(); ctx.moveTo(px, py);
      ctx.quadraticCurveTo(px + ex / 2 - Math.sin(a) * bend, py + ey / 2 + Math.cos(a) * bend, px + ex, py + ey);
      ctx.stroke();
    };
    dc.lineCap = 'round'; dc.lineWidth = w;
    dc.globalCompositeOperation = 'multiply'; dc.strokeStyle = depth;
    wrapped(dc, size, x, y, l + 4, path);
    dc.globalCompositeOperation = 'lighter'; dc.strokeStyle = `rgb(0,0,${wear})`;
    wrapped(dc, size, x, y, l + 4, path);
    if (color) { cc.lineCap = 'round'; cc.lineWidth = w; cc.strokeStyle = color; wrapped(cc, size, x, y, l + 4, path); }
  }
  dc.globalCompositeOperation = 'source-over';
}

// ── Oberflächen ───────────────────────────────────────────────
// Stahl: neutrale Detailkarte (Grundfarbe kommt aus der Vertexfarbe)
function steelTex(seed = 3) {
  const n = new ValueNoise(seed), r = mulberry32(seed);
  const p = gen(RES, (u, v, o) => {
    const f = n.fbm(u * 6, v * 6, 4, 6);
    const fine = n.noise(u * 128, v * 128, 128);
    const brushed = n.noise(u * 2, v * 190, 2);
    const smudge = smoothstep(0.55, 0.8, n.fbm(u * 3 + 11, v * 3, 3, 3));
    const k = 0.9 + (f - 0.5) * 0.2 + (fine - 0.5) * 0.06 + (brushed - 0.5) * 0.08;
    o.r = k; o.g = k; o.b = k * 1.015;
    o.h = 0.55 + (fine - 0.5) * 0.22 + (f - 0.5) * 0.3;
    o.rough = 0.5 + (f - 0.5) * 0.28 + (brushed - 0.5) * 0.12 - smudge * 0.14;
    o.wear = smoothstep(0.32, 0.78, n.fbm(u * 5 + 7, v * 5 + 3, 4, 5)) * 0.8;
    // Lochfraß
    const pit = smoothstep(0.82, 0.9, n.noise(u * 64 + 3, v * 64 + 9, 64));
    o.h -= pit * 0.35; o.rough += pit * 0.3; o.r -= pit * 0.15; o.g -= pit * 0.17; o.b -= pit * 0.2;
  });
  scratches(p, r, IS_MOBILE ? 70 : 150);
  return finish(p);
}

// Polymer mit Stippling und Abrieb
function polyTex(seed = 5) {
  const n = new ValueNoise(seed), r = mulberry32(seed);
  const p = gen(RES, (u, v, o) => {
    const f = n.fbm(u * 5, v * 5, 4, 5);
    const st = n.noise(u * 200, v * 200, 200);
    const dust = smoothstep(0.58, 0.85, n.fbm(u * 3 + 4, v * 3 + 1, 4, 3));
    const k = 0.93 + (f - 0.5) * 0.12 + dust * 0.25;
    o.r = k; o.g = k * 0.99; o.b = k * 0.97;
    o.h = 0.5 + (st - 0.5) * 0.55 + (f - 0.5) * 0.15;
    o.rough = 0.66 + (f - 0.5) * 0.18 + st * 0.08 + dust * 0.12;
    o.wear = smoothstep(0.35, 0.8, n.fbm(u * 6 + 2, v * 6 + 8, 4, 6)) * 0.75;
  });
  scratches(p, r, IS_MOBILE ? 25 : 50, { len: 20, wear: 190, depth: 'rgb(150,230,255)' });
  return finish(p);
}

// Nussbaum: Maserung läuft entlang u (= Waffenlänge)
function woodTex(seed = 7, checker = 0) {
  const n = new ValueNoise(seed), r = mulberry32(seed);
  const p = gen(RES, (u, v, o) => {
    const warp = n.fbm(u * 1.5, v * 6, 4, 1.5 * 1);
    const ring = Math.sin((v * 18 + warp * 5 + n.noise(u * 3, v * 3, 3) * 0.6) * Math.PI * 2) * 0.5 + 0.5;
    const pore = n.noise(u * 6, v * 340, 6);
    const figure = n.fbm(u * 2 + 5, v * 2, 3, 2);
    const dark = smoothstep(0.55, 0.95, ring) * 0.5 + smoothstep(0.62, 0.8, pore) * 0.35;
    let cr = 0.4 + (figure - 0.5) * 0.14, cg = 0.22 + (figure - 0.5) * 0.08, cb = 0.11 + (figure - 0.5) * 0.04;
    cr *= 1 - dark * 0.55; cg *= 1 - dark * 0.62; cb *= 1 - dark * 0.65;
    o.r = cr; o.g = cg; o.b = cb;
    o.h = 0.55 - dark * 0.3 + (pore - 0.5) * 0.15;
    o.rough = 0.42 + dark * 0.18 + (figure - 0.5) * 0.1;
    o.wear = smoothstep(0.3, 0.8, n.fbm(u * 5 + 1, v * 5 + 6, 4, 5)) * 0.8;
    if (checker) {
      // Fischhaut: zwei diagonale Rillenscharen
      const s = checker;
      const d1 = Math.abs(((u + v) * s) % 1 - 0.5), d2 = Math.abs(((u - v + 4) * s) % 1 - 0.5);
      const ridge = Math.min(smoothstep(0.0, 0.45, d1), smoothstep(0.0, 0.45, d2));
      o.h = 0.25 + ridge * 0.6;
      o.rough = 0.55 + (1 - ridge) * 0.2;
      o.r *= 0.75 + ridge * 0.3; o.g *= 0.75 + ridge * 0.3; o.b *= 0.75 + ridge * 0.3;
      o.wear *= 0.5;
    }
  });
  scratches(p, r, checker ? 10 : (IS_MOBILE ? 30 : 60), { len: 26, wear: 230, depth: 'rgb(140,210,255)' });
  return finish(p);
}

// ── Kantenabrieb per Shader ───────────────────────────────────
// Krümmung aus Bildschirm-Ableitungen der Normalen: abgerundete Kanten
// werden blank (Metall) bzw. heller (Holz/Polymer). Vertex-Alpha skaliert die Rauheit.
function addWear(mat, bare, bareRough, lo, hi, edge = 1) {
  mat.userData.wear = { uBare: { value: new THREE.Color().setRGB(bare[0], bare[1], bare[2]) }, uBareRough: { value: bareRough }, uWearLo: { value: lo }, uWearHi: { value: hi }, uEdge: { value: edge } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, mat.userData.wear);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uBare; uniform float uBareRough, uWearLo, uWearHi, uEdge;\nfloat gWear = 0.0;')
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec3 wn = normalize(vNormal);
        float curv = length(fwidth(wn)) / max(length(fwidth(vViewPosition)), 1e-6);
        float patchW = texture2D(roughnessMap, vRoughnessMapUv).b;
        float edgeW = smoothstep(uWearLo, uWearHi, curv) * uEdge;
        gWear = clamp(edgeW * (0.25 + patchW) + smoothstep(0.86, 0.97, patchW), 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, uBare, gWear);
      }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      #ifdef USE_COLOR_ALPHA
        roughnessFactor *= vColor.a * 2.0;
      #endif
      roughnessFactor = mix(roughnessFactor, uBareRough, gWear);`);
  };
  return mat;
}

// ── Materialien (einmal je Material-Satz M) ───────────────────
const CACHE = new WeakMap();

export function gunMats(M) {
  let G = CACHE.get(M);
  if (G) return G;
  const steel = steelTex(), poly = polyTex(), wood = woodTex();
  const std = (o) => new THREE.MeshStandardMaterial(o);
  G = {};
  G.metal = addWear(std({ map: steel.map, roughnessMap: steel.data, bumpMap: steel.data, bumpScale: 0.6, roughness: 1, metalness: 0.88, vertexColors: true }), [0.36, 0.36, 0.38], 0.2, 140, 520);
  G.poly = addWear(std({ map: poly.map, roughnessMap: poly.data, bumpMap: poly.data, bumpScale: 0.5, roughness: 1, metalness: 0.04, vertexColors: true }), [0.075, 0.075, 0.072], 0.85, 160, 650, 0.85);
  G.wood = addWear(std({ map: wood.map, roughnessMap: wood.data, bumpMap: wood.data, bumpScale: 0.8, roughness: 1, metalness: 0, vertexColors: true }), [0.42, 0.25, 0.12], 0.62, 130, 520, 0.75);
  // Griffschalen mit Fischhaut (eigene UV-Dichte)
  const ck = woodTex(11, 12);
  G.woodChk = addWear(std({ map: ck.map, roughnessMap: ck.data, bumpMap: ck.data, bumpScale: 1.6, roughness: 1, metalness: 0, vertexColors: true }), [0.4, 0.24, 0.12], 0.6, 130, 520, 0.6);
  G.lens = std({ color: 0x0b1622, roughness: 0.06, metalness: 0.95, emissive: 0x08101a, emissiveIntensity: 0.6 });
  G.glass = std({ color: 0x9fc4d8, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false, envMapIntensity: 2.5 });
  G.glowGreen = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 2.4, 0.55) });
  G.glowRed = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.25, 0.45) });
  G.glowBlue = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.45, 1.1, 2.6) });
  G.glowViolet = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.7, 0.45, 2.6) });
  G.tritium = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.6, 0.6) });
  G.arms = armsMaterial();
  CACHE.set(M, G);
  return G;
}

// Vertexfarben (linear) mit Rauheits-Faktor in Alpha (0.5 = neutral)
export const TINT = {
  steel: [0.07, 0.072, 0.08, 0.5],
  blued: [0.045, 0.05, 0.065, 0.42],
  alu: [0.055, 0.055, 0.06, 0.55],
  dark: [0.02, 0.02, 0.022, 0.6],
  bore: [0.004, 0.004, 0.004, 0.9],
  brass: [0.78, 0.5, 0.18, 0.28],
  copper: [0.72, 0.3, 0.15, 0.32],
  chrome: [0.62, 0.62, 0.64, 0.18],
  gold: [0.85, 0.62, 0.22, 0.25],
  black: [0.04, 0.04, 0.043, 0.5],
  rubber: [0.028, 0.028, 0.028, 0.9],
  od: [0.06, 0.075, 0.045, 0.55],
  tan: [0.22, 0.17, 0.1, 0.55],
  red: [0.42, 0.035, 0.03, 0.3],
  cream: [0.6, 0.55, 0.42, 0.45],
  white: [0.75, 0.75, 0.72, 0.4],
  wood: [1, 1, 1, 0.5],
  woodDark: [0.62, 0.6, 0.6, 0.5],
  hole: [0.002, 0.002, 0.002, 1],
};

// ── Arme: Atlas aus Ärmel, Handschuh, Haut und Polstern ───────
// UV-Bereiche (u0, v0, u1, v1) im Atlas
export const ATLAS = {
  sleeve: [0.0, 0.5, 0.5, 1.0],
  glove: [0.5, 0.5, 1.0, 1.0],
  skin: [0.0, 0.0, 0.5, 0.5],
  pad: [0.5, 0.0, 1.0, 0.5],
};

function armsMaterial() {
  const size = RES;
  const half = size / 2;
  const n = new ValueNoise(77), r = mulberry32(77);
  const p = gen(size, (u, v, o) => {
    const lu = (u * 2) % 1, lv = (v * 2) % 1; // lokale Koordinate im Feld (v = Canvas-y)
    const left = u < 0.5, top = v < 0.5;
    if (left && top) {
      // Ärmel: Canvas-Jacke, oliv-braun, Falten quer zum Arm, Dreck
      const weave = (Math.sin(lu * size * 1.3) * Math.sin(lv * size * 1.3)) * 0.5;
      const fold = Math.sin((lv * 9 + n.fbm(lu * 2, lv * 3, 3, 2) * 2.5) * Math.PI * 2);
      const f = n.fbm(lu * 6, lv * 6, 4, 6);
      const dirtA = smoothstep(0.5, 0.85, n.fbm(lu * 3 + 5, lv * 3, 4, 3));
      const blood = smoothstep(0.78, 0.84, n.fbm(lu * 5 + 9, lv * 5 + 2, 4, 5));
      let k = 0.85 + (f - 0.5) * 0.3 + weave * 0.06 - (fold < -0.6 ? 0.18 : 0) - dirtA * 0.3;
      o.r = 0.27 * k; o.g = 0.25 * k; o.b = 0.17 * k;
      o.r = o.r * (1 - blood) + blood * 0.2; o.g *= 1 - blood * 0.85; o.b *= 1 - blood * 0.85;
      // Naht an beiden Seiten des Feldes
      const seam = lu < 0.03 || lu > 0.97;
      if (seam) { o.r *= 0.6; o.g *= 0.6; o.b *= 0.6; }
      o.h = 0.5 + fold * 0.22 + weave * 0.12 - (seam ? 0.2 : 0);
      o.rough = 0.92;
    } else if (!left && top) {
      // Handschuh: dunkles Leder mit Narbung, Nähten und Abrieb
      const grain = n.noise(lu * 160, lv * 160, 160);
      const f = n.fbm(lu * 5, lv * 5, 4, 5);
      const scuff = smoothstep(0.55, 0.85, n.fbm(lu * 4 + 3, lv * 4 + 7, 4, 4));
      let k = 0.9 + (f - 0.5) * 0.3 + (grain - 0.5) * 0.12 + scuff * 0.7;
      o.r = 0.085 * k; o.g = 0.068 * k; o.b = 0.055 * k;
      o.h = 0.5 + (grain - 0.5) * 0.3;
      o.rough = 0.62 + (grain - 0.5) * 0.1 + scuff * 0.2;
    } else if (left && !top) {
      // Haut: gebräunt, verschmutzt, Fingerknöchel gerötet
      const f = n.fbm(lu * 5, lv * 5, 4, 5);
      const pore = n.noise(lu * 200, lv * 200, 200);
      const grime = smoothstep(0.45, 0.85, n.fbm(lu * 4 + 1, lv * 4 + 4, 5, 4));
      const red = smoothstep(0.55, 0.8, n.fbm(lu * 3 + 8, lv * 3, 3, 3)) * 0.4;
      const k = 1 + (f - 0.5) * 0.18 - grime * 0.55;
      o.r = (0.62 + red * 0.08) * k; o.g = (0.46 - red * 0.04) * k; o.b = (0.36 - red * 0.03) * k;
      o.h = 0.5 + (pore - 0.5) * 0.2 + (f - 0.5) * 0.2;
      o.rough = 0.58 + grime * 0.25;
    } else {
      // Polster/Riemen: Kunststoff-Knöchelschutz mit Rippen, Klett
      const rib = Math.sin(lu * Math.PI * 2 * 10) * 0.5 + 0.5;
      const f = n.fbm(lu * 6, lv * 6, 4, 6);
      const k = 0.85 + (f - 0.5) * 0.25 + rib * 0.15;
      o.r = 0.05 * k; o.g = 0.05 * k; o.b = 0.048 * k;
      o.h = 0.4 + rib * 0.4;
      o.rough = 0.8 - rib * 0.15;
    }
  });
  // Nähte auf dem Handschuh
  const { cc, dc } = p;
  const k = size / 512;
  cc.strokeStyle = 'rgba(150,130,100,0.55)'; cc.lineWidth = 1.2 * k; cc.setLineDash([3 * k, 3 * k]);
  dc.strokeStyle = 'rgb(60,140,0)'; dc.lineWidth = 1.5 * k; dc.setLineDash([3 * k, 3 * k]);
  for (const ctx of [cc, dc]) {
    for (const y of [0.18, 0.5, 0.82]) { ctx.beginPath(); ctx.moveTo(half + 6 * k, y * half); ctx.lineTo(size - 6 * k, y * half); ctx.stroke(); }
    for (const x of [0.25, 0.75]) { ctx.beginPath(); ctx.moveTo(half + x * half, 6 * k); ctx.lineTo(half + x * half, half - 6 * k); ctx.stroke(); }
    ctx.setLineDash([]);
  }
  // Schmutzspritzer auf der Haut
  for (let i = 0; i < 40; i++) {
    cc.fillStyle = `rgba(40,28,18,${0.1 + r() * 0.25})`;
    cc.beginPath(); cc.arc(r() * half, half + r() * half, (1 + r() * 4) * k, 0, 7); cc.fill();
  }
  const t = finish(p);
  for (const x of [t.map, t.data]) { x.wrapS = x.wrapT = THREE.ClampToEdgeWrapping; }
  return new THREE.MeshStandardMaterial({ map: t.map, roughnessMap: t.data, bumpMap: t.data, bumpScale: 1.2, roughness: 1, metalness: 0 });
}

// ── Mündungsfeuer ─────────────────────────────────────────────
let FLASH = null;
export function flashTextures() {
  if (FLASH) return FLASH;
  const r = mulberry32(91);
  // Stern von vorn: 2×2 Varianten
  const S = 256;
  const star = canvas(S * 2), sc = star.getContext('2d');
  sc.globalCompositeOperation = 'lighter';
  for (let q = 0; q < 4; q++) {
    const cx = (q % 2) * S + S / 2, cy = Math.floor(q / 2) * S + S / 2;
    const petals = 4 + (q % 3) + (q === 3 ? 1 : 0);
    const rot = r() * Math.PI;
    for (let i = 0; i < petals; i++) {
      const a = rot + (i / petals) * Math.PI * 2 + (r() - 0.5) * 0.5;
      const len = S * (0.26 + r() * 0.22);
      const wid = 0.22 + r() * 0.2;
      const g = sc.createLinearGradient(cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      g.addColorStop(0, 'rgba(255,250,225,1)');
      g.addColorStop(0.35, 'rgba(255,200,110,0.85)');
      g.addColorStop(0.75, 'rgba(255,120,40,0.35)');
      g.addColorStop(1, 'rgba(255,80,20,0)');
      sc.fillStyle = g;
      sc.beginPath();
      sc.moveTo(cx + Math.cos(a + Math.PI / 2) * S * 0.05, cy + Math.sin(a + Math.PI / 2) * S * 0.05);
      sc.quadraticCurveTo(cx + Math.cos(a + wid) * len * 0.55, cy + Math.sin(a + wid) * len * 0.55, cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      sc.quadraticCurveTo(cx + Math.cos(a - wid) * len * 0.55, cy + Math.sin(a - wid) * len * 0.55, cx + Math.cos(a - Math.PI / 2) * S * 0.05, cy + Math.sin(a - Math.PI / 2) * S * 0.05);
      sc.fill();
    }
    const g = sc.createRadialGradient(cx, cy, 0, cx, cy, S * 0.2);
    g.addColorStop(0, 'rgba(255,255,245,1)');
    g.addColorStop(0.4, 'rgba(255,215,140,0.75)');
    g.addColorStop(1, 'rgba(255,120,40,0)');
    sc.fillStyle = g; sc.beginPath(); sc.arc(cx, cy, S * 0.2, 0, 7); sc.fill();
    // Funken
    for (let i = 0; i < 14; i++) {
      const a = r() * Math.PI * 2, d = S * (0.15 + r() * 0.3);
      sc.fillStyle = `rgba(255,${180 + r() * 60},${90 + r() * 60},${0.4 + r() * 0.5})`;
      sc.beginPath(); sc.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 1 + r() * 2, 0, 7); sc.fill();
    }
  }
  // Seitliche Flamme: 2 Varianten übereinander, Mündung links (u = 0)
  const W = 512, H = 128;
  const side = canvas(W, H * 2), dc = side.getContext('2d');
  dc.globalCompositeOperation = 'lighter';
  for (let q = 0; q < 2; q++) {
    const cy = q * H + H / 2;
    for (let i = 0; i < 9; i++) {
      const len = W * (0.45 + r() * 0.5), th = H * (0.12 + r() * 0.22) * (1 - i / 14);
      const off = (r() - 0.5) * H * 0.18;
      const g = dc.createLinearGradient(0, 0, len, 0);
      g.addColorStop(0, 'rgba(255,245,215,0.95)');
      g.addColorStop(0.25, 'rgba(255,190,100,0.75)');
      g.addColorStop(0.65, 'rgba(255,110,35,0.3)');
      g.addColorStop(1, 'rgba(255,70,20,0)');
      dc.fillStyle = g;
      dc.beginPath();
      dc.moveTo(0, cy - th * 0.35);
      dc.bezierCurveTo(len * 0.3, cy - th + off, len * 0.6, cy - th * 0.6 + off, len, cy + off * 1.5);
      dc.bezierCurveTo(len * 0.6, cy + th * 0.6 + off, len * 0.3, cy + th + off, 0, cy + th * 0.35);
      dc.fill();
    }
    const g = dc.createRadialGradient(0, cy, 0, 0, cy, H * 0.45);
    g.addColorStop(0, 'rgba(255,255,240,1)'); g.addColorStop(1, 'rgba(255,160,60,0)');
    dc.fillStyle = g; dc.fillRect(0, cy - H / 2, H * 0.5, H);
  }
  // Rauchwolke (weiß auf schwarz; Helligkeit = Deckkraft)
  const n = new ValueNoise(93);
  const P = 128, smoke = canvas(P), mc = smoke.getContext('2d');
  const img = mc.createImageData(P, P);
  for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) {
    const dx = x / P - 0.5, dy = y / P - 0.5, d = Math.hypot(dx, dy) * 2;
    const f = n.fbm(x / 24, y / 24, 4, 128 / 24);
    const a = clamp((1 - smoothstep(0.35, 1.0, d + (f - 0.5) * 0.6)) * (0.6 + f * 0.6), 0, 1);
    const i = (y * P + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = a * 255; img.data[i + 3] = 255;
  }
  mc.putImageData(img, 0, 0);
  FLASH = {
    star: toTexture(star, { repeat: false }),
    side: toTexture(side, { repeat: false }),
    smoke: toTexture(smoke, { srgb: false, repeat: false }),
  };
  return FLASH;
}

// ── Etikett der Perk-Flasche ─────────────────────────────────
const LABELS = new Map();
export function bottleLabel(hex, glyph = '✦', name = '') {
  const key = hex + glyph + name;
  if (LABELS.has(key)) return LABELS.get(key);
  const W = 256, H = 128;
  const cv = canvas(W, H), c = cv.getContext('2d');
  const col = '#' + new THREE.Color(hex).getHexString();
  c.fillStyle = '#e8dcc0'; c.fillRect(0, 0, W, H);
  c.fillStyle = col; c.fillRect(0, 14, W, H - 28);
  c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(0, 14, W, 6); c.fillRect(0, H - 20, W, 6);
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = 'bold 54px Oswald, Impact, sans-serif';
  c.fillStyle = '#fff6e0'; c.shadowColor = 'rgba(0,0,0,0.6)'; c.shadowBlur = 6;
  c.fillText(glyph, W * 0.25, H / 2 + 2);
  c.fillText(glyph, W * 0.75, H / 2 + 2);
  c.font = 'bold 20px Oswald, Impact, sans-serif'; c.shadowBlur = 3;
  c.fillText(name.toUpperCase(), W * 0.5, H / 2 + 2);
  c.shadowBlur = 0;
  // Abnutzung
  const r = mulberry32(hex & 0xffff);
  for (let i = 0; i < 60; i++) { c.fillStyle = `rgba(${r() < 0.5 ? '255,250,235' : '60,40,20'},${0.05 + r() * 0.15})`; c.fillRect(r() * W, r() * H, 2 + r() * 10, 1 + r() * 3); }
  const t = toTexture(cv, { repeat: false });
  LABELS.set(key, t);
  return t;
}
