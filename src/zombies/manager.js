// Zombie-Verwaltung: Spawning, Flow-Field-Navigation, Treffer, Punkte
import * as THREE from 'three';
import { Zombie } from './zombie.js';
import { CELL, MAX_ALIVE, zombiesForRound, zombieHealth, spawnDelay, rollSpeedType, POINTS } from '../config.js';
import { raySphere, rand } from '../core/utils.js';

const _sep = new THREE.Vector3();
const _c = new THREE.Vector3();

export class ZombieManager {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.M = game.M;
    this.map = game.map;
    this.pool = [];
    for (let i = 0; i < MAX_ALIVE; i++) this.pool.push(new Zombie(this));
    this.dist = new Int32Array(this.map.w * this.map.h);
    this.flowT = 0;
    this.toSpawn = 0;
    this.remaining = 0;
    this.spawnT = 0;
    this.round = 0;
  }

  get active() { return this.pool.filter((z) => z.active); }
  get aliveCount() { let n = 0; for (const z of this.pool) if (z.alive) n++; return n; }

  startRound(r) {
    this.round = r;
    this.toSpawn = zombiesForRound(r);
    this.remaining = this.toSpawn;
    this.hp = zombieHealth(r);
    this.spawnT = 1.0;
  }

  // BFS vom Spieler aus über begehbare Zellen
  computeFlow() {
    const map = this.map, w = map.w, d = this.dist;
    d.fill(-1);
    const pc = this.game.player.pos;
    const sx = Math.floor(pc.x / CELL), sy = Math.floor(pc.z / CELL);
    const q = [sy * w + sx];
    d[q[0]] = 0;
    for (let i = 0; i < q.length; i++) {
      const k = q[i], x = k % w, y = (k - x) / w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!map.zombieWalkable(nx, ny)) continue;
        const nk = ny * w + nx;
        if (d[nk] >= 0) continue;
        d[nk] = d[k] + 1;
        q.push(nk);
      }
    }
  }

  // Weit voraus schauen und den entferntesten direkt erreichbaren Pfadpunkt wählen
  pathTarget(pos, out) {
    const map = this.map, w = map.w, d = this.dist;
    let x = Math.floor(pos.x / CELL), y = Math.floor(pos.z / CELL);
    let best = null;
    const pc = this.game.player.pos;
    if (d[y * w + x] < 0) { out.copy(pc); return; }
    for (let step = 0; step < 7; step++) {
      const cur = d[y * w + x];
      if (cur === 0) {
        if (step === 0 || map.clearPath(pos, pc, 0.3)) best = pc;
        break;
      }
      let nx = x, ny = y, nd = cur;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ax = x + dx, ay = y + dy;
        if (ax < 0 || ay < 0 || ax >= w || ay >= map.h) continue;
        const v = d[ay * w + ax];
        if (v >= 0 && v < nd) { nd = v; nx = ax; ny = ay; }
      }
      if (nx === x && ny === y) break;
      x = nx; y = ny;
      map.center(x, y, _c);
      if (step === 0 || map.clearPath(pos, _c, 0.3)) best = _c.clone();
      else break;
    }
    if (best) out.copy(best); else out.copy(pc);
  }

  separation(z) {
    _sep.set(0, 0, 0);
    for (const o of this.pool) {
      if (o === z || !o.alive) continue;
      const dx = z.pos.x - o.pos.x, dz = z.pos.z - o.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 0.55 && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        _sep.x += (dx / d) * (0.75 - d);
        _sep.z += (dz / d) * (0.75 - d);
      }
    }
    return _sep;
  }

  pickWindow() {
    const map = this.map, p = this.game.player.pos;
    const cands = map.windows.filter((w) => map.openZones.has(w.zone));
    let total = 0;
    const ws = cands.map((w) => {
      const d = Math.hypot(w.center.x - p.x, w.center.z - p.z);
      const zoneBonus = map.zoneAt(p.x, p.z) === w.zone ? 2.5 : 1;
      const wt = zoneBonus / (1 + d / 10);
      total += wt;
      return wt;
    });
    let r = Math.random() * total;
    for (let i = 0; i < cands.length; i++) { r -= ws[i]; if (r <= 0) return cands[i]; }
    return cands[0];
  }

  spawnOne() {
    const z = this.pool.find((x) => !x.active);
    if (!z) return false;
    z.spawn(this.pickWindow(), this.hp, rollSpeedType(this.round));
    this.toSpawn--;
    return true;
  }

  respawn(z) {
    // Hängengebliebenen Zombie neu einreihen (zählt nicht als Kill)
    z.despawn();
    this.toSpawn++;
  }

  onDespawn() { }

  update(dt) {
    this.flowT -= dt;
    if (this.flowT <= 0) { this.flowT = 0.2; this.computeFlow(); }

    if (this.toSpawn > 0 && this.game.state === 'playing') {
      this.spawnT -= dt;
      if (this.spawnT <= 0 && this.aliveCount < MAX_ALIVE) {
        if (this.spawnOne()) this.spawnT = spawnDelay(this.round) * rand(0.7, 1.3);
      }
    }
    for (const z of this.pool) if (z.active) z.update(dt, this.game);
  }

  // Strahl gegen alle Zombies. Liefert nach Distanz sortierte Treffer.
  raycast(o, d, maxDist) {
    const hits = [];
    for (const z of this.pool) {
      if (!z.alive) continue;
      _c.copy(z.pos); _c.y += 1.0;
      if (raySphere(o, d, _c, 1.3) < 0) continue;
      let best = Infinity, part = null;
      for (const s of z.hitSpheres()) {
        if (s.part === 'head' && z.headless) continue;
        const t = raySphere(o, d, s.p, s.r);
        if (t < 0) continue;
        const tt = s.part === 'head' ? t - 0.05 : t; // Kopf leicht bevorzugen
        if (tt < best) { best = tt; part = s.part; }
      }
      if (part && best < maxDist) hits.push({ z, t: best, part });
    }
    hits.sort((a, b) => a.t - b.t);
    return hits;
  }

  inRadius(p, r) {
    return this.pool.filter((z) => z.alive && Math.hypot(z.pos.x - p.x, z.pos.z - p.z) < r && Math.abs(z.pos.y + 1 - p.y) < r + 1);
  }

  // Schaden anwenden. opts: {dir, point, knife, explosive, silent}
  damage(z, amount, part, opts = {}) {
    if (!z.alive) return false;
    const g = this.game;
    if (g.powerups.instaKill) amount = z.hp + 1;
    z.hp -= amount;
    const point = opts.point || _c.copy(z.pos).setY(1.3);
    if (z.hp <= 0) {
      const head = part === 'head';
      z.die(head && !opts.explosive, opts.dir);
      g.effects.blood(point, opts.dir || new THREE.Vector3(), 1.4, head);
      g.effects.bloodDecal(z.pos.x + rand(-0.3, 0.3), z.pos.z + rand(-0.3, 0.3), head ? 1.2 : 0.9);
      g.audio.hitFlesh(point, head);
      if (Math.random() < 0.6) g.audio.zombieDeath(point);
      let pts = opts.knife ? POINTS.knife : head ? POINTS.head : POINTS.kill;
      if (opts.nuke) pts = 0;
      if (pts) g.addPoints(pts);
      g.stats.kills++;
      if (head) g.stats.headshots++;
      this.remaining--;
      g.onZombieKilled(z, opts);
      return true;
    }
    z.hurt(opts.dir);
    g.effects.blood(point, opts.dir || new THREE.Vector3(), 0.6, false);
    g.audio.hitFlesh(point, part === 'head');
    if (!opts.noPoints) g.addPoints(POINTS.hit);
    return false;
  }

  killAll(opts = {}) {
    const list = this.pool.filter((z) => z.alive);
    list.forEach((z, i) => setTimeout(() => { if (z.alive) this.damage(z, 1e9, 'torso', { ...opts, nuke: true }); }, i * 60 + Math.random() * 300));
    return list.length;
  }

  clear() {
    for (const z of this.pool) z.despawn();
    this.toSpawn = 0;
    this.remaining = 0;
  }
}
