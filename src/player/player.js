// Spieler: Bewegung, Kamera, Gesundheit, Perks, Wiederbelebung
import * as THREE from 'three';
import { CELL } from '../config.js';
import { clamp, damp, lerp, dampAngle } from '../core/utils.js';

const _f = new THREE.Vector3(), _t = new THREE.Vector3();

export class Player {
  constructor(game) {
    this.g = game;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.reset();
  }

  reset() {
    const start = this.g.mapDef ? this.g.mapDef.playerStart : { cx: 0, cy: 0, yaw: 0 };
    this.pos.set(start.cx * CELL + CELL / 2, 0, start.cy * CELL + CELL / 2);
    this.vel.set(0, 0, 0);
    this.yaw = start.yaw; this.pitch = 0;
    this.recoilP = 0; this.recoilY = 0;
    this.onGround = true; this.crouch = 0; this.crouching = false;
    this.stamina = 1; this.sprinting = false; this.sprintLock = 0;
    this.maxHealth = 100; this.health = 100; this.lastHit = -99;
    this.perks = new Set();
    this.downed = false; this.reviveT = 0; this.selfRevives = 0;
    this.bobPhase = 0; this.stepDist = 0; this.shake = 0; this.hSpeed = 0;
    this.time = 0; this.hurtFlash = 0; this.landT = 0;
    this.eye = 1.65;
    this.snap = null; this.wasAds = false;
    this.stepY = 0; this.speedMul = 1;
  }

  get walkSpeed() { return 4.4 * (this.perks.has('sprint') ? 1.07 : 1); }

  stopSprint() { this.sprinting = false; this.sprintLock = 0.2; }

  addRecoil(p, y) {
    this.pitch += p * 0.35;
    this.recoilP += p * 0.65;
    this.yaw += y * 0.4;
    this.recoilY += y * 0.6;
  }

  damage(amount, from) {
    if (this.downed || this.g.state !== 'playing' || this.g.godMode) return;
    this.health -= amount;
    this.lastHit = this.time;
    this.hurtFlash = 1;
    this.shake = Math.max(this.shake, 0.35);
    this.g.audio.playerHurt();
    if (from) this.g.hud.damageDir(from, this);
    if (this.health <= 0) this.goDown();
  }

  goDown() {
    if (this.perks.has('phoenix')) {
      this.downed = true;
      this.reviveT = 6;
      this.selfRevives++;
      this.perks.clear();
      this.maxHealth = 100;
      this.health = 1;
      this.g.hud.perks(this.perks);
      this.g.hud.notice('Du bist am Boden … Phönix-Soda belebt dich wieder!');
      this.g.audio.setMuffle(0.85);
    } else {
      this.g.gameOver();
    }
  }

  // Nächster sichtbarer Zombie innerhalb eines Winkels um das Fadenkreuz
  aimTarget(maxAngle) {
    const g = this.g, cam = g.camera, o = cam.position;
    cam.getWorldDirection(_f);
    let best = null, bestA = maxAngle;
    for (const z of g.zombies.pool) {
      if (!z.alive) continue;
      _t.set(z.pos.x, z.pos.y + 1.35 * (z.scale || 1), z.pos.z).sub(o);
      const d = _t.length();
      if (d > 40 || d < 0.6) continue;
      const a = Math.acos(clamp(_t.dot(_f) / d, -1, 1));
      if (a >= bestA) continue;
      const dir = _t.clone().divideScalar(d);
      if (g.map.rayCast(o, dir, d).dist < d - 0.4) continue;
      bestA = a; best = dir;
    }
    return best;
  }

  // Zielhilfe für Controller & Touch: langsamer über Zielen, beim Anvisieren einrasten
  aimAssist(dt, s) {
    const g = this.g;
    const adsNow = g.weapons.ads > 0.2;
    if (adsNow && !this.wasAds) {
      const d = this.aimTarget(0.24);
      if (d) this.snap = { yaw: Math.atan2(-d.x, -d.z), pitch: Math.asin(clamp(d.y, -1, 1)), t: 0.16 };
    }
    this.wasAds = adsNow;
    if (this.snap) {
      this.yaw = dampAngle(this.yaw, this.snap.yaw, 22, dt);
      this.pitch = damp(this.pitch, this.snap.pitch, 22, dt);
      this.snap.t -= dt;
      if (this.snap.t <= 0) this.snap = null;
    }
    return this.aimTarget(0.075) ? s * 0.55 : s;
  }

  update(dt, input) {
    const g = this.g, map = g.map;
    this.time += dt;
    if (g.state === 'playing') {
      let s = g.settings.sensitivity * (g.weapons.ads > 0.5 ? 0.65 : 1) * (g.camera.fov / 75);
      if (input.device !== 'kbm' && g.settings.aimAssist && !this.downed) s = this.aimAssist(dt, s);
      this.yaw -= input.lookX * s;
      this.pitch -= input.lookY * s * (g.settings.invertY ? -1 : 1);
    }
    this.pitch = clamp(this.pitch, -1.5, 1.5);
    this.recoilP = damp(this.recoilP, 0, 7, dt);
    this.recoilY = damp(this.recoilY, 0, 7, dt);

    // Wiederbelebung
    if (this.downed) {
      this.reviveT -= dt;
      this.vel.x = damp(this.vel.x, 0, 6, dt); this.vel.z = damp(this.vel.z, 0, 6, dt);
      if (this.reviveT <= 0) {
        this.downed = false;
        this.health = this.maxHealth;
        g.hud.notice('Wiederbelebt!');
        g.audio.setMuffle(0);
      }
    }

    // Bewegung
    let fx = 0, fz = 0;
    const active = g.state === 'playing' && !this.downed;
    if (active) { fx = input.moveX; fz = input.moveY; }
    // Analoge Eingaben (Joystick, Controller) erlauben stufenloses Gehen
    const mag = Math.min(1, Math.hypot(fx, fz));
    const flen = Math.hypot(fx, fz);
    if (flen > 0.001) { fx /= flen; fz /= flen; }

    this.crouching = active && input.held('crouch');
    this.sprintLock -= dt;
    const wantSprint = active && input.held('sprint') && fz < -0.3 && !this.crouching && this.sprintLock <= 0 && g.weapons.ads < 0.3;
    const sprintDur = this.perks.has('sprint') ? 9 : 4.5;
    if (wantSprint && this.stamina > 0.02 && (this.sprinting || this.stamina > 0.25)) this.sprinting = true;
    else this.sprinting = false;
    if (this.sprinting) this.stamina = Math.max(0, this.stamina - dt / sprintDur);
    else this.stamina = Math.min(1, this.stamina + dt / 3);
    if (this.stamina <= 0) this.sprinting = false;

    let speed = this.walkSpeed * (this.sprinting ? 1.5 : mag) * this.speedMul;
    this.speedMul = 1;
    if (this.crouching) speed *= 0.5;
    speed *= lerp(1, 0.6, g.weapons.ads);
    if (this.downed) speed = 0;

    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const wx = fx * cy + fz * sy, wz = -fx * sy + fz * cy;
    const accel = this.onGround ? 11 : 2.5;
    this.vel.x = damp(this.vel.x, wx * speed, accel, dt);
    this.vel.z = damp(this.vel.z, wz * speed, accel, dt);

    if (active && input.hit('jump') && this.onGround && !this.crouching) {
      this.vel.y = 4.9; this.onGround = false;
    }
    this.vel.y -= 15 * dt;
    this.pos.addScaledVector(this.vel, dt);
    const floor = g.floorAt(this.pos);
    if (this.pos.y <= floor) {
      if (!this.onGround && this.vel.y < -3) { g.audio.jumpLand(); this.landT = 1; }
      const step = floor - this.pos.y;
      if (step > 0.1 && step < 0.8) this.stepY -= step; // Stufe hinauf: Kamera folgt weich
      this.pos.y = floor; this.vel.y = 0; this.onGround = true;
    } else if (this.pos.y > floor + 0.08) this.onGround = false;
    map.collide(this.pos, 0.36, (x, y) => map.playerWalkable(x, y), true);
    g.constrain(this.pos, 0.36);

    // Gesundheit regenerieren
    if (!this.downed && this.time - this.lastHit > 2.4 && this.health < this.maxHealth) {
      this.health = Math.min(this.maxHealth, this.health + 70 * dt);
    }
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.8);
    const lowHp = 1 - this.health / this.maxHealth;
    g.audio.setMuffle(this.downed ? 0.85 : Math.max(0, lowHp - 0.4) * 1.2);
    if (lowHp > 0.5 && !this.downed) {
      this.heartT = (this.heartT || 0) - dt;
      if (this.heartT <= 0) { this.heartT = 0.85; g.audio.heartbeat(); }
    }

    // Kopfbewegung & Schritte
    this.hSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround) {
      this.bobPhase += dt * this.hSpeed * (this.sprinting ? 1.9 : 2.3);
      this.stepDist += this.hSpeed * dt;
      const stride = this.sprinting ? 2.2 : 1.8;
      if (this.stepDist > stride) {
        this.stepDist = 0;
        const z = map.zoneAt(this.pos.x, this.pos.z);
        const surf = g.mapDef.surfaceAt ? g.mapDef.surfaceAt(map, this.pos) : z === 1 ? 'tiles' : z === 3 ? 'cobble' : 'stone';
        g.audio.footstep(surf, this.sprinting);
      }
    }
    this.crouch = damp(this.crouch, this.crouching ? 1 : this.downed ? 1.6 : 0, 10, dt);
    this.landT = Math.max(0, this.landT - dt * 4);
    this.stepY = damp(this.stepY, 0, 9, dt);
    this.shake = Math.max(0, this.shake - dt * 1.5);

    // Kamera
    const cam = g.camera;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.045 * Math.min(1, this.hSpeed / 4) * (1 - g.weapons.ads * 0.8);
    const bobX = Math.cos(this.bobPhase) * 0.025 * Math.min(1, this.hSpeed / 4) * (1 - g.weapons.ads * 0.8);
    const eye = this.eye - this.crouch * 0.6 - this.landT * 0.08 + this.stepY;
    cam.position.set(this.pos.x + bobX * cy, this.pos.y + eye + bobY, this.pos.z - bobX * sy);
    const sh = this.shake * this.shake;
    const t = this.time;
    const roll = (this.downed ? 0.25 : 0) + Math.sin(this.bobPhase) * 0.006 * Math.min(1, this.hSpeed / 4) - fx * 0.012;
    cam.rotation.set(
      this.pitch + this.recoilP + Math.sin(t * 37) * sh * 0.05,
      this.yaw + this.recoilY + Math.sin(t * 29) * sh * 0.05,
      roll + Math.sin(t * 23) * sh * 0.03,
      'YXZ',
    );
  }
}
