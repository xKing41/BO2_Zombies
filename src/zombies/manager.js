// Zombie-Verwaltung: Spawning, Flow-Field-Navigation, Treffer, Punkte
import * as THREE from 'three';
import { Zombie, zombieTypes } from './zombie.js';
import { ZombieRenderer } from './instanced.js';
import { EyeGlow } from './eyes.js';
import { CELL, MAX_ALIVE, zombiesForRound, zombieHealth, spawnDelay, rollSpeedType, POINTS } from '../config.js';
import { raySphere, rand } from '../core/utils.js';

const _sep = new THREE.Vector3();
const _c = new THREE.Vector3(), _c2 = new THREE.Vector3(), _c3 = new THREE.Vector3();

export class ZombieManager {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.M = game.M;
    this.map = game.map;
    this.pool = [];
    this.renderer = new ZombieRenderer(this.scene, zombieTypes(this.M.zombie));
    for (let i = 0; i < MAX_ALIVE; i++) this.pool.push(new Zombie(this, i));
    this.renderer.finalize();
    this.eyes = new EyeGlow(this.scene, MAX_ALIVE);
    this.stepBudget = 0;
    this.dist = new Int32Array(this.map.w * this.map.h);
    this.flowT = 0;
    this.toSpawn = 0;
    this.remaining = 0;
    this.spawnT = 0;
    this.round = 0;
    this.uidSeq = 0;
  }

  // Zombie anhand seiner Spawn-Nummer finden (Koop: Treffer/Ereignisse über das Netz)
  byUid(uid) { return this.pool.find((z) => z.active && z.uid === uid) || null; }

  get active() { return this.pool.filter((z) => z.active); }
  get aliveCount() { let n = 0; for (const z of this.pool) if (z.alive) n++; return n; }

  startRound(r) {
    this.round = r;
    this.toSpawn = zombiesForRound(r, this.game.playerCount);
    this.remaining = this.toSpawn;
    this.hp = zombieHealth(r);
    this.spawnT = 1.0;
  }

  // BFS von allen angreifbaren Überlebenden aus über begehbare Zellen
  // (jeder Zombie folgt so dem Weg zum nächsten Spieler)
  computeFlow() {
    const map = this.map, w = map.w, d = this.dist;
    d.fill(-1);
    const q = [];
    let srcs = this.game.survivors.filter((s) => s.targetable);
    if (!srcs.length) srcs = this.game.survivors.filter((s) => !s.left);
    for (const s of srcs) {
      const sx = Math.floor(s.pos.x / CELL), sy = Math.floor(s.pos.z / CELL);
      if (sx < 0 || sy < 0 || sx >= w || sy >= map.h) continue;
      const k = sy * w + sx;
      if (d[k] === 0) continue;
      d[k] = 0; q.push(k);
    }
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
  pathTarget(pos, out, pc) {
    const map = this.map, w = map.w, d = this.dist;
    let x = Math.floor(pos.x / CELL), y = Math.floor(pos.z / CELL);
    let best = null;
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

  pickWindow(maxDist = Infinity, p = this.game.spawnFocus()) {
    const map = this.map;
    const cands = map.windows.filter((w) => map.openZones.has(w.zone) && Math.hypot(w.center.x - p.x, w.center.z - p.z) < maxDist);
    if (!cands.length) return null;
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
    const type = rollSpeedType(this.round);
    const focus = this.game.spawnFocus();
    if (this.game.mapDef.spawnMode === 'mixed') {
      // Große Karte: in Gebäuden meist durch Fenster, draußen aus dem Boden
      const map = this.map, p = focus;
      const c = map.cellAt(p.x, p.z);
      const inside = c && map.hasCeiling(c) && p.y < 0.3;
      const win = this.pickWindow(40, focus);
      if (win && Math.random() < (inside ? 0.8 : 0.25)) {
        z.spawn(win, this.hp, type);
        z.rise('approach');
      } else {
        const pt = this.groundPoint(focus);
        if (pt) z.spawnAt(pt, this.hp, type);
        else if (win) { z.spawn(win, this.hp, type); z.rise('approach'); }
        else return false;
      }
    } else {
      const win = this.pickWindow(Infinity, focus);
      if (!win) return false;
      z.spawn(win, this.hp, type);
    }
    z.uid = this.uidSeq = (this.uidSeq + 1) & 0xffff;
    this.toSpawn--;
    if (this.game.net) this.game.net.zombieSpawned(z);
    return true;
  }

  // Zufälliger erreichbarer Punkt im Freien in der Nähe eines Spielers (bzw. vor dem fahrenden Bus)
  groundPoint(p = this.game.spawnFocus()) {
    const g = this.game, map = this.map, bus = g.bus;
    let around = p, r0 = 12, r1 = 26;
    if (bus && bus.playerOn && bus.v > 2) { around = bus.lanePoint(bus.s + rand(28, 55), new THREE.Vector3()); r0 = 3; r1 = 9; }
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, r = rand(r0, r1);
      const x = around.x + Math.cos(a) * r, z = around.z + Math.sin(a) * r;
      const cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
      const c = map.get(cx, cy);
      if (!c || c.type !== 'floor' || c.lava || map.hasCeiling(c) || !map.zombieWalkable(cx, cy)) continue;
      if (this.dist[cy * map.w + cx] < 0) continue;
      if (bus && Math.hypot(bus.pos.x - x, bus.pos.z - z) < 7) continue;
      return new THREE.Vector3(x, 0, z);
    }
    return null;
  }

  respawn(z) {
    // Hängengebliebenen Zombie neu einreihen (zählt nicht als Kill)
    z.despawn();
    this.toSpawn++;
  }

  onDespawn() { }

  update(dt) {
    if (this.game.isClient) {
      // Koop-Mitspieler: Zombies sind Puppen, gesteuert vom Host
      this.stepBudget = Math.min(2, this.stepBudget + dt * 7);
      for (const z of this.pool) if (z.active) z.puppet(dt, this.game);
      this.renderer.update(this.pool);
      this.eyes.update(this.pool, dt, this.game);
      return;
    }
    this.flowT -= dt;
    if (this.flowT <= 0) { this.flowT = 0.2; this.computeFlow(); }

    if (this.toSpawn > 0 && this.game.state === 'playing') {
      this.spawnT -= dt;
      if (this.spawnT <= 0 && this.aliveCount < MAX_ALIVE) {
        if (this.spawnOne()) this.spawnT = spawnDelay(this.round) * rand(0.7, 1.3);
      }
    }
    // Wie bei Treyarch ab Runde 4: Der letzte Zombie der Runde sprintet –
    // außer er hat keine Beine mehr (darum lässt man sich Kriecher übrig)
    this.lastT = (this.lastT || 0) - dt;
    if (this.round >= 4 && this.toSpawn === 0 && this.lastT <= 0) {
      this.lastT = 0.5;
      let last = null, n = 0;
      for (const z of this.pool) if (z.alive) { last = z; n++; }
      if (n === 1 && !last.crawler && last.speedType !== 'sprint') { last.speedType = 'sprint'; last.speed = rand(4.2, 4.7); }
    }
    this.stepBudget = Math.min(2, this.stepBudget + dt * 7);
    for (const z of this.pool) if (z.active) z.update(dt, this.game);
    this.renderer.update(this.pool);
    this.eyes.update(this.pool, dt, this.game);
  }

  // Strahl gegen alle Zombies. Liefert nach Distanz sortierte Treffer.
  raycast(o, d, maxDist) {
    const hits = [];
    for (const z of this.pool) {
      if (!z.alive) continue;
      _c.copy(z.pos); _c.y += z.crawler ? 0.3 : 1.0;
      if (raySphere(o, d, _c, z.crawler ? 1.1 : 1.3) < 0) continue;
      let best = Infinity, part = null, sub = null;
      for (const s of z.hitSpheres()) {
        if ((s.part === 'head' && z.headless) || s.r <= 0) continue;
        const t = raySphere(o, d, s.p, s.r);
        if (t < 0) continue;
        const tt = s.part === 'head' ? t - 0.05 : t; // Kopf leicht bevorzugen
        if (tt < best) { best = tt; part = s.part; sub = s.sub; }
      }
      if (part && best < maxDist) { hits.push({ z, t: best, part, sub }); z.lastSub = sub; }
    }
    hits.sort((a, b) => a.t - b.t);
    return hits;
  }

  inRadius(p, r) {
    return this.pool.filter((z) => z.alive && Math.hypot(z.pos.x - p.x, z.pos.z - p.z) < r && Math.abs(z.pos.y + 1 - p.y) < r + 1);
  }

  // Schaden anwenden. opts: {dir, point, knife, explosive, nuke, fling, sub, pellet, wonder, by}
  // `by` ist der Überlebende, der getroffen hat (Punkte/Statistik); ohne Angabe der eigene Spieler.
  damage(z, amount, part, opts = {}) {
    if (!z.alive) return false;
    const g = this.game;
    if (g.isClient) return g.net.hitZombie(z, amount, part, opts); // Mitspieler: Treffer geht an den Host
    if (g.powerups.instaKill) amount = z.hp + 1;
    const sub = opts.sub || z.lastSub || null;
    z.lastSub = null;
    const heavy = amount >= z.maxHp * 0.35;
    z.hp -= amount;
    const point = opts.point || _c.copy(z.pos).setY(z.crawler ? 0.35 : 1.3);
    const dir = opts.dir || null;
    const armIdx = sub === 'armR' ? 0 : sub === 'armL' ? 1 : -1;
    const legIdx = sub === 'legR' ? 0 : sub === 'legL' ? 1 : -1;
    const by = opts.by || g.me;
    if (z.hp <= 0) {
      // Explosionen und der Bus werfen Zombies um, der Gewitter-Werfer verschmort sie
      const fling = opts.fling || (opts.explosive && !opts.nuke ? 1 : 0);
      const shock = amount >= 1e9 && !opts.nuke && !opts.explosive && !opts.fling;
      let head = part === 'head' && !opts.explosive;
      const lost = [];
      if (fling) {
        for (let i = 0; i < 2; i++) if (Math.random() < 0.3) lost.push(['arm', i]);
        if (!z.crawler) for (let i = 0; i < 2; i++) if (Math.random() < 0.25) lost.push(['leg', i]);
        if (Math.random() < 0.15) head = true;
      } else if (armIdx >= 0 && Math.random() < 0.7) lost.push(['arm', armIdx]);
      else if (legIdx >= 0 && opts.pellet && Math.random() < 0.3) lost.push(['leg', legIdx]);
      const death = { head, dir, point, fling: fling === true ? 1 : fling, shock, lost, by: by.slot };
      this.presentDeath(z, death);
      let pts = opts.knife ? POINTS.knife : opts.explosive || opts.fling || shock || opts.wonder ? POINTS.blast : head ? POINTS.head : part === 'limb' ? POINTS.limb : POINTS.kill;
      if (opts.nuke) pts = 0;
      if (pts) g.addPoints(pts, false, by);
      g.creditKill(by, head);
      this.remaining--;
      if (g.net) g.net.zombieDied(z, death);
      g.onZombieKilled(z, opts);
      return true;
    }
    // Schwere Treffer reißen Unterarme ab, Explosionen kosten die Beine (→ Kriecher)
    const gibs = [];
    let crawl = false;
    if (armIdx >= 0 && heavy && Math.random() < 0.45) gibs.push(['arm', armIdx]);
    const standing = z.state === 'chase' && !z.onBus && !z.crawler;
    if (standing && opts.explosive && amount >= z.maxHp * 0.2 && Math.random() < 0.5) {
      const first = Math.random() < 0.5 ? 0 : 1;
      gibs.push(['leg', first]);
      if (Math.random() < 0.55) gibs.push(['leg', 1 - first]);
      crawl = true;
    } else if (standing && legIdx >= 0 && heavy && Math.random() < 0.18) {
      gibs.push(['leg', legIdx]);
      crawl = true;
    }
    const hurt = { part, sub, dir, point, gibs, crawl, by: by.slot };
    this.presentHurt(z, hurt);
    if (g.net) g.net.zombieHurt(z, hurt);
    if (!opts.noPoints) g.addPoints(POINTS.hit, false, by);
    return false;
  }

  // Sichtbare Folgen eines tödlichen Treffers (auf jedem Gerät gleich)
  presentDeath(z, { head, dir, point, fling, shock, lost }) {
    const g = this.game;
    for (const [kind, i] of lost || []) {
      if (kind === 'leg' && z.crawler) continue;
      z.loseLimb(kind, i, dir, kind === 'arm' ? (fling ? 5 : 3) : (fling ? 4 : 3));
    }
    z.die(head, dir, { fling, shock });
    if (head) { g.effects.gore(z.headMesh.getWorldPosition(_c3), dir, 'head'); if (g.audio.zombieHeadPop) g.audio.zombieHeadPop(point); }
    g.effects.blood(point, dir || _c2.set(0, 0, 0), 1.4, head);
    g.effects.bloodDecal(z.pos.x + rand(-0.3, 0.3), z.pos.z + rand(-0.3, 0.3), head ? 1.2 : 0.9);
    g.audio.hitFlesh(point, head);
    if (Math.random() < 0.6) g.audio.zombieDeath(point);
  }

  // Sichtbare Folgen eines nicht tödlichen Treffers
  presentHurt(z, { part, sub, dir, point, gibs, crawl }) {
    const g = this.game;
    z.hurt(dir, part, sub);
    for (const [kind, i] of gibs || []) this.gib(z, kind, i, dir);
    if (crawl) z.makeCrawler();
    g.effects.blood(point, dir || _c2.set(0, 0, 0), 0.6, false);
    g.audio.hitFlesh(point, part === 'head');
  }

  // Gliedmaße abtrennen mit Fleischfetzen und Geräusch
  gib(z, kind, i, dir) {
    if (!z.loseLimb(kind, i, dir, kind === 'arm' ? 3 : 2.5)) return;
    const j = kind === 'arm' ? z.arms[i].el : z.legs[i].kn;
    const p = j.getWorldPosition(_c3);
    this.game.effects.gore(p, dir, 'limb');
    if (this.game.audio.gib) this.game.audio.gib(p);
  }

  killAll(opts = {}) {
    const list = this.pool.filter((z) => z.alive);
    list.forEach((z, i) => setTimeout(() => { if (z.alive) this.damage(z, 1e9, 'torso', { ...opts, nuke: true }); }, i * 60 + Math.random() * 300));
    return list.length;
  }

  clear() {
    for (const z of this.pool) z.despawn();
    this.eyes.reset();
    this.toSpawn = 0;
    this.remaining = 0;
    this.renderer.update(this.pool);
  }
}
