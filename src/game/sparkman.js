// ─────────────────────────────────────────────────────────────
//  „Der Funkenmann“ (Linie 13): ein Wesen aus Elektrizität.
//  Kommt mit dem Gewitter, springt als Blitzkugel umher und entlädt
//  sich auf den Spieler. Kugeln verpuffen an ihm – nur das Messer
//  verletzt ihn. Setzt er sich aufs Busdach, bleibt der Bus stehen.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { zombieGeometries } from '../zombies/body.js';
import { rand, clamp, damp, dampAngle, smooth, raySphere } from '../core/utils.js';
import { CELL } from '../config.js';

const COLOR = [0.6, 1.5, 4.2];
const HP = 3;
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

// Körper aus Licht: dunkler Kern, leuchtende Kanten und wandernde Stromadern
function electricMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFade: { value: 1 } },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        vP = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uFade;
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
        float veins = smoothstep(0.9, 1.0, sin(vP.y * 48.0 + sin(vP.x * 37.0 + uTime * 9.0) * 3.0 + sin(vP.z * 29.0 - uTime * 7.0) * 2.0 + uTime * 16.0));
        float flick = 0.7 + 0.3 * sin(uTime * 41.0 + vP.y * 23.0);
        vec3 col = vec3(0.015, 0.04, 0.12) + vec3(0.6, 1.5, 4.2) * (f * 1.7 + veins * 1.1) * flick;
        if (uFade < 0.999) { float n = fract(sin(dot(floor(vP * 30.0), vec3(12.9898, 78.233, 45.164))) * 43758.5453); if (n > uFade) discard; }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

export class Sparkman {
  constructor(game) {
    this.g = game;
    this.mat = electricMaterial();
    this.build();
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 3.2, 7) }));
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: game.M.tex.glow, color: new THREE.Color(0.25, 0.6, 1.7), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.halo.scale.set(2.5, 2.5, 1);
    this.ball.add(this.halo.clone());
    for (const o of [this.root, this.ball]) { o.visible = false; o.userData.dynamic = true; game.scene.add(o); }
    this.root.add(this.halo);
    this.halo.position.y = 1.1;
    this.light = game.map.lightPool
      ? game.map.lightPool.add({ type: 'point', pos: new THREE.Vector3(), color: 0x6aa8ff, intensity: 0, distance: 11, offFactor: 1, dynamic: true })
      : null;
    this.navTarget = new THREE.Vector3();
    this.reset();
  }

  build() {
    const G = zombieGeometries(), m = this.mat;
    const mesh = (geo, parent, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.frustumCulled = false; parent.add(o); return o; };
    const bone = (parent, x = 0, y = 0, z = 0) => { const b = new THREE.Group(); b.position.set(x, y, z); parent.add(b); return b; };
    const root = (this.root = new THREE.Group());
    root.rotation.order = 'YXZ';
    root.scale.setScalar(1.14);
    const hips = (this.hips = bone(root, 0, 0.98, 0));
    mesh(G.pelvis, hips);
    const spine = (this.spine = bone(hips, 0, 0.06, 0));
    mesh(G.belly, spine, 0, 0.14, 0);
    mesh(G.torsoBare, spine, 0, 0.38, 0);
    this.chest = bone(spine, 0, 0.38, 0);
    const neck = (this.neck = bone(spine, 0, 0.6, 0));
    mesh(G.neck, neck);
    const head = (this.head = bone(neck, 0, 0.14, 0.018));
    mesh(G.head, head);
    this.arms = [-1, 1].map((s) => {
      const sh = bone(spine, s * 0.232, 0.51, -0.01);
      mesh(G.delt, sh, 0, -0.01, 0); mesh(G.upperArm, sh);
      const el = bone(sh, 0, -0.33, 0);
      mesh(G.foreArm, el);
      const hand = bone(el, 0, -0.29, 0);
      mesh(s < 0 ? G.handR : G.handL, hand);
      return { sh, el, hand };
    });
    this.legs = [-1, 1].map((s) => {
      const hp = bone(hips, s * 0.095, -0.05, 0);
      mesh(G.thigh, hp);
      const kn = bone(hp, 0, -0.45, 0);
      mesh(G.shin, kn);
      const ft = bone(kn, 0, -0.43, 0);
      mesh(G.foot, ft);
      return { hp, kn, ft };
    });
  }

  get pos() { return this.root.position; }

  reset() {
    this.state = 'hidden'; this.t = 0;
    this.root.visible = false; this.ball.visible = false;
    this.hp = HP;
    this.lastRound = 0; this.checkedRound = -1; this.planT = -1;
    this.teleT = 0; this.cd = 0; this.zapT = 0; this.shots = 0; this.knifeLatch = false; this.life = 0;
    this.seen = false;
    if (this.light) this.light.intensity = 0;
    if (this.g.bus) this.g.bus.boss = false;
  }

  dispose() { if (this.g.bus) this.g.bus.boss = false; }

  // Gültiger Bodenpunkt im Freien in Richtung/Entfernung um einen Mittelpunkt
  groundSpot(center, r0, r1, out) {
    const map = this.g.map;
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2, r = rand(r0, r1);
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      const cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
      const c = map.get(cx, cy);
      if (!c || c.type !== 'floor' || c.lava || !map.zombieWalkable(cx, cy)) continue;
      return out.set(x, 0, z);
    }
    return null;
  }

  // ── Auftritt ────────────────────────────────────────────────
  arrive() {
    const g = this.g;
    this.target = g.nearestSurvivor(g.spawnFocus());
    const p = this.groundSpot(this.target.pos, 16, 26, _v);
    if (!p) return;
    this.pos.copy(p);
    this.state = 'arrive'; this.t = 0;
    this.hp = HP; this.shots = 0; this.life = 0; this.roofDone = false;
    this.lastRound = g.round;
    this.storm();
  }

  // Gewitter beim Auftritt: Blitze aus dem Himmel, Donner, kurzer Lichtblitz
  storm() {
    const g = this.g;
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        if (this.state !== 'arrive') return;
        const top = _w.copy(this.pos).add(new THREE.Vector3(rand(-3, 3), 34, rand(-3, 3)));
        g.effects.lightning(top, this.pos.clone().setY(0.2), COLOR, 0.35, 0.09);
      }, i * 260);
    }
    g.flash = Math.max(g.flash, 0.35);
    g.audio.explosion(this.pos.clone().setY(6), 0.9);
    g.audio.teslaZap(this.pos);
    if (!this.seen) { this.seen = true; g.hud.notice('Ein Gewitter zieht auf …', 3000); }
  }

  leave(fast = false) {
    const g = this.g;
    this.state = 'leave'; this.t = fast ? 0.6 : 0;
    if (g.bus) g.bus.boss = false;
    g.audio.teslaZap(this.pos);
  }

  hurt(n) {
    const g = this.g;
    this.hp -= n;
    g.audio.teslaZap(this.pos);
    g.effects.energy(_v.copy(this.pos).setY(1.3), COLOR, 30, 0.4);
    if (this.hp <= 0) { this.die(); return; }
    this.teleport(); // getroffen: springt sofort weg
  }

  die() {
    const g = this.g;
    this.state = 'dying'; this.t = 0;
    if (g.bus) g.bus.boss = false;
    this.burst();
    g.addPoints(500, true, this.lastHitBy || g.me); // Belohnung für den, der ihn erledigt hat
    g.powerups.drop(this.pos.clone());
  }

  burst() {
    const g = this.g;
    const c = this.pos.clone().setY(1.2);
    g.effects.explosion(c, 3, [1.2, 2.8, 7], true);
    for (let i = 0; i < 6; i++) g.effects.lightning(c, c.clone().add(new THREE.Vector3(rand(-5, 5), rand(-1, 4), rand(-5, 5))), COLOR, 0.4, 0.12);
    g.audio.teslaShot(true);
    g.hud.notice('Der Funkenmann ist erloschen', 2600);
  }

  // Als Blitzkugel zu einem neuen Punkt springen
  teleport(to = null, next = 'hunt') {
    const g = this.g;
    const dest = to ? to.clone() : this.groundSpot((this.target || g.me).pos, 3.5, 7, new THREE.Vector3());
    if (!dest) return;
    this.ballFrom = this.pos.clone().setY(this.pos.y + 1.2);
    this.ballTo = dest.clone();
    this.ballNext = next;
    this.state = 'ball'; this.t = 0;
    this.ballDur = clamp(this.ballFrom.distanceTo(dest) / 22, 0.35, 0.9);
    this.teleT = rand(5, 9);
    g.audio.teslaZap(this.pos);
  }

  // Schüsse verpuffen in Funken; auf dem Busdach vertreiben genug Treffer ihn
  onShot(o, d, wallDist) {
    if (!['hunt', 'charge', 'roof'].includes(this.state)) return;
    const c = _v.copy(this.pos); c.y += (this.state === 'roof' ? 0.6 : 1.15);
    const t = raySphere(o, d, c, 0.55);
    if (t < 0 || t > wallDist) return;
    const g = this.g;
    const hit = o.clone().addScaledVector(d, t);
    g.effects.energy(hit, COLOR, 8, 0.12);
    if (Math.random() < 0.3) g.audio.teslaZap(hit);
    this.shots++;
    if (this.state === 'roof' && this.shots >= 12) { g.hud.notice('Der Funkenmann lässt den Bus los', 2200); this.teleport(null, 'hunt'); if (g.bus) g.bus.boss = false; }
    else if (this.state === 'hunt' && Math.random() < 0.08) this.teleport();
  }

  // ── Update ──────────────────────────────────────────────────
  update(dt, time, active) {
    const g = this.g;
    this.mat.uniforms.uTime.value = time;
    if (!active) { if (this.state !== 'hidden') this.reset(); return; }
    if (g.isClient) { this.view(dt, time); return; }
    // Ziel: nächster angreifbarer Spieler
    this.targetT = (this.targetT || 0) - dt;
    if (this.targetT <= 0 || !this.target || !this.target.targetable) { this.targetT = 0.5; this.target = g.nearestSurvivor(this.pos, this.target); }
    const player = this.target;
    if (g.net && this.state !== 'hidden') {
      this.netT = (this.netT || 0) - dt;
      if (this.netT <= 0) { this.netT = 0.1; g.net.fx(this.netState()); }
    }
    if (this.state === 'hidden') {
      if (g.state !== 'playing') return;
      if (g.round !== this.checkedRound) {
        this.checkedRound = g.round;
        const due = g.round >= 4 && g.round - this.lastRound >= 2;
        this.planT = due && Math.random() < 0.6 ? rand(12, 40) : -1;
      }
      if (this.planT > 0 && g.roundActive) { this.planT -= dt; if (this.planT <= 0) this.arrive(); }
      return;
    }
    this.t += dt;
    this.life += dt;
    if (!player.targetable || g.state === 'gameover') { if (this.state !== 'leave' && this.state !== 'dying') this.leave(); }
    else if (this.life > 75 && ['hunt', 'roof'].includes(this.state)) this.leave();

    // Messer: der einzige Weg, ihn zu verletzen
    const w = g.weapons;
    if (w.state !== 'knife') this.knifeLatch = false;
    else if (w.knifeHit && !this.knifeLatch) {
      this.knifeLatch = true;
      this.knifed(g.me, w.knifeLevel);
    }

    switch (this.state) {
      case 'arrive': {
        const k = smooth(clamp(this.t / 1.2, 0, 1));
        this.root.visible = true;
        this.mat.uniforms.uFade.value = k;
        if (this.t > 1.2) { this.state = 'hunt'; this.t = 0; this.teleT = rand(4, 7); this.cd = 1; }
        break;
      }
      case 'hunt': this.hunt(dt, time); break;
      case 'charge': {
        // Arme hoch, es knistert – dann Entladung
        if (Math.random() < 0.6) g.effects.lightning(_v.copy(this.pos).setY(2.3), this.arms[Math.random() < 0.5 ? 0 : 1].hand.getWorldPosition(_w), COLOR, 0.08, 0.15);
        this.face(player.pos, dt, 10);
        if (this.t > 0.55) {
          const d = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
          const hit = d < 3.4 && player.targetable;
          this.discharge(hit ? player : null);
          if (g.net) g.net.fx({ sp: 'zap', s: hit ? player.slot : -1 });
          if (hit) player.hurt(40, this.pos);
          this.state = 'hunt'; this.t = 0; this.cd = rand(1.8, 2.6);
        }
        break;
      }
      case 'ball': {
        const k = clamp(this.t / this.ballDur, 0, 1), e = smooth(k);
        this.root.visible = false;
        this.ball.visible = true;
        this.ball.position.lerpVectors(this.ballFrom, _v.copy(this.ballTo).setY(this.ballTo.y + 1.2), e);
        this.ball.position.y += Math.sin(k * Math.PI) * 1.5;
        this.ball.scale.setScalar(0.8 + Math.sin(time * 40) * 0.15);
        if (Math.random() < 0.8) g.effects.energy(this.ball.position, COLOR, 3, 0.2);
        if (Math.random() < 0.35) g.effects.lightning(this.ball.position, _w.copy(this.ball.position).add(new THREE.Vector3(rand(-1.5, 1.5), rand(-1.5, 0.5), rand(-1.5, 1.5))), COLOR, 0.08, 0.2);
        this.pos.copy(this.ballTo);
        if (k >= 1) {
          this.ball.visible = false;
          this.root.visible = true;
          this.mat.uniforms.uFade.value = 1;
          this.state = this.ballNext; this.t = 0;
          g.audio.teslaZap(this.pos);
        }
        break;
      }
      case 'roof': this.roof(dt, time); break;
      case 'leave':
      case 'dying': {
        const dur = this.state === 'dying' ? 0.5 : 1.2;
        const k = clamp(this.t / dur, 0, 1);
        this.mat.uniforms.uFade.value = 1 - k;
        if (this.state === 'leave' && Math.random() < 0.5) g.effects.lightning(_v.copy(this.pos).setY(1.2), _w.copy(this.pos).setY(30), COLOR, 0.12, 0.08);
        if (k >= 1) { this.root.visible = false; this.ball.visible = false; this.state = 'hidden'; this.lastRound = g.round; this.checkedRound = g.round; }
        break;
      }
    }
    this.animate(dt, time);
    // Licht und Knistern
    if (this.light) {
      this.light.pos.copy(this.ball.visible ? this.ball.position : _v.copy(this.pos).setY(this.pos.y + 1.4));
      this.light.intensity = this.root.visible || this.ball.visible ? 4 + Math.random() * 4 : 0;
    }
    this.zapT -= dt;
    if (this.zapT <= 0 && (this.root.visible || this.ball.visible)) {
      this.zapT = rand(0.7, 1.6);
      const p = this.ball.visible ? this.ball.position : _v.copy(this.pos).setY(this.pos.y + 1.2);
      if (this.root.visible && Math.random() < 0.6) g.effects.lightning(p, _w.copy(this.pos).add(new THREE.Vector3(rand(-1.2, 1.2), 0, rand(-1.2, 1.2))), COLOR, 0.1, 0.18);
      if (g.player.pos.distanceTo(p) < 30) g.audio.teslaZap(p);
    }
  }

  // Entladung sichtbar machen: Blitz zum Getroffenen (beim eigenen Spieler ins Gesicht)
  discharge(victim) {
    const g = this.g;
    let to;
    if (victim && victim.local) { const cam = g.camera.position; to = _w.set(cam.x, cam.y - 0.25, cam.z); g.player.shake = Math.max(g.player.shake, 0.6); g.flash = Math.max(g.flash, 0.2); }
    else if (victim) to = _w.copy(victim.pos).setY(victim.pos.y + 1.3);
    else to = _w.copy(this.pos).add(new THREE.Vector3(rand(-2, 2), 0, rand(-2, 2)));
    g.effects.lightning(this.chest.getWorldPosition(_v), to, COLOR, 0.25, 0.1);
    g.audio.teslaShot(false);
  }

  // Messertreffer (eigener oder – beim Host – von einem Mitspieler)
  knifed(by, level) {
    const dx = this.pos.x - by.pos.x, dz = this.pos.z - by.pos.z, d = Math.hypot(dx, dz);
    const fwd = (-Math.sin(by.yaw) * dx - Math.cos(by.yaw) * dz) / (d || 1);
    if (!['hunt', 'charge'].includes(this.state) || d > 2.6 || fwd < 0.4) return false;
    this.lastHitBy = by;
    this.hurt(level ? 2 : 1);
    return true;
  }

  // ── Koop ────────────────────────────────────────────────────
  netState() {
    const p = this.pos;
    return { sp: 'st', st: this.state, p: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)], ry: +this.root.rotation.y.toFixed(2), t: +this.t.toFixed(2), sd: +(this.speed || 0).toFixed(2),
      bf: this.ballFrom ? [this.ballFrom.x, this.ballFrom.y, this.ballFrom.z] : null, bt: this.ballTo ? [this.ballTo.x, this.ballTo.y, this.ballTo.z] : null, bd: this.ballDur || 0.5 };
  }

  netFx(d) {
    if (d.sp === 'zap') { const s = this.g.net && this.g.net.bySlot(d.s); this.discharge(s || null); return true; }
    if (d.sp !== 'st') return false;
    const g = this.g, prev = this.state;
    this.netPos = d.p; this.netRy = d.ry; this.speed = d.sd;
    if (d.st !== prev) {
      this.state = d.st; this.t = d.t;
      if (d.st === 'arrive') { this.pos.set(d.p[0], d.p[1], d.p[2]); this.storm(); this.mat.uniforms.uFade.value = 0; }
      if (d.st === 'ball' && d.bf && d.bt) { this.ballFrom = new THREE.Vector3(...d.bf); this.ballTo = new THREE.Vector3(...d.bt); this.ballDur = d.bd; g.audio.teslaZap(this.pos); }
      if (d.st === 'dying') this.burst();
      if (d.st === 'roof' && g.bus) g.bus.boss = true;
      if (prev === 'roof' && g.bus) g.bus.boss = false;
    }
    this.netSeen = performance.now();
    return true;
  }

  netRequest(kind, d, s) {
    if (kind !== 'spKnife') return undefined;
    return { ok: this.knifed(s, d.lvl) };
  }

  // Mitspieler: nur darstellen; eigene Messertreffer gehen an den Host
  view(dt, time) {
    const g = this.g;
    if (this.state === 'hidden') { this.root.visible = false; this.ball.visible = false; if (this.light) this.light.intensity = 0; return; }
    this.t += dt;
    if (this.netPos && this.state !== 'ball') {
      this.pos.x = damp(this.pos.x, this.netPos[0], 12, dt);
      this.pos.y = damp(this.pos.y, this.netPos[1], 12, dt);
      this.pos.z = damp(this.pos.z, this.netPos[2], 12, dt);
      this.root.rotation.y = this.netRy;
    }
    const w = g.weapons;
    if (w.state !== 'knife') this.knifeLatch = false;
    else if (w.knifeHit && !this.knifeLatch) {
      this.knifeLatch = true;
      const d = Math.hypot(this.pos.x - g.player.pos.x, this.pos.z - g.player.pos.z);
      if (d < 2.8) g.net.request('spKnife', { lvl: w.knifeLevel || 0 });
    }
    switch (this.state) {
      case 'arrive': this.root.visible = true; this.mat.uniforms.uFade.value = smooth(clamp(this.t / 1.2, 0, 1)); break;
      case 'hunt': case 'charge': case 'roof':
        this.root.visible = true; this.ball.visible = false; this.mat.uniforms.uFade.value = 1;
        if (this.state === 'charge' && Math.random() < 0.6) g.effects.lightning(_v.copy(this.pos).setY(2.3), this.arms[Math.random() < 0.5 ? 0 : 1].hand.getWorldPosition(_w), COLOR, 0.08, 0.15);
        break;
      case 'ball': {
        if (!this.ballFrom) break;
        const k = clamp(this.t / (this.ballDur || 0.5), 0, 1), e = smooth(k);
        this.root.visible = false; this.ball.visible = true;
        this.ball.position.lerpVectors(this.ballFrom, _v.copy(this.ballTo).setY(this.ballTo.y + 1.2), e);
        this.ball.position.y += Math.sin(k * Math.PI) * 1.5;
        this.ball.scale.setScalar(0.8 + Math.sin(time * 40) * 0.15);
        if (Math.random() < 0.8) g.effects.energy(this.ball.position, COLOR, 3, 0.2);
        if (k >= 1) this.pos.copy(this.ballTo);
        break;
      }
      case 'leave': case 'dying': {
        const k = clamp(this.t / (this.state === 'dying' ? 0.5 : 1.2), 0, 1);
        this.mat.uniforms.uFade.value = 1 - k;
        if (k >= 1) { this.root.visible = false; this.ball.visible = false; }
        break;
      }
    }
    this.animate(dt, time);
    if (this.light) {
      this.light.pos.copy(this.ball.visible ? this.ball.position : _v.copy(this.pos).setY(this.pos.y + 1.4));
      this.light.intensity = this.root.visible || this.ball.visible ? 4 + Math.random() * 4 : 0;
    }
  }

  face(target, dt, rate = 6) {
    const want = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
    this.root.rotation.y = dampAngle(this.root.rotation.y, want, rate, dt);
  }

  hunt(dt, time) {
    const g = this.g, player = this.target || g.me, map = g.map;
    const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z, dist = Math.hypot(dx, dz);
    this.cd -= dt; this.teleT -= dt;
    // Spieler fährt Bus: aufs Dach springen und den Bus anhalten
    const bus = g.bus;
    if (bus && bus.anyOn && bus.v > 2.5 && !this.roofDone && Math.hypot(bus.pos.x - this.pos.x, bus.pos.z - this.pos.z) < 32) {
      this.roofDone = true;
      this.roofLocal = new THREE.Vector3(0, 3.1, rand(-3.5, 1.5));
      this.teleport(bus.toWorld(this.roofLocal, new THREE.Vector3()).setY(3.1), 'roof');
      this.shots = 0;
      return;
    }
    if (dist < 2.2 && this.cd <= 0 && player.targetable && Math.abs(player.pos.y - this.pos.y) < 1.5) { this.state = 'charge'; this.t = 0; g.audio.teslaZap(this.pos); return; }
    if ((this.teleT <= 0 && dist > 4) || dist > 18) { this.teleport(); return; }
    // schwebender, ruckartiger Gang zum Spieler (Flow-Field der Zombies)
    if (dist < 12 && map.clearPath(this.pos, player.pos, 0.3)) this.navTarget.copy(player.pos);
    else g.zombies.pathTarget(this.pos, this.navTarget, player.pos);
    const tx = this.navTarget.x - this.pos.x, tz = this.navTarget.z - this.pos.z, td = Math.hypot(tx, tz) || 1;
    const sp = (dist < 1.6 ? 0 : 3.0) * (0.7 + 0.5 * Math.max(0, Math.sin(time * 6)));
    this.pos.x += (tx / td) * sp * dt;
    this.pos.z += (tz / td) * sp * dt;
    this.pos.y = g.floorAt(this.pos);
    map.collide(this.pos, 0.3, (x, y) => map.zombieWalkable(x, y), true);
    this.speed = sp;
    this.face(player.pos, dt);
  }

  roof(dt, time) {
    const g = this.g, bus = g.bus;
    if (!bus) { this.leave(); return; }
    bus.boss = true;
    bus.toWorld(this.roofLocal, this.pos);
    this.pos.y = 3.1;
    this.root.rotation.y = bus.yaw + Math.sin(time * 0.7) * 0.6;
    if (this.t < 0.1 && !this.said) { this.said = true; bus.say('boss', {}, true); }
    // Funken springen auf die Karosserie über
    if (Math.random() < 0.25) g.effects.lightning(_v.copy(this.pos).setY(3.5), bus.toWorld(new THREE.Vector3(rand(-1.2, 1.2), rand(0.4, 2.8), rand(-5, 3.5)), _w), COLOR, 0.08, 0.2);
    // Fahrgäste bekommen gelegentlich einen Schlag ab
    this.cd -= dt;
    if (bus.anyOn && this.cd <= 0) {
      this.cd = rand(3.5, 5);
      for (const s of g.survivors) {
        if (!s.onBus || !s.targetable) continue;
        this.discharge(s);
        if (g.net) g.net.fx({ sp: 'zap', s: s.slot });
        s.hurt(20, this.pos);
      }
    }
    if (this.t > 16) { this.said = false; bus.boss = false; this.teleport(null, 'hunt'); }
  }

  // ── Animation: schwebend, zuckend, Arme voller Strom ────────
  animate(dt, time) {
    if (!this.root.visible) return;
    const A = this.arms, L = this.legs;
    const charge = this.state === 'charge' ? smooth(clamp(this.t / 0.45, 0, 1)) : 0;
    const roof = this.state === 'roof';
    const ph = time * 7;
    const mv = clamp((this.speed || 0) / 3, 0, 1) * (this.state === 'hunt' ? 1 : 0);
    const twitch = () => (Math.random() < 0.08 ? (Math.random() - 0.5) * 0.4 : 0);
    this.hips.position.y = roof ? 0.6 : 0.98 + Math.sin(time * 2.2) * 0.04 + 0.08;
    this.spine.rotation.set((roof ? 0.6 : 0.18) - charge * 0.35 + twitch(), Math.sin(time * 1.3) * 0.15, twitch());
    this.neck.rotation.set(-0.2 + charge * -0.4 + twitch(), Math.sin(time * 0.9) * 0.4, twitch());
    const reach = roof ? -1.2 : -0.7 - charge * 1.9;
    A[0].sh.rotation.set(reach + Math.sin(ph) * 0.3 * mv + twitch(), 0, 0.35 + charge * 0.5);
    A[1].sh.rotation.set(reach - Math.sin(ph) * 0.3 * mv + twitch(), 0, -0.35 - charge * 0.5);
    A[0].el.rotation.x = -0.5 - twitch(); A[1].el.rotation.x = -0.5 - twitch();
    const lg = roof ? -1.4 : Math.sin(ph) * 0.45 * mv;
    L[0].hp.rotation.x = lg; L[1].hp.rotation.x = roof ? -1.2 : -lg;
    L[0].kn.rotation.x = roof ? 1.9 : 0.15 + Math.max(0, Math.cos(ph)) * 0.6 * mv;
    L[1].kn.rotation.x = roof ? 1.7 : 0.15 + Math.max(0, -Math.cos(ph)) * 0.6 * mv;
  }
}
