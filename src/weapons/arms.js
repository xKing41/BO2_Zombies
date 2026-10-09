// ─────────────────────────────────────────────────────────────
//  First-Person-Arme: beide Arme als ein SkinnedMesh (ein Draw-Call).
//  Canvas-Jacke mit hochgekrempelten Ärmeln, fingerlose Lederhandschuhe
//  mit Knöchelschutz, schmutzige Haut. Ellbogen per Zwei-Knochen-IK von
//  festen Schulterpunkten zu Handgelenk-Zielen; Finger über Posen.
//  Handraum: Handgelenk im Ursprung, Finger -z, Handrücken +y,
//  Daumen rechts -x (links gespiegelt: +x).
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { ATLAS } from './gunTextures.js';
import { setFrame } from './guns.js';

export const LU = 0.3, LF = 0.27; // Ober-, Unterarm
const FING = [
  { p: [-0.026, 0.002, -0.084], len: [0.042, 0.025, 0.02], r: 0.0088, sp: 0.07 },
  { p: [-0.008, 0.004, -0.088], len: [0.046, 0.028, 0.021], r: 0.0092, sp: 0.0 },
  { p: [0.01, 0.003, -0.085], len: [0.043, 0.027, 0.02], r: 0.0086, sp: -0.06 },
  { p: [0.026, 0.0, -0.077], len: [0.034, 0.021, 0.018], r: 0.0076, sp: -0.14 },
];
const THUMB = { p: [-0.026, -0.011, -0.022], len: [0.042, 0.032, 0.026], r: 0.0102 };
const NB = 18; // Knochen je Arm

// Posen: je Finger [Grundglied, Mittelglied, Endglied, Spreizung], Daumen [Beugung, Abspreizung, Drehung, Glied 2, Glied 3]
const P = (f, t) => Float32Array.from([...f.flat(), ...t]);
export const POSES = {
  relaxed: P([[0.3, 0.4, 0.25, 0], [0.35, 0.45, 0.25, 0], [0.4, 0.5, 0.25, 0], [0.45, 0.55, 0.3, 0]], [0.25, 0.1, 0.0, 0.15, 0.15]),
  open: P([[0.12, 0.12, 0.08, 0.05], [0.1, 0.1, 0.06, 0], [0.12, 0.12, 0.08, -0.04], [0.15, 0.15, 0.1, -0.08]], [0.1, -0.1, 0.0, 0.1, 0.1]),
  flat: P([[0.05, 0.05, 0.03, 0.03], [0.04, 0.04, 0.03, 0], [0.05, 0.05, 0.03, -0.03], [0.07, 0.06, 0.04, -0.06]], [0.05, -0.2, 0.0, 0.05, 0.05]),
  pistol: P([[0.5, 0.75, 0.35, 0.0], [1.35, 1.45, 0.8, 0], [1.4, 1.45, 0.8, 0], [1.45, 1.4, 0.8, 0]], [0.55, 0.25, 0.5, 0.25, 0.2]),
  wrist: P([[0.55, 0.8, 0.35, 0], [1.2, 1.35, 0.75, 0], [1.25, 1.35, 0.75, 0], [1.3, 1.3, 0.75, 0]], [0.5, 0.2, 0.4, 0.2, 0.2]),
  handguard: P([[1.0, 1.05, 0.55, 0.05], [1.05, 1.1, 0.6, 0], [1.1, 1.1, 0.6, 0], [1.15, 1.1, 0.6, -0.05]], [0.3, 0.0, -0.2, 0.1, 0.1]),
  forend: P([[0.85, 0.95, 0.5, 0.05], [0.9, 1.0, 0.55, 0], [0.95, 1.0, 0.55, 0], [1.0, 1.0, 0.55, -0.05]], [0.3, 0.0, -0.2, 0.1, 0.1]),
  vgrip: P([[1.3, 1.4, 0.75, 0], [1.35, 1.45, 0.8, 0], [1.4, 1.45, 0.8, 0], [1.45, 1.45, 0.8, 0]], [0.7, 0.3, 0.5, 0.3, 0.2]),
  support: P([[0.85, 1.0, 0.6, 0], [0.95, 1.05, 0.6, 0], [1.0, 1.1, 0.6, 0], [1.05, 1.1, 0.6, 0]], [0.2, -0.1, 0.0, 0.05, 0.05]),
  pinch: P([[0.75, 0.9, 0.5, 0], [0.85, 1.0, 0.55, 0], [1.0, 1.1, 0.6, 0], [1.1, 1.1, 0.6, 0]], [0.85, 0.3, 0.4, 0.3, 0.3]),
  pull: P([[1.2, 1.3, 0.6, 0], [1.25, 1.35, 0.6, 0], [1.3, 1.35, 0.6, 0], [1.3, 1.35, 0.6, 0]], [0.5, 0.2, 0.2, 0.3, 0.3]),
  fist: P([[1.5, 1.7, 0.9, 0], [1.5, 1.75, 0.9, 0], [1.5, 1.75, 0.9, 0], [1.5, 1.7, 0.9, 0]], [0.9, 0.3, 0.6, 0.5, 0.5]),
  knife: P([[1.45, 1.6, 0.85, 0], [1.5, 1.65, 0.85, 0], [1.5, 1.65, 0.85, 0], [1.5, 1.6, 0.85, 0]], [1.0, 0.2, 0.7, 0.45, 0.35]),
  bottle: P([[0.9, 0.95, 0.5, 0.05], [0.95, 1.0, 0.55, 0], [1.0, 1.0, 0.55, 0], [1.05, 1.0, 0.55, -0.05]], [0.7, 0.35, 0.5, 0.2, 0.15]),
  grenade: P([[0.8, 0.9, 0.6, 0], [0.85, 0.95, 0.6, 0], [0.9, 0.95, 0.6, 0], [0.95, 0.95, 0.6, 0]], [0.8, 0.3, 0.5, 0.3, 0.3]),
  shell: P([[0.55, 0.7, 0.4, 0.05], [0.75, 0.85, 0.45, 0], [1.2, 1.3, 0.7, 0], [1.3, 1.3, 0.7, 0]], [0.9, 0.25, 0.4, 0.3, 0.25]),
};

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _d = new THREE.Vector3(), _pp = new THREE.Vector3(), _E = new THREE.Vector3(), _up = new THREE.Vector3(), _v = new THREE.Vector3();
const UPY = new THREE.Vector3(0, 1, 0);
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ── Geometrie-Helfer ──────────────────────────────────────────
// Röhre entlang z aus Ringen {z, rx, ry, x, y}; superelliptischer Querschnitt (pw < 1 = kantiger)
function tube(rings, seg, region, { pw = 1, capEnd = false, capStart = false, noise = null } = {}) {
  const pos = [], nor = [], uv = [], idx = [];
  const n = rings.length;
  const [u0, v0, u1, v1] = region;
  for (let j = 0; j < n; j++) {
    const R = rings[j];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const cp = Math.sign(c) * Math.pow(Math.abs(c), pw), sp = Math.sign(s) * Math.pow(Math.abs(s), pw);
      const k = noise ? 1 + noise(a, R.z, j) : 1;
      pos.push((R.x || 0) + cp * R.rx * k, (R.y || 0) + sp * R.ry * k, R.z);
      const nx = c * R.ry, ny = s * R.rx, l = Math.hypot(nx, ny) || 1;
      nor.push(nx / l, ny / l, 0);
      uv.push(u0 + (u1 - u0) * (0.03 + 0.94 * (i / seg)), v0 + (v1 - v0) * (0.03 + 0.94 * (j / (n - 1))));
    }
  }
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < seg; i++) {
    const a = j * (seg + 1) + i, b = a + seg + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const cap = (j, dir) => {
    const R = rings[j], c = pos.length / 3;
    pos.push(R.x || 0, R.y || 0, R.z + dir * Math.min(R.rx, R.ry) * 0.5);
    nor.push(0, 0, dir);
    uv.push((u0 + u1) / 2, (v0 + v1) / 2);
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i;
      if (dir < 0) idx.push(a, c, a + 1); else idx.push(a + 1, c, a);
    }
  };
  if (capEnd) cap(n - 1, -1);
  if (capStart) cap(0, 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// Kapsel entlang -z von 0 bis -len, Radius r (Spitze verjüngt)
function capsule(r, len, region, taper = 0, rs = 8) {
  const g = new THREE.CapsuleGeometry(r, len, 3, rs);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, -len / 2);
  const p = g.attributes.position, uv = g.attributes.uv;
  const [u0, v0, u1, v1] = region;
  for (let i = 0; i < p.count; i++) {
    const k = 1 - taper * Math.min(1, Math.max(0, -p.getZ(i) / len));
    p.setX(i, p.getX(i) * k); p.setY(i, p.getY(i) * k);
    uv.setXY(i, u0 + (u1 - u0) * (0.03 + 0.94 * uv.getX(i)), v0 + (v1 - v0) * (0.03 + 0.94 * uv.getY(i)));
  }
  return g;
}

function ellipsoid(rx, ry, rz, region) {
  const g = new THREE.SphereGeometry(1, 10, 8);
  g.scale(rx, ry, rz);
  const uv = g.attributes.uv, [u0, v0, u1, v1] = region;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + (u1 - u0) * (0.03 + 0.94 * uv.getX(i)), v0 + (v1 - v0) * (0.03 + 0.94 * uv.getY(i)));
  return g;
}

// ── Arme ──────────────────────────────────────────────────────
export class Arms {
  constructor(material) {
    this.root = new THREE.Group();
    this.root.name = 'arms';
    this.bones = [];
    this.side = [this.makeBones(1), this.makeBones(-1)];
    this.root.updateMatrixWorld(true);
    const geo = this.buildGeometry();
    this.skeleton = new THREE.Skeleton(this.bones);
    this.mesh = new THREE.SkinnedMesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = this.mesh.receiveShadow = false;
    this.root.add(this.mesh);
    this.mesh.bind(this.skeleton, new THREE.Matrix4());
    // Schultern (Kameraraum) und Ellbogen-Pole
    this.side[0].shoulder.set(0.2, -0.36, 0.1); this.side[0].pole.set(0.85, -0.6, 0.15);
    this.side[1].shoulder.set(-0.21, -0.36, 0.08); this.side[1].pole.set(-0.85, -0.6, 0.15);
    for (const S of this.side) { S.pose.set(POSES.relaxed); S.target.set(S.s * 0.2, -0.5, -0.3); }
  }

  makeBones(s) {
    const root = this.root;
    const B = (parent, x, y, z) => { const b = new THREE.Bone(); b.position.set(x, y, z); parent.add(b); this.bones.push(b); return b; };
    const sx = 0.3 * s;
    const upper = B(root, sx, 0, 0), fore = B(root, sx, 0, -LU), hand = B(root, sx, 0, -LU - LF);
    const t0 = B(hand, THUMB.p[0] * s, THUMB.p[1], THUMB.p[2]);
    const thumbBind = setFrame(new THREE.Quaternion(), new THREE.Vector3(-0.55 * s, -0.18, -0.82), new THREE.Vector3(-0.72 * s, 0.68, 0.05));
    t0.quaternion.copy(thumbBind);
    const t1 = B(t0, 0, 0, -THUMB.len[0]), t2 = B(t1, 0, 0, -THUMB.len[1]);
    const fingers = FING.map((F) => {
      const f0 = B(hand, F.p[0] * s, F.p[1], F.p[2]);
      const f1 = B(f0, 0, 0, -F.len[0]);
      const f2 = B(f1, 0, 0, -F.len[1]);
      return [f0, f1, f2];
    });
    return {
      s, upper, fore, hand, thumb: [t0, t1, t2], thumbBind, fingers,
      shoulder: new THREE.Vector3(), pole: new THREE.Vector3(), target: new THREE.Vector3(), quat: new THREE.Quaternion(),
      pose: new Float32Array(21), visible: true,
    };
  }

  // Geometrie der rechten Seite im Bind-Raum, links gespiegelt
  buildGeometry() {
    const S = this.side[0];
    const parts = [];
    const bi = (b) => this.bones.indexOf(b);
    // geo im lokalen Raum von Knochen a; w(z) = Gewicht für Knochen b
    const add = (geo, a, b = null, w = null) => {
      const ia = bi(a), ib = b ? bi(b) : ia;
      geo.applyMatrix4(a.matrixWorld);
      const n = geo.attributes.position.count;
      const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
      const lz = geo.userData.lz;
      for (let i = 0; i < n; i++) {
        const wb = b && w ? w(lz[i]) : 0;
        si[i * 4] = ia; si[i * 4 + 1] = ib;
        sw[i * 4] = 1 - wb; sw[i * 4 + 1] = wb;
      }
      geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
      geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      parts.push(geo);
    };
    const local = (g) => { const p = g.attributes.position; g.userData.lz = Float32Array.from({ length: p.count }, (_, i) => p.getZ(i)); return g; };
    const fold = (a, z, j) => Math.sin(z * 90 + Math.sin(a * 3 + j) * 1.5) * 0.045 + Math.sin(a * 5 + z * 40) * 0.02;
    // Oberarm (Jacke)
    const upRings = [];
    for (let j = 0; j <= 8; j++) { const t = j / 8; upRings.push({ z: 0.03 - t * (LU + 0.04), rx: 0.062 - t * 0.008, ry: 0.058 - t * 0.008 }); }
    add(local(tube(upRings, 12, ATLAS.sleeve, { noise: fold })), S.upper, S.fore, (z) => 0.5 * smoothstep(-LU + 0.07, -LU, z) + 0.5 * smoothstep(-LU, -LU - 0.02, z));
    // Unterarm: Ärmel mit Falten, aufgekrempelter Saum, nackter Unterarm
    const foRings = [];
    const sleeveEnd = LF - 0.1;
    for (let j = 0; j <= 9; j++) { const t = j / 9; foRings.push({ z: 0.035 - t * (sleeveEnd + 0.035), rx: 0.054 - t * 0.009, ry: 0.05 - t * 0.009 }); }
    add(local(tube(foRings, 12, ATLAS.sleeve, { noise: fold })), S.fore, S.upper, (z) => 0.5 * smoothstep(-0.07, 0.0, z) + 0.5 * smoothstep(0.0, 0.035, z));
    const cuff = [
      { z: -sleeveEnd + 0.012, rx: 0.046, ry: 0.042 }, { z: -sleeveEnd + 0.004, rx: 0.051, ry: 0.047 }, { z: -sleeveEnd - 0.006, rx: 0.052, ry: 0.048 },
      { z: -sleeveEnd - 0.017, rx: 0.049, ry: 0.045 }, { z: -sleeveEnd - 0.024, rx: 0.04, ry: 0.037 },
    ];
    add(local(tube(cuff, 12, ATLAS.sleeve, { noise: (a, z, j) => Math.sin(a * 7 + j) * 0.03 })), S.fore);
    const skinF = [{ z: -sleeveEnd + 0.02, rx: 0.037, ry: 0.033 }, { z: -sleeveEnd - 0.03, rx: 0.034, ry: 0.029 }, { z: -LF + 0.035, rx: 0.031, ry: 0.025 }];
    add(local(tube(skinF, 10, ATLAS.skin)), S.fore);
    // Handschuh-Stulpe am Handgelenk (Hand-Raum: +z Richtung Ellbogen)
    const glove = [{ z: 0.06, rx: 0.033, ry: 0.027 }, { z: 0.045, rx: 0.035, ry: 0.029 }, { z: 0.02, rx: 0.034, ry: 0.026 }, { z: -0.005, rx: 0.032, ry: 0.022 }];
    add(local(tube(glove, 12, ATLAS.pad, { pw: 0.85 })), S.hand, S.fore, (z) => smoothstep(0.005, 0.055, z));
    // Handfläche/Handrücken (Leder), Daumenballen, Knöchelschutz
    const palm = [
      { z: 0.012, rx: 0.031, ry: 0.021, y: -0.002 }, { z: -0.012, rx: 0.034, ry: 0.02, y: -0.002, x: -0.001 }, { z: -0.038, rx: 0.039, ry: 0.0185, y: -0.002, x: -0.002 },
      { z: -0.062, rx: 0.041, ry: 0.0168, y: -0.002, x: -0.0015 }, { z: -0.08, rx: 0.041, ry: 0.0152, y: -0.001 }, { z: -0.093, rx: 0.037, ry: 0.0115, y: 0.0 },
    ];
    add(local(tube(palm, 14, ATLAS.glove, { pw: 0.62, capEnd: true })), S.hand);
    const thenar = ellipsoid(0.015, 0.012, 0.026, ATLAS.glove); thenar.translate(-0.021, -0.011, -0.035);
    add(local(thenar), S.hand);
    const pad = new THREE.BoxGeometry(0.066, 0.008, 0.026, 3, 1, 2);
    { const p = pad.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setY(i, p.getY(i) - x * x * 3.2); } pad.computeVertexNormals(); }
    { const uv = pad.attributes.uv, [u0, v0, u1, v1] = ATLAS.pad; for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + (u1 - u0) * (0.05 + 0.9 * uv.getX(i)), v0 + (v1 - v0) * (0.05 + 0.9 * uv.getY(i))); }
    pad.translate(0.0, 0.0175, -0.072);
    add(local(pad), S.hand);
    const strap = new THREE.BoxGeometry(0.05, 0.006, 0.02); strap.translate(0.0, 0.028, 0.032);
    { const uv = strap.attributes.uv, [u0, v0, u1, v1] = ATLAS.pad; for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + (u1 - u0) * (0.1 + 0.3 * uv.getX(i)), v0 + (v1 - v0) * (0.1 + 0.3 * uv.getY(i))); }
    add(local(strap), S.hand, S.fore, (z) => smoothstep(0.005, 0.055, z));
    // Finger: Grundglied mit Handschuh (fingerlos), Rest Haut
    FING.forEach((F, fi) => {
      const [f0, f1, f2] = S.fingers[fi];
      const gl = capsule(F.r * 1.2, F.len[0] * 0.55, ATLAS.glove, 0.04);
      add(local(gl), f0);
      const ring = tube([{ z: -F.len[0] * 0.5, rx: F.r * 1.26, ry: F.r * 1.2 }, { z: -F.len[0] * 0.58, rx: F.r * 1.24, ry: F.r * 1.18 }, { z: -F.len[0] * 0.62, rx: F.r * 1.05, ry: F.r * 1.0 }], 8, ATLAS.glove);
      add(local(ring), f0);
      add(local(capsule(F.r, F.len[0], ATLAS.skin, 0.05)), f0);
      add(local(capsule(F.r * 0.95, F.len[1], ATLAS.skin, 0.06)), f1);
      add(local(capsule(F.r * 0.9, F.len[2] * 0.85, ATLAS.skin, 0.18)), f2);
    });
    const [t0, t1, t2] = S.thumb;
    add(local(capsule(THUMB.r * 1.25, THUMB.len[0], ATLAS.glove, 0.12)), t0);
    add(local(capsule(THUMB.r * 1.15, THUMB.len[1] * 0.5, ATLAS.glove, 0.04)), t1);
    add(local(capsule(THUMB.r, THUMB.len[1], ATLAS.skin, 0.06)), t1);
    add(local(capsule(THUMB.r * 0.92, THUMB.len[2] * 0.85, ATLAS.skin, 0.15)), t2);

    // Zusammenführen, linke Seite gespiegelt
    const merged = [];
    for (const g of parts) { if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]); merged.push(g); }
    const right = mergeIndexed(merged);
    const left = right.clone();
    const p = left.attributes.position, nrm = left.attributes.normal, si = left.attributes.skinIndex;
    for (let i = 0; i < p.count; i++) {
      p.setX(i, -p.getX(i)); nrm.setX(i, -nrm.getX(i));
      for (let k = 0; k < 4; k++) si.array[i * 4 + k] += NB;
    }
    const ix = left.index.array;
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    return mergeIndexed([right, left]);
  }

  // Ziel fürs Handgelenk (Arm-Raum = Kameraraum)
  setTarget(i, pos, quat) { const S = this.side[i]; S.target.copy(pos); S.quat.copy(quat); }

  // Pose a→b überblenden
  setPose(i, a, b = null, t = 0) {
    const out = this.side[i].pose;
    if (!b || t <= 0) out.set(a);
    else if (t >= 1) out.set(b);
    else for (let k = 0; k < 21; k++) out[k] = a[k] + (b[k] - a[k]) * t;
  }

  update() {
    for (let i = 0; i < 2; i++) this.solve(this.side[i]);
  }

  solve(S) {
    const sh = S.shoulder, W = S.target;
    _d.subVectors(W, sh);
    const d = _d.length() || 1e-4;
    _d.divideScalar(d);
    const k = Math.max(1, d / (LU + LF - 0.002));
    const a = LU * k, b = LF * k;
    const dc = Math.min(Math.max(d, Math.abs(a - b) + 1e-4), a + b - 1e-5);
    const x = (a * a - b * b + dc * dc) / (2 * dc);
    const h = Math.sqrt(Math.max(0, a * a - x * x));
    _pp.copy(S.pole).addScaledVector(_d, -S.pole.dot(_d)).normalize();
    _E.copy(sh).addScaledVector(_d, x).addScaledVector(_pp, h);
    S.upper.position.copy(sh);
    S.upper.quaternion.setFromRotationMatrix(_m.lookAt(sh, _E, UPY));
    S.upper.scale.set(1, 1, k);
    _up.set(0, 1, 0).applyQuaternion(S.quat);
    S.fore.position.copy(_E);
    S.fore.quaternion.setFromRotationMatrix(_m.lookAt(_E, W, _up));
    S.fore.scale.set(1, 1, _v.subVectors(W, _E).length() / LF);
    S.hand.position.copy(W);
    S.hand.quaternion.copy(S.quat);
    // Finger
    const p = S.pose, s = S.s;
    for (let f = 0; f < 4; f++) {
      const o = f * 4, B = S.fingers[f];
      B[0].rotation.set(-p[o], (FING[f].sp + p[o + 3]) * s, 0);
      B[1].rotation.set(-p[o + 1], 0, 0);
      B[2].rotation.set(-p[o + 2], 0, 0);
    }
    S.thumb[0].quaternion.copy(S.thumbBind).multiply(_q.setFromEuler(_e.set(-p[16], p[17] * s, p[18] * s)));
    S.thumb[1].rotation.set(-p[19], 0, 0);
    S.thumb[2].rotation.set(-p[20], 0, 0);
  }
}

// Indizierte Geometrien mit gleichen Attributen aneinanderhängen
function mergeIndexed(list) {
  const names = ['position', 'normal', 'uv', 'skinIndex', 'skinWeight'];
  let nv = 0, ni = 0;
  for (const g of list) { nv += g.attributes.position.count; ni += g.index.count; }
  const out = new THREE.BufferGeometry();
  for (const n of names) {
    const src = list[0].attributes[n];
    const arr = new src.array.constructor(nv * src.itemSize);
    let off = 0;
    for (const g of list) { arr.set(g.attributes[n].array, off); off += g.attributes[n].array.length; }
    out.setAttribute(n, new THREE.BufferAttribute(arr, src.itemSize));
  }
  const idx = new Uint32Array(ni);
  let io = 0, vo = 0;
  for (const g of list) { const a = g.index.array; for (let i = 0; i < a.length; i++) idx[io++] = a[i] + vo; vo += g.attributes.position.count; }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
