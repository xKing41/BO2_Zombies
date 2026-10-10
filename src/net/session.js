// ─────────────────────────────────────────────────────────────
//  Koop-Sitzung: Der Host simuliert die Welt (Zombies, Runden,
//  Power-Ups, Kiste, Türen …) und verteilt sie an alle Geräte.
//  Jedes Gerät steuert seinen eigenen Spieler selbst, meldet Treffer
//  an den Host und schickt seinen Zustand an alle Mitspieler.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { LocalSurvivor, RemoteSurvivor, ACTIONS } from '../game/survivors.js';
import { ZSTATES } from '../zombies/zombie.js';

const SPEEDS = ['walk', 'run', 'sprint'];
const STATE_DT = 1 / 20, SNAP_DT = 1 / 15;
const REC = 11; // Werte je Zombie im Schnappschuss
export const BLEED_TIME = 45, REVIVE_TIME = 3, REVIVE_TIME_QR = 1.5;

const v3 = (v) => (v ? [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)] : null);
const V = (a) => (a ? new THREE.Vector3(a[0], a[1], a[2]) : null);
const OPT_BITS = ['knife', 'pellet', 'explosive', 'shock', 'wonder', 'fling', 'small', 'energy'];
const packOpts = (o) => OPT_BITS.reduce((m, k, i) => (o[k] ? m | (1 << i) : m), 0);
const unpackOpts = (m) => { const o = {}; OPT_BITS.forEach((k, i) => { if (m & (1 << i)) o[k] = true; }); return o; };
const now = () => performance.now() / 1000;
const _p = new THREE.Vector3(), _q = new THREE.Vector3();

export class NetSession {
  constructor(game, s) {
    this.g = game;
    this.room = s.room;
    this.isHost = !!s.isHost;
    this.hostId = s.hostId;
    this.selfId = s.selfId ?? s.room.selfId;
    this.code = s.code || '';
    // Die Lobby zählt Plätze ab 1, das Spiel ab 0 (Farben, Startpunkte, Figuren)
    const list = (s.players || []).slice().sort((a, b) => a.slot - b.slot);
    const base = list.length ? Math.min(1, list[0].slot) : 0;
    this.players = list.map((p) => ({ ...p, slot: p.slot - base }));
    this.slot = (s.slot ?? base) - base;
    this.out = [];
    this.credits = new Map();
    this.stateT = 0; this.snapT = 0; this.tick = 0;
    this.reqSeq = 0; this.pending = new Map();
    this.revives = new Map(); // Host: Ziel-Slot → { by, t, need, sent }
    this.ready = new Set();
    this.started = false;
    this.closed = false;
    this.unsub = [];
    const on = (t, fn) => { const u = this.room.on(t, (d, from) => { if (!this.closed) fn(d, from); }); if (typeof u === 'function') this.unsub.push(u); };
    on('st', (d, from) => this.onState(d, from));
    on('ev', (d, from) => { if (from === this.hostId && !this.isHost) this.onEvents(d); });
    on('snap', (d, from) => { if (from === this.hostId && !this.isHost) this.onSnap(d); });
    on('bus', (d, from) => { if (from === this.hostId && !this.isHost && this.g.bus) this.g.bus.applyNet(d); });
    on('fx', (d, from) => { if (from === this.hostId && !this.isHost) this.onFx(d); });
    on('hit', (d, from) => { if (this.isHost) this.onHit(d, from); });
    on('boom', (d, from) => this.onBoom(d, from));
    on('shot', (d, from) => this.onShot(d, from));
    on('nade', (d, from) => this.onNade(d, from));
    on('wall', (d) => this.onWall(d));
    on('req', (d, from) => { if (this.isHost) this.onRequest(d, from); });
    on('res', (d) => this.onResponse(d));
    on('cr', (d, from) => { if (from === this.hostId) this.onCredit(d); });
    on('hurt', (d, from) => { if (from === this.hostId) this.onHurt(d); });
    on('rv', (d, from) => { if (this.isHost) this.onReviveIntent(d, from); });
    on('ready', (d, from) => { if (this.isHost) this.onReady(from); });
    on('go', (d, from) => { if (from === this.hostId) this.onGo(d); });
    on('bye', (d, from) => this.onPeerLeave(from));
    const u = this.room.onPeerLeave((id) => { if (!this.closed) this.onPeerLeave(id); });
    if (typeof u === 'function') this.unsub.push(u);
  }

  // ── Grundlagen ──────────────────────────────────────────────
  send(type, data, to, opts) { if (!this.closed) this.room.send(type, data, to, opts); }
  // Häufige Momentaufnahmen über den schnellen, ungesicherten Kanal (veraltete werden verworfen)
  sendFast(type, data) { this.send(type, data, undefined, { unreliable: true }); }
  ev(e) { if (this.isHost && !this.closed) this.out.push(e); }
  bySlot(slot) { return this.g.survivors.find((s) => s.slot === slot) || null; }
  byPeer(id) { return this.g.survivors.find((s) => s.peerId === id) || null; }
  get coop() { return this.g.survivors.filter((s) => !s.left).length > 1; }

  // Überlebende anlegen: eigener Spieler + Figuren der Mitspieler
  setupSurvivors() {
    const g = this.g;
    for (const s of g.survivors) if (!s.local) s.dispose();
    g.survivors = [];
    for (const p of this.players) {
      if (p.peerId === this.selfId) { g.me = new LocalSurvivor(g, p); g.survivors.push(g.me); }
      else g.survivors.push(new RemoteSurvivor(g, p));
    }
    if (!g.survivors.includes(g.me)) { g.me = new LocalSurvivor(g, { slot: this.slot, peerId: this.selfId }); g.survivors.unshift(g.me); }
  }

  // Nach dem Laden: Mitspieler melden sich bereit, der Host startet die erste Runde
  begin() {
    const g = this.g;
    // Host: jede Brettänderung an alle melden
    g.map.onBoards = this.isHost ? (w) => this.ev({ t: 'wb', w: g.map.windows.indexOf(w), n: w.boards }) : null;
    this.g.netHold = this.isHost && this.players.length > 1;
    this.holdT = 25;
    if (!this.isHost) this.send('ready', {}, this.hostId);
    else this.checkReady();
  }
  onReady(from) { this.ready.add(from); this.checkReady(); }
  checkReady() {
    if (!this.isHost || this.started) return;
    const need = this.players.filter((p) => p.peerId !== this.selfId).map((p) => p.peerId);
    if (need.every((id) => this.ready.has(id) || !this.room.peers || (this.room.peers.has && !this.room.peers.has(id))) || this.holdT <= 0) {
      this.started = true;
      this.g.netHold = false;
      this.send('go', { t: 0 });
      // Zufällige Startzustände der Karte (Bauteile, Quest-Code …) an alle verteilen
      for (const f of this.g.features) if (f.netShare) f.netShare();
    }
  }
  onGo() { this.started = true; }

  // ── Pro Bild ────────────────────────────────────────────────
  update(dt) {
    if (this.closed) return;
    const g = this.g, t = now();
    if (this.isHost && !this.started) { this.holdT -= dt; this.checkReady(); }
    for (const s of g.survivors) if (!s.local) s.update(dt, t);
    this.stateT -= dt;
    if (this.stateT <= 0 && g.state !== 'menu') { this.stateT = STATE_DT; this.sendFast('st', this.localState()); }
    if (this.isHost) {
      this.updateRevives(dt);
      this.snapT -= dt;
      if (this.snapT <= 0) { this.snapT = SNAP_DT; this.sendSnap(); }
      this.flushCredits();
      if (this.out.length) { this.send('ev', this.out); this.out = []; }
      this.checkGameOver();
    }
  }

  // Eigener Zustand für die Figuren auf den anderen Geräten
  localState() {
    const g = this.g, p = g.player, w = g.weapons;
    let f = 0;
    if (p.onGround) f |= 1;
    if (p.sprinting) f |= 2;
    if (p.downed) f |= 4;
    if (p.spectating) f |= 8;
    if (p.diving) f |= 16;
    if (p.proneT > 0) f |= 32;
    const act = p.reviving ? 'revive' : w.netAction ? w.netAction() : 'idle';
    const slot = w.weapon;
    return {
      p: [+p.pos.x.toFixed(3), +p.pos.y.toFixed(3), +p.pos.z.toFixed(3)],
      v: [+p.vel.x.toFixed(2), +p.vel.y.toFixed(2), +p.vel.z.toFixed(2)],
      y: +p.yaw.toFixed(3), pi: +p.pitch.toFixed(3), f,
      c: +Math.min(1, p.crouch).toFixed(2), ad: +(w.ads || 0).toFixed(2),
      a: Math.max(0, ACTIONS.indexOf(act)), at: +(w.stateT || 0).toFixed(2), fs: w.fireSeq || 0,
      w: slot ? slot.id : null, pap: !!(slot && slot.pap),
      pts: g.points, hp: Math.round(p.health), pk: [...p.perks], sq: (this.stSeq = (this.stSeq || 0) + 1),
    };
  }

  onState(d, from) {
    const s = this.byPeer(from);
    if (!s || s.local) return;
    if (d.sq !== undefined) { if (d.sq <= (s.lastSq || 0)) return; s.lastSq = d.sq; } // verspätet angekommen
    const wasDown = s.st.downed, wasDead = s.st.dead;
    s.applyState(d, now());
    if (s.st.downed && !wasDown) this.survivorDown(s);
    if (!s.st.downed && wasDown && !s.st.dead) this.revives.delete(s.slot);
    if (s.st.dead && !wasDead) this.survivorBledOut(s);
  }

  // ── Zombies (Host → alle) ───────────────────────────────────
  zombieSpawned(z) {
    if (!this.isHost) return;
    const win = z.win ? this.g.map.windows.indexOf(z.win) : -1;
    this.ev({ t: 'zs', u: z.uid, i: z.index, sd: z.lookSeed, ty: z.speedType, hp: Math.round(z.maxHp), sp: +z.speed.toFixed(2),
      w: win, p: v3(z.pos), y: +z.yaw.toFixed(3), st: ZSTATES.indexOf(z.state), ar: z.afterRise || null });
  }
  zombieDied(z, d) {
    if (!this.isHost) return;
    this.ev({ t: 'zd', u: z.uid, h: d.head ? 1 : 0, d: v3(d.dir), p: v3(d.point), f: d.fling || 0, s: d.shock ? 1 : 0, l: d.lost || [], by: d.by ?? -1 });
  }
  zombieHurt(z, h) {
    if (!this.isHost) return;
    this.ev({ t: 'zh', u: z.uid, pa: h.part, sb: h.sub, d: v3(h.dir), p: v3(h.point), g: h.gibs || [], c: h.crawl ? 1 : 0, by: h.by ?? -1 });
  }

  sendSnap() {
    const zs = this.g.zombies.pool.filter((z) => z.active && z.state !== 'dying');
    const a = new Float32Array(2 + zs.length * REC);
    a[0] = this.tick++; a[1] = zs.length;
    let o = 2;
    const bus = this.g.bus;
    for (const z of zs) {
      const inBus = !!(bus && z.onBus && z.local);
      a[o++] = z.uid; a[o++] = z.index;
      a[o++] = (z.crawler ? 1 : 0) | (z.burning > 0 ? 2 : 0) | (Math.max(0, SPEEDS.indexOf(z.speedType)) << 2) | (inBus ? 16 : 0);
      a[o++] = ZSTATES.indexOf(z.state);
      // Im Bus: Koordinaten relativ zum Bus (sonst hinken die Zombies dem fahrenden Bus hinterher)
      if (inBus) { a[o++] = z.local.x; a[o++] = z.pos.y; a[o++] = z.local.z; a[o++] = z.yaw - bus.yaw; }
      else { a[o++] = z.pos.x; a[o++] = z.pos.y; a[o++] = z.pos.z; a[o++] = z.yaw; }
      a[o++] = z.moveSpeed; a[o++] = z.stateT; a[o++] = z.hp;
    }
    this.sendFast('snap', a);
  }

  onSnap(data) {
    const a = data instanceof Float32Array ? data : new Float32Array(data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    const pool = this.g.zombies.pool, t = now();
    if (a[0] <= (this.lastTick ?? -1)) return; // ältere Momentaufnahme, kam zu spät
    this.lastTick = a[0];
    const n = a[1] | 0;
    const seen = new Set();
    let o = 2;
    for (let i = 0; i < n; i++, o += REC) {
      const z = pool[a[o + 1] | 0];
      if (!z || !z.active || z.uid !== (a[o] | 0)) continue;
      seen.add(z);
      z.puppetSnap({
        t, flags: a[o + 2] | 0, st: ZSTATES[a[o + 3] | 0] || 'chase',
        x: a[o + 4], y: a[o + 5], z: a[o + 6], yaw: a[o + 7], ms: a[o + 8], stT: a[o + 9], hp: a[o + 10],
      }, SPEEDS);
    }
    // Vom Host neu eingereihte Zombies verschwinden hier ebenfalls
    for (const z of pool) if (z.active && z.state !== 'dying' && !seen.has(z) && t - (z.spawnedAt || 0) > 1.5) z.despawn();
  }

  // Kurzlebige Effekte vom Host (z. B. Funkenmann-Blitze)
  onFx(d) {
    for (const f of this.g.features) if (f.netFx && f.netFx(d)) return;
  }
  fx(d) { if (this.isHost) this.sendFast('fx', d); }

  // ── Ereignisse (Host → alle) ────────────────────────────────
  onEvents(list) {
    const g = this.g, Z = g.zombies;
    for (const e of list) {
      switch (e.t) {
        case 'zs': {
          const z = Z.pool[e.i];
          if (z) z.puppetSpawn(e, g);
          break;
        }
        case 'zd': {
          const z = Z.byUid(e.u);
          if (!z) break;
          if (z.state === 'dying') break; // schon vorhergesagt
          Z.presentDeath(z, { head: !!e.h, dir: V(e.d), point: V(e.p) || z.pos.clone().setY(1.2), fling: e.f, shock: !!e.s, lost: e.l });
          break;
        }
        case 'zh': {
          const z = Z.byUid(e.u);
          if (!z || !z.alive) break;
          const mine = e.by === this.slot;
          const dir = V(e.d);
          if (!mine) Z.presentHurt(z, { part: e.pa, sub: e.sb, dir, point: V(e.p) || z.pos.clone().setY(1.2), gibs: e.g, crawl: !!e.c });
          else { for (const [k, i] of e.g || []) Z.gib(z, k, i, dir); if (e.c) z.makeCrawler(); }
          break;
        }
        case 'wb': {
          const w = g.map.windows[e.w];
          if (!w) break;
          const d = g.map.setBoards(w, e.n);
          if (d > 0) g.audio.boardPlace(w.center.clone().setY(1.6));
          else if (d < 0) g.audio.boardRip(w.center.clone().setY(1.6));
          break;
        }
        case 'rnd': g.netRound(e.r); break;
        case 'rend': g.netRoundEnd(); break;
        case 'end': g.gameOver(true); break;
        case 'rv': this.onReviveEvent(e); break;
        case 'sv': this.onSurvivorEvent(e); break;
        case 'not': g.hud.notice(e.m, e.ms || 2600); break;
        default:
          // Weitere Systeme (Türen, Kiste, Power-Ups, Kartenfunktionen …)
          if (g.netEvent) g.netEvent(e);
      }
    }
  }

  // ── Treffer (Mitspieler → Host) ─────────────────────────────
  // Auf dem Gerät des Schützen: sofort sichtbare Wirkung, Tod wird vorhergesagt
  hitZombie(z, amount, part, opts = {}) {
    const g = this.g, Z = g.zombies;
    const sub = opts.sub || z.lastSub || null;
    z.lastSub = null;
    const dir = opts.dir || null;
    const point = opts.point || z.pos.clone().setY(z.crawler ? 0.35 : 1.3);
    this.send('hit', { u: z.uid, a: Math.round(amount), pa: part, sb: sub, d: v3(dir), p: v3(point), o: packOpts(opts) }, this.hostId);
    const insta = g.powerups.instaKill;
    z.hp -= insta ? Infinity : amount;
    if (z.hp <= 0 && !opts.nuke) {
      const head = part === 'head' && !opts.explosive;
      Z.presentDeath(z, { head, dir, point, fling: opts.explosive || opts.fling ? 1 : 0, shock: amount >= 1e9 && !opts.explosive, lost: [] });
      return true;
    }
    z.hurt(dir, part, sub);
    g.effects.blood(point, dir || _q.set(0, 0, 0), 0.6, false);
    g.audio.hitFlesh(point, part === 'head');
    return false;
  }

  onHit(m, from) {
    const s = this.byPeer(from), z = this.g.zombies.byUid(m.u);
    if (!s || !z || !z.alive) return;
    this.g.zombies.damage(z, m.a, m.pa, { dir: V(m.d), point: V(m.p), sub: m.sb || null, by: s, ...unpackOpts(m.o || 0) });
  }

  // Explosion eines Mitspielers: Host verteilt den Schaden, alle zeigen sie
  boom(pos, radius, damage, opts) {
    this.send('boom', { p: v3(pos), r: radius, dm: damage, o: packOpts(opts), c: opts.color || null, fo: opts.falloff ?? null });
  }
  onBoom(d, from) {
    const s = this.byPeer(from);
    const o = unpackOpts(d.o || 0);
    this.g.explode(V(d.p), d.r, d.dm, { ...o, color: d.c || undefined, falloff: d.fo ?? undefined, by: s, remote: true });
  }

  // Schüsse der Mitspieler: Mündungsfeuer, Leuchtspur und Knall an ihrer Figur
  shot(info) { this.send('shot', info); }
  onShot(d, from) {
    const g = this.g, s = this.byPeer(from);
    if (!s || s.local) return;
    const m = s.muzzle(_p);
    g.effects.muzzle(m, d.c ?? 0xffb060, 0.8);
    if (!g.split) g.audio.gunshot(d.k, !!d.pap, m.clone()); // Splitscreen: den Knall spielt schon die Instanz des Schützen
    for (const e of d.e || []) if (Math.random() < 0.5) g.effects.tracer(m.clone(), V(e));
    if (d.pj && g.weapons.ghostProjectile) for (const v of d.pj) g.weapons.ghostProjectile(m.clone(), V(v), d.ps, d.c);
    if (d.ch && g.weapons.ghostChain) g.weapons.ghostChain(m.clone(), d.ch);
    for (const im of d.im || []) g.effects.impact(V(im[0]), V(im[1]), im[2]);
    if (this.isHost && d.o && d.d) {
      const o = V(d.o), dir = V(d.d).normalize();
      for (const f of g.features) if (f.onShot) f.onShot(o, dir, d.dist ?? 150, s);
    }
  }
  onNade(d, from) {
    const s = this.byPeer(from);
    if (s && !s.local && this.g.weapons.ghostGrenade) this.g.weapons.ghostGrenade(V(d.p), V(d.v), d.f);
  }
  onWall(d) {
    const it = this.g.interact.list[d.i];
    if (it && it.materialize) it.materialize(true);
  }

  // ── Punkte (Host → Schütze) ─────────────────────────────────
  credit(s, n, extra = null) {
    if (!s || s.local) return;
    const c = this.credits.get(s) || { n: 0, k: 0, h: 0 };
    c.n += n;
    if (extra) { c.k += extra.k || 0; c.h += extra.h || 0; }
    this.credits.set(s, c);
  }
  flushCredits() {
    for (const [s, c] of this.credits) if (!s.left) this.send('cr', c, s.peerId);
    this.credits.clear();
  }
  onCredit(c) {
    const g = this.g;
    if (c.n) g.addPoints(c.n, true);
    if (c.k) g.stats.kills += c.k;
    if (c.h) g.stats.headshots += c.h;
  }

  // ── Treffer am eigenen Spieler (Host → Opfer) ───────────────
  onHurt(d) {
    const from = d.f ? new THREE.Vector3(d.f[0], 1, d.f[1]) : null;
    this.g.player.damage(d.n, from);
  }

  // ── Anfragen an den Host (Türen, Kiste, …) ─────────────────
  request(kind, data = {}) {
    return new Promise((resolve) => {
      const id = ++this.reqSeq;
      this.pending.set(id, resolve);
      this.send('req', { ...data, rid: id, k: kind }, this.hostId);
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); resolve({ ok: false, why: 'timeout' }); } }, 5000);
    });
  }
  onResponse(d) {
    const fn = this.pending.get(d.rid);
    if (!fn) return;
    this.pending.delete(d.rid);
    fn(d);
  }
  onRequest(d, from) {
    const s = this.byPeer(from);
    let res = { ok: false };
    try { res = (s && this.g.netRequest && this.g.netRequest(d.k, d, s)) || { ok: false }; } catch (err) { console.error(err); }
    this.send('res', { ...res, rid: d.rid }, from);
  }
  // Kauf mit Rückfrage: Punkte sofort abziehen, bei Ablehnung zurückgeben
  async buy(cost, kind, data) {
    const g = this.g;
    if (!g.spend(cost)) return { ok: false };
    const r = await this.request(kind, { ...data, cost });
    if (!r.ok) { g.addPoints(cost, true); g.stats.spent -= cost; }
    return r;
  }

  // ── Am Boden, Wiederbeleben, Ausbluten ──────────────────────
  survivorDown(s) {
    s.stats.downs++;
    if (this.isHost) this.ev({ t: 'sv', k: 'down', s: s.slot });
    if (s.local || this.isHost) this.g.hud.notice(`${s.local ? 'Du bist' : s.name + ' ist'} am Boden!`, 3000);
  }
  survivorBledOut(s) {
    this.revives.delete(s.slot);
    if (this.isHost) this.ev({ t: 'sv', k: 'dead', s: s.slot });
    this.g.hud.notice(`${s.local ? 'Du bist' : s.name + ' ist'} verblutet`, 3000);
  }
  onSurvivorEvent(e) {
    const s = this.bySlot(e.s);
    if (!s || s.local) return;
    if (e.k === 'down') this.g.hud.notice(`${s.name} ist am Boden!`, 3000);
    else if (e.k === 'dead') this.g.hud.notice(`${s.name} ist verblutet`, 3000);
    else if (e.k === 'up') this.g.hud.notice(`${s.name} ist wieder auf den Beinen`, 2400);
    else if (e.k === 'left') this.g.hud.notice(`${s.name} hat das Spiel verlassen`, 3000);
  }

  // Wiederbeleber meldet: hält „Benutzen“ (on) oder lässt los
  reviveIntent(target, on) {
    if (this.isHost) this.onReviveIntent({ t: target.slot, on }, this.selfId);
    else this.send('rv', { t: target.slot, on }, this.hostId);
  }
  onReviveIntent(d, from) {
    const by = from === this.selfId ? this.g.me : this.byPeer(from);
    const target = this.bySlot(d.t);
    if (!by || !target || !target.downed || target.dead) return;
    const cur = this.revives.get(target.slot);
    if (d.on) {
      if (cur && cur.by !== by) return; // jemand anderes ist schon dabei
      const need = by.perks.has('phoenix') ? REVIVE_TIME_QR : REVIVE_TIME;
      if (!cur) this.revives.set(target.slot, { by, t: 0, need, sent: -1 });
    } else if (cur && cur.by === by) {
      this.revives.delete(target.slot);
      this.ev({ t: 'rv', s: target.slot, by: by.slot, p: -1 });
      this.onReviveEvent({ s: target.slot, by: by.slot, p: -1 });
    }
  }
  updateRevives(dt) {
    for (const [slot, r] of this.revives) {
      const target = this.bySlot(slot);
      const by = r.by;
      const ok = target && target.downed && !target.dead && by && by.targetable && Math.hypot(by.pos.x - target.pos.x, by.pos.z - target.pos.z) < 2.6;
      if (!ok) {
        this.revives.delete(slot);
        this.ev({ t: 'rv', s: slot, by: by ? by.slot : -1, p: -1 });
        this.onReviveEvent({ s: slot, by: by ? by.slot : -1, p: -1 });
        continue;
      }
      r.t += dt;
      const p = Math.min(1, r.t / r.need);
      if (p >= 1) {
        this.revives.delete(slot);
        by.stats.revives++;
        // Belohnung wie im Original: 5 % der Punkte des Wiederbelebten (auf 10 abgerundet)
        const reward = Math.floor(((target.local ? this.g.points : target.points) || 0) * 0.05 / 10) * 10;
        if (reward > 0) this.g.addPoints(reward, true, by);
        const e = { t: 'rv', s: slot, by: by.slot, p: 1, done: 1 };
        this.ev(e); this.onReviveEvent(e);
        this.ev({ t: 'sv', k: 'up', s: slot });
      } else if (Math.floor(p * 10) !== r.sent) {
        r.sent = Math.floor(p * 10);
        const e = { t: 'rv', s: slot, by: by.slot, p: +p.toFixed(2) };
        this.ev(e); this.onReviveEvent(e);
      }
    }
  }
  // Fortschritt anzeigen; das Ziel steht auf, wenn fertig
  onReviveEvent(e) {
    const g = this.g, target = this.bySlot(e.s), by = this.bySlot(e.by);
    if (!target) return;
    target.reviveP = e.p;
    target.reviver = e.p >= 0 ? by : null;
    if (target.local) {
      g.player.reviveBy = e.p >= 0 && e.p < 1 && by ? by.name : null;
      g.player.reviveP = Math.max(0, e.p);
      if (e.done) g.player.getUp();
    } else if (target.avatar) target.avatar.setReviveIcon(target.downed && !e.done, Math.max(0, e.p));
    if (e.done && by && by.local) { g.hud.notice(`${target.name} wiederbelebt`, 2200); g.player.reviving = null; }
  }

  // ── Spielende und Verlassen ─────────────────────────────────
  checkGameOver() {
    const g = this.g;
    if (g.state !== 'playing' || !this.started) return;
    const alive = g.survivors.filter((s) => !s.left);
    if (alive.length && alive.every((s) => s.downed || s.dead)) {
      // Allein im Koop: Phönix-Soda darf noch wirken
      if (alive.length === 1 && alive[0].local && g.player.reviveT > 0) return;
      this.ev({ t: 'end' });
      if (this.out.length) { this.send('ev', this.out); this.out = []; }
      g.gameOver(true);
    }
  }

  onPeerLeave(id) {
    if (this.closed) return;
    if (id === this.hostId && !this.isHost) { this.end('Der Host hat das Spiel verlassen.'); return; }
    const s = this.byPeer(id);
    if (!s || s.left) return;
    s.left = true;
    this.revives.delete(s.slot);
    if (s.avatar) s.avatar.setVisible(false);
    this.g.hud.notice(`${s.name} hat das Spiel verlassen`, 3000);
    if (this.isHost) this.ev({ t: 'sv', k: 'left', s: s.slot });
  }

  end(reason) {
    const g = this.g;
    this.close();
    if (g.onNetEnd) g.onNetEnd(reason);
  }

  close() {
    if (this.closed) return;
    if (this.g.map) this.g.map.onBoards = null;
    try { this.send('bye', {}); } catch { /* */ }
    this.closed = true;
    for (const u of this.unsub) { try { u(); } catch { /* */ } }
    this.unsub = [];
    for (const fn of this.pending.values()) fn({ ok: false, why: 'closed' });
    this.pending.clear();
  }
}
