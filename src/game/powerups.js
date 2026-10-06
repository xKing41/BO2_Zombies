// Power-Ups: Volle Munition, Sofort-Kill, Doppelte Punkte, Atombombe, Zimmermann
import * as THREE from 'three';
import * as T from '../core/textures.js';
import { POINTS } from '../config.js';
import { rand } from '../core/utils.js';

const TYPES = ['maxammo', 'instakill', 'double', 'nuke', 'carpenter'];

export class PowerUps {
  constructor(game) {
    this.g = game;
    this.items = [];
    this.timers = { instakill: 0, double: 0 };
    this.dropsThisRound = 0;
    this.last = null;
    this.icons = {};
    for (const t of TYPES) this.icons[t] = T.powerupIcon(t);
    const M = game.M;
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      const icon = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.75), new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false, color: new THREE.Color(1.8, 1.8, 1.8) }));
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.tex.glow, color: new THREE.Color(0.12, 0.8, 0.12), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      halo.scale.set(1.5, 1.5, 1);
      g.add(halo, icon);
      g.visible = false;
      game.scene.add(g);
      this.items.push({ group: g, icon, halo, active: false, type: null, t: 0 });
    }
  }

  get instaKill() { return this.timers.instakill > 0; }
  get double() { return this.timers.double > 0; }

  onKill(pos, opts) {
    if (opts.nuke || this.dropsThisRound >= 4) return;
    if (Math.random() > 0.03) return;
    this.drop(pos);
  }

  drop(pos, type = null) {
    const it = this.items.find((x) => !x.active);
    if (!it) return;
    const damaged = this.g.map.windows.some((w) => w.boards < 6);
    let options = TYPES.filter((t) => t !== this.last && (t !== 'carpenter' || damaged));
    type = type || options[Math.floor(Math.random() * options.length)];
    this.last = type;
    it.active = true; it.type = type; it.t = 0;
    it.icon.material.map = this.icons[type];
    it.icon.material.needsUpdate = true;
    it.group.position.set(pos.x, 1.0, pos.z);
    it.group.visible = true;
    this.dropsThisRound++;
    this.g.audio.powerupSpawn(it.group.position);
  }

  apply(type) {
    const g = this.g;
    g.audio.powerupGrab(type);
    g.hud.powerupBanner(type);
    switch (type) {
      case 'maxammo': g.weapons.refillAll(); break;
      case 'instakill': this.timers.instakill = 30; break;
      case 'double': this.timers.double = 30; break;
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

  update(dt, time) {
    for (const k in this.timers) this.timers[k] = Math.max(0, this.timers[k] - dt);
    const p = this.g.player;
    for (const it of this.items) {
      if (!it.active) continue;
      it.t += dt;
      const gp = it.group.position;
      gp.y = 1.0 + Math.sin(time * 2.5) * 0.12;
      it.icon.rotation.y += dt * 1.8;
      const blink = it.t > 22 ? (Math.sin(it.t * (it.t > 27 ? 30 : 14)) > 0 ? 1 : 0) : 1;
      it.group.visible = blink > 0;
      if (Math.random() < 0.2) this.g.effects.energy(gp, [0.3, 1.5, 0.3], 1, 0.3);
      if (Math.hypot(p.pos.x - gp.x, p.pos.z - gp.z) < 1.3 && !p.downed) {
        it.active = false; it.group.visible = false;
        this.apply(it.type);
      } else if (it.t > 30) {
        it.active = false; it.group.visible = false;
      }
    }
    this.g.hud.powerupTimers(this.timers);
  }

  reset() {
    for (const it of this.items) { it.active = false; it.group.visible = false; }
    this.timers.instakill = 0; this.timers.double = 0;
    this.dropsThisRound = 0;
  }
}
