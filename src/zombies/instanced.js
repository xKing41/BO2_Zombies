// ─────────────────────────────────────────────────────────────
//  Zeichnet alle Zombies mit wenigen Draw-Calls: Jeder Körperteil-Typ
//  ist ein InstancedMesh; jeder Zombie besitzt nur leere Knochen-Objekte
//  (Platzhalter), deren Weltmatrizen pro Frame übernommen werden.
//  Statt ~30 Draw-Calls pro Zombie gibt es ~26 für alle zusammen.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const WHITE = new THREE.Color(1, 1, 1);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

// Weicher Kontaktschatten unter den Füßen (verblasst im Nebel)
function blobMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uStrength: { value: 0.62 } }]),
    vertexShader: /* glsl */`
      #include <common>
      #include <fog_pars_vertex>
      varying vec2 vUv;
      varying float vS;
      void main() {
        vUv = uv;
        vS = instanceColor.r;
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <fog_pars_fragment>
      uniform float uStrength;
      varying vec2 vUv;
      varying float vS;
      void main() {
        float r = length( vUv - 0.5 ) * 2.0;
        gl_FragColor = vec4( 0.0, 0.0, 0.0, ( 1.0 - smoothstep( 0.15, 1.0, r ) ) * vS * uStrength );
        #include <fog_fragment>
        #ifdef USE_FOG
          gl_FragColor.a *= 1.0 - fogFactor;
        #endif
      }`,
    transparent: true, depthWrite: false, fog: true,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
}

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
    const n = Math.max(1, this.byZombie.length);
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    this.blobs = new THREE.InstancedMesh(g, blobMaterial(), n);
    this.blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < n; i++) this.blobs.setColorAt(i, WHITE);
    this.blobs.count = 0;
    this.blobs.frustumCulled = false;
    this.blobs.renderOrder = -1;
    this.blobs.userData.dynamic = true;
    this.blobs.name = 'zombie_blobs';
    this.scene.add(this.blobs);
  }

  setTints(zi, tints) {
    this.tints[zi] = tints;
  }

  // Aktive Zombies dicht packen und nur so viele Instanzen zeichnen
  // (spart Vertex-Arbeit, wenn wenige Zombies leben)
  update(zombies) {
    const cur = this.cursor;
    for (const k in this.meshes) cur[k] = 0;
    let nb = 0;
    for (const z of zombies) {
      if (!z.active) continue;
      // Kontaktschatten: beim Auftauchen einblenden, beim Sterben ausblenden, Kriecher länglich
      let k = 1;
      if (z.state === 'rise') k = Math.max(0, Math.min(1, 1 + z.pos.y / 1.75));
      else if (z.state === 'dying') k = Math.max(0, 1 - z.stateT / 2.5);
      if (k > 0.02 && this.blobs) {
        _p.set(z.pos.x, (z.onBus ? z.pos.y : 0) + 0.03, z.pos.z);
        _q.setFromAxisAngle(UP, z.yaw || 0);
        if (z.crawler) _s.set(0.8, 1, 1.7); else _s.set(1.05, 1, 1.05);
        this.blobs.setMatrixAt(nb, _m.compose(_p, _q, _s));
        this.blobs.setColorAt(nb, _c.setRGB(k, k, k));
        nb++;
      }
      z.root.updateMatrixWorld(true);
      const tints = this.tints[z.index];
      for (const p of this.byZombie[z.index]) {
        const m = this.meshes[p.key];
        const i = cur[p.key]++;
        m.setMatrixAt(i, shown(p.obj, z.root) ? p.obj.matrixWorld : ZERO);
        if (p.tint) m.setColorAt(i, tints ? tints[p.tint] : WHITE);
      }
    }
    if (this.blobs) {
      this.blobs.count = nb;
      this.blobs.visible = nb > 0;
      this.blobs.instanceMatrix.needsUpdate = true;
      this.blobs.instanceColor.needsUpdate = true;
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
