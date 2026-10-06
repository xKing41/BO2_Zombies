// ─────────────────────────────────────────────────────────────
//  Zombie: prozedurales Modell mit Knochenhierarchie, Animation
//  (schlurfen, rennen, sprinten, angreifen, Bretter reißen,
//  durchs Fenster klettern, sterben) und Zustandsautomat.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { rand, pick, clamp, damp, dampAngle, smooth, lerp } from '../core/utils.js';
import { ZOMBIE_HIT_DAMAGE } from '../config.js';

let GEO = null;
function geos() {
  if (GEO) return GEO;
  const cap = (r, l) => new THREE.CapsuleGeometry(r, l, 4, 10);
  GEO = {
    pelvis: cap(0.14, 0.12).rotateZ(Math.PI / 2).scale(1.0, 1.0, 0.8),
    belly: cap(0.15, 0.12).scale(1.08, 1, 0.74),
    torso: cap(0.165, 0.17).scale(1.28, 1, 0.68),
    shoulder: new THREE.SphereGeometry(0.068, 12, 8),
    neckGeo: new THREE.CylinderGeometry(0.048, 0.06, 0.13, 10),
    head: new THREE.SphereGeometry(0.105, 18, 14).scale(0.9, 1.15, 1.0),
    jaw: new THREE.BoxGeometry(0.11, 0.045, 0.09),
    teeth: new THREE.BoxGeometry(0.075, 0.018, 0.02),
    brow: new THREE.BoxGeometry(0.15, 0.03, 0.04),
    nose: new THREE.BoxGeometry(0.028, 0.045, 0.035),
    eye: new THREE.SphereGeometry(0.014, 8, 6),
    elbow: new THREE.SphereGeometry(0.047, 10, 8),
    knee: new THREE.SphereGeometry(0.066, 10, 8),
    upperArm: cap(0.052, 0.22).translate(0, -0.16, 0),
    foreArm: cap(0.045, 0.2).translate(0, -0.14, 0),
    hand: new THREE.BoxGeometry(0.07, 0.11, 0.035).translate(0, -0.06, 0),
    thigh: cap(0.075, 0.3).translate(0, -0.22, 0),
    shin: cap(0.06, 0.32).translate(0, -0.21, 0),
    foot: new THREE.BoxGeometry(0.1, 0.07, 0.24).translate(0, -0.035, 0.05),
    hair: new THREE.SphereGeometry(0.12, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(0.95, 1.05, 1.05),
    neckStump: new THREE.CylinderGeometry(0.06, 0.07, 0.05, 10),
  };
  return GEO;
}

const _v = new THREE.Vector3(), _w = new THREE.Vector3();

export class Zombie {
  constructor(mgr) {
    this.mgr = mgr;
    this.M = mgr.M.zombie;
    this.active = false;
    this.build();
    this.pos = this.root.position;
    this.hitPts = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  }

  build() {
    const G = geos(), M = this.M;
    const mesh = (g, m, parent, x = 0, y = 0, z = 0) => {
      const o = new THREE.Mesh(g, m);
      o.position.set(x, y, z);
      o.castShadow = true;
      parent.add(o);
      return o;
    };
    const bone = (parent, x = 0, y = 0, z = 0) => { const b = new THREE.Group(); b.position.set(x, y, z); parent.add(b); return b; };

    const root = (this.root = new THREE.Group());
    root.rotation.order = 'YXZ';
    root.visible = false;
    const hips = (this.hips = bone(root, 0, 0.98, 0));
    this.pelvisMesh = mesh(G.pelvis, M.pants[0], hips, 0, 0, 0);
    const spine = (this.spine = bone(hips, 0, 0.06, 0));
    this.bellyMesh = mesh(G.belly, M.shirts[0], spine, 0, 0.14, 0.005);
    this.torsoMesh = mesh(G.torso, M.shirts[0], spine, 0, 0.38, 0);
    const neck = (this.neck = bone(spine, 0, 0.6, 0));
    this.neckMesh = mesh(G.neckGeo, M.skins[0], neck, 0, 0.0, 0.005);
    this.headMesh = mesh(G.head, M.skins[0], neck, 0, 0.14, 0.015);
    this.hair = mesh(G.hair, M.hair, this.headMesh, 0, 0.025, -0.01);
    this.brow = mesh(G.brow, M.skins[0], this.headMesh, 0, 0.035, 0.07);
    this.brow.scale.set(0.62, 1, 1);
    this.nose = mesh(G.nose, M.skins[0], this.headMesh, 0, -0.005, 0.098);
    this.jaw = mesh(G.jaw, M.skins[0], this.headMesh, 0, -0.09, 0.03);
    this.mouth = mesh(G.jaw, M.mouth, this.headMesh, 0, -0.072, 0.03);
    this.mouth.scale.set(0.85, 0.6, 0.95);
    mesh(G.teeth, M.teeth, this.headMesh, 0, -0.066, 0.075);
    mesh(G.teeth, M.teeth, this.jaw, 0, 0.018, 0.04);
    this.eyes = [mesh(G.eye, M.eye, this.headMesh, -0.035, 0.012, 0.088), mesh(G.eye, M.eye, this.headMesh, 0.035, 0.012, 0.088)];
    this.eyes.forEach((e) => (e.castShadow = false));
    this.stump = mesh(G.neckStump, M.gore, neck, 0, 0.03, 0);
    this.stump.visible = false;

    this.arms = [];
    for (const s of [-1, 1]) {
      const sh = bone(spine, s * 0.235, 0.5, 0);
      const delt = mesh(G.shoulder, M.shirts[0], sh, 0, -0.01, 0);
      const ua = mesh(G.upperArm, M.shirts[0], sh);
      const el = bone(sh, 0, -0.33, 0);
      const elb = mesh(G.elbow, M.skins[0], el);
      const fa = mesh(G.foreArm, M.skins[0], el);
      const hand = mesh(G.hand, M.skins[0], el, 0, -0.29, 0);
      this.arms.push({ sh, el, ua, fa, hand, delt, elb, s });
    }
    this.legs = [];
    for (const s of [-1, 1]) {
      const hp = bone(hips, s * 0.1, -0.04, 0);
      const th = mesh(G.thigh, M.pants[0], hp);
      const kn = bone(hp, 0, -0.45, 0);
      const knee = mesh(G.knee, M.pants[0], kn);
      const sh = mesh(G.shin, M.pants[0], kn);
      const ft = bone(kn, 0, -0.43, 0);
      const foot = mesh(G.foot, M.shoe, ft);
      this.legs.push({ hp, kn, ft, th, sh, foot, knee, s });
    }
    this.mgr.scene.add(root);
  }

  randomizeLook() {
    const M = this.M;
    const skin = pick(M.skins), shirt = pick(M.shirts), pants = pick(M.pants);
    for (const m of [this.headMesh, this.neckMesh, this.brow, this.nose, this.jaw]) m.material = skin;
    this.torsoMesh.material = shirt;
    this.bellyMesh.material = Math.random() < 0.15 ? skin : shirt;
    this.pelvisMesh.material = pants;
    const sleeveless = Math.random() < 0.3;
    const longSleeve = !sleeveless && Math.random() < 0.4;
    for (const a of this.arms) {
      a.ua.material = sleeveless ? skin : shirt; a.delt.material = sleeveless ? skin : shirt;
      a.fa.material = longSleeve ? shirt : skin; a.elb.material = longSleeve ? shirt : skin; a.hand.material = skin;
    }
    for (const l of this.legs) { l.th.material = pants; l.sh.material = pants; l.knee.material = pants; }
    this.headMesh.scale.set(rand(0.95, 1.05), rand(0.95, 1.08), rand(0.95, 1.05));
    this.hair.visible = Math.random() < 0.6;
    const s = rand(0.92, 1.08);
    this.scale = s;
    this.root.scale.set(s * rand(0.95, 1.05), s, s * rand(0.95, 1.05));
    this.armStyle = Math.random() < 0.65 ? 'reach' : Math.random() < 0.5 ? 'one' : 'hang';
    this.headTilt = rand(-0.35, 0.35);
    this.limp = Math.random() < 0.3 ? rand(0.1, 0.3) : 0;
  }

  spawn(win, hp, speedType) {
    this.active = true;
    this.root.visible = true;
    this.randomizeLook();
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
    this.flinch = 0;
    this.headless = false;
    this.headMesh.visible = true;
    this.neckMesh.visible = true;
    this.stump.visible = false;
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
  }

  despawn() {
    this.active = false;
    this.root.visible = false;
    this.root.rotation.set(0, 0, 0);
    if (this.win && this.win.occupant === this) this.win.occupant = null;
  }

  get alive() { return this.active && this.state !== 'dying'; }

  // Weltpositionen der Trefferzonen (Kopf, Brust, Becken, Oberschenkel)
  hitSpheres() {
    this.root.updateMatrixWorld(true);
    this.headMesh.getWorldPosition(this.hitPts[0]);
    this.torsoMesh.getWorldPosition(this.hitPts[1]);
    this.pelvisMesh.getWorldPosition(this.hitPts[2]);
    this.legs[0].kn.getWorldPosition(this.hitPts[3]);
    this.legs[1].kn.getWorldPosition(this.hitPts[4]);
    const s = this.scale;
    return [
      { p: this.hitPts[0], r: 0.15 * s, part: 'head' },
      { p: this.hitPts[1], r: 0.27 * s, part: 'torso' },
      { p: this.hitPts[2], r: 0.2 * s, part: 'torso' },
      { p: this.hitPts[3], r: 0.17 * s, part: 'limb' },
      { p: this.hitPts[4], r: 0.17 * s, part: 'limb' },
    ];
  }

  setState(s) { this.state = s; this.stateT = 0; }

  hurt(dir) {
    this.flinch = Math.min(1, this.flinch + 0.6);
  }

  die(headshot, dir) {
    this.setState('dying');
    this.fallDir = Math.random() < 0.6 ? -1 : 1; // -1 = rückwärts
    if (dir) {
      const fwd = Math.sin(this.yaw) * dir.x + Math.cos(this.yaw) * dir.z;
      this.fallDir = fwd > 0 ? 1 : -1;
    }
    this.fallSide = rand(-0.5, 0.5);
    this.limpPose = { a0: rand(-0.6, 0.2), a1: rand(-0.6, 0.2), l0: rand(-0.3, 0.3), l1: rand(-0.3, 0.3) };
    if (headshot) {
      this.headless = true;
      this.headMesh.visible = false;
      this.neckMesh.visible = false;
      this.stump.visible = true;
    }
    if (this.win && this.win.occupant === this) this.win.occupant = null;
  }

  // ── Haupt-Update ────────────────────────────────────────────
  update(dt, game) {
    this.time += dt;
    this.stateT += dt;
    this.flinch = Math.max(0, this.flinch - dt * 3);
    this.attackCd -= dt;
    const player = game.player;
    const win = this.win;

    if (this.state !== 'dying') {
      this.voiceT -= dt;
      if (this.voiceT <= 0) {
        this.voiceT = rand(2.5, 6.5);
        game.audio.zombieVoice(_v.copy(this.pos).setY(1.6), this.speedType === 'sprint' && Math.random() < 0.5 ? 'scream' : 'groan');
      }
    }

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
        const pd = player.pos.distanceTo(win.center);
        if (pd < 2.6 && !player.downed && this.attackCd <= 0) { this.setState('windowAttack'); break; }
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
          if (player.pos.distanceTo(win.center) < 2.7) player.damage(ZOMBIE_HIT_DAMAGE, this.pos);
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
      case 'attack': {
        this.moveSpeed = damp(this.moveSpeed, 0, 10, dt);
        const toP = Math.atan2(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
        this.yaw = dampAngle(this.yaw, toP, 10, dt);
        const dur = this.speedType === 'walk' ? 0.95 : 0.75;
        const k = this.stateT / dur;
        if (k >= 0.48 && !this.didHit) {
          this.didHit = true;
          game.audio.zombieSwipe(_v.copy(this.pos).setY(1.4));
          const d = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
          if (d < 1.75 && !player.downed) player.damage(ZOMBIE_HIT_DAMAGE, this.pos);
        }
        if (k >= 1) { this.didHit = false; this.attackCd = 0.25; this.setState('chase'); }
        break;
      }
      case 'dying': {
        this.moveSpeed = 0;
        if (this.stateT > 4.0) {
          this.pos.y -= dt * 0.35;
          if (this.stateT > 5.5) { this.despawn(); this.mgr.onDespawn(this); return; }
        }
        break;
      }
    }

    this.root.rotation.y = this.yaw;
    this.animate(dt);
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
    const player = game.player, map = game.map, mgr = this.mgr;
    const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);

    // Angriff
    if (dist < 1.25 && !player.downed && this.attackCd <= 0) {
      this.setState('attack');
      if (Math.random() < 0.5) game.audio.zombieVoice(_v.copy(this.pos).setY(1.6), 'attack');
      return;
    }

    // Navigation: alle 0.15 s neues Ziel per Flow-Field + Sichtlinien-Glättung
    this.navT -= dt;
    if (this.navT <= 0) {
      this.navT = 0.15 + Math.random() * 0.08;
      if (player.downed) {
        // Spieler wird wiederbelebt: ziellos umherwandern
        this.navTarget.set(this.pos.x + rand(-3, 3), 0, this.pos.z + rand(-3, 3));
        if (!map.clearPath(this.pos, this.navTarget)) this.navTarget.copy(this.pos);
      } else if (dist < 14 && map.clearPath(this.pos, player.pos, 0.25)) {
        this.navTarget.copy(player.pos);
      } else {
        mgr.pathTarget(this.pos, this.navTarget);
      }
      // Fortschritt prüfen (gegen Hängenbleiben)
      if (dist < this.lastDist - 0.3) { this.lastDist = dist; this.stuckT = 0; }
    }
    this.stuckT += dt;
    if (this.stuckT > 25 && dist > 10) { mgr.respawn(this); return; }

    const tx = this.navTarget.x - this.pos.x, tz = this.navTarget.z - this.pos.z;
    const td = Math.hypot(tx, tz);
    let vx = 0, vz = 0;
    if (td > 0.05) { vx = tx / td; vz = tz / td; }
    // Separation
    const sep = mgr.separation(this);
    vx += sep.x * 1.4; vz += sep.z * 1.4;
    const vl = Math.hypot(vx, vz);
    let sp = this.speed * (1 - this.flinch * 0.6) * (1 - this.limp * (0.5 + 0.5 * Math.sin(this.phase)));
    if (dist < 1.4) sp *= 0.3;
    if (vl > 0.01) {
      this.vel.x = damp(this.vel.x, (vx / vl) * sp, 8, dt);
      this.vel.z = damp(this.vel.z, (vz / vl) * sp, 8, dt);
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    map.collide(this.pos, 0.28, (x, y) => map.zombieWalkable(x, y), true);
    this.moveSpeed = Math.hypot(this.vel.x, this.vel.z);
    const face = dist < 4 ? Math.atan2(dx, dz) : Math.atan2(this.vel.x, this.vel.z);
    this.yaw = dampAngle(this.yaw, face, 6, dt);
  }

  // ── Prozedurale Animation ───────────────────────────────────
  animate(dt) {
    const A = this.arms, L = this.legs;
    const st = this.state, t = this.time;
    const type = this.speedType;
    const moving = this.moveSpeed > 0.15;
    const rate = type === 'walk' ? 3.4 : type === 'run' ? 2.6 : 2.25;
    this.phase += dt * this.moveSpeed * rate;
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    const amp = type === 'walk' ? 0.42 : type === 'run' ? 0.75 : 0.95;
    const mv = moving ? 1 : 0;

    // Grundpose
    let lean = type === 'walk' ? 0.22 : type === 'run' ? 0.42 : 0.55;
    let hipY = 0.98 - Math.abs(s) * 0.04 * mv - (type !== 'walk' ? 0.05 : 0);
    let legL = -s * amp * mv, legR = s * amp * mv;
    let kneeL = 0.1 + Math.max(0, c) * amp * 1.4 * mv, kneeR = 0.1 + Math.max(0, -c) * amp * 1.4 * mv;
    let armL, armR, elL, elR, armZL = 0.12, armZR = -0.12;
    if (type === 'sprint' || (type === 'run' && this.armStyle !== 'reach')) {
      armL = s * 0.9 * mv - 0.3; armR = -s * 0.9 * mv - 0.3; elL = -1.3; elR = -1.3;
    } else if (this.armStyle === 'hang') {
      armL = -0.2 + s * 0.2; armR = -0.15 - s * 0.2; elL = -0.2; elR = -0.3;
    } else {
      armL = -1.35 + Math.sin(this.phase + 1) * 0.12; armR = -1.3 + Math.sin(this.phase + 2.2) * 0.12;
      elL = -0.25; elR = -0.35;
      if (this.armStyle === 'one') { armR = -0.25 - s * 0.2; elR = -0.2; }
    }
    let spineX = lean + Math.sin(this.phase * 2) * 0.03 * mv;
    let spineZ = s * 0.07 * mv + Math.sin(t * 0.9) * 0.03;
    let spineY = s * 0.12 * mv;
    let neckX = -0.15 - lean * 0.5 + Math.sin(t * 1.7) * 0.05;
    let neckZ = this.headTilt + Math.sin(t * 0.6) * 0.15;
    let jaw = 0.15 + Math.max(0, Math.sin(t * 3.1)) * 0.25;
    let rootX = 0;

    if (st === 'tear' || st === 'windowAttack') {
      const k = st === 'tear' ? this.tearAnim || 0 : this.stateT / 0.8;
      if (k > 0) {
        const reach = k < 0.45 ? smooth(k / 0.45) : 1 - smooth((k - 0.45) / 0.55);
        const pull = k > 0.5 ? Math.sin(((k - 0.5) / 0.5) * Math.PI) : 0;
        armL = -1.4 - reach * 0.4 + pull * 0.6; armR = -1.5 - reach * 0.35 + pull * 0.7;
        elL = -0.15 - pull * 1.1; elR = -0.2 - pull * 1.2;
        spineX = 0.3 + reach * 0.25 - pull * 0.35;
        jaw = 0.5;
      } else { armL = -1.3; armR = -1.25; elL = -0.4; elR = -0.4; }
      legL = legR = 0; kneeL = kneeR = 0.15;
    } else if (st === 'climbIn') {
      const k = this.stateT / 1.4;
      const crouch = Math.sin(clamp(k, 0, 1) * Math.PI);
      hipY = 0.98 - crouch * 0.35;
      legL = -crouch * 1.2; legR = -crouch * 0.6; kneeL = crouch * 1.8; kneeR = crouch * 1.4;
      spineX = 0.5 + crouch * 0.3; armL = -1.0 - crouch * 0.6; armR = -0.8 - crouch * 0.8;
    } else if (st === 'attack') {
      const dur = type === 'walk' ? 0.95 : 0.75;
      const k = clamp(this.stateT / dur, 0, 1);
      const up = k < 0.35 ? smooth(k / 0.35) : 0;
      const down = k >= 0.35 ? (k < 0.6 ? smooth((k - 0.35) / 0.25) : 1 - smooth((k - 0.6) / 0.4)) : 0;
      armR = lerp(armR, -2.7, up) + down * 2.1; armL = lerp(armL, -2.3, up * 0.7) + down * 1.5;
      elR = -0.3 - up * 0.6; elL = -0.4 - up * 0.4;
      spineX = lean + down * 0.35 - up * 0.1;
      spineY = -up * 0.3 + down * 0.4;
      jaw = 0.6;
    } else if (st === 'dying') {
      const k = clamp(this.stateT / 0.85, 0, 1);
      const f = k * k; // Fallbeschleunigung
      const bounce = k >= 1 ? Math.max(0, Math.sin((this.stateT - 0.85) * 18) * Math.exp(-(this.stateT - 0.85) * 8)) * 0.05 : 0;
      rootX = this.fallDir * (Math.PI / 2 - 0.06) * f - this.fallDir * bounce;
      this.root.rotation.z = this.fallSide * f;
      hipY = lerp(0.98, 0.98, f);
      const lp = this.limpPose;
      armL = lerp(armL, this.fallDir > 0 ? -2.6 : 0.4 + lp.a0, f); armR = lerp(armR, this.fallDir > 0 ? -2.4 : 0.2 + lp.a1, f);
      elL = lerp(elL, -0.4, f); elR = lerp(elR, -0.2, f);
      legL = lerp(legL, lp.l0, f); legR = lerp(legR, lp.l1, f);
      kneeL = lerp(kneeL, 0.3, f); kneeR = lerp(kneeR, 0.6, f);
      spineX = lerp(spineX, 0, f); neckX = lerp(neckX, this.fallDir * 0.4, f);
      jaw = 0.7;
      // Körper liegt auf dem Rücken/Bauch: Wurzel leicht anheben, damit nichts im Boden steckt
      this.pos.y = Math.max(this.pos.y, 0) + (this.stateT < 4 ? (0.13 * f - this.pos.y) * Math.min(1, dt * 20) : 0);
    } else if (!moving) {
      armL += Math.sin(t * 1.3) * 0.05; armR += Math.sin(t * 1.1 + 1) * 0.05;
    }

    // Treffer-Zucken
    spineX -= this.flinch * 0.45;
    neckX -= this.flinch * 0.5;

    this.root.rotation.x = rootX;
    this.hips.position.y = hipY;
    this.spine.rotation.set(spineX, spineY, spineZ);
    this.neck.rotation.set(neckX, Math.sin(t * 0.8) * 0.2, neckZ);
    this.jaw.rotation.x = jaw;
    this.jaw.position.y = -0.085 - jaw * 0.02;
    A[0].sh.rotation.set(armL, 0, -armZL); A[1].sh.rotation.set(armR, 0, -armZR);
    A[0].el.rotation.x = elL; A[1].el.rotation.x = elR;
    L[0].hp.rotation.x = legL; L[1].hp.rotation.x = legR;
    L[0].kn.rotation.x = kneeL; L[1].kn.rotation.x = kneeR;
    L[0].ft.rotation.x = -legL * 0.3 - kneeL * 0.3; L[1].ft.rotation.x = -legR * 0.3 - kneeR * 0.3;
  }
}
