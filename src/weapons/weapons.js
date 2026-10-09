// ─────────────────────────────────────────────────────────────
//  Waffensystem: Inventar, Schießen (Hitscan + Projektile),
//  Nachladen, Messer, Granaten, Perk-Trinken, Last Stand und
//  Viewmodel-Animation (Arme mit IK, Nachlade-Zeitachsen, Rückstoß-Feder).
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { WEAPONS } from '../config.js';
import { buildGun, buildKnife, buildGrenade, buildBottle, buildShell, setFrame } from './guns.js';
import { Arms, POSES } from './arms.js';
import { gunMats } from './gunTextures.js';
import { MuzzleFlash, BarrelSmoke, Casings } from './fx.js';
import { clamp, damp, lerp, rand, plateau, smooth } from '../core/utils.js';

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Vector3();
const _right = new THREE.Vector3(), _up = new THREE.Vector3();
const _pa = new THREE.Vector3(), _pb = new THREE.Vector3(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _sc = new THREE.Vector3();
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _qq = new THREE.Quaternion(), _m = new THREE.Matrix4(), _e = new THREE.Euler();
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Q = (fwd, up) => setFrame(new THREE.Quaternion(), V(...fwd), V(...up));
const seg = (k, a, b) => clamp((k - a) / (b - a), 0, 1);
const sseg = (k, a, b) => smooth(seg(k, a, b));

// Rückstoß je Klasse: Impulse [zurück, hoch, Nicken, Gieren±, Rollen±], Federfrequenz, Dämpfung, Laufhitze
const KICK = {
  pistol: { i: [0.8, 0.14, 3.4, 0.5, 1.4], w: 24, z: 0.5, heat: 0.7 },
  smg: { i: [0.26, 0.035, 0.75, 0.35, 0.6], w: 30, z: 0.6, heat: 0.32 },
  ar: { i: [0.4, 0.045, 1.05, 0.35, 0.7], w: 27, z: 0.6, heat: 0.42 },
  lmg: { i: [0.42, 0.04, 0.85, 0.5, 0.8], w: 25, z: 0.55, heat: 0.38 },
  rifle: { i: [0.85, 0.09, 2.6, 0.4, 1.0], w: 22, z: 0.55, heat: 0.9 },
  shotgun: { i: [1.35, 0.16, 5.2, 0.8, 2.0], w: 18, z: 0.5, heat: 1.8 },
  shotgun2: { i: [1.4, 0.16, 5.5, 0.8, 2.2], w: 18, z: 0.5, heat: 2.2 },
  sniper: { i: [1.9, 0.2, 6.8, 0.6, 2.4], w: 14, z: 0.5, heat: 2.5 },
  ray: { i: [0.65, 0.09, 2.6, 0.4, 1.0], w: 22, z: 0.55, heat: 0 },
  tesla: { i: [1.0, 0.12, 4.0, 0.5, 1.6], w: 18, z: 0.5, heat: 0 },
};
// Sprint-Haltung [dx, dy, dz, Nicken, Gieren, Rollen]
const SPRINT = {
  light: [-0.02, -0.01, 0.0, -0.45, 0.35, 0.62],
  rifle: [-0.01, 0.03, -0.03, -0.25, 0.6, 0.55],
  heavy: [-0.01, 0.015, -0.02, -0.3, 0.7, 0.55],
};
// Feste Listen (keine Allokationen pro Frame)
const BUSY = ['drink', 'knife', 'throw'];
const LIGHT = ['pistol', 'ray'];
const HEAVY = ['lmg', 'sniper'];
const REST = [[0, 'rest', 'G']];
const PIN_Q = Q([0.8, 0.2, -0.55], [-0.2, 0.95, 0.2]);
// Auswurfrichtungen der Hülsen (Waffenraum, m/s)
const EJ = { shell: V(1.6, 1.3, 0.2), down: V(0.3, -0.8, 0.3), pistol: V(1.3, 1.9, 0.5), rifle: V(1.9, 1.2, 0.2) };
const DRAW = { p45: 'pistol', ar: 'handle', vmp: 'handle', k14: 'handle', sniper: 'handle', lmg: 'handle', pump: 'pump', dlf: 'break', ray: 'energy', tesla: 'energy' };

// ── Nachlade-Zeitachsen (k = 0…1) ─────────────────────────────
// hand: [k, Anker, Pose] · mag: [k, Auszug, Weg-Anteil, sichtbar] · ev: [k, Ereignis]
const TL = {
  mag: {
    hand: [[0, 'rest', 'G'], [0.14, 'mag', 'pinch'], [0.72, 'mag', 'pinch'], [0.9, 'rest', 'G']],
    mag: [[0, 0, 0, 1], [0.18, 0, 0, 1], [0.23, 0.035, 0, 1], [0.4, 0.1, 1, 1], [0.5, 0.1, 1, 1], [0.62, 0.045, 0, 1], [0.68, 0, 0, 1]],
    ev: [[0.18, 'magOut'], [0.67, 'magIn']],
  },
  magEmpty: {
    hand: [[0, 'rest', 'G'], [0.13, 'mag', 'pinch'], [0.64, 'mag', 'pinch'], [0.75, 'handle', 'pull'], [0.88, 'handle', 'pull'], [1, 'rest', 'G']],
    mag: [[0, 0, 0, 1], [0.16, 0, 0, 1], [0.21, 0.035, 0, 1], [0.36, 0.1, 1, 1], [0.44, 0.1, 1, 1], [0.56, 0.045, 0, 1], [0.62, 0, 0, 1]],
    ev: [[0.16, 'magOut'], [0.61, 'magIn'], [0.79, 'boltBack'], [0.86, 'boltForward']],
    handle: [[0, 0], [0.77, 0], [0.82, 1], [0.855, 1], [0.875, 0]],
  },
  magSlap: {
    hand: [[0, 'rest', 'G'], [0.13, 'mag', 'pinch'], [0.64, 'mag', 'pinch'], [0.73, 'catch', 'flat'], [0.8, 'catch', 'flat'], [0.93, 'rest', 'G']],
    mag: [[0, 0, 0, 1], [0.16, 0, 0, 1], [0.21, 0.035, 0, 1], [0.36, 0.1, 1, 1], [0.44, 0.1, 1, 1], [0.56, 0.045, 0, 1], [0.62, 0, 0, 1]],
    ev: [[0.16, 'magOut'], [0.61, 'magIn'], [0.775, 'boltForward']],
  },
  pistol: {
    hand: [[0, 'rest', 'G'], [0.1, 'rest', 'G'], [0.3, 'off', 'pinch'], [0.42, 'mag', 'pinch'], [0.56, 'mag', 'flat'], [0.64, 'mag', 'flat'], [0.84, 'rest', 'G']],
    mag: [[0, 0, 0, 1], [0.12, 0, 0, 1], [0.3, 0.26, 0, 1], [0.301, 0.1, 1, 0], [0.4, 0.1, 1, 1], [0.52, 0.04, 0, 1], [0.58, 0, 0, 1]],
    ev: [[0.12, 'magOut'], [0.57, 'magIn']],
  },
  pistolEmpty: {
    hand: [[0, 'rest', 'G'], [0.08, 'rest', 'G'], [0.26, 'off', 'pinch'], [0.36, 'mag', 'pinch'], [0.48, 'mag', 'flat'], [0.54, 'mag', 'flat'], [0.66, 'slide', 'pull'], [0.76, 'slide', 'pull'], [0.8, 'slide', 'open'], [0.95, 'rest', 'G']],
    mag: [[0, 0, 0, 1], [0.1, 0, 0, 1], [0.26, 0.26, 0, 1], [0.261, 0.1, 1, 0], [0.34, 0.1, 1, 1], [0.46, 0.04, 0, 1], [0.52, 0, 0, 1]],
    ev: [[0.1, 'magOut'], [0.51, 'magIn'], [0.74, 'boltBack'], [0.79, 'boltForward']],
    slide: [[0, 1], [0.7, 1], [0.76, 1.12], [0.785, 1.12], [0.8, 0]],
  },
  cell: {
    hand: [[0, 'rest', 'G'], [0.15, 'mag', 'pinch'], [0.7, 'mag', 'pinch'], [0.9, 'rest', 'G']],
    mag: [[0, 0, 0, 1], [0.2, 0, 0, 1], [0.26, 0.03, 0, 1], [0.42, 0.09, 1, 1], [0.5, 0.09, 1, 1], [0.62, 0.035, 0, 1], [0.68, 0, 0, 1]],
    ev: [[0.2, 'magOut'], [0.67, 'magIn']],
  },
  lmg: {
    hand: [[0, 'rest', 'G'], [0.08, 'cover', 'pull'], [0.18, 'cover', 'pull'], [0.26, 'mag', 'pinch'], [0.73, 'mag', 'pinch'], [0.78, 'cover', 'flat'], [0.85, 'cover', 'flat'], [0.96, 'rest', 'G']],
    mag: [[0, 0, 0, 1], [0.3, 0, 0, 1], [0.35, 0.03, 0, 1], [0.48, 0.1, 1, 1], [0.58, 0.1, 1, 1], [0.68, 0.04, 0, 1], [0.73, 0, 0, 1]],
    cover: [[0, 0], [0.1, 0], [0.17, 1], [0.79, 1], [0.84, 0]],
    ev: [[0.11, 'coverOpen'], [0.3, 'magOut'], [0.72, 'magIn'], [0.835, 'coverClose']],
  },
  lmgEmpty: {
    hand: [[0, 'rest', 'G'], [0.07, 'cover', 'pull'], [0.15, 'cover', 'pull'], [0.22, 'mag', 'pinch'], [0.64, 'mag', 'pinch'], [0.69, 'cover', 'flat'], [0.75, 'cover', 'flat'], [0.82, 'handle', 'pull'], [0.92, 'handle', 'pull'], [1, 'rest', 'G']],
    mag: [[0, 0, 0, 1], [0.26, 0, 0, 1], [0.31, 0.03, 0, 1], [0.42, 0.1, 1, 1], [0.5, 0.1, 1, 1], [0.59, 0.04, 0, 1], [0.64, 0, 0, 1]],
    cover: [[0, 0], [0.09, 0], [0.15, 1], [0.7, 1], [0.745, 0]],
    handle: [[0, 0], [0.84, 0], [0.88, 1], [0.9, 1], [0.92, 0]],
    ev: [[0.1, 'coverOpen'], [0.26, 'magOut'], [0.63, 'magIn'], [0.74, 'coverClose'], [0.86, 'boltBack'], [0.915, 'boltForward']],
  },
  break: {
    hand: [[0, 'rest', 'G'], [0.22, 'rest', 'G'], [0.36, 'off', 'shell'], [0.5, 'shell', 'shell'], [0.6, 'shell', 'shell'], [0.72, 'rest', 'G']],
    brk: [[0, 0], [0.07, 0], [0.17, 1], [0.79, 1], [0.84, 0]],
    ev: [[0.07, 'breakOpen'], [0.19, 'eject'], [0.56, 'shellInsert'], [0.82, 'breakClose']],
  },
};
// Erste Ziehbewegung (k = 0…1 über 1.15 s)
const DRAWTL = {
  pistol: { hand: [[0, 'rest', 'G'], [0.4, 'rest', 'G'], [0.52, 'slide', 'pull'], [0.63, 'slide', 'pull'], [0.67, 'slide', 'open'], [0.86, 'rest', 'G']], slide: [[0, 0], [0.52, 0], [0.6, 1], [0.64, 1], [0.665, 0]], ev: [[0.54, 'boltBack'], [0.66, 'boltForward']] },
  handle: { hand: [[0, 'rest', 'G'], [0.38, 'rest', 'G'], [0.5, 'handle', 'pull'], [0.64, 'handle', 'pull'], [0.84, 'rest', 'G']], handle: [[0, 0], [0.5, 0], [0.6, 1], [0.63, 1], [0.66, 0]], ev: [[0.52, 'boltBack'], [0.65, 'boltForward']] },
  pump: { hand: [[0, 'rest', 'G']], pump: [[0, 0], [0.42, 0], [0.52, 1], [0.58, 1], [0.66, 0]], ev: [[0.43, 'pumpBack'], [0.6, 'pumpForward']] },
  break: { hand: [[0, 'rest', 'G']], brk: [[0, 1], [0.44, 1], [0.5, 0]], ev: [[0.48, 'breakClose']] },
  energy: { hand: [[0, 'rest', 'G']], ev: [[0.3, 'magIn']] },
};

// Wert aus einer Schlüsselliste [k, a, b, …] (glatt zwischen den Schlüsseln)
function keyed(list, k, i = 1) {
  if (k <= list[0][0]) return list[0][i];
  for (let j = 1; j < list.length; j++) {
    if (k < list[j][0]) {
      const a = list[j - 1], b = list[j];
      return a[i] + (b[i] - a[i]) * smooth((k - a[0]) / (b[0] - a[0]));
    }
  }
  return list[list.length - 1][i];
}

// Freie Hand-Schlüssel (Kameraraum) für Messer, Wurf, Trinken: [k, Position, Fingerrichtung, Handrücken, Pose]
const K = (k, p, f, u, pose) => ({ k, p: V(...p), q: Q(f, u), pose });
// Lage über die Handachse X (rechte Hand: Daumenseite = -X) und Handrücken Y
const KX = (k, p, x, y, pose) => { const X = V(...x).normalize(), Y = V(...y); Y.addScaledVector(X, -Y.dot(X)).normalize(); const Z = new THREE.Vector3().crossVectors(X, Y); return { k, p: V(...p), q: setFrame(new THREE.Quaternion(), Z.negate(), Y), pose }; };
// Messer: Klinge zeigt zur Daumenseite (-X), Schneide zur Handfläche (-Y)
const KB = (k, p, blade, edge) => KX(k, p, blade.map((v) => -v), edge.map((v) => -v), 'knife');
const KNIFE = [
  KB(0.12, [0.14, -0.08, -0.26], [0.1, 0.4, -0.91], [-1, 0, 0]),
  KB(0.24, [0.04, -0.07, -0.29], [-0.35, 0.15, -0.92], [-0.8, -0.5, 0.2]),
  KB(0.42, [-0.07, -0.08, -0.3], [-0.75, 0.0, -0.66], [-0.6, -0.3, 0.7]),
  KB(0.78, [0.18, -0.3, -0.22], [0.0, -0.6, -0.8], [-1, 0, 0]),
];
const THROW = [
  K(0.15, [0.12, -0.12, -0.32], [-0.1, 0.55, -0.83], [0.85, 0.35, 0.35], 'grenade'),
  K(0.32, [0.24, 0.0, -0.36], [-0.1, 0.9, -0.4], [0.95, 0.0, 0.3], 'grenade'),
  K(0.46, [0.05, 0.015, -0.55], [-0.1, 0.3, -0.95], [0.4, 0.85, 0.3], 'open'),
  K(0.64, [-0.035, -0.16, -0.4], [0.0, -0.4, -0.9], [0.3, 0.9, -0.3], 'relaxed'),
];
const DRINK = [
  KX(0.3 / 2.4, [0.11, -0.13, -0.3], [0, -1, 0], [1, 0, 0.2], 'bottle'),
  KX(0.42 / 2.4, [0.09, -0.053, -0.238], [0.164, 0.546, -0.82], [1, 0, 0.2], 'bottle'),
  KX(1.6 / 2.4, [0.09, -0.021, -0.234], [0.134, 0.753, -0.645], [1, 0, 0.2], 'bottle'),
  KX(1.82 / 2.4, [0.13, -0.17, -0.32], [0, -0.9, -0.4], [1, 0.1, 0.2], 'bottle'),
  K(1.92 / 2.4, [0.22, -0.16, -0.3], [0.3, 0.2, -0.93], [0.9, -0.3, 0.3], 'open'),
  K(2.2 / 2.4, [0.26, -0.52, -0.25], [0.2, -0.3, -0.93], [0.9, -0.2, 0.3], 'relaxed'),
];

export class Weapons {
  constructor(game) {
    this.g = game;
    this.M = game.M;
    this.scene = game.vmScene;
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.holder = new THREE.Group();
    this.root.add(this.holder);
    this.slots = [null, null];
    this.cur = 0;
    this.state = 'idle';
    this.stateT = 0;
    this.stateDur = 0;
    this.prevK = 0;
    this.ads = 0; this.sprintBlend = 0; this.swayX = 0; this.swayY = 0;
    this.fireCd = 0; this.time = 0;
    this.grenades = 2;
    this.info = null;
    this.cache = {};
    this.thrown = [];
    this.projectiles = [];
    this.chainQ = [];
    this.knifeLevel = 0;
    this.drawn = new WeakSet();
    this.last = null; this.lastSlot = null;
    this.heat = 0; this.sinceShot = 9; this.cycleT = 9; this.pumpT = 9; this.smokeAcc = 0;
    this.kp = [0, 0, 0]; this.kv = [0, 0, 0]; this.kr = [0, 0, 0]; this.kw = [0, 0, 0];
    this.kickCfg = KICK.pistol;
    this.landKick = 0;

    // Arme, Effekte, Handrequisiten
    const G = gunMats(this.M);
    this.arms = new Arms(G.arms);
    this.scene.add(this.arms.root);
    this.flash = new MuzzleFlash();
    this.smoke = new BarrelSmoke(this.scene);
    this.casings = new Casings(game.scene, this.M);
    const R = this.arms.side[0].hand, L = this.arms.side[1].hand;
    this.knife = buildKnife(this.M); this.mountKnife();
    this.nade = buildGrenade(this.M); this.nade.visible = false;
    this.nade.position.set(-0.005, -0.04, -0.06); R.add(this.nade);
    this.pin = this.nade.userData.pin;
    this.shellsL = [buildShell(this.M), buildShell(this.M)];
    this.shellsL.forEach((s, i) => { s.visible = false; s.position.set(-0.01 + i * 0.022, -0.026, -0.07); s.rotation.set(-1.2, 0, 0); L.add(s); });
    this.bottle = null;
    this.loose = []; // weggeworfene Teile (Kronkorken, Flasche, Sicherungsring)

    // Licht für die Waffenszene
    this.hemi = new THREE.HemisphereLight(0x8090b0, 0x201810, 0.6);
    this.key = new THREE.DirectionalLight(0xffe0c0, 1.2);
    this.key.position.set(0.5, 1, 0.3);
    this.rim = new THREE.DirectionalLight(0x8fa8ff, 0.35);
    this.rim.position.set(-0.6, 0.3, -1);
    this.vmFlash = new THREE.PointLight(0xffa050, 0, 2.2, 1.5);
    this.vmFlash.position.set(0.1, -0.05, -0.6);
    this.scene.add(this.hemi, this.key, this.rim, this.vmFlash);

    // Projektil-Pool
    const pg = new THREE.SphereGeometry(0.06, 10, 8);
    for (let i = 0; i < 10; i++) {
      const core = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ color: 0xffffff }));
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.M.tex.glow, color: 0x55ff66, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      halo.scale.set(0.7, 0.7, 1);
      core.add(halo);
      core.visible = false;
      core.userData.dynamic = true;
      game.scene.add(core);
      this.projectiles.push({ mesh: core, halo, active: false, pos: core.position, vel: new THREE.Vector3(), life: 0 });
    }
    this.projLight = new THREE.PointLight(0x55ff66, 0, 7, 1.6);
    this.projLight.userData.tier = 2;
    game.scene.add(this.projLight);
    // Granaten-Pool (Welt)
    for (let i = 0; i < 6; i++) {
      const m = buildGrenade(this.M);
      m.userData.pin.visible = false;
      m.scale.setScalar(1.3);
      m.visible = false;
      m.userData.dynamic = true;
      game.scene.add(m);
      this.thrown.push({ mesh: m, active: false, pos: m.position, vel: new THREE.Vector3(), fuse: 0 });
    }
    // Freie Anker (Kameraraum) für Hände ohne Waffe
    this.offR = { p: V(0.28, -0.6, -0.2), q: Q([0, 0.4, -0.9], [0.9, 0.3, 0.3]) };
    this.offL = { p: V(-0.3, -0.6, -0.2), q: Q([0, 0.4, -0.9], [-0.9, 0.3, 0.3]) };
  }

  mountKnife() {
    const R = this.arms.side[0].hand;
    this.knife.visible = false;
    this.knife.position.set(-0.034, -0.024, -0.07);
    this.knife.rotation.set(0, Math.PI / 2, 0);
    R.add(this.knife);
  }

  // ── Inventar ────────────────────────────────────────────────
  makeSlot(id, pap = false) {
    const def = WEAPONS[id];
    const stats = pap ? { ...def, ...def.pap, pap: def.pap } : def;
    return { id, pap, stats, mag: stats.mag, reserve: stats.reserve };
  }
  get weapon() { return this.lastSlot || this.slots[this.cur]; }
  has(id) { return this.slots.find((s) => s && s.id === id) || null; }
  get count() { return this.slots.filter(Boolean).length; }

  give(id, pap = false) {
    const slot = this.makeSlot(id, pap);
    this.giveSlot(slot);
    return slot;
  }

  giveSlot(slot) {
    let idx = this.slots.findIndex((s) => !s);
    if (idx < 0) idx = this.cur;
    this.slots[idx] = slot;
    this.equip(idx);
  }

  takeCurrent() {
    const s = this.slots[this.cur];
    this.slots[this.cur] = null;
    const other = this.slots.findIndex((x) => x);
    if (other >= 0) this.equip(other); else { this.setModel(null); this.setState('idle'); }
    return s;
  }

  equip(idx) {
    this.cur = idx;
    const slot = this.slots[idx];
    this.setModel(slot);
    // Beim ersten Ziehen einer Waffe: Durchladen als Einlage
    if (slot && !this.drawn.has(slot)) {
      this.drawn.add(slot);
      this.setState('draw', 1.15);
      this.g.audio.weaponDraw && this.g.audio.weaponDraw(slot.stats.cls);
    } else this.setState('raise', 0.5);
    this.g.audio.weaponSwitch();
    this.g.hud.weaponName(slot);
  }

  setModel(slot) {
    this.holder.clear();
    this.info = null;
    this.flash.group.removeFromParent();
    if (!slot) return;
    const key = slot.id + (slot.pap ? '_pap' : '');
    if (!this.cache[key]) {
      const info = buildGun(slot.id, this.M, slot.pap);
      // Hand außerhalb des Bildes (Waffenraum), z. B. beim Magazinwechsel
      const off = new THREE.Object3D(); off.name = 'offL';
      off.position.set(-0.13, -0.42, 0.14);
      setFrame(off.quaternion, V(0.25, 0.9, -0.3), V(-0.9, 0.15, 0.4));
      info.group.add(off); info.offL = off;
      info.magDir = info.id === 'ray' ? V(-0.75, 0.66, 0) : V(0, -1, 0).applyEuler(info.magRot || new THREE.Euler());
      info.magOff = info.id === 'ray' ? V(-0.25, 0.1, 0.1) : V(-0.12, -0.4, 0.12);
      this.cache[key] = info;
    }
    const info = this.info = this.cache[key];
    this.holder.add(info.group);
    info.muzzle.add(this.flash.group);
    this.kickCfg = KICK[slot.stats.cls] || KICK.ar;
    this.flash.group.visible = false;
    this.resetParts(info);
  }

  resetParts(info) {
    if (info.mag) { info.mag.position.copy(info.magHome); info.mag.rotation.copy(info.magRot); info.mag.visible = true; }
    if (info.slide) info.slide.position.copy(info.slideHome);
    if (info.handle) info.handle.position.copy(info.handleHome);
    if (info.pump) info.pump.position.copy(info.pumpHome);
    if (info.breakPart) info.breakPart.rotation.x = 0;
    if (info.cover) info.cover.rotation.x = 0;
    if (info.chamber) info.chamber.visible = true;
    for (const s of this.shellsL) s.visible = false;
  }

  refillAll() {
    for (const s of this.slots) if (s) s.reserve = s.stats.reserve;
    if (this.lastSlot) this.lastSlot.reserve = this.lastSlot.stats.reserve;
    this.grenades = 4;
  }

  setState(s, dur = 0) { this.state = s; this.stateT = 0; this.stateDur = dur; this.prevK = 0; }

  get busy() { return BUSY.includes(this.state); }

  // ── Aktionen ────────────────────────────────────────────────
  reload() {
    const w = this.weapon;
    if (!w || this.state !== 'idle' || w.mag >= w.stats.mag || w.reserve <= 0 || !this.info) return;
    const dur = w.stats.reload * (this.g.player.perks.has('blitz') ? 0.5 : 1);
    this.setState('reload', dur);
    const info = this.info;
    const empty = w.mag === 0;
    this.rl = { empty, style: info.reload, tl: null };
    if (info.reload === 'shells') {
      // Patronen einzeln: Zeit je Patrone begrenzt, Rest als Vorlauf
      const n = Math.max(1, Math.min(w.stats.mag - w.mag, w.reserve));
      const s1 = empty ? 0.24 : 0.1;
      let per = (1 - 0.12 - s1) / n;
      const perMax = 0.62 / dur;
      let s0 = 0.12;
      if (per > perMax) { s0 += (per - perMax) * n * 0.5; per = perMax; }
      Object.assign(this.rl, { n, s0, per, s1: s0 + n * per, done: 0 });
    } else {
      const base = info.reload === 'pistol' ? 'pistol' : info.reload === 'lmg' ? 'lmg' : info.reload === 'cell' ? 'cell' : info.reload === 'break' ? 'break' : 'mag';
      this.rl.tl = empty && base === 'mag' && info.emptyAction === 'slap' ? TL.magSlap : TL[base + (empty && TL[base + 'Empty'] && (base !== 'mag' || info.handle) ? 'Empty' : '')] || TL[base];
    }
  }

  finishReload() {
    const w = this.weapon;
    if (!w) return;
    const need = w.stats.mag - w.mag;
    const take = Math.min(need, w.reserve);
    w.mag += take; w.reserve -= take;
  }

  drink(perkColor, onDone) {
    this.setState('drink', 2.4);
    this.ads = 0;
    this.dropBottle();
    this.bottle = buildBottle(perkColor);
    const R = this.arms.side[0].hand;
    this.bottle.position.set(0.072, -0.036, -0.064);
    this.bottle.rotation.set(0, 0, Math.PI / 2);
    R.add(this.bottle);
    this.bottleState = 0;
    this.onDrinkDone = onDone;
    this.g.audio.drink();
  }

  dropBottle() {
    if (!this.bottle) return;
    this.bottle.removeFromParent();
    this.bottle = null;
  }

  knifeAttack() {
    if (this.busy) return;
    this.setState('knife', this.knifeLevel ? 0.45 : 0.55);
    this.knifeHit = false;
    this.ads = Math.min(this.ads, 0.3);
    this.g.audio.knife();
  }

  throwGrenade() {
    if (this.busy || this.grenades <= 0) return;
    this.setState('throw', 0.65);
    this.thrownYet = false;
    this.pinPulled = false;
    this.g.audio.grenadePin();
  }

  // ── Last Stand (Phönix-Soda) ────────────────────────────────
  enterLastStand() {
    if (this.state === 'drink') { this.dropBottle(); this.onDrinkDone = null; }
    this.resetPin();
    const own = this.slots.findIndex((s) => s && s.id === 'p45');
    let slot;
    if (own >= 0) slot = this.slots[own];
    else { slot = this.makeSlot('p45'); slot.mag = slot.stats.mag; slot.reserve = slot.stats.mag * 3; this.drawn.add(slot); }
    this.last = { prev: this.cur, temp: own < 0 };
    this.lastSlot = slot;
    this.ads = 0;
    this.setModel(slot);
    this.setState('raise', 0.4);
    this.g.hud.weaponName(slot);
  }

  exitLastStand() {
    const L = this.last;
    this.last = null; this.lastSlot = null;
    const idx = this.slots[L.prev] ? L.prev : this.slots.findIndex((s) => s);
    if (idx >= 0) this.equip(idx); else { this.setModel(null); this.setState('idle'); }
  }

  // ── Schießen ────────────────────────────────────────────────
  fire() {
    const g = this.g, w = this.weapon, st = w.stats, player = g.player, cam = g.camera;
    const doppel = player.perks.has('doppel');
    w.mag--;
    this.fireCd = 60 / (st.rpm * (doppel ? 1.33 : 1));
    const dmgMul = doppel ? 2 : 1;
    const moving = clamp(player.hSpeed / 4.4, 0, 1);
    let spread = lerp(st.spread, st.adsSpread, this.ads) * (1 + moving * 1.2 + (player.onGround ? 0 : 2)) * (player.crouching ? 0.75 : 1);
    if (st.pellets > 1) spread = lerp(st.spread, st.adsSpread, this.ads);

    cam.getWorldPosition(_o);
    cam.getWorldDirection(_d);
    _right.setFromMatrixColumn(cam.matrixWorld, 0);
    _up.setFromMatrixColumn(cam.matrixWorld, 1);
    const muzzle = this.muzzleWorld(_q);
    const pellet = st.pellets > 1;

    let anyHit = false, headHit = false;
    if (st.lightning) this.fireLightning(st, muzzle);
    else for (let i = 0; i < st.pellets; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
      const dir = _p.copy(_d).addScaledVector(_right, Math.cos(a) * r).addScaledVector(_up, Math.sin(a) * r).normalize();
      if (st.projectile) { this.spawnProjectile(muzzle, dir.clone(), st, dmgMul); continue; }
      const wall = g.rayBlock(_o, dir, g.map.rayCast(_o, dir, 150));
      if (i === 0) for (const f of g.features) if (f.onShot) f.onShot(_o, dir, wall.dist);
      const hits = g.zombies.raycast(_o, dir, wall.dist);
      let pen = st.penetrate || 0, dmg = st.damage * dmgMul, endT = wall.dist;
      let stopped = false;
      for (const h of hits) {
        const point = _o.clone().addScaledVector(dir, h.t);
        const mult = h.part === 'head' ? st.headMult : 1;
        g.zombies.damage(h.z, dmg * mult, h.part, { dir: dir.clone(), point, pellet });
        anyHit = true; headHit = headHit || h.part === 'head';
        if (st.explosive) { g.explode(point, st.explosive.radius, st.explosive.damage * dmgMul, { color: [3, 0.9, 0.3], small: true }); stopped = true; endT = h.t; break; }
        if (pen-- <= 0) { stopped = true; endT = h.t; break; }
        dmg *= 0.75;
      }
      if (!stopped) {
        const point = _o.clone().addScaledVector(dir, wall.dist);
        if (wall.dist < 150) {
          g.effects.impact(point, wall.normal, wall.mat);
          if (i === 0) g.audio.impact(point, wall.mat);
          if (st.explosive) g.explode(point, st.explosive.radius, st.explosive.damage * dmgMul, { color: [3, 0.9, 0.3], small: true });
        }
      }
      if (Math.random() < (st.pellets > 1 ? 0.25 : 0.5)) g.effects.tracer(muzzle, _o.clone().addScaledVector(dir, Math.min(endT, 60)));
    }
    if (anyHit) g.hud.hitmarker(headHit);

    // Rückstoß (Kamera + Viewmodel-Feder)
    const rec = st.recoil * (1 - this.ads * 0.35) * (player.crouching ? 0.8 : 1);
    player.addRecoil(rec, (Math.random() - 0.5) * rec * 0.6);
    const c = this.kickCfg, I = c.i;
    const pk = 1 - this.ads * 0.5, rk = 1 - this.ads * 0.65;
    this.kv[2] += I[0] * pk * rand(0.9, 1.1);
    this.kv[1] += I[1] * pk;
    this.kw[0] += I[2] * rk * rand(0.85, 1.15);
    this.kw[1] += (Math.random() - 0.5) * 2 * I[3] * rk;
    this.kw[2] += (Math.random() - 0.5) * 2 * I[4] * rk;

    // Mündungsfeuer, Licht, Sound
    const flashColor = st.projectile ? st.projectile.color : st.lightning ? 0x66aaff : 0xffb060;
    g.effects.muzzle(muzzle, flashColor, st.projectile ? 0.6 : 1);
    if (this.info && this.info.flash > 0) this.flash.fire(this.info.flash, st.cls === 'sniper', pellet);
    this.vmFlash.color.set(flashColor);
    this.vmFlash.intensity = st.projectile || st.lightning ? 2.5 : 4;
    g.audio.gunshot(st.sound, w.pap);
    this.heat = Math.min(8, this.heat + c.heat);
    this.sinceShot = 0;
    this.cycleT = 0;
    // Hülsen: Pumpgun erst beim Repetieren, Doppellauf beim Öffnen
    if (st.cls === 'shotgun') this.pumpT = 0;
    else if (this.info && this.info.eject && st.cls !== 'shotgun2') this.ejectCase(this.info.eject);
  }

  // Hülse aus dem Auswurffenster in die Welt werfen
  ejectCase(kind, from = null, vel = null) {
    const g = this.g, cam = g.camera, info = this.info;
    if (!info || !g.map) return;
    this.root.updateMatrixWorld(true);
    (from || info.ejectPort).getWorldPosition(_v);
    // Sichtfeld-Ausgleich: Viewmodel (54°) → Weltkamera
    const kf = Math.tan((cam.fov * Math.PI) / 360) / Math.tan((g.vmCamera.fov * Math.PI) / 360);
    _v.x *= kf; _v.y *= kf;
    _v.applyMatrix4(cam.matrixWorld);
    // Richtung im Waffenraum → Kamera → Welt
    _w.copy(vel || (kind === 'shell' ? EJ.shell : info.id === 'lmg' ? EJ.down : kind === 'pistol' ? EJ.pistol : EJ.rifle));
    _w.x *= rand(0.8, 1.2); _w.y *= rand(0.8, 1.2); _w.z += rand(-0.3, 0.3);
    const spd = _w.length();
    _qq.setFromEuler(this.root.rotation);
    _w.applyQuaternion(_qq).transformDirection(cam.matrixWorld).multiplyScalar(spd);
    _w.addScaledVector(g.player.vel, 0.8);
    this.root.getWorldQuaternion(_qa);
    _qa.premultiply(cam.quaternion);
    this.casings.spawn(kind, _v, _w, _qa, kf);
  }

  // Gewitter-Werfer: Blitz springt von Zombie zu Zombie
  fireLightning(st, muzzle) {
    const g = this.g, L = st.lightning;
    const o = _o.clone(), d = _d.clone();
    const wall = g.rayBlock(o, d, g.map.rayCast(o, d, L.reach));
    for (const f of g.features) if (f.onShot) f.onShot(o, d, wall.dist);
    let first = null, best = Infinity;
    for (const z of g.zombies.pool) {
      if (!z.alive) continue;
      const c = _p.set(z.pos.x, z.pos.y + 1.1, z.pos.z).sub(o);
      const t = c.dot(d);
      if (t < 0.3 || t > Math.min(L.reach, wall.dist + 0.6)) continue;
      const off = c.addScaledVector(d, -t).length();
      if (off > 0.9 + t * 0.035) continue;
      const score = off / (1 + t * 0.05);
      if (score < best) { best = score; first = z; }
    }
    if (!first) {
      const end = o.clone().addScaledVector(d, Math.min(wall.dist, L.reach));
      g.effects.lightning(muzzle.clone(), end, L.color, 0.22, 0.05);
      if (wall.dist < L.reach) g.effects.impact(end, wall.normal, 'metal');
      return;
    }
    const hit = [first];
    let cur = first;
    while (hit.length < L.chains) {
      let nb = null, nd = L.range;
      for (const z of g.zombies.pool) {
        if (!z.alive || hit.includes(z)) continue;
        const dd = Math.hypot(z.pos.x - cur.pos.x, z.pos.z - cur.pos.z);
        if (dd < nd) { nd = dd; nb = z; }
      }
      if (!nb) break;
      hit.push(nb); cur = nb;
    }
    let from = muzzle.clone();
    hit.forEach((z, i) => {
      const to = z.pos.clone(); to.y += 1.1;
      this.chainQ.push({ t: i * 0.08, from: from.clone(), to, z, color: L.color });
      from = to;
    });
  }

  updateChain(dt) {
    const g = this.g;
    for (let i = this.chainQ.length - 1; i >= 0; i--) {
      const c = this.chainQ[i];
      c.t -= dt;
      if (c.t > 0) continue;
      this.chainQ.splice(i, 1);
      if (c.z.alive) c.to.set(c.z.pos.x, c.z.pos.y + 1.1, c.z.pos.z);
      g.effects.lightning(c.from, c.to, c.color);
      g.audio.teslaZap(c.to);
      if (c.z.alive) {
        g.zombies.damage(c.z, 1e9, 'torso', { dir: c.to.clone().sub(c.from).normalize(), point: c.to.clone(), shock: true });
        g.hud.hitmarker(false);
        g.effects.energy(c.to, c.color, 10, 0.4);
      }
    }
  }

  upgradeKnife() {
    this.knifeLevel = 1;
    this.knife.removeFromParent();
    this.knife = buildKnife(this.M, true);
    this.mountKnife();
  }

  muzzleWorld(out) {
    const cam = this.g.camera;
    if (this.info) {
      this.root.updateMatrixWorld(true);
      this.info.muzzle.getWorldPosition(out);
      // Viewmodel-Raum → Kameraraum → Welt
      out.applyMatrix4(cam.matrixWorld);
    } else out.copy(cam.position);
    return out;
  }

  spawnProjectile(from, dir, st, dmgMul) {
    const p = this.projectiles.find((x) => !x.active);
    if (!p) return;
    const ps = st.projectile;
    p.active = true; p.life = 3;
    p.pos.copy(from);
    p.vel.copy(dir).multiplyScalar(ps.speed);
    p.damage = st.damage * dmgMul; p.splash = ps.splash * dmgMul; p.radius = ps.radius;
    p.color = new THREE.Color(ps.color);
    p.mesh.material.color.copy(p.color).multiplyScalar(3);
    p.halo.material.color.copy(p.color);
    p.mesh.visible = true;
  }

  updateProjectiles(dt) {
    const g = this.g;
    let lightP = null;
    for (const p of this.projectiles) {
      if (!p.active) continue;
      p.life -= dt;
      const step = p.vel.length() * dt;
      _d.copy(p.vel).normalize();
      const wall = g.rayBlock(p.pos, _d, g.map.rayCast(p.pos, _d, step + 0.05));
      const hits = g.zombies.raycast(p.pos, _d, Math.min(step + 0.1, wall.dist));
      let boom = null;
      if (hits.length) {
        const h = hits[0];
        boom = p.pos.clone().addScaledVector(_d, h.t);
        g.zombies.damage(h.z, p.damage, h.part, { dir: _d.clone(), point: boom });
        g.hud.hitmarker(h.part === 'head');
      } else if (wall.dist <= step + 0.05) {
        boom = p.pos.clone().addScaledVector(_d, wall.dist - 0.05);
      }
      if (boom || p.life <= 0) {
        const c = p.color;
        g.explode(boom || p.pos, p.radius, p.splash, { color: [c.r * 3, c.g * 3, c.b * 3], small: true, energy: true });
        p.active = false; p.mesh.visible = false;
        continue;
      }
      p.pos.addScaledVector(p.vel, dt);
      g.effects.energy(p.pos, [p.color.r * 3, p.color.g * 3, p.color.b * 3], 2, 0.05);
      lightP = p;
    }
    if (lightP) { this.projLight.position.copy(lightP.pos); this.projLight.color.copy(lightP.color); this.projLight.intensity = 6; }
    else this.projLight.intensity = 0;
  }

  updateGrenades(dt) {
    const g = this.g, map = g.map;
    for (const n of this.thrown) {
      if (!n.active) continue;
      n.fuse -= dt;
      n.vel.y -= 14 * dt;
      const nx = n.pos.x + n.vel.x * dt, nz = n.pos.z + n.vel.z * dt;
      let ny = n.pos.y + n.vel.y * dt;
      const cx0 = Math.floor(n.pos.x / 2), cz0 = Math.floor(n.pos.z / 2);
      const cx1 = Math.floor(nx / 2), cz1 = Math.floor(nz / 2);
      let bounced = false;
      if (cx1 !== cx0 && !map.playerWalkable(cx1, cz0)) { n.vel.x *= -0.45; bounced = true; } else n.pos.x = nx;
      if (cz1 !== cz0 && !map.playerWalkable(Math.floor(n.pos.x / 2), cz1)) { n.vel.z *= -0.45; bounced = true; } else n.pos.z = nz;
      const cell = map.cellAt(n.pos.x, n.pos.z);
      if (cell && map.hasCeiling(cell) && ny > 3.9) { ny = 3.9; n.vel.y *= -0.4; bounced = true; }
      if (ny < 0.06) {
        ny = 0.06;
        if (Math.abs(n.vel.y) > 1.2) bounced = true;
        n.vel.y *= -0.35; n.vel.x *= 0.6; n.vel.z *= 0.6;
      }
      n.pos.y = ny;
      if (bounced) g.audio.bounce(n.pos);
      n.mesh.rotation.x += dt * n.vel.length() * 3;
      if (n.fuse <= 0) {
        n.active = false; n.mesh.visible = false;
        g.explode(n.pos.clone().setY(0.4), 6, 180 + g.round * 130, { color: [3, 1.6, 0.5] });
      }
    }
  }

  releaseGrenade() {
    const n = this.thrown.find((x) => !x.active);
    if (!n) return;
    const cam = this.g.camera;
    cam.getWorldPosition(_o); cam.getWorldDirection(_d);
    n.active = true; n.fuse = 2.3; n.mesh.visible = true;
    n.pos.copy(_o).addScaledVector(_d, 0.4).setY(_o.y - 0.15);
    n.vel.copy(_d).multiplyScalar(13).add(new THREE.Vector3(0, 3.2, 0)).add(this.g.player.vel.clone().multiplyScalar(0.5));
    this.grenades--;
    this.g.audio.nadeThrow && this.g.audio.nadeThrow();
  }

  doKnifeHit() {
    const g = this.g, player = g.player;
    let best = null, bd = 2.3;
    const fwd = _d.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    for (const z of g.zombies.pool) {
      if (!z.alive) continue;
      const dx = z.pos.x - player.pos.x, dz = z.pos.z - player.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > bd || d < 0.01) continue;
      const dot = (dx * fwd.x + dz * fwd.z) / d;
      if (dot < 0.6) continue;
      best = z; bd = d;
    }
    if (best) {
      if (bd > 1.2) { player.vel.x += fwd.x * 6; player.vel.z += fwd.z * 6; } // Ausfallschritt
      const point = best.pos.clone().setY(1.3);
      g.zombies.damage(best, this.knifeLevel ? 1000 + g.round * 100 : 150, 'torso', { dir: fwd.clone(), point, knife: true });
      g.hud.hitmarker(false);
      g.player.shake = Math.max(g.player.shake, 0.15);
      g.audio.knifeHit && g.audio.knifeHit(point);
    }
  }

  // ── Update ──────────────────────────────────────────────────
  update(dt, input) {
    const g = this.g, player = g.player;
    this.time += dt;
    this.stateT += dt;
    this.fireCd -= dt;
    const playing = g.state === 'playing';
    // Last Stand: Pistole ziehen bzw. nach der Wiederbelebung zurückwechseln
    if (playing && player.downed && !this.last) this.enterLastStand();
    else if (this.last && !player.downed) this.exitLastStand();
    const w = this.weapon;
    const canAct = playing && !player.downed;
    const canShoot = playing && (!player.downed || !!this.last);

    if (canAct) {
      // Waffenwechsel
      const wantSwitch = input.hit('slot1') ? 0 : input.hit('slot2') ? 1 : input.hit('switch') ? 1 - this.cur : -1;
      if (wantSwitch >= 0 && wantSwitch !== this.cur && this.slots[wantSwitch] && !this.busy && this.state !== 'lower') {
        this.setState('lower', 0.28);
        this.pendingSlot = wantSwitch;
      }
      if (input.hit('knife')) this.knifeAttack();
      if (input.hit('grenade')) this.throwGrenade();
    }
    if (canShoot) {
      if (input.hit('reload')) this.reload();
      // Touch: Halbautomaten feuern beim Gedrückthalten wiederholt (Takt durch fireCd begrenzt)
      const wantFire = w && (w.stats.auto || input.device === 'touch' ? input.held('fire') : input.hit('fire'));
      if (wantFire && player.sprinting) player.stopSprint();
      if (wantFire && this.state === 'idle' && this.fireCd <= 0 && !player.sprinting && this.info) {
        if (w.mag > 0) this.fire();
        else if (w.reserve > 0) this.reload();
        else if (input.hit('fire')) g.audio.emptyClick();
      }
      // Automatisch nachladen, wenn Magazin leer
      if (w && w.mag === 0 && w.reserve > 0 && this.state === 'idle' && this.fireCd <= -0.15) this.reload();
    }

    // Zustandsautomat
    const k = this.stateDur > 0 ? clamp(this.stateT / this.stateDur, 0, 1) : 0;
    switch (this.state) {
      case 'reload':
        this.reloadEvents(k);
        if (this.stateT >= this.stateDur) { this.finishReload(); this.setState('idle'); }
        break;
      case 'draw':
        this.drawEvents(k);
        if (this.stateT >= this.stateDur) this.setState('idle');
        break;
      case 'raise':
        if (this.stateT >= this.stateDur) this.setState('idle');
        break;
      case 'lower':
        if (this.stateT >= this.stateDur) this.equip(this.pendingSlot);
        break;
      case 'knife':
        if (!this.knifeHit && this.stateT > 0.13) { this.knifeHit = true; this.doKnifeHit(); }
        if (this.stateT >= this.stateDur) this.setState('idle');
        break;
      case 'throw':
        if (!this.pinPulled && k > 0.27) { this.pinPulled = true; this.pullPin(); }
        if (!this.thrownYet && this.stateT > 0.3) { this.thrownYet = true; this.releaseGrenade(); }
        if (this.stateT >= this.stateDur) { this.setState('idle'); this.resetPin(); }
        break;
      case 'drink':
        this.drinkEvents();
        if (this.stateT >= this.stateDur) {
          this.dropBottle();
          this.setState('raise', 0.45);
          const cb = this.onDrinkDone; this.onDrinkDone = null;
          if (cb) cb();
        }
        break;
    }
    this.prevK = this.stateDur > 0 ? clamp(this.stateT / this.stateDur, 0, 1) : 0;

    // ADS
    const adsWanted = canShoot && input.held('ads') && w && this.state === 'idle' && !player.sprinting && !!this.info;
    this.ads = damp(this.ads, adsWanted ? 1 : 0, w && w.stats.scope ? 9 : 13, dt);
    if (adsWanted && player.sprinting) player.stopSprint();

    this.updateProjectiles(dt);
    this.updateGrenades(dt);
    this.updateChain(dt);
    this.animate(dt, input);
    this.casings.update(dt, g);

    // HUD
    const st = w ? w.stats : null;
    if (st) {
      const moving = clamp(player.hSpeed / 4.4, 0, 1);
      const spread = lerp(st.spread, st.adsSpread, this.ads) * (1 + moving * 1.2 + (player.onGround ? 0 : 2));
      g.hud.crosshair(spread, this.ads > 0.5 || player.sprinting || this.busy);
    } else g.hud.crosshair(0.02, true);
    g.hud.ammo(w, this.grenades);
    g.hud.scope(st && st.scope && this.ads > 0.9);
  }

  fireEvent(name) {
    const a = this.g.audio, w = this.weapon, cls = w ? w.stats.cls : 'ar', info = this.info;
    switch (name) {
      case 'magOut': a.magOut && a.magOut(cls); break;
      case 'magIn': a.magIn && a.magIn(cls); this.kv[1] += 0.12; this.kw[0] += 0.9; this.kw[2] -= 0.5; break;
      case 'boltBack': a.boltBack && a.boltBack(cls); this.kw[2] += 0.4; break;
      case 'boltForward': a.boltForward && a.boltForward(cls); this.kv[2] += 0.15; this.kw[0] += 0.6; break;
      case 'pumpBack': a.pumpBack && a.pumpBack(); this.kv[2] += 0.12; break;
      case 'pumpForward': a.pumpForward && a.pumpForward(); this.kw[0] += 0.4; break;
      case 'breakOpen': a.breakOpen && a.breakOpen(); this.kw[0] -= 1.2; break;
      case 'breakClose': a.breakClose && a.breakClose(); this.kw[0] += 2.2; this.kv[1] += 0.2; break;
      case 'shellInsert': a.shellInsert && a.shellInsert(); this.kv[1] += 0.05; break;
      case 'coverOpen': a.boltBack && a.boltBack('lmgCover'); break;
      case 'coverClose': a.boltForward && a.boltForward('lmgCover'); this.kv[1] += 0.12; this.kw[0] += 0.8; break;
      case 'eject':
        if (info && info.chamberPos && info.breakPart) {
          for (const p of info.chamberPos) {
            const o = this.tmpObj || (this.tmpObj = new THREE.Object3D());
            info.breakPart.add(o); o.position.copy(p);
            this.ejectCase('shell', o, V(rand(-0.2, 0.2), rand(1.6, 2.2), rand(1.2, 1.8)));
            o.removeFromParent();
          }
          info.chamber.visible = false;
        }
        break;
    }
  }

  reloadEvents(k) {
    const R = this.rl;
    if (!R) return;
    if (R.style === 'shells') {
      // je Patrone: bei 50 % der Teilstrecke eingeschoben
      const w = this.weapon;
      for (let i = R.done; i < R.n; i++) {
        const t = R.s0 + (i + 0.5) * R.per;
        if (this.prevK < t && k >= t) {
          R.done = i + 1;
          if (w.reserve > 0 && w.mag < w.stats.mag) { w.mag++; w.reserve--; }
          this.fireEvent('shellInsert');
        }
      }
      if (R.empty) {
        const t0 = R.s1 + (1 - R.s1) * 0.35, t1 = R.s1 + (1 - R.s1) * 0.68;
        if (this.prevK < t0 && k >= t0) this.fireEvent('pumpBack');
        if (this.prevK < t1 && k >= t1) this.fireEvent('pumpForward');
      }
      return;
    }
    for (const [t, name] of R.tl.ev) if (this.prevK < t && k >= t) this.fireEvent(name);
    if (R.style === 'break' && this.prevK < 0.56 && k >= 0.56 && this.info.chamber) this.info.chamber.visible = true;
  }

  drawEvents(k) {
    const tl = DRAWTL[DRAW[this.info ? this.info.id : 'p45']];
    if (!tl) return;
    for (const [t, name] of tl.ev) if (this.prevK < t && k >= t) this.fireEvent(name);
  }

  drinkEvents() {
    const t = this.stateT, b = this.bottle;
    if (!b) return;
    if (this.bottleState === 0 && t >= 0.15) {
      this.bottleState = 1;
      this.throwLoose(b.userData.cap, V(0.5, 1.3, -0.1), 0.7);
    }
    if (this.bottleState === 1 && t >= 1.9) {
      this.bottleState = 2;
      this.throwLoose(b, V(2.4, 1.2, -0.6), 0.6);
      this.bottle = null;
    }
  }

  // Teil lösen und mit Schwung aus dem Bild fliegen lassen (Kameraraum)
  throwLoose(obj, vel, life) {
    this.scene.attach(obj);
    this.loose.push({ obj, vel, spin: V(rand(-8, 8), rand(-8, 8), rand(-14, -6)), life });
  }

  pullPin() {
    const L = this.arms.side[1].hand;
    L.attach(this.pin);
  }
  resetPin() {
    this.nade.add(this.pin);
    this.pin.position.set(-0.012, 0.046, 0.0); this.pin.rotation.set(0, 0, 0); this.pin.visible = true;
  }

  // ── Viewmodel-Animation ─────────────────────────────────────
  animate(dt, input) {
    const g = this.g, player = g.player, info = this.info;
    const w = this.weapon;
    const ads = smooth(this.ads);
    const k = this.stateDur > 0 ? clamp(this.stateT / this.stateDur, 0, 1) : 0;
    this.sprintBlend = damp(this.sprintBlend, player.sprinting && this.state !== 'reload' ? 1 : 0, 7, dt);
    this.swayX = damp(this.swayX, clamp(-input.lookX * 0.3, -0.06, 0.06), 10, dt);
    this.swayY = damp(this.swayY, clamp(input.lookY * 0.3, -0.06, 0.06), 10, dt);
    this.sinceShot += dt; this.cycleT += dt; this.pumpT += dt;
    this.heat = Math.max(0, this.heat - dt * 0.9);

    // Rückstoß-Feder (Halbschritte für Stabilität)
    const c = this.kickCfg, wn = c.w, zt = c.z;
    for (let s = 0; s < 3; s++) {
      const h = dt / 3;
      for (let i = 0; i < 3; i++) {
        this.kv[i] += (-wn * wn * this.kp[i] - 2 * zt * wn * this.kv[i]) * h; this.kp[i] += this.kv[i] * h;
        this.kw[i] += (-wn * wn * this.kr[i] - 2 * zt * wn * this.kw[i]) * h; this.kr[i] += this.kw[i] * h;
      }
    }

    // Grundhaltung: Hüfte ↔ Kimme
    const hip = info ? info.hip : _v.set(0.12, -0.13, -0.27);
    const pos = _p.copy(hip);
    const sightY = info ? info.sightY : 0.07;
    pos.lerp(_w.set(0, -sightY, info ? info.adsZ : -0.2), ads);
    let rx = 0.015 * (1 - ads), ry = 0.05 * (1 - ads), rz = 0;
    // Kimme: kurzes Einrollen beim Anlegen
    rz -= Math.sin(ads * Math.PI) * 0.045;

    // Atmen, Laufen, Umsehen, Springen
    const t = this.time;
    const amb = 1 - ads * 0.85;
    pos.y += Math.sin(t * 1.35) * 0.0017 * amb; pos.x += Math.sin(t * 0.68) * 0.001 * amb;
    rx += Math.sin(t * 1.35 + 0.6) * 0.004 * amb; ry += Math.sin(t * 0.55) * 0.003 * amb;
    const mf = clamp(player.hSpeed / 4.4, 0, 1.5) * (player.onGround ? 1 : 0.2);
    const bob = player.bobPhase, sp = this.sprintBlend;
    const bobAmt = (1 - ads * 0.85) * (1 + sp * 1.4);
    pos.x += Math.sin(bob) * 0.009 * mf * bobAmt;
    pos.y += -Math.abs(Math.cos(bob)) * 0.011 * mf * bobAmt;
    rz += Math.sin(bob) * 0.014 * mf * bobAmt;
    rx += Math.cos(bob * 2) * 0.012 * mf * bobAmt * sp;
    pos.x += this.swayX * (1 - ads * 0.75); pos.y += this.swayY * (1 - ads * 0.75);
    ry += this.swayX * 1.3; rx += this.swayY * 0.9; rz += this.swayX * 0.6;
    pos.y += clamp(player.vel.y * -0.006, -0.03, 0.03) - player.landT * 0.03;

    // Sprint
    if (sp > 0.001) {
      const S = SPRINT[w && LIGHT.includes(w.stats.cls) ? 'light' : w && HEAVY.includes(w.stats.cls) ? 'heavy' : 'rifle'];
      pos.x += S[0] * sp; pos.y += S[1] * sp; pos.z += S[2] * sp;
      rx += S[3] * sp; ry += S[4] * sp; rz += S[5] * sp;
    }

    // Rückstoß
    pos.x += this.kp[0]; pos.y += this.kp[1] * 0.02; pos.z += this.kp[2] * 0.045;
    rx += this.kr[0] * 0.035; ry += this.kr[1] * 0.03; rz += this.kr[2] * 0.03;

    // Zustände
    let hide = 0;
    const st = this.state;
    if (st === 'reload' && info) {
      const e = plateau(k, 0.14, 0.2);
      const style = this.rl ? this.rl.style : 'mag';
      if (style === 'cell' && info.id === 'ray') { rz += 0.5 * e; rx += 0.15 * e; ry -= 0.15 * e; pos.x -= 0.02 * e; pos.y += 0.01 * e; }
      else if (style === 'break') { const o = keyed(TL.break.brk, k); rx += 0.2 * o; rz -= 0.25 * o; ry += 0.12 * o; pos.x -= 0.045 * o; pos.y += 0.05 * o; pos.z -= 0.04 * o; }
      else if (style === 'shells') { rz -= 0.55 * e; rx += 0.08 * e; ry += 0.15 * e; pos.x -= 0.04 * e; pos.y += 0.03 * e; pos.z -= 0.06 * e; }
      else { rz -= 0.5 * e; rx += 0.24 * e; ry += 0.2 * e; pos.x -= 0.05 * e; pos.y += 0.065 * e; pos.z += 0.03 * e; }
      // Pistole: beim Durchladen nach vorn schieben (Hand bleibt vor dem Gesicht weg)
      if (style === 'pistol' && this.rl.empty) { const e2 = plateau(seg(k, 0.6, 0.92), 0.25, 0.3); pos.z -= 0.06 * e2; pos.x -= 0.02 * e2; rz += 0.15 * e2; }
    } else if (st === 'raise') hide = 1 - smooth(k);
    else if (st === 'draw') {
      hide = 1 - sseg(k, 0, 0.32);
      if (DRAW[info && info.id] === 'energy') { rz += Math.sin(sseg(k, 0.25, 0.75) * Math.PI) * 0.6; rx += Math.sin(sseg(k, 0.25, 0.75) * Math.PI) * 0.15; }
      else { const e = plateau(seg(k, 0.36, 0.9), 0.2, 0.3); rz -= 0.3 * e; ry += 0.12 * e; rx += 0.06 * e; pos.z -= 0.06 * e; pos.x -= 0.02 * e; pos.y += 0.02 * e; }
    } else if (st === 'lower') hide = smooth(k);
    else if (st === 'knife') hide = plateau(k, 0.12, 0.3);
    else if (st === 'throw') hide = plateau(k, 0.12, 0.3);
    else if (st === 'drink') hide = sseg(this.stateT, 0, 0.25);
    if (!w || !info) hide = 1;
    pos.y -= 0.32 * hide; rx -= 0.95 * hide; pos.x += 0.06 * hide; rz -= 0.25 * hide;

    this.root.position.copy(pos);
    this.root.rotation.set(rx, ry, rz);
    this.root.visible = !!info && !(w && w.stats.scope && this.ads > 0.9);

    if (info) this.animParts(dt, k);
    this.root.updateMatrixWorld(true);
    this.animHands(dt, k);
    this.arms.root.visible = this.root.visible || BUSY.includes(st);
    if (this.arms.root.visible) this.arms.update();

    // Lose Teile (Kronkorken, Flasche, Ring)
    for (let i = this.loose.length - 1; i >= 0; i--) {
      const L = this.loose[i];
      L.life -= dt;
      L.vel.y -= 9 * dt;
      L.obj.position.addScaledVector(L.vel, dt);
      L.obj.rotation.x += L.spin.x * dt; L.obj.rotation.y += L.spin.y * dt; L.obj.rotation.z += L.spin.z * dt;
      if (L.life <= 0) { L.obj.removeFromParent(); this.loose.splice(i, 1); }
    }

    // Mündungsfeuer, Licht, Rauch
    this.flash.update(dt);
    this.vmFlash.intensity = Math.max(0, this.vmFlash.intensity - dt * 70);
    if (info) {
      info.muzzle.getWorldPosition(this.vmFlash.position);
      // Rauchfahnen nach Dauerfeuer bzw. nach Schrot/Scharfschütze
      if (this.heat > 1.2 && this.sinceShot > 0.08 && this.sinceShot < 2.5 && !this.flash.group.visible && this.root.visible) {
        this.smokeAcc += dt * Math.min(14, this.heat * 3.5);
        while (this.smokeAcc > 1) { this.smokeAcc -= 1; this.smoke.spawn(this.vmFlash.position, Math.min(2, this.heat / 2)); }
      }
    }
    const h = g.rs ? g.rs.renderer.domElement.height : innerHeight;
    this.smoke.update(dt, input.lookX, input.lookY, h / (2 * Math.tan((g.vmCamera.fov * Math.PI) / 360)));

    // Tesla-Kern flackert
    if (info && info.core) { const f = 0.85 + Math.sin(t * 31) * 0.1 + Math.sin(t * 17.3) * 0.08 + (this.sinceShot < 0.3 ? 1.5 * (1 - this.sinceShot / 0.3) : 0); info.core.color.setRGB(info.pap ? 1.7 * f : 0.45 * f, info.pap ? 0.45 * f : 1.1 * f, 2.6 * f); }

    // PaP-Tarnmuster animieren
    this.M.tex.papCamo.offset.x += dt * 0.08;
    this.M.tex.papCamo.offset.y += dt * 0.03;

    // Waffenlicht an Umgebung anpassen
    const lvl = g.lightLevel || 0.5;
    this.hemi.intensity = 0.25 + lvl * 0.9;
    this.key.intensity = 0.2 + lvl * 1.6;
    this.rim.intensity = 0.1 + lvl * 0.35;
  }

  // Bewegliche Waffenteile
  animParts(dt, k) {
    const info = this.info, w = this.weapon, st = this.state;
    const R = st === 'reload' ? this.rl : null;
    const D = st === 'draw' ? DRAWTL[DRAW[info.id]] : null;
    const tl = R && R.tl ? R.tl : D;
    // Magazin
    if (info.mag) {
      let out = 0, off = 0, vis = 1;
      if (R && R.tl && R.tl.mag) { out = keyed(R.tl.mag, k, 1); off = keyed(R.tl.mag, k, 2); vis = keyed(R.tl.mag, k, 3) > 0.5 ? 1 : 0; }
      const m = info.mag;
      m.position.copy(info.magHome).addScaledVector(info.magDir, out).lerp(_v.copy(info.magHome).add(info.magOff), off * 0.999);
      m.rotation.copy(info.magRot);
      m.rotation.x += off * 0.5; m.rotation.z += off * 0.3;
      m.visible = vis > 0;
    }
    // Schlitten (Pistole): Rückstoß, offen bei leerem Magazin, Durchladen
    if (info.slide) {
      let s = this.cycleT < 0.075 ? Math.sin((this.cycleT / 0.075) * Math.PI) : 0;
      if (w && w.mag === 0 && this.cycleT > 0.035) s = 1;
      if (tl && tl.slide) s = keyed(tl.slide, k);
      info.slide.position.z = info.slideHome.z + s * info.slideTravel;
    }
    // Ladehebel / Verschluss
    if (info.handle) {
      let s = 0;
      if (tl && tl.handle) s = keyed(tl.handle, k);
      else if (info.id === 'k14' || info.id === 'lmg') s = this.cycleT < 0.08 ? Math.sin((this.cycleT / 0.08) * Math.PI) * 0.85 : 0;
      info.handle.position.copy(info.handleHome).addScaledVector(info.handleTravel, s);
    }
    if (info.bolt) {
      let b = this.cycleT < 0.05 ? Math.sin((this.cycleT / 0.05) * Math.PI) : 0;
      if (w && w.mag === 0 && this.cycleT > 0.025) b = 1;
      if (R && R.empty && R.tl === TL.magSlap) b = k < 0.775 ? 1 : 0;
      info.bolt.position.z = b * 0.022;
    }
    // Vorderschaft (Pumpgun): nach dem Schuss, beim Nachladen (leer) und beim Ziehen
    if (info.pump) {
      let s = 0;
      if (this.pumpT < 0.5 && st !== 'reload') {
        const p = this.pumpT;
        s = p < 0.12 ? 0 : p < 0.22 ? smooth((p - 0.12) / 0.1) : p < 0.28 ? 1 : p < 0.38 ? 1 - smooth((p - 0.28) / 0.1) : 0;
        if (this.prevPump < 0.12 && p >= 0.12) this.fireEvent('pumpBack');
        if (this.prevPump < 0.2 && p >= 0.2) this.ejectCase('shell');
        if (this.prevPump < 0.3 && p >= 0.3) this.fireEvent('pumpForward');
      }
      this.prevPump = this.pumpT;
      if (R && R.style === 'shells' && R.empty) {
        const t0 = R.s1 + (1 - R.s1) * 0.25, t1 = R.s1 + (1 - R.s1) * 0.45, t2 = R.s1 + (1 - R.s1) * 0.6, t3 = R.s1 + (1 - R.s1) * 0.8;
        s = k < t0 ? 0 : k < t1 ? sseg(k, t0, t1) : k < t2 ? 1 : 1 - sseg(k, t2, t3);
      }
      if (D && D.pump) s = keyed(D.pump, k);
      info.pump.position.z = info.pumpHome.z + s * info.pumpTravel;
    }
    // Kipplauf
    if (info.breakPart) {
      let o = 0;
      if (R && R.tl && R.tl.brk) o = keyed(R.tl.brk, k);
      if (D && D.brk) o = keyed(D.brk, k);
      info.breakPart.rotation.x = -0.62 * o;
      if (info.chamber && st !== 'reload') info.chamber.visible = true;
    }
    // Deckel (LMG)
    if (info.cover) info.cover.rotation.x = R && R.tl && R.tl.cover ? -1.15 * keyed(R.tl.cover, k) : 0;
  }

  // Anker-Lage im Kameraraum
  frame(name, P, Qt) {
    const info = this.info;
    let o = null;
    if (info) o = name === 'rest' ? info.handL : name === 'mag' ? info.magGrab : name === 'handle' ? info.handleGrab : name === 'catch' ? info.catchGrab : name === 'slide' ? info.slideGrab : name === 'cover' ? info.coverGrab : name === 'shell' ? info.shellGrab : name === 'off' ? info.offL : name === 'grip' ? info.handR : null;
    if (!o) o = info && name !== 'off' ? info.handL : null;
    if (o) o.matrixWorld.decompose(P, Qt, _sc);
    else { const f = name === 'grip' ? this.offR : this.offL; P.copy(f.p); Qt.copy(f.q); }
  }

  // Hand-Zeitachse auswerten → Ziel und Pose
  handTrack(si, keys, k, defPose) {
    let a = keys[0], b = keys[0], t = 0;
    if (k > keys[0][0]) {
      b = keys[keys.length - 1]; a = b;
      for (let j = 1; j < keys.length; j++) if (k < keys[j][0]) { a = keys[j - 1]; b = keys[j]; t = smooth((k - a[0]) / (b[0] - a[0])); break; }
    }
    this.frame(a[1], _pa, _qa);
    if (b !== a) { this.frame(b[1], _pb, _qb); _pa.lerp(_pb, t); _qa.slerp(_qb, t); }
    this.arms.setTarget(si, _pa, _qa);
    const pa = a[2] === 'G' || !a[2] ? defPose : POSES[a[2]], pb = b[2] === 'G' || !b[2] ? defPose : POSES[b[2]];
    this.arms.setPose(si, pa, pb, t);
  }

  // Freie Schlüssel (Kameraraum) mit Übergang von/zu einem Anker
  freeTrack(si, keys, k, anchor, defPose) {
    const first = keys[0], last = keys[keys.length - 1];
    let pose = defPose, pose2 = null, t = 0;
    if (k <= first.k) {
      this.frame(anchor, _pa, _qa);
      const u = smooth(k / first.k);
      _pa.lerp(first.p, u); _qa.slerp(first.q, u);
      pose2 = POSES[first.pose]; t = u;
    } else if (k >= last.k) {
      this.frame(anchor, _pb, _qb);
      const u = smooth((k - last.k) / (1 - last.k));
      _pa.copy(last.p).lerp(_pb, u); _qa.copy(last.q).slerp(_qb, u);
      pose = POSES[last.pose]; pose2 = defPose; t = u;
    } else {
      for (let j = 1; j < keys.length; j++) if (k < keys[j].k) {
        const a = keys[j - 1], b = keys[j];
        const u = smooth((k - a.k) / (b.k - a.k));
        _pa.copy(a.p).lerp(b.p, u); _qa.copy(a.q).slerp(b.q, u);
        pose = POSES[a.pose]; pose2 = POSES[b.pose]; t = u;
        break;
      }
    }
    this.arms.setTarget(si, _pa, _qa);
    this.arms.setPose(si, pose, pose2, t);
  }

  animHands(dt, k) {
    const info = this.info, st = this.state, A = this.arms;
    const poseR = POSES[info ? info.poseR : 'pistol'] || POSES.pistol;
    const poseL = POSES[info ? info.poseL : 'handguard'] || POSES.handguard;
    this.knife.visible = st === 'knife' && k > 0.05 && k < 0.9;
    this.nade.visible = st === 'throw' && !this.thrownYet && k > 0.05;
    for (const s of this.shellsL) s.visible = false;
    // Rechte Hand
    if (st === 'knife') this.freeTrack(0, KNIFE, k, 'grip', poseR);
    else if (st === 'throw') this.freeTrack(0, THROW, k, 'grip', poseR);
    else if (st === 'drink') this.freeTrack(0, DRINK, k, 'grip', poseR);
    else { this.frame('grip', _pa, _qa); A.setTarget(0, _pa, _qa); A.setPose(0, poseR); }
    // Linke Hand
    if (!info) { this.frame('off', _pa, _qa); A.setTarget(1, _pa, _qa); A.setPose(1, POSES.relaxed); return; }
    if (st === 'reload' && this.rl) {
      const R = this.rl;
      if (R.style === 'shells') this.shellHand(k, poseL);
      else this.handTrack(1, R.tl.hand, k, poseL);
      if (R.style === 'break') { const vis = k > 0.34 && k < 0.56; this.shellsL[0].visible = vis; this.shellsL[1].visible = vis; }
    } else if (st === 'draw') this.handTrack(1, DRAWTL[DRAW[info.id]].hand, k, poseL);
    else if (st === 'throw') {
      // Linke Hand zieht den Sicherungsring
      const kk = k;
      if (kk < 0.12 || kk > 0.9) this.handTrack(1, REST, 0, poseL);
      else {
        _pb.copy(A.side[0].target);
        const pull = sseg(kk, 0.27, 0.38), away = sseg(kk, 0.4, 0.62);
        _pa.copy(_pb).add(_v.set(-0.07 - pull * 0.1, 0.06 - pull * 0.04 - away * 0.4, -0.01 + pull * 0.06));
        _qa.copy(PIN_Q);
        A.setTarget(1, _pa, _qa); A.setPose(1, POSES.pinch);
      }
    } else this.handTrack(1, REST, 0, poseL);
  }

  // Pumpgun: Patronen einzeln durch die Ladeöffnung
  shellHand(k, poseL) {
    const R = this.rl, A = this.arms;
    let a = 'rest', b = 'rest', t = 0, pa = poseL, pb = poseL, shell = false;
    if (k < R.s0) { a = 'rest'; b = 'off'; t = sseg(k, 0, R.s0 * 0.8); pb = POSES.shell; }
    else if (k < R.s1) {
      const u = (k - R.s0) / R.per, i = Math.floor(u), f = u - i;
      const lastOne = i >= R.n - 1;
      if (f < 0.4) { a = 'off'; b = 'shell'; t = smooth(f / 0.4); pa = pb = POSES.shell; shell = true; }
      else if (f < 0.55) { a = b = 'shell'; pa = pb = POSES.shell; shell = f < 0.5; }
      else { a = 'shell'; b = lastOne ? 'rest' : 'off'; t = smooth((f - 0.55) / 0.45); pa = POSES.shell; pb = lastOne ? poseL : POSES.shell; shell = false; }
    } else { a = b = 'rest'; }
    this.frame(a, _pa, _qa);
    if (a !== b) { this.frame(b, _pb, _qb); _pa.lerp(_pb, t); _qa.slerp(_qb, t); }
    // Einschieben: kurzer Stoß nach oben
    if (a === 'shell' && b === 'shell') _pa.y += 0.012 * Math.sin(seg(((k - R.s0) / R.per) % 1, 0.4, 0.55) * Math.PI);
    A.setTarget(1, _pa, _qa);
    A.setPose(1, pa, pb, t);
    this.shellsL[0].visible = shell;
  }

  reset() {
    this.slots = [null, null];
    this.grenades = 2;
    this.cur = 0;
    this.last = null; this.lastSlot = null;
    this.setState('idle');
    this.ads = 0; this.fireCd = 0; this.heat = 0; this.cycleT = 9; this.pumpT = 9; this.sinceShot = 9;
    this.kp.fill(0); this.kv.fill(0); this.kr.fill(0); this.kw.fill(0);
    this.drawn = new WeakSet();
    this.dropBottle();
    for (const L of this.loose) L.obj.removeFromParent();
    this.loose.length = 0;
    this.resetPin();
    this.flash.group.visible = false; this.knife.visible = false; this.nade.visible = false;
    this.projLight.intensity = 0;
    this.chainQ.length = 0;
    this.casings.clear(); this.smoke.clear();
    if (this.knifeLevel) { this.knife.removeFromParent(); this.knife = buildKnife(this.M); this.mountKnife(); this.knifeLevel = 0; }
    for (const p of this.projectiles) { p.active = false; p.mesh.visible = false; }
    for (const n of this.thrown) { n.active = false; n.mesh.visible = false; }
    this.give('p45');
  }
}
