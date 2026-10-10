// ─────────────────────────────────────────────────────────────
//  Raster-Licht: vorberechnete Umgebungsverdeckung (dunkle Ecken,
//  Kontaktschatten an Wänden und Requisiten) und indirektes Licht
//  (Lampenlicht, das vom Boden an Wände und Decken zurückstrahlt).
//  Weil die Karten aus einem Zellraster bestehen, reicht eine kleine
//  Draufsicht-Textur (4 Texel je Zelle = 50 cm) für die ganze Karte.
//  Jedes Material liest sie über seine Weltposition – Wände, Böden,
//  Decken, Requisiten und Zombies passen so zusammen, ohne teure
//  Bildschirm-Effekte. Kostet pro Pixel zwei Texturzugriffe.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { CELL, WALL_H } from '../config.js';

const R = 4; // Texel je Zelle

// Gemeinsame Uniforms aller beleuchteten Materialien
export const GRID = {
  tex1: { value: null }, //  rgb: indirektes Licht bei Strom · a: Verdeckung
  tex2: { value: null }, //  rgb: indirektes Licht ohne Strom · a: 1 = überdacht
  p: { value: new THREE.Vector4(0, 0, 1, 0.35) }, //  xy: 1/Kartengröße · z: Stärke indirekt · w: Verdeckung des Direktlichts
  p2: { value: new THREE.Vector4(0, 0, WALL_H, 1.25) }, //  x: Strom 0…1 · y: an/aus · z: Wandhöhe · w: Stärke Verdeckung
  p3: { value: new THREE.Vector4(0.85, 0.65, 0.4, 0) }, //  x: Umgebungslicht drinnen · y: Spiegelungen drinnen · z: Spiegelungen draußen
};

const PARS = /* glsl */`
	uniform sampler2D gridTex1, gridTex2;
	uniform vec4 gridP, gridP2, gridP3;
	varying vec3 vGridWorld;`;

const FRAG = /* glsl */`
	if ( gridP2.y > 0.5 ) {
		vec3 gN = transformDirectionByInverseViewMatrix( nonPerturbedNormal, viewMatrix );
		vec2 gUv = ( vGridWorld.xz + gN.xz * 0.3 ) * gridP.xy;
		vec4 g1 = texture2D( gridTex1, gUv );
		vec4 g2 = texture2D( gridTex2, gUv );
		float gOcc = 1.0 - gridP2.w * g1.a;
		float gy = vGridWorld.y;
		// Verdeckung nahe am Boden und (drinnen) nahe an der Decke
		float gAo = mix( clamp( gOcc, 0.0, 1.0 ), 1.0, smoothstep( 0.0, 1.1, gy ) );
		gAo *= mix( 1.0, mix( clamp( gOcc, 0.0, 1.0 ), 1.0, smoothstep( 0.0, 0.9, gridP2.z - gy ) ), g2.a );
		// Drinnen fällt kaum Himmelslicht ein
		float gIn = mix( 1.0, gridP3.x, g2.a );
		reflectedLight.indirectDiffuse *= gAo * gIn;
		reflectedLight.indirectSpecular *= gAo * mix( gridP3.z, gridP3.y, g2.a );
		reflectedLight.directDiffuse *= mix( 1.0, gAo, gridP.w );
		vec3 gB = mix( g2.rgb, g1.rgb, gridP2.x ) * gridP.z;
		reflectedLight.indirectDiffuse += gB * BRDF_Lambert( material.diffuseColor ) * gAo;
	}`;

const LIT = new Set(['MeshStandardMaterial', 'MeshPhysicalMaterial', 'MeshLambertMaterial', 'MeshPhongMaterial']);

// Material an das Raster-Licht anschließen (bestehende Shader-Anpassungen bleiben erhalten)
export function gridLit(m) {
  if (!m || !LIT.has(m.type) || m.userData.gridLit || m.userData.noGrid) return m;
  m.userData.gridLit = true;
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey.call(m);
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    Object.assign(sh.uniforms, { gridTex1: GRID.tex1, gridTex2: GRID.tex2, gridP: GRID.p, gridP2: GRID.p2, gridP3: GRID.p3 });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGridWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n\tvGridWorld = ( mvPosition.xyz - viewMatrix[ 3 ].xyz ) * mat3( viewMatrix );');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + PARS)
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n' + FRAG);
  };
  m.customProgramCacheKey = () => prevKey + '|grid';
  m.needsUpdate = true;
  return m;
}

// Alle beleuchteten Materialien einer Szene anschließen
export function gridLitScene(scene) {
  const seen = new Set();
  scene.traverse((o) => {
    if (!o.material) return;
    for (const m of [].concat(o.material)) if (!seen.has(m)) { seen.add(m); gridLit(m); }
  });
  return seen.size;
}

// Separierbare Box-Unschärfe (zweimal angewendet ≈ Gauß)
function blur(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = -r; x <= r; x++) s += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = s / n;
      s += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / n;
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

// Lichtquellen der Karte einsammeln: echte Lichter und Pool-Lampen
function collectSources(map) {
  const out = [];
  const add = (pos, dir, color, intensity, distance, offFactor, poweredOnly, spot) => {
    let cx = pos.x, cz = pos.z, h = pos.y;
    // Strahler nach unten: Lichtfleck am Boden ist die Quelle des Rücklichts
    if (spot && dir && dir.y < -0.3) { const t = pos.y / -dir.y; cx += dir.x * t; cz += dir.z * t; h = 0; }
    else if (spot && dir && dir.y >= -0.3) intensity *= 0.35; // schräg/nach oben: nur Streulicht
    out.push({ x: cx, z: cz, h, color: new THREE.Color(color), intensity, range: Math.min(distance || 12, 16), offFactor, poweredOnly });
  };
  const dir = new THREE.Vector3();
  for (const e of map.lights) {
    const l = e.light;
    if (!l.isSpotLight && !l.isPointLight) continue;
    if (l.isSpotLight) dir.subVectors(l.target.position, l.position).normalize();
    add(l.position, l.isSpotLight ? dir : null, l.color, e.base, l.distance, e.poweredOnly ? 0 : e.offFactor, e.poweredOnly, l.isSpotLight);
  }
  if (map.lightPool) for (const s of map.lightPool.sources) {
    if (s.dynamic) continue;
    if (s.type === 'spot') dir.subVectors(s.target || new THREE.Vector3(s.pos.x, 0, s.pos.z), s.pos).normalize();
    add(s.pos, s.type === 'spot' ? dir : null, s.color, s.intensity, s.distance, s.poweredOnly ? 0 : s.offFactor ?? 0.35, s.poweredOnly, s.type === 'spot');
  }
  return out;
}

// Raster-Licht einer Karte berechnen
export function bakeGridLight(map, opts = {}) {
  const t0 = performance.now();
  const TW = map.w * R, TH = map.h * R, N = TW * TH;
  // Hindernisse: Wände, geschlossene Türen, Fensterbrüstungen, Requisiten
  const mask = new Float32Array(N);
  const fill = (x0, z0, x1, z1, v) => {
    const a = Math.max(0, Math.floor((x0 / CELL) * R)), b = Math.min(TW - 1, Math.ceil((x1 / CELL) * R) - 1);
    const c = Math.max(0, Math.floor((z0 / CELL) * R)), d = Math.min(TH - 1, Math.ceil((z1 / CELL) * R) - 1);
    for (let y = c; y <= d; y++) for (let x = a; x <= b; x++) if (mask[y * TW + x] < v) mask[y * TW + x] = v;
  };
  const open = new Uint8Array(map.w * map.h); // für die Sichtprüfung des Rücklichts
  for (const c of map.cells) {
    const v = c.type === 'wall' ? 1 : c.type === 'door' ? (c.door.open ? 0 : 1) : c.type === 'window' ? 0.55 : 0;
    if (v) fill(c.x * CELL, c.y * CELL, (c.x + 1) * CELL, (c.y + 1) * CELL, v);
    open[c.y * map.w + c.x] = c.type === 'wall' || (c.type === 'door' && !c.door.open) ? 0 : 1;
  }
  for (const b of map.colliders) fill(b.minX, b.minZ, b.maxX, b.maxZ, 0.75);
  for (const k of map.navBlocked) {
    const cx = k % map.w, cy = Math.floor(k / map.w), c = map.cells[k];
    if (c && c.type === 'floor') fill(cx * CELL + 0.5, cy * CELL + 0.5, cx * CELL + 1.5, cy * CELL + 1.5, 0.75);
  }
  const occ = blur(blur(mask, TW, TH, 2), TW, TH, 2);

  // Indirektes Licht mit und ohne Strom
  const on = new Float32Array(N * 3), off = new Float32Array(N * 3);
  const gain = opts.gain ?? 0.06;
  const vis = new Map();
  const visible = (ax, ay, bx, by) => {
    // Raster-Strahl von Zelle a nach Zelle b (Start- und Zielzelle zählen nicht)
    let x = ax, y = ay;
    const dx = Math.abs(bx - ax), dy = Math.abs(by - ay), sx = ax < bx ? 1 : -1, sy = ay < by ? 1 : -1;
    let err = dx - dy;
    while (x !== bx || y !== by) {
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
      if ((x !== bx || y !== by) && !open[y * map.w + x]) return false;
    }
    return true;
  };
  for (const s of collectSources(map)) {
    const scx = Math.floor(s.x / CELL), scy = Math.floor(s.z / CELL);
    if (scx < 0 || scy < 0 || scx >= map.w || scy >= map.h) continue;
    const rr = s.range, k = s.intensity * gain;
    const offK = s.poweredOnly ? 0 : s.offFactor;
    const x0 = Math.max(0, Math.floor(((s.x - rr) / CELL) * R)), x1 = Math.min(TW - 1, Math.ceil(((s.x + rr) / CELL) * R));
    const y0 = Math.max(0, Math.floor(((s.z - rr) / CELL) * R)), y1 = Math.min(TH - 1, Math.ceil(((s.z + rr) / CELL) * R));
    vis.clear();
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      const wx = ((tx + 0.5) / R) * CELL, wz = ((ty + 0.5) / R) * CELL;
      const d = Math.hypot(wx - s.x, wz - s.z);
      if (d > rr) continue;
      const cx = Math.floor(tx / R), cy = Math.floor(ty / R);
      const key = cy * map.w + cx;
      let v = vis.get(key);
      if (v === undefined) { v = open[key] ? visible(scx, scy, cx, cy) : false; vis.set(key, v); }
      if (!v) continue;
      const f = (k / (1 + (d / 3.5) ** 2)) * (1 - (d / rr) ** 2);
      const i = (ty * TW + tx) * 3;
      on[i] += s.color.r * f; on[i + 1] += s.color.g * f; on[i + 2] += s.color.b * f;
      off[i] += s.color.r * f * offK; off[i + 1] += s.color.g * f * offK; off[i + 2] += s.color.b * f * offK;
    }
  }
  // Wandtexel übernehmen das Licht des Raums davor (weiche Übergänge an Kanten)
  const sm = (arr) => {
    const out = new Float32Array(arr.length);
    for (let c = 0; c < 3; c++) {
      const ch = new Float32Array(N);
      for (let i = 0; i < N; i++) ch[i] = arr[i * 3 + c];
      const b = blur(ch, TW, TH, 1);
      for (let i = 0; i < N; i++) out[i * 3 + c] = b[i];
    }
    return out;
  };
  const onS = sm(on), offS = sm(off);

  const SC = 255 / 2; // indirektes Licht 0…2
  const d1 = new Uint8Array(N * 4), d2 = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    const cx = Math.floor((i % TW) / R), cy = Math.floor(i / TW / R);
    const cell = map.cells[cy * map.w + cx];
    const roof = cell && (cell.type === 'floor' ? map.hasCeiling(cell) : cell.type !== 'void' && cell.type !== 'spawn' && cell.zone >= 0 && map.zones[cell.zone] && map.zones[cell.zone].ceiling);
    for (let c = 0; c < 3; c++) {
      d1[i * 4 + c] = Math.min(255, onS[i * 3 + c] * SC);
      d2[i * 4 + c] = Math.min(255, offS[i * 3 + c] * SC);
    }
    d1[i * 4 + 3] = Math.min(255, occ[i] * 255);
    d2[i * 4 + 3] = roof ? 255 : 0;
  }
  const mk = (d) => {
    const t = new THREE.DataTexture(d, TW, TH);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    return t;
  };
  return { tex1: mk(d1), tex2: mk(d2), ms: Math.round(performance.now() - t0), size: [TW, TH] };
}

// Raster-Licht für eine geladene Karte aktivieren
export function useGridLight(map, baked, enabled = true) {
  if (GRID.tex1.value) GRID.tex1.value.dispose();
  if (GRID.tex2.value) GRID.tex2.value.dispose();
  GRID.tex1.value = baked.tex1;
  GRID.tex2.value = baked.tex2;
  GRID.p.value.x = 1 / (map.w * CELL);
  GRID.p.value.y = 1 / (map.h * CELL);
  GRID.p2.value.x = map.power ? 1 : 0;
  GRID.p2.value.y = enabled ? 1 : 0;
}
