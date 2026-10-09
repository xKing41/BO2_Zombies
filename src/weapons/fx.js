// ─────────────────────────────────────────────────────────────
//  Waffen-Effekte: Mündungsfeuer (Stern + Seitenflammen, pro Schuss
//  zufällig), Laufrauch nach Dauerfeuer (Viewmodel-Szene) und
//  ausgeworfene Hülsen als Instanz-Pool in der Welt.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { flashTextures } from './gunTextures.js';
import { rand } from '../core/utils.js';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _m = new THREE.Matrix4(), _ax = new THREE.Vector3();

// ── Mündungsfeuer ─────────────────────────────────────────────
export class MuzzleFlash {
  constructor() {
    const tx = flashTextures();
    this.starTex = tx.star.clone(); this.starTex.repeat.set(0.5, 0.5); this.starTex.needsUpdate = true;
    this.sideTex = tx.side.clone(); this.sideTex.repeat.set(1, 0.5); this.sideTex.needsUpdate = true;
    const mk = (map) => new THREE.MeshBasicMaterial({ map, color: new THREE.Color(3, 2.2, 1.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.starMat = mk(this.starTex); this.sideMat = mk(this.sideTex);
    this.group = new THREE.Group();
    this.group.name = 'flash';
    this.star = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.starMat);
    const sideGeo = new THREE.PlaneGeometry(1, 1); sideGeo.translate(0.5, 0, 0); sideGeo.rotateY(Math.PI / 2);
    // zwei gekreuzte Seitenflammen in einem Mesh
    const s2 = sideGeo.clone(); s2.rotateZ(Math.PI / 2);
    const both = new THREE.BufferGeometry();
    const pos = [...sideGeo.attributes.position.array, ...s2.attributes.position.array];
    const uv = [...sideGeo.attributes.uv.array, ...s2.attributes.uv.array];
    both.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    both.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    both.setIndex([0, 2, 1, 2, 3, 1, 4, 6, 5, 6, 7, 5]);
    this.side = new THREE.Mesh(both, this.sideMat);
    // Seitliche Strahlen einer Mündungsbremse
    const jet = new THREE.PlaneGeometry(1, 1); jet.translate(0.5, 0, 0); jet.rotateX(Math.PI / 2);
    const jet2 = jet.clone(); jet2.rotateY(Math.PI);
    const jb = new THREE.BufferGeometry();
    jb.setAttribute('position', new THREE.Float32BufferAttribute([...jet.attributes.position.array, ...jet2.attributes.position.array], 3));
    jb.setAttribute('uv', new THREE.Float32BufferAttribute([...jet.attributes.uv.array, ...jet2.attributes.uv.array], 2));
    jb.setIndex([0, 2, 1, 2, 3, 1, 4, 6, 5, 6, 7, 5]);
    this.jets = new THREE.Mesh(jb, this.sideMat);
    for (const m of [this.star, this.side, this.jets]) { m.renderOrder = 5; m.frustumCulled = false; this.group.add(m); }
    this.group.visible = false;
    this.t = 0; this.life = 0.04; this.size = 1;
  }

  // size: Grundgröße · brake: Mündungsbremse · tint: Farbe
  fire(size, brake = false, shotgun = false) {
    this.t = 0;
    this.life = rand(0.035, 0.05) * (shotgun ? 1.25 : 1);
    this.size = size;
    const q = Math.floor(Math.random() * 4);
    this.starTex.offset.set((q % 2) * 0.5, Math.floor(q / 2) * 0.5);
    this.sideTex.offset.set(0, Math.random() < 0.5 ? 0 : 0.5);
    this.star.rotation.z = Math.random() * Math.PI * 2;
    const ss = size * rand(0.85, 1.25) * (shotgun ? 1.35 : 1);
    this.star.scale.set(ss * 0.16, ss * 0.16, 1);
    this.star.position.z = -0.012 * size;
    const len = size * rand(0.75, 1.3) * (shotgun ? 0.9 : 1) * (brake ? 0.55 : 1);
    this.side.scale.set(len * 0.075 * (shotgun ? 1.6 : 1), len * 0.075 * (shotgun ? 1.6 : 1), len * 0.24);
    this.side.rotation.z = (Math.random() - 0.5) * 0.6;
    this.jets.visible = brake;
    if (brake) { const j = size * rand(0.9, 1.2); this.jets.scale.set(j * 0.16, 1, j * 0.06); this.jets.position.z = 0.06; }
    this.group.visible = true;
  }

  update(dt) {
    if (!this.group.visible) return;
    this.t += dt;
    const k = this.t / this.life;
    if (k >= 1) { this.group.visible = false; return; }
    const f = k < 0.3 ? 1 : 1 - (k - 0.3) / 0.7;
    this.starMat.color.setRGB(3.2 * f, 2.3 * f, 1.5 * f);
    this.sideMat.color.setRGB(3.0 * f, 2.0 * f, 1.3 * f);
    const grow = 1 + k * 0.35;
    this.group.scale.setScalar(grow);
  }
}

// ── Laufrauch (Punkte in der Viewmodel-Szene) ─────────────────
const SMOKE_VS = /* glsl */`
  attribute float size; attribute float alpha; attribute float rot;
  varying float vA; varying float vR;
  uniform float uScale;
  void main(){
    vA = alpha; vR = rot;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * uScale / max(0.02, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const SMOKE_FS = /* glsl */`
  uniform sampler2D map; uniform vec3 uColor;
  varying float vA; varying float vR;
  void main(){
    vec2 c = gl_PointCoord - 0.5;
    float cs = cos(vR), sn = sin(vR);
    vec2 uv = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) + 0.5;
    float a = texture2D(map, clamp(uv, 0.0, 1.0)).r * vA;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor, a);
  }`;

export class BarrelSmoke {
  constructor(scene, max = 40) {
    this.max = max; this.n = 0;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.size = new Float32Array(max); this.alpha = new Float32Array(max); this.rot = new Float32Array(max);
    const dyn = (a, n) => new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', dyn(this.pos, 3));
    this.geo.setAttribute('size', dyn(this.size, 1));
    this.geo.setAttribute('alpha', dyn(this.alpha, 1));
    this.geo.setAttribute('rot', dyn(this.rot, 1));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: SMOKE_VS, fragmentShader: SMOKE_FS,
      uniforms: { map: { value: flashTextures().smoke }, uColor: { value: new THREE.Color(0.55, 0.53, 0.5) }, uScale: { value: 700 } },
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    scene.add(this.points);
    this.p = [];
    for (let i = 0; i < max; i++) this.p.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, s0: 0.02, s1: 0.1, a: 0.2, r: 0, vr: 0 });
  }

  spawn(at, strength = 1) {
    if (this.n >= this.max) return;
    const p = this.p[this.n++];
    p.x = at.x + rand(-0.004, 0.004); p.y = at.y + rand(-0.003, 0.004); p.z = at.z;
    p.vx = rand(-0.02, 0.03); p.vy = rand(0.05, 0.12) * (0.7 + strength * 0.3); p.vz = rand(-0.04, 0.0);
    p.life = 0; p.max = rand(0.9, 1.6);
    p.s0 = rand(0.012, 0.02); p.s1 = rand(0.07, 0.12) * (0.8 + strength * 0.3);
    p.a = rand(0.12, 0.22) * Math.min(1, 0.5 + strength * 0.4);
    p.r = rand(0, 6.28); p.vr = rand(-0.8, 0.8);
  }

  // lookX/lookY: Drehung der Kamera in diesem Frame (Rauch bleibt in der Welt zurück)
  update(dt, lookX, lookY, scale) {
    this.mat.uniforms.uScale.value = scale;
    let i = 0;
    while (i < this.n) {
      const p = this.p[i];
      p.life += dt;
      if (p.life >= p.max) { this.n--; this.p[i] = this.p[this.n]; this.p[this.n] = p; continue; }
      const d = Math.max(0.1, -p.z);
      p.x += p.vx * dt - lookX * d; p.y += p.vy * dt + lookY * d; p.z += p.vz * dt;
      p.vx += Math.sin(p.life * 5 + i) * 0.04 * dt; p.vy *= Math.exp(-0.6 * dt);
      p.r += p.vr * dt;
      const k = p.life / p.max;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      this.size[i] = p.s0 + (p.s1 - p.s0) * Math.sqrt(k);
      this.alpha[i] = p.a * Math.min(1, k * 6) * (1 - k) * (1 - k);
      this.rot[i] = p.r;
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    for (const a of ['position', 'size', 'alpha', 'rot']) this.geo.attributes[a].needsUpdate = true;
  }

  clear() { this.n = 0; this.geo.setDrawRange(0, 0); }
}

// ── Hülsen (Welt) ─────────────────────────────────────────────
// Arten: pistol (gerade), rifle (Flaschenhals), big (.50, skaliert), shell (Schrotpatrone)
function caseGeo(kind) {
  let pts;
  if (kind === 'pistol') pts = [[0.0, 0.0], [0.0059, 0.0], [0.006, 0.0012], [0.0052, 0.0016], [0.0054, 0.0024], [0.0058, 0.0028], [0.0058, 0.022], [0.0053, 0.0228], [0.0047, 0.0228]];
  else if (kind === 'rifle') pts = [[0.0, 0.0], [0.0048, 0.0], [0.0049, 0.0012], [0.0041, 0.0017], [0.0043, 0.003], [0.0047, 0.0035], [0.0045, 0.036], [0.0034, 0.039], [0.0032, 0.0445], [0.0028, 0.045]];
  else if (kind === 'hull') pts = [[0.0098, 0.012], [0.0102, 0.013], [0.0102, 0.066], [0.0085, 0.069], [0.004, 0.07], [0.0, 0.07]];
  else pts = [[0.0, 0.0], [0.0118, 0.0], [0.0118, 0.0018], [0.0106, 0.0022], [0.0106, 0.014], [0.0098, 0.0145]];
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 10);
  g.rotateX(-Math.PI / 2); // Achse entlang -z (Boden bei 0)
  g.translate(0, 0, 0.012);
  return g;
}

export class Casings {
  constructor(scene, M) {
    const brass = new THREE.MeshStandardMaterial({ color: 0xc8963c, roughness: 0.3, metalness: 0.9, envMapIntensity: 1.6 });
    const hull = new THREE.MeshStandardMaterial({ color: 0x8a1712, roughness: 0.45, metalness: 0.05 });
    const mk = (geo, mat, n) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0; m.visible = false; m.frustumCulled = false;
      m.userData.dynamic = true;
      m.castShadow = false; m.receiveShadow = false;
      scene.add(m);
      return m;
    };
    this.meshes = {
      pistol: mk(caseGeo('pistol'), brass, 40),
      rifle: mk(caseGeo('rifle'), brass, 48),
      shellBase: mk(caseGeo('base'), brass, 16),
      shellHull: mk(caseGeo('hull'), hull, 16),
    };
    this.list = [];
    this.pool = [];
    for (let i = 0; i < 100; i++) this.pool.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), quat: new THREE.Quaternion(), spin: new THREE.Vector3(), life: 0, kind: 'rifle', scale: 1, boost: 1, bounces: 0, rest: false });
    this.tinkT = 0;
    this.M = M;
  }

  // pos/vel/quat in Weltkoordinaten; boost: Startvergrößerung (Sichtfeld-Ausgleich)
  spawn(kind, pos, vel, quat, boost = 1) {
    const type = (k) => (k === 'big' ? 'rifle' : k);
    const t = type(kind);
    const cap = t === 'pistol' ? 40 : t === 'shell' ? 16 : 48;
    let count = 0, oldest = -1;
    for (let i = 0; i < this.list.length; i++) if (type(this.list[i].kind) === t) { if (oldest < 0) oldest = i; count++; }
    let c;
    if (count >= cap) c = this.list.splice(oldest, 1)[0]; // ältestes gleicher Art wiederverwenden
    else c = this.pool.pop() || this.list.shift();
    this.list.push(c);
    c.kind = kind; c.pos.copy(pos); c.vel.copy(vel); c.quat.copy(quat);
    c.spin.set(rand(-25, 25), rand(-8, 8), rand(-30, 30));
    c.life = 0; c.bounces = 0; c.rest = false;
    c.scale = kind === 'big' ? 2.2 : 1;
    c.boost = boost;
  }

  update(dt, g) {
    this.tinkT -= dt;
    const map = g.map;
    const counts = { pistol: 0, rifle: 0, shell: 0 };
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      c.life += dt;
      if (c.life > 3.2) { this.list.splice(i, 1); this.pool.push(c); continue; }
      if (!c.rest) {
        c.vel.y -= 11 * dt;
        const nx = c.pos.x + c.vel.x * dt, nz = c.pos.z + c.vel.z * dt;
        if (map && map.playerWalkable) {
          const cx0 = Math.floor(c.pos.x / 2), cz0 = Math.floor(c.pos.z / 2);
          if (Math.floor(nx / 2) !== cx0 && !map.playerWalkable(Math.floor(nx / 2), cz0)) c.vel.x *= -0.4;
          if (Math.floor(nz / 2) !== cz0 && !map.playerWalkable(cx0, Math.floor(nz / 2))) c.vel.z *= -0.4;
        }
        c.pos.addScaledVector(c.vel, dt);
        _ax.copy(c.spin).multiplyScalar(dt);
        const ang = _ax.length();
        if (ang > 1e-5) { _q.setFromAxisAngle(_ax.divideScalar(ang), ang); c.quat.premultiply(_q); }
        const floor = g.floorAt(c.pos) + 0.006 * c.scale;
        if (c.pos.y < floor) {
          c.pos.y = floor;
          const vy = -c.vel.y;
          if (vy > 0.6 && c.bounces < 2 && this.tinkT <= 0) {
            g.audio.shellTink && g.audio.shellTink(c.pos, c.kind);
            this.tinkT = 0.05;
          }
          c.bounces++;
          c.vel.y = vy * 0.32; c.vel.x *= 0.55; c.vel.z *= 0.55;
          c.spin.multiplyScalar(0.5);
          if (vy < 0.5) {
            // liegen bleiben: Achse waagrecht ausrichten
            c.rest = true; c.vel.set(0, 0, 0);
            _v.set(0, 0, -1).applyQuaternion(c.quat); _v.y = 0;
            if (_v.lengthSq() < 1e-4) _v.set(1, 0, 0);
            _v.normalize();
            c.quat.setFromUnitVectors(_s.set(0, 0, -1), _v);
          }
        }
      }
      counts[c.kind === 'big' ? 'rifle' : c.kind]++;
    }
    // Instanzen schreiben
    const idx = { pistol: 0, rifle: 0, shell: 0 };
    const M = this.meshes;
    for (const c of this.list) {
      const fade = c.life > 2.8 ? Math.max(0.001, 1 - (c.life - 2.8) / 0.4) : 1;
      const boost = c.boost + (1 - c.boost) * Math.min(1, c.life / 0.25);
      const s = c.scale * fade * boost;
      _m.compose(c.pos, c.quat, _s.set(s, s, s));
      if (c.kind === 'shell') { M.shellBase.setMatrixAt(idx.shell, _m); M.shellHull.setMatrixAt(idx.shell, _m); idx.shell++; }
      else if (c.kind === 'pistol') M.pistol.setMatrixAt(idx.pistol++, _m);
      else M.rifle.setMatrixAt(idx.rifle++, _m);
    }
    const set = (m, n) => { m.count = n; m.visible = n > 0; if (n) m.instanceMatrix.needsUpdate = true; };
    set(M.pistol, idx.pistol); set(M.rifle, idx.rifle); set(M.shellBase, idx.shell); set(M.shellHull, idx.shell);
  }

  clear() { while (this.list.length) this.pool.push(this.list.pop()); for (const m of Object.values(this.meshes)) { m.count = 0; m.visible = false; } }
}
