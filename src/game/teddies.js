// ─────────────────────────────────────────────────────────────
//  Musik-Easter-Egg: drei versteckte Teddybären. Wer alle drei
//  drückt, startet das geheime Lied – wie in den Originalkarten.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeByMaterial } from '../world/batch.js';

function teddyModel() {
  const g = new THREE.Group();
  const fur = new THREE.MeshStandardMaterial({ color: 0x5e3b22, roughness: 1 });
  const muzzle = new THREE.MeshStandardMaterial({ color: 0x9a7650, roughness: 1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x070505, roughness: 0.3 });
  const blood = new THREE.MeshStandardMaterial({ color: 0x3a0505, roughness: 0.4 });
  const s = (mat, r, x, y, z, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat);
    m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true; g.add(m); return m;
  };
  // sitzend: Bauch, Kopf, Ohren, Schnauze, Arme, Beine nach vorn
  s(fur, 0.1, 0, 0.1, 0, 1, 1.1, 0.9);
  s(fur, 0.075, 0, 0.255, 0.01);
  s(fur, 0.03, -0.055, 0.32, 0, 1, 1, 0.6); s(fur, 0.03, 0.055, 0.32, 0, 1, 1, 0.6);
  s(muzzle, 0.035, 0, 0.24, 0.065, 1, 0.8, 0.8);
  s(dark, 0.012, 0, 0.255, 0.093);
  s(dark, 0.011, -0.028, 0.28, 0.062); s(dark, 0.011, 0.028, 0.28, 0.062); // Knopfaugen
  s(fur, 0.035, -0.1, 0.13, 0.03, 1, 1.6, 1).rotation.z = 0.5;
  s(fur, 0.035, 0.1, 0.13, 0.03, 1, 1.6, 1).rotation.z = -0.5;
  s(fur, 0.04, -0.05, 0.035, 0.08, 1, 1, 1.5); s(fur, 0.04, 0.05, 0.035, 0.08, 1, 1, 1.5);
  s(blood, 0.03, 0.04, 0.14, 0.075, 1, 1.4, 0.4); // Blutfleck auf dem Bauch
  return mergeByMaterial(g);
}

export class Teddies {
  // spots: [{ x, y, z, yaw }] in Weltkoordinaten (Sitzfläche)
  constructor(game, spots) {
    this.g = game;
    this.done = 0;
    this.interactables = spots.map((sp, i) => {
      const model = teddyModel();
      model.position.set(sp.x, sp.y, sp.z);
      model.rotation.y = sp.yaw || 0;
      model.rotation.z = (i - 1) * 0.12;
      model.userData.dynamic = true; // nickt beim Drücken → nicht statisch verschmelzen
      game.scene.add(model);
      const self = this;
      return {
        g: game, pos: new THREE.Vector3(sp.x, 0, sp.z), radius: 2.0, pressed: false, model, i,
        get press() { return game.input.verb(false); },
        // Kein Hinweis, was passiert – nur, dass man etwas tun kann
        prompt() { return this.pressed ? null : `${this.press} …`; },
        use() {
          if (this.pressed) return;
          if (game.isClient) { game.net.request('teddy', { i: this.i }); return; }
          self.share(this);
        },
        update(dt, time) {
          // gedrückter Teddy nickt kurz
          const k = this.nod || 0;
          if (k > 0) { this.nod = Math.max(0, k - dt); this.model.rotation.x = Math.sin(k * 14) * 0.25 * k; }
          void time;
        },
        reset() { this.pressed = false; this.nod = 0; this.model.rotation.x = 0; },
      };
    });
  }

  // Host: drücken und allen melden
  share(it) {
    it.pressed = true;
    if (this.g.net) this.g.net.ev({ t: 'ted', i: it.i });
    this.press(it);
  }

  netEvent(e) {
    if (e.t !== 'ted') return false;
    const it = this.interactables[e.i];
    if (it && !it.pressed) { it.pressed = true; this.press(it); }
    return true;
  }

  netRequest(kind, d) {
    if (kind !== 'teddy') return undefined;
    const it = this.interactables[d.i];
    if (!it || it.pressed) return { ok: false };
    this.share(it);
    return { ok: true };
  }

  press(it) {
    const g = this.g;
    it.nod = 1;
    this.done++;
    g.audio.musicBox(it.i);
    const p = it.model.position;
    g.effects.energy(new THREE.Vector3(p.x, p.y + 0.25, p.z), [2.5, 1.6, 0.6], 14, 0.15);
    if (this.done === 3) {
      setTimeout(() => {
        if (g.state !== 'playing' && g.state !== 'paused') return;
        const len = g.audio.secretSong();
        if (len) g.hud.notice('♪  Nebelfahrt  ♪', 4000);
      }, 1800);
    }
  }

  reset() {
    this.done = 0;
    for (const it of this.interactables) it.reset();
    if (this.g.audio.song) this.g.audio.stopSong();
  }

  dispose() { if (this.g.audio.song) this.g.audio.stopSong(); }
}
