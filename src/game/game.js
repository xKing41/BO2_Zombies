// ─────────────────────────────────────────────────────────────
//  Spiel: verbindet alle Systeme, Rundenlogik, Punkte, Hauptschleife.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
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
import { clamp, damp } from '../core/utils.js';
import { CELL } from '../config.js';
import { MAPS } from '../maps/index.js';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
// Rekord je Karte (Nachtfall behält den alten Schlüssel)
export const bestKey = (id) => (id === 'nachtfall' ? 'nachtfall.best' : 'nachtfall.best.' + id);

export const DEFAULT_SETTINGS = {
  sensitivity: 1, fov: 80, master: 0.8, music: 0.6, quality: 'auto',
  invertY: false, showFps: false, aimAssist: true, map: 'nachtfall',
};

export class Game {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;
    this.state = 'loading';
    this.round = 0;
    this.points = 500;
    this.stats = { kills: 0, headshots: 0, spent: 0, start: 0 };
    this.flash = 0;
    this.time = 0;
    this.lightLevel = 0.5;
    this.repairPoints = 0;
    this.input = new Input(canvas);
    this.touch = null; // wird von main.js gesetzt
    this.perf = { acc: 0, n: 0 };
    this.features = [];
    this.mapDef = null;
  }

  async init(progress) {
    const step = async (pct, text) => { progress(pct, text); await nextFrame(); };
    await step(5, 'Grafik wird initialisiert …');
    this.rs = new RenderSystem(this.canvas, this.settings.quality);
    const q = this.rs.quality;
    setAnisotropy(Math.min(8, this.rs.renderer.capabilities.getMaxAnisotropy()));
    setTextureScale(q.texScale);
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 0.05, 400);
    this.camera.rotation.order = 'YXZ';
    this.vmCamera = new THREE.PerspectiveCamera(54, innerWidth / innerHeight, 0.01, 10);
    this.scene = new THREE.Scene();
    this.vmScene = new THREE.Scene();
    this.rs.setup(this.scene, this.camera, this.vmScene, this.vmCamera);
    this.rs.onResize = () => this.effects && this.effects.setScale(innerHeight * this.rs.renderer.getPixelRatio(), this.camera.fov);
    const pmrem = new THREE.PMREMGenerator(this.rs.renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    // Schriften für Canvas-Texturen abwarten (max. 1.5 s)
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);

    let n = 0;
    const labels = 8;
    this.M = buildMaterials((label) => { n++; progress(10 + (n / labels) * 40, `Texturen: ${label} …`); });
    this.collectShared();
    this.audio = new AudioEngine();
    this.audio.panningModel = q.hrtf ? 'HRTF' : 'equalpower';
    this.hud = new HUD();
    this.player = new Player(this);
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
    for (const m of this.sharedMats) for (const k of ['map', 'bumpMap', 'emissiveMap']) if (m[k]) this.sharedTex.add(m[k]);
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
    this.scene.environmentIntensity = 0.12;
    this.vmScene = new THREE.Scene();
    this.vmScene.environment = this.envMap;
    this.vmScene.environmentIntensity = 0.15;
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
    this.effects.setScale(innerHeight * this.rs.renderer.getPixelRatio(), this.camera.fov);
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
    const freed = new Set();
    const free = (scene) => scene.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      if (o.geometry && !o.geometry.userData.shared && !freed.has(o.geometry)) { freed.add(o.geometry); o.geometry.dispose(); }
      if (o.material) for (const m of [].concat(o.material)) {
        if (this.sharedMats.has(m) || freed.has(m)) continue;
        freed.add(m);
        for (const k of ['map', 'bumpMap', 'emissiveMap', 'alphaMap']) if (m[k] && !this.sharedTex.has(m[k]) && !freed.has(m[k])) { freed.add(m[k]); m[k].dispose(); }
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
    this.camera.fov = s.fov;
    this.audio.setVolumes({ master: s.master, music: s.music });
    if (this.rs.qualityName !== resolveQuality(s.quality)) {
      this.rs.setQuality(s.quality);
      this.applyLightQuality();
      // Schatten an/aus erfordert neue Shader
      this.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => (m.needsUpdate = true)); });
      this.effects.setScale(innerHeight * this.rs.renderer.getPixelRatio(), this.camera.fov);
    }
  }

  // ── Spielablauf ─────────────────────────────────────────────
  start() {
    this.audio.init();
    this.audio.setVolumes({ master: this.settings.master, music: this.settings.music });
    this.audio.enabledAmbient = true;
    this.resetWorld();
    this.state = 'playing';
    this.hud.show(true);
    if (this.touch) this.touch.show(true);
    this.round = 0;
    this.roundActive = false;
    this.intermission = 2.5;
    this.stats = { kills: 0, headshots: 0, spent: 0, start: this.time };
    this.hud.round(1);
    this.hud.notice(this.mapDef.name, 3000);
    if (location.hash.includes('dev')) { this.points = 50000; this.godMode = true; this.hud.points(this.points); }
    this.lastT = performance.now();
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
  }

  toMenu() {
    this.state = 'menu';
    this.hud.show(false);
    if (this.touch) this.touch.show(false);
    this.input.unlock();
    this.resetWorld();
    this.audio.resume();
  }

  nextRound() {
    this.round++;
    this.roundActive = true;
    this.repairPoints = 0;
    this.powerups.dropsThisRound = 0;
    this.zombies.startRound(this.round);
    if (this.round > 1) this.weapons.grenades = Math.min(4, this.weapons.grenades + 2);
    this.hud.round(this.round, this.round > 1);
    this.audio.roundStart(this.round);
  }

  endRound() {
    this.roundActive = false;
    this.intermission = 10;
    this.audio.roundEnd();
    this.hud.round(this.round, true);
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

  addPoints(n, raw = false) {
    if (!raw && this.powerups.double) n *= 2;
    this.points += n;
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
    for (const z of this.zombies.inRadius(pos, radius)) {
      const d = Math.hypot(z.pos.x - pos.x, z.pos.z - pos.z);
      const dmg = damage * (1 - 0.5 * (d / radius));
      const dir = new THREE.Vector3(z.pos.x - pos.x, 0.5, z.pos.z - pos.z).normalize();
      this.zombies.damage(z, dmg, 'torso', { dir, explosive: true, point: z.pos.clone().setY(1.2), noPoints: false });
    }
    const pd = this.player.pos.distanceTo(pos);
    this.player.shake = Math.max(this.player.shake, clamp(1 - pd / (radius * 3), 0, 1) * (opts.small ? 0.3 : 0.9));
  }

  powerOn() {
    this.map.setPower(true);
    this.audio.powerOn();
    this.hud.notice('Der Strom ist an!', 3500);
    this.flash = 0.25;
  }

  gameOver() {
    if (this.state === 'gameover') return;
    this.state = 'gameover';
    if (this.touch) this.touch.show(false);
    this.audio.gameOver();
    this.audio.setMuffle(0.6);
    this.input.unlock();
    const secs = Math.floor(this.time - this.stats.start);
    const r = this.round;
    document.getElementById('goRounds').textContent = `Du hast ${r} ${r === 1 ? 'Runde' : 'Runden'} überlebt`;
    document.getElementById('goStats').innerHTML = `
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
    this.state = 'paused';
    if (this.touch) this.touch.show(false);
    this.audio.suspend();
    return true;
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    if (this.touch) this.touch.show(true);
    this.audio.resume();
    this.lastT = performance.now();
  }

  // ── Hauptschleife ──────────────────────────────────────────
  loop(t) {
    requestAnimationFrame((tt) => this.loop(tt));
    const raw = (t - this.lastT) / 1000;
    this.lastT = t;
    let dt = raw > 0 ? Math.min(raw, 0.05) : 0.016;
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 0.5) { this.fps = Math.round(this.fpsN / this.fpsAcc); this.fpsAcc = 0; this.fpsN = 0; }
    this.adaptResolution(raw);

    if (this.state === 'paused') { this.rs.render(); this.input.endFrame(); return; }
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
    if (playing && this.input.hit('pause') && this.onPauseRequest) { this.onPauseRequest(); return; }

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

    // Rundenlogik
    if (playing) {
      if (this.roundActive && this.zombies.remaining <= 0 && this.zombies.toSpawn <= 0) this.endRound();
      if (!this.roundActive) {
        this.intermission -= dt;
        if (this.intermission <= 0) this.nextRound();
      }
    }

    // Atmosphäre
    const cp = this.camera.position;
    for (const e of this.map.emberSources) {
      if (Math.random() < 0.5 && (e.x - cp.x) ** 2 + (e.z - cp.z) ** 2 < 1600) this.effects.ember(e);
    }
    if (Math.random() < 0.25) this.effects.ambientDust(this.camera.position);
    this.flash = Math.max(0, this.flash - dt * 1.2);
    this.computeLightLevel();
    this.audio.updateListener(this.camera);
    this.hud.update(dt, this.player, this.settings.showFps ? this.fps : null);
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

  render(dt) {
    const u = this.rs.uniforms;
    const p = this.player;
    const w = this.weapons;
    let fov = this.settings.fov;
    if (w.weapon && (this.state === 'playing' || this.state === 'gameover')) {
      fov = w.weapon.stats.scope ? fov - (fov - 22) * w.ads : fov * (1 - 0.18 * w.ads);
      if (p.sprinting) fov += 4;
    }
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
      this.effects.setScale(innerHeight * this.rs.renderer.getPixelRatio(), fov);
    }
    u.uTime.value = this.time;
    const low = 1 - p.health / p.maxHealth;
    u.uDamage.value = damp(u.uDamage.value, Math.max(p.hurtFlash, low > 0.35 ? low : 0, p.downed ? 0.7 : 0), 8, dt);
    u.uDesat.value = damp(u.uDesat.value, this.state === 'gameover' ? 0.85 : p.downed ? 0.75 : low * 0.4, 3, dt);
    u.uFlash.value = this.flash;
    u.uPap.value = damp(u.uPap.value, w.weapon && w.weapon.pap && w.ads > 0.5 ? 0.6 : 0, 5, dt);
    this.rs.render();
  }

  get qualityLabel() { return this.rs.qualityName + (QUALITY[this.settings.quality] ? '' : ' (auto)'); }
}
