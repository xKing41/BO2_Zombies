// ─────────────────────────────────────────────────────────────
//  Spiel: verbindet alle Systeme, Rundenlogik, Punkte, Hauptschleife.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { nightEnvironment } from '../world/atmosphere.js';
import { useGridLight, gridLitScene, GRID } from '../world/gridlight.js';
import { RenderSystem, QUALITY, resolveQuality } from '../core/renderer.js';
import { setAnisotropy, setTextureScale } from '../core/textures.js';
import { buildMaterials } from '../core/materials.js';
import { Input } from '../core/input.js';
import { AudioEngine } from '../audio/audio.js';
import { GameMap } from '../world/map.js';
import { batchStatic } from '../world/batch.js';
import { Effects } from '../fx/effects.js';
import { Player } from '../player/player.js';
import { Weapons } from '../weapons/weapons.js';
import { ZombieManager } from '../zombies/manager.js';
import { Interactables } from './interactables.js';
import { PowerUps } from './powerups.js';
import { HUD } from '../ui/hud.js';
import { LocalSurvivor } from './survivors.js';
import { NetSession } from '../net/session.js';
import { clamp, damp } from '../core/utils.js';
import { CELL } from '../config.js';
import { MAPS } from '../maps/index.js';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const escapeHtml = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// Rekord je Karte (Nachtfall behält den alten Schlüssel)
export const bestKey = (id) => (id === 'nachtfall' ? 'nachtfall.best' : 'nachtfall.best.' + id);

export const DEFAULT_SETTINGS = {
  sensitivity: 1, fov: 80, master: 0.8, music: 0.6, quality: 'auto',
  invertY: false, showFps: false, aimAssist: true, hitmarker: false, map: 'nachtfall',
};

export class Game {
  // opts (Splitscreen): { input: { kbm, pad }, hudRoot, view: { x, y, w, h }, sharedM, audioFrom, split, secondary }
  constructor(canvas, settings, opts = {}) {
    this.canvas = canvas;
    this.settings = settings;
    this.opts = opts;
    this.split = !!opts.split; // Teil einer Splitscreen-Partie
    this.secondary = !!opts.secondary; // weitere Instanz (Spieler 2–4): keine Menüs, Musik, Sprachausgabe
    this.qualityOverride = opts.quality || null; // Splitscreen: Grafikstufe statt „Automatisch“
    this.state = 'loading';
    this.round = 0;
    this.points = 500;
    this.stats = { kills: 0, headshots: 0, spent: 0, start: 0 };
    this.flash = 0;
    this.time = 0;
    this.lightLevel = 0.5;
    this.repairPoints = 0;
    this.input = new Input(canvas, opts.input);
    this.touch = null; // wird von main.js gesetzt
    this.perf = { acc: 0, n: 0 };
    this.features = [];
    this.mapDef = null;
    this.survivors = [];
    this.me = null;
    this.net = null; // Koop-Sitzung (null = allein)
    this.netHold = false;
  }

  // ── Mehrere Spieler ─────────────────────────────────────────
  get isClient() { return !!(this.net && !this.net.isHost); }
  get playerCount() { return Math.max(1, this.survivors.filter((s) => !s.left).length); }
  get coop() { return this.playerCount > 1; }

  // Nächster angreifbarer Überlebender (mit etwas Trägheit beim bisherigen Ziel)
  nearestSurvivor(pos, current = null) {
    let best = null, bd = Infinity, fallback = null, fd = Infinity;
    for (const s of this.survivors) {
      if (s.left) continue;
      let d = Math.hypot(s.pos.x - pos.x, s.pos.z - pos.z);
      if (!s.targetable) { if (d < fd) { fd = d; fallback = s; } continue; }
      if (s === current) d -= 2;
      if (d < bd) { bd = d; best = s; }
    }
    return best || fallback || this.me;
  }

  // Angreifbarer Überlebender in Reichweite eines Punkts (z. B. am Fenster)
  survivorNear(p, r) {
    let best = null, bd = r;
    for (const s of this.survivors) {
      if (!s.targetable) continue;
      const d = s.pos.distanceTo(p);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  // Um wen herum Zombies erscheinen: abwechselnd um alle lebenden Spieler
  spawnFocus() {
    const list = this.survivors.filter((s) => s.targetable);
    if (!list.length) return this.player.pos;
    return list[Math.floor(Math.random() * list.length)].pos;
  }

  creditKill(by, head) {
    if (!by || by.local) { this.stats.kills++; if (head) this.stats.headshots++; }
    else if (this.net) this.net.credit(by, 0, { k: 1, h: head ? 1 : 0 });
    if (by) { by.stats.kills++; if (head) by.stats.headshots++; }
  }

  async init(progress) {
    const step = async (pct, text) => { progress(pct, text); await nextFrame(); };
    await step(5, 'Grafik wird initialisiert …');
    this.rs = new RenderSystem(this.canvas, this.qualityOverride || this.settings.quality);
    if (this.opts.view) this.rs.setView(this.opts.view);
    const q = this.rs.quality;
    setAnisotropy(Math.min(8, this.rs.renderer.capabilities.getMaxAnisotropy()));
    setTextureScale(q.texScale);
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, this.rs.width / this.rs.height, 0.05, 400);
    this.camera.rotation.order = 'YXZ';
    this.vmCamera = new THREE.PerspectiveCamera(54, this.rs.width / this.rs.height, 0.01, 10);
    this.scene = new THREE.Scene();
    this.vmScene = new THREE.Scene();
    this.rs.setup(this.scene, this.camera, this.vmScene, this.vmCamera);
    this.rs.onResize = () => this.effects && this.effects.setScale(this.rs.height * this.rs.renderer.getPixelRatio(), this.camera.fov);
    // Eigene Nacht-Umgebung für Spiegelungen (Metall, nasse Böden)
    this.envMap = nightEnvironment(this.rs.renderer);

    // Schriften für Canvas-Texturen abwarten (max. 1.5 s)
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);

    let n = 0;
    const labels = 8;
    // Splitscreen: weitere Spieler nutzen dieselben Materialien (spart Zeit und Speicher)
    this.M = this.opts.sharedM || buildMaterials((label) => { n++; progress(10 + (n / labels) * 40, `Texturen: ${label} …`); });
    this.collectShared();
    // Splitscreen: weitere Spieler nutzen die fertige Klangbank des ersten mit
    this.audio = this.opts.audioFrom ? AudioEngine.follower(this.opts.audioFrom) : new AudioEngine();
    this.audio.panningModel = q.hrtf ? 'HRTF' : 'equalpower';
    this.hud = new HUD(this.opts.hudRoot || null);
    this.player = new Player(this);
    this.me = new LocalSurvivor(this);
    this.survivors = [this.me];
    await this.loadMap(this.settings.map, (pct, text) => progress(52 + pct * 0.48, text));
    this.lastT = performance.now();
    this.fpsAcc = 0; this.fpsN = 0; this.fps = 0;
    requestAnimationFrame((t) => this.loop(t));
  }

  // Gemeinsam genutzte Materialien/Texturen merken (werden beim Kartenwechsel nicht freigegeben)
  collectShared() {
    this.sharedMats = new Set();
    this.sharedTex = new Set();
    const walk = (o, depth = 0) => {
      if (!o || depth > 3) return;
      if (o.isMaterial) { this.sharedMats.add(o); return; }
      if (o.isTexture) { this.sharedTex.add(o); return; }
      if (Array.isArray(o)) { o.forEach((x) => walk(x, depth + 1)); return; }
      if (typeof o === 'object') for (const k in o) walk(o[k], depth + 1);
    };
    walk(this.M);
    for (const m of this.sharedMats) for (const k of ['map', 'bumpMap', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap']) if (m[k]) this.sharedTex.add(m[k]);
  }

  // ── Karten ──────────────────────────────────────────────────
  async loadMap(id, progress = () => {}) {
    const def = MAPS[id] || MAPS.nachtfall;
    const step = async (pct, text) => { progress(pct, text); await nextFrame(); };
    this.state = 'loading';
    await step(2, `${def.name} wird geladen …`);
    this.unloadMap();
    this.mapDef = def;
    this.settings.map = def.id;
    this.scene = new THREE.Scene();
    this.scene.add(this.camera);
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = def.env?.envIntensity ?? 0.9;
    this.vmScene = new THREE.Scene();
    this.vmScene.environment = this.envMap;
    this.vmScene.environmentIntensity = 1.4;
    this.rs.setScenes(this.scene, this.camera, this.vmScene, this.vmCamera);
    await step(10, `${def.name}: Gelände …`);
    this.map = new GameMap(def);
    this.map.build(this.scene, this.M, { quality: this.rs.quality, game: this });
    await step(45, 'Effekte …');
    this.effects = new Effects(this.scene, this.M);
    this.weapons = new Weapons(this);
    await step(60, 'Die Toten erwachen …');
    this.zombies = new ZombieManager(this);
    this.interact = new Interactables(this);
    this.powerups = new PowerUps(this);
    this.features = def.setup ? def.setup(this) || [] : [];
    for (const f of this.features) if (f.interactables) this.interact.list.push(...f.interactables);
    this.hud.iconUrls = Object.fromEntries(Object.entries(this.powerups.icons).map(([k, t]) => [k, t.image.toDataURL()]));
    await step(80, 'Optimieren …');
    this.batchInfo = batchStatic(this.scene, def.chunkCells ? def.chunkCells * CELL : 0);
    // Raster-Licht (Ecken, Kontaktschatten, Rücklicht) an alle beleuchteten Materialien
    useGridLight(this.map, this.map.gridBaked, this.rs.quality.gridLight !== false);
    gridLitScene(this.scene);
    this.grid = GRID;
    // Nebel-Culling: verschmolzene Kacheln, die der Nebel ganz verschluckt, gar nicht erst zeichnen
    this.cullList = [];
    if (def.env && def.env.fogCull) this.scene.traverse((o) => {
      if (o.userData.cullSphere) { const c = o.userData.cullSphere; this.cullList.push({ o, x: c.x, z: c.z, r: c.r }); return; }
      if (o.name !== 'static_batch') return;
      const bs = o.geometry.boundingSphere;
      this.cullList.push({ o, x: bs.center.x, z: bs.center.z, r: bs.radius });
    });
    this.applyLightQuality();
    this.camera.far = def.env && def.env.far ? def.env.far : 400;
    this.camera.updateProjectionMatrix();
    this.player.reset();
    await step(90, 'Shader werden kompiliert …');
    this.precompile();
    this.effects.setScale(this.rs.height * this.rs.renderer.getPixelRatio(), this.camera.fov);
    this.player.update(0, this.input);
    this.station = null;
    await step(100, 'Bereit.');
    this.state = 'menu';
    this.lastT = performance.now();
  }

  unloadMap() {
    for (const f of this.features) if (f.dispose) f.dispose();
    this.features = [];
    if (!this.map) return;
    this.zombies.clear();
    if (this.map.skyDome) this.map.skyDome.dispose();
    const freed = new Set();
    const free = (scene) => scene.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      if (o.isLight && o.shadow && o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; }
      if (o.geometry && !o.geometry.userData.shared && !freed.has(o.geometry)) { freed.add(o.geometry); o.geometry.dispose(); }
      if (o.material) for (const m of [].concat(o.material)) {
        if (this.sharedMats.has(m) || freed.has(m)) continue;
        freed.add(m);
        for (const k of ['map', 'bumpMap', 'emissiveMap', 'alphaMap', 'normalMap', 'roughnessMap', 'metalnessMap']) if (m[k] && !this.sharedTex.has(m[k]) && !freed.has(m[k])) { freed.add(m[k]); m[k].dispose(); }
        m.dispose();
      }
    });
    free(this.scene);
    free(this.vmScene);
    this.map = null;
  }

  precompile() {
    this.rs.renderer.compile(this.scene, this.camera);
    this.rs.renderer.compile(this.vmScene, this.vmCamera);
    this.rs.render();
  }

  // Lichter und Schatten passend zur Qualitätsstufe ein-/ausschalten
  applyLightQuality() {
    const q = this.rs.quality;
    this.scene.traverse((o) => {
      if (!o.isLight) return;
      if (o.userData.tier) o.visible = o.userData.tier <= q.lightTier;
      if (o.userData.shadowTier !== undefined) {
        o.castShadow = q.shadows && o.userData.shadowTier <= q.shadowTier;
        const size = o.isDirectionalLight ? q.shadowSize : q.shadowSize / 2;
        if (o.shadow.mapSize.x !== size) {
          o.shadow.mapSize.set(size, size);
          if (o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; }
        }
      }
    });
    this.audio.panningModel = q.hrtf ? 'HRTF' : 'equalpower';
  }

  applySettings() {
    const s = this.settings;
    this.camera.fov = this.viewFov(s.fov);
    this.audio.setVolumes({ master: s.master, music: s.music });
    this.hud.showHits = !!s.hitmarker;
    const qn = this.qualityOverride || s.quality;
    if (this.rs.qualityName !== resolveQuality(qn)) {
      this.rs.setQuality(qn);
      this.applyLightQuality();
      // Schatten an/aus erfordert neue Shader
      this.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => (m.needsUpdate = true)); });
      this.effects.setScale(this.rs.height * this.rs.renderer.getPixelRatio(), this.camera.fov);
    }
  }

  // ── Spielablauf ─────────────────────────────────────────────
  start() {
    this.audio.init();
    // Splitscreen: Geräusche kommen aus mehreren Hörerpositionen zugleich → etwas leiser
    this.audio.setVolumes({ master: this.settings.master, music: this.settings.music, sfx: this.split ? 0.75 : 1 });
    this.audio.enabledAmbient = true;
    this.resetWorld();
    this.state = 'playing';
    this.hud.show(true);
    if (this.touch) this.touch.show(true);
    this.round = 0;
    this.roundActive = false;
    this.intermission = 2.5;
    this.stats = { kills: 0, headshots: 0, spent: 0, start: this.time, earned: 500 };
    this.hud.round(0); // der erste Kreidestrich erscheint erst mit Runde 1
    this.hud.showHits = !!this.settings.hitmarker;
    // Intro wie im Original: Ort und Zeit erscheinen Buchstabe für Buchstabe
    if (this.mapDef.intro) this.hud.intro(this.mapDef.intro, this.audio);
    else this.hud.notice(this.mapDef.name, 3000);
    if (location.hash.includes('dev')) { this.points = 50000; this.godMode = true; this.hud.points(this.points); }
    this.lastT = performance.now();
  }

  // ── Koop ────────────────────────────────────────────────────
  // sess: { room, isHost, hostId, selfId, slot, players:[{slot, peerId, name, char}], map, code }
  async startNetGame(sess, progress = null) {
    if (this.net) this.leaveNetGame(true);
    const onProgress = progress || sess.onProgress || (() => {});
    if (!this.mapDef || this.mapDef.id !== sess.map) await this.loadMap(sess.map, onProgress);
    this.net = new NetSession(this, sess);
    this.net.setupSurvivors();
    this.start();
    this.net.begin();
    if (this.onNetStart) this.onNetStart();
  }

  leaveNetGame(silent = false) {
    const net = this.net;
    if (!net) return;
    net.close();
    try { if (net.room && net.room.leave) net.room.leave(); } catch { /* */ }
    this.net = null;
    this.netHold = false;
    for (const s of this.survivors) if (!s.local) s.dispose();
    this.me = new LocalSurvivor(this);
    this.survivors = [this.me];
    this.menuOpen = false;
    void silent;
  }

  // Ereignis vom Host (Mitspieler-Geräte): an das zuständige System weiterreichen
  netEvent(e) {
    if (this.interact.netEvent && this.interact.netEvent(e)) return;
    if (this.powerups.netEvent && this.powerups.netEvent(e)) return;
    for (const f of this.features) if (f.netEvent && f.netEvent(e)) return;
  }

  // Anfrage eines Mitspielers (nur Host): liefert { ok, ... }
  netRequest(kind, d, s) {
    let r = this.interact.netRequest ? this.interact.netRequest(kind, d, s) : undefined;
    if (r) return r;
    for (const f of this.features) if (f.netRequest && (r = f.netRequest(kind, d, s))) return r;
    return { ok: false };
  }

  // Komplett neue Partie, ohne die Seite neu zu laden (wichtig auf Handys)
  resetWorld() {
    this.zombies.clear();
    this.map.reset();
    this.interact.reset();
    this.effects.reset();
    this.powerups.reset();
    this.player.reset();
    this.weapons.reset();
    for (const f of this.features) if (f.reset) f.reset();
    this.hud.clearMapHud();
    this.zombieEyes(false);
    this.station = null;
    this.audio.setMuffle(0);
    this.points = 500;
    this.round = 0;
    this.roundActive = false;
    this.repairPoints = 0;
    this.flash = 0;
    this.godMode = false;
    this.hud.perks(this.player.perks);
    this.hud.points(this.points);
    this.hud.round(1);
    for (const s of this.survivors) if (s.reset) s.reset();
    this.menuOpen = false;
  }

  toMenu() {
    if (this.net) this.leaveNetGame();
    this.state = 'menu';
    this.hud.show(false);
    if (this.touch) this.touch.show(false);
    this.input.unlock();
    this.resetWorld();
    this.audio.resume();
  }

  nextRound() {
    this.round++;
    this.powerups.dropsThisRound = 0;
    this.zombies.startRound(this.round);
    if (this.net) this.net.ev({ t: 'rnd', r: this.round });
    this.netRound(this.round);
  }

  // Rundenbeginn auf jedem Gerät (beim Host direkt, bei Mitspielern per Ereignis)
  netRound(r) {
    this.round = r;
    this.roundActive = true;
    this.repairPoints = 0;
    if (r > 1) this.weapons.grenades = Math.min(4, this.weapons.grenades + 2);
    if (this.player.spectating) this.player.respawn();
    this.hud.round(r, true);
    this.audio.roundStart(r);
  }

  endRound() {
    this.intermission = 10;
    if (this.net) this.net.ev({ t: 'rend' });
    this.netRoundEnd();
  }

  netRoundEnd() {
    this.roundActive = false;
    this.audio.roundEnd();
    this.hud.roundEnding();
  }

  spend(cost) {
    if (this.points < cost) { this.audio.deny(); this.hud.deny(); return false; }
    this.points -= cost;
    this.stats.spent += cost;
    this.hud.points(this.points);
    this.hud.pointsPop(-cost);
    this.audio.purchase();
    return true;
  }

  // by: Überlebender, dem die Punkte gehören (Mitspieler bekommen sie über das Netz)
  addPoints(n, raw = false, by = null) {
    if (!raw && this.powerups.double) n *= 2;
    if (by && !by.local) {
      if (n > 0) this.stats.earned = (this.stats.earned || 500) + n;
      if (this.net) this.net.credit(by, n);
      return;
    }
    this.points += n;
    if (n > 0) this.stats.earned = (this.stats.earned || 500) + n; // für die Power-Up-Schwelle
    this.hud.points(this.points);
    this.hud.pointsPop(n);
  }

  onZombieKilled(z, opts) {
    this.powerups.onKill(z.pos, opts);
    for (const f of this.features) if (f.onKill) f.onKill(z, opts);
  }

  // Boden unter einer Position (Karten-Elemente wie der Bus können ihn anheben)
  floorAt(p) {
    let y = 0;
    for (const f of this.features) if (f.floorAt) y = Math.max(y, f.floorAt(p));
    return y;
  }

  // Bewegliche Hindernisse (Bus) schieben Spieler/Zombies heraus
  constrain(p, r) {
    for (const f of this.features) if (f.constrain) f.constrain(p, r);
  }

  // Strahl gegen bewegliche Hindernisse; ersetzt den Wandtreffer, wenn näher
  rayBlock(o, d, hit) {
    for (const f of this.features) {
      if (!f.rayCast) continue;
      const h = f.rayCast(o, d, hit.dist);
      if (h && h.dist < hit.dist) { hit.dist = h.dist; hit.normal = h.normal; hit.mat = h.mat; }
    }
    return hit;
  }

  explode(pos, radius, damage, opts = {}) {
    this.effects.explosion(pos, opts.small ? radius * 0.7 : radius, opts.color, !!opts.energy);
    if (!opts.energy || !opts.small) this.audio.explosion(pos, opts.small ? 0.6 : 1);
    else this.audio.explosion(pos, 0.45);
    if (!opts.small) this.effects.bloodDecal(pos.x, pos.z, 0.6);
    // Koop: eigene Explosionen melden; den Schaden verteilt der Host
    if (this.net && !opts.remote) this.net.boom(pos, radius, damage, opts);
    if (!this.isClient) for (const z of this.zombies.inRadius(pos, radius)) {
      const d = Math.hypot(z.pos.x - pos.x, z.pos.z - pos.z);
      // Voller Schaden in der Mitte, am Rand nur noch der Anteil falloff (Standard: die Hälfte)
      const dmg = damage * (1 - (1 - (opts.falloff ?? 0.5)) * Math.min(1, d / radius));
      const dir = new THREE.Vector3(z.pos.x - pos.x, 0.5, z.pos.z - pos.z).normalize();
      this.zombies.damage(z, dmg, 'torso', { dir, explosive: true, point: z.pos.clone().setY(1.2), noPoints: false, by: opts.by });
    }
    const pd = this.player.pos.distanceTo(pos);
    this.player.shake = Math.max(this.player.shake, clamp(1 - pd / (radius * 3), 0, 1) * (opts.small ? 0.3 : 0.9));
  }

  // Augenfarbe der Zombies: orange (normal) oder blau (nach dem Signal)
  zombieEyes(blue) {
    const z = this.zombies;
    if (!z) return;
    if (blue) { z.eyes.setColor(0.5, 1.5, 4.2); this.M.zombie.eye.color.setRGB(0.8, 2.4, 6.0); }
    else { z.eyes.setColor(3.2, 1.5, 0.25); this.M.zombie.eye.color.setRGB(6.0, 2.4, 0.3); }
  }

  powerOn() {
    this.map.setPower(true);
    this.audio.powerOn();
    this.hud.notice('Der Strom ist an!', 3500);
    this.flash = 0.25;
  }

  // fromNet: vom Host ausgelöst (Koop). Allein bzw. als Host: lokal
  gameOver(fromNet = false) {
    if (this.state === 'gameover') return;
    // Im Koop ist man nach dem Ausbluten nur Zuschauer – Schluss ist erst, wenn alle liegen
    if (this.net && this.coop && !fromNet) return;
    this.state = 'gameover';
    if (this.touch) this.touch.show(false);
    this.audio.gameOver();
    this.audio.setMuffle(0.6);
    this.input.unlock();
    const secs = Math.floor(this.time - this.stats.start);
    const r = this.round;
    if (this.secondary) { setTimeout(() => { if (this.state === 'gameover') this.hud.show(false); }, 3500); return; }
    document.getElementById('goRounds').textContent = `Du hast ${r} ${r === 1 ? 'Runde' : 'Runden'} überlebt`;
    if (this.coop) {
      // Koop: Übersicht für alle Spieler (wie die Tabelle am Ende einer BO2-Partie)
      const rows = this.survivors.map((s) => `<tr><td style="color:${s.color}">${escapeHtml(s.name)}${s.left ? ' (weg)' : ''}</td><td>${s.local ? this.points : s.points} Pkt · ${s.stats.kills} Kills · ${s.stats.headshots} Kopf · ${s.stats.downs}× am Boden · ${s.stats.revives}× belebt</td></tr>`).join('');
      document.getElementById('goStats').innerHTML = rows + `<tr><td>Überlebenszeit</td><td>${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</td></tr>`;
    } else document.getElementById('goStats').innerHTML = `
      <tr><td>Kills</td><td>${this.stats.kills}</td></tr>
      <tr><td>Kopfschüsse</td><td>${this.stats.headshots}</td></tr>
      <tr><td>Ausgegebene Punkte</td><td>${this.stats.spent}</td></tr>
      <tr><td>Überlebenszeit</td><td>${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</td></tr>`;
    try {
      const key = bestKey(this.mapDef.id);
      const best = +(localStorage.getItem(key) || 0);
      if (r > best) localStorage.setItem(key, r);
    } catch { /* Speicher nicht verfügbar */ }
    setTimeout(() => {
      if (this.state !== 'gameover') return;
      this.hud.show(false);
      if (this.onGameOver) this.onGameOver();
    }, 3500);
  }

  pause() {
    if (this.state !== 'playing') return false;
    if (this.net && !this.split) {
      // Koop: Menü öffnen, aber die Welt läuft weiter (wie online in BO2); Splitscreen hält wirklich an
      this.menuOpen = true;
      if (this.touch) this.touch.show(false);
      return true;
    }
    this.state = 'paused';
    if (this.touch) this.touch.show(false);
    this.audio.suspend();
    return true;
  }

  resume() {
    if (this.menuOpen) { this.menuOpen = false; if (this.touch) this.touch.show(true); return; }
    if (this.state !== 'paused') return;
    this.state = 'playing';
    if (this.touch) this.touch.show(true);
    this.audio.resume();
    this.lastT = performance.now();
  }

  // Splitscreen: feste Grafikstufe (null = wieder die Einstellung)
  setQualityOverride(q) {
    this.qualityOverride = q || null;
    this.applySettings();
  }

  // Splitscreen: zusätzliche Instanz wieder abbauen
  dispose() {
    this.disposed = true;
    if (this.net) this.leaveNetGame(true);
    try { this.unloadMap(); } catch (err) { console.error(err); }
    try { this.rs.dispose(); } catch { /* */ }
    try { if (this.audio && this.audio.ctx) this.audio.ctx.close(); } catch { /* */ }
    this.input.dispose();
  }

  // ── Hauptschleife ──────────────────────────────────────────
  loop(t) {
    if (this.disposed) return;
    requestAnimationFrame((tt) => this.loop(tt));
    const raw = (t - this.lastT) / 1000;
    this.lastT = t;
    let dt = raw > 0 ? Math.min(raw, 0.05) : 0.016;
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 0.5) { this.fps = Math.round(this.fpsN / this.fpsAcc); this.fpsAcc = 0; this.fpsN = 0; }
    this.adaptResolution(raw);

    if (this.state === 'paused') { this.rs.render(); this.input.endFrame(); return; }
    // Während eine Karte lädt, weder aktualisieren noch zeichnen (halb gebaute Szene)
    if (this.state === 'loading') { this.input.endFrame(); return; }
    const slow = this.state === 'gameover' ? 0.35 : 1;
    const sdt = dt * slow;
    this.time += sdt;
    this.update(sdt);
    this.render(dt);
    this.input.endFrame();
  }

  // Dynamische Auflösung: hält die Bildrate auf schwächeren Geräten flüssig
  adaptResolution(raw) {
    if (this.settings.quality !== 'auto' || !(raw > 0) || raw > 0.1) return;
    if (this.state !== 'playing' && this.state !== 'menu') return;
    const p = this.perf;
    p.acc += raw; p.n++;
    if (p.acc < 2) return;
    const avg = p.acc / p.n;
    p.acc = 0; p.n = 0;
    let s = this.rs.scale;
    if (avg > 1 / 45 && s > 0.55) s = Math.max(0.55, s * 0.85);
    else if (avg < 1 / 57 && s < 1) s = Math.min(1, s * 1.1);
    if (Math.abs(s - this.rs.scale) > 0.01) this.rs.setScale(s);
  }

  update(dt) {
    const playing = this.state === 'playing';
    if (this.touch) this.touch.update();
    this.input.poll(dt);
    if (this.menuOpen) this.input.suppress(); // Koop-Menü offen: Spielfigur hört nicht auf Eingaben
    if (playing && !this.menuOpen && this.input.hit('pause') && this.onPauseRequest) { this.onPauseRequest(); return; }
    if (this.net) this.net.update(dt);

    // Bewegliche Karten-Elemente (z. B. Bus) vor dem Spieler bewegen, damit Mitfahrer nicht ruckeln
    for (const f of this.features) if (f.early) f.early(dt, playing);
    if (playing || this.state === 'gameover') {
      this.player.update(dt, this.input);
      this.weapons.update(dt, this.input);
      this.zombies.update(dt);
      this.interact.update(dt, this.time, this.input);
      this.powerups.update(dt, this.time);
    } else {
      // Menü: Kamerafahrt durch die Karte
      if (this.mapDef.menuCamera) this.mapDef.menuCamera(this.camera, this.time, this);
      for (const it of this.interact.list) it.update(dt, this.time);
    }
    for (const f of this.features) if (f.update) f.update(dt, this.time, playing || this.state === 'gameover');
    this.map.update(dt, this.time, this.camera.position);
    this.fogCull();
    this.effects.update(dt);
    if (playing) this.checkStation();

    // Rundenlogik (im Koop nur beim Host)
    if (playing && !this.isClient && !this.netHold) {
      if (this.roundActive && this.zombies.remaining <= 0 && this.zombies.toSpawn <= 0) this.endRound();
      if (!this.roundActive) {
        this.intermission -= dt;
        if (this.intermission <= 0) this.nextRound();
      }
    }

    // Atmosphäre
    const cp = this.camera.position;
    for (const e of this.map.emberSources) {
      const d2 = (e.x - cp.x) ** 2 + (e.z - cp.z) ** 2;
      if (Math.random() < 0.5 && d2 < 1600) this.effects.ember(e);
      if (e.flame && d2 < 900) this.effects.flame(e);
    }
    if (Math.random() < 0.25) this.effects.ambientDust(this.camera.position);
    // Asche rieselt im Freien
    const ash = this.mapDef.env && this.mapDef.env.ash;
    if (ash) {
      const c = this.map.cellAt(cp.x, cp.z);
      const outside = !c || !this.map.hasCeiling(c);
      const n = outside ? ash * (this.rs.quality.lightTier >= 2 ? 1 : 0.5) : 0;
      for (let i = 0; i < n || Math.random() < n - i; i++) { this.effects.ash(cp); if (i > 3) break; }
    }
    this.flash = Math.max(0, this.flash - dt * 1.2);
    this.computeLightLevel();
    this.audio.updateListener(this.camera);
    this.hud.update(dt, this.player, this.settings.showFps ? this.fps : null);
    if (this.net) this.hud.team(this.survivors.filter((s) => !s.local).map((s) => ({ name: s.name, color: s.color, points: s.points, down: s.downed, dead: s.dead || s.left })));
    if (this.input.keyHit('KeyP') && location.hash.includes('dev')) this.debugSkip();
  }

  fogCull() {
    if (!this.cullList.length || !this.scene.fog) return;
    const env = this.mapDef.env, cp = this.camera.position;
    const d = clamp(env.fogCull / this.scene.fog.density, env.minCull || 55, 400);
    for (const e of this.cullList) e.o.visible = Math.hypot(e.x - cp.x, e.z - cp.z) - e.r < d;
  }

  // Benannte Orte (Haltestellen usw.) beim Betreten einblenden
  checkStation() {
    if (!this.mapDef.stations) return;
    const p = this.player.pos;
    const st = this.map.stationAt(p.x, p.z);
    if (st !== this.station) {
      this.station = st;
      if (st && st.name) this.hud.notice(st.name, 2600);
    }
  }

  debugSkip() {
    this.zombies.killAll({});
    this.zombies.remaining = 0; this.zombies.toSpawn = 0;
  }

  computeLightLevel() {
    const p = this.camera.position;
    let sum = 0;
    for (const e of this.map.lights) {
      const lp = e.light.position;
      const d2 = (lp.x - p.x) ** 2 + (lp.y - p.y) ** 2 + (lp.z - p.z) ** 2;
      sum += e.light.intensity / (1 + d2);
    }
    if (this.mapDef.outdoorLight && !this.map.hasCeiling(this.map.cellAt(p.x, p.z) || { type: 'void' })) sum += this.mapDef.outdoorLight;
    else if (!this.mapDef.outdoorLight && this.map.zoneAt(p.x, p.z) === 3) sum += 3;
    if (this.map.lightPool) sum += this.map.lightPool.levelAt(p);
    sum += this.effects.muzzleLight.intensity * 0.3 + this.effects.blastLight.intensity * 0.05;
    this.lightLevel = damp(this.lightLevel, clamp(sum * 0.06 + 0.12, 0.12, 1), 4, 1 / 60);
  }

  // Splitscreen: sehr breite Ausschnitte (oben/unten geteilt) bekommen das waagerechte
  // Sichtfeld eines 16:9-Bildes statt eines riesigen Weitwinkels
  viewFov(f) {
    const a = this.rs.width / this.rs.height;
    if (!this.split || a <= 16 / 9 + 0.01) return f;
    const h = Math.atan(Math.tan((f * Math.PI) / 360) * (16 / 9));
    return (Math.atan(Math.tan(h) / a) * 360) / Math.PI;
  }

  render(dt) {
    const u = this.rs.uniforms;
    const p = this.player;
    const w = this.weapons;
    let fov = this.viewFov(this.settings.fov);
    if (w.weapon && (this.state === 'playing' || this.state === 'gameover')) {
      fov = w.weapon.stats.scope ? fov - (fov - 22) * w.ads : fov * (1 - 0.18 * w.ads);
      if (p.sprinting) fov += 4;
    }
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
      this.effects.setScale(this.rs.height * this.rs.renderer.getPixelRatio(), fov);
    }
    u.uTime.value = this.time;
    const low = 1 - p.health / p.maxHealth;
    u.uDamage.value = damp(u.uDamage.value, Math.max(p.hurtFlash, low > 0.35 ? low : 0, p.downed ? 0.7 : 0), 8, dt);
    u.uDesat.value = damp(u.uDesat.value, this.state === 'gameover' ? 0.85 : p.downed ? 0.75 : low * 0.4, 3, dt);
    u.uFlash.value = this.flash;
    u.uPap.value = damp(u.uPap.value, w.weapon && w.weapon.pap && w.ads > 0.5 ? 0.6 : 0, 5, dt);
    if (this.map) this.map.applyAtmosphere(this.time);
    // Im Hauptmenü keine Arme vor der Kamerafahrt
    this.vmScene.visible = this.state !== 'menu';
    this.rs.render();
  }

  get qualityLabel() { return this.rs.qualityName + (QUALITY[this.settings.quality] ? '' : ' (auto)'); }
}
