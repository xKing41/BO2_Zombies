// ─────────────────────────────────────────────────────────────
//  Waffensystem: Inventar, Schießen (Hitscan + Projektile),
//  Nachladen, Messer, Granaten, Perk-Trinken und Viewmodel-Animation.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { WEAPONS } from '../config.js';
import { buildGun, buildArms, buildKnife, buildGrenade, buildBottle } from './guns.js';
import { clamp, damp, lerp, rand, plateau, smooth } from '../core/utils.js';

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Vector3();
const _right = new THREE.Vector3(), _up = new THREE.Vector3();
const HIP = new THREE.Vector3(0.19, -0.19, -0.44);

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
    this.ads = 0; this.kick = 0; this.sprintBlend = 0; this.swayX = 0; this.swayY = 0;
    this.fireCd = 0; this.time = 0;
    this.grenades = 2;
    this.info = null;
    this.cache = {};
    this.thrown = [];
    this.projectiles = [];
    this.chainQ = [];
    this.knifeLevel = 0;

    // Mündungsfeuer
    const fm = new THREE.MeshBasicMaterial({ map: this.M.tex.flash, color: new THREE.Color(3, 2.2, 1.4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.flash = new THREE.Group();
    const p1 = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), fm);
    const p2 = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.3), fm); p2.rotation.y = Math.PI / 2; p2.position.z = -0.1;
    const p3 = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.3), fm); p3.rotation.set(Math.PI / 2, 0, Math.PI / 2); p3.position.z = -0.1;
    this.flash.add(p1, p2, p3);
    this.flash.visible = false;
    this.flashMat = fm;
    this.flashT = 0;

    this.knife = buildKnife(this.M); this.knife.visible = false; this.scene.add(this.knife);
    this.nade = buildGrenade(this.M); this.nade.visible = false; this.scene.add(this.nade);
    this.bottle = null;

    // Licht für die Waffenszene
    this.hemi = new THREE.HemisphereLight(0x8090b0, 0x201810, 0.6);
    this.key = new THREE.DirectionalLight(0xffe0c0, 1.2);
    this.key.position.set(0.5, 1, 0.3);
    this.vmFlash = new THREE.PointLight(0xffa050, 0, 2, 1.5);
    this.vmFlash.position.set(0.1, -0.05, -0.6);
    this.scene.add(this.hemi, this.key, this.vmFlash);

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
      m.scale.setScalar(1.3);
      m.visible = false;
      m.userData.dynamic = true;
      game.scene.add(m);
      this.thrown.push({ mesh: m, active: false, pos: m.position, vel: new THREE.Vector3(), fuse: 0 });
    }
  }

  // ── Inventar ────────────────────────────────────────────────
  makeSlot(id, pap = false) {
    const def = WEAPONS[id];
    const stats = pap ? { ...def, ...def.pap, pap: def.pap } : def;
    return { id, pap, stats, mag: stats.mag, reserve: stats.reserve };
  }
  get weapon() { return this.slots[this.cur]; }
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
    if (other >= 0) this.equip(other); else this.setModel(null);
    return s;
  }

  equip(idx) {
    this.cur = idx;
    this.setModel(this.slots[idx]);
    this.setState('raise', 0.5);
    this.g.audio.weaponSwitch();
    this.g.hud.weaponName(this.slots[idx]);
  }

  setModel(slot) {
    this.holder.clear();
    this.info = null;
    if (!slot) return;
    const key = slot.id + (slot.pap ? '_pap' : '');
    if (!this.cache[key]) {
      const info = buildGun(slot.id, this.M, slot.pap);
      info.group.add(buildArms(info, this.M));
      this.cache[key] = info;
    }
    this.info = this.cache[key];
    this.holder.add(this.info.group);
    this.info.muzzle.add(this.flash);
    this.flash.position.set(0, 0, -0.05);
  }

  refillAll() {
    for (const s of this.slots) if (s) s.reserve = s.stats.reserve;
    this.grenades = 4;
  }

  setState(s, dur = 0) { this.state = s; this.stateT = 0; this.stateDur = dur; }

  get busy() { return ['drink', 'knife', 'throw'].includes(this.state); }

  // ── Aktionen ────────────────────────────────────────────────
  reload() {
    const w = this.weapon;
    if (!w || this.state !== 'idle' || w.mag >= w.stats.mag || w.reserve <= 0) return;
    const dur = w.stats.reload * (this.g.player.perks.has('blitz') ? 0.5 : 1);
    this.setState('reload', dur);
    this.g.audio.reload(w.stats.cls, dur);
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
    if (this.bottle) this.scene.remove(this.bottle);
    this.bottle = buildBottle(perkColor);
    this.scene.add(this.bottle);
    this.onDrinkDone = onDone;
    this.g.audio.drink();
  }

  knifeAttack() {
    if (this.busy) return;
    this.setState('knife', this.knifeLevel ? 0.45 : 0.55);
    this.knifeHit = false;
    this.g.audio.knife();
  }

  throwGrenade() {
    if (this.busy || this.grenades <= 0) return;
    this.setState('throw', 0.65);
    this.thrownYet = false;
    this.g.audio.grenadePin();
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
        g.zombies.damage(h.z, dmg * mult, h.part, { dir: dir.clone(), point });
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

    // Rückstoß, Mündungsfeuer, Sound
    const rec = st.recoil * (1 - this.ads * 0.35) * (player.crouching ? 0.8 : 1);
    player.addRecoil(rec, (Math.random() - 0.5) * rec * 0.6);
    this.kick = Math.min(1.6, this.kick + (st.pellets > 1 || st.cls === 'sniper' ? 1.4 : 0.8));
    const flashColor = st.projectile ? st.projectile.color : st.lightning ? 0x66aaff : 0xffb060;
    g.effects.muzzle(muzzle, flashColor, st.projectile ? 0.6 : 1);
    this.flash.visible = !st.projectile && !st.lightning;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.scale.setScalar(rand(0.8, 1.25) * (st.pellets > 1 ? 1.4 : 1));
    this.flashT = 0.045;
    this.vmFlash.intensity = 3;
    g.audio.gunshot(st.sound, w.pap);
    if (st.cls === 'shotgun') { g.audio.pumpAction(); this.pumpT = 0.0001; }
    if (st.cls === 'sniper') this.boltT = 0.0001;
    if (this.info && this.info.slide) this.slideT = 0.0001;
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
        g.zombies.damage(c.z, 1e9, 'torso', { dir: c.to.clone().sub(c.from).normalize(), point: c.to.clone() });
        g.hud.hitmarker(false);
        g.effects.energy(c.to, c.color, 10, 0.4);
      }
    }
  }

  upgradeKnife() {
    this.knifeLevel = 1;
    this.scene.remove(this.knife);
    this.knife = buildKnife(this.M, true);
    this.knife.visible = false;
    this.scene.add(this.knife);
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
    }
  }

  // ── Update ──────────────────────────────────────────────────
  update(dt, input) {
    const g = this.g, player = g.player;
    this.time += dt;
    this.stateT += dt;
    this.fireCd -= dt;
    const w = this.weapon;
    const canAct = g.state === 'playing' && !player.downed;

    if (canAct) {
      // Waffenwechsel
      const wantSwitch = input.hit('slot1') ? 0 : input.hit('slot2') ? 1 : input.hit('switch') ? 1 - this.cur : -1;
      if (wantSwitch >= 0 && wantSwitch !== this.cur && this.slots[wantSwitch] && !this.busy && this.state !== 'lower') {
        this.setState('lower', 0.28);
        this.pendingSlot = wantSwitch;
      }
      if (input.hit('reload')) this.reload();
      if (input.hit('knife')) this.knifeAttack();
      if (input.hit('grenade')) this.throwGrenade();

      // Touch: Halbautomaten feuern beim Gedrückthalten wiederholt (Takt durch fireCd begrenzt)
      const wantFire = w && (w.stats.auto || input.device === 'touch' ? input.held('fire') : input.hit('fire'));
      if (wantFire && player.sprinting) player.stopSprint();
      if (wantFire && this.state === 'idle' && this.fireCd <= 0 && !player.sprinting) {
        if (w.mag > 0) this.fire();
        else if (w.reserve > 0) this.reload();
        else if (input.hit('fire')) g.audio.emptyClick();
      }
      // Automatisch nachladen, wenn Magazin leer
      if (w && w.mag === 0 && w.reserve > 0 && this.state === 'idle' && this.fireCd <= -0.15) this.reload();
    }

    // Zustandsautomat
    switch (this.state) {
      case 'reload':
        if (this.stateT >= this.stateDur) { this.finishReload(); this.setState('idle'); }
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
        if (!this.thrownYet && this.stateT > 0.3) { this.thrownYet = true; this.releaseGrenade(); }
        if (this.stateT >= this.stateDur) this.setState('idle');
        break;
      case 'drink':
        if (this.stateT >= this.stateDur) {
          this.scene.remove(this.bottle); this.bottle = null;
          this.setState('raise', 0.45);
          if (this.onDrinkDone) this.onDrinkDone();
        }
        break;
    }

    // ADS
    const adsWanted = canAct && input.held('ads') && w && (this.state === 'idle') && !player.sprinting;
    this.ads = damp(this.ads, adsWanted ? 1 : 0, w && w.stats.scope ? 9 : 14, dt);
    if (adsWanted && player.sprinting) player.stopSprint();

    this.updateProjectiles(dt);
    this.updateGrenades(dt);
    this.updateChain(dt);
    this.animate(dt, input);

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

  // ── Viewmodel-Animation ─────────────────────────────────────
  animate(dt, input) {
    const g = this.g, player = g.player, info = this.info;
    const w = this.weapon;
    const ads = smooth(this.ads);
    this.kick = damp(this.kick, 0, 13, dt);
    this.sprintBlend = damp(this.sprintBlend, player.sprinting ? 1 : 0, 8, dt);
    this.swayX = damp(this.swayX, clamp(-input.lookX * 0.27, -0.05, 0.05), 9, dt);
    this.swayY = damp(this.swayY, clamp(input.lookY * 0.27, -0.05, 0.05), 9, dt);

    const sightY = info ? info.sightY : 0.07;
    const back = info ? info.back : 0;
    const adsPos = _p.set(0, -sightY, Math.min(info ? info.adsZ : -0.3, -0.06 - back * 0.95));
    const pos = _q.copy(HIP);
    pos.z = Math.min(HIP.z, -0.18 - back);
    pos.lerp(adsPos, ads);
    let rx = 0, ry = 0, rz = 0;

    // Laufen / Atmen
    const mf = clamp(player.hSpeed / 4.4, 0, 1.5) * (player.onGround ? 1 : 0.2);
    const bob = player.bobPhase;
    const bobAmt = (1 - ads * 0.88) * (1 + this.sprintBlend * 1.2);
    pos.x += Math.sin(bob) * 0.011 * mf * bobAmt;
    pos.y += -Math.abs(Math.cos(bob)) * 0.012 * mf * bobAmt + Math.sin(this.time * 1.7) * 0.0018 * (1 - ads * 0.8);
    rz += Math.sin(bob) * 0.012 * mf * bobAmt;
    pos.x += this.swayX * (1 - ads * 0.7); pos.y += this.swayY * (1 - ads * 0.7);
    ry += this.swayX * 1.2; rx += this.swayY * 0.8;
    pos.y += clamp(player.vel.y * -0.006, -0.03, 0.03);

    // Sprinten
    const sp = this.sprintBlend;
    pos.x += 0.04 * sp; pos.y -= 0.06 * sp; pos.z += 0.03 * sp;
    rx -= 0.25 * sp; ry += 0.75 * sp; rz += 0.3 * sp;

    // Rückstoß
    pos.z += this.kick * 0.045 * (1 - ads * 0.4);
    pos.y += this.kick * 0.004;
    rx += this.kick * 0.09 * (1 - ads * 0.5);
    rz += this.kick * 0.01 * (Math.random() - 0.5);

    const k = this.stateDur > 0 ? clamp(this.stateT / this.stateDur, 0, 1) : 0;
    let hide = 0;
    switch (this.state) {
      case 'reload': {
        const e = plateau(k, 0.18, 0.22);
        pos.y -= 0.06 * e; pos.x -= 0.02 * e;
        rx += 0.25 * e; rz += 0.55 * e; ry -= 0.15 * e;
        if (info && info.mag) {
          const out = k > 0.15 && k < 0.7 ? plateau((k - 0.15) / 0.55, 0.3, 0.35) : 0;
          info.mag.position.copy(info.magHome);
          info.mag.position.y -= out * 0.22;
          info.mag.position.z += out * 0.05;
        }
        if (info && info.breakPart) info.breakPart.rotation.x = -0.6 * plateau(k, 0.2, 0.2);
        if (info && info.pump) info.pump.position.z = info.pumpHome.z + Math.max(0, Math.sin(k * Math.PI * 6)) * 0.03 * (k < 0.8 ? 1 : 0);
        break;
      }
      case 'raise': hide = 1 - smooth(k); break;
      case 'lower': hide = smooth(k); break;
      case 'knife': hide = 0.7; break;
      case 'throw': hide = 0.8; break;
      case 'drink': hide = 1; break;
    }
    if (player.downed || !w) hide = 1;
    if (g.state !== 'playing') hide = Math.max(hide, 0);
    pos.y -= 0.32 * hide; rx -= 0.9 * hide; pos.x += 0.05 * hide;

    // Teil-Animationen
    if (info) {
      if (this.state !== 'reload' && info.mag) info.mag.position.copy(info.magHome);
      if (info.pump && this.pumpT > 0) {
        this.pumpT += dt;
        const pk = this.pumpT / 0.55;
        info.pump.position.z = info.pumpHome.z + (pk > 0.25 && pk < 1 ? Math.sin(((pk - 0.25) / 0.75) * Math.PI) * 0.09 : 0);
        if (pk >= 1) this.pumpT = 0;
        rz += pk > 0.25 && pk < 1 ? 0.1 * Math.sin(((pk - 0.25) / 0.75) * Math.PI) : 0;
      }
      if (info.slide) {
        if (this.slideT > 0) { this.slideT += dt; if (this.slideT > 0.08) this.slideT = 0; }
        info.slide.position.z = -0.07 + (this.slideT > 0 ? 0.03 * Math.sin((this.slideT / 0.08) * Math.PI) : 0) + (w && w.mag === 0 ? 0.03 : 0);
      }
      if (this.boltT > 0) {
        this.boltT += dt;
        const bk = this.boltT / 0.9;
        if (bk > 0.2 && bk < 1) { const e = Math.sin(((bk - 0.2) / 0.8) * Math.PI); rz += 0.35 * e; pos.y -= 0.03 * e; }
        if (bk >= 1) this.boltT = 0;
      }
    }

    this.root.position.copy(pos);
    this.root.rotation.set(rx, ry, rz);
    this.root.visible = !(w && w.stats.scope && this.ads > 0.9);

    // Mündungsfeuer
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) { this.flash.visible = false; } }
    this.vmFlash.intensity = Math.max(0, this.vmFlash.intensity - dt * 60);

    // Messer
    if (this.state === 'knife') {
      const e = clamp(this.stateT / this.stateDur, 0, 1);
      this.knife.visible = true;
      const sw = smooth(clamp((e - 0.05) / 0.35, 0, 1));
      const back = smooth(clamp((e - 0.55) / 0.45, 0, 1));
      this.knife.position.set(lerp(0.3, -0.12, sw) + back * 0.4, lerp(-0.1, -0.16, sw) - back * 0.2, lerp(-0.3, -0.42, sw));
      this.knife.rotation.set(-0.2, lerp(0.9, -0.6, sw), lerp(-1.2, -1.6, sw));
    } else this.knife.visible = false;

    // Granate
    if (this.state === 'throw') {
      const e = clamp(this.stateT / this.stateDur, 0, 1);
      this.nade.visible = !this.thrownYet;
      const wind = smooth(clamp(e / 0.3, 0, 1));
      this.nade.position.set(0.18 + wind * 0.05, -0.12 + wind * 0.1, -0.3 + wind * 0.12);
    } else this.nade.visible = false;

    // Perk-Flasche
    if (this.state === 'drink' && this.bottle) {
      const e = clamp(this.stateT / this.stateDur, 0, 1);
      const up = smooth(clamp(e / 0.25, 0, 1)) * (1 - smooth(clamp((e - 0.85) / 0.15, 0, 1)));
      const tilt = smooth(clamp((e - 0.25) / 0.3, 0, 1)) * (1 - smooth(clamp((e - 0.8) / 0.15, 0, 1)));
      this.bottle.position.set(0.06, -0.38 + up * 0.22 + tilt * 0.06, -0.46 + tilt * 0.12);
      this.bottle.rotation.set(-0.15 + tilt * 1.5, 0, 0.25);
    }

    // PaP-Tarnmuster animieren
    this.M.tex.papCamo.offset.x += dt * 0.08;
    this.M.tex.papCamo.offset.y += dt * 0.03;

    // Waffenlicht an Umgebung anpassen
    const lvl = g.lightLevel || 0.5;
    this.hemi.intensity = 0.25 + lvl * 0.9;
    this.key.intensity = 0.2 + lvl * 1.6;
  }

  reset() {
    this.slots = [null, null];
    this.grenades = 2;
    this.cur = 0;
    this.setState('idle');
    this.ads = 0; this.kick = 0; this.fireCd = 0;
    this.pumpT = 0; this.boltT = 0; this.slideT = 0;
    if (this.bottle) { this.scene.remove(this.bottle); this.bottle = null; }
    this.flash.visible = false; this.knife.visible = false; this.nade.visible = false;
    this.projLight.intensity = 0;
    this.chainQ.length = 0;
    if (this.knifeLevel) { this.scene.remove(this.knife); this.knife = buildKnife(this.M); this.knife.visible = false; this.scene.add(this.knife); this.knifeLevel = 0; }
    for (const p of this.projectiles) { p.active = false; p.mesh.visible = false; }
    for (const n of this.thrown) { n.active = false; n.mesh.visible = false; }
    this.give('p45');
  }
}
