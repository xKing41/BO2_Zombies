// ─────────────────────────────────────────────────────────────
//  Überlebende: alle Spieler einer Partie – der eigene (lokal) und
//  Mitspieler im Koop (über das Netz). Zombies, Power-Ups, Bus usw.
//  arbeiten nur noch mit dieser gemeinsamen Schnittstelle.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { makeAvatar } from './avatarFactory.js';

export const SLOT_COLORS = ['#f2f2f2', '#5aa9ff', '#ffd84a', '#6ee06a'];
export const ACTIONS = ['idle', 'fire', 'reload', 'knife', 'throw', 'drink', 'revive', 'raise'];
const DELAY = 0.1; // Darstellungsverzögerung der Mitspieler (glättet Netzschwankungen)
const _a = new THREE.Vector3();

// Der Spieler an diesem Gerät: liest alles direkt aus Player/Weapons
export class LocalSurvivor {
  constructor(game, info = {}) {
    this.g = game;
    this.local = true;
    this.slot = info.slot ?? 0;
    this.peerId = info.peerId ?? null;
    this.name = info.name || 'Du';
    this.char = info.char ?? this.slot;
    this.color = SLOT_COLORS[this.slot] || '#fff';
    this.stats = { kills: 0, headshots: 0, downs: 0, revives: 0 };
    this.left = false;
  }
  get p() { return this.g.player; }
  get pos() { return this.g.player.pos; }
  get vel() { return this.g.player.vel; }
  get yaw() { return this.g.player.yaw; }
  get pitch() { return this.g.player.pitch; }
  get downed() { return this.g.player.downed; }
  get dead() { return !!this.g.player.spectating; }
  get points() { return this.g.points; }
  get perks() { return this.g.player.perks; }
  get targetable() { return !this.g.player.downed && !this.g.player.spectating; }
  get onBus() { return !!(this.g.bus && this.g.bus.playerOn); }
  hurt(n, from) { this.g.player.damage(n, from); }
  reset() { this.stats = { kills: 0, headshots: 0, downs: 0, revives: 0 }; }
  update() { }
  dispose() { }
}

// Mitspieler: Zustand kommt übers Netz, wird verzögert interpoliert und als Figur gezeigt
export class RemoteSurvivor {
  constructor(game, info = {}) {
    this.g = game;
    this.local = false;
    this.slot = info.slot ?? 1;
    this.peerId = info.peerId ?? null;
    this.name = info.name || 'Mitspieler';
    this.char = info.char ?? this.slot;
    this.color = SLOT_COLORS[this.slot] || '#fff';
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.buf = [];
    this.st = { onGround: true, crouch: 0, sprint: false, ads: 0, downed: false, dead: false, dive: false, prone: false, action: 'idle', actionT: 0, fireSeq: 0 };
    this.points = 500;
    this.perks = new Set();
    this.weapon = null; this.pap = false;
    this.health = 100;
    this.stats = { kills: 0, headshots: 0, downs: 0, revives: 0 };
    this.left = false;
    this.onBus = false; // setzt der Bus beim Host
    this.seen = 0;
    this.avatar = makeAvatar(game, this.char, this.name);
    this.avatar.setTag(this.name, this.color);
    game.scene.add(this.avatar.group);
  }

  get downed() { return this.st.downed; }
  get dead() { return this.st.dead; }
  get targetable() { return !this.left && !this.st.downed && !this.st.dead && this.seen > 0; }

  // Zombie trifft: der Host meldet es dem Gerät des Mitspielers
  hurt(n, from) {
    if (this.g.net) this.g.net.send('hurt', { n, f: from ? [+from.x.toFixed(2), +from.z.toFixed(2)] : null }, this.peerId);
  }

  // Neuer Zustand vom Netz (siehe NetSession.localState)
  applyState(s, now) {
    this.seen = now;
    this.buf.push({ t: now, p: s.p, y: s.y, pi: s.pi });
    if (this.buf.length > 12) this.buf.shift();
    if (s.v) this.vel.set(s.v[0], s.v[1], s.v[2]);
    const f = s.f || 0;
    const st = this.st;
    st.onGround = !!(f & 1); st.sprint = !!(f & 2); st.downed = !!(f & 4); st.dead = !!(f & 8);
    st.dive = !!(f & 16); st.prone = !!(f & 32);
    st.crouch = s.c ?? 0; st.ads = s.ad ?? 0;
    const act = ACTIONS[s.a] || 'idle';
    if (act !== st.action || (s.at ?? 0) < st.actionT - 0.05) st.actionT = s.at ?? 0;
    st.action = act;
    st.fireSeq = s.fs ?? st.fireSeq;
    if (s.pts !== undefined) this.points = s.pts;
    if (s.hp !== undefined) this.health = s.hp;
    if (s.pk !== undefined) this.perks = new Set(s.pk);
    if (s.w !== this.weapon || !!s.pap !== this.pap) {
      this.weapon = s.w || null; this.pap = !!s.pap;
      this.avatar.setWeapon(this.weapon, this.pap);
    }
  }

  update(dt, now) {
    const st = this.st;
    st.actionT += dt;
    // Interpolation zwischen zwei Zuständen um (jetzt − Verzögerung)
    const b = this.buf;
    if (b.length) {
      const rt = now - DELAY;
      let i = b.length - 1;
      while (i > 0 && b[i - 1].t > rt) i--;
      const s1 = b[i], s0 = b[Math.max(0, i - 1)];
      if (s0 === s1 || rt >= s1.t) {
        // Kurz über den letzten Stand hinaus fortschreiben (max. 0,25 s)
        const ex = Math.min(0.25, Math.max(0, rt - s1.t));
        this.pos.set(s1.p[0] + this.vel.x * ex, s1.p[1], s1.p[2] + this.vel.z * ex);
        this.yaw = s1.y; this.pitch = s1.pi;
      } else {
        const k = Math.min(1, Math.max(0, (rt - s0.t) / Math.max(1e-3, s1.t - s0.t)));
        this.pos.set(s0.p[0] + (s1.p[0] - s0.p[0]) * k, s0.p[1] + (s1.p[1] - s0.p[1]) * k, s0.p[2] + (s1.p[2] - s0.p[2]) * k);
        let dy = s1.y - s0.y;
        dy -= Math.round(dy / (Math.PI * 2)) * Math.PI * 2;
        this.yaw = s0.y + dy * k;
        this.pitch = s0.pi + (s1.pi - s0.pi) * k;
      }
    }
    const av = this.avatar;
    av.setVisible(!this.left && !st.dead && this.seen > 0);
    av.setReviveIcon(st.downed && !st.dead && !this.left, Math.max(0, this.reviveP || 0));
    av.update(dt, { pos: this.pos, yaw: this.yaw, pitch: this.pitch, vel: this.vel, ...st });
  }

  reset() {
    this.stats = { kills: 0, headshots: 0, downs: 0, revives: 0 };
    this.points = 500; this.reviveP = 0; this.reviver = null; this.repairPts = 0;
  }

  muzzle(out) { return this.avatar.muzzleWorld(out); }
  eye(out = _a) { return out.copy(this.pos).setY(this.pos.y + (st => (st.downed ? 0.5 : st.crouch > 0.5 ? 1.05 : 1.6))(this.st)); }

  dispose() {
    this.avatar.group.removeFromParent();
    this.avatar.dispose();
  }
}
