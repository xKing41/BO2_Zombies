// ─────────────────────────────────────────────────────────────
//  Geometrie-Baukasten für die Waffenmodelle.
//  Profile (Seiten-, Front-, Draufsicht) als gefaste Extrusionen,
//  Drehteile, Schienen, Schrauben. Parts sammelt alles je Material,
//  backt Transformation, Vertexfarbe (Tönung + Rauheit) und Box-UVs ein
//  und verschmilzt es zu einem Mesh pro Material.
//  Konvention: x rechts, y hoch, -z vorn. Profile nutzen a = vorwärts (= -z).
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

export const UVS = 5; // UV-Einheiten pro Meter (eine Texturkachel = 20 cm)

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

// ── Grundkörper ───────────────────────────────────────────────
export const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
export const rbox = (w, h, d, r = 0.0018, seg = 1) => new RoundedBoxGeometry(w, h, d, seg, Math.max(1e-4, Math.min(r, w / 2, h / 2, d / 2) * 0.98));

// Zylinder entlang z: rf vorn, rb hinten
export function cylZ(rf, rb, len, seg = 14, open = false) {
  const g = new THREE.CylinderGeometry(rf, rb, len, seg, 1, open);
  g.rotateX(-Math.PI / 2);
  return g;
}
// Zylinder entlang x (Schrauben, Stifte, Achsen)
export function cylX(r, len, seg = 10) {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateZ(Math.PI / 2);
  return g;
}
export function cylY(rt, rb, len, seg = 12) { return new THREE.CylinderGeometry(rt, rb, len, seg); }
export const sphere = (r, ws = 14, hs = 10) => new THREE.SphereGeometry(r, ws, hs);

// Drehteil um die z-Achse: Profil [[r, a], …] mit a = vorwärts
export function lathe(pts, seg = 16) {
  const g = new THREE.LatheGeometry(pts.map(([r, a]) => new THREE.Vector2(Math.max(r, 0), a)), seg);
  g.rotateX(-Math.PI / 2);
  return g;
}
// Ring um die z-Achse
export const ringZ = (R, r, seg = 18, rs = 6) => new THREE.TorusGeometry(R, r, rs, seg);

// Schraubenlinie (Spule) entlang z
export function helixZ(R, r, turns, len, seg = 90) {
  class H extends THREE.Curve {
    getPoint(t, out = new THREE.Vector3()) {
      const a = t * turns * Math.PI * 2;
      return out.set(Math.cos(a) * R, Math.sin(a) * R, -t * len + len / 2);
    }
  }
  return new THREE.TubeGeometry(new H(), seg, r, 5, false);
}

// ── Profile ───────────────────────────────────────────────────
// Punkte: [x, y] Linie · ['q', cx, cy, x, y] Kurve · ['c', c1x, c1y, c2x, c2y, x, y] Bezier
function path(p, pts) {
  pts.forEach((pt, i) => {
    if (pt[0] === 'q') p.quadraticCurveTo(pt[1], pt[2], pt[3], pt[4]);
    else if (pt[0] === 'c') p.bezierCurveTo(pt[1], pt[2], pt[3], pt[4], pt[5], pt[6]);
    else if (i === 0) p.moveTo(pt[0], pt[1]);
    else p.lineTo(pt[0], pt[1]);
  });
  return p;
}

function extrude(pts, depth, bevel, holes, curveSeg, segs) {
  const shape = path(new THREE.Shape(), pts);
  if (holes) for (const h of holes) shape.holes.push(path(new THREE.Path(), h));
  const t = Math.min(bevel, depth * 0.45);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-4, depth - 2 * t), bevelEnabled: t > 0, bevelThickness: t, bevelSize: t, bevelOffset: -t,
    bevelSegments: segs, curveSegments: curveSeg,
  });
  g.translate(0, 0, -(depth - 2 * t) / 2);
  return g;
}

const creased = (g) => {
  const c = toCreasedNormals(g, 0.82);
  if (c !== g) g.dispose();
  return c;
};

// Seitenansicht (a vorwärts, y hoch), Dicke w in x
export function side(pts, w, bevel = 0.0015, holes = null, curveSeg = 5, segs = 2) {
  const g = extrude(pts, w, bevel, holes, curveSeg, segs);
  g.rotateY(Math.PI / 2);
  return creased(g);
}
// Frontansicht (x, y), Länge len entlang z (zentriert)
export function front(pts, len, bevel = 0.0015, holes = null, curveSeg = 5, segs = 2) {
  return creased(extrude(pts, len, bevel, holes, curveSeg, segs));
}
// Draufsicht (x, a vorwärts), Höhe h in y (zentriert)
export function top(pts, h, bevel = 0.0012, holes = null, curveSeg = 5, segs = 2) {
  const g = extrude(pts, h, bevel, holes, curveSeg, segs);
  g.rotateX(-Math.PI / 2);
  return creased(g);
}

// Kreis als Punktliste (für Profile/Löcher)
export function circle(cx, cy, r, n = 12, cw = false) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = (cw ? -1 : 1) * (i / n) * Math.PI * 2; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return out;
}
// Abgerundetes Rechteck als Punktliste
export function roundRect(x0, y0, x1, y1, r, n = 3) {
  const out = [];
  const c = [[x1 - r, y1 - r, 0], [x0 + r, y1 - r, Math.PI / 2], [x0 + r, y0 + r, Math.PI], [x1 - r, y0 + r, Math.PI * 1.5]];
  for (const [cx, cy, a0] of c) for (let i = 0; i <= n; i++) { const a = a0 + (i / n) * Math.PI / 2; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return out;
}

// Picatinny-Schiene entlang z: Länge, Breite, Höhe (Unterkante bei y = 0)
export function rail(len, w = 0.021, h = 0.009) {
  const parts = [];
  const base = new THREE.BoxGeometry(w * 0.72, h * 0.45, len); base.translate(0, h * 0.225, 0); parts.push(base);
  const n = Math.max(2, Math.floor(len / 0.0105));
  const pitch = len / n;
  for (let i = 0; i < n; i++) {
    const t = front([[-w / 2, 0], [w / 2, 0], [w / 2, h * 0.55], [w * 0.38, h], [-w * 0.38, h], [-w / 2, h * 0.55]], pitch * 0.52, 0.0005, null, 1, 1);
    t.translate(0, h * 0.0, -len / 2 + pitch * (i + 0.5));
    parts.push(t);
  }
  return merge(parts);
}

// Gerippe/Kühlrippen entlang z (z. B. Handschutz)
export function ribs(n, len, w, h, depth) {
  const parts = [];
  for (let i = 0; i < n; i++) { const g = new THREE.BoxGeometry(w, h, depth); g.translate(0, 0, -len / 2 + (i + 0.5) * (len / n)); parts.push(g); }
  return merge(parts);
}

// Geometrien vereinheitlichen und verschmelzen
function normalize(g) {
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.index) {
    const n = g.attributes.position.count;
    const idx = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  g.clearGroups();
  return g;
}
export function merge(list) {
  const hasColor = list.some((g) => g.attributes.color);
  for (const g of list) {
    normalize(g);
    if (hasColor && !g.attributes.color) {
      const c = new Float32Array(g.attributes.position.count * 4).fill(1);
      g.setAttribute('color', new THREE.BufferAttribute(c, 4));
    }
  }
  const out = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  return out;
}

// Box-Projektion: gleichmäßige Texeldichte unabhängig von der Teilgröße.
// Maserung/Kratzer laufen auf Seiten und Oberseite entlang der Waffe (z).
function boxUV(g, s) {
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (ax >= ay && ax >= az) uv.setXY(i, z * s, y * s);
    else if (ay >= az) uv.setXY(i, z * s, x * s + 0.37);
    else uv.setXY(i, x * s + 0.61, y * s);
  }
  uv.needsUpdate = true;
}

// ── Teile-Sammler ─────────────────────────────────────────────
export class Parts {
  constructor() { this.buckets = new Map(); this.tris = 0; }

  // tint: [r, g, b, rauheit] · pos/rot/scl: Arrays oder null · uvs: UV-Dichte
  add(mat, tint, geo, pos = null, rot = null, scl = null, uvs = UVS) {
    const g = normalize(geo.index ? geo : geo); // Index ggf. ergänzen
    _p.set(0, 0, 0); _s.set(1, 1, 1); _q.identity();
    if (pos) _p.set(pos[0], pos[1], pos[2]);
    if (rot) _q.setFromEuler(_e.set(rot[0], rot[1], rot[2], rot[3] || 'XYZ'));
    if (scl) _s.set(scl[0], scl[1], scl[2]);
    _m.compose(_p, _q, _s);
    g.applyMatrix4(_m);
    if (_m.determinant() < 0) flipWinding(g);
    boxUV(g, uvs);
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 4);
    const t = tint || [1, 1, 1, 0.5];
    for (let i = 0; i < n; i++) { c[i * 4] = t[0]; c[i * 4 + 1] = t[1]; c[i * 4 + 2] = t[2]; c[i * 4 + 3] = t[3] ?? 0.5; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 4));
    if (!this.buckets.has(mat)) this.buckets.set(mat, []);
    this.buckets.get(mat).push(g);
    this.tris += g.index.count / 3;
    return this;
  }

  // Verschmilzt alles zu Meshes (eins pro Material) und hängt sie an parent
  build(parent, name = '') {
    for (const [mat, list] of this.buckets) {
      const geo = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      geo.computeBoundingSphere();
      geo.userData.shared = true; // bleibt beim Kartenwechsel erhalten (Waffen-Cache)
      const m = new THREE.Mesh(geo, mat);
      m.name = name;
      parent.add(m);
    }
    this.buckets.clear();
    return parent;
  }
}

function flipWinding(g) {
  const idx = g.index.array;
  for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  g.index.needsUpdate = true;
}
