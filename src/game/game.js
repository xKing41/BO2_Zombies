// ─────────────────────────────────────────────────────────────
//  Spiel: verbindet alle Systeme, Rundenlogik, Punkte, Hauptschleife.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RenderSystem } from '../core/renderer.js';
import { setAnisotropy } from '../core/textures.js';
import { buildMaterials } from '../core/materials.js';
import { Input } from '../core/input.js';
import { AudioEngine } from '../audio/audio.js';
import { GameMap } from '../world/map.js';
import { Effects } from '../fx/effects.js';
import { Player } from '../player/player.js';
import { Weapons } from '../weapons/weapons.js';
import { ZombieManager } from '../zombies/manager.js';
import { Interactables } from './interactables.js';
import { PowerUps } from './powerups.js';
import { HUD } from '../ui/hud.js';
import { clamp, damp, rand } from '../core/utils.js';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

export const DEFAULT_SETTINGS = { sensitivity: 1, fov: 80, master: 0.8, music: 0.6, quality: 'hoch', invertY: false, showFps: false };

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
    this.input = new Input(canvas);
  }

  async init(progress) {
    const step = async (pct, text) => { progress(pct, text); await nextFrame(); };
    await step(5, 'Grafik wird initialisiert …');
    this.rs = new RenderSystem(this.canvas, this.settings.quality);
    setAnisotropy(Math.min(8, this.rs.renderer.capabilities.getMaxAnisotropy()));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 0.05, 400);
    this.camera.rotation.order = 'YXZ';
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(54, innerWidth / innerHeight, 0.01, 10);
    this.scene.add(this.camera);
    this.rs.setup(this.scene, this.camera, this.vmScene, this.vmCamera);
    this.rs.onResize = (w, h) => this.effects && this.effects.setScale(h * this.rs.renderer.getPixelRatio(), this.camera.fov);
    const pmrem = new THREE.PMREMGenerator(this.rs.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.12;
    this.vmScene.environment = this.scene.environment;
    this.vmScene.environmentIntensity = 0.15;

    // Schriften für Canvas-Texturen abwarten (max. 1.5 s)
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);

    let n = 0;
    const labels = 8;
    this.M = buildMaterials((label) => { n++; progress(10 + (n / labels) * 50, `Texturen: ${label} …`); });
    await step(62, 'Station Nachtfall wird gebaut …');
    this.map = new GameMap();
    this.map.build(this.scene, this.M);
    await step(72, 'Effekte …');
    this.effects = new Effects(this.scene, this.M);
    this.audio = new AudioEngine();
    this.hud = new HUD();
    this.player = new Player(this);
    await step(78, 'Waffen …');
    this.weapons = new Weapons(this);
    await step(84, 'Die Toten erwachen …');
    this.zombies = new ZombieManager(this);
    this.interact = new Interactables(this);
    this.powerups = new PowerUps(this);
    this.hud.iconUrls = Object.fromEntries(Object.entries(this.powerups.icons).map(([k, t]) => [k, t.image.toDataURL()]));
    await step(92, 'Shader werden kompiliert …');
    this.precompile();
    this.effects.setScale(innerHeight * this.rs.renderer.getPixelRatio(), this.camera.fov);
    await step(100, 'Bereit.');
    this.state = 'menu';
    this.lastT = performance.now();
    this.fpsAcc = 0; this.fpsN = 0; this.fps = 0;
    this.player.update(0, this.input);
    requestAnimationFrame((t) => this.loop(t));
  }

  precompile() {
    // Alle Zombies kurz sichtbar machen, damit ihre Materialien vorab kompiliert werden
    for (const z of this.zombies.pool) { z.root.visible = true; z.pos.set(-50, 0, -50); }
    this.rs.renderer.compile(this.scene, this.camera);
    this.rs.renderer.compile(this.vmScene, this.vmCamera);
    this.rs.render();
    for (const z of this.zombies.pool) z.root.visible = false;
  }

  applySettings() {
    const s = this.settings;
    this.camera.fov = s.fov;
    this.audio.setVolumes({ master: s.master, music: s.music });
    if (this.rs.qualityName !== s.quality) {
      this.rs.setQuality(s.quality);
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
    this.round = 0;
    this.roundActive = false;
    this.intermission = 2.5;
    this.stats = { kills: 0, headshots: 0, spent: 0, start: this.time };
    this.hud.round(1);
    this.hud.notice('Station Nachtfall', 3000);
    if (location.hash.includes('dev')) { this.points = 50000; this.godMode = true; }
  }

  resetWorld() {
    // Für "Nochmal": Seite neu laden ist am saubersten, wenn bereits gespielt wurde
    if (this.played) { location.reload(); return; }
    this.played = true;
    this.points = 500;
    this.player.reset();
    this.weapons.reset();
    this.powerups.reset();
    this.hud.perks(this.player.perks);
    this.hud.points(this.points);
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
    this.audio.gameOver();
    this.audio.setMuffle(0.6);
    this.input.unlock();
    this.goT = 0;
    const secs = Math.floor(this.time - this.stats.start);
    const r = this.round;
    document.getElementById('goRounds').textContent = `Du hast ${r} ${r === 1 ? 'Runde' : 'Runden'} überlebt`;
    document.getElementById('goStats').innerHTML = `
      <tr><td>Kills</td><td>${this.stats.kills}</td></tr>
      <tr><td>Kopfschüsse</td><td>${this.stats.headshots}</td></tr>
      <tr><td>Ausgegebene Punkte</td><td>${this.stats.spent}</td></tr>
      <tr><td>Überlebenszeit</td><td>${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</td></tr>`;
    try {
      const best = +(localStorage.getItem('nachtfall.best') || 0);
      if (r > best) localStorage.setItem('nachtfall.best', r);
    } catch { /* */ }
    setTimeout(() => { this.hud.show(false); this.onGameOver && this.onGameOver(); }, 3500);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.audio.suspend();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.audio.resume();
    this.lastT = performance.now();
  }

  // ── Hauptschleife ──────────────────────────────────────────
  loop(t) {
    requestAnimationFrame((tt) => this.loop(tt));
    let dt = (t - this.lastT) / 1000;
    this.lastT = t;
    if (!(dt > 0)) dt = 0.016;
    dt = Math.min(dt, 0.05);
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 0.5) { this.fps = Math.round(this.fpsN / this.fpsAcc); this.fpsAcc = 0; this.fpsN = 0; }

    if (this.state === 'paused') { this.rs.render(); return; }
    const slow = this.state === 'gameover' ? 0.35 : 1;
    const sdt = dt * slow;
    this.time += sdt;
    this.update(sdt);
    this.render(dt);
    this.input.endFrame();
  }

  update(dt) {
    const playing = this.state === 'playing';
    if (playing || this.state === 'gameover') {
      this.player.update(dt, this.input);
      this.weapons.update(dt, this.input);
      this.zombies.update(dt);
      this.interact.update(dt, this.time, this.input);
      this.powerups.update(dt, this.time);
    } else {
      // Menü: langsame Kamerafahrt durch die Halle
      const a = this.time * 0.05;
      this.camera.position.set(13 + Math.sin(a) * 3, 1.8, 13 + Math.cos(a) * 3);
      this.camera.rotation.set(-0.05, a * 0.8 - 1.2, 0, 'YXZ');
      for (const it of this.interact.list) it.update(dt, this.time);
    }
    this.map.update(dt, this.time);
    this.effects.update(dt);

    // Rundenlogik
    if (playing) {
      if (this.roundActive && this.zombies.remaining <= 0 && this.zombies.toSpawn <= 0) this.endRound();
      if (!this.roundActive) {
        this.intermission -= dt;
        if (this.intermission <= 0) this.nextRound();
      }
    }

    // Atmosphäre
    if (this.map.fireBarrelPos && Math.random() < 0.5) this.effects.ember(this.map.fireBarrelPos.clone().setY(0.9));
    if (Math.random() < 0.25) this.effects.ambientDust(this.camera.position);
    this.flash = Math.max(0, this.flash - dt * 1.2);
    this.computeLightLevel();
    this.audio.updateListener(this.camera);
    this.hud.update(dt, this.player, this.settings.showFps ? this.fps : null);
    if (this.input.hit('KeyP') && location.hash.includes('dev')) this.debugSkip();
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
    if (this.map.zoneAt(p.x, p.z) === 3) sum += 3;
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
}
