// ─────────────────────────────────────────────────────────────
//  Gefahren auf Linie 13:
//   • Glutfelder: verbrennen Spieler; Zombies fangen Feuer und
//     zerplatzen beim Tod in einer Flammenwolke.
//   • Nebelkriecher: lauern im Nebel zwischen den Stationen, springen
//     dem Spieler ins Gesicht – mit dem Messer abschütteln.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { rand, clamp, damp, dampAngle } from '../core/utils.js';

const MAX_CRAWLERS = 2;
const _v = new THREE.Vector3();

export class Hazards {
  constructor(game) {
    this.g = game;
    this.crawlers = [];
    for (let i = 0; i < MAX_CRAWLERS; i++) this.crawlers.push(this.buildCrawler(game.M, i));
    this.reset();
  }

  reset() {
    this.burnT = 0;
    this.fogT = 0;
    this.spawnCd = 8;
    this.latched = null;
    this.shakes = 0;
    for (const c of this.crawlers) { c.active = false; c.group.visible = false; }
    this.g.hud.latch(false);
  }

  // ── Nebelkriecher: Modell ───────────────────────────────────
  buildCrawler(M) {
    const g = new THREE.Group();
    g.userData.dynamic = true;
    g.visible = false;
    const skin = new THREE.MeshStandardMaterial({ color: 0x1b1a1f, roughness: 0.55, metalness: 0.1 });
    const eye = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.5, 3.2, 0.6) });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 10), skin);
    body.scale.set(0.9, 0.7, 1.3); body.position.y = 0.45; body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), skin);
    head.position.set(0, 0.55, 0.38); head.scale.set(1, 0.8, 1.1);
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.06), new THREE.MeshBasicMaterial({ color: 0x400808 }));
    mouth.position.set(0, -0.06, 0.15); head.add(mouth);
    for (const x of [-0.07, 0.07]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), eye); e.position.set(x, 0.04, 0.15); head.add(e); }
    g.add(body, head);
    const limbs = [];
    for (const [x, z] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const piv = new THREE.Group(); piv.position.set(x * 0.18, 0.45, z * 0.22);
      const up = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.025, 0.42, 6), skin);
      up.position.set(x * 0.18, 0, 0); up.rotation.z = x * 1.1; piv.add(up);
      const lo = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.012, 0.48, 6), skin);
      lo.position.set(x * 0.38, -0.25, 0); lo.rotation.z = -x * 0.35; piv.add(lo);
      g.add(piv);
      limbs.push(piv);
    }
    this.g.scene.add(g);
    return { group: g, head, limbs, active: false, pos: g.position, yaw: 0, t: 0, state: 'run', speed: 6.5, phase: 0, hp: 1 };
  }

  // Ist der Spieler gerade im Nebel (kein Gebäude, keine Station, nicht im Bus)?
  inFog() {
    const g = this.g, p = g.player.pos;
    if (g.bus && g.bus.playerOn) return false;
    if (p.y > 0.3) return false;
    const c = g.map.cellAt(p.x, p.z);
    if (!c || g.map.hasCeiling(c)) return false;
    return !g.map.stationAt(p.x, p.z);
  }

  spawnCrawler() {
    const c = this.crawlers.find((x) => !x.active);
    if (!c) return;
    const g = this.g, p = g.player.pos, map = g.map;
    for (let i = 0; i < 20; i++) {
      // hinter dem Spieler im Nebel
      const a = g.player.yaw + rand(-1.2, 1.2);
      const r = rand(11, 16);
      const x = p.x + Math.sin(a) * r, z = p.z + Math.cos(a) * r;
      const cell = map.cellAt(x, z);
      if (!cell || cell.type !== 'floor' || map.hasCeiling(cell) || map.stationAt(x, z)) continue;
      c.active = true; c.state = 'run'; c.t = 0; c.hp = 1;
      c.pos.set(x, 0, z);
      c.group.visible = true;
      c.group.rotation.set(0, 0, 0);
      g.audio.crawlerScreech(c.pos);
      return;
    }
  }

  killCrawler(c, points = true) {
    const g = this.g;
    c.active = false;
    c.group.visible = false;
    g.effects.blood(c.pos.clone().setY(0.5), new THREE.Vector3(0, 1, 0), 1.2, false);
    g.effects.bloodDecal(c.pos.x, c.pos.z, 0.6);
    g.audio.crawlerDeath(c.pos);
    if (points) g.addPoints(50);
    if (this.latched === c) { this.latched = null; g.hud.latch(false); }
  }

  // Schuss trifft Nebelkriecher (vom Waffensystem aufgerufen). Jeder Spieler hat
  // seine eigenen Nebelkriecher – Schüsse von Mitspielern treffen sie nicht.
  onShot(o, d, maxDist, shooter) {
    if (shooter && !shooter.local) return;
    for (const c of this.crawlers) {
      if (!c.active || c === this.latched) continue;
      _v.copy(c.pos).setY(0.45).sub(o);
      const t = _v.dot(d);
      if (t < 0 || t > maxDist) continue;
      if (_v.addScaledVector(d, -t).length() < 0.42) { this.killCrawler(c); this.g.hud.hitmarker(false); }
    }
  }

  // ── Laufzeit ────────────────────────────────────────────────
  update(dt, time, active) {
    const g = this.g, p = g.player, map = g.map;
    if (!active || g.state !== 'playing') return;

    // Glutfelder: Spieler
    if (p.pos.y < 0.15 && map.isLava(p.pos.x, p.pos.z) && !p.downed) {
      this.burnT -= dt;
      p.speedMul = Math.min(p.speedMul, 0.8);
      if (this.burnT <= 0) {
        this.burnT = 0.35;
        p.damage(11, null);
        g.audio.lavaSizzle();
        for (let i = 0; i < 4; i++) g.effects.ember(_v.set(p.pos.x + rand(-0.4, 0.4), 0.2, p.pos.z + rand(-0.4, 0.4)));
      }
    }
    // Zombies fangen Feuer
    for (const z of g.zombies.pool) {
      if (!z.alive) continue;
      if (!g.isClient && !z.onBus && z.pos.y < 0.2 && map.isLava(z.pos.x, z.pos.z)) {
        if (!z.burning) g.audio.ignite(z.pos);
        z.burning = 12;
      }
      if (z.burning > 0) {
        z.burning = Math.max(0, z.burning - dt);
        if (Math.random() < 0.6) g.effects.ember(_v.set(z.pos.x + rand(-0.25, 0.25), z.pos.y + rand(0.4, 1.6), z.pos.z + rand(-0.25, 0.25)));
      }
    }

    // Nebelkriecher
    const fog = this.inFog();
    this.fogT = fog ? this.fogT + dt : 0;
    this.spawnCd -= dt;
    if (fog && this.fogT > 4 && this.spawnCd <= 0 && g.round >= 1) {
      this.spawnCd = rand(9, 16);
      this.spawnCrawler();
    }
    for (const c of this.crawlers) if (c.active) this.updateCrawler(c, dt, time, fog);
  }

  updateCrawler(c, dt, time, fog) {
    const g = this.g, p = g.player, cam = g.camera;
    c.t += dt;
    if (c === this.latched) {
      // klebt im Gesicht: vor der Kamera halten
      cam.getWorldDirection(_v);
      c.pos.copy(cam.position).addScaledVector(_v, 0.42);
      c.pos.y -= 0.5;
      c.group.rotation.set(-0.6, Math.atan2(-_v.x, -_v.z), Math.sin(time * 30) * 0.2);
      for (const [i, l] of c.limbs.entries()) l.rotation.x = Math.sin(time * 25 + i) * 0.5;
      p.speedMul = Math.min(p.speedMul, 0.45);
      c.biteT = (c.biteT || 0) - dt;
      if (c.biteT <= 0) { c.biteT = 0.5; p.damage(7, null); g.audio.crawlerBite(); }
      if (g.input.hit('knife')) {
        this.shakes++;
        p.shake = Math.max(p.shake, 0.35);
        g.audio.knife();
        if (this.shakes >= 3) { this.killCrawler(c); g.hud.notice('Abgeschüttelt!', 1500); }
      }
      g.hud.prompt(`Schüttel ihn ab: ${g.input.device === 'pad' ? 'LB / L1' : g.input.device === 'touch' ? 'Messer' : 'V'} (${3 - this.shakes}×)`);
      if (p.downed) { this.killCrawler(c, false); }
      return;
    }
    // Rückzug aus sicheren Bereichen
    if (!fog && c.t > 1) {
      c.state = 'flee';
    }
    const dx = p.pos.x - c.pos.x, dz = p.pos.z - c.pos.z, d = Math.hypot(dx, dz);
    let tx = dx, tz = dz;
    if (c.state === 'flee') { tx = -dx; tz = -dz; if (d > 22) { c.active = false; c.group.visible = false; return; } }
    const l = Math.hypot(tx, tz) || 1;
    // Zickzack-Sprünge
    const zig = Math.sin(c.t * 5) * 0.5;
    const vx = (tx / l) + (-tz / l) * zig, vz = (tz / l) + (tx / l) * zig;
    const vl = Math.hypot(vx, vz) || 1;
    c.pos.x += (vx / vl) * c.speed * dt;
    c.pos.z += (vz / vl) * c.speed * dt;
    g.map.collide(c.pos, 0.25, (x, y) => g.map.zombieWalkable(x, y), true);
    c.pos.y = Math.abs(Math.sin(c.t * 9)) * 0.18;
    c.yaw = dampAngle(c.yaw, Math.atan2(vx, vz), 10, dt);
    c.group.rotation.set(0.15, c.yaw, 0);
    for (const [i, lb] of c.limbs.entries()) lb.rotation.x = Math.sin(c.t * 16 + i * Math.PI * 0.5) * 0.7;
    if (Math.random() < dt * 0.6) g.audio.crawlerChatter(c.pos);
    // Ansprung
    if (c.state === 'run' && d < 1.4 && !p.downed && !this.latched) {
      this.latched = c;
      this.shakes = 0;
      g.hud.latch(true);
      g.audio.crawlerLatch();
      p.shake = Math.max(p.shake, 0.8);
    }
  }

  // Brennende Zombies zerplatzen in einer Feuerwolke
  onKill(z) {
    if (!z.burning) return;
    const g = this.g, pos = z.pos.clone().setY(1.0);
    z.burning = 0;
    this.fireBurst(pos);
    if (g.net) g.net.ev({ t: 'fire', p: [+pos.x.toFixed(2), +pos.y.toFixed(2), +pos.z.toFixed(2)] });
    // Die Flammenwolke trifft alle Spieler in der Nähe
    for (const s of g.survivors) if (s.targetable && Math.hypot(s.pos.x - pos.x, s.pos.z - pos.z) < 2.4) s.hurt(18, pos);
    for (const o of g.zombies.inRadius(pos, 2.4)) if (o !== z) g.zombies.damage(o, 120 + g.round * 25, 'torso', { dir: new THREE.Vector3(o.pos.x - pos.x, 0.4, o.pos.z - pos.z).normalize(), explosive: true });
  }

  fireBurst(pos) {
    this.g.effects.explosion(pos, 2.4, [3, 1.1, 0.25]);
    this.g.audio.fireBurst(pos);
  }

  netEvent(e) {
    if (e.t !== 'fire') return false;
    this.fireBurst(new THREE.Vector3(e.p[0], e.p[1], e.p[2]));
    return true;
  }

  dispose() {}
}
