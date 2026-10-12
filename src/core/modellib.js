// ─────────────────────────────────────────────────────────────
//  3D-Modelle (CC0 von Poly Haven, siehe public/models/QUELLEN.md).
//  Sie liegen als GLB (Meshopt-komprimiert, WebP-Texturen) in zwei
//  Fassungen bereit: <slot>.glb für hoch/mittel, <slot>_lo.glb für
//  niedrig/minimal (Handys: halbe Texturgröße, weniger Dreiecke).
//  Fehlen sie – Einzeldatei-Build, Datei kaputt –, bauen die Requisiten
//  ihre alten Formen aus Grundkörpern (siehe world/props.js).
//
//  preloadModels(slots) holt Modelle im Voraus (Ladebildschirm),
//  model(slot, opts) liefert danach sofort eine Kopie (teilt Geometrie,
//  Materialien und Texturen mit allen anderen Kopien) oder null.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

let INDEX = null;
let indexPromise = null;
let LO = false;
let ENABLED = true;
let ANISO = 4;
const lib = new Map(); // slot → { promise, scene }
let loader = null;

export function configureModels({ lo = false, enabled = true, anisotropy = 4 } = {}) {
  LO = lo;
  ENABLED = enabled;
  ANISO = anisotropy;
}

export function loadModelIndex() {
  if (!indexPromise) {
    indexPromise = (async () => {
      try {
        if (typeof fetch !== 'function' || location.protocol === 'file:') return null;
        const r = await fetch('models/index.json', { cache: 'no-cache' });
        INDEX = r.ok ? await r.json() : null;
      } catch { INDEX = null; }
      return INDEX;
    })();
  }
  return indexPromise;
}

export const modelInfo = (slot) => (ENABLED ? INDEX?.[slot] || null : null);

// Quantisierte Attribute (Int16/Int8, normalisiert) in Float32 umwandeln: Das statische
// Batching backt Weltkoordinaten in die Geometrie, das ginge mit normalisierten Ganzzahlen nicht.
function toFloat(geo) {
  for (const name of Object.keys(geo.attributes)) {
    const a = geo.attributes[name];
    if (!a.isInterleavedBufferAttribute && a.array instanceof Float32Array && !a.normalized) continue;
    const n = a.count, s = a.itemSize, out = new Float32Array(n * s);
    for (let i = 0; i < n; i++) {
      out[i * s] = a.getX(i);
      if (s > 1) out[i * s + 1] = a.getY(i);
      if (s > 2) out[i * s + 2] = a.getZ(i);
      if (s > 3) out[i * s + 3] = a.getW(i);
    }
    geo.setAttribute(name, new THREE.BufferAttribute(out, s));
  }
  if (geo.attributes.normal) {
    const nr = geo.attributes.normal, v = new THREE.Vector3();
    for (let i = 0; i < nr.count; i++) { v.fromBufferAttribute(nr, i).normalize(); nr.setXYZ(i, v.x, v.y, v.z); }
  } else geo.computeVertexNormals();
  // Das Batching braucht UVs, auch bei untexturierten Teilen
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  // Zweite UV-Sätze, Farben, Tangenten: nicht gebraucht, würden nur Batches trennen
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
  if (!geo.index) {
    const idx = new (geo.attributes.position.count > 65535 ? Uint32Array : Uint16Array)(geo.attributes.position.count);
    for (let i = 0; i < idx.length; i++) idx[i] = i;
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  geo.userData.shared = true;
}

function prepare(scene, slot) {
  // Manche Modelle haben ein Skelett (zum Animieren gedacht): als starres Modell in Ruhelage übernehmen
  const skinned = [];
  scene.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o); });
  for (const o of skinned) {
    const mesh = new THREE.Mesh(o.geometry, o.material);
    mesh.name = o.name;
    mesh.position.copy(o.position); mesh.quaternion.copy(o.quaternion); mesh.scale.copy(o.scale);
    o.parent.add(mesh);
    o.parent.remove(o);
  }
  scene.updateMatrixWorld(true);
  const mats = new Set();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    toFloat(o.geometry);
    o.castShadow = true;
    o.receiveShadow = true;
    for (const m of [].concat(o.material)) mats.add(m);
  });
  for (const m of mats) {
    m.userData.modelLib = slot;
    for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap']) {
      const t = m[k];
      if (!t) continue;
      t.anisotropy = ANISO;
      t.userData.modelLib = slot;
    }
    // Halbtransparentes Glas: keine Tiefe schreiben, sonst verschwinden Dinge dahinter
    if (m.transparent) { m.depthWrite = false; m.side = THREE.DoubleSide; }
    // Blattwerk (Alpha-Test): beidseitig
    if (m.alphaTest > 0) m.side = THREE.DoubleSide;
  }
  return scene;
}

function loadOne(slot) {
  const e = INDEX?.[slot];
  if (!e) return Promise.resolve(null);
  if (!loader) {
    loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  const url = `models/${slot}${LO ? '_lo' : ''}.glb${e.v ? `?v=${e.v}` : ''}`;
  return loader.loadAsync(url).then((g) => prepare(g.scene, slot)).catch((err) => {
    console.warn('Modell nicht geladen:', slot, err?.message || err);
    return null;
  });
}

/** Modelle im Voraus laden (parallel). Gibt zurück, wie viele geladen sind. */
export async function preloadModels(slots, onEach = () => {}) {
  if (!ENABLED) return 0;
  await loadModelIndex();
  let n = 0;
  await Promise.all([...new Set(slots)].map(async (slot) => {
    if (!INDEX?.[slot]) { onEach(slot); return; }
    let s = lib.get(slot);
    if (!s) { s = { promise: loadOne(slot), scene: null }; lib.set(slot, s); }
    s.scene = await s.promise;
    if (s.scene) n++;
    onEach(slot);
  }));
  return n;
}

export function hasModel(slot) {
  return ENABLED && !!lib.get(slot)?.scene;
}

const _box = new THREE.Box3();
const _v = new THREE.Vector3();
const _m = new THREE.Vector3(), _M = new THREE.Vector3();

// Maße der gewählten Teile aus dem Index (PC-Fassung): Platzierung und Kollision
// hängen so nicht von der geladenen Fassung ab (Handy-Modelle sind etwas vereinfacht)
function indexBox(slot, keep, out) {
  const nodes = INDEX?.[slot]?.nodes;
  if (!nodes?.length) return null;
  out.makeEmpty();
  for (const n of nodes) {
    if (keep && !keep(n.name)) continue;
    _m.fromArray(n.center).addScaledVector(_v.fromArray(n.size), -0.5);
    _M.fromArray(n.center).addScaledVector(_v.fromArray(n.size), 0.5);
    out.expandByPoint(_m).expandByPoint(_M);
  }
  return out.isEmpty() ? null : out;
}

/**
 * Kopie eines geladenen Modells oder null.
 * opts.parts  RegExp oder Funktion(name): nur diese obersten Teile (z. B. eine Variante aus einem Set)
 * opts.h      auf diese Höhe skalieren (gleichmäßig) · opts.s Faktor · opts.fit [b, h, t] ungleichmäßig
 * opts.shadow false: wirft keinen Schatten (Kleinkram)
 * Der Fuß liegt auf y = 0, die Mitte bei x = z = 0.
 */
export function model(slot, opts = {}) {
  const src = ENABLED ? lib.get(slot)?.scene : null;
  if (!src) return null;
  const keep = opts.parts ? (typeof opts.parts === 'function' ? opts.parts : (nm) => opts.parts.test(nm)) : null;
  const inner = new THREE.Group();
  for (const c of src.children) if (!keep || keep(c.name)) inner.add(c.clone(true));
  if (!inner.children.length) return null;
  if (!indexBox(slot, keep, _box)) { inner.updateMatrixWorld(true); _box.setFromObject(inner); }
  const size = _box.getSize(_v);
  let sx = opts.s ?? 1, sy = sx, sz = sx;
  if (opts.h) sx = sy = sz = opts.h / Math.max(1e-4, size.y);
  if (opts.fit) {
    const [fw, fh, fd] = opts.fit;
    sx = fw ? fw / Math.max(1e-4, size.x) : sx;
    sy = fh ? fh / Math.max(1e-4, size.y) : sy;
    sz = fd ? fd / Math.max(1e-4, size.z) : sz;
  }
  const cx = (_box.min.x + _box.max.x) / 2, cz = (_box.min.z + _box.max.z) / 2, by = _box.min.y;
  inner.position.set(-cx * sx, -by * sy, -cz * sz);
  inner.scale.set(sx, sy, sz);
  const g = new THREE.Group();
  g.add(inner);
  g.userData.model = slot;
  g.userData.size = new THREE.Vector3(size.x * sx, size.y * sy, size.z * sz);
  // Kollisions-/Platzierungsbox im eigenen Raum (Fuß auf 0, Mitte bei x = z = 0)
  g.userData.box = new THREE.Box3(new THREE.Vector3(-size.x * sx / 2, 0, -size.z * sz / 2), new THREE.Vector3(size.x * sx / 2, size.y * sy, size.z * sz / 2));
  if (opts.shadow === false) g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  return g;
}

/**
 * Weltbox eines Objekts: Modelle mit ihren festen Index-Maßen (gleich auf allen Geräten),
 * alles andere aus der Geometrie. Kinder von Modellen (Kleinkram im Regal) zählen nicht mit.
 */
const _c = new THREE.Vector3(), _bb = new THREE.Box3();
export function worldBox(obj, out = new THREE.Box3()) {
  obj.updateMatrixWorld(true);
  out.makeEmpty();
  const visit = (o) => {
    if (o.userData.box) {
      const b = o.userData.box;
      for (let i = 0; i < 8; i++) {
        _c.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(o.matrixWorld);
        out.expandByPoint(_c);
      }
      return;
    }
    if (o.isMesh && o.geometry) {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      _bb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      out.union(_bb);
    }
    for (const c of o.children) visit(c);
  };
  visit(obj);
  return out;
}

/** Höhen der Ablageflächen (Regalböden, Tischplatte) an der Stelle x/z eines Modells – per Strahl von oben */
const _ray = new THREE.Raycaster();
export function surfacesAt(obj, x = 0, z = 0) {
  obj.updateMatrixWorld(true);
  _box.setFromObject(obj);
  _ray.set(new THREE.Vector3(x, _box.max.y + 1, z), new THREE.Vector3(0, -1, 0));
  const hits = _ray.intersectObject(obj, true);
  const out = [];
  for (const h of hits) {
    if (!h.face) continue;
    const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
    if (n.y < 0.7) continue;
    if (out.length && Math.abs(out[out.length - 1] - h.point.y) < 0.05) continue;
    out.push(h.point.y);
  }
  return out.reverse(); // von unten nach oben
}

/** Alle Modelle außer den genannten freigeben (Grafikspeicher, Bilddaten) */
export function retainModels(keep = []) {
  const k = new Set(keep);
  for (const [slot, s] of lib) {
    if (k.has(slot)) continue;
    lib.delete(slot);
    if (!s.scene) continue;
    const done = new Set();
    s.scene.traverse((o) => {
      if (!o.isMesh) return;
      if (!done.has(o.geometry)) { done.add(o.geometry); o.geometry.dispose(); }
      for (const m of [].concat(o.material)) {
        if (done.has(m)) continue;
        done.add(m);
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap']) {
          const t = m[key];
          if (!t || done.has(t)) continue;
          done.add(t);
          t.dispose();
          if (typeof ImageBitmap !== 'undefined' && t.image instanceof ImageBitmap) t.image.close();
        }
        m.dispose();
      }
    });
  }
}

export const isModelMaterial = (m) => !!m?.userData?.modelLib;
