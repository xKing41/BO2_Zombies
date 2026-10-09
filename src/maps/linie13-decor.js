// ─────────────────────────────────────────────────────────────
//  Linie 13 – Gelände, Straße, Maisfeld, Wälder, Dächer, Requisiten,
//  Schilder, Funkmast, Glutfelder und alle Lampen (über den Licht-Pool).
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL, WALL_H } from '../config.js';
import { mulberry32 } from '../core/noise.js';
import { worldUV } from '../world/map.js';
import * as P from '../world/props.js';
import * as T from '../core/textures.js';
import {
  W, H, wx, route, CORN, CORN_CLEAR, CORN_PATHS, MAST, MAST_PAD, TREES, LAVA_RECTS, SHELTERS, ROAD_W, STOPS,
} from './linie13-data.js';

const C = CELL;
const edge = (c) => c * C; // Zellkante → Welt
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ── kleine Helfer ─────────────────────────────────────────────
function mesh(geo, mat, x = 0, y = 0, z = 0, cast = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}
function box(w, h, d, mat, x = 0, y = 0, z = 0, parent = null) {
  const m = mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z);
  if (parent) parent.add(m);
  return m;
}
function cyl(rt, rb, h, mat, x = 0, y = 0, z = 0, seg = 10, parent = null) {
  const m = mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z);
  if (parent) parent.add(m);
  return m;
}
function colorize(geo, col) {
  const n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}
// UVs aus lokalen Koordinaten (für Dachflächen u. Ä.)
function planarUV(geo, ax, ay, scale) {
  const p = geo.attributes.position, uv = geo.attributes.uv;
  const k = { x: 'getX', y: 'getY', z: 'getZ' };
  for (let i = 0; i < p.count; i++) uv.setXY(i, p[k[ax]](i) / scale, p[k[ay]](i) / scale);
  uv.needsUpdate = true;
  return geo;
}
// Zylinder zwischen zwei Punkten (für Gittermast, Äste, Leitungen)
function beamGeo(a, b, r, seg = 6) {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q);
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}
function signMat(tex, emissive = 0) {
  return emissive > 0
    ? new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(emissive, emissive, emissive) })
    : new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 });
}

// ── Materialien nur für diese Karte ───────────────────────────
function decorMaterials(M) {
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const grass = T.grass(51);
  grass.map.repeat.set(76, 62); grass.bump.repeat.set(76, 62);
  const asph = T.asphalt(53);
  const dirt = T.dirt(91);
  const lot = T.concrete(92, [0.55, 0.55, 0.58], 1);
  const roofR = T.roofTiles(63, [0.3, 0.13, 0.1]);
  const roofS = T.roofTiles(64, [0.19, 0.2, 0.22]);
  const corr = T.corrugated(65, [0.38, 0.39, 0.4], 0.8);
  const lava = T.lava(61);
  lava.channel = 1;
  const mats = {
    grass: std({ map: grass.map, bumpMap: grass.bump, bumpScale: 1.5, roughness: 0.97 }),
    road: std({ map: asph.map, bumpMap: asph.bump, bumpScale: 1, roughness: 0.82, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
    dirt: std({ map: dirt.map, bumpMap: dirt.bump, bumpScale: 2, roughness: 0.95 }),
    lot: std({ map: lot.map, bumpMap: lot.bump, bumpScale: 1, roughness: 0.85 }),
    roofRed: std({ map: roofR.map, bumpMap: roofR.bump, bumpScale: 2, roughness: 0.85, side: THREE.DoubleSide }),
    roofSlate: std({ map: roofS.map, bumpMap: roofS.bump, bumpScale: 2, roughness: 0.8, side: THREE.DoubleSide }),
    corr: std({ map: corr.map, bumpMap: corr.bump, bumpScale: 2, roughness: 0.6, metalness: 0.45, side: THREE.DoubleSide }),
    roofFlat: std({ map: lot.map, color: 0x4a4744, roughness: 0.95 }),
    fence: std({ map: T.chainLink(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6 }),
    tree: std({ vertexColors: true, roughness: 0.95, flatShading: true }),
    corn: std({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }),
    lava: std({ color: 0x0b0503, roughness: 0.95, emissive: 0xffffff, emissiveMap: lava, emissiveIntensity: 1.8, alphaMap: T.blobMask(67), alphaTest: 0.5 }),
    hay: std({ color: 0x8a7034, roughness: 1 }),
    concreteDark: std({ map: lot.map, color: 0x8a8a8a, roughness: 0.9 }),
    white: std({ color: 0xb8b4aa, roughness: 0.7 }),
    yellow: std({ color: 0xb08a1a, roughness: 0.6, metalness: 0.2 }),
    busGreen: std({ color: 0x1f5a34, roughness: 0.6, metalness: 0.3 }),
    burnt: std({ color: 0x1c1712, roughness: 0.9, metalness: 0.4 }),
    red: new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.25, 0.15) }),
    neonPink: new THREE.MeshBasicMaterial({ color: new THREE.Color(4.5, 0.6, 1.8) }),
    screen: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.3, 0.8) }),
  };
  lava.repeat.set(1, 1);
  mats.lavaTex = lava;
  // Wind im Maisfeld: Halme wiegen sich (Weltposition der Instanz als Phase)
  mats.windTime = { value: 0 };
  mats.corn.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = mats.windTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <project_vertex>', `
      vec4 mvPosition = vec4( transformed, 1.0 );
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      float hh = max(0.0, position.y);
      float sway = sin(uTime * 1.3 + mvPosition.x * 0.31 + mvPosition.z * 0.17) * 0.7 + sin(uTime * 2.9 + mvPosition.x * 0.8) * 0.3;
      mvPosition.x += sway * 0.035 * hh * hh;
      mvPosition.z += sway * 0.02 * hh * hh;
      mvPosition = modelViewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;`);
  };
  mats.corn.customProgramCacheKey = () => 'corn-wind';
  return mats;
}

// ── Boden, Straße, Plätze ─────────────────────────────────────
function buildGround(D) {
  const { scene, mats } = D;
  const g = new THREE.PlaneGeometry(W * C + 140, H * C + 140);
  g.rotateX(-Math.PI / 2);
  scene.add(mesh(g, mats.grass, (W * C) / 2, -0.03, (H * C) / 2, false));
}

function buildRoad(D) {
  const path = route(), n = path.n, half = ROAD_W / 2;
  const pos = [], uv = [], idx = [];
  const vScale = Math.max(1, Math.round(path.length / 8)) / path.length;
  for (let i = 0; i <= n; i++) {
    const p = path.pts[i % n], s = path.cum[i];
    const yaw = path.headingAt(s);
    const rx = -Math.cos(yaw), rz = Math.sin(yaw);
    pos.push(p.x - rx * half, 0.045, p.z - rz * half, p.x + rx * half, 0.045, p.z + rz * half);
    uv.push(0, s * vScale, 1, s * vScale);
    if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const road = mesh(g, D.mats.road, 0, 0, 0, false);
  road.userData.dynamic = true; // eigenes Mesh (Polygon-Offset), nicht verschmelzen
  D.scene.add(road);
}

const PLAZAS = [
  [39, 64, 42, 88, 'concrete'], // Vorplatz Busbahnhof
  [48, 22, 82, 24, 'lot'], // Parkplatz Raststätte
  [92, 18, 128, 24, 'dirt'], // Hofplatz
  [130.5, 36, 133, 63, 'concrete'], // Kraftwerk-Vorplatz
  [64, 94, 118, 96, 'cobble'], // Gehweg Altstadt
  [84, 96, 102, 97, 'cobble'], // Platz vor der Bank
  [62.5, 56.5, 70, 64, 'concrete'], // Mast-Fundament
  [101, 51, 107, 53, 'dirt'], // Hof der Hütte
  [42, 42, 46, 58, 'concrete'], // Tunnelboden
];
function buildPlazas(D) {
  const { scene, M, mats: mt } = D;
  const table = { concrete: [M.floorConcrete, 4], cobble: [M.floorCobble, 2], dirt: [mt.dirt, 5], lot: [mt.lot, 4] };
  for (const [x0, y0, x1, y1, kind] of PLAZAS) {
    const w = edge(x1 + 1) - edge(x0), d = edge(y1 + 1) - edge(y0);
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    g.translate(edge(x0) + w / 2, 0.02, edge(y0) + d / 2);
    const [mat, sc] = table[kind];
    scene.add(mesh(worldUV(g, sc), mat, 0, 0, 0, false));
  }
}

// ── Maisfeld ─────────────────────────────────────────────────
function cornGeo(lite) {
  const parts = [];
  const stemC = new THREE.Color(0x4a4626), leafC = new THREE.Color(0x56532e), tipC = new THREE.Color(0x6e6239);
  const stem = new THREE.CylinderGeometry(0.016, 0.026, 2.3, 4, 1, true);
  stem.translate(0, 1.15, 0);
  parts.push(colorize(stem, stemC));
  const rnd = mulberry32(5);
  const nLeaves = lite ? 4 : 5;
  for (let i = 0; i < nLeaves; i++) {
    const len = 0.75 + rnd() * 0.35;
    const leaf = new THREE.PlaneGeometry(lite ? 0.13 : 0.11, len, 1, 2);
    leaf.translate(0, len / 2, 0);
    const p = leaf.attributes.position;
    for (let k = 0; k < p.count; k++) { const y = p.getY(k); p.setZ(k, y * y * 0.55); }
    leaf.rotateX(-0.75 - rnd() * 0.3);
    leaf.rotateY(i * 2.4 + rnd());
    leaf.translate(0, 0.45 + i * (1.6 / nLeaves), 0);
    const col = new Float32Array(p.count * 3);
    for (let k = 0; k < p.count; k++) {
      const t = k / p.count;
      const c = leafC.clone().lerp(tipC, t);
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    }
    leaf.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(leaf);
  }
  if (!lite) {
    const cob = new THREE.CylinderGeometry(0.035, 0.03, 0.22, 4, 1, true);
    cob.rotateZ(0.35); cob.translate(0.05, 1.25, 0);
    parts.push(colorize(cob, new THREE.Color(0x9a8a4a)));
  }
  const tassel = new THREE.ConeGeometry(0.06, 0.35, 3, 1, true);
  tassel.translate(0, 2.45, 0);
  parts.push(colorize(tassel, tipC));
  for (const g of parts) if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
  return mergeGeometries(parts);
}

function buildCorn(D) {
  const { scene, mats: mt, q } = D;
  const rnd = mulberry32(777);
  const density = { hoch: 1, mittel: 0.8, niedrig: 0.55, minimal: 0.4 }[q.name] ?? 0.7;
  const spacing = 0.95 / Math.sqrt(density);
  const inR = (x, y, r) => x >= r[0] && x <= r[2] + 1 && y >= r[1] && y <= r[3] + 1;
  const pts = [];
  for (let z = edge(CORN[1]); z < edge(CORN[3] + 1); z += spacing) {
    for (let x = edge(CORN[0]); x < edge(CORN[2] + 1); x += spacing) {
      const px = x + (rnd() - 0.5) * spacing * 0.7, pz = z + (rnd() - 0.5) * spacing * 0.7;
      const cx = px / C, cy = pz / C;
      if (inR(cx, cy, CORN_CLEAR)) continue;
      if (CORN_PATHS.some((r) => cx >= r[0] && cx <= r[2] && cy >= r[1] && cy <= r[3]) && rnd() < 0.92) continue;
      const cell = D.m.cellAt(px, pz);
      if (!cell || cell.type !== 'floor') continue;
      pts.push([px, pz]);
    }
  }
  // In Kacheln aufteilen: entfernte Kacheln verschwinden im Nebel und werden nicht gezeichnet
  const TILE = 24;
  const tiles = new Map();
  for (const pt of pts) {
    const k = Math.floor(pt[0] / TILE) + ',' + Math.floor(pt[1] / TILE);
    if (!tiles.has(k)) tiles.set(k, []);
    tiles.get(k).push(pt);
  }
  const geo = cornGeo(density < 0.7);
  const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), s = new THREE.Vector3(), col = new THREE.Color();
  for (const list of tiles.values()) {
    const inst = new THREE.InstancedMesh(geo, mt.corn, list.length);
    list.forEach(([x, z], i) => {
      const h = 0.8 + rnd() * 0.35;
      qt.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.12, rnd() * 6.28, (rnd() - 0.5) * 0.12));
      s.set(1, h, 1);
      m4.compose(V(x, 0, z), qt, s);
      inst.setMatrixAt(i, m4);
      const b = 0.7 + rnd() * 0.45;
      inst.setColorAt(i, col.setRGB(b, b * (0.92 + rnd() * 0.1), b * 0.9));
    });
    inst.castShadow = false;
    inst.receiveShadow = true;
    inst.computeBoundingSphere();
    const bs = inst.boundingSphere;
    inst.userData.cullSphere = { x: bs.center.x, z: bs.center.z, r: bs.radius };
    scene.add(inst);
  }
}

// ── Bäume (instanziert) ──────────────────────────────────────
function pineGeo(rnd, tall) {
  const bark = new THREE.Color(0x2a2119);
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.1, 0.22, 4.6, 5, 1, true);
  trunk.translate(0, 2.3, 0);
  parts.push(colorize(trunk, bark));
  const layers = tall ? 5 : 4;
  let y = 1.6, r = tall ? 1.75 : 2.1;
  for (let i = 0; i < layers; i++) {
    const h = 2.4 - i * 0.2;
    const cone = new THREE.ConeGeometry(r, h, 7, 1, true);
    cone.rotateY(i * 0.7 + rnd());
    cone.translate(0, y + h / 2, 0);
    const g = 0.75 + rnd() * 0.35;
    parts.push(colorize(cone, new THREE.Color(0x1c2a1d).multiplyScalar(g)));
    y += h * 0.56; r *= 0.76;
  }
  return mergeGeometries(parts);
}
function deadTreeGeo(rnd) {
  const bark = new THREE.Color(0x3a332c);
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.09, 0.26, 6.2, 6, 1, true);
  trunk.translate(0, 3.1, 0);
  parts.push(colorize(trunk, bark));
  for (let i = 0; i < 6; i++) {
    const len = 1.4 + rnd() * 1.8;
    const b = new THREE.CylinderGeometry(0.025, 0.07, len, 4, 1, true);
    b.translate(0, len / 2, 0);
    b.rotateZ(0.5 + rnd() * 0.6);
    b.rotateY(i * 1.1 + rnd() * 0.5);
    b.translate(0, 2.4 + i * 0.6, 0);
    parts.push(colorize(b, bark));
  }
  return mergeGeometries(parts);
}

function buildTrees(D) {
  const { scene, mats: mt, q } = D;
  const rnd = mulberry32(4242);
  const variants = [pineGeo(rnd, false), pineGeo(rnd, true), deadTreeGeo(rnd)];
  const lists = [[], [], []];
  for (const [cx, cy] of TREES) {
    const v = rnd() < 0.22 ? 2 : rnd() < 0.5 ? 0 : 1;
    lists[v].push([wx(cx) + (rnd() - 0.5) * 0.6, wx(cy) + (rnd() - 0.5) * 0.6, 0.8 + rnd() * 0.55]);
  }
  // Waldrand außerhalb der Karte (der Nebel schluckt den Rest)
  const rows = { hoch: 3, mittel: 2, niedrig: 1, minimal: 1 }[q.name] ?? 2;
  const Wm = W * C, Hm = H * C;
  for (let r = 0; r < rows; r++) {
    const d = 1.5 - r * 6.5;
    const step = 4.5 + r;
    for (let t = -12; t < Wm + 12; t += step) {
      lists[rnd() < 0.15 ? 2 : r % 2].push([t + rnd() * 2, d + rnd() * 2, 0.9 + rnd() * 0.6]);
      lists[rnd() < 0.15 ? 2 : (r + 1) % 2].push([t + rnd() * 2, Hm - d - rnd() * 2, 0.9 + rnd() * 0.6]);
    }
    for (let t = 6; t < Hm - 6; t += step) {
      lists[rnd() < 0.15 ? 2 : r % 2].push([d + rnd() * 2, t + rnd() * 2, 0.9 + rnd() * 0.6]);
      lists[rnd() < 0.15 ? 2 : (r + 1) % 2].push([Wm - d - rnd() * 2, t + rnd() * 2, 0.9 + rnd() * 0.6]);
    }
  }
  const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), s = new THREE.Vector3();
  variants.forEach((geo, vi) => {
    const list = lists[vi];
    if (!list.length) return;
    const inst = new THREE.InstancedMesh(geo, mt.tree, list.length);
    list.forEach(([x, z, sc], i) => {
      qt.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.08, rnd() * 6.28, (rnd() - 0.5) * 0.08));
      s.set(sc, sc * (0.9 + rnd() * 0.25), sc);
      m4.compose(V(x, 0, z), qt, s);
      inst.setMatrixAt(i, m4);
    });
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.computeBoundingSphere();
    scene.add(inst);
  });
}

// ── Dächer ───────────────────────────────────────────────────
// Satteldach über einem Gebäude (Zellen inkl. Außenwände); axis = Firstrichtung
function gableRoof(D, { x0, y0, x1, y1, axis = 'x', rise = 3, mat, gable, oh = 0.6, chimney = null }) {
  const { scene } = D;
  const X0 = edge(x0), X1 = edge(x1 + 1), Z0 = edge(y0), Z1 = edge(y1 + 1);
  const alongA = axis === 'x' ? X0 - oh : Z0 - oh, alongB = axis === 'x' ? X1 + oh : Z1 + oh;
  const s0 = axis === 'x' ? Z0 : X0, s1 = axis === 'x' ? Z1 : X1;
  const half = (s1 - s0) / 2, mid = (s0 + s1) / 2;
  const slope = rise / half, theta = Math.atan(slope);
  const run = half + oh, L = run * Math.sqrt(1 + slope * slope);
  const eaveY = WALL_H + 0.05 - slope * oh;
  const alongLen = alongB - alongA, alongMid = (alongA + alongB) / 2;
  for (const side of [-1, 1]) {
    const g = axis === 'x' ? new THREE.BoxGeometry(alongLen, 0.14, L) : new THREE.BoxGeometry(L, 0.14, alongLen);
    if (axis === 'x') planarUV(g, 'x', 'z', 3); else planarUV(g, 'z', 'x', 3);
    const m = mesh(g, mat);
    const cS = mid + side * run / 2, cY = eaveY + (slope * run) / 2;
    if (axis === 'x') { m.position.set(alongMid, cY, cS); m.rotation.x = side * theta; }
    else { m.position.set(cS, cY, alongMid); m.rotation.z = -side * theta; }
    scene.add(m);
  }
  // Giebeldreiecke auf den Stirnwänden
  const sh = new THREE.Shape();
  sh.moveTo(-half, 0); sh.lineTo(half, 0); sh.lineTo(0, rise); sh.closePath();
  for (const end of [0, 1]) {
    const g = new THREE.ExtrudeGeometry(sh, { depth: C, bevelEnabled: false });
    if (axis === 'x') { g.rotateY(Math.PI / 2); g.translate(end ? X1 - C : X0, WALL_H, mid); }
    else g.translate(mid, WALL_H, end ? Z1 - C : Z0);
    scene.add(mesh(worldUV(g, 4), gable));
  }
  // Traufbretter
  for (const side of [-1, 1]) {
    const y = eaveY - 0.08, sPos = mid + side * run;
    const g = axis === 'x' ? new THREE.BoxGeometry(alongLen, 0.22, 0.06) : new THREE.BoxGeometry(0.06, 0.22, alongLen);
    const m = mesh(g, D.M.woodDark);
    if (axis === 'x') m.position.set(alongMid, y, sPos); else m.position.set(sPos, y, alongMid);
    scene.add(m);
  }
  if (chimney) {
    const [cx, cz] = chimney;
    box(0.8, 3.2, 0.8, D.mats.concreteDark, cx, WALL_H + rise * 0.6 + 0.6, cz, scene);
  }
}

// Flachdach mit Attika
function flatRoof(D, { x0, y0, x1, y1, wall, h = 0.6 }) {
  const { scene, mats: mt } = D;
  const X0 = edge(x0), X1 = edge(x1 + 1), Z0 = edge(y0), Z1 = edge(y1 + 1);
  const w = X1 - X0, d = Z1 - Z0;
  scene.add(mesh(new THREE.BoxGeometry(w, 0.34, d), mt.roofFlat, X0 + w / 2, WALL_H + 0.16, Z0 + d / 2));
  const t = 0.3, y = WALL_H + 0.33 + h / 2;
  const pg = [
    new THREE.BoxGeometry(w, h, t).translate(X0 + w / 2, y, Z0 + t / 2),
    new THREE.BoxGeometry(w, h, t).translate(X0 + w / 2, y, Z1 - t / 2),
    new THREE.BoxGeometry(t, h, d).translate(X0 + t / 2, y, Z0 + d / 2),
    new THREE.BoxGeometry(t, h, d).translate(X1 - t / 2, y, Z0 + d / 2),
  ];
  scene.add(mesh(worldUV(mergeGeometries(pg), 4), wall));
}

function buildRoofs(D) {
  const { m, mats: mt, M } = D;
  const W8 = m.mats;
  flatRoof(D, { x0: 22, y0: 68, x1: 38, y1: 84, wall: W8.depot });
  flatRoof(D, { x0: 50, y0: 10, x1: 66, y1: 21, wall: W8.diner, h: 0.9 });
  gableRoof(D, { x0: 66, y0: 12, x1: 78, y1: 21, axis: 'x', rise: 1.6, mat: mt.corr, gable: W8.garage });
  gableRoof(D, { x0: 96, y0: 8, x1: 106, y1: 17, axis: 'x', rise: 4.2, mat: mt.roofRed, gable: W8.house, chimney: [edge(103), edge(11)] });
  gableRoof(D, { x0: 110, y0: 4, x1: 126, y1: 19, axis: 'z', rise: 6.5, mat: mt.corr, gable: W8.barn });
  gableRoof(D, { x0: 100, y0: 44, x1: 108, y1: 50, axis: 'x', rise: 2.2, mat: mt.corr, gable: W8.hut });
  flatRoof(D, { x0: 134, y0: 38, x1: 154, y1: 62, wall: W8.power, h: 0.8 });
  flatRoof(D, { x0: 70, y0: 97, x1: 82, y1: 108, wall: W8.brick, h: 0.7 });
  gableRoof(D, { x0: 86, y0: 98, x1: 100, y1: 110, axis: 'x', rise: 3.2, mat: mt.roofSlate, gable: W8.bank });
  flatRoof(D, { x0: 104, y0: 97, x1: 116, y1: 106, wall: W8.brick2, h: 0.7 });

  // Kraftwerk: zwei Schornsteine mit Warnlichtern, Lüftungsaufbauten
  for (const [cx, cz] of [[edge(150), edge(58)], [edge(139), edge(58)]]) {
    const ch = cyl(1.3, 1.7, 22, mt.concreteDark, cx, WALL_H + 11, cz, 16, D.scene);
    ch.castShadow = true;
    for (const y of [WALL_H + 6, WALL_H + 14]) cyl(1.72 - (y - WALL_H) * 0.018, 1.75 - (y - WALL_H) * 0.018, 0.5, mt.red, cx, y, cz, 16, D.scene).castShadow = false;
    D.redLights.push(V(cx, WALL_H + 22.4, cz));
  }
  for (const [x, z] of [[edge(138), edge(42)], [edge(144), edge(52)], [edge(151), edge(41)]]) box(2.4, 1.2, 1.6, M.metal, x, WALL_H + 0.9, z, D.scene);
  // Kühlturm hinter der Kartengrenze
  const prof = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12; prof.push(new THREE.Vector2(13 - Math.sin(t * Math.PI * 0.85) * 4.5 + t * 1.5, t * 34)); }
  const tower = mesh(new THREE.LatheGeometry(prof, 32), mt.concreteDark, W * C + 26, 0, edge(46));
  D.scene.add(tower);
}

// ── Tunnel ───────────────────────────────────────────────────
function buildTunnel(D) {
  const { scene, mats: mt, m } = D;
  // Erdhügel mit Böschung über dem Tunnel; Stirnseiten als Betonflügelwände
  const cx = edge(44) + 1, z0 = edge(44), z1 = edge(57);
  const sh = new THREE.Shape();
  const prof = [[-13, -0.05], [-11.5, 1.2], [-9.5, 3.6], [-7.5, 5.6], [-5.5, 6.9], [-3, 7.6], [0, 7.9], [3, 7.6], [5.5, 6.9], [7.5, 5.6], [9.5, 3.6], [11.5, 1.2], [13, -0.05]];
  sh.moveTo(prof[0][0], prof[0][1]);
  for (const [x, y] of prof.slice(1)) sh.lineTo(x, y);
  sh.closePath();
  // Öffnung für die Röhre (liegt hinter den Tunnelwänden und der Decke)
  const hole = new THREE.Path();
  hole.moveTo(-5.05, -0.05); hole.lineTo(-5.05, 4.35); hole.lineTo(5.05, 4.35); hole.lineTo(5.05, -0.05); hole.closePath();
  sh.holes.push(hole);
  const hill = new THREE.ExtrudeGeometry(sh, { depth: z1 - z0, bevelEnabled: false });
  hill.translate(cx, 0, z0);
  // UVs: Stirnseiten (Beton) im 4-m-Raster, Grasfläche passend zum Boden
  const hp = hill.attributes.position, hn = hill.attributes.normal, huv = hill.attributes.uv;
  for (let i = 0; i < hp.count; i++) {
    if (Math.abs(hn.getZ(i)) > 0.7) huv.setXY(i, hp.getX(i) / 4, hp.getY(i) / 4);
    else huv.setXY(i, hp.getX(i) / 456, hp.getZ(i) / 456);
  }
  const hm = new THREE.Mesh(hill, [m.mats.tunnel, mt.grass]);
  hm.castShadow = hm.receiveShadow = true;
  scene.add(hm);
  // Portale
  for (const z of [z0 - 0.3, z1 + 0.3]) {
    box(15.4, 3.6, 0.9, m.mats.tunnel, cx, WALL_H + 1.8, z, scene);
    box(15.8, 0.3, 1.1, mt.concreteDark, cx, WALL_H + 3.6, z, scene);
  }
  const tex = T.textSign('GRAUWEILER-TUNNEL', '#f0e6c8', '#14243a', 1024, 160, 'bold 70px Oswald, Impact, sans-serif');
  for (const [z, ry] of [[z0 - 0.8, Math.PI], [z1 + 0.8, 0]]) {
    const s = mesh(new THREE.PlaneGeometry(6, 0.95), signMat(tex), cx, WALL_H + 1.4, z, false);
    s.rotation.y = ry;
    scene.add(s);
  }
}

// ── Funkmast "Sender 7" ──────────────────────────────────────
function buildMast(D) {
  const { scene, M, mats: mt } = D;
  const Hm = MAST.height, base = 1.85, top = 0.4;
  const hw = (y) => base + (top - base) * (y / Hm);
  const geos = [];
  const corner = (sx, sz, y) => V(MAST.x + sx * hw(y), y, MAST.z + sz * hw(y));
  const legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sz] of legs) geos.push(beamGeo(corner(sx, sz, 0), corner(sx, sz, Hm), 0.09, 6));
  for (let y = 0; y < Hm; y += 3) {
    const y2 = Math.min(Hm, y + 3);
    for (let i = 0; i < 4; i++) {
      const [ax, az] = legs[i], [bx, bz] = legs[(i + 1) % 4];
      geos.push(beamGeo(corner(ax, az, y2), corner(bx, bz, y2), 0.04, 4));
      geos.push(beamGeo(corner(ax, az, y), corner(bx, bz, y2), 0.03, 4));
      geos.push(beamGeo(corner(bx, bz, y), corner(ax, az, y2), 0.03, 4));
    }
  }
  // Antennen und Plattform
  geos.push(beamGeo(V(MAST.x, Hm, MAST.z), V(MAST.x, Hm + 6, MAST.z), 0.06, 6));
  for (const [dx, dz] of [[0.35, 0], [-0.35, 0], [0, 0.35]]) geos.push(beamGeo(V(MAST.x + dx, Hm - 4, MAST.z + dz), V(MAST.x + dx, Hm + 2.5, MAST.z + dz), 0.03, 4));
  const tower = new THREE.Mesh(mergeGeometries(geos.map((g) => g.toNonIndexed())), M.metal);
  tower.castShadow = true;
  scene.add(tower);
  box(2.6, 0.12, 2.6, M.metal, MAST.x, 28, MAST.z, scene);
  for (const [y, ry] of [[22, 0.6], [32, 2.4]]) {
    const dish = mesh(new THREE.SphereGeometry(0.9, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.35), mt.white, MAST.x + Math.sin(ry) * 0.9, y, MAST.z + Math.cos(ry) * 0.9);
    dish.rotation.set(Math.PI / 2, 0, -ry);
    scene.add(dish);
  }
  for (const [sx, sz] of legs) box(1.1, 0.5, 1.1, D.mats.concreteDark, MAST.x + sx * base, 0.25, MAST.z + sz * base, scene);
  D.redLights.push(V(MAST.x, Hm + 6.2, MAST.z), V(MAST.x + hw(21), 21, MAST.z + hw(21)), V(MAST.x - hw(21), 21, MAST.z - hw(21)));
  // Flutlicht am Fuß des Masts
  for (const [dx, dz] of [[5, 4], [-4, -5]]) {
    const p = V(MAST.x + dx, 0.6, MAST.z + dz);
    const f = new THREE.Group();
    box(0.5, 0.35, 0.3, M.metal, 0, 0.45, 0, f);
    box(0.4, 0.25, 0.02, new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3.2, 3.5) }), 0, 0.45, 0.16, f).castShadow = false;
    f.position.set(p.x, 0, p.z);
    f.lookAt(MAST.x, 0, MAST.z);
    scene.add(f);
    D.m.lightPool.add({ type: 'spot', pos: p, target: V(MAST.x, 24, MAST.z), color: 0xcfe0ff, intensity: 60, distance: 40, angle: 0.32, penumbra: 0.5, offFactor: 0.7, flicker: 0.05 });
  }

  // Senderhäuschen
  const hut = new THREE.Group();
  box(4, 3, 3.2, D.m.mats.power, 0, 1.5, 0, hut);
  box(4.3, 0.2, 3.5, M.metal, 0, 3.1, 0, hut);
  box(1, 2.1, 0.08, M.rust, 0.8, 1.05, 1.62, hut);
  box(0.5, 0.35, 0.1, mt.screen, -0.9, 1.9, 1.62, hut).castShadow = false;
  cyl(0.04, 0.04, 3, M.metal, -1.6, 4.5, -1, 6, hut);
  hut.position.set(wx(60.5), 0, wx(64));
  hut.rotation.y = 0.3;
  D.solid(hut);
  const sign = mesh(new THREE.PlaneGeometry(1.4, 0.5), signMat(T.textSign('SENDER 7', '#ff4433', '#120807', 512, 180, 'bold 90px Oswald, Impact, sans-serif'), 1.3), 0.8, 2.7, 1.64, false);
  hut.add(sign);

  // Turbinenplatz (Markierung am Boden)
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const c = cv.getContext('2d');
  c.fillStyle = '#3a3a3a'; c.fillRect(0, 0, 256, 256);
  for (let i = -256; i < 512; i += 40) { c.fillStyle = '#c9a21a'; c.beginPath(); c.moveTo(i, 0); c.lineTo(i + 20, 0); c.lineTo(i + 20 - 256, 256); c.lineTo(i - 256, 256); c.fill(); }
  c.fillStyle = '#2a2a2a'; c.fillRect(30, 30, 196, 196);
  c.fillStyle = '#3fd0ff'; c.font = 'bold 54px Oswald, Impact, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('⚙', 128, 100); c.font = 'bold 34px Oswald, Impact, sans-serif'; c.fillText('TURBINE', 128, 170);
  const pad = mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshStandardMaterial({ map: T.toTexture(cv, { repeat: false }), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3 }), MAST_PAD.x, 0.035, MAST_PAD.z, false);
  pad.rotation.x = -Math.PI / 2;
  scene.add(pad);
}

// ── Glutfelder ───────────────────────────────────────────────
function buildLava(D) {
  const { scene, mats: mt, m } = D;
  for (const [x0, y0, x1, y1] of LAVA_RECTS) {
    const w = edge(x1 + 1) - edge(x0) + 1.2, d = edge(y1 + 1) - edge(y0) + 1.2;
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv, uv1 = new Float32Array(uv.count * 2);
    for (let i = 0; i < uv.count; i++) { uv1[i * 2] = (uv.getX(i) * w) / 7; uv1[i * 2 + 1] = (uv.getY(i) * d) / 7; }
    g.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
    const cx = edge(x0) + (edge(x1 + 1) - edge(x0)) / 2, cz = edge(y0) + (edge(y1 + 1) - edge(y0)) / 2;
    const lm = mesh(g, mt.lava, cx, 0.065, cz, false);
    lm.userData.dynamic = true;
    scene.add(lm);
    m.emberSources.push(V(cx - w * 0.2, 0.2, cz), V(cx + w * 0.2, 0.2, cz + d * 0.15));
    m.lightPool.add({ type: 'point', pos: V(cx, 1.3, cz), color: 0xff5a1a, intensity: 12, distance: 13, flicker: 0.6, offFactor: 1 });
    // dunkle Brocken am Rand
    const rnd = mulberry32(x0 * 31 + y0);
    for (let i = 0; i < 7; i++) {
      const a = rnd() * Math.PI * 2;
      const r = mesh(new THREE.DodecahedronGeometry(0.25 + rnd() * 0.35, 0), D.mats.burnt, cx + Math.cos(a) * w * 0.45, 0.1, cz + Math.sin(a) * d * 0.45);
      r.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      scene.add(r);
    }
  }
}

// ── Haltestellen ─────────────────────────────────────────────
function buildShelters(D) {
  const { M, mats: mt } = D;
  for (const s of SHELTERS) {
    const stop = STOPS.find((x) => x.id === s.stop);
    const g = new THREE.Group();
    // Rückwand (Glas) + Pfosten + Dach + Bank; offene Seite zeigt nach +z (zur Straße)
    box(3.6, 2.2, 0.06, M.glass, 0, 1.25, -0.75, g).castShadow = false;
    for (const x of [-1.8, 1.8]) for (const z of [-0.78, 0.7]) cyl(0.04, 0.04, 2.5, M.metal, x, 1.25, z, 6, g);
    box(3.9, 0.12, 1.9, mt.busGreen, 0, 2.55, -0.05, g);
    box(2.6, 0.06, 0.45, M.wood, 0, 0.48, -0.45, g);
    for (const x of [-1.1, 1.1]) box(0.06, 0.48, 0.4, M.metal, x, 0.24, -0.45, g);
    box(0.06, 2.2, 1.2, M.glass, -1.8, 1.25, -0.15, g).castShadow = false;
    const plan = mesh(new THREE.PlaneGeometry(0.8, 1.1), signMat(T.departureBoard([['LINIE 13', 'RING'], ['Busbahnhof', '·'], ['Altstadt', '·'], ['Kraftwerk', '·'], ['Hof', '·']]), 0), 1.2, 1.4, -0.71, false);
    g.add(plan);
    // Haltestellenschild an eigenem Mast
    cyl(0.045, 0.045, 3.2, M.metal, 2.35, 1.6, 0.6, 6, g);
    const sign = mesh(new THREE.PlaneGeometry(0.62, 0.93), new THREE.MeshStandardMaterial({ map: T.busStopSign(stop.name), transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.7 }), 2.35, 2.75, 0.62, false);
    g.add(sign);
    g.position.set(wx(s.x), 0, wx(s.y));
    g.rotation.y = s.yaw;
    D.solid(g, 0.05);
    // kleine Lampe unter dem Dach
    const lp = g.localToWorld(V(0, 2.45, -0.1));
    const bulb = mesh(new THREE.BoxGeometry(1.2, 0.04, 0.1), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3.2, 3.4) }), 0, 2.48, -0.1, false);
    g.add(bulb);
    D.m.lightPool.add({ type: 'spot', pos: lp, target: V(lp.x, 0, lp.z), color: 0xd8e6ff, intensity: 22, distance: 9, angle: 1.15, penumbra: 0.7, offFactor: 0.8, flicker: 0.15, bulb, bulbColor: [3, 3.2, 3.4] });
    s.world = { x: g.position.x, z: g.position.z, button: g.localToWorld(V(2.35, 1.2, 0.6)) };
  }
}

// ── Strommasten mit Leitungen ────────────────────────────────
function buildPowerLines(D) {
  const { scene, M, m } = D;
  const path = route();
  const poles = [];
  for (let s = 0; s < path.length; s += 34) {
    const p = path.pointAt(s), yaw = path.headingAt(s);
    const lx = Math.cos(yaw), lz = -Math.sin(yaw); // links der Fahrtrichtung
    const x = p.x + lx * 6.3, z = p.z + lz * 6.3;
    const c = m.cellAt(x, z);
    if (!c || c.type !== 'floor' || c.zone !== 2 || c.lava || m.stationAt(x, z)?.id === 'tunnel') { poles.push(null); continue; }
    const g = new THREE.Group();
    cyl(0.11, 0.15, 8.6, M.woodDark, 0, 4.3, 0, 7, g);
    box(2.3, 0.12, 0.12, M.woodDark, 0, 8.1, 0, g);
    for (const ox of [-1, 0, 1]) cyl(0.04, 0.05, 0.22, D.mats.white, ox, 8.3, 0, 6, g);
    g.position.set(x, 0, z);
    g.rotation.y = yaw + Math.PI / 2;
    scene.add(g);
    g.updateMatrixWorld(true);
    m.colliders.push({ minX: x - 0.18, maxX: x + 0.18, minZ: z - 0.18, maxZ: z + 0.18 });
    poles.push([-1, 0, 1].map((ox) => g.localToWorld(V(ox, 8.38, 0))));
  }
  const pts = [];
  for (let i = 0; i < poles.length; i++) {
    const a = poles[i], b = poles[(i + 1) % poles.length];
    if (!a || !b || a[0].distanceTo(b[0]) > 48) continue;
    for (let k = 0; k < 3; k++) {
      const A = a[k], B = b[k], seg = 10;
      for (let j = 0; j < seg; j++) {
        const t0 = j / seg, t1 = (j + 1) / seg;
        const p0 = A.clone().lerp(B, t0), p1 = A.clone().lerp(B, t1);
        p0.y -= Math.sin(t0 * Math.PI) * 1.1; p1.y -= Math.sin(t1 * Math.PI) * 1.1;
        pts.push(p0, p1);
      }
    }
  }
  const lg = new THREE.BufferGeometry().setFromPoints(pts);
  scene.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x0b0b0b })));
}

// ── Straßenlaternen (Licht über den Pool) ───────────────────
function streetLamp(D, cx, cy, yaw, opts = {}) {
  const lp = P.lampPost(D.M);
  lp.position.set(wx(cx), 0, wx(cy));
  lp.rotation.y = yaw;
  D.scene.add(lp);
  lp.updateMatrixWorld(true);
  D.m.colliders.push({ minX: lp.position.x - 0.12, maxX: lp.position.x + 0.12, minZ: lp.position.z - 0.12, maxZ: lp.position.z + 0.12 });
  const head = lp.localToWorld(V(0.6, 3.8, 0));
  D.m.lightPool.add({
    type: 'spot', pos: head, target: V(head.x, 0, head.z), color: opts.color ?? 0xffd6a0, intensity: opts.intensity ?? 42,
    distance: 20, angle: 0.95, penumbra: 0.6, flicker: opts.flicker ?? 0, offFactor: opts.offFactor ?? 0.85, poweredOnly: !!opts.powered,
    bulb: lp.userData.bulb, bulbColor: [4, 3.2, 2.2],
  });
}

// ── Requisiten ───────────────────────────────────────────────
function bench(D) {
  const g = new THREE.Group();
  box(2.4, 0.05, 0.45, D.M.wood, 0, 0.46, 0, g);
  box(2.4, 0.4, 0.05, D.M.wood, 0, 0.75, -0.22, g);
  for (const x of [-1.05, 1.05]) box(0.06, 0.46, 0.45, D.M.metal, x, 0.23, 0, g);
  return g;
}
function lockers(D, n = 4) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    box(0.48, 1.9, 0.5, i % 2 ? D.M.metal : D.mats.busGreen, -((n - 1) * 0.25) + i * 0.5, 0.95, 0, g);
    box(0.04, 0.2, 0.02, D.M.chrome, -((n - 1) * 0.25) + i * 0.5 + 0.15, 1.1, 0.26, g);
  }
  return g;
}
function vending(D) {
  const g = new THREE.Group();
  box(1.0, 1.9, 0.8, D.M.paintRed, 0, 0.95, 0, g);
  box(0.7, 1.1, 0.02, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.5, 1.2) }), -0.08, 1.2, 0.41, g).castShadow = false;
  box(0.18, 0.5, 0.03, D.M.dark, 0.36, 1.1, 0.41, g);
  return g;
}
function gasPump(D) {
  const g = new THREE.Group();
  box(0.7, 1.7, 0.45, D.mats.white, 0, 0.85, 0, g);
  box(0.75, 0.25, 0.5, D.M.paintRed, 0, 1.8, 0, g);
  box(0.4, 0.25, 0.02, D.mats.screen, 0, 1.3, 0.24, g).castShadow = false;
  box(0.08, 0.5, 0.08, D.M.dark, 0.38, 0.9, 0.1, g);
  return g;
}
function hayBale(D) {
  const m = mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.3, 14), D.mats.hay);
  m.rotation.z = Math.PI / 2;
  m.position.y = 0.75;
  const g = new THREE.Group(); g.add(m);
  return g;
}
function tractor(D) {
  const g = new THREE.Group();
  const body = D.M.paintGreen;
  box(1.2, 1.0, 2.6, body, 0, 1.2, 0.3, g);
  box(1.3, 1.5, 1.1, body, 0, 2.0, -0.9, g);
  box(1.2, 0.9, 0.9, D.M.glass, 0, 2.3, -0.9, g).castShadow = false;
  for (const [x, z, r, w] of [[-0.85, -1.1, 0.85, 0.45], [0.85, -1.1, 0.85, 0.45], [-0.7, 1.2, 0.5, 0.3], [0.7, 1.2, 0.5, 0.3]]) {
    const wh = cyl(r, r, w, D.M.dark, x, r, z, 14, g);
    wh.rotation.z = Math.PI / 2;
  }
  cyl(0.06, 0.08, 1.0, D.M.rust, 0.35, 2.1, 1.0, 8, g);
  return g;
}
function busWreck(D) {
  const g = new THREE.Group();
  const mt = D.mats.burnt;
  box(11, 0.9, 2.6, mt, 0, 0.75, 0, g);
  box(11, 0.2, 2.6, mt, 0, 2.95, 0, g);
  for (let i = 0; i < 9; i++) for (const s of [-1.27, 1.27]) box(0.12, 1.75, 0.08, mt, -5 + i * 1.25, 2.05, s, g);
  for (const s of [-1.27, 1.27]) box(11, 0.12, 0.08, mt, 0, 1.25, s, g);
  box(0.1, 2.2, 2.5, mt, 5.45, 1.85, 0, g);
  for (const x of [-3.6, 3.6]) for (const s of [-1.05, 1.05]) { const w = cyl(0.45, 0.45, 0.25, D.M.rust, x, 0.4, s, 10, g); w.rotation.x = Math.PI / 2; }
  g.rotation.z = 0.05;
  return g;
}
function barrels(D, n = 3, mat) {
  const g = new THREE.Group();
  const offs = [[0, 0], [0.62, 0.1], [0.25, 0.55], [-0.5, 0.4]];
  for (let i = 0; i < n; i++) { const b = P.barrel(D.M, mat); b.position.set(offs[i][0], 0, offs[i][1]); g.add(b); }
  return g;
}
function crates(D) {
  const g = new THREE.Group();
  g.add(P.crate(D.M, 1.1));
  const b = P.crate(D.M, 0.85); b.position.set(0.05, 1.1, 0.05); b.rotation.y = 0.3; g.add(b);
  const c = P.crate(D.M, 0.8); c.position.set(-0.15, 0, 1.0); c.rotation.y = -0.2; g.add(c);
  return g;
}
function generatorBig(D) {
  const g = new THREE.Group();
  const housing = cyl(1.5, 1.5, 7.5, D.mats.busGreen, 0, 1.75, 0, 20, g);
  housing.rotation.z = Math.PI / 2;
  for (const x of [-3.2, 0, 3.2]) { const r = cyl(1.56, 1.56, 0.25, D.M.metal, x, 1.75, 0, 20, g); r.rotation.z = Math.PI / 2; }
  box(7.8, 0.3, 2.6, D.M.metal, 0, 0.15, 0, g);
  box(1.2, 1.4, 1.2, D.M.metal, 4.3, 0.85, 0, g);
  cyl(0.18, 0.18, 2.6, D.M.rust, -2.5, 3.6, 0, 10, g);
  return g;
}
function controlDesk(D) {
  const g = new THREE.Group();
  box(3.4, 1.0, 0.9, D.M.metal, 0, 0.5, 0, g);
  const top = box(3.4, 0.08, 0.7, D.M.dark, 0, 1.08, 0.05, g);
  top.rotation.x = -0.35;
  for (let i = 0; i < 6; i++) box(0.12, 0.06, 0.02, i % 2 ? D.mats.screen : D.mats.red, -1.3 + i * 0.5, 1.12, 0.3, g).castShadow = false;
  box(3.4, 1.2, 0.2, D.M.metal, 0, 1.6, -0.35, g);
  for (let i = 0; i < 3; i++) box(0.8, 0.5, 0.02, D.mats.screen, -1.1 + i * 1.1, 1.75, -0.24, g).castShadow = false;
  return g;
}
function poolTable(D) {
  const g = new THREE.Group();
  box(2.3, 0.15, 1.3, D.M.woodDark, 0, 0.78, 0, g);
  box(2.1, 0.02, 1.1, new THREE.MeshStandardMaterial({ color: 0x0f3a22, roughness: 0.9 }), 0, 0.86, 0, g);
  for (const x of [-1, 1]) for (const z of [-0.5, 0.5]) box(0.15, 0.72, 0.15, D.M.woodDark, x, 0.36, z, g);
  return g;
}
function tellerCounter(D, len) {
  const g = new THREE.Group();
  box(len, 1.1, 0.7, D.M.woodDark, 0, 0.55, 0, g);
  box(len, 0.06, 0.8, D.mats.white, 0, 1.13, 0, g);
  box(len, 0.9, 0.03, D.M.glass, 0, 1.6, 0.0, g).castShadow = false;
  return g;
}
function vaultDoor(D) {
  const g = new THREE.Group();
  const d = cyl(1.3, 1.3, 0.35, D.M.chrome, 0, 1.5, 0, 28, g);
  d.rotation.x = Math.PI / 2;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const s = box(0.08, 0.6, 0.08, D.M.metal, Math.cos(a) * 0.35, 1.5 + Math.sin(a) * 0.35, 0.25, g);
    s.rotation.z = a + Math.PI / 2;
  }
  return g;
}
function storeShelf(D) {
  const g = new THREE.Group();
  const s1 = P.shelf(D.M); s1.position.x = -0.75; g.add(s1);
  const s2 = P.shelf(D.M); s2.position.x = 0.75; g.add(s2);
  return g;
}
function bed(D) {
  const g = new THREE.Group();
  box(1.0, 0.35, 2.0, D.M.woodDark, 0, 0.25, 0, g);
  box(0.95, 0.15, 1.9, new THREE.MeshStandardMaterial({ color: 0x5c564a, roughness: 1 }), 0, 0.5, 0.02, g);
  box(1.0, 0.8, 0.08, D.M.woodDark, 0, 0.5, -0.98, g);
  return g;
}
function silo(D) {
  const g = new THREE.Group();
  cyl(2.4, 2.4, 13, D.M.metal, 0, 6.5, 0, 20, g);
  const cap = mesh(new THREE.SphereGeometry(2.45, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), D.M.rust, 0, 13, 0);
  g.add(cap);
  for (let i = 0; i < 9; i++) box(0.5, 0.05, 0.05, D.M.metal, 0, 1 + i * 1.3, 2.45, g);
  return g;
}
function scarecrow(D) {
  const g = new THREE.Group();
  cyl(0.05, 0.06, 2.6, D.M.woodDark, 0, 1.3, 0, 6, g);
  box(1.6, 0.06, 0.06, D.M.woodDark, 0, 1.9, 0, g);
  box(0.55, 0.8, 0.3, new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 1 }), 0, 1.6, 0, g);
  const head = mesh(new THREE.SphereGeometry(0.2, 10, 8), D.mats.hay, 0, 2.25, 0); g.add(head);
  const hat = mesh(new THREE.ConeGeometry(0.32, 0.4, 10), D.M.dark, 0, 2.5, 0); g.add(hat);
  return g;
}
function fenceRun(D, ax, az, bx, bz, kind = 'wood') {
  const { scene, M, mats: mt, m } = D;
  const len = Math.hypot(bx - ax, bz - az), yaw = Math.atan2(bx - ax, bz - az);
  const g = new THREE.Group();
  const n = Math.max(1, Math.round(len / 2.4));
  for (let i = 0; i <= n; i++) cyl(0.06, 0.07, kind === 'wood' ? 1.3 : 2.2, kind === 'wood' ? M.woodDark : M.metal, 0, kind === 'wood' ? 0.65 : 1.1, (i / n) * len, 6, g);
  if (kind === 'wood') {
    for (const y of [0.45, 1.0]) box(0.05, 0.12, len, M.wood, 0, y, len / 2, g);
  } else {
    const p = mesh(new THREE.PlaneGeometry(len, 2.1), mt.fence, 0, 1.1, len / 2, false);
    p.rotation.y = Math.PI / 2;
    p.material.map.repeat.set(len / 1.2, 2.1 / 1.2);
    g.add(p);
  }
  g.position.set(ax, 0, az);
  g.rotation.y = yaw;
  scene.add(g);
  // Kollision: dünne Boxen entlang der Strecke
  const steps = Math.ceil(len / 1.5);
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps, t1 = (i + 1) / steps;
    const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
    m.colliders.push({ minX: Math.min(x0, x1) - 0.08, maxX: Math.max(x0, x1) + 0.08, minZ: Math.min(z0, z1) - 0.08, maxZ: Math.max(z0, z1) + 0.08 });
  }
}

// Schild an einer Fassade / auf einem Pfosten
function facadeSign(D, tex, w, h, x, y, z, ry, emissive = 0) {
  const s = mesh(new THREE.PlaneGeometry(w, h), signMat(tex, emissive), x, y, z, false);
  s.rotation.y = ry;
  D.scene.add(s);
  return s;
}

function buildProps(D) {
  const { M, mats: mt, m, scene } = D;
  const place = (obj, cx, cy, ry = 0, solid = true, pad = 0.03) => {
    obj.position.set(wx(cx), obj.position.y, wx(cy));
    obj.rotation.y = ry;
    if (solid) D.solid(obj, pad); else scene.add(obj);
    return obj;
  };
  const posters = (list) => list.forEach(([title, cx, cy, wall, seed]) => {
    const pm = P.wallPoster(M, T.poster(seed, title));
    pm.position.y = 1.9;
    m.place(pm, cx, cy, wall, 0.0);
    pm.rotation.z = (mulberry32(seed)() - 0.5) * 0.12;
  });

  // Busbahnhof
  for (const [cx, cy] of [[33.5, 74], [33.5, 77.5]]) { place(bench(D), cx, cy, -Math.PI / 2); place(bench(D), cx + 0.5, cy, Math.PI / 2); }
  place(lockers(D, 5), 32.6, 83.35, 0);
  place(vending(D), 37.2, 81.5, -Math.PI / 2);
  const board = facadeSign(D, T.departureBoard([['13  ALTSTADT GRAUWEILER', 'pünktlich'], ['13  KRAFTWERK NORD', 'pünktlich'], ['13  HOF MORGENROT', 'verspätet'], ['13  RASTSTÄTTE ZUR EULE', '— — —'], ['13  BUSBAHNHOF', 'NIE']]), 4, 1.5, edge(34), 3.0, edge(69) + 0.04, 0, 1.4);
  m.depotBoard = board;
  place(crates(D), 24, 82.3, 0.3);
  place(barrels(D, 3), 28.5, 70, 0);
  for (const cy of [74, 79]) place(P.shelf(M), 23, cy, Math.PI / 2, true);
  posters([['ABFAHRT', 37, 78, 'E', 201], ['VERMISST', 31, 70, 'W', 202], ['FAHRPLAN', 36, 83, 'S', 203]]);
  place(busWreck(D), 28, 63.4, 0.08);
  place(barrels(D, 2, M.paintRed), 39.6, 84.5, 0.4);
  const fb = P.fireBarrel(M); place(fb, 39.5, 66.5, 0, true);
  const flame = fb.position.clone().setY(0.9); flame.flame = true;
  m.emberSources.push(flame);
  m.lightPool.add({ type: 'point', pos: fb.position.clone().setY(1.4), color: 0xff7a2a, intensity: 13, distance: 13, flicker: 1, offFactor: 1 });
  facadeSign(D, T.placeSign('BUSBAHNHOF', 'GRAUWEILER', '#16212c', '#e6dfc8', 1024, 256), 8, 2, edge(39) + 0.06, WALL_H + 0.65, edge(76), Math.PI / 2);

  // Raststätte & Werkstatt
  const ctr = P.counter(M, 5.6); place(ctr, 56, 12.4, 0);
  for (const cx of [54.5, 55.5, 56.5, 57.5]) m.blockCell(Math.floor(cx), 12);
  for (const cy of [13.5, 16]) place(P.booth(M), 51.6, cy, Math.PI / 2);
  for (const [cx, cy] of [[60, 16], [63, 17.5]]) { const t = P.table(M); place(t, cx, cy, 0.3, true); m.place(P.chair(M), Math.floor(cx), Math.floor(cy), null, 0, 0.8, 0.3); }
  const juke = new THREE.Group();
  box(0.9, 1.5, 0.6, M.paintRed, 0, 0.75, 0, juke);
  const jl = box(0.7, 0.5, 0.02, mt.neonPink, 0, 1.15, 0.31, juke); jl.castShadow = false;
  place(juke, 65.2, 19.5, -Math.PI / 2);
  posters([['ZUR EULE', 50, 12, 'W', 211], ['HEUTE: EINTOPF', 57, 11, 'N', 212]]);
  const canopy = new THREE.Group();
  box(9.5, 0.4, 4.2, mt.white, 0, 4.2, 0, canopy);
  box(9.6, 0.3, 4.3, M.paintRed, 0, 3.95, 0, canopy);
  for (const x of [-4, 4]) for (const z of [-1.5, 1.4]) cyl(0.12, 0.12, 3.9, M.metal, x, 1.95, z, 8, canopy);
  place(canopy, 55, 22.9, 0, false);
  for (const [x, z] of [[-4, -1.5], [4, -1.5], [-4, 1.4], [4, 1.4]]) m.colliders.push({ minX: wx(55) + x - 0.15, maxX: wx(55) + x + 0.15, minZ: wx(22.9) + z - 0.15, maxZ: wx(22.9) + z + 0.15 });
  for (const cx of [53.5, 56.5]) place(gasPump(D), cx, 22.9, 0);
  m.lightPool.add({ type: 'spot', pos: V(wx(55), 3.7, wx(22.9)), target: V(wx(55), 0, wx(22.9)), color: 0xf2f6ff, intensity: 30, distance: 12, angle: 1.2, penumbra: 0.5, offFactor: 0.7, flicker: 0.1 });
  // Pylonen-Schild "Zur Eule"
  const pyl = new THREE.Group();
  cyl(0.15, 0.18, 6.2, M.metal, 0, 3.1, 0, 10, pyl);
  box(3.2, 1.6, 0.4, M.dark, 0, 6.6, 0, pyl);
  const neonTex = T.textSign('ZUR EULE', '#ff3d8a', '#08060a', 512, 256, 'bold 96px Oswald, Impact, sans-serif');
  for (const s of [1, -1]) { const p = mesh(new THREE.PlaneGeometry(3.0, 1.45), new THREE.MeshBasicMaterial({ map: neonTex, color: new THREE.Color(2, 2, 2) }), 0, 6.6, s * 0.21, false); if (s < 0) p.rotation.y = Math.PI; pyl.add(p); }
  place(pyl, 70, 23.6, 0, false);
  m.colliders.push({ minX: wx(70) - 0.2, maxX: wx(70) + 0.2, minZ: wx(23.6) - 0.2, maxZ: wx(23.6) + 0.2 });
  m.neonSigns.push(...pyl.children.filter((c) => c.material && c.material.map === neonTex).map((c) => c.material));
  m.lightPool.add({ type: 'point', pos: V(wx(70), 6.2, wx(23.6) + 1.4), color: 0xff3d8a, intensity: 9, distance: 12, flicker: 0.2, offFactor: 1 });
  // Werkstatt
  const car = P.carWreck(M); car.position.y = 1.0; place(car, 71.5, 15.5, Math.PI / 2, true);
  for (const z of [-1.3, 1.3]) box(0.25, 1.0, 0.25, M.paintRed, wx(71.5) + z, 0.5, wx(15.5), scene);
  place(P.workbench(M), 68.5, 12.75, 0);
  place(barrels(D, 2), 76.5, 19.5, 0.2);
  const tires = new THREE.Group();
  for (let i = 0; i < 4; i++) { const t = mesh(new THREE.TorusGeometry(0.33, 0.13, 8, 16), M.dark, 0, 0.13 + i * 0.26, 0); t.rotation.x = Math.PI / 2; tires.add(t); }
  place(tires, 76.5, 13.6, 0);
  posters([['ÖL & SERVICE', 78, 16, 'E', 213]]);

  // Hof Morgenrot
  place(P.table(M, 1.6, 0.9), 101.5, 12, 0.1);
  m.place(P.chair(M), 101, 12, null, 0, 0.9, 0.6);
  m.place(P.chair(M, true), 102, 11, null, 0, -0.5, -0.5);
  place(P.shelf(M), 105.3, 13.5, -Math.PI / 2);
  place(bed(D), 97.6, 10.3, Math.PI / 2);
  const stove = new THREE.Group(); box(1.0, 1.1, 0.8, M.dark, 0, 0.55, 0, stove); cyl(0.1, 0.1, 2.9, M.dark, 0, 2.5, -0.2, 8, stove);
  place(stove, 97.4, 15.5, Math.PI / 2);
  place(tractor(D), 119, 11, 0.4);
  for (const [cx, cy, ry] of [[112.5, 10], [113.5, 12.5, 0.3], [123.5, 13.5, 1.2], [112, 16.5, 0.1], [121, 6, 0.6]]) place(hayBale(D), cx, cy, ry || 0);
  place(silo(D), 128.5, 6, 0, true, 0.05);
  place(scarecrow(D), 100, 33, 0.4, true);
  place(scarecrow(D), 117, 49, -0.8, true);
  for (const [ax, ay, bx, by] of [[92, 8, 92, 23.5], [92, 8, 95.6, 8], [129.5, 15, 129.5, 23.5]]) fenceRun(D, edge(ax), edge(ay), edge(bx), edge(by), 'wood');
  facadeSign(D, T.placeSign('HOF MORGENROT', 'Eier · Milch · Kartoffeln', '#5a3b22', '#f0dcb4', 768, 256), 3.2, 1.05, wx(94), 1.6, wx(23.4), 0);
  for (const x of [-1.5, 1.5]) cyl(0.07, 0.07, 2.1, M.woodDark, wx(94) + x, 1.05, wx(23.4) - 0.06, 6, scene);
  m.colliders.push({ minX: wx(94) - 1.7, maxX: wx(94) + 1.7, minZ: wx(23.4) - 0.2, maxZ: wx(23.4) + 0.1 });

  // Hütte
  place(bed(D), 106.4, 48, 0);
  place(P.table(M, 1.2, 0.8), 101.8, 46, 0.2);
  const candle = (x, z) => { const c = cyl(0.03, 0.03, 0.18, mt.white, x, 0.88, z, 6, scene); const f = mesh(new THREE.SphereGeometry(0.025, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 2.5, 0.8) }), x, 1.0, z, false); scene.add(f); return c; };
  candle(wx(101.6), wx(45.9)); candle(wx(102.1), wx(46.2));
  m.lightPool.add({ type: 'point', pos: V(wx(102), 1.6, wx(46)), color: 0xffa040, intensity: 6, distance: 8, flicker: 0.8, offFactor: 1 });
  posters([['SIE HÖREN ZU', 100, 45, 'W', 221], ['7 · 7 · 7', 108, 49, 'E', 222]]);

  // Kraftwerk
  place(generatorBig(D), 138.5, 43.5, 0);
  place(generatorBig(D), 149, 54.5, 0);
  place(controlDesk(D), 143, 61.2, Math.PI);
  place(controlDesk(D), 135.5, 45, Math.PI / 2);
  for (const [cx, cy] of [[152.5, 50], [136, 60.5]]) { const tr = new THREE.Group(); box(1.6, 2.2, 1.2, M.paintGreen, 0, 1.1, 0, tr); for (const x of [-0.5, 0, 0.5]) cyl(0.06, 0.08, 0.5, mt.white, x, 2.45, 0, 6, tr); place(tr, cx, cy, 0); }
  // Labor
  const lab = new THREE.Group();
  box(3.6, 0.9, 0.8, mt.white, 0, 0.45, 0, lab);
  for (let i = 0; i < 4; i++) { const f = mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.25, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3 + i * 0.3, 1.6, 0.6) }), -1.2 + i * 0.7, 1.03, 0, false); lab.add(f); }
  place(lab, 148.5, 39.2, 0);
  const tank = new THREE.Group();
  cyl(0.55, 0.55, 2.4, new THREE.MeshStandardMaterial({ color: 0x4bd0a0, emissive: 0x1c8a60, emissiveIntensity: 1.2, transparent: true, opacity: 0.55, roughness: 0.1 }), 0, 1.5, 0, 20, tank).castShadow = false;
  cyl(0.62, 0.62, 0.3, M.metal, 0, 0.15, 0, 20, tank); cyl(0.62, 0.62, 0.3, M.metal, 0, 2.85, 0, 20, tank);
  place(tank, 152.6, 46.5, 0);
  facadeSign(D, T.placeSign('KRAFTWERK NORD', 'Betreten verboten', '#2a2f33', '#d9d4c4', 1024, 256), 9, 2.2, edge(134) - 0.06, WALL_H + 0.75, edge(50), -Math.PI / 2);
  for (const [ay, by] of [[33.5, 41.5], [55, 64.5]]) fenceRun(D, edge(130.7), edge(ay), edge(130.7), edge(by), 'chain');

  // Funkmast-Umgebung: Kabeltrommeln und Kisten
  place(crates(D), 70.5, 64.5, 0.5);

  // Altstadt
  const barCtr = P.counter(M, 4.8); place(barCtr, 76, 105.2, Math.PI);
  place(poolTable(D), 75.5, 101.5, 0);
  for (const [cx, cy] of [[72.5, 103.5], [79.5, 103]]) place(P.table(M, 0.9, 0.9), cx, cy, 0.4);
  facadeSign(D, T.textSign('BAR', '#ffb02e', '#0a0806', 512, 200, 'bold 120px Oswald, Impact, sans-serif'), 2.2, 0.85, wx(75.5), 3.62, edge(97) - 0.06, Math.PI, 1.8);
  m.lightPool.add({ type: 'point', pos: V(wx(75.5), 3.2, edge(97) - 1.2), color: 0xffa030, intensity: 7, distance: 10, flicker: 0.25, offFactor: 1 });
  place(tellerCounter(D, 7.8), 89.6, 105.4, 0, true);
  place(tellerCounter(D, 9.8), 96.4 + 0.5, 105.4, 0, true);
  const vd = vaultDoor(D); vd.position.set(wx(87.2), 0, wx(108.3)); vd.rotation.y = Math.PI / 2; scene.add(vd);
  facadeSign(D, T.placeSign('BANK', 'Grauweiler Sparkasse', '#e8e0c8', '#2a2015', 768, 256), 4.6, 1.5, wx(92.5), WALL_H + 0.4, edge(98) - 0.06, Math.PI);
  for (const cx of [107, 107.6 + 2.6]) place(storeShelf(D), cx, 101.2, 0);
  for (const cx of [107, 109.6]) place(storeShelf(D), cx, 103.4, 0);
  facadeSign(D, T.textSign('LADEN', '#7fe0ff', '#06090c', 512, 200, 'bold 110px Oswald, Impact, sans-serif'), 2.6, 1.0, wx(109.5), 3.55, edge(97) - 0.06, Math.PI, 1.6);
  facadeSign(D, T.placeSign('Grauweiler', 'Altstadt', '#f2c84b', '#151515', 768, 288), 2.6, 1.0, wx(60.5), 2.2, wx(95.3), 0);
  cyl(0.06, 0.06, 2.2, M.metal, wx(60.5), 1.1, wx(95.3) - 0.05, 6, scene);
  m.colliders.push({ minX: wx(60.5) - 1.3, maxX: wx(60.5) + 1.3, minZ: wx(95.3) - 0.15, maxZ: wx(95.3) + 0.1 });
  for (const [cx, cy, ry] of [[68, 95.6, Math.PI / 2], [113, 95.4, -Math.PI / 2 + 0.1]]) place(P.carWreck(M), cx, cy, ry);
  const tb = P.fireBarrel(M); place(tb, 102.6, 95.6, 0);
  m.emberSources.push(tb.position.clone().setY(0.9));
  m.lightPool.add({ type: 'point', pos: tb.position.clone().setY(1.4), color: 0xff7a2a, intensity: 12, distance: 12, flicker: 1, offFactor: 1 });

  // Straßenrand: Autowracks, Fässer
  for (const [cx, cy, ry] of [[51, 41, 0.5], [130.5, 72, 2.2], [123, 85.5, 0.9], [37.5, 92.5, 1.4], [85, 29.5, 3.0], [131.5, 30, 0.2]]) place(P.carWreck(M), cx, cy, ry);
  place(barrels(D, 3, M.paintRed), 49.5, 57, 0.5);
}

// ── Lampen in Gebäuden (Spots über den Licht-Pool) ───────────
function hangingLamp(D, cx, cy, o = {}) {
  const { m, scene, M } = D;
  const x = wx(cx), z = wx(cy);
  const lg = P.hangingLamp(M);
  lg.position.set(x, WALL_H, z);
  scene.add(lg);
  m.lightPool.add({
    type: 'spot', pos: V(x, WALL_H - 0.92, z), target: V(x, 0, z), color: o.color ?? 0xffc98a, intensity: o.intensity ?? 36,
    distance: 15, angle: 1.05, penumbra: 0.65, flicker: o.flicker ?? 0, offFactor: o.off ?? 0.4, poweredOnly: !!o.powered, bulb: lg.userData.bulb,
  });
}

export function buildDecor(m, scene, M) {
  const q = m.ctx.quality || {};
  const D = {
    m, scene, M, q, mats: decorMaterials(M), redLights: [],
    solid(obj, pad = 0.03) { scene.add(obj); obj.updateMatrixWorld(true); m.colliders.push(m.aabb(obj, pad)); return obj; },
  };
  m.neonSigns = [];
  buildGround(D);
  buildRoad(D);
  buildPlazas(D);
  buildCorn(D);
  buildTrees(D);
  buildRoofs(D);
  buildTunnel(D);
  buildMast(D);
  buildLava(D);
  buildShelters(D);
  buildPowerLines(D);
  buildProps(D);

  // Rote Warnlichter (blinken, durch den Nebel sichtbar)
  const glowMat = new THREE.SpriteMaterial({ map: M.tex.glow, color: new THREE.Color(1.6, 0.08, 0.05), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
  const redBulb = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.3, 0.2), fog: false });
  for (const p of D.redLights) {
    const b = mesh(new THREE.SphereGeometry(0.22, 10, 8), redBulb, p.x, p.y, p.z, false);
    b.userData.dynamic = true;
    scene.add(b);
    const s = new THREE.Sprite(glowMat);
    s.position.copy(p);
    s.scale.set(4.5, 4.5, 1);
    scene.add(s);
  }

  // Laternen an den Stationen
  const L = (cx, cy, yaw, o) => streetLamp(D, cx, cy, yaw, o);
  L(40.6, 67.8, 0); L(39.4, 86.5, 0); L(41.5, 80.5, Math.PI);
  L(49, 23.4, -Math.PI / 2); L(80, 23.4, -Math.PI / 2);
  L(108, 21.5, -Math.PI / 2, { flicker: 0.5 }); L(95, 21.5, -Math.PI / 2);
  L(131.2, 38.5, Math.PI, { powered: true, offFactor: 0.2 }); L(131.2, 54.5, Math.PI, { flicker: 0.3 });
  L(66, 95.4, Math.PI / 2); L(82, 95.4, Math.PI / 2, { flicker: 0.4 }); L(100.5, 95.4, Math.PI / 2); L(118, 95.4, Math.PI / 2);
  L(61.5, 61, 0.4, { color: 0xc8d8ff });
  // Tunnelbeleuchtung (Natriumdampf)
  for (const cy of [46, 50.5, 55]) {
    const p = V(wx(44), WALL_H - 0.35, wx(cy));
    const fix = mesh(new THREE.BoxGeometry(0.5, 0.12, 0.9), M.metal, p.x, p.y + 0.1, p.z, false);
    scene.add(fix);
    const bulb = mesh(new THREE.BoxGeometry(0.3, 0.04, 0.7), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 2.4, 0.6) }), p.x, p.y + 0.02, p.z, false);
    bulb.userData.dynamic = true;
    scene.add(bulb);
    m.lightPool.add({ type: 'spot', pos: p, target: V(p.x, 0, p.z), color: 0xffa648, intensity: 30, distance: 13, angle: 1.2, penumbra: 0.7, flicker: cy === 50.5 ? 0.9 : 0.1, offFactor: 0.9, bulb, bulbColor: [5, 2.4, 0.6] });
  }

  // Laufzeit: Wind, Glut, Blinklichter, Neon
  const cornTime = D.mats.windTime, lavaTex = D.mats.lavaTex, lavaMat = D.mats.lava;
  m.decorUpdate = (dt, time) => {
    cornTime.value = time;
    lavaTex.offset.x = Math.sin(time * 0.05) * 0.2;
    lavaTex.offset.y += dt * 0.012;
    lavaMat.emissiveIntensity = 1.6 + Math.sin(time * 1.7) * 0.35 + Math.sin(time * 4.3) * 0.15;
    const blink = (time % 1.6) < 0.8 ? 1 : 0.12;
    redBulb.color.setRGB(6 * blink, 0.3 * blink, 0.2 * blink);
    glowMat.opacity = blink;
    for (const nm of m.neonSigns) nm.color.setScalar(Math.random() < 0.01 ? 0.4 : 2);
  };
}

export function buildLights(m, scene, M) {
  const D = { m, scene, M };
  const hl = (cx, cy, o) => hangingLamp(D, cx, cy, o);
  // Busbahnhof (brennt auch ohne Strom)
  hl(33, 72, { off: 0.8 }); hl(34.5, 78.5, { off: 0.75, flicker: 0.2 }); hl(35, 82.5, { off: 0.7 });
  hl(26, 73, { off: 0.25, flicker: 0.8 }); hl(26, 80, { off: 0.25 });
  // Raststätte & Werkstatt
  hl(54, 14.5, { off: 0.5, color: 0xffd9b0 }); hl(60, 16, { off: 0.45, flicker: 0.3 }); hl(64, 12.5, { off: 0.5 });
  hl(72, 17, { off: 0.3, flicker: 0.6 });
  // Hof
  hl(101, 12.5, { off: 0.45, color: 0xffcf90 }); hl(114, 9, { off: 0.4 }); hl(121, 14.5, { off: 0.35, flicker: 0.5 });
  // Kraftwerk (fast dunkel ohne Strom) und Labor
  hl(138.5, 47, { off: 0.25, color: 0xe8f0ff }); hl(141, 56, { off: 0.15, color: 0xe8f0ff, flicker: 0.4 });
  hl(149, 50.5, { off: 0.12, color: 0xe8f0ff }); hl(150, 59.5, { off: 0.15, color: 0xe8f0ff });
  hl(148, 41.5, { powered: true, color: 0xd8f8ff }); hl(151.5, 45.5, { powered: true, color: 0xd8f8ff });
  // Altstadt
  hl(74, 101, { off: 0.5, color: 0xffc070 }); hl(79, 105, { off: 0.5, color: 0xffc070, flicker: 0.3 });
  hl(90, 102, { off: 0.45 }); hl(96, 107, { off: 0.4 });
  hl(107, 100, { off: 0.45, color: 0xf0f6ff }); hl(113, 103, { off: 0.4, color: 0xf0f6ff, flicker: 0.5 });
}
