// ─────────────────────────────────────────────────────────────
//  Zeichnet alle Zombies mit wenigen Draw-Calls: Jeder Körperteil-Typ
//  ist ein InstancedMesh; jeder Zombie besitzt nur leere Knochen-Objekte
//  (Platzhalter), deren Weltmatrizen pro Frame übernommen werden.
//  Statt ~30 Draw-Calls pro Zombie gibt es ~26 für alle zusammen.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const WHITE = new THREE.Color(1, 1, 1);

function shown(o, root) {
  while (o && o !== root) {
    if (!o.visible) return false;
    o = o.parent;
  }
  return true;
}

export class ZombieRenderer {
  // types: { key: { geo, mat, tint: 'skin' | 'shirt' | 'pants' | null, shadow } }
  constructor(scene, types) {
    this.scene = scene;
    this.types = types;
    this.slots = new Map();
    this.byZombie = [];
    this.meshes = {};
    this.tints = [];
    this.cursor = {};
  }

  add(zi, key, obj) {
    if (!this.types[key]) throw new Error('Unbekannter Körperteil: ' + key);
    let list = this.slots.get(key);
    if (!list) this.slots.set(key, (list = []));
    const idx = list.length;
    list.push(obj);
    (this.byZombie[zi] ||= []).push({ key, idx, obj, tint: this.types[key].tint });
  }

  finalize() {
    for (const [key, list] of this.slots) {
      const t = this.types[key];
      const m = new THREE.InstancedMesh(t.geo, t.mat, list.length);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = t.shadow !== false;
      m.receiveShadow = true;
      m.frustumCulled = false;
      for (let i = 0; i < list.length; i++) {
        m.setMatrixAt(i, ZERO);
        if (t.tint) m.setColorAt(i, WHITE);
      }
      m.userData.dynamic = true;
      m.name = 'zombie_' + key;
      this.scene.add(m);
      this.meshes[key] = m;
    }
  }

  setTints(zi, tints) {
    this.tints[zi] = tints;
  }

  // Aktive Zombies dicht packen und nur so viele Instanzen zeichnen
  // (spart Vertex-Arbeit, wenn wenige Zombies leben)
  update(zombies) {
    const cur = this.cursor;
    for (const k in this.meshes) cur[k] = 0;
    for (const z of zombies) {
      if (!z.active) continue;
      z.root.updateMatrixWorld(true);
      const tints = this.tints[z.index];
      for (const p of this.byZombie[z.index]) {
        const m = this.meshes[p.key];
        const i = cur[p.key]++;
        m.setMatrixAt(i, shown(p.obj, z.root) ? p.obj.matrixWorld : ZERO);
        if (p.tint) m.setColorAt(i, tints ? tints[p.tint] : WHITE);
      }
    }
    for (const k in this.meshes) {
      const m = this.meshes[k];
      m.count = cur[k];
      m.visible = m.count > 0; // seltene Teile (Helm, Schürze …) kosten keinen Draw-Call
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  get drawCalls() { return Object.keys(this.meshes).length; }
}
