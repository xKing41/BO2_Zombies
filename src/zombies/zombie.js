// ─────────────────────────────────────────────────────────────
//  Zombie: prozedural modellierter Körper mit Knochenhierarchie,
//  Animation (schlurfen, rennen, sprinten, kriechen, angreifen,
//  Bretter reißen, durchs Fenster klettern, sterben), abtrennbare
//  Gliedmaßen und Zustandsautomat.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { rand, pick, clamp, damp, dampAngle, smooth, lerp, seededRandom } from '../core/utils.js';
import { ZOMBIE_HIT_DAMAGE } from '../config.js';
import { HEAD } from './body.js';

export { zombieTypes } from './body.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();
// Zustände in fester Reihenfolge (Koop-Schnappschüsse übertragen nur den Index)
export const ZSTATES = ['approach', 'tear', 'windowAttack', 'climbIn', 'chase', 'rise', 'board', 'attack', 'dying'];
const SPEEDS = ['walk', 'run', 'sprint'];

// Outfits: Farbpaletten-Indizes (siehe M.zombie.tints) und Zubehör
const OUTFITS = [
  { w: 5, name: 'zivil' },
  { w: 1.2, name: 'koch', shirt: [6, 5], pants: [2, 0], apron: true },
  { w: 1.4, name: 'buero', shirt: [6, 3, 9], pants: [2, 0, 4], tie: true, sleeves: 'long' },
  { w: 1.1, name: 'arbeiter', shirt: [8, 1, 4], pants: [4, 0, 1], hat: 'hardhat' },
  { w: 0.8, name: 'nackt', bare: true, pants: [0, 1, 5] },
];

export class Zombie {
  constructor(mgr, index) {
    this.mgr = mgr;
    this.index = index;
    this.M = mgr.M.zombie;
    this.active = false;
    this.drawn = false;
    this.build();
    this.pos = this.root.position;
    this.hitPts = [];
    for (let i = 0; i < 7; i++) this.hitPts.push(new THREE.Vector3());
    this.spheres = [
      { p: this.hitPts[0], r: 0.15, part: 'head', sub: null },
      { p: this.hitPts[1], r: 0.27, part: 'torso', sub: null },
      { p: this.hitPts[2], r: 0.2, part: 'torso', sub: null },
      { p: this.hitPts[3], r: 0.16, part: 'limb', sub: 'legR' },
      { p: this.hitPts[4], r: 0.16, part: 'limb', sub: 'legL' },
      { p: this.hitPts[5], r: 0.1, part: 'limb', sub: 'armR' },
      { p: this.hitPts[6], r: 0.1, part: 'limb', sub: 'armL' },
    ];
  }

  build() {
    const R = this.mgr.renderer, zi = this.index;
    // Platzhalter statt Meshes: der Instanz-Renderer übernimmt ihre Weltmatrizen
    const part = (key, parent, x = 0, y = 0, z = 0) => {
      const o = new THREE.Object3D();
      o.position.set(x, y, z);
      parent.add(o);
      R.add(zi, key, o);
      return o;
    };
    const bone = (parent, x = 0, y = 0, z = 0) => { const b = new THREE.Group(); b.position.set(x, y, z); parent.add(b); return b; };

    const root = (this.root = new THREE.Group());
    root.rotation.order = 'YXZ';
    root.visible = false;
    const hips = (this.hips = bone(root, 0, 0.98, 0));
    this.pelvisMesh = part('pelvis', hips);
    const spine = (this.spine = bone(hips, 0, 0.06, 0));
    this.belly = { shirt: part('belly_shirt', spine, 0, 0.14, 0.005), skin: part('belly_skin', spine, 0, 0.14, 0.005) };
    this.torso = { shirt: part('torso_shirt', spine, 0, 0.38, 0), skin: part('torso_skin', spine, 0, 0.38, 0) };
    this.chest = bone(spine, 0, 0.38, 0);
    // Hemdzipfel und Schürze hängen an der Hüfte (folgen nicht dem Vorbeugen)
    this.rag = part('rag', hips, 0, 0.085, 0);
    this.apron = part('apron', hips, 0, -0.12, 0);
    this.tie = part('tie', spine, 0, 0.58, 0.074);
    this.tie.rotation.x = -0.12;

    const neck = (this.neck = bone(spine, 0, 0.6, 0));
    this.neckMesh = part('neck', neck, 0, 0, 0.005);
    const head = (this.headMesh = bone(neck, 0, 0.14, 0.018));
    part('head', head);
    this.hair = part('hair', head);
    this.hairBald = part('hairBald', head);
    this.jaw = part('jaw', head, HEAD.jaw.x, HEAD.jaw.y, HEAD.jaw.z);
    part('teeth', head, HEAD.teethTop.x, HEAD.teethTop.y, HEAD.teethTop.z);
    const lower = part('teeth', this.jaw, 0, -0.003, 0.06);
    lower.rotation.z = Math.PI; lower.scale.set(0.92, 0.9, 0.92);
    this.eyes = HEAD.eyes.map((e) => part('eye', head, e.x, e.y, e.z));
    this.hardhat = part('hardhat', head, 0, HEAD.top.y - 0.045, -0.004);
    this.hardhat.rotation.x = -0.12;
    this.cap = part('cap', head, 0, HEAD.top.y - 0.035, 0.0);
    this.cap.rotation.x = -0.1;
    this.stump = part('stump', neck, 0, 0.1, 0);

    this.arms = [];
    for (const s of [-1, 1]) {
      const sh = bone(spine, s * 0.232, 0.51, -0.01);
      const delt = { shirt: part('delt_shirt', sh, 0, -0.012, 0), skin: part('delt_skin', sh, 0, -0.01, 0) };
      const ua = part('upperArm', sh);
      const sleeveU = part('sleeveUpper', sh);
      const el = bone(sh, 0, -0.33, 0);
      const fa = part('foreArm', el);
      const sleeveL = part('sleeveLower', el);
      const hand = part(s < 0 ? 'handR' : 'handL', el, 0, -0.29, 0);
      const stump = part('gibStump', el, 0, -0.015, 0);
      stump.rotation.x = Math.PI;
      const mid = bone(el, 0, -0.15, 0.01);
      this.arms.push({ sh, el, ua, fa, hand, delt, sleeveU, sleeveL, stump, mid, s, lost: false });
    }
    this.legs = [];
    for (const s of [-1, 1]) {
      const hp = bone(hips, s * 0.095, -0.05, 0);
      const th = part('thigh', hp);
      const kn = bone(hp, 0, -0.45, 0);
      const sh = part('shin', kn);
      const pl = part('pantsLower', kn);
      const ft = bone(kn, 0, -0.43, 0);
      const foot = part('foot', ft);
      const stump = part('gibStump', kn, 0, -0.03, 0);
      stump.rotation.x = Math.PI;
      this.legs.push({ hp, kn, ft, th, sh, pl, foot, stump, s, lost: false });
    }

    // Abgetrennte Gliedmaßen fliegen als eigene Teile davon (je Arm/Bein ein Stück)
    this.pieces = [];
    for (let i = 0; i < 4; i++) {
      const arm = i < 2;
      const pr = new THREE.Group();
      pr.visible = false;
      const a = { root: pr, arm, side: i % 2 ? 1 : -1, vel: new THREE.Vector3(), spin: new THREE.Vector3(), t: 0 };
      if (arm) {
        a.skin = part('foreArm', pr); a.cloth = part('sleeveLower', pr);
        a.end = part(a.side < 0 ? 'handR' : 'handL', pr, 0, -0.29, 0);
      } else {
        a.skin = part('shin', pr); a.cloth = part('pantsLower', pr);
        const ft = bone(pr, 0, -0.43, 0); a.end = part('foot', ft);
      }
      a.gore = part('gibStump', pr, 0, 0.012, 0);
      this.pieces.push(a);
    }
    this.mgr.scene.add(root);
  }

  // ── Aussehen ────────────────────────────────────────────────
  // Aussehen würfeln – mit Startwert, damit Mitspieler denselben Zombie sehen
  randomizeLook(seed = (Math.random() * 4294967296) >>> 0) {
    this.lookSeed = seed;
    const R = seededRandom(seed);
    const rand = (a = 0, b = 1) => a + R() * (b - a);
    const pick = (arr) => arr[Math.floor(R() * arr.length)];
    const T = this.M.tints;
    let total = 0;
    for (const o of OUTFITS) total += o.w;
    let r = R() * total, outfit = OUTFITS[0];
    for (const o of OUTFITS) { r -= o.w; if (r <= 0) { outfit = o; break; } }
    const idx = (list, n) => (list ? list[Math.floor(R() * list.length)] : Math.floor(R() * n));
    this.mgr.renderer.setTints(this.index, {
      skin: pick(T.skin),
      shirt: T.shirt[idx(outfit.shirt, T.shirt.length)],
      pants: T.pants[idx(outfit.pants, T.pants.length)],
    });
    this.outfit = outfit.name;
    const bare = !!outfit.bare;
    this.torso.shirt.visible = !bare; this.torso.skin.visible = bare;
    const bellySkin = bare || R() < 0.15;
    this.belly.skin.visible = bellySkin; this.belly.shirt.visible = !bellySkin;
    this.rag.visible = !bare && !bellySkin && R() < 0.75;
    this.rag.scale.set(rand(0.96, 1.06), rand(0.7, 1.25), rand(0.96, 1.06));
    // Ärmel: keine, kurz, lang, zerfetzt
    const sl = bare ? 'none' : outfit.sleeves || pick(['none', 'short', 'short', 'long', 'long', 'torn']);
    for (const a of this.arms) {
      a.delt.skin.visible = sl === 'none'; a.delt.shirt.visible = sl !== 'none';
      a.sleeveU.visible = sl !== 'none';
      a.sleeveU.scale.set(1, sl === 'short' ? rand(0.42, 0.6) : 1, 1);
      a.sleeveL.visible = sl === 'long' || sl === 'torn';
      a.sleeveL.scale.set(1, sl === 'torn' ? rand(0.35, 0.6) : rand(0.92, 1), 1);
      if (sl === 'torn' && R() < 0.4) a.sleeveL.visible = false;
    }
    // Hosenbeine: lang, zerrissen, kurz
    for (const l of this.legs) {
      const k = R();
      l.pl.visible = k > 0.08;
      l.pl.scale.set(1, k < 0.3 ? rand(0.3, 0.65) : rand(0.94, 1.02), 1);
    }
    // Kopf und Zubehör
    this.headMesh.scale.set(rand(0.95, 1.05), rand(0.96, 1.06), rand(0.95, 1.04));
    const h = R();
    this.hair.visible = h < 0.52;
    this.hairBald.visible = h >= 0.52 && h < 0.78;
    this.apron.visible = !!outfit.apron;
    this.tie.visible = !!outfit.tie;
    this.hardhat.visible = outfit.hat === 'hardhat' && R() < 0.85;
    this.cap.visible = !this.hardhat.visible && !outfit.tie && R() < 0.1;
    if (this.hardhat.visible || this.cap.visible) this.hair.visible = false;
    // Statur: hager bis massig
    const s = rand(0.92, 1.08);
    this.scale = s;
    this.root.scale.set(s * rand(0.95, 1.05), s, s * rand(0.95, 1.05));
    const belly = R() < 0.18 ? rand(1.12, 1.3) : rand(0.92, 1.04);
    for (const b of [this.belly.shirt, this.belly.skin]) b.scale.set(belly, 1, belly * 1.08);
    this.rag.scale.x *= Math.max(1, belly * 0.98); this.rag.scale.z *= Math.max(1, belly);
    this.apron.scale.set(Math.max(1, belly), 1, Math.max(1, belly));
    const w = rand(0.93, 1.06);
    for (const t of [this.torso.shirt, this.torso.skin]) t.scale.set(w, 1, w);
    this.armStyle = R() < 0.65 ? 'reach' : R() < 0.5 ? 'one' : 'hang';
    this.headTilt = rand(-0.35, 0.35);
    this.limp = R() < 0.35 ? rand(0.1, 0.32) : 0;
    this.hunch = rand(0.85, 1.25);
  }

  // Gliedmaßen und Kopf wieder anbringen (Pool-Wiederverwendung)
  restoreBody() {
    this.headless = false;
    this.headMesh.visible = true;
    this.stump.visible = false;
    for (const a of this.arms) {
      a.lost = false; a.stump.visible = false;
      a.fa.visible = true; a.hand.visible = true;
    }
    for (const l of this.legs) {
      l.lost = false; l.stump.visible = false;
      l.sh.visible = true; l.foot.visible = true;
    }
    for (const p of this.pieces) p.root.visible = false;
    this.crawler = false;
    this.crawlBlend = 0;
  }

  spawn(win, hp, speedType, seed) {
    this.active = true;
    this.root.visible = true;
    this.randomizeLook(seed);
    this.restoreBody();
    this.win = win;
    this.hp = this.maxHp = hp;
    this.speedType = speedType;
    this.speed = speedType === 'walk' ? rand(0.95, 1.25) : speedType === 'run' ? rand(2.5, 3.0) : rand(4.2, 4.7);
    this.pos.copy(win.spawn);
    this.pos.x += rand(-1.2, 1.2) * Math.abs(win.out.z);
    this.pos.z += rand(-1.2, 1.2) * Math.abs(win.out.x);
    this.pos.y = 0;
    this.yaw = Math.atan2(-win.out.x, -win.out.z);
    this.root.rotation.set(0, this.yaw, 0);
    this.state = 'approach';
    this.stateT = 0;
    this.phase = rand(0, 6);
    this.time = rand(0, 10);
    this.flinch = 0; this.flinchSide = 0; this.flinchHead = 0;
    this.attackT = 0;
    this.attackCd = 0;
    this.tearT = rand(0.3, 1.0);
    this.voiceT = rand(0.5, 4);
    this.navT = 0;
    this.navTarget = new THREE.Vector3();
    this.stuckT = 0;
    this.lastDist = Infinity;
    this.deathT = 0;
    this.climbFrom = new THREE.Vector3();
    this.moveSpeed = 0;
    this.vel = new THREE.Vector3();
    this.onBus = false;
    this.burning = 0;
    this.farT = 0;
    this.groundY = 0;
    this.lastStep = 0;
    this.eyeFade = 1;
    this.target = null; this.victim = null;
    this.nb = null; this.spawnedAt = performance.now() / 1000;
  }

  // Auf freiem Feld: Zombie erscheint an einer beliebigen Stelle (steigt aus dem Boden)
  spawnAt(pos, hp, speedType, seed) {
    this.spawn({ spawn: pos, out: new THREE.Vector3(0, 0, 1), outside: pos, center: pos, occupant: null, boards: 0, fake: true }, hp, speedType, seed);
    this.win = null;
    this.pos.copy(pos);
    this.yaw = Math.random() * Math.PI * 2;
    this.rise('chase');
  }

  // Aus dem Boden steigen, danach in den Zustand `next` wechseln
  rise(next) {
    this.afterRise = next;
    this.setState('rise');
    this.pos.y = -1.75;
  }

  despawn() {
    this.active = false;
    this.root.visible = false;
    this.root.rotation.set(0, 0, 0);
    for (const p of this.pieces) p.root.visible = false;
    if (this.win && this.win.occupant === this) this.win.occupant = null;
  }

  get alive() { return this.active && this.state !== 'dying'; }

  // Weltpositionen der Trefferzonen (Kopf, Brust, Becken, Knie, Unterarme)
  hitSpheres() {
    this.root.updateMatrixWorld(true);
    const P = this.hitPts;
    this.headMesh.getWorldPosition(P[0]);
    this.chest.getWorldPosition(P[1]);
    this.hips.getWorldPosition(P[2]);
    this.legs[0].kn.getWorldPosition(P[3]);
    this.legs[1].kn.getWorldPosition(P[4]);
    this.arms[0].mid.getWorldPosition(P[5]);
    this.arms[1].mid.getWorldPosition(P[6]);
    const s = this.scale, S = this.spheres;
    S[0].r = 0.15 * s; S[1].r = 0.27 * s; S[2].r = 0.2 * s; S[3].r = S[4].r = 0.16 * s;
    S[5].r = this.arms[0].lost ? 0 : 0.1 * s; S[6].r = this.arms[1].lost ? 0 : 0.1 * s;
    return S;
  }

  setState(s) { this.state = s; this.stateT = 0; }

  // Treffer-Reaktion: Kopf zurückschnappen, Oberkörper zur Trefferseite drehen
  hurt(dir, part, sub) {
    this.flinch = Math.min(1, this.flinch + 0.6);
    if (part === 'head') this.flinchHead = 1;
    if (dir) {
      const side = Math.cos(this.yaw) * dir.x - Math.sin(this.yaw) * dir.z;
      this.flinchSide = clamp(side * 1.5, -1, 1);
    }
    if (sub === 'legL' || sub === 'legR') this.stumble = 0.5;
  }

  // ── Zerstückelung ───────────────────────────────────────────
  // Unterarm (i = 0 rechts, 1 links) oder Unterschenkel abtrennen
  loseLimb(kind, i, dir, force = 4) {
    const limb = kind === 'arm' ? this.arms[i] : this.legs[i];
    if (!limb || limb.lost) return false;
    limb.lost = true;
    limb.stump.visible = true;
    const piece = this.pieces[(kind === 'arm' ? 0 : 2) + i];
    const joint = kind === 'arm' ? limb.el : limb.kn;
    this.root.updateMatrixWorld(true);
    joint.matrixWorld.decompose(piece.root.position, piece.root.quaternion, _s);
    piece.root.scale.copy(_s);
    if (kind === 'arm') {
      limb.fa.visible = false; limb.hand.visible = false;
      piece.cloth.visible = limb.sleeveL.visible; piece.cloth.scale.copy(limb.sleeveL.scale);
      limb.sleeveL.visible = false;
    } else {
      limb.sh.visible = false; limb.foot.visible = false;
      piece.cloth.visible = limb.pl.visible; piece.cloth.scale.copy(limb.pl.scale);
      limb.pl.visible = false;
    }
    piece.root.visible = true;
    piece.t = 0;
    const d = dir || _v.set(rand(-1, 1), 0, rand(-1, 1)).normalize();
    piece.vel.set(d.x * force + rand(-1.5, 1.5), rand(2, 4.5), d.z * force + rand(-1.5, 1.5));
    piece.spin.set(rand(-12, 12), rand(-6, 6), rand(-12, 12));
    piece.resting = false;
    return true;
  }

  // Kopf platzt
  popHead() {
    if (this.headless) return;
    this.headless = true;
    this.headMesh.visible = false;
    this.stump.visible = true;
  }

  // Beine weg → kriecht weiter
  makeCrawler() {
    if (this.crawler) return;
    this.crawler = true;
    this.crawlBlend = 0;
    this.speed = this.speedType === 'walk' ? rand(0.65, 0.85) : this.speedType === 'run' ? rand(1.0, 1.25) : rand(1.3, 1.55);
    this.navT = 0;
  }

  updatePieces(dt, game) {
    for (const p of this.pieces) {
      if (!p.root.visible) continue;
      p.t += dt;
      const pr = p.root;
      if (!p.resting) {
        p.vel.y -= 14 * dt;
        pr.position.addScaledVector(p.vel, dt);
        _q.setFromEuler(_e.set(p.spin.x * dt, p.spin.y * dt, p.spin.z * dt, 'XYZ'));
        pr.quaternion.multiply(_q);
        const floor = game.floorAt(pr.position) + 0.05;
        if (pr.position.y < floor) {
          pr.position.y = floor;
          if (Math.abs(p.vel.y) > 1.5) {
            p.vel.y *= -0.3; p.vel.x *= 0.5; p.vel.z *= 0.5; p.spin.multiplyScalar(0.5);
            if (p.t < 1.2) game.effects.blood(pr.position, _v.set(0, 1, 0), 0.3, false);
          } else {
            p.resting = true;
            // flach hinlegen
            _e.setFromQuaternion(pr.quaternion, 'YXZ');
            pr.quaternion.setFromEuler(_e.set(Math.PI / 2 * Math.sign(_e.x || 1), _e.y, 0, 'YXZ'));
          }
        }
        if (p.t < 0.8 && Math.random() < 0.6) game.effects.bloodTrail(pr.position);
      }
      pr.updateMatrixWorld(true);
    }
  }

  die(headshot, dir, opts = {}) {
    this.setState('dying');
    this.fallDir = Math.random() < 0.6 ? -1 : 1; // -1 = rückwärts
    if (dir) {
      const fwd = Math.sin(this.yaw) * dir.x + Math.cos(this.yaw) * dir.z;
      this.fallDir = fwd > 0 ? 1 : -1;
    }
    this.fallSide = rand(-0.5, 0.5);
    this.limpPose = { a0: rand(-0.6, 0.2), a1: rand(-0.6, 0.2), l0: rand(-0.3, 0.3), l1: rand(-0.3, 0.3) };
    this.deathKind = this.crawler ? 'crawl' : opts.fling ? 'fling' : opts.shock ? 'shock' : headshot ? 'drop' : Math.random() < 0.28 ? 'crumple' : 'fall';
    if (this.deathKind === 'fling') {
      const d = dir || _v.set(rand(-1, 1), 0, rand(-1, 1)).normalize();
      const f = opts.fling === true ? 1 : opts.fling;
      this.flingVel = new THREE.Vector3(d.x * rand(4, 7) * f, rand(3.5, 6) * f, d.z * rand(4, 7) * f);
      this.flingSpin = new THREE.Vector3(rand(4, 9) * (Math.random() < 0.5 ? -1 : 1), rand(-3, 3), rand(-5, 5));
      this.flingRot = new THREE.Vector3(0, 0, 0);
      this.landed = false;
    }
    if (headshot) this.popHead();
    if (this.win && this.win.occupant === this) this.win.occupant = null;
  }

  // ── Haupt-Update ────────────────────────────────────────────
  update(dt, game) {
    this.time += dt;
    this.stateT += dt;
    this.flinch = Math.max(0, this.flinch - dt * 3);
    this.flinchHead = Math.max(0, this.flinchHead - dt * 4);
    this.stumble = Math.max(0, (this.stumble || 0) - dt);
    this.attackCd -= dt;
    const win = this.win;
    // Ziel: nächster angreifbarer Überlebender (alle 0,4 s neu bestimmt)
    this.targetT = (this.targetT || 0) - dt;
    if (this.targetT <= 0 || !this.target || !this.target.targetable) { this.targetT = 0.4; this.target = game.nearestSurvivor(this.pos, this.target); }
    const tgt = this.target;

    if (this.state !== 'dying') {
      this.voiceT -= dt;
      if (this.voiceT <= 0) {
        this.voiceT = rand(2.5, 6.5);
        const p = _v.copy(this.pos).setY(this.crawler ? 0.4 : 1.6);
        if (this.crawler && game.audio.crawlerVoice) game.audio.crawlerVoice(p);
        else game.audio.zombieVoice(p, this.speedType === 'sprint' && Math.random() < 0.5 ? 'scream' : 'groan');
      }
    }
    if (this.crawler && this.crawlBlend < 1) this.crawlBlend = Math.min(1, this.crawlBlend + dt / 0.55);

    switch (this.state) {
      case 'approach': {
        let target = win.outside;
        if (win.occupant && win.occupant !== this) {
          target = _w.copy(win.outside).addScaledVector(win.out, 1.3 + (this.queueOff || 0));
        }
        const arrived = this.moveTo(target, dt, 0.12);
        if (arrived && (!win.occupant || win.occupant === this)) {
          win.occupant = this;
          this.setState(win.boards > 0 ? 'tear' : 'climbIn');
          if (this.state === 'climbIn') this.climbFrom.copy(this.pos);
        }
        if (arrived && win.occupant !== this) this.moveSpeed = 0;
        const sp = this.mgr.separation(this);
        this.pos.x += sp.x * dt * 1.5; this.pos.z += sp.z * dt * 1.5;
        this.queueOff = this.queueOff ?? rand(0, 1.5);
        break;
      }
      case 'tear': {
        this.yaw = dampAngle(this.yaw, Math.atan2(-win.out.x, -win.out.z), 8, dt);
        this.moveSpeed = 0;
        this.pos.lerp(win.outside, 1 - Math.exp(-6 * dt));
        // Spieler durchs Fenster angreifen
        const vic = this.attackCd <= 0 ? game.survivorNear(win.center, 2.6) : null;
        if (vic) { this.victim = vic; this.setState('windowAttack'); break; }
        this.tearT -= dt;
        if (this.tearT <= 0) {
          if (win.boards > 0) {
            this.tearAnim = 0.001;
            this.tearT = rand(1.0, 1.4) * (this.speedType === 'walk' ? 1.15 : 0.85);
          } else { this.setState('climbIn'); this.climbFrom.copy(this.pos); }
        }
        if (this.tearAnim > 0) {
          const prev = this.tearAnim;
          this.tearAnim += dt / 0.9;
          if (prev < 0.65 && this.tearAnim >= 0.65 && game.map.removeBoard(win)) game.audio.boardRip(win.center.clone().setY(1.6));
          if (this.tearAnim >= 1) this.tearAnim = 0;
        }
        break;
      }
      case 'windowAttack': {
        this.moveSpeed = 0;
        const k = this.stateT / 0.8;
        if (k >= 0.45 && !this.didHit) {
          this.didHit = true;
          game.audio.zombieSwipe(_v.copy(this.pos).setY(1.4));
          const v = this.victim;
          if (v && v.targetable && v.pos.distanceTo(win.center) < 2.7) v.hurt(ZOMBIE_HIT_DAMAGE, this.pos);
        }
        if (k >= 1) { this.didHit = false; this.attackCd = 1.0; this.setState('tear'); }
        break;
      }
      case 'climbIn': {
        const D = 1.4;
        const k = Math.min(1, this.stateT / D);
        const a = this.climbFrom, out = win.out;
        // Phase 1: hoch auf den Sims, 2: hinüber, 3: herunter
        let along, y;
        if (k < 0.25) { const t = smooth(k / 0.25); along = lerp(1.45, 0.95, t); y = t * 1.0; }
        else if (k < 0.75) { const t = (k - 0.25) / 0.5; along = lerp(0.95, -0.95, t); y = 1.0 + Math.sin(t * Math.PI) * 0.05; }
        else { const t = smooth((k - 0.75) / 0.25); along = lerp(-0.95, -1.5, t); y = (1 - t) * 1.0; }
        void a;
        this.pos.set(win.center.x + out.x * along, y, win.center.z + out.z * along);
        this.yaw = Math.atan2(-out.x, -out.z);
        this.moveSpeed = 0;
        if (k >= 1) {
          this.pos.y = 0;
          if (win.occupant === this) win.occupant = null;
          this.setState('chase');
          if (Math.random() < 0.6) game.audio.zombieVoice(_v.copy(this.pos).setY(1.6), 'attack');
        }
        break;
      }
      case 'chase': {
        this.chase(dt, game);
        break;
      }
      case 'rise': {
        const k = Math.min(1, this.stateT / 1.7);
        this.pos.y = -1.75 * (1 - smooth(k));
        this.moveSpeed = 0;
        if (Math.random() < 0.5) game.effects.norm.spawn({ x: this.pos.x + rand(-0.4, 0.4), y: 0.05, z: this.pos.z + rand(-0.4, 0.4), vx: rand(-0.6, 0.6), vy: rand(0.8, 2.2), vz: rand(-0.6, 0.6), life: rand(0.5, 1.0), size: rand(0.03, 0.07), size1: 0.02, alpha: 0.9, r: 0.16, g: 0.12, b: 0.08, grav: 9, drag: 0.5, fade: 0 });
        if (this.stateT < 0.05) game.audio.dirtRise(this.pos);
        if (k >= 1) {
          this.pos.y = 0;
          this.setState(this.afterRise || 'chase');
        }
        break;
      }
      case 'board': {
        const bus = this.bus;
        const k = Math.min(1, this.stateT / 1.0);
        this.local.lerpVectors(this.boardFrom, this.boardTo, smooth(k));
        const w = bus.toWorld(this.local, new THREE.Vector3());
        this.pos.set(w.x, Math.sin(k * Math.PI) * (this.boardWin ? 1.0 : 0.3) + k * 0.55, w.z);
        this.yaw = bus.yaw + Math.atan2(this.boardTo.x - this.boardFrom.x, this.boardTo.z - this.boardFrom.z);
        this.moveSpeed = 0;
        if (k >= 1) { this.groundY = 0.55; this.setState('chase'); }
        break;
      }
      case 'attack': {
        this.moveSpeed = damp(this.moveSpeed, 0, 10, dt);
        if (tgt) this.yaw = dampAngle(this.yaw, Math.atan2(tgt.pos.x - this.pos.x, tgt.pos.z - this.pos.z), 10, dt);
        const dur = this.speedType === 'walk' || this.crawler ? 0.95 : 0.75;
        const k = this.stateT / dur;
        if (k >= 0.48 && !this.didHit) {
          this.didHit = true;
          game.audio.zombieSwipe(_v.copy(this.pos).setY(this.crawler ? 0.5 : 1.4));
          const reach = this.crawler ? 1.9 : 1.75;
          if (tgt && tgt.targetable && this.armsLeft > 0 && Math.hypot(tgt.pos.x - this.pos.x, tgt.pos.z - this.pos.z) < reach) tgt.hurt(ZOMBIE_HIT_DAMAGE, this.pos);
        }
        if (k >= 1) { this.didHit = false; this.attackCd = 0.25; this.setState('chase'); }
        break;
      }
      case 'dying': {
        if (this.dyingStep(dt, game)) return;
        break;
      }
    }

    this.root.rotation.y = this.yaw;
    this.animate(dt, game);
    this.updatePieces(dt, game);
  }

  // Sterben: Wurf, Funken, Absinken – liefert true, wenn der Zombie verschwunden ist
  dyingStep(dt, game) {
    this.moveSpeed = 0;
    if (this.deathKind === 'fling') this.flight(dt, game);
    if (this.deathKind === 'shock' && this.stateT < 0.9 && Math.random() < 0.7) {
      const p = this.chest.getWorldPosition(_v);
      game.effects.energy(p.set(p.x + rand(-0.3, 0.3), p.y + rand(-0.5, 0.5), p.z + rand(-0.3, 0.3)), [0.8, 1.8, 4], 2, 0.1);
    }
    if (this.stateT > 4.0) {
      if (this.onBus) { this.despawn(); this.mgr.onDespawn(this); return true; }
      this.pos.y -= dt * 0.35;
      if (this.stateT > 5.5) { this.despawn(); this.mgr.onDespawn(this); return true; }
    }
    // Kopfloser Hals blutet kurz nach
    if (this.headless && this.stateT < 1.4 && Math.random() < 0.7) {
      const p = this.stump.getWorldPosition(_v);
      game.effects.norm.spawn({ x: p.x, y: p.y, z: p.z, vx: rand(-0.5, 0.5), vy: rand(1, 2.6) * (1.4 - this.stateT), vz: rand(-0.5, 0.5), life: rand(0.4, 0.8), size: rand(0.02, 0.045), size1: 0.015, alpha: 0.95, r: 0.32, g: 0.01, b: 0.01, grav: 9.8, drag: 0.4, fade: 0 });
    }
    return false;
  }

  get armsLeft() { return (this.arms[0].lost ? 0 : 1) + (this.arms[1].lost ? 0 : 1); }

  // Explosionswurf: Körper fliegt, dreht sich und schlägt auf
  flight(dt, game) {
    if (this.landed) return;
    const v = this.flingVel, s = this.flingSpin;
    v.y -= 14 * dt;
    this.pos.addScaledVector(v, dt);
    const floor = game.floorAt(this.pos);
    game.map.collide(this.pos, 0.3, (x, y) => game.map.zombieWalkable(x, y), true);
    this.flingRot.addScaledVector(s, dt);
    if (this.pos.y <= floor && v.y < 0) {
      this.pos.y = floor;
      if (v.y < -3) { v.y *= -0.25; v.x *= 0.5; v.z *= 0.5; s.multiplyScalar(0.4); game.effects.blood(_v.copy(this.pos).setY(floor + 0.3), _w.set(0, 1, 0), 0.5, false); }
      else { this.landed = true; this.groundY = floor; }
    }
  }

  moveTo(target, dt, eps = 0.1) {
    const dx = target.x - this.pos.x, dz = target.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < eps) { this.moveSpeed = damp(this.moveSpeed, 0, 8, dt); return true; }
    const sp = Math.min(this.speed, d / dt);
    this.pos.x += (dx / d) * sp * dt;
    this.pos.z += (dz / d) * sp * dt;
    this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 7, dt);
    this.moveSpeed = this.speed;
    return false;
  }

  chase(dt, game) {
    const map = game.map, mgr = this.mgr;
    const bus = game.bus;
    if (this.onBus) { this.chaseOnBus(dt, game, bus); return; }
    const player = this.target;
    if (!player) { this.moveSpeed = damp(this.moveSpeed, 0, 8, dt); return; }
    const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);

    // Weit abgehängt (z. B. Spieler fährt Bus): neu einreihen und in der Nähe auftauchen
    if (dist > 60) { this.farT += dt; if (this.farT > 3) { mgr.respawn(this); return; } } else this.farT = 0;

    // Gerade hingefallen: erst am Boden ankommen
    if (this.crawler && this.crawlBlend < 1) { this.moveSpeed = 0; return; }

    // Spieler sitzt im Bus: zum nächsten Einstieg laufen und einsteigen (Kriecher schaffen das nicht)
    if (bus && player.onBus && !this.crawler) {
      const bd = Math.hypot(bus.pos.x - this.pos.x, bus.pos.z - this.pos.z);
      if (bd < 24) {
        let best = null, bdist = Infinity;
        for (const bp of bus.boardPts) {
          const d = Math.hypot(bp.w.x - this.pos.x, bp.w.z - this.pos.z);
          if (d < bdist) { bdist = d; best = bp; }
        }
        if (best) {
          const vmax = this.speedType === 'sprint' ? 6 : this.speedType === 'run' ? 4 : 2.5;
          if (bdist < 0.8 && bus.v < vmax) { this.startBoard(bus, best); return; }
          this.navTarget.copy(best.w);
          this.steer(dt, game, dist);
          return;
        }
      }
    }

    // Angriff (ohne Arme nur noch beißen wollen – kein Schaden)
    const reach = this.crawler ? 1.45 : 1.25;
    if (dist < reach && player.targetable && this.attackCd <= 0 && player.pos.y < this.pos.y + 1.2) {
      this.setState('attack');
      if (Math.random() < 0.5) game.audio.zombieVoice(_v.copy(this.pos).setY(1.6), 'attack');
      return;
    }

    // Navigation: alle 0.15 s neues Ziel per Flow-Field + Sichtlinien-Glättung
    this.navT -= dt;
    if (this.navT <= 0) {
      this.navT = 0.15 + Math.random() * 0.08;
      if (!player.targetable) {
        // Niemand angreifbar (z. B. Wiederbelebung läuft): ziellos umherwandern
        this.navTarget.set(this.pos.x + rand(-3, 3), 0, this.pos.z + rand(-3, 3));
        if (!map.clearPath(this.pos, this.navTarget)) this.navTarget.copy(this.pos);
      } else if (dist < 14 && map.clearPath(this.pos, player.pos, 0.25)) {
        this.navTarget.copy(player.pos);
      } else {
        mgr.pathTarget(this.pos, this.navTarget, player.pos);
      }
      // Fortschritt prüfen (gegen Hängenbleiben)
      if (dist < this.lastDist - 0.3) { this.lastDist = dist; this.stuckT = 0; }
    }
    this.stuckT += dt;
    if (this.stuckT > (this.crawler ? 45 : 25) && dist > 10) { mgr.respawn(this); return; }
    this.steer(dt, game, dist);
  }

  // Auf navTarget zulaufen (mit Abstand zu anderen Zombies und Kollision)
  steer(dt, game, dist) {
    const player = this.target, map = game.map, mgr = this.mgr;
    const dx = player ? player.pos.x - this.pos.x : 0, dz = player ? player.pos.z - this.pos.z : 1;
    const tx = this.navTarget.x - this.pos.x, tz = this.navTarget.z - this.pos.z;
    const td = Math.hypot(tx, tz);
    let vx = 0, vz = 0;
    if (td > 0.05) { vx = tx / td; vz = tz / td; }
    // Separation
    const sep = mgr.separation(this);
    vx += sep.x * 1.4; vz += sep.z * 1.4;
    const vl = Math.hypot(vx, vz);
    let sp = this.speed * (1 - this.flinch * 0.6) * (1 - this.limp * (0.5 + 0.5 * Math.sin(this.phase))) * (this.stumble > 0 ? 0.55 : 1);
    if (this.crawler) sp *= 0.6 + 0.4 * Math.max(0, Math.sin(this.phase * 2)); // Ruck beim Ziehen
    if (dist < 1.4) sp *= 0.3;
    if (vl > 0.01) {
      this.vel.x = damp(this.vel.x, (vx / vl) * sp, 8, dt);
      this.vel.z = damp(this.vel.z, (vz / vl) * sp, 8, dt);
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    map.collide(this.pos, 0.28, (x, y) => map.zombieWalkable(x, y), true);
    this.moveSpeed = Math.hypot(this.vel.x, this.vel.z) / (this.crawler ? 0.6 : 1);
    const face = dist < 4 ? Math.atan2(dx, dz) : Math.atan2(this.vel.x, this.vel.z);
    this.yaw = dampAngle(this.yaw, face, 6, dt);
  }

  // ── Bus ─────────────────────────────────────────────────────
  startBoard(bus, bp) {
    this.onBus = true;
    this.bus = bus;
    this.local = bus.toLocal(this.pos, new THREE.Vector3());
    this.local.y = 0;
    this.boardFrom = this.local.clone();
    const sx = Math.sign(bp.l.x) || -1;
    this.boardTo = new THREE.Vector3(sx * 0.7, 0, bp.l.z);
    this.boardWin = bp.win;
    this.setState('board');
    this.climbFrom.copy(this.pos);
  }

  chaseOnBus(dt, game, bus) {
    const player = this.target;
    const H = 1.3, L = 5.6, CAB = 3.85, FLOOR = 0.55;
    if (!player || !player.onBus) {
      // Spieler ist ausgestiegen: durch Tür oder Fenster hinterher
      const sx = this.local.x < 0 || bus.doorIsOpen ? -1 : 1;
      this.local.set(sx * (H + 0.7), 0, bus.doorIsOpen ? 0 : this.local.z);
      const w = bus.toWorld(this.local, new THREE.Vector3());
      this.pos.set(w.x, 0, w.z);
      this.onBus = false;
      this.groundY = 0;
      this.navT = 0;
      return;
    }
    const pl = bus.toLocal(player.pos, new THREE.Vector3());
    const dx = pl.x - this.local.x, dz = pl.z - this.local.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.2 && player.targetable && this.attackCd <= 0) {
      this.setState('attack');
      if (Math.random() < 0.5) game.audio.zombieVoice(_v.copy(this.pos).setY(1.6), 'attack');
      return;
    }
    const sp = Math.min(this.speed, 2.6) * (1 - this.flinch * 0.6);
    if (d > 0.9) { this.local.x += (dx / d) * sp * dt; this.local.z += (dz / d) * sp * dt; }
    // Abstand zu anderen Zombies im Bus
    for (const o of this.mgr.pool) {
      if (o === this || !o.onBus || !o.alive) continue;
      const ox = this.local.x - o.local.x, oz = this.local.z - o.local.z, od = Math.hypot(ox, oz);
      if (od < 0.6 && od > 1e-4) { this.local.x += (ox / od) * (0.6 - od) * 0.5; this.local.z += (oz / od) * (0.6 - od) * 0.5; }
    }
    this.local.x = clamp(this.local.x, -H + 0.4, H - 0.4);
    this.local.z = clamp(this.local.z, -L + 0.4, CAB - 0.35);
    const w = bus.toWorld(this.local, new THREE.Vector3());
    this.pos.set(w.x, FLOOR, w.z);
    this.groundY = FLOOR;
    this.moveSpeed = d > 0.9 ? sp : 0;
    this.yaw = dampAngle(this.yaw, bus.yaw + Math.atan2(dx, dz), 8, dt);
  }

  // ── Koop: Puppe auf den Geräten der Mitspieler ──────────────
  // Der Host schickt Spawn-Daten und regelmäßige Schnappschüsse; hier wird nur
  // interpoliert und animiert (KI, Schaden und Entscheidungen bleiben beim Host).
  puppetSpawn(e, game) {
    const win = e.w >= 0 ? game.map.windows[e.w] : null;
    const at = new THREE.Vector3(e.p[0], e.p[1], e.p[2]);
    if (win) this.spawn(win, e.hp, e.ty, e.sd);
    else { this.spawn({ spawn: at, out: new THREE.Vector3(0, 0, 1), outside: at, center: at, occupant: null, boards: 0, fake: true }, e.hp, e.ty, e.sd); this.win = null; }
    this.uid = e.u;
    this.speed = e.sp;
    this.pos.copy(at);
    this.yaw = e.y;
    this.root.rotation.set(0, this.yaw, 0);
    this.state = ZSTATES[e.st] || 'approach';
    this.stateT = 0;
    this.afterRise = e.ar || null;
    this.nb = [{ t: performance.now() / 1000, x: at.x, y: at.y, z: at.z, yaw: e.y, ms: 0 }];
  }

  puppetSnap(r) {
    const nb = this.nb || (this.nb = []);
    nb.push(r);
    if (nb.length > 6) nb.shift();
    this.hp = r.hp;
    if ((r.flags & 1) && !this.crawler) this.makeCrawler();
    this.burning = r.flags & 2 ? Math.max(this.burning || 0, 0.3) : this.burning;
    const sp = SPEEDS[(r.flags >> 2) & 3];
    if (sp && sp !== this.speedType && !this.crawler) this.speedType = sp;
    if (r.st !== this.state && this.state !== 'dying' && r.st !== 'dying') {
      this.setState(r.st);
      this.stateT = r.stT;
      this.didHit = false;
      if (r.st === 'climbIn') this.climbFrom.copy(this.pos);
    }
  }

  puppet(dt, game) {
    this.time += dt;
    this.stateT += dt;
    this.flinch = Math.max(0, this.flinch - dt * 3);
    this.flinchHead = Math.max(0, this.flinchHead - dt * 4);
    this.stumble = Math.max(0, (this.stumble || 0) - dt);
    if (this.state === 'dying') {
      if (this.dyingStep(dt, game)) return;
    } else {
      this.voiceT -= dt;
      if (this.voiceT <= 0) {
        this.voiceT = rand(2.5, 6.5);
        const p = _v.copy(this.pos).setY(this.crawler ? 0.4 : 1.6);
        if (this.crawler && game.audio.crawlerVoice) game.audio.crawlerVoice(p);
        else game.audio.zombieVoice(p, this.speedType === 'sprint' && Math.random() < 0.5 ? 'scream' : 'groan');
      }
      if (this.crawler && this.crawlBlend < 1) this.crawlBlend = Math.min(1, this.crawlBlend + dt / 0.55);
      // Zwischen den Schnappschüssen des Hosts interpolieren (100 ms Verzögerung)
      const nb = this.nb;
      if (nb && nb.length) {
        const rt = performance.now() / 1000 - 0.1;
        let i = nb.length - 1;
        while (i > 0 && nb[i - 1].t > rt) i--;
        const b = nb[i], a = nb[Math.max(0, i - 1)];
        if (a === b || rt >= b.t) {
          this.pos.set(b.x, b.y, b.z); this.yaw = b.yaw; this.moveSpeed = damp(this.moveSpeed, b.ms, 10, dt);
        } else {
          const k = clamp((rt - a.t) / Math.max(1e-3, b.t - a.t), 0, 1);
          this.pos.set(lerp(a.x, b.x, k), lerp(a.y, b.y, k), lerp(a.z, b.z, k));
          let dy = b.yaw - a.yaw;
          dy -= Math.round(dy / (Math.PI * 2)) * Math.PI * 2;
          this.yaw = a.yaw + dy * k;
          this.moveSpeed = lerp(a.ms, b.ms, k);
        }
      }
      // Rein optische Teile der Zustände
      const st = this.state;
      if (st === 'rise' && Math.random() < 0.5) game.effects.norm.spawn({ x: this.pos.x + rand(-0.4, 0.4), y: 0.05, z: this.pos.z + rand(-0.4, 0.4), vx: rand(-0.6, 0.6), vy: rand(0.8, 2.2), vz: rand(-0.6, 0.6), life: rand(0.5, 1.0), size: rand(0.03, 0.07), size1: 0.02, alpha: 0.9, r: 0.16, g: 0.12, b: 0.08, grav: 9, drag: 0.5, fade: 0 });
      if (st === 'rise' && this.stateT < 0.05) game.audio.dirtRise(this.pos);
      if (st === 'attack' || st === 'windowAttack') {
        const dur = st === 'windowAttack' ? 0.8 : this.speedType === 'walk' || this.crawler ? 0.95 : 0.75;
        if (this.stateT / dur >= 0.46 && !this.didHit) { this.didHit = true; game.audio.zombieSwipe(_v.copy(this.pos).setY(this.crawler ? 0.5 : 1.4)); }
      }
      if (st === 'tear') {
        this.tearT -= dt;
        if (this.tearT <= 0 && !(this.tearAnim > 0)) { this.tearAnim = 0.001; this.tearT = rand(1.0, 1.4); }
        if (this.tearAnim > 0) { this.tearAnim += dt / 0.9; if (this.tearAnim >= 1) this.tearAnim = 0; }
      }
    }
    this.root.rotation.y = this.yaw;
    this.animate(dt, game);
    this.updatePieces(dt, game);
  }

  // ── Prozedurale Animation ───────────────────────────────────
  animate(dt, game) {
    const A = this.arms, L = this.legs;
    const st = this.state, t = this.time;
    const type = this.speedType;
    const moving = this.moveSpeed > 0.15;
    const rate = this.crawler ? 3.2 : type === 'walk' ? 3.4 : type === 'run' ? 2.6 : 2.25;
    const prevPhase = this.phase;
    this.phase += dt * this.moveSpeed * rate;
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    const amp = type === 'walk' ? 0.42 : type === 'run' ? 0.75 : 0.95;
    const mv = moving ? 1 : 0;

    // Schritte hörbar machen (nur nahe Zombies, gedrosselt)
    if (moving && !this.crawler && st !== 'dying' && game && Math.floor(prevPhase / Math.PI) !== Math.floor(this.phase / Math.PI)) {
      const pp = game.player.pos;
      if ((this.pos.x - pp.x) ** 2 + (this.pos.z - pp.z) ** 2 < 150 && this.mgr.stepBudget > 0 && game.audio.zombieStep) {
        this.mgr.stepBudget--;
        game.audio.zombieStep(this.pos, type !== 'walk');
      }
    }

    // Grundpose: gebeugt, Kopf vorgestreckt
    const hunch = this.hunch || 1;
    let lean = (type === 'walk' ? 0.26 : type === 'run' ? 0.44 : 0.58) * hunch;
    let hipY = 0.98 - Math.abs(s) * 0.04 * mv - (type !== 'walk' ? 0.05 : 0);
    let legL = -s * amp * mv, legR = s * amp * mv;
    let kneeL = 0.12 + Math.max(0, c) * amp * 1.4 * mv, kneeR = 0.12 + Math.max(0, -c) * amp * 1.4 * mv;
    let armL, armR, elL, elR, armZL = 0.12, armZR = -0.12;
    if (type === 'sprint' || (type === 'run' && this.armStyle !== 'reach')) {
      armL = s * 0.95 * mv - 0.35; armR = -s * 0.95 * mv - 0.35; elL = -1.35; elR = -1.35;
      armZL = 0.25; armZR = -0.25;
    } else if (this.armStyle === 'hang') {
      armL = -0.2 + s * 0.2; armR = -0.15 - s * 0.2; elL = -0.25; elR = -0.35;
    } else {
      armL = -1.32 + Math.sin(this.phase + 1) * 0.12; armR = -1.26 + Math.sin(this.phase + 2.2) * 0.12;
      elL = -0.35; elR = -0.45;
      if (this.armStyle === 'one') { armR = -0.25 - s * 0.2; elR = -0.25; }
    }
    let spineX = lean + Math.sin(this.phase * 2) * 0.03 * mv;
    let spineZ = s * 0.08 * mv + Math.sin(t * 0.9) * 0.04 + this.limp * s * 0.15 * mv;
    let spineY = s * 0.12 * mv;
    let neckX = -0.1 - lean * 0.45 + Math.sin(t * 1.7) * 0.05;
    let neckZ = this.headTilt + Math.sin(t * 0.6) * 0.15;
    let jaw = 0.12 + Math.max(0, Math.sin(t * 3.1 + this.index)) * 0.24;
    let rootX = 0, rootZ = 0;
    let legFL = 0, legFR = 0; // zusätzliche Fußneigung

    if (st === 'tear' || st === 'windowAttack') {
      const k = st === 'tear' ? this.tearAnim || 0 : this.stateT / 0.8;
      if (k > 0) {
        const reach = k < 0.45 ? smooth(k / 0.45) : 1 - smooth((k - 0.45) / 0.55);
        const pull = k > 0.5 ? Math.sin(((k - 0.5) / 0.5) * Math.PI) : 0;
        armL = -1.4 - reach * 0.4 + pull * 0.6; armR = -1.5 - reach * 0.35 + pull * 0.7;
        elL = -0.15 - pull * 1.1; elR = -0.2 - pull * 1.2;
        spineX = 0.3 + reach * 0.25 - pull * 0.35;
        jaw = 0.65;
      } else { armL = -1.3; armR = -1.25; elL = -0.4; elR = -0.4; }
      legL = legR = 0; kneeL = kneeR = 0.15;
    } else if (st === 'rise') {
      const k = clamp(this.stateT / 1.7, 0, 1);
      armL = -2.9 + Math.sin(t * 9) * 0.25 * (1 - k); armR = -2.7 + Math.sin(t * 8 + 1) * 0.25 * (1 - k);
      elL = -0.3; elR = -0.5;
      spineX = 0.5 - k * 0.3; neckX = -0.5 + k * 0.4;
      legL = legR = 0; kneeL = kneeR = 0.1;
      jaw = 0.8;
    } else if (st === 'climbIn' || st === 'board') {
      const k = st === 'board' ? this.stateT / 1.0 : this.stateT / 1.4;
      const crouch = Math.sin(clamp(k, 0, 1) * Math.PI);
      hipY = 0.98 - crouch * 0.35;
      legL = -crouch * 1.2; legR = -crouch * 0.6; kneeL = crouch * 1.8; kneeR = crouch * 1.4;
      spineX = 0.5 + crouch * 0.3; armL = -1.0 - crouch * 0.6; armR = -0.8 - crouch * 0.8;
    } else if (st === 'attack' && !this.crawler) {
      const dur = type === 'walk' ? 0.95 : 0.75;
      const k = clamp(this.stateT / dur, 0, 1);
      const up = k < 0.35 ? smooth(k / 0.35) : 0;
      const down = k >= 0.35 ? (k < 0.6 ? smooth((k - 0.35) / 0.25) : 1 - smooth((k - 0.6) / 0.4)) : 0;
      armR = lerp(armR, -2.7, up) + down * 2.1; armL = lerp(armL, -2.3, up * 0.7) + down * 1.5;
      elR = -0.3 - up * 0.6; elL = -0.4 - up * 0.4;
      spineX = lean + down * 0.35 - up * 0.1;
      spineY = -up * 0.3 + down * 0.4;
      jaw = 0.75;
    } else if (st === 'dying') {
      ({ hipY, rootX, rootZ, armL, armR, elL, elR, legL, legR, kneeL, kneeR, spineX, spineY, spineZ, neckX, jaw } =
        this.deathPose(dt, { hipY, armL, armR, elL, elR, legL, legR, kneeL, kneeR, spineX, spineY, spineZ, neckX, jaw }));
    } else if (!moving) {
      armL += Math.sin(t * 1.3) * 0.05; armR += Math.sin(t * 1.1 + 1) * 0.05;
    }

    // Kriechen: Oberkörper flach am Boden, Arme ziehen abwechselnd nach vorn
    if (this.crawler && st !== 'dying') {
      const b = smooth(this.crawlBlend);
      let cL = -2.2 - 0.55 * s * mv, cR = -2.2 + 0.55 * s * mv;
      let eL = -0.35 - 0.7 * Math.max(0, c) * mv, eR = -0.35 - 0.7 * Math.max(0, -c) * mv;
      let cSpineX = 1.42 + Math.sin(this.phase * 2) * 0.04 * mv;
      if (st === 'attack') {
        const k = clamp(this.stateT / 0.95, 0, 1);
        const up = k < 0.4 ? smooth(k / 0.4) : 1 - smooth((k - 0.4) / 0.6);
        cR = lerp(-2.2, -3.0, up); eR = -0.2; cSpineX = 1.42 - up * 0.35;
      }
      hipY = lerp(hipY, 0.2, b);
      spineX = lerp(spineX, cSpineX, b);
      spineY = lerp(spineY, s * 0.18 * mv, b);
      spineZ = lerp(spineZ, c * 0.08 * mv, b);
      neckX = lerp(neckX, -1.05 + Math.sin(t * 1.5) * 0.08, b);
      armL = lerp(armL, cL, b); armR = lerp(armR, cR, b);
      elL = lerp(elL, eL, b); elR = lerp(elR, eR, b);
      armZL = lerp(armZL, 0.28, b); armZR = lerp(armZR, -0.28, b);
      legL = lerp(legL, 1.42 + s * 0.1 * mv, b); legR = lerp(legR, 1.42 - s * 0.1 * mv, b);
      kneeL = lerp(kneeL, 0.25, b); kneeR = lerp(kneeR, 0.35, b);
      jaw = 0.6 + Math.max(0, Math.sin(t * 4)) * 0.25;
    }

    // Treffer-Zucken: Oberkörper weicht zurück, Kopf schnappt, Drehung zur Trefferseite
    spineX -= this.flinch * 0.45;
    neckX -= this.flinch * 0.35 + this.flinchHead * 0.7;
    spineY += this.flinchSide * this.flinch * 0.5;
    spineZ += this.flinchSide * this.flinch * 0.15;

    // Ohne Unterarm hängt der Stumpf eher herab
    if (A[0].lost) { armR = lerp(armR, -0.5, 0.5); }
    if (A[1].lost) { armL = lerp(armL, -0.5, 0.5); }

    this.root.rotation.x = rootX;
    this.root.rotation.z = rootZ;
    this.hips.position.y = hipY;
    this.spine.rotation.set(spineX, spineY, spineZ);
    this.neck.rotation.set(neckX, Math.sin(t * 0.8) * 0.2, neckZ);
    this.jaw.rotation.x = jaw;
    A[0].sh.rotation.set(armR, 0, -armZL); A[1].sh.rotation.set(armL, 0, -armZR);
    A[0].el.rotation.x = elR; A[1].el.rotation.x = elL;
    L[0].hp.rotation.x = legR; L[1].hp.rotation.x = legL;
    L[0].kn.rotation.x = kneeR; L[1].kn.rotation.x = kneeL;
    L[0].ft.rotation.x = -legR * 0.3 - kneeR * 0.3 + legFR; L[1].ft.rotation.x = -legL * 0.3 - kneeL * 0.3 + legFL;
  }

  // Todesanimationen: nach hinten/vorne fallen, zusammensacken, umgeworfen werden, Stromschlag
  deathPose(dt, p) {
    const T = this.stateT, lp = this.limpPose, kind = this.deathKind;
    const gy = this.groundY || 0;
    const settle = (rest) => { this.pos.y = Math.max(this.pos.y, gy) + (T < 4 ? (gy + rest - this.pos.y) * Math.min(1, dt * 20) : 0); };
    p.jaw = 0.8;
    if (kind === 'crawl') {
      const k = smooth(clamp(T / 0.5, 0, 1));
      p.hipY = 0.16; p.spineX = 1.5; p.neckX = lerp(-1.0, 0.1, k);
      p.armL = lerp(-2.2, -2.9, k); p.armR = lerp(-2.2, -1.6, k); p.elL = -0.2; p.elR = -0.6;
      p.legL = 1.45; p.legR = 1.4; p.kneeL = 0.2; p.kneeR = 0.3;
      return { ...p, rootX: 0, rootZ: 0 };
    }
    if (kind === 'fling') {
      const r = this.flingRot;
      let rootX, rootZ;
      if (this.landed) {
        // nach der Landung flach auf Rücken oder Bauch liegen bleiben
        const tx = Math.sign(Math.sin(r.x) || 1) * (Math.PI / 2 - 0.06);
        r.x = damp(r.x, tx, 8, dt); r.z = damp(r.z, 0.2 * Math.sign(r.z), 6, dt);
        settle(0.13);
      }
      rootX = r.x; rootZ = r.z;
      const flop = Math.sin(T * 9) * Math.exp(-T * 2) * 0.6;
      return {
        ...p, rootX, rootZ, hipY: 0.98,
        armL: -1.8 + flop + lp.a0, armR: -2.4 - flop + lp.a1, elL: -0.4, elR: -0.9,
        legL: 0.5 + lp.l0 - flop * 0.5, legR: -0.3 + lp.l1 + flop * 0.5, kneeL: 0.8, kneeR: 0.4,
        spineX: 0.2, spineY: flop * 0.4, spineZ: 0, neckX: 0.4,
      };
    }
    let delay = 0, k, sideFall = 0;
    let crumple = 0;
    if (kind === 'shock') {
      delay = 0.9;
      if (T < delay) {
        // zuckt unter Strom, Arme abgespreizt
        const j = () => (Math.random() - 0.5) * 0.5;
        return {
          ...p, rootX: j() * 0.1, rootZ: j() * 0.1, hipY: 0.98 + j() * 0.04,
          armL: -1.6 + j(), armR: -1.7 + j(), elL: -0.2 + j(), elR: -0.3 + j(),
          spineX: -0.1 + j() * 0.4, spineY: j(), spineZ: j() * 0.4, neckX: -0.5 + j(), jaw: 0.9 + j() * 0.2,
          legL: j() * 0.3, legR: j() * 0.3, kneeL: 0.2, kneeR: 0.2,
        };
      }
    }
    if (kind === 'crumple') {
      // Knie geben nach, dann kippt der Körper zur Seite
      crumple = smooth(clamp(T / 0.45, 0, 1));
      delay = 0.4;
      sideFall = this.fallSide >= 0 ? 1 : -1;
    }
    const drop = kind === 'drop';
    const dur = drop ? 0.6 : 0.85;
    k = clamp((T - delay) / dur, 0, 1);
    const f = k * k; // Fallbeschleunigung
    const bounce = k >= 1 ? Math.max(0, Math.sin((T - delay - dur) * 18) * Math.exp(-(T - delay - dur) * 8)) * 0.05 : 0;
    let rootX, rootZ;
    if (kind === 'crumple') {
      rootX = this.fallDir * 0.35 * f;
      rootZ = sideFall * (Math.PI / 2 - 0.1) * f - sideFall * bounce;
    } else {
      rootX = this.fallDir * (Math.PI / 2 - 0.06) * f - this.fallDir * bounce;
      rootZ = this.fallSide * f;
    }
    if (drop) { p.hipY = lerp(0.98, 0.7, smooth(clamp(T / 0.25, 0, 1))); }
    p.hipY = lerp(p.hipY, kind === 'crumple' ? 0.55 : 0.98, kind === 'crumple' ? crumple : 0);
    p.armL = lerp(p.armL, this.fallDir > 0 ? -2.6 : 0.4 + lp.a0, f); p.armR = lerp(p.armR, this.fallDir > 0 ? -2.4 : 0.2 + lp.a1, f);
    p.elL = lerp(p.elL, -0.4, f); p.elR = lerp(p.elR, -0.2, f);
    p.legL = lerp(p.legL, lp.l0 - crumple * 0.9, Math.max(f, crumple)); p.legR = lerp(p.legR, lp.l1 - crumple * 0.6, Math.max(f, crumple));
    p.kneeL = lerp(p.kneeL, 0.3 + crumple * 1.4, Math.max(f, crumple)); p.kneeR = lerp(p.kneeR, 0.6 + crumple * 1.1, Math.max(f, crumple));
    p.spineX = lerp(p.spineX, crumple * 0.5, f); p.neckX = lerp(p.neckX, this.fallDir * 0.4, f);
    // Körper liegt: Wurzel leicht anheben, damit nichts im Boden steckt
    settle(0.13 * f);
    return { ...p, rootX, rootZ };
  }
}
