// ─────────────────────────────────────────────────────────────
//  Zombie-Körper: prozedural modellierte Teile – Schädel mit
//  Augenhöhlen und offenem Mund, ausgemergelte Gliedmaßen,
//  Krallenhände, zerfetzte Ärmel und Hosenbeine, Accessoires –
//  plus die Teil-Typen für den Instanz-Renderer.
//  Konvention: Zombie blickt nach +z, Gliedmaßen hängen nach -y.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/noise.js';

const V2 = (x, y) => new THREE.Vector2(x, y);
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// Kleines, glattes Pseudo-Rauschen auf 3D-Positionen (für organische Unregelmäßigkeit)
function wobble(x, y, z, s) {
  return Math.sin(x * 41 + s) * Math.sin(y * 37 + s * 1.7) * Math.sin(z * 43 + s * 2.3)
    + 0.5 * Math.sin(x * 97 + s * 3.1) * Math.sin(y * 89 + s) * Math.sin(z * 83 + s * 0.7);
}

// Normalen an Nähten (gleiche Position, getrennte UVs) mitteln
function weldNormals(g) {
  const p = g.attributes.position, n = g.attributes.normal, map = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${Math.round(p.getX(i) * 2e4)},${Math.round(p.getY(i) * 2e4)},${Math.round(p.getZ(i) * 2e4)}`;
    let e = map.get(k);
    if (!e) map.set(k, (e = []));
    e.push(i);
  }
  for (const e of map.values()) {
    if (e.length < 2) continue;
    let x = 0, y = 0, z = 0;
    for (const i of e) { x += n.getX(i); y += n.getY(i); z += n.getZ(i); }
    const l = Math.hypot(x, y, z) || 1;
    for (const i of e) n.setXYZ(i, x / l, y / l, z / l);
  }
  return g;
}

// Rotationskörper mit elliptischem Querschnitt. Profil [radius, y] von unten nach oben.
// Naht liegt hinten (u = 0.5 vorne). jag: ausgefranster unterer Rand (offene Röhre).
function lathe(prof, o = {}) {
  const { seg = 14, sx = 1, sz = 1, jag = 0, noise = 0, seed = 1, bend = null, shape = null } = o;
  const n = prof.length;
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => V2(Math.max(r, 0.0001), y)), seg, Math.PI);
  const p = g.attributes.position, rnd = mulberry32(seed * 7919 + 13);
  // Zacken pro Segment (an der Naht identisch)
  const teeth = [];
  for (let i = 0; i < seg; i++) teeth.push((i % 2 ? 0.35 : 1) * (0.35 + rnd() * 0.65) * (rnd() < 0.15 ? 1.8 : 1));
  teeth.push(teeth[0]);
  for (let i = 0; i < p.count; i++) {
    const si = Math.floor(i / n), j = i % n;
    let x = p.getX(i) * sx, y = p.getY(i), z = p.getZ(i) * sz;
    if (jag && j === 0) y -= jag * teeth[si];
    if (noise) {
      const w = wobble(x, y, z, seed) * noise;
      const r = Math.hypot(x, z) || 1;
      x += (x / r) * w; z += (z / r) * w;
    }
    if (shape) { const v = shape(x, y, z); x = v[0]; y = v[1]; z = v[2]; }
    if (bend) z += bend(y);
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return weldNormals(g);
}

// UV-Höhe auf einen Ausschnitt der Textur legen (z. B. Bauch ohne Kragenblut)
function remapV(g, v0, v1) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, v0 + uv.getY(i) * (v1 - v0));
  return g;
}

// ── Kopf ──────────────────────────────────────────────────────
const HEAD_R = 0.106;
const HEAD_S = [0.84, 1.06, 0.98]; // Breite, Höhe, Tiefe

// Anisotrope Gauß-Beule auf der Einheitskugel
function bump(d, cx, cy, cz, sx, sy, amp) {
  const dx = (d.x - cx) / sx, dy = (d.y - cy) / sy, dz = (d.z - cz) / ((sx + sy) * 0.5);
  return amp * Math.exp(-(dx * dx + dy * dy + dz * dz));
}

// Radius-Faktor des Schädels in Richtung d (Einheitsvektor, +z = Gesicht)
function headRadius(d) {
  let r = 1;
  // Augenhöhlen, Brauenwulst, Wangenknochen, eingefallene Wangen
  r -= bump(d, 0.37, 0.13, 0.92, 0.17, 0.12, 0.2) + bump(d, -0.37, 0.13, 0.92, 0.17, 0.12, 0.2);
  r += bump(d, 0.33, 0.33, 0.88, 0.26, 0.07, 0.1) + bump(d, -0.33, 0.33, 0.88, 0.26, 0.07, 0.1);
  r += bump(d, 0.62, -0.05, 0.76, 0.14, 0.1, 0.1) + bump(d, -0.62, -0.05, 0.76, 0.14, 0.1, 0.1);
  // Gesichtsfläche flacher, Schädel nach hinten länger
  r -= smooth((d.z - 0.55) / 0.45) * 0.07 * smooth((0.75 - Math.abs(d.y)) / 0.3);
  r += smooth((-d.z - 0.3) / 0.6) * 0.05;
  r -= bump(d, 0.55, -0.32, 0.72, 0.16, 0.14, 0.09) + bump(d, -0.55, -0.32, 0.72, 0.16, 0.14, 0.09);
  // Schläfen, Hinterkopf, Ohren
  r -= bump(d, 0.8, 0.28, 0.45, 0.15, 0.15, 0.05) + bump(d, -0.8, 0.28, 0.45, 0.15, 0.15, 0.05);
  r += bump(d, 0, 0.25, -0.95, 0.4, 0.35, 0.05);
  r += bump(d, 0.99, 0.0, -0.05, 0.07, 0.16, 0.1) + bump(d, -0.99, 0.0, -0.05, 0.07, 0.16, 0.1);
  // Nase (Rücken und Spitze), eingefallener Nasenansatz
  r += bump(d, 0, -0.05, 1, 0.075, 0.2, 0.2) + bump(d, 0, -0.2, 0.98, 0.065, 0.06, 0.09);
  r -= bump(d, 0, 0.12, 0.99, 0.06, 0.05, 0.03);
  // Mundöffnung: unten vorne tief ausgehöhlt (der Unterkiefer liegt davor)
  const mouth = smooth((-d.y - 0.36) / 0.12) * smooth((d.z - 0.35) / 0.25) * smooth((0.62 - Math.abs(d.x)) / 0.25);
  r -= mouth * 0.32;
  // Unterer Schädel unterhalb des Mundes schmaler (Kinn übernimmt der Unterkiefer)
  r -= smooth((-d.y - 0.55) / 0.3) * 0.12;
  return r;
}

// Punkt auf der Schädeloberfläche (Kopf-Raum) in Richtung d
export function headPoint(dx, dy, dz, out = new THREE.Vector3(), lift = 0) {
  const l = Math.hypot(dx, dy, dz);
  const d = { x: dx / l, y: dy / l, z: dz / l };
  let r = headRadius(d) * HEAD_R + lift;
  let x = d.x * r * HEAD_S[0], y = d.y * r * HEAD_S[1], z = d.z * r * HEAD_S[2];
  // Kieferpartie verjüngen
  if (y < 0) x *= 1 - 0.16 * smooth(-y / (HEAD_R * 0.9));
  return out.set(x, y, z);
}

function headGeo() {
  const g = new THREE.SphereGeometry(1, 30, 22, Math.PI * 1.5);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i));
    headPoint(v.x, v.y, v.z, v);
    v.x += wobble(v.x, v.y, v.z, 3) * 0.0012; v.y += wobble(v.y, v.z, v.x, 5) * 0.0012;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return weldNormals(g);
}

// Haare: Kappe mit unregelmäßigem Haaransatz (bald = nur Haarkranz)
function hairGeo(bald) {
  const g = new THREE.SphereGeometry(1, 24, 14, Math.PI * 1.5, Math.PI * 2, 0, Math.PI * 0.64);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i));
    const th = Math.acos(Math.max(-1, Math.min(1, v.y)));
    const az = Math.atan2(v.x, v.z); // 0 = vorne
    const front = Math.cos(az) * 0.5 + 0.5; // 1 vorne, 0 hinten
    const jag = Math.sin(az * 9 + 1) * 0.04 + Math.sin(az * 23) * 0.025;
    const lo = (0.3 + 0.32 * (1 - front)) * Math.PI + jag; // Haaransatz
    let t = Math.min(th, lo);
    if (bald) { const hi = (0.36 - 0.12 * (1 - front)) * Math.PI; t = Math.max(t, hi + jag * 0.5); if (front > 0.8) t = lo; }
    const s = Math.sin(t);
    v.set(Math.sin(az) * s, Math.cos(t), Math.cos(az) * s);
    headPoint(v.x, v.y, v.z, v, 0.006 + Math.abs(wobble(v.x, v.y, v.z, 9)) * 0.004);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return weldNormals(g);
}

// Unterkiefer: Scharnier im Ursprung, ragt nach vorne (+z) und unten
function jawGeo() {
  const g = new THREE.BoxGeometry(1, 1, 1, 4, 3, 5);
  const p = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ux = p.getX(i), uy = p.getY(i) + 0.5, uz = p.getZ(i) + 0.5; // uy, uz in 0..1
    // UVs auf den Kinn-Bereich der Gesichtstextur (unten); Oberseite = dunkler Mundraum
    const nx = nrm.getX(i), ny = nrm.getY(i);
    if (ny > 0.9) uv.setXY(i, 0.4 + (ux + 0.5) * 0.2, 0.13 + uz * 0.016);
    else if (Math.abs(nx) > 0.9) uv.setXY(i, 0.42 + uz * 0.16, 0.02 + uy * 0.09);
    else if (ny < -0.9) uv.setXY(i, 0.42 + (ux + 0.5) * 0.16, 0.02 + uz * 0.03);
    else uv.setXY(i, 0.42 + (ux + 0.5) * 0.16, 0.02 + uy * 0.09);
    const z = -0.012 + uz * 0.1;
    const w = 0.105 * (1 - 0.42 * uz * uz) * (1 - 0.15 * (1 - uy));
    let y = -0.05 + uy * 0.05 - uz * 0.012;
    // Kinn rund
    y += smooth((uz - 0.75) / 0.25) * (1 - uy) * 0.012;
    const zz = z - smooth((Math.abs(ux) * 2 - 0.6) / 0.4) * uz * 0.02;
    p.setXYZ(i, ux * w, y, zz);
  }
  g.scale(HEAD_R / 0.1, HEAD_R / 0.1, HEAD_R / 0.1);
  g.computeVertexNormals();
  return weldNormals(g);
}

// Zahnreihe auf einem Bogen (unregelmäßig, mit Lücken)
function teethGeo(seed) {
  const rnd = mulberry32(seed), parts = [];
  for (let i = 0; i < 10; i++) {
    if (rnd() < 0.18) continue;
    const a = -1.05 + (i / 9) * 2.1;
    const h = 0.012 + rnd() * 0.009, w = 0.008 + rnd() * 0.004;
    const b = new THREE.BoxGeometry(w, h, 0.007);
    b.rotateZ((rnd() - 0.5) * 0.35);
    b.rotateY(-a);
    b.translate(Math.sin(a) * 0.034, -h * 0.5 + (rnd() - 0.5) * 0.004, Math.cos(a) * 0.03);
    parts.push(b);
  }
  return mergeGeometries(parts).scale(HEAD_R / 0.1, HEAD_R / 0.1, HEAD_R / 0.1);
}

// ── Hände ─────────────────────────────────────────────────────
// Klauenhand, hängt nach -y; Handfläche zeigt nach -z, Finger krümmen sich dorthin.
// thumb: Seite des Daumens (+1 / -1)
function handGeo(thumb) {
  const parts = [];
  const palm = new THREE.BoxGeometry(0.068, 0.082, 0.026, 2, 2, 1);
  const pp = palm.attributes.position;
  for (let i = 0; i < pp.count; i++) {
    const y = pp.getY(i);
    pp.setX(i, pp.getX(i) * (1 - (y + 0.041) * 1.2)); // zum Handgelenk schmaler
  }
  palm.translate(0, -0.045, 0);
  parts.push(palm);
  const seg = (a, b, r) => {
    const d = new THREE.Vector3().subVectors(b, a), len = d.length();
    const c = new THREE.CapsuleGeometry(r, len, 2, 6);
    c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    c.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    parts.push(c);
  };
  const fingers = [[-0.026, 0.03, 0.92], [-0.009, 0.034, 1.0], [0.009, 0.033, 0.98], [0.026, 0.026, 0.85]];
  fingers.forEach(([fx, l0, k], fi) => {
    let p = new THREE.Vector3(fx, -0.086, 0.002), A = 0.15 + fi * 0.04;
    const lens = [l0, l0 * 0.72, l0 * 0.6], curl = [0.55, 0.8, 0.65];
    for (let s = 0; s < 3; s++) {
      A += curl[s] * k;
      const q = p.clone().add(new THREE.Vector3(fx * 0.06 * s, -Math.cos(A), -Math.sin(A)).normalize().multiplyScalar(lens[s]));
      seg(p, q, 0.0085 - s * 0.0012);
      p = q;
    }
  });
  // Daumen
  let p = new THREE.Vector3(thumb * 0.03, -0.03, -0.008);
  const dirs = [new THREE.Vector3(thumb * 0.55, -0.6, -0.55), new THREE.Vector3(thumb * 0.15, -0.7, -0.7)];
  for (let s = 0; s < 2; s++) {
    const q = p.clone().add(dirs[s].normalize().multiplyScalar(s ? 0.024 : 0.03));
    seg(p, q, 0.0095 - s * 0.0015);
    p = q;
  }
  const g = mergeGeometries(parts.map((x) => x.toNonIndexed()));
  g.scale(1.24, 1.2, 1.24);
  return g;
}

// Schuh/Stiefel: Knöchel oben hinten im Ursprung, Spitze nach +z
function footGeo() {
  const g = new THREE.BoxGeometry(1, 1, 1, 3, 3, 6);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const ux = p.getX(i), uy = p.getY(i) + 0.5, uz = p.getZ(i) + 0.5;
    const z = -0.07 + uz * 0.25;
    // Breite: Ferse etwas schmaler, Spitze gerundet
    const w = 0.104 * (uz < 0.15 ? 0.86 + uz : 1) * (1 - 0.35 * smooth((uz - 0.72) / 0.28));
    // Höhe: am Knöchel hoch, zur Spitze flacher, Spitze abgerundet
    const top = 0.012 - 0.05 * smooth((uz - 0.3) / 0.6);
    let y = -0.095 + uy * (top + 0.095);
    p.setXYZ(i, ux * w * (0.92 + 0.08 * Math.sin(uy * Math.PI)), y, z - smooth((uz - 0.9) / 0.1) * (1 - uy) * 0.012);
  }
  g.computeVertexNormals();
  return weldNormals(g);
}

// Stumpf (Hals, Ellbogen, Knie): ausgefranstes Fleisch mit Knochen, Vertex-Farben
function stumpGeo(r) {
  const flesh = lathe([[r * 0.95, -0.02], [r, 0.0], [r * 0.85, 0.012], [r * 0.5, 0.018], [0.0001, 0.02]], { seg: 10, noise: 0.004, seed: 31, jag: 0 });
  const bone = new THREE.CylinderGeometry(r * 0.28, r * 0.32, 0.05, 8);
  bone.translate(0, 0.02, 0);
  const tint = (g, c) => {
    g = g.index ? g.toNonIndexed() : g;
    const n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set(c, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  };
  const f = tint(flesh, [0.36, 0.03, 0.03]);
  const b = tint(bone, [0.78, 0.72, 0.6]);
  return mergeGeometries([f, b]);
}

// ── Kleidung & Accessoires ───────────────────────────────────
// Hüftschürze (Koch/Metzger): von der Taille bis über die Knie, unten ausgefranst
function apronGeo() {
  const g = new THREE.CylinderGeometry(0.152, 0.185, 0.56, 10, 6, true, -1.1, 2.2);
  const p = g.attributes.position, rnd = mulberry32(77);
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i) * 1.2, y = p.getY(i), z = p.getZ(i) * 0.86 + 0.014;
    if (y < -0.27) y -= rnd() * 0.05;
    z += Math.max(0, -y) * 0.08; // hängt unten leicht ab
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

function tieGeo() {
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.lineTo(0.022, -0.02); s.lineTo(0.03, -0.3); s.lineTo(0, -0.345); s.lineTo(-0.03, -0.3); s.lineTo(-0.022, -0.02); s.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.006, bevelEnabled: false });
  g.translate(0, 0, -0.003);
  return g;
}

function hardhatGeo() {
  const dome = new THREE.SphereGeometry(0.118, 18, 9, 0, Math.PI * 2, 0, Math.PI * 0.5);
  dome.scale(0.92, 0.85, 1.05);
  const brim = new THREE.CylinderGeometry(0.135, 0.14, 0.012, 20);
  brim.scale(0.92, 1, 1.12);
  brim.translate(0, 0.004, 0.012);
  const ridge = new THREE.BoxGeometry(0.02, 0.022, 0.2);
  ridge.translate(0, 0.1, 0);
  return mergeGeometries([dome.toNonIndexed(), brim.toNonIndexed(), ridge.toNonIndexed()]).scale(1.06, 1.06, 1.06);
}

function capGeo() {
  const dome = new THREE.SphereGeometry(0.112, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);
  dome.scale(0.9, 0.62, 1.0);
  const visor = new THREE.CylinderGeometry(0.08, 0.08, 0.008, 14, 1, false, -1.2, 2.4);
  visor.scale(1.05, 1, 0.9);
  visor.translate(0, 0.004, 0.1);
  return mergeGeometries([dome.toNonIndexed(), visor.toNonIndexed()]).scale(1.06, 1.06, 1.06);
}

// ── Alle Geometrien (einmalig, kartenübergreifend geteilt) ────
let GEO = null;
export function zombieGeometries() {
  if (GEO) return GEO;
  const hunch = (y) => -(Math.max(0, y + 0.02) ** 2) * 0.9; // runder Rücken
  GEO = {
    pelvis: lathe([[0, -0.13], [0.1, -0.125], [0.135, -0.08], [0.146, -0.01], [0.14, 0.05], [0.13, 0.1], [0, 0.118]], { seg: 16, sx: 1.34, sz: 0.88, noise: 0.002, seed: 2 }),
    belly: remapV(lathe([[0, -0.15], [0.112, -0.145], [0.122, -0.08], [0.116, 0], [0.12, 0.08], [0.128, 0.14], [0, 0.152]], { seg: 16, sx: 1.12, sz: 0.8, noise: 0.003, seed: 3 }), 0.12, 0.5),
    torso: lathe([[0, -0.17], [0.12, -0.162], [0.132, -0.08], [0.146, 0.0], [0.156, 0.08], [0.16, 0.14], [0.157, 0.185], [0.138, 0.215], [0.1, 0.236], [0.06, 0.25], [0, 0.254]], {
      seg: 20, sx: 1.37, sz: 0.76, noise: 0.003, seed: 4,
      shape: (x, y, z) => [x, y, z < 0 ? z * (1 + smooth((y + 0.02) / 0.18) * 0.22) : z * (1 - smooth((y - 0.05) / 0.15) * 0.1)],
      bend: hunch,
    }),
    // Nackter Oberkörper: dünner, mit Rippen
    torsoBare: lathe([[0, -0.17], [0.112, -0.162], [0.122, -0.08], [0.136, 0.0], [0.146, 0.08], [0.151, 0.14], [0.148, 0.185], [0.13, 0.215], [0.094, 0.236], [0.056, 0.25], [0, 0.254]], {
      seg: 22, sx: 1.34, sz: 0.73, noise: 0.002, seed: 5, bend: hunch,
      shape: (x, y, z) => {
        const ribs = y > -0.12 && y < 0.16 ? Math.max(0, Math.sin((y + 0.12) * Math.PI * 2 / 0.036)) ** 2 * 0.0055 * smooth((0.16 - y) / 0.06) : 0;
        const r = Math.hypot(x, z) || 1, side = z > -0.02 ? 1 : 0.3;
        return [x + (x / r) * ribs * side, y, z + (z / r) * ribs * side];
      },
    }),
    neck: lathe([[0.062, -0.06], [0.057, 0.0], [0.051, 0.05], [0.052, 0.1], [0, 0.114]], { seg: 12, sz: 0.95, noise: 0.002, seed: 6, bend: (y) => y * 0.12 }),
    head: headGeo(),
    hair: hairGeo(false),
    hairBald: hairGeo(true),
    jaw: jawGeo(),
    teeth: teethGeo(11),
    eye: new THREE.SphereGeometry(0.0115, 8, 6),
    stump: stumpGeo(0.055),
    gibStump: stumpGeo(0.042),
    // Schultern: flache Kappen, die Arm und Rumpf verbinden (keine sichtbaren Kugeln)
    delt: (() => { const g = new THREE.SphereGeometry(0.056, 14, 10); g.scale(0.95, 1.45, 1.0); g.translate(0, -0.035, 0); return g; })(),
    deltShirt: (() => { const g = new THREE.SphereGeometry(0.066, 14, 10); g.scale(0.95, 1.4, 1.0); g.translate(0, -0.035, 0); return g; })(),
    upperArm: lathe([[0, -0.355], [0.03, -0.35], [0.036, -0.32], [0.04, -0.27], [0.047, -0.17], [0.052, -0.08], [0.052, -0.02], [0.044, 0.03], [0, 0.04]], { seg: 12, sx: 0.92, sz: 1.08, noise: 0.002, seed: 7 }),
    sleeveUpper: lathe([[0.06, -0.3], [0.064, -0.2], [0.069, -0.08], [0.071, 0.0], [0.06, 0.045], [0, 0.054]], { seg: 12, sx: 0.97, sz: 1.08, jag: 0.035, noise: 0.004, seed: 8 }),
    foreArm: lathe([[0, -0.305], [0.027, -0.298], [0.03, -0.26], [0.037, -0.16], [0.045, -0.07], [0.046, -0.02], [0.034, 0.018], [0, 0.03]], { seg: 12, sx: 1.08, sz: 0.9, noise: 0.002, seed: 9 }),
    sleeveLower: lathe([[0.047, -0.27], [0.053, -0.2], [0.06, -0.08], [0.064, 0.0], [0.058, 0.035], [0, 0.044]], { seg: 12, sx: 1.05, sz: 0.95, jag: 0.03, noise: 0.004, seed: 10 }),
    handR: handGeo(1),
    handL: handGeo(-1),
    thigh: lathe([[0, -0.49], [0.055, -0.48], [0.064, -0.42], [0.073, -0.3], [0.082, -0.15], [0.088, -0.03], [0.08, 0.035], [0, 0.05]], { seg: 14, sz: 1.08, noise: 0.003, seed: 12 }),
    shin: lathe([[0, -0.445], [0.033, -0.44], [0.038, -0.38], [0.046, -0.22], [0.054, -0.09], [0.055, -0.02], [0.045, 0.024], [0, 0.036]], { seg: 12, sz: 1.08, noise: 0.002, seed: 13 }),
    pantsLower: lathe([[0.066, -0.41], [0.068, -0.3], [0.07, -0.15], [0.074, -0.04], [0.075, 0.0], [0.066, 0.042], [0, 0.056]], { seg: 14, sz: 1.06, jag: 0.035, noise: 0.004, seed: 14 }),
    foot: footGeo(),
    rag: lathe([[0.168, -0.15], [0.158, -0.1], [0.15, -0.04], [0.148, 0.0]], { seg: 18, sx: 1.12, sz: 0.82, jag: 0.06, noise: 0.006, seed: 15 }),
    apron: apronGeo(),
    tie: tieGeo(),
    hardhat: hardhatGeo(),
    cap: capGeo(),
  };
  // Werden über Kartenwechsel hinweg wiederverwendet → nicht freigeben
  for (const k in GEO) GEO[k].userData.shared = true;
  return GEO;
}

// Ankerpunkte im Kopf-Raum (Augen, Zähne, Kiefergelenk, Haare)
export const HEAD = (() => {
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  const eyeL = headPoint(-0.37, 0.13, 0.92, v()), eyeR = headPoint(0.37, 0.13, 0.92, v());
  for (const e of [eyeL, eyeR]) e.multiplyScalar(0.9);
  const lip = headPoint(0, -0.36, 0.93, v());
  return {
    eyes: [eyeL, eyeR],
    teethTop: v(0, lip.y + 0.004, lip.z - 0.034),
    jaw: v(0, lip.y - 0.004, 0.006),
    top: headPoint(0, 1, 0, v()),
  };
})();

// Körperteil-Typen für den Instanz-Renderer (Geometrie, Material, Farbkanal, Schatten)
export function zombieTypes(Z) {
  const G = zombieGeometries();
  const t = (geo, mat, tint = null, shadow = true) => ({ geo, mat, tint, shadow });
  return {
    pelvis: t(G.pelvis, Z.pants, 'pants'),
    belly_shirt: t(G.belly, Z.shirt, 'shirt'), belly_skin: t(G.belly, Z.skin, 'skin'),
    torso_shirt: t(G.torso, Z.shirt, 'shirt'), torso_skin: t(G.torsoBare, Z.skin, 'skin'),
    neck: t(G.neck, Z.skin, 'skin'),
    head: t(G.head, Z.head, 'skin'),
    hair: t(G.hair, Z.hair), hairBald: t(G.hairBald, Z.hair),
    jaw: t(G.jaw, Z.head, 'skin'),
    teeth: t(G.teeth, Z.teeth, null, false),
    eye: t(G.eye, Z.eye, null, false),
    stump: t(G.stump, Z.gore),
    gibStump: t(G.gibStump, Z.gore, null, false),
    delt_shirt: t(G.deltShirt, Z.shirt, 'shirt'), delt_skin: t(G.delt, Z.skin, 'skin'),
    upperArm: t(G.upperArm, Z.skin, 'skin'),
    sleeveUpper: t(G.sleeveUpper, Z.shirt, 'shirt'),
    foreArm: t(G.foreArm, Z.skin, 'skin'),
    sleeveLower: t(G.sleeveLower, Z.shirt, 'shirt'),
    handL: t(G.handL, Z.skin, 'skin'), handR: t(G.handR, Z.skin, 'skin'),
    thigh: t(G.thigh, Z.pants, 'pants'),
    shin: t(G.shin, Z.skin, 'skin'),
    pantsLower: t(G.pantsLower, Z.pants, 'pants'),
    foot: t(G.foot, Z.shoe),
    rag: t(G.rag, Z.shirt, 'shirt'),
    apron: t(G.apron, Z.apron, null),
    tie: t(G.tie, Z.tie, 'pants', false),
    hardhat: t(G.hardhat, Z.hardhat, null),
    cap: t(G.cap, Z.pants, 'pants'),
  };
}
