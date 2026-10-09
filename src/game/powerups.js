// ─────────────────────────────────────────────────────────────
//  Power-Ups wie in den Treyarch-Zombies:
//  - Drop-Logik: Erreichen die insgesamt verdienten Punkte eine Schwelle
//    (erst 2000 über dem Start, danach jeweils das 1,14-Fache mehr),
//    lässt der nächste getötete Zombie ein Power-Up fallen. Dazu kommt
//    eine kleine Zufallschance je Kill; höchstens 4 Drops pro Runde.
//  - Reihenfolge: gemischter Zyklus, jedes Power-Up kommt einmal dran,
//    bevor neu gemischt wird (Bedingungen: Zimmermann nur bei kaputten
//    Fenstern, Ausverkauf erst, nachdem die Kiste umgezogen ist).
//  - Am Boden: 15 s ruhig, dann immer schnelleres Blinken, nach 26,5 s weg.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import * as T from '../core/textures.js';
import { POINTS, CELL } from '../config.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TYPES = ['maxammo', 'instakill', 'double', 'nuke', 'carpenter', 'firesale'];
const TIMED = ['instakill', 'double', 'firesale'];
const DROP_INCREMENT = 2000, DROP_GROWTH = 1.14, RANDOM_CHANCE = 0.03, MAX_PER_ROUND = 4;
const SOLID_TIME = 15, LIFETIME = 26.5;

// ── 3D-Modelle (goldglänzend, grün umflort) ─────────────────
function shapeGeo(shape, depth = 0.06) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 2, curveSegments: 10 });
  g.center();
  return g;
}

const flat = (g) => (g.index ? g.toNonIndexed() : g);

function powerupGeometry(type) {
  const parts = [];
  const box = (w, h, d, x = 0, y = 0, z = 0, rz = 0) => { const b = new THREE.BoxGeometry(w, h, d); b.rotateZ(rz); b.translate(x, y, z); parts.push(flat(b)); };
  const cyl = (r0, r1, h, x = 0, y = 0, z = 0, seg = 14) => { const c = new THREE.CylinderGeometry(r0, r1, h, seg); c.translate(x, y, z); parts.push(flat(c)); };
  const sph = (r, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => { const s = new THREE.SphereGeometry(r, 16, 12); s.scale(sx, sy, sz); s.translate(x, y, z); parts.push(flat(s)); };
  switch (type) {
    case 'maxammo': { // Munitionskiste mit drei Patronen
      box(0.5, 0.26, 0.28, 0, -0.12, 0);
      box(0.52, 0.04, 0.3, 0, 0.02, 0);
      for (let i = -1; i <= 1; i++) { cyl(0.045, 0.045, 0.2, i * 0.13, 0.13, 0); const t = new THREE.ConeGeometry(0.045, 0.09, 14); t.translate(i * 0.13, 0.275, 0); parts.push(flat(t)); }
      break;
    }
    case 'instakill': { // Totenkopf
      sph(0.2, 0, 0.06, 0, 0.92, 1, 0.95);
      box(0.2, 0.1, 0.16, 0, -0.14, 0.04);
      for (let i = -2; i <= 2; i++) box(0.03, 0.05, 0.04, i * 0.04, -0.2, 0.1);
      break;
    }
    case 'double': { // „x2“
      box(0.07, 0.34, 0.07, -0.17, 0, 0, 0.65); box(0.07, 0.34, 0.07, -0.17, 0, 0, -0.65);
      const s = new THREE.Shape();
      s.moveTo(-0.11, 0.08); s.bezierCurveTo(-0.1, 0.2, 0.1, 0.22, 0.11, 0.09); s.bezierCurveTo(0.12, 0.0, 0.0, -0.06, -0.08, -0.12);
      s.lineTo(0.12, -0.12); s.lineTo(0.12, -0.19); s.lineTo(-0.15, -0.19); s.lineTo(-0.15, -0.13);
      s.bezierCurveTo(-0.02, -0.03, 0.05, 0.02, 0.04, 0.08); s.bezierCurveTo(0.03, 0.15, -0.04, 0.15, -0.05, 0.08); s.closePath();
      const g2 = shapeGeo(s, 0.07); g2.translate(0.12, 0, 0); parts.push(flat(g2));
      break;
    }
    case 'nuke': { // Bombe mit Leitwerk
      sph(0.15, 0, 0, 0, 1, 1.5, 1);
      cyl(0.05, 0.1, 0.16, 0, 0.27, 0);
      for (let i = 0; i < 4; i++) { const f = new THREE.BoxGeometry(0.02, 0.16, 0.14); f.translate(0, 0.32, 0.07); f.rotateY((i * Math.PI) / 2); parts.push(flat(f)); }
      const ring = new THREE.TorusGeometry(0.1, 0.015, 8, 20); ring.rotateX(Math.PI / 2); ring.translate(0, 0.36, 0); parts.push(flat(ring));
      break;
    }
    case 'carpenter': { // Hammer
      box(0.05, 0.42, 0.05, 0, -0.06, 0);
      box(0.28, 0.08, 0.08, 0.02, 0.17, 0);
      const claw = new THREE.ConeGeometry(0.04, 0.12, 8); claw.rotateZ(-Math.PI / 2); claw.translate(-0.17, 0.17, 0); parts.push(flat(claw));
      break;
    }
    case 'firesale': { // Flamme mit Preisschild
      const s = new THREE.Shape();
      s.moveTo(0, -0.22); s.bezierCurveTo(0.18, -0.22, 0.2, -0.02, 0.12, 0.08); s.bezierCurveTo(0.1, 0.0, 0.06, 0.02, 0.06, 0.08);
      s.bezierCurveTo(0.06, 0.16, 0.0, 0.2, 0.02, 0.28); s.bezierCurveTo(-0.1, 0.2, -0.12, 0.1, -0.08, 0.02);
      s.bezierCurveTo(-0.12, 0.04, -0.16, 0.0, -0.15, -0.06); s.bezierCurveTo(-0.15, -0.16, -0.08, -0.22, 0, -0.22);
      parts.push(flat(shapeGeo(s, 0.07)));
      box(0.14, 0.09, 0.02, 0.0, -0.08, 0.06);
      break;
    }
  }
  const g = mergeGeometries(parts.map((p) => { if (!p.attributes.uv) p.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(p.attributes.position.count * 2), 2)); return p; }));
  g.computeVertexNormals();
  return g;
}

export class PowerUps {
  constructor(game) {
    this.g = game;
    this.items = [];
    this.timers = { instakill: 0, double: 0, firesale: 0 };
    this.icons = {};
    for (const t of TYPES) this.icons[t] = T.powerupIcon(t);
    const M = game.M;
    this.mat = new THREE.MeshStandardMaterial({ color: 0xe0b04a, metalness: 0.75, roughness: 0.28, emissive: 0x3c6a18, emissiveIntensity: 0.55, envMapIntensity: 1.5 });
    this.geos = Object.fromEntries(TYPES.map((t) => [t, powerupGeometry(t)]));
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      const model = new THREE.Mesh(this.geos.maxammo, this.mat);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.tex.glow, color: new THREE.Color(0.15, 0.9, 0.15), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      halo.scale.set(1.7, 1.7, 1);
      g.add(halo, model);
      g.visible = false;
      g.userData.dynamic = true;
      game.scene.add(g);
      this.items.push({ group: g, model, halo, active: false, type: null, t: 0 });
    }
    this.reset();
  }

  get instaKill() { return this.timers.instakill > 0; }
  get double() { return this.timers.double > 0; }
  get fireSale() { return this.timers.firesale > 0; }

  // Punkte-Schwelle überwachen (game.stats.earned zählt alle verdienten Punkte)
  watchScore() {
    const earned = this.g.stats.earned || 0;
    if (earned > this.scoreToDrop) {
      this.increment *= DROP_GROWTH;
      this.scoreToDrop = earned + this.increment;
      this.dropFlag = true;
    }
  }

  onKill(pos, opts) {
    if (opts.nuke || this.dropsThisRound >= MAX_PER_ROUND) return;
    // nur innerhalb der spielbaren Fläche (nicht draußen vor den Fenstern)
    const map = this.g.map, c = map.cellAt(pos.x, pos.z);
    if (!c || !map.playerWalkable(Math.floor(pos.x / CELL), Math.floor(pos.z / CELL))) return;
    const random = Math.random() < RANDOM_CHANCE;
    if (!random && !this.dropFlag) return;
    if (!random) this.dropFlag = false;
    this.drop(pos);
  }

  // Nächstes Power-Up aus dem gemischten Zyklus, dessen Bedingung erfüllt ist
  nextType() {
    const box = this.g.interact && this.g.interact.box;
    const ok = (t) => {
      if (t === 'carpenter') return this.g.map.windows.some((w) => w.boards < 5);
      if (t === 'firesale') return !!box && box.moves > 0 && !this.fireSale && box.state !== 'leaving' && box.state !== 'moving';
      return true;
    };
    for (let tries = 0; tries < TYPES.length * 2; tries++) {
      if (this.cycleIdx >= this.cycle.length) this.shuffle();
      const t = this.cycle[this.cycleIdx++];
      if (ok(t)) return t;
    }
    return 'maxammo';
  }

  shuffle() {
    this.cycle = [...TYPES].sort(() => Math.random() - 0.5);
    this.cycleIdx = 0;
  }

  drop(pos, type = null) {
    const it = this.items.find((x) => !x.active);
    if (!it) return;
    type = type || this.nextType();
    it.active = true; it.type = type; it.t = 0;
    it.model.geometry = this.geos[type];
    it.group.position.set(pos.x, 1.0, pos.z);
    it.group.visible = true;
    this.dropsThisRound++;
    this.g.audio.powerupSpawn(it.group.position);
    this.stopLoop(it);
    it.loop = this.g.audio.powerupLoop(it.group.position.clone()); // schwebendes Summen
    it.blink = 1;
  }

  stopLoop(it) {
    if (it.loop) { it.loop.stop(); it.loop = null; }
  }

  apply(type) {
    const g = this.g;
    g.audio.powerupGrab(type);
    g.hud.powerupBanner(type);
    switch (type) {
      case 'maxammo': g.weapons.refillAll(); break;
      case 'instakill': this.timers.instakill = 30; break;
      case 'double': this.timers.double = 30; break;
      case 'firesale': this.timers.firesale = 30; g.interact.fireSale(true); break;
      case 'nuke':
        g.flash = 1;
        g.audio.explosion(g.player.pos.clone().setY(8), 1.6);
        g.zombies.killAll({ explosive: true });
        g.addPoints(POINTS.nuke, true);
        g.player.shake = 0.8;
        break;
      case 'carpenter':
        for (const w of g.map.windows) {
          for (let i = w.boards; i < 6; i++) setTimeout(() => { if (g.map.addBoard(w)) g.audio.boardPlace(w.center.clone().setY(1.6)); }, 200 + Math.random() * 2500);
        }
        g.addPoints(POINTS.carpenter, true);
        break;
    }
  }

  // Sichtbarkeit am Boden: 15 s ruhig, dann Blinken (0,5 s → 0,25 s → 0,1 s Takt)
  visibleAt(t) {
    if (t < SOLID_TIME) return true;
    let k = t - SOLID_TIME, i = 0;
    const step = (n, d) => { const span = n * d; if (k < span) { i += Math.floor(k / d); return true; } k -= span; i += n; return false; };
    if (!step(15, 0.5) && !step(10, 0.25)) step(15, 0.1);
    return i % 2 === 0;
  }

  update(dt, time) {
    const was = this.fireSale;
    for (const k in this.timers) this.timers[k] = Math.max(0, this.timers[k] - dt);
    if (was && !this.fireSale) this.g.interact.fireSale(false);
    this.watchScore();
    const p = this.g.player;
    for (const it of this.items) {
      if (!it.active) continue;
      it.t += dt;
      const gp = it.group.position;
      gp.y = 1.0 + Math.sin(time * 2.5) * 0.12;
      it.model.rotation.y += dt * 1.6;
      it.model.rotation.z = Math.sin(time * 1.3) * 0.12;
      const blink = this.visibleAt(it.t) ? 1 : 0;
      it.group.visible = blink > 0;
      // Summen flackert mit, kurz bevor das Power-Up verschwindet
      if (it.loop && blink !== it.blink) { it.blink = blink; it.loop.set(blink ? 1 : 0.35); }
      if (Math.random() < 0.25) this.g.effects.energy(gp, [0.3, 1.5, 0.3], 1, 0.3);
      if (Math.hypot(p.pos.x - gp.x, p.pos.z - gp.z) < 1.3 && Math.abs(p.pos.y - (gp.y - 1)) < 1.6 && !p.downed) {
        it.active = false; it.group.visible = false;
        this.stopLoop(it);
        this.apply(it.type);
      } else if (it.t > LIFETIME) {
        it.active = false; it.group.visible = false;
        this.stopLoop(it);
      }
    }
    const shown = {};
    for (const k of TIMED) shown[k] = this.timers[k];
    this.g.hud.powerupTimers(shown);
  }

  reset() {
    for (const it of this.items) { it.active = false; it.group.visible = false; this.stopLoop(it); }
    for (const k in this.timers) this.timers[k] = 0;
    this.dropsThisRound = 0;
    this.increment = DROP_INCREMENT;
    this.scoreToDrop = 500 + DROP_INCREMENT; // Startpunkte + erste Schwelle
    this.dropFlag = false;
    this.shuffle();
  }
}
