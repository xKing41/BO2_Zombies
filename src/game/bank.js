// ─────────────────────────────────────────────────────────────
//  Altstadt: Bank (Punkte über Partien hinweg sparen), Schließfach
//  (eine Waffe für die nächste Partie aufbewahren) und das Jagdmesser.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { BANK, KNIFE_SPOT, wx } from '../maps/linie13-data.js';
import { WEAPONS } from '../config.js';
import { WALLDIR } from '../world/map.js';
import * as T from '../core/textures.js';

const KEY_BANK = 'nachtfall.bank', KEY_LOCKER = 'nachtfall.locker';
const MAX_BANK = 250000;
const load = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* privat */ } };

export class Bank {
  constructor(game) {
    this.g = game;
    const g = game, map = g.map, M = g.M;
    const verb = () => g.input.verb(false);
    this.interactables = [];
    const self = this;

    // Schalter-Terminals (Bildschirme auf dem Tresen)
    const term = (x, y, label) => {
      const grp = new THREE.Group();
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.08), M.dark); b.position.y = 1.35; grp.add(b);
      const s = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.26), new THREE.MeshBasicMaterial({ map: T.textSign(label, '#7dffb0', '#031008', 256, 160, 'bold 52px Oswald, Impact, sans-serif'), color: new THREE.Color(1.4, 1.4, 1.4) }));
      s.position.set(0, 1.35, -0.045); s.rotation.y = Math.PI; grp.add(s);
      grp.position.set(wx(x), 0, wx(y) + 1.1);
      g.scene.add(grp);
    };
    term(BANK.deposit.x, BANK.deposit.y, 'EINZAHLEN');
    term(BANK.withdraw.x, BANK.withdraw.y, 'ABHEBEN');
    // Werte aus dem Speicher zwischenpuffern (Prompts werden jedes Bild abgefragt)
    this.balance = load(KEY_BANK, 0);
    this.stored = load(KEY_LOCKER, null);
    const balance = () => self.balance;
    const setBalance = (v) => { self.balance = v; save(KEY_BANK, v); };
    this.interactables.push({
      pos: new THREE.Vector3(wx(BANK.deposit.x), 0, wx(BANK.deposit.y)), radius: 1.6,
      prompt() {
        const b = balance();
        if (b >= MAX_BANK) return `Konto voll [Kontostand: ${b}]`;
        return `${verb()}, um 1000 Punkte einzuzahlen [Kontostand: ${b}]`;
      },
      use() {
        const b = balance();
        if (b >= MAX_BANK) return;
        if (g.points < 1000) { g.audio.deny(); g.hud.deny(); return; }
        g.points -= 1000; g.hud.points(g.points); g.hud.pointsPop(-1000);
        setBalance(b + 1000);
        g.audio.coins(this.pos);
      },
      update() {}, reset() {},
    });
    this.interactables.push({
      pos: new THREE.Vector3(wx(BANK.withdraw.x), 0, wx(BANK.withdraw.y)), radius: 1.6,
      prompt() {
        const b = balance();
        if (b < 1000) return `Kein Guthaben [Kontostand: ${b}]`;
        return `${verb()}, um 1000 Punkte abzuheben (Gebühr 100) [Kontostand: ${b}]`;
      },
      use() {
        const b = balance();
        if (b < 1000) { g.audio.deny(); return; }
        setBalance(b - 1000);
        g.addPoints(900, true);
        g.audio.coins(this.pos);
      },
      update() {}, reset() {},
    });

    // Schließfach im Tresorraum
    const L = BANK.locker;
    const box = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 0.5), M.chrome); body.position.y = 1.2; box.add(body);
    for (let i = 0; i < 6; i++) { const d = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.28, 0.02), M.metal); d.position.set(-0.52 + (i % 3) * 0.52, 1.05 + Math.floor(i / 3) * 0.32, 0.26); box.add(d); }
    this.lockerLamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 2.5, 0.6) });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), this.lockerLamp); lamp.position.set(0.7, 1.6, 0.26); box.add(lamp);
    map.place(box, L.x, L.y, L.wall, 0.5);
    box.updateMatrixWorld(true);
    map.colliders.push(map.aabb(box, 0.02));
    const [dx, dz] = WALLDIR[L.wall];
    this.interactables.push({
      pos: map.center(L.x, L.y).add(new THREE.Vector3(-dx * 0.5, 0, -dz * 0.5)), radius: 1.7,
      prompt() {
        const stored = self.stored;
        const w = g.weapons.weapon;
        if (stored) return `${verb()}, um ${self.weaponName(stored)} aus dem Schließfach zu nehmen`;
        if (!w) return null;
        if (w.id === 'tesla') return 'Wunderwaffen passen nicht ins Schließfach';
        if (g.weapons.count < 2) return 'Schließfach: Du brauchst eine zweite Waffe';
        return `${verb()}, um ${w.stats.name} im Schließfach zu lassen (für die nächste Partie)`;
      },
      use() {
        const w = g.weapons;
        if (w.busy) return;
        const stored = self.stored;
        if (stored) {
          self.stored = null;
          save(KEY_LOCKER, null);
          if (!WEAPONS[stored.id]) return;
          if (w.has(stored.id)) { const own = w.has(stored.id); own.reserve = own.stats.reserve; }
          else w.give(stored.id, !!stored.pap);
          g.audio.locker(this.pos);
          return;
        }
        const cur = w.weapon;
        if (!cur || cur.id === 'tesla' || w.count < 2) return;
        self.stored = { id: cur.id, pap: !!cur.pap };
        save(KEY_LOCKER, self.stored);
        w.takeCurrent();
        g.audio.locker(this.pos);
        g.hud.notice(`${cur.stats.name} liegt im Schließfach`, 2500);
      },
      update() { self.lockerLamp.color.setRGB(self.stored ? 2.8 : 0.2, self.stored ? 1.2 : 2.5, 0.3); },
      reset() {},
    });

    // Jagdmesser an der Wand der Bar
    const K = KNIFE_SPOT;
    const knife = new THREE.Group();
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.05), M.woodDark); board.position.y = 1.5; knife.add(board);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.07, 0.01), M.chrome); blade.position.set(-0.05, 1.52, 0.04); knife.add(blade);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.03), M.gunWood); handle.position.set(0.3, 1.52, 0.04); knife.add(handle);
    map.place(knife, K.x, K.y, K.wall, 0.05);
    this.knifeModel = knife;
    const [kx, kz] = WALLDIR[K.wall];
    this.interactables.push({
      pos: map.center(K.x, K.y).add(new THREE.Vector3(-kx * 0.4, 0, -kz * 0.4)), radius: 1.7,
      prompt() { return g.weapons.knifeLevel > 0 ? null : `${verb()} für das Jagdmesser – Messer tötet sofort [Kosten: 3000]`; },
      use() {
        if (g.weapons.knifeLevel > 0 || !g.spend(3000)) return;
        g.weapons.upgradeKnife();
        g.hud.notice('Jagdmesser', 2500);
      },
      update() { knife.visible = g.weapons.knifeLevel === 0; },
      reset() {},
    });
  }

  weaponName(s) { const w = WEAPONS[s.id]; return w ? (s.pap ? w.pap.name : w.name) : '?'; }
  update() {}
  reset() { this.balance = load(KEY_BANK, 0); this.stored = load(KEY_LOCKER, null); }
  dispose() {}
}
