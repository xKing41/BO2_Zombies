// Statisches Batching: Alle unbeweglichen Meshes mit gleichem Material werden
// zu einem einzigen Mesh verschmolzen. Aus mehreren hundert Draw-Calls für
// Kisten, Möbel, Bäume, Lampen usw. werden wenige Dutzend – wichtig für Handys.
// Objekte (samt Kindern) mit userData.dynamic bleiben unangetastet.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _c = new THREE.Vector3();

// chunk > 0: Meshes werden zusätzlich nach Gitterkacheln (in Metern) getrennt,
// damit auf großen Karten weit entfernte Teile per Frustum-Culling wegfallen.
export function batchStatic(scene, chunk = 0) {
  scene.updateMatrixWorld(true);
  const buckets = new Map();
  const victims = [];

  const visit = (o) => {
    if (!o.visible || o.userData.dynamic) return;
    if (o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && !Array.isArray(o.material)) {
      const g = o.geometry;
      // Gespiegelte Objekte (negative Skalierung) würden die Dreiecksreihenfolge umdrehen
      const ok = g.index && g.attributes.position && g.attributes.normal && g.attributes.uv
        && !Object.keys(g.morphAttributes).length && o.matrixWorld.determinant() > 0;
      if (ok) {
        const attrs = Object.keys(g.attributes).sort().join(',');
        let tile = '';
        if (chunk > 0) {
          if (!g.boundingSphere) g.computeBoundingSphere();
          _c.copy(g.boundingSphere.center).applyMatrix4(o.matrixWorld);
          tile = `|${Math.floor(_c.x / chunk)},${Math.floor(_c.z / chunk)}`;
        }
        const key = `${o.material.uuid}|${o.castShadow}|${o.receiveShadow}|${o.renderOrder}|${attrs}${tile}`;
        let b = buckets.get(key);
        if (!b) buckets.set(key, (b = { material: o.material, cast: o.castShadow, recv: o.receiveShadow, order: o.renderOrder, geos: [] }));
        const clone = g.clone();
        clone.clearGroups();
        clone.applyMatrix4(o.matrixWorld);
        b.geos.push(clone);
        victims.push(o);
      }
    }
    for (const c of o.children) visit(c);
  };
  visit(scene);

  // Kinder, die nicht verschmolzen werden (z. B. bewegliche Teile), behalten ihre Weltposition
  const merged = new Set(victims);
  for (const o of victims) for (const c of [...o.children]) if (!merged.has(c)) scene.attach(c);
  for (const o of victims) o.removeFromParent();
  // Originale werden nicht mehr gezeichnet: Geometrien freigeben (geteilte bleiben)
  const kept = new Set();
  scene.traverse((o) => { if (o.geometry) kept.add(o.geometry); });
  for (const o of victims) if (!o.geometry.userData.shared && !kept.has(o.geometry)) o.geometry.dispose();
  let meshes = 0;
  for (const b of buckets.values()) {
    if (!b.geos.length) continue;
    const geo = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false);
    if (!geo) continue;
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, b.material);
    m.castShadow = b.cast;
    m.receiveShadow = b.recv;
    m.renderOrder = b.order;
    m.matrixAutoUpdate = false;
    m.name = 'static_batch';
    scene.add(m);
    meshes++;
  }
  return { merged: victims.length, meshes };
}

// Ein Objekt (mit Kindern) zu möglichst wenigen Meshes verschmelzen – je Material eines.
// Transformationen werden relativ zur Wurzel eingebacken. Für bewegliche Requisiten,
// die sonst aus vielen kleinen Teilen bestehen (Bauteile, Geister-Vorschauen).
export function mergeByMaterial(root, override = null) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const buckets = new Map();
  const m = new THREE.Matrix4();
  root.traverse((o) => {
    if (!o.isMesh || Array.isArray(o.material)) return;
    const mat = override || o.material;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    m.multiplyMatrices(inv, o.matrixWorld);
    g.applyMatrix4(m);
    if (!buckets.has(mat)) buckets.set(mat, { geos: [], cast: o.castShadow });
    buckets.get(mat).geos.push(g);
  });
  const out = new THREE.Group();
  for (const [mat, b] of buckets) {
    const geo = mergeGeometries(b.geos, false);
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = b.cast && !override;
    mesh.receiveShadow = !override;
    out.add(mesh);
  }
  return out;
}
