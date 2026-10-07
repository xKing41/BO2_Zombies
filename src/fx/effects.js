// Partikel, Decals, Tracer, Explosionen
import * as THREE from 'three';
import { rand } from '../core/utils.js';

const VS = /* glsl */`
  attribute float size; attribute float alpha; attribute vec3 pcolor;
  varying vec3 vC; varying float vA;
  uniform float uScale;
  void main(){
    vC = pcolor; vA = alpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * uScale / max(0.05, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const FS = /* glsl */`
  varying vec3 vC; varying float vA;
  uniform float uSoft;
  void main(){
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float a = (1.0 - smoothstep(uSoft, 0.5, d)) * vA;
    gl_FragColor = vec4(vC, a);
  }`;

class Particles {
  constructor(scene, max, additive, soft) {
    this.max = max;
    this.n = 0;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS,
      uniforms: { uScale: { value: 600 }, uSoft: { value: soft } },
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 10 : 9;
    scene.add(this.points);
    this.p = [];
    for (let i = 0; i < max; i++) this.p.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, s0: 1, s1: 1, a0: 1, r: 1, g: 1, b: 1, grav: 0, drag: 0, bounce: 0, fade: 1 });
  }

  spawn(o) {
    if (this.n >= this.max) return;
    const p = this.p[this.n++];
    p.x = o.x; p.y = o.y; p.z = o.z;
    p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0;
    p.life = 0; p.max = o.life || 1;
    p.s0 = o.size || 0.1; p.s1 = o.size1 ?? p.s0;
    p.a0 = o.alpha ?? 1;
    p.r = o.r ?? 1; p.g = o.g ?? 1; p.b = o.b ?? 1;
    p.grav = o.grav || 0; p.drag = o.drag || 0; p.bounce = o.bounce || 0;
    p.fade = o.fade ?? 1;
  }

  update(dt) {
    let i = 0;
    while (i < this.n) {
      const p = this.p[i];
      p.life += dt;
      if (p.life >= p.max) {
        this.n--;
        const last = this.p[this.n];
        this.p[this.n] = p;
        this.p[i] = last;
        continue;
      }
      const dr = Math.exp(-p.drag * dt);
      p.vx *= dr; p.vy = p.vy * dr - p.grav * dt; p.vz *= dr;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.02 && p.vy < 0) {
        p.y = 0.02;
        if (p.bounce > 0) { p.vy = -p.vy * p.bounce; p.vx *= 0.5; p.vz *= 0.5; } else { p.vy = 0; p.vx *= 0.2; p.vz *= 0.2; }
      }
      const k = p.life / p.max;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      this.col[i * 3] = p.r; this.col[i * 3 + 1] = p.g; this.col[i * 3 + 2] = p.b;
      this.size[i] = p.s0 + (p.s1 - p.s0) * k;
      this.alpha[i] = p.a0 * (p.fade ? 1 - k * k : 1);
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    for (const a of ['position', 'pcolor', 'size', 'alpha']) this.geo.attributes[a].needsUpdate = true;
  }
}

export class Effects {
  constructor(scene, M) {
    this.scene = scene;
    this.M = M;
    this.add = new Particles(scene, 2500, true, 0.0);
    this.norm = new Particles(scene, 2500, false, 0.15);
    this.time = 0;

    // Decal-Pools
    const bloodMats = M.tex.blood.map((t) => new THREE.MeshStandardMaterial({ map: t, transparent: true, depthWrite: false, roughness: 0.25, polygonOffset: true, polygonOffsetFactor: -4 }));
    this.bloodDecals = [];
    for (let i = 0; i < 48; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bloodMats[i % 3]);
      m.visible = false; m.receiveShadow = true;
      m.rotation.x = -Math.PI / 2;
      scene.add(m);
      this.bloodDecals.push(m);
    }
    this.bloodIdx = 0;
    const holeMat = new THREE.MeshBasicMaterial({ map: M.tex.hole, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.holes = [];
    for (let i = 0; i < 80; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.11), holeMat);
      m.visible = false;
      scene.add(m);
      this.holes.push(m);
    }
    this.holeIdx = 0;

    // Tracer
    const tg = new THREE.CylinderGeometry(0.006, 0.006, 1, 4, 1, true);
    tg.rotateX(Math.PI / 2); tg.translate(0, 0, 0.5);
    this.tracers = [];
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.2, 1.0), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false; m.userData.life = 0;
      scene.add(m);
      this.tracers.push(m);
    }
    this.tracerIdx = 0;

    // Feste Lichtquellen (Anzahl ändert sich nie → keine Shader-Neukompilierung)
    this.muzzleLight = new THREE.PointLight(0xffb060, 0, 10, 1.8);
    this.blastLight = new THREE.PointLight(0xff8840, 0, 22, 1.6);
    this.muzzleLight.userData.tier = 1;
    this.blastLight.userData.tier = 1;
    scene.add(this.muzzleLight, this.blastLight);
    this.muzzleT = 0;
    this.blastT = 0;

    // Leuchtende Staubpartikel in der Luft
    this.dustTimer = 0;
  }

  // Für eine neue Partie: Partikel, Decals und Lichter zurücksetzen
  reset() {
    for (const s of [this.add, this.norm]) { s.n = 0; s.geo.setDrawRange(0, 0); }
    for (const m of this.bloodDecals) m.visible = false;
    for (const m of this.holes) m.visible = false;
    for (const t of this.tracers) t.visible = false;
    this.muzzleLight.intensity = 0; this.blastLight.intensity = 0;
    this.muzzleT = 0; this.blastT = 0;
  }

  setScale(h, fov) {
    const s = h / (2 * Math.tan((fov * Math.PI) / 360));
    this.add.mat.uniforms.uScale.value = s;
    this.norm.mat.uniforms.uScale.value = s;
  }

  muzzle(pos, color = 0xffb060, power = 1) {
    this.muzzleLight.position.copy(pos);
    this.muzzleLight.color.set(color);
    this.muzzleLight.intensity = 9 * power;
    this.muzzleT = 0.055;
    for (let i = 0; i < 3; i++) this.norm.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: rand(-0.3, 0.3), vy: rand(0.2, 0.6), vz: rand(-0.3, 0.3), life: rand(0.6, 1.2), size: 0.06, size1: 0.35, alpha: 0.12, r: 0.6, g: 0.6, b: 0.6, drag: 1.5 });
  }

  tracer(from, to) {
    const m = this.tracers[this.tracerIdx++ % this.tracers.length];
    const len = from.distanceTo(to);
    if (len < 1.5) return;
    m.position.copy(from);
    m.lookAt(to);
    m.scale.set(1, 1, len);
    m.visible = true;
    m.userData.life = 0.06;
    m.material.opacity = 0.9;
  }

  blood(pos, dir, amount = 1, head = false) {
    const n = Math.floor((head ? 26 : 10) * amount);
    for (let i = 0; i < n; i++) {
      const s = head ? 3.5 : 2.2;
      this.norm.spawn({
        x: pos.x, y: pos.y, z: pos.z,
        vx: dir.x * rand(0.5, 2) + rand(-1, 1) * s * 0.5, vy: rand(0, s), vz: dir.z * rand(0.5, 2) + rand(-1, 1) * s * 0.5,
        life: rand(0.4, 0.9), size: rand(0.03, 0.09), size1: 0.02, alpha: 0.95,
        r: rand(0.25, 0.4), g: 0.01, b: 0.01, grav: 9.8, drag: 0.6, fade: 0,
      });
    }
    for (let i = 0; i < (head ? 6 : 3); i++) {
      this.norm.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: rand(-0.4, 0.4), vy: rand(-0.1, 0.4), vz: rand(-0.4, 0.4), life: rand(0.3, 0.6), size: 0.1, size1: rand(0.35, 0.6), alpha: 0.5, r: 0.3, g: 0.0, b: 0.0, drag: 3 });
    }
  }

  bloodDecal(x, z, scale = 1) {
    const m = this.bloodDecals[this.bloodIdx++ % this.bloodDecals.length];
    m.position.set(x, 0.008 + (this.bloodIdx % 48) * 0.0002, z);
    m.rotation.z = rand(0, Math.PI * 2);
    const s = rand(0.7, 1.3) * scale;
    m.scale.set(s, s, 1);
    m.visible = true;
  }

  impact(point, normal, mat) {
    const h = this.holes[this.holeIdx++ % this.holes.length];
    h.position.copy(point).addScaledVector(normal, 0.004);
    h.lookAt(point.x + normal.x, point.y + normal.y, point.z + normal.z);
    h.rotation.z = rand(0, 6);
    h.visible = mat !== 'flesh';
    const spark = mat === 'metal' ? 10 : 4;
    for (let i = 0; i < spark; i++) {
      this.add.spawn({
        x: point.x, y: point.y, z: point.z,
        vx: normal.x * rand(1, 4) + rand(-2, 2), vy: normal.y * rand(1, 4) + rand(0, 3), vz: normal.z * rand(1, 4) + rand(-2, 2),
        life: rand(0.15, 0.4), size: rand(0.015, 0.03), r: 3, g: 1.8, b: 0.7, grav: 12, bounce: 0.3,
      });
    }
    const dust = mat === 'stone' || mat === 'floor' || mat === 'ceiling';
    for (let i = 0; i < (dust ? 5 : 2); i++) {
      this.norm.spawn({
        x: point.x, y: point.y, z: point.z,
        vx: normal.x * rand(0.3, 1.2) + rand(-0.3, 0.3), vy: normal.y * rand(0.3, 1) + rand(0, 0.4), vz: normal.z * rand(0.3, 1.2) + rand(-0.3, 0.3),
        life: rand(0.5, 1.1), size: 0.04, size1: rand(0.2, 0.4), alpha: 0.16, r: 0.3, g: 0.28, b: 0.26, drag: 2.5, grav: -0.1,
      });
    }
  }

  explosion(pos, radius = 4, color = [3, 1.6, 0.5], energy = false) {
    this.blastLight.position.copy(pos).setY(Math.max(pos.y, 0.8));
    this.blastLight.color.setRGB(color[0] / 3, color[1] / 3, color[2] / 3);
    this.blastLight.intensity = 60;
    this.blastT = 0.45;
    const k = energy ? 0.45 : 1;
    for (let i = 0; i < (energy ? 24 : 40); i++) {
      const a = rand(0, Math.PI * 2), e = rand(-0.2, 1), s = rand(2, 9) * (radius / 4);
      this.add.spawn({ x: pos.x, y: pos.y + 0.2, z: pos.z, vx: Math.cos(a) * s, vy: e * s, vz: Math.sin(a) * s, life: rand(0.2, 0.5), size: rand(0.2, 0.5) * k, size1: 0.03, r: color[0] * k, g: color[1] * k, b: color[2] * k, drag: 3 });
    }
    for (let i = 0; i < 25; i++) {
      this.add.spawn({ x: pos.x, y: pos.y + 0.2, z: pos.z, vx: rand(-8, 8), vy: rand(2, 9), vz: rand(-8, 8), life: rand(0.5, 1.2), size: 0.03, r: 3, g: 2, b: 0.8, grav: 14, bounce: 0.3, drag: 0.5 });
    }
    for (let i = 0; i < 26; i++) {
      this.norm.spawn({ x: pos.x + rand(-0.5, 0.5), y: pos.y + rand(0, 0.8), z: pos.z + rand(-0.5, 0.5), vx: rand(-1.5, 1.5), vy: rand(0.5, 2.5), vz: rand(-1.5, 1.5), life: rand(1.5, 3), size: 0.5, size1: rand(1.8, 3.2), alpha: 0.45, r: 0.12, g: 0.11, b: 0.1, drag: 1.6, grav: -0.3 });
    }
  }

  // Energiepartikel (Strahlenkanone, Power-Ups)
  energy(pos, color, n = 2, spread = 0.1) {
    for (let i = 0; i < n; i++) {
      this.add.spawn({ x: pos.x + rand(-spread, spread), y: pos.y + rand(-spread, spread), z: pos.z + rand(-spread, spread), vx: rand(-0.4, 0.4), vy: rand(-0.2, 0.6), vz: rand(-0.4, 0.4), life: rand(0.2, 0.5), size: rand(0.05, 0.12), size1: 0.0, r: color[0], g: color[1], b: color[2], drag: 2 });
    }
  }

  ember(pos) {
    this.add.spawn({ x: pos.x + rand(-0.2, 0.2), y: pos.y, z: pos.z + rand(-0.2, 0.2), vx: rand(-0.2, 0.2), vy: rand(0.8, 2.0), vz: rand(-0.2, 0.2), life: rand(0.8, 2), size: rand(0.02, 0.04), r: 3, g: 1.2, b: 0.3, drag: 0.4 });
    if (Math.random() < 0.3) this.norm.spawn({ x: pos.x, y: pos.y + 0.3, z: pos.z, vx: rand(-0.1, 0.1), vy: rand(0.5, 1), vz: rand(-0.1, 0.1), life: rand(2, 3.5), size: 0.2, size1: 1.2, alpha: 0.18, r: 0.15, g: 0.14, b: 0.13, drag: 0.5 });
  }

  ambientDust(center) {
    this.add.spawn({ x: center.x + rand(-6, 6), y: rand(0.3, 3.5), z: center.z + rand(-6, 6), vx: rand(-0.05, 0.05), vy: rand(-0.03, 0.03), vz: rand(-0.05, 0.05), life: rand(4, 8), size: rand(0.008, 0.016), r: 0.5, g: 0.48, b: 0.42, alpha: 0.6, fade: 1 });
  }

  update(dt) {
    this.time += dt;
    this.add.update(dt);
    this.norm.update(dt);
    if (this.muzzleT > 0) { this.muzzleT -= dt; if (this.muzzleT <= 0) this.muzzleLight.intensity = 0; }
    if (this.blastT > 0) { this.blastT -= dt; this.blastLight.intensity = Math.max(0, (this.blastT / 0.45) * 60); }
    for (const t of this.tracers) {
      if (!t.visible) continue;
      t.userData.life -= dt;
      t.material.opacity = Math.max(0, t.userData.life / 0.06);
      if (t.userData.life <= 0) t.visible = false;
    }
  }
}
