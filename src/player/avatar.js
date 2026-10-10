// ─────────────────────────────────────────────────────────────
//  Spielfiguren der Mitspieler (3rd-Person): vier eigene Überlebende
//  (Willi, Dr. Albers, Hanne, Kai). Prozedural modelliert – Dreh- und
//  Röhrenkörper mit je einem gemalten Textur-Atlas (survivorTex.js) –
//  und prozedural animiert: Gehen und Rennen in alle Richtungen,
//  Ducken, Springen, Hechtsprung, Liegen, am Boden mit Pistole, Zielen,
//  Rückstoß, Nachladen, Messer, Granate, Trinken, Wiederbeleben.
//  In den Händen liegt die echte Waffe (dieselben Modelle wie in der
//  Ego-Ansicht), die Arme greifen sie per Zwei-Knochen-IK.
//  Konvention: Figur blickt nach -z, rechts = +x, Füße bei y = 0;
//  Maße für eine 1,82 m große Standardfigur (je Figur skaliert).
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { paintSurvivor, REG, uvRect, swatchUV, torsoT, limbT } from './survivorTex.js';
import { buildGun, buildKnife, buildGrenade, buildBottle } from '../weapons/guns.js';
import { clamp, damp } from '../core/utils.js';

export const CHAR_IDS = ['willi', 'albers', 'hanne', 'kai'];
export const CHAR_NAMES = { willi: 'Willi', albers: 'Dr. Albers', hanne: 'Hanne', kai: 'Kai' };

const TAU = Math.PI * 2;
const HIP_Y = 0.94, WAIST_Y = 1.06, SHOULDER_Y = 1.47, NECK_Y = 1.585, HEAD_C = 1.705, HEAD_R = 0.105;
const L_UP = 0.3, L_FORE = 0.3, L_THIGH = 0.45, L_SHIN = 0.42, ANKLE_Y = 0.07;
const HEAD_S = [0.84, 1.06, 0.98];

// Figuren: Größe, Statur, Haar, Stiefelschaft, Zubehör
const DEFS = {
  willi: { scale: 0.955, wide: 1.07, belly: 0.035, bust: 0, waist: 1.08, hip: 1.04, chin: 1, hair: { r: 1.035, front: 0.34, back: 0.6 }, shaft: 0.3, extras: ['beard', 'cap', 'kerchief', 'joppe'] },
  albers: { scale: 1.02, wide: 0.95, belly: 0, bust: 0, waist: 0.95, hip: 0.96, chin: 1.15, hair: { r: 1.03, front: 0.29, back: 0.58 }, shaft: 0, extras: ['glasses', 'coat', 'collar'] },
  hanne: { scale: 0.94, wide: 0.9, belly: 0, bust: 0.022, waist: 0.88, hip: 1.03, chin: 0.7, hair: { r: 1.05, front: 0.3, back: 0.64 }, shaft: 0.14, extras: ['ponytail', 'goggles', 'rag'] },
  kai: { scale: 0.98, wide: 0.97, belly: 0, bust: 0, waist: 0.97, hip: 0.97, chin: 0.9, hair: { r: 1.08, front: 0.3, back: 0.6 }, shaft: 0.06, extras: ['hood', 'phones', 'curls'] },
};

// ── Geometrie-Helfer ──────────────────────────────────────────
const uvIn = (R, s, t) => [R[0] + s * (R[2] - R[0]), R[3] - t * (R[3] - R[1])];

function finish(pos, uvs, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Normalen an der Naht (erste/letzte Spalte) mitteln
function weld(g, rows, cols) {
  const n = g.attributes.normal;
  for (let j = 0; j < rows; j++) {
    const a = j * cols, b = a + cols - 1;
    const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b), l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l);
  }
  return g;
}

// Ringkörper um die y-Achse: rows [{ y, w, d, x, z, t }] von oben nach unten (w/d = Halbachsen).
// s: 0 hinten (+z), ¼ links (-x), ½ vorn (-z), ¾ rechts (+x). us: s → u im Bereich (Standard: s).
function ring(rows, seg, rect, { s0 = 0, s1 = 1, us = null, flip = false } = {}) {
  const cols = seg + 1, pos = [], uvs = [], idx = [];
  for (const r of rows) {
    for (let i = 0; i < cols; i++) {
      const s = s0 + (i / seg) * (s1 - s0), a = s * TAU;
      pos.push((r.x || 0) - Math.sin(a) * r.w, r.y, (r.z || 0) + Math.cos(a) * r.d);
      uvs.push(...uvIn(rect, us ? us(s) : s, r.t));
    }
  }
  for (let j = 0; j < rows.length - 1; j++) for (let i = 0; i < seg; i++) {
    const a = j * cols + i, b = a + cols;
    if (flip) idx.push(a, b, a + 1, b, b + 1, a + 1);
    else idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = finish(pos, uvs, idx);
  return s1 - s0 === 1 ? weld(g, rows.length, cols) : g;
}

// Kugelschale über Richtungen (Kopf, Haare, Bart …): rad(dx, dy, dz) → Radius in Metern,
// Bereich der Polarwinkel th0…th1 (0 = oben) und Winkel s0…s1; uv(s, th) → [s', t'] im Bereich
function shell(center, rad, rect, { th0 = 0, th1 = Math.PI, s0 = 0, s1 = 1, rows = 16, seg = 28, uv = null, scale = HEAD_S }) {
  const cols = seg + 1, pos = [], uvs = [], idx = [];
  for (let j = 0; j <= rows; j++) {
    const th = th0 + (j / rows) * (th1 - th0);
    for (let i = 0; i < cols; i++) {
      const s = s0 + (i / seg) * (s1 - s0), a = s * TAU;
      const dx = -Math.sin(a) * Math.sin(th), dy = Math.cos(th), dz = Math.cos(a) * Math.sin(th);
      const r = rad(dx, dy, dz, s, th);
      pos.push(center[0] + dx * r * scale[0], center[1] + dy * r * scale[1], center[2] + dz * r * scale[2]);
      uvs.push(...uvIn(rect, ...(uv ? uv(s, th) : [s, th / Math.PI])));
    }
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < seg; i++) {
    const a = j * cols + i, b = a + cols;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = finish(pos, uvs, idx);
  return s1 - s0 === 1 ? weld(g, rows + 1, cols) : g;
}

// Einfarbige Teile: alle UVs auf ein Farbfeld des Atlas
function solid(g, i) {
  const [u, v] = swatchUV(i), uv = g.attributes.uv;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, u, v);
  return g;
}
// Teile zu einer Geometrie zusammenfassen (alle indiziert, nur Position/Normale/UV)
function merge(list) {
  return mergeGeometries(list.filter(Boolean).map((g) => {
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    return g;
  }), false);
}

const G2 = (x, y) => Math.exp(-(x * x + y * y));

// Gesichtsform: Nase, Brauen, Augenhöhlen, Wangen, Kinn, Lippen, schmalerer Kiefer
function faceShape(def) {
  return (dx, dy, dz) => {
    const ax = Math.atan2(dx, -dz), ay = Math.asin(clamp(dy, -1, 1)), aa = Math.abs(ax);
    let r = 1;
    r += 0.15 * G2(ax / 0.1, (ay + 0.13) / 0.12);
    r += 0.05 * G2(ax / 0.07, (ay + 0.22) / 0.05);
    r += 0.035 * G2(ax / 0.5, (ay - 0.22) / 0.07);
    r -= 0.035 * G2((aa - 0.37) / 0.13, (ay - 0.11) / 0.07);
    r += 0.03 * G2((aa - 0.62) / 0.2, (ay + 0.1) / 0.12);
    r += 0.06 * def.chin * G2(ax / 0.3, (ay + 0.64) / 0.13);
    r += 0.022 * G2(ax / 0.17, (ay + 0.44) / 0.06);
    r -= 0.06 * G2((aa - 1.25) / 0.35, (ay + 0.62) / 0.28);
    if (dy < -0.35) r -= (-0.35 - dy) * 0.3;
    return HEAD_R * r;
  };
}

// ── Rumpf ─────────────────────────────────────────────────────
// [y, Halbbreite, Halbtiefe, z-Mitte]
const TORSO_ROWS = [
  [1.575, 0.052, 0.048, 0.006], [1.56, 0.1, 0.075, 0.008], [1.535, 0.16, 0.094, 0.01], [1.49, 0.19, 0.104, 0.004],
  [1.42, 0.186, 0.115, -0.006], [1.34, 0.178, 0.116, -0.008], [1.25, 0.166, 0.11, -0.004], [1.16, 0.158, 0.106, 0],
  [1.09, 0.155, 0.104, 0], [1.03, 0.158, 0.106, 0.002], [0.97, 0.164, 0.108, 0.006], [0.9, 0.162, 0.104, 0.008],
  [0.84, 0.13, 0.088, 0.01], [0.8, 0.07, 0.055, 0.012], [0.788, 0.0, 0.0, 0.012],
];
function torsoRows(def, y0, y1) {
  return TORSO_ROWS.filter(([y]) => y <= y1 + 1e-6 && y >= y0 - 1e-6).map(([y, w, d, z]) => {
    const sh = clamp((y - 1.3) / 0.2, 0, 1), wa = G2((y - 1.12) / 0.09, 0), hp = G2((y - 0.94) / 0.08, 0);
    w *= 1 + (def.wide - 1) * sh + (def.waist - 1) * wa + (def.hip - 1) * hp;
    const belly = def.belly * G2((y - 1.15) / 0.1, 0), bust = def.bust * G2((y - 1.39) / 0.045, 0);
    return { y, w, d: d + belly * 0.6 + bust * 0.5, z: z - belly * 0.5 - bust * 0.7, t: torsoT(y) };
  });
}

// ── Gliedmaßen (Röhren entlang -y ab dem Gelenk) ──────────────
function limb(kind, prof, rect, sx = 1, sz = 1) {
  return ring(prof.map(([h, r]) => ({ y: -h, w: r * sx, d: r * sz, t: clamp(limbT(kind, h), 0, 1) })), 14, rect);
}

// Hand im Handraum: Handgelenk im Ursprung, Finger -z, Handrücken +y (wie die Anker der Waffen)
function handGeo(right, closed) {
  const R = uvRect('hand');
  const rows = [[0, 0.028, 0.02], [-0.035, 0.038, 0.02], [-0.085, 0.046, 0.019], [-0.12, 0.044, 0.017], [-0.155, 0.04, 0.014], [-0.175, 0.025, 0.01], [-0.182, 0.004, 0.003]];
  const pos = [], uvs = [], idx = [], seg = 12, cols = seg + 1;
  rows.forEach(([z, w, h], j) => {
    for (let i = 0; i < cols; i++) {
      const a = (i / seg) * TAU;
      let y = Math.sin(a) * h, zz = z;
      // geschlossen: Finger krümmen sich zur Handfläche (-y) um den Griff
      if (closed && z < -0.085) { const k = (-0.085 - z) / 0.1; y -= k * k * 0.06; zz = -0.085 + (z + 0.085) * (1 - k * 0.45); }
      pos.push(Math.cos(a) * w, y, zz);
      uvs.push(...uvIn(R, i / seg, j / (rows.length - 1)));
    }
  });
  for (let j = 0; j < rows.length - 1; j++) for (let i = 0; i < seg; i++) {
    const a = j * cols + i, b = a + cols;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const palm = weld(finish(pos, uvs, idx), rows.length, cols);
  // Daumen
  const th = new THREE.CapsuleGeometry(0.011, 0.045, 3, 8);
  th.rotateX(Math.PI / 2); th.rotateY(right ? -0.6 : 0.6);
  th.translate(right ? -0.034 : 0.034, -0.008, -0.05);
  const tuv = th.attributes.uv;
  for (let k = 0; k < tuv.count; k++) tuv.setXY(k, ...uvIn(R, tuv.getX(k), 0.5 + tuv.getY(k) * 0.4));
  return merge([palm, th]);
}

// Schuh/Stiefel ab dem Knöchel (y = 0) bis zur Sohle, Spitze nach -z
function footGeo() {
  const R = uvRect('foot');
  const rows = [
    { y: 0.025, w: 0.042, d: 0.048, z: 0.0 }, { y: -0.01, w: 0.047, d: 0.062, z: -0.012 }, { y: -0.035, w: 0.051, d: 0.1, z: -0.045 },
    { y: -0.055, w: 0.053, d: 0.125, z: -0.06 }, { y: -0.068, w: 0.053, d: 0.13, z: -0.062 }, { y: -0.075, w: 0.05, d: 0.125, z: -0.062 }, { y: -0.077, w: 0.0, d: 0.0, z: -0.062 },
  ];
  rows.forEach((r, j) => { r.t = j / (rows.length - 1); });
  return ring(rows, 16, R);
}

// ── Bausatz je Figur (Geometrien gemeinsam für alle Instanzen) ─
const GEOS = new Map();
function buildGeos(id) {
  const def = DEFS[id], ex = new Set(def.extras), k = {};
  const T = uvRect('torso'), H = uvRect('head');
  // Rumpf: unten (Becken, Knochen bei HIP_Y) und oben (Brust, Knochen bei WAIST_Y)
  const lower = ring(torsoRows(def, 0.78, 1.1), 22, T);
  const upper = ring(torsoRows(def, 1.02, 1.58), 22, T);
  const neck = ring([[1.66, 0.044], [1.6, 0.048], [1.53, 0.054]].map(([y, r]) => ({ y, w: r, d: r * 1.05, z: 0.008, t: 0.86 + (1.66 - y) * 1.0 })), 12, H);
  const chestParts = [upper, neck];
  if (ex.has('hood')) {
    const E = uvRect('extra');
    chestParts.push(ring([[1.6, 0.085, 0.07, 0.05], [1.56, 0.14, 0.12, 0.07], [1.5, 0.15, 0.13, 0.085], [1.44, 0.12, 0.1, 0.1], [1.41, 0.04, 0.03, 0.11]]
      .map(([y, w, d, z], j) => ({ y, w, d, z, t: j / 4 })), 10, E, { s0: -0.2, s1: 0.2, us: (s) => s / 0.4 + 0.5 }));
  }
  if (ex.has('phones')) {
    const band = new THREE.TorusGeometry(0.072, 0.009, 6, 20, Math.PI * 1.25); band.rotateZ(-Math.PI * 0.125 - Math.PI / 2); band.rotateX(Math.PI / 2 - 0.35); band.translate(0, 1.56, -0.01);
    chestParts.push(solid(band, 2));
    for (const sd of [-1, 1]) { const cup = new THREE.CylinderGeometry(0.032, 0.032, 0.022, 14); cup.rotateZ(Math.PI / 2); cup.rotateY(sd * 0.5); cup.translate(sd * 0.072, 1.535, -0.045); chestParts.push(solid(cup, 0)); }
  }
  if (ex.has('kerchief')) {
    const t = new THREE.TorusGeometry(0.062, 0.02, 8, 18); t.rotateX(Math.PI / 2 - 0.15); t.translate(0, 1.565, 0.0); chestParts.push(solid(t, 1));
    const knot = new THREE.ConeGeometry(0.05, 0.09, 4); knot.rotateX(Math.PI); knot.translate(0, 1.51, -0.085); chestParts.push(solid(knot, 1));
  }
  if (ex.has('collar')) {
    chestParts.push(solid(ring([[1.62, 0.07, 0.075, 0.01], [1.565, 0.11, 0.1, 0.012], [1.53, 0.15, 0.11, 0.01]].map(([y, w, d, z], j) => ({ y, w, d, z, t: j / 2 })), 14, H, { s0: -0.36, s1: 0.36 }), 1));
  }
  k.chest = merge(chestParts).translate(0, -WAIST_Y, 0);
  const lowerParts = [lower];
  if (ex.has('rag')) { const r = new THREE.BoxGeometry(0.075, 0.16, 0.006, 1, 3, 1); r.rotateZ(0.12); r.translate(0.075, 0.86, 0.116); lowerParts.push(solid(r, 4)); }
  k.pelvis = merge(lowerParts).translate(0, -HIP_Y, 0);

  // Kopf mit Ohren, Haaren und Zubehör (Knochen bei NECK_Y)
  const C = [0, HEAD_C, -0.008];
  const headParts = [shell(C, faceShape(def), H, { rows: 18, seg: 30 })];
  for (const sd of [-1, 1]) {
    const e = new THREE.SphereGeometry(0.026, 10, 8); e.scale(0.45, 1, 0.75); e.translate(sd * HEAD_R * 0.86, HEAD_C - 0.005, 0.0);
    const uv = e.attributes.uv; const [u, v] = uvIn(H, sd > 0 ? 0.75 : 0.25, 0.5);
    for (let q = 0; q < uv.count; q++) uv.setXY(q, u + (uv.getX(q) - 0.5) * 0.02, v + (uv.getY(q) - 0.5) * 0.04);
    headParts.push(e);
  }
  const HR = uvRect('hair'), hd = def.hair;
  // Haarrand: vorn an der Stirn, seitlich über den Ohren, hinten im Nacken
  const edge = (s) => { const f = Math.pow((1 - Math.cos(s * TAU)) / 2, 1.7); return (hd.back + (hd.front - hd.back) * f) * Math.PI; };
  // Haarkappe: Rand von der Stirn (vorn) bis in den Nacken (hinten)
  {
    const rows = 10, seg = 30, cols = seg + 1, pos = [], uvs = [], idx = [];
    for (let j = 0; j <= rows; j++) for (let i = 0; i < cols; i++) {
      const s = i / seg, a = s * TAU, th = (j / rows) * edge(s);
      const dx = -Math.sin(a) * Math.sin(th), dy = Math.cos(th), dz = Math.cos(a) * Math.sin(th);
      let r = HEAD_R * hd.r * (1 + 0.07 * G2(0, (dy - 1) / 0.55));
      if (ex.has('curls')) r += 0.006 * Math.sin(a * 9) * Math.sin(th * 7);
      if (j === rows) r = HEAD_R * (hd.r - 0.02);
      pos.push(C[0] + dx * r * HEAD_S[0], C[1] + dy * r * HEAD_S[1], C[2] + dz * r * HEAD_S[2]);
      uvs.push(...uvIn(HR, s, j / rows));
    }
    for (let j = 0; j < rows; j++) for (let i = 0; i < seg; i++) { const a = j * cols + i, b = a + cols; idx.push(a, a + 1, b, b, a + 1, b + 1); }
    headParts.push(weld(finish(pos, uvs, idx), rows + 1, cols));
  }
  const H2 = uvRect('hair2');
  if (ex.has('curls')) {
    headParts.push(shell(C, (dx, dy, dz, s, th) => HEAD_R * (1.13 + 0.035 * Math.sin(s * TAU * 11) * Math.sin(th * 13) - 0.06 * (th / 1.05)), H2,
      { th0: 0, th1: 1.05, rows: 8, seg: 30, uv: (s, th) => [s, th / 1.05] }));
  }
  if (ex.has('beard')) {
    const a0 = 0.5 - 0.21, a1 = 0.5 + 0.21, t0 = 0.6 * Math.PI, t1 = 0.94 * Math.PI;
    headParts.push(shell(C, (dx, dy, dz, s, th) => {
      const f = Math.sin(((th - t0) / (t1 - t0)) * Math.PI), side = 1 - Math.abs((s - 0.5) / 0.21);
      return faceShape(def)(dx, dy, dz) * (1.02 + 0.09 * f * Math.min(1, side * 2.2));
    }, H2, { th0: t0, th1: t1, s0: a0, s1: a1, rows: 8, seg: 16, uv: (s, th) => [(s - a0) / (a1 - a0), (th - t0) / (t1 - t0)] }));
  }
  if (ex.has('cap')) {
    const E2 = uvRect('extra2');
    const cap = shell([C[0], C[1] + 0.012, C[2] - 0.01], (dx, dy, dz) => HEAD_R * (1.13 + 0.05 * Math.max(0, -dz)), E2,
      { th0: 0, th1: 0.42 * Math.PI, rows: 8, seg: 28, uv: (s, th) => [s, th / (0.42 * Math.PI)], scale: [HEAD_S[0], HEAD_S[1] * 0.72, HEAD_S[2] * 1.02] });
    headParts.push(cap);
    const yb = C[1] + 0.012 + Math.cos(0.42 * Math.PI) * HEAD_R * 1.13 * HEAD_S[1] * 0.72;
    const brim = (flip, dy) => ring([{ y: yb + dy, w: 0.088, d: 0.1, z: -0.012, t: 0 }, { y: yb + dy - 0.004, w: 0.094, d: 0.155, z: -0.02, t: 1 }], 14, E2, { s0: 0.3, s1: 0.7, us: (s) => (s - 0.3) / 0.4, flip });
    headParts.push(brim(false, 0), brim(true, -0.004));
  }
  if (ex.has('glasses')) {
    for (const sd of [-1, 1]) {
      const rim = new THREE.TorusGeometry(0.019, 0.0022, 5, 16); rim.translate(sd * 0.036, HEAD_C + 0.012, -HEAD_R * HEAD_S[2] - 0.012); headParts.push(solid(rim, 0));
      const tmp = new THREE.BoxGeometry(0.0025, 0.0025, 0.1); tmp.translate(sd * 0.084, HEAD_C + 0.014, -0.05); headParts.push(solid(tmp, 0));
    }
    const br = new THREE.CylinderGeometry(0.0018, 0.0018, 0.034, 5); br.rotateZ(Math.PI / 2); br.translate(0, HEAD_C + 0.018, -HEAD_R * HEAD_S[2] - 0.014); headParts.push(solid(br, 0));
  }
  if (ex.has('goggles')) {
    const y = HEAD_C + 0.062;
    const strap = new THREE.TorusGeometry(HEAD_R * 1.04, 0.0075, 5, 30); strap.rotateX(Math.PI / 2 + 0.25); strap.scale(HEAD_S[0] * 1.02, 1, HEAD_S[2]); strap.translate(0, y, -0.004);
    headParts.push(solid(strap, 0));
    for (const sd of [-1, 1]) {
      const cup = new THREE.CylinderGeometry(0.024, 0.027, 0.022, 14); cup.rotateX(Math.PI / 2 - 0.7); cup.translate(sd * 0.034, y + 0.022, -HEAD_R * HEAD_S[2] * 0.88); headParts.push(solid(cup, 1));
      const gl = new THREE.CylinderGeometry(0.019, 0.019, 0.004, 14); gl.rotateX(Math.PI / 2 - 0.7); gl.translate(sd * 0.034, y + 0.03, -HEAD_R * HEAD_S[2] * 0.88 - 0.011); headParts.push(solid(gl, 2));
    }
  }
  k.head = merge(headParts).translate(0, -NECK_Y, 0);
  if (ex.has('ponytail')) {
    const prof = [];
    for (let j = 0; j <= 8; j++) { const t = j / 8; prof.push({ y: -0.27 * t, w: 0.03 * (1 - 0.6 * t) + 0.006, d: 0.026 * (1 - 0.6 * t) + 0.006, z: 0.07 * t * t, t }); }
    const pt = ring(prof, 10, H2);
    const tie = solid(new THREE.TorusGeometry(0.03, 0.008, 6, 12), 3); tie.rotateX(Math.PI / 2);
    k.ponytail = merge([pt, tie]);
  }
  // Arme, Hände
  k.upperL = limb('upper', [[-0.07, 0.0], [-0.055, 0.04], [-0.02, 0.056], [0.05, 0.058], [0.15, 0.05], [0.27, 0.043], [0.33, 0.04]], uvRect('armUL'), def.wide, 1);
  k.upperR = limb('upper', [[-0.07, 0.0], [-0.055, 0.04], [-0.02, 0.056], [0.05, 0.058], [0.15, 0.05], [0.27, 0.043], [0.33, 0.04]], uvRect('armUR'), def.wide, 1);
  k.fore = limb('fore', [[-0.04, 0.028], [0.0, 0.042], [0.07, 0.044], [0.18, 0.036], [0.27, 0.029], [0.3, 0.026]], uvRect('armF'));
  k.handR = handGeo(true, true);
  k.handL = handGeo(false, true);
  // Beine, Füße, Stiefelschaft
  const hp = def.hip;
  k.thigh = limb('thigh', [[-0.07, 0.05], [0.0, 0.082], [0.12, 0.08], [0.3, 0.064], [0.42, 0.054], [0.47, 0.05]], uvRect('thigh'), hp, hp);
  const shinProf = [[-0.04, 0.046], [0.0, 0.052], [0.1, 0.056], [0.25, 0.047], [0.38, 0.038], [0.43, 0.036]];
  const shinParts = [limb('shin', shinProf, uvRect('shin'))];
  if (def.shaft > 0) {
    const h0 = L_SHIN + 0.01 - def.shaft;
    const r = (h) => { let a = shinProf[0]; for (const p of shinProf) { if (p[0] <= h) a = p; } return a[1]; };
    shinParts.push(ring([[h0 - 0.005, r(h0) + 0.016], [h0 + 0.01, r(h0) + 0.012], [L_SHIN + 0.012, 0.047]].map(([h, rr], j) => ({ y: -h, w: rr, d: rr * 1.05, t: j / 2 })), 14, uvRect('shaft')));
  }
  k.shin = merge(shinParts);
  k.foot = footGeo();
  // Kittel- bzw. Joppenschoß (zweiseitig)
  if (ex.has('coat')) {
    const E = uvRect('extra');
    const rows = [[1.03, 0.168, 0.113, 0.003], [0.9, 0.18, 0.124, 0.004], [0.72, 0.198, 0.14, 0.006], [0.56, 0.212, 0.152, 0.006]].map(([y, w, d, z]) => ({ y, w: w * def.hip, d, z, t: (1.03 - y) / 0.47 }));
    k.coatL = ring(rows, 12, E, { s0: 0.02, s1: 0.47 }).translate(0.095, -HIP_Y, 0);
    k.coatR = ring(rows, 12, E, { s0: 0.53, s1: 0.98 }).translate(-0.095, -HIP_Y, 0);
  }
  if (ex.has('joppe')) {
    const E = uvRect('extra');
    k.joppe = ring([[1.06, 0.168, 0.118, 0.0], [0.94, 0.18, 0.126, 0.004], [0.8, 0.186, 0.128, 0.006]].map(([y, w, d, z], j) => ({ y, w: w * def.hip, d: d + def.belly * 0.2, z, t: j / 2 })), 20, E).translate(0, -HIP_Y, 0);
  }
  return k;
}

// Spielerfarbe auf das Reflexband am linken Oberarm (und Farbfeld 5)
function tintBand(map, color) {
  const cv = map.image, c = cv.getContext('2d'), f = cv.width / 1024;
  const [x, y, w, h] = REG.armUL, [sx, sy] = REG.sw;
  c.save();
  c.fillStyle = color; c.globalAlpha = 0.92;
  c.fillRect(x * f, (y + h * 0.42) * f, w * f, h * 0.14 * f);
  c.globalAlpha = 1;
  c.fillRect((sx + 32) * f, (sy + 32) * f, 32 * f, 32 * f);
  c.restore();
  map.needsUpdate = true;
}

const KITS = new Map();
function kit(id, color) {
  const key = id + '|' + color;
  let k = KITS.get(key);
  if (k) return k;
  let geos = GEOS.get(id);
  if (!geos) { geos = buildGeos(id); GEOS.set(id, geos); }
  const tex = paintSurvivor(id, CHAR_IDS.indexOf(id) + 1);
  tintBand(tex.map, color);
  const mat = new THREE.MeshStandardMaterial({ map: tex.map, roughnessMap: tex.rough, roughness: 1, metalness: 0 });
  const matDS = mat.clone(); matDS.side = THREE.DoubleSide;
  k = { def: DEFS[id], geos, mat, matDS };
  KITS.set(key, k);
  return k;
}

// ── Namensschild ──────────────────────────────────────────────
function tagTexture(text, color) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const c = cv.getContext('2d');
  c.font = '600 34px Oswald, Arial Narrow, sans-serif';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.lineWidth = 6; c.strokeStyle = 'rgba(0,0,0,0.85)';
  c.strokeText(text, 128, 34);
  c.fillStyle = color; c.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ── IK ────────────────────────────────────────────────────────
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _e = new THREE.Vector3(), _p = new THREE.Vector3(), _t = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const DOWN = new THREE.Vector3(0, -1, 0);
const _eu = new THREE.Euler();

// Zwei Knochen (Oberarm, Unterarm) vom Schulterpunkt S zum Ziel T, Ellbogen Richtung pole (alles im Raum des Elternteils)
function solveIK(arm, T, pole) {
  const S = arm.shoulder.position;
  _v.subVectors(T, S);
  let len = _v.length();
  const L1 = arm.L1, L2 = arm.L2;
  len = clamp(len, Math.abs(L1 - L2) + 0.01, L1 + L2 - 0.005);
  _v.normalize();
  const cosA = clamp((L1 * L1 + len * len - L2 * L2) / (2 * L1 * len), -1, 1), A = Math.acos(cosA);
  _w.copy(pole).addScaledVector(_v, -pole.dot(_v));
  if (_w.lengthSq() < 1e-6) _w.set(0, -1, 0);
  _w.normalize();
  _e.copy(_v).multiplyScalar(Math.cos(A)).addScaledVector(_w, Math.sin(A)); // Richtung Oberarm
  arm.shoulder.quaternion.setFromUnitVectors(DOWN, _e);
  _p.copy(S).addScaledVector(_e, L1); // Ellbogen
  _t.copy(S).addScaledVector(_v, len).sub(_p).normalize(); // Richtung Unterarm
  _q.copy(arm.shoulder.quaternion).invert();
  _t.applyQuaternion(_q);
  arm.elbow.quaternion.setFromUnitVectors(DOWN, _t);
}

// ── Figur ─────────────────────────────────────────────────────
class SurvivorAvatar {
  constructor(game, char, name, color = '#ffffff') {
    this.g = game;
    this.id = CHAR_IDS[((char | 0) % 4 + 4) % 4];
    this.color = color;
    const K = (this.kit = kit(this.id, color)), G = K.geos, def = K.def, mat = K.mat;
    const mesh = (geo, parent, m = mat) => { const o = new THREE.Mesh(geo, m); o.castShadow = true; parent.add(o); return o; };
    const grp = (parent, x = 0, y = 0, z = 0) => { const o = new THREE.Group(); o.position.set(x, y, z); parent.add(o); return o; };

    const root = (this.group = new THREE.Group());
    root.userData.dynamic = true;
    this.body = grp(root);
    this.body.scale.setScalar(def.scale);
    this.hips = grp(this.body, 0, HIP_Y, 0);
    this.lower = grp(this.hips);
    mesh(G.pelvis, this.lower);
    if (G.joppe) mesh(G.joppe, this.lower, K.matDS);
    this.legs = [-1, 1].map((sd) => {
      const hip = grp(this.lower, sd * 0.095 * def.hip, 0, 0);
      mesh(G.thigh, hip);
      const knee = grp(hip, 0, -L_THIGH, 0);
      mesh(G.shin, knee);
      const ankle = grp(knee, 0, -L_SHIN, 0);
      mesh(G.foot, ankle);
      let coat = null;
      if (G.coatL) { coat = grp(this.lower, sd * 0.095, 0, 0); mesh(sd < 0 ? G.coatL : G.coatR, coat, K.matDS); }
      return { sd, hip, knee, ankle, coat };
    });
    this.spine = grp(this.hips, 0, WAIST_Y - HIP_Y, 0);
    this.spine.rotation.order = 'YXZ';
    mesh(G.chest, this.spine);
    this.neck = grp(this.spine, 0, NECK_Y - WAIST_Y, 0);
    this.neck.rotation.order = 'YXZ';
    mesh(G.head, this.neck);
    if (G.ponytail) { this.tail = grp(this.neck, 0, HEAD_C + 0.035 - NECK_Y, 0.085); mesh(G.ponytail, this.tail); }
    // Arme (Kinder der Brust; IK im Brustraum)
    const sy = SHOULDER_Y - WAIST_Y, sx = 0.19 * def.wide;
    this.arms = [-1, 1].map((sd) => {
      const shoulder = grp(this.spine, sd * sx, sy, 0.0);
      mesh(sd < 0 ? G.upperL : G.upperR, shoulder);
      const elbow = grp(shoulder, 0, -L_UP, 0);
      mesh(G.fore, elbow);
      const hand = grp(elbow, 0, -L_FORE, 0);
      mesh(sd < 0 ? G.handL : G.handR, hand);
      return { sd, shoulder, elbow, hand, L1: L_UP, L2: L_FORE, target: new THREE.Vector3(), pole: new THREE.Vector3(sd * 0.8, -1, 0.5).normalize(), held: true };
    });
    // Waffe: Zielpunkt in Schulterhöhe, Waffe hängt am Griff der rechten Hand
    this.aim = grp(this.spine, 0, sy - 0.05, 0);
    this.aim.rotation.order = 'YXZ';
    this.slot = grp(this.aim);
    this.gun = null; this.gunId = null; this.gunPap = false;
    this.props = {};
    // Name und Wiederbelebungs-Symbol in fester Bildschirmgröße (Maßstab je Bild, siehe update)
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ depthWrite: false, transparent: true, sizeAttenuation: false }));
    this.tag.position.y = 2.02;
    root.add(this.tag);
    this.icon = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xff3020, depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false }));
    this.icon.position.y = 1.0; this.icon.visible = false; this.icon.renderOrder = 999;
    root.add(this.icon);
    this.setTag(name || CHAR_NAMES[this.id], color);
    // Animationszustand
    this.phase = 0; this.crouch = 0; this.prone = 0; this.down = 0; this.dive = 0; this.air = 0; this.ads = 0; this.run = 0;
    this.speed = 0; this.hipYaw = 0; this.recoil = 0; this.lastSeq = null; this.tailSwing = 0; this.lowered = 0;
  }

  // ── Schnittstelle (wie der Platzhalter) ─────────────────────
  setWeapon(id, pap = false) {
    if (id === this.gunId && !!pap === this.gunPap) return;
    if (this.gun) { this.slot.remove(this.gun.group); this.gun = null; }
    this.gunId = id || null; this.gunPap = !!pap;
    if (!id || !this.g.M) return;
    try {
      const info = buildGun(id, this.g.M, !!pap);
      info.group.updateMatrixWorld(true);
      const grip = info.handR ? info.handR.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, -0.03, 0.08);
      info.group.position.copy(grip).negate();
      info.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.slot.add(info.group);
      this.gun = info;
      this.long = Math.max(0.2, -new THREE.Box3().setFromObject(info.group).min.z);
    } catch (err) { console.warn('[Figur] Waffe', id, err); }
  }

  setTag(text, color) {
    if (this.tag.material.map) this.tag.material.map.dispose();
    this.tag.material.map = tagTexture(text, color);
    this.tag.material.needsUpdate = true;
  }

  setReviveIcon(on, progress = 0) { this.icon.visible = on; this.icon.material.color.setRGB(1, 0.2 + progress * 0.8, 0.1 + progress * 0.4); }
  setVisible(on) { this.group.visible = on; }

  // Gegenstand in einer Hand (Messer, Granate, Flasche) – einmal gebaut, dann nur ein-/ausgeblendet
  prop(name) {
    let p = this.props[name];
    if (p === undefined) {
      try {
        if (name === 'knife') { p = buildKnife(this.g.M, false); p.rotation.y = Math.PI / 2; p.position.set(-0.01, -0.025, -0.075); }
        else if (name === 'nade') { p = buildGrenade(this.g.M); p.position.set(0, -0.035, -0.08); }
        else if (name === 'bottle') { const b = buildBottle('#c83a2a'); p = b.group || b; p.rotation.x = -Math.PI / 2; p.position.set(0, -0.035, -0.08); }
        if (p) { p.traverse((o) => { if (o.isMesh) o.castShadow = true; }); p.visible = false; this.arms[1].hand.add(p); }
      } catch { p = null; }
      this.props[name] = p || null;
    }
    return p;
  }
  showProp(name) { for (const k of ['knife', 'nade', 'bottle']) { const p = k === name ? this.prop(k) : this.props[k]; if (p) p.visible = k === name; } }

  muzzleWorld(out) {
    if (this.gun && this.gun.muzzle && this.slot.visible) return this.gun.muzzle.getWorldPosition(out);
    return this.headWorld(out);
  }
  headWorld(out) { return this.neck.localToWorld(out.set(0, HEAD_C - NECK_Y, 0)); }

  // ── Animation ───────────────────────────────────────────────
  update(dt, s) {
    dt = Math.min(dt, 0.1);
    const root = this.group;
    root.position.copy(s.pos);
    root.rotation.y = s.yaw;
    // Geschwindigkeit im eigenen Raum (lz < 0 = vorwärts, lx > 0 = nach rechts)
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw), vx = s.vel ? s.vel.x : 0, vz = s.vel ? s.vel.z : 0;
    const lx = vx * c - vz * sn, lz = vx * sn + vz * c;
    const speed = Math.hypot(lx, lz);
    this.speed = damp(this.speed, speed, 10, dt);
    const lying = s.downed ? 0 : s.prone ? 1 : 0;
    this.down = damp(this.down, s.downed ? 1 : 0, 7, dt);
    this.prone = damp(this.prone, lying, 7, dt);
    this.dive = damp(this.dive, s.dive ? 1 : 0, 10, dt);
    this.crouch = damp(this.crouch, (s.crouch || 0) * (1 - this.prone) + (s.action === 'revive' ? 1 : 0) * (1 - (s.crouch || 0)), 10, dt);
    this.air = damp(this.air, !s.onGround && !s.dive && !s.downed ? 1 : 0, 8, dt);
    this.ads = damp(this.ads, s.ads || 0, 12, dt);
    this.run = damp(this.run, s.sprint ? 1 : 0, 8, dt);
    const upright = clamp(1 - this.prone - this.down - this.dive, 0, 1);

    // Gangzyklus
    const sp = this.speed, stride = 0.62 + sp * 0.11;
    if (sp > 0.15) this.phase = (this.phase + (dt * sp * Math.PI) / stride) % TAU;
    else this.phase = damp(this.phase, Math.round(this.phase / Math.PI) * Math.PI, 4, dt);
    const walk = clamp(sp / 3, 0, 1) * upright * (1 - this.air);
    // Laufrichtung relativ zum Blick: rückwärts → Beine rückwärts, seitlich → Hüfte dreht mit
    let mdir = Math.atan2(lx, -lz);
    let back = 1;
    if (Math.abs(mdir) > Math.PI * 0.6) { back = -1; mdir -= Math.sign(mdir) * Math.PI; }
    this.hipYaw = damp(this.hipYaw, sp > 0.4 ? clamp(-mdir, -0.9, 0.9) : 0, 8, dt);
    this.lower.rotation.y = this.hipYaw * upright;

    // Hüfte: aufrecht / geduckt / liegend (Bauch) / Hechtsprung / am Boden (Rücken, aufgestützt)
    const cr = this.crouch * upright;
    const bob = Math.abs(Math.sin(this.phase)) * 0.045 * walk * (1 + this.run * 0.5);
    const hipUp = HIP_Y - bob - cr * 0.42 - this.air * 0.05;
    this.hips.position.set(0,
      hipUp * upright + 0.15 * this.prone + 0.42 * this.dive + 0.17 * this.down,
      0.62 * this.prone + 0.45 * this.dive + 0.05 * this.down);
    this.hips.rotation.x = -Math.PI / 2 * this.prone - 1.35 * this.dive + 0.95 * this.down;
    this.hips.rotation.z = Math.sin(this.phase) * 0.04 * walk;

    // Beine
    const A = (0.42 + 0.3 * this.run) * walk * back;
    for (const L of this.legs) {
      const ph = this.phase + (L.sd < 0 ? 0 : Math.PI);
      const swing = Math.sin(ph) * A;
      const lift = Math.max(0, Math.cos(ph) * back) * (0.75 + this.run * 0.6) * walk;
      let thigh = swing + cr * 1.25 + this.air * 0.55;
      let knee = -lift - 0.06 - cr * 2.3 - this.air * 1.1;
      // Liegen: Beine gestreckt nach hinten; Hechtsprung: leicht angewinkelt; am Boden: nach vorn ausgestreckt
      thigh = thigh * upright + 0.05 * this.prone + 0.25 * this.dive + (Math.PI / 2 - 0.95 + (L.sd < 0 ? 0.1 : -0.05)) * this.down;
      knee = knee * upright - 0.12 * this.prone - 0.5 * this.dive + (L.sd < 0 ? -0.5 : -0.15) * this.down;
      L.hip.rotation.set(thigh, 0, L.sd * (0.03 + 0.08 * this.down + cr * 0.12));
      L.knee.rotation.x = knee;
      L.ankle.rotation.x = -(thigh + knee) * 0.85 * upright + 0.6 * this.prone + 0.4 * this.dive - 0.3 * this.down;
      if (L.coat) L.coat.rotation.x = Math.max(-0.2, thigh * 0.55);
    }

    // Rumpf: Lehnen (Ducken, Rennen, am Boden aufrichten), Mitdrehen beim Gehen, Atmen
    const breathe = Math.sin(performance.now() * 0.0021) * 0.012;
    this.spine.rotation.x = -(0.32 * cr + 0.16 * this.run * walk) - 0.35 * this.down + breathe + this.prone * 0.12 + this.dive * 0.1;
    this.spine.rotation.y = Math.sin(this.phase) * 0.07 * walk - this.hipYaw * 0.15 * upright;
    // Kopf folgt dem Blick (Rest übernimmt der Zielpunkt der Waffe)
    const chestPitch = this.hips.rotation.x + this.spine.rotation.x;
    const pitch = s.pitch || 0;
    this.neck.rotation.x = clamp(pitch * 0.55 - chestPitch * 0.75, -0.9, 0.9);
    this.neck.rotation.y = -this.spine.rotation.y;
    if (this.tail) {
      this.tailSwing = damp(this.tailSwing, clamp(lz * 0.06, -0.4, 0.4) + Math.sin(this.phase * 2) * 0.08 * walk, 6, dt);
      this.tail.rotation.set(0.15 + this.tailSwing - this.neck.rotation.x * 0.8, 0, Math.sin(this.phase) * 0.12 * walk);
    }

    // Aktionen
    const act = s.action || 'idle', at = s.actionT || 0;
    if (s.fireSeq !== this.lastSeq) { if (this.lastSeq !== null && act === 'fire') this.recoil = 1; this.lastSeq = s.fireSeq; }
    this.recoil = damp(this.recoil, 0, 14, dt);
    let gunVis = !!this.gun, freeR = false, freeL = false;
    let gx = 0.13 - this.ads * 0.08, gy = -0.07 + this.ads * 0.21, gz = -0.3 + this.ads * 0.04 + this.recoil * 0.05;
    let gp = 0, gyaw = 0, groll = 0;
    if (this.long > 0.45) gz += 0.04;
    // Sprint: Waffe schräg vor der Brust
    const runPose = this.run * walk * (1 - this.ads);
    gx -= 0.06 * runPose; gy -= 0.06 * runPose; gz += 0.1 * runPose; gp -= 0.55 * runPose; gyaw += 0.85 * runPose;
    gp += this.recoil * 0.12;
    let propName = null, handR = null, handL = null, headPitch = 0;
    if (act === 'raise') gp -= Math.max(0, 1 - at / 0.4) * 1.1;
    if (act === 'reload') {
      const k = at;
      groll += 0.35 * clamp(k / 0.25, 0, 1) * clamp((1.9 - k) / 0.3, 0, 1);
      gp += 0.12 * clamp(k / 0.25, 0, 1) * clamp((1.9 - k) / 0.3, 0, 1);
      if (k > 0.2 && k < 1.6) {
        freeL = true;
        const u = clamp((k - 0.25) / 0.5, 0, 1) * clamp((1.55 - k) / 0.5, 0, 1);
        handL = new THREE.Vector3(-0.02 - 0.1 * u, -0.06 - 0.32 * u, -0.25 + 0.15 * u);
      }
    }
    if (act === 'knife' && at < 0.55) {
      freeR = true; propName = 'knife';
      const u = clamp(at / 0.5, 0, 1), sw = Math.sin(u * Math.PI);
      handR = new THREE.Vector3(0.22 - 0.34 * u, -0.14 + 0.06 * sw, -0.2 - 0.36 * sw);
      gx -= 0.12; gy -= 0.08; gyaw += 0.5;
    }
    if (act === 'throw' && at < 0.8) {
      freeR = true; propName = at < 0.42 ? 'nade' : null;
      const u = clamp(at / 0.75, 0, 1);
      handR = u < 0.45 ? new THREE.Vector3(0.24, 0.2 + u * 0.25, 0.1 + u * 0.15) : new THREE.Vector3(0.24 - (u - 0.45) * 0.4, 0.31 - (u - 0.45) * 0.5, 0.17 - (u - 0.45) * 1.6);
      gx -= 0.14; gy -= 0.1; gyaw += 0.6;
    }
    if (act === 'drink' && at < 2.6) {
      gunVis = false; freeR = true; freeL = true; propName = 'bottle';
      const u = clamp((at - 0.25) / 0.5, 0, 1) * clamp((2.4 - at) / 0.4, 0, 1);
      handR = new THREE.Vector3(0.12 - 0.1 * u, -0.05 + 0.25 * u, -0.25 + 0.1 * u);
      headPitch = 0.45 * u;
    }
    if (act === 'revive') { gunVis = false; freeR = true; freeL = true; handR = new THREE.Vector3(0.12, -0.32, -0.42); handL = new THREE.Vector3(-0.12, -0.32, -0.42); }
    if (this.down > 0.5) { freeL = true; handL = new THREE.Vector3(-0.28, -0.42, 0.1); }
    this.neck.rotation.x += headPitch;
    this.showProp(propName);

    // Zielpunkt: Weltneigung = Blick, unabhängig von Lehnen/Liegen
    this.aim.rotation.set(pitch - chestPitch + gp, -this.spine.rotation.y + gyaw, groll);
    this.slot.position.set(gx, gy, gz);
    this.slot.visible = gunVis;

    // Arme per IK im Brustraum (freie Hand-Ziele: y relativ zur Schulterlinie)
    root.updateMatrixWorld(true);
    _m.copy(this.spine.matrixWorld).invert();
    const anchor = (o, out) => o.getWorldPosition(out).applyMatrix4(_m);
    const [AL, AR] = this.arms, sy = SHOULDER_Y - WAIST_Y;
    const hang = (A) => A.target.set(A.shoulder.position.x + A.sd * 0.03, A.shoulder.position.y - 0.56, 0.05);
    // Rechte Hand: Griff der Waffe oder frei
    if (gunVis && !freeR && this.gun) anchor(this.gun.handR || this.slot, AR.target);
    else if (handR) AR.target.set(handR.x, sy + handR.y, handR.z);
    else hang(AR);
    // Linke Hand: Handschutz bzw. Stützhand oder frei
    if (gunVis && !freeL && this.gun && this.gun.handL) anchor(this.gun.handL, AL.target);
    else if (gunVis && !freeL && this.gun) AL.target.copy(AR.target).add(_v.set(-0.05, -0.02, -0.06));
    else if (handL) AL.target.set(handL.x, sy + handL.y, handL.z);
    else hang(AL);
    solveIK(AR, AR.target, AR.pole);
    solveIK(AL, AL.target, AL.pole);
    // Hände an den Griffpunkten ausrichten
    this.orientHand(AR, gunVis && !freeR && this.gun ? this.gun.handR : null);
    this.orientHand(AL, gunVis && !freeL && this.gun ? this.gun.handL : null);

    // Name und Symbol: feste Bildschirmgröße (18–40 px hoch)
    const k = Math.tan(((this.g.camera ? this.g.camera.fov : 80) * Math.PI) / 360);
    const vh = this.g.rs ? this.g.rs.height : 720;
    const h = (Math.min(40, Math.max(18, vh * 0.05)) / vh) * 2 * k;
    this.tag.scale.set(h * 4, h, 1);
    this.tag.position.y = 2.02 * this.body.scale.y * (upright + 0.25 * (1 - upright)) - cr * 0.45;
    this.icon.scale.set(h * 1.4, h * 1.4, 1);
  }

  // Hand: an einem Griffanker (Finger -z, Handrücken +y) oder locker in Verlängerung des Unterarms
  orientHand(arm, anchorObj) {
    const hand = arm.hand;
    if (anchorObj) {
      arm.shoulder.updateMatrixWorld(true);
      anchorObj.getWorldQuaternion(_q);
      arm.elbow.getWorldQuaternion(_q2).invert();
      hand.quaternion.copy(_q2.multiply(_q));
    } else hand.quaternion.setFromEuler(_eu.set(-Math.PI / 2 + 0.2, -arm.sd * 1.3, 0, 'YXZ'));
  }

  dispose() {
    this.group.removeFromParent();
    if (this.tag.material.map) this.tag.material.map.dispose();
    this.tag.material.dispose();
    this.icon.material.dispose();
  }
}

export function makeSurvivorAvatar(game, char, name, color) {
  return new SurvivorAvatar(game, char, name, color);
}
