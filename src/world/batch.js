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
