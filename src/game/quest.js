// ─────────────────────────────────────────────────────────────
//  Hauptquest "Das Signal" und das Musik-Geheimnis.
//
//  1. Strom einschalten und die Turbine am Funkmast aufstellen
//  2. Drei Tonbänder finden – jedes verrät eine Ziffer der Frequenz
//  3. Die Frequenz am Funkempfänger im Busbahnhof einstellen
//  4. 25 Seelen am Mast sammeln (Zombies in seiner Nähe töten)
//  5. Die Übertragung 60 Sekunden lang verteidigen
//  Belohnung: Nebel lichtet sich, alle Perks, Gewitter-Werfer, Erfolg.
//
//  Musik: Drei Spieluhren aufziehen → geheimes Lied "Nebelfahrt".
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { MAST, MAST_PAD, RADIO, TAPE_SPOTS, MUSIC_BOXES, wx } from '../maps/linie13-data.js';
import { WALLDIR } from '../world/map.js';
import { PERKS } from '../config.js';
import { rand, randInt, clamp } from '../core/utils.js';
import * as T from '../core/textures.js';

const SOULS = 25, SOUL_RADIUS = 14, TRANSMIT = 60;
const TAPE_TEXT = [
  'Tonband eins. Doktor Wendt, Kraftwerk Nord. Der Nebel kam in der Nacht, in der Sender 7 verstummte. Ich habe die Frequenz versteckt. Erste Ziffer: {d}.',
  'Tonband zwei. Die Toten hassen den Sender. Sein Signal hält den Nebel zurück. Wer die Frequenz kennt, kann ihn wieder wecken. Zweite Ziffer: {d}.',
  'Tonband drei. Der Funkempfänger steht im Busbahnhof. Stellt die drei Ziffern ein. Dann braucht der Sender Energie. Seelen. Viele Seelen. Letzte Ziffer: {d}.',
];

export class Quest {
  constructor(game, buildables) {
    this.g = game;
    this.b = buildables;
    this.interactables = [];
    const M = game.M, scene = game.scene, map = game.map;
    const verb = () => game.input.verb(false);
    const self = this;

    // ── Tonbänder ──
    this.tapes = [];
    for (let i = 0; i < 3; i++) {
      const grp = new THREE.Group();
      grp.userData.dynamic = true;
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.22), M.dark); body.position.y = 0.06; grp.add(body);
      for (const x of [-0.07, 0.07]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 12), M.chrome); r.position.set(x, 0.125, 0); grp.add(r); }
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.2, 0.1) })); led.position.set(0.13, 0.1, 0.11); grp.add(led);
      scene.add(grp);
      const tape = { i, group: grp, led, pos: new THREE.Vector3(), played: false };
      this.tapes.push(tape);
      this.interactables.push({
        pos: tape.pos, radius: 1.5,
        prompt() { return tape.played ? null : `${verb()}, um das Tonband abzuspielen`; },
        use() { self.playTape(tape); },
        update() {}, reset() {},
      });
    }

    // ── Funkempfänger mit drei Reglern ──
    const radio = new THREE.Group();
    const table = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.06, 0.7), M.woodDark); table.position.y = 0.8; radio.add(table);
    for (const x of [-0.58, 0.58]) for (const z of [-0.28, 0.28]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.8, 0.05), M.woodDark); l.position.set(x, 0.4, z); radio.add(l); }
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.45, 0.35), new THREE.MeshStandardMaterial({ color: 0x4a3a28, roughness: 0.6 })); box.position.y = 1.06; radio.add(box);
    this.dispCanvas = document.createElement('canvas'); this.dispCanvas.width = 256; this.dispCanvas.height = 96;
    this.dispTex = T.toTexture(this.dispCanvas, { repeat: false });
    const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.16), new THREE.MeshBasicMaterial({ map: this.dispTex, color: new THREE.Color(1.5, 1.5, 1.5) }));
    disp.position.set(0, 1.16, 0.176); radio.add(disp);
    this.dials = [];
    for (let i = 0; i < 3; i++) {
      const k = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.05, 14), M.chrome);
      k.rotation.x = Math.PI / 2; k.position.set(-0.22 + i * 0.22, 0.95, 0.19);
      const mark = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.04, 0.01), M.paintRed); mark.position.set(0, 0.03, 0.026); k.add(mark);
      radio.add(k);
      this.dials.push({ knob: k, v: 0 });
    }
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.7, 6), M.chrome); ant.position.set(0.35, 1.6, -0.1); ant.rotation.z = -0.3; radio.add(ant);
    map.place(radio, RADIO.x, RADIO.y, RADIO.wall, 0.75);
    radio.userData.dynamic = true;
    radio.updateMatrixWorld(true);
    map.colliders.push(map.aabb(radio, 0.02));
    this.radio = radio;
    const [rdx, rdz] = WALLDIR[RADIO.wall];
    const radioFront = map.center(RADIO.x, RADIO.y).add(new THREE.Vector3(-rdx * 0.3, 0, -rdz * 0.3));
    this.radioPos = radioFront;
    for (let i = 0; i < 3; i++) {
      const dial = this.dials[i];
      // Seitlich versetzte Bedienpunkte, damit jeder Regler einzeln erreichbar ist
      const side = new THREE.Vector3(-rdz, 0, rdx).multiplyScalar((i - 1) * 0.55);
      this.interactables.push({
        pos: radioFront.clone().add(side), radius: 1.3,
        prompt() { return self.step === 'done' ? null : `${verb()}, um Regler ${i + 1} zu drehen [${dial.v}]`; },
        use() { self.turnDial(i); },
        update() {}, reset() {},
      });
    }

    // ── Seelen (fliegen zum Mast) ──
    this.orbs = [];
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.tex.glow, color: new THREE.Color(0.8, 1.6, 2.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.scale.set(0.9, 0.9, 1); s.visible = false;
      scene.add(s);
      this.orbs.push({ s, t: 0, active: false, from: new THREE.Vector3(), to: new THREE.Vector3() });
    }
    this.mastTop = new THREE.Vector3(MAST.x, MAST.height + 2, MAST.z);

    // ── Lichtsäule für die Übertragung ──
    const beamGeo = new THREE.CylinderGeometry(0.5, 1.1, 140, 16, 1, true);
    beamGeo.translate(0, 70, 0);
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0.6, 1.4, 2.4) }, uTime: { value: 0 }, uAmp: { value: 0 } },
      vertexShader: 'varying float vY; varying vec3 vN; varying vec3 vV; void main(){ vY = position.y; vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
      fragmentShader: 'uniform vec3 uColor; uniform float uTime; uniform float uAmp; varying float vY; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(abs(dot(vN, vV)), 1.4); float a = uAmp * f * (1.0 - smoothstep(10.0, 140.0, vY)) * (0.45 + 0.25*sin(vY*0.35 - uTime*6.0)); gl_FragColor = vec4(uColor * a, a); }',
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    this.beam = new THREE.Mesh(beamGeo, this.beamMat);
    this.beam.position.set(MAST.x, 0, MAST.z);
    this.beam.visible = false;
    this.beam.userData.dynamic = true;
    scene.add(this.beam);

    // ── Spieluhren ──
    this.boxes = MUSIC_BOXES.map(([cx, cy], i) => {
      const grp = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.16, 0.18), M.wood); body.position.y = 0.08; grp.add(body);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.03, 0.19), M.woodDark); lid.position.y = 0.17; grp.add(lid);
      const crank = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.1), M.chrome); crank.position.set(0.15, 0.08, 0.04); grp.add(crank);
      const glowMat = new THREE.SpriteMaterial({ map: M.tex.glow, color: 0xffd28a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.25 });
      const glow = new THREE.Sprite(glowMat); glow.scale.set(0.6, 0.6, 1); glow.position.y = 0.2; grp.add(glow);
      grp.position.set(wx(cx), 0, wx(cy));
      grp.rotation.y = rand(0, 6);
      grp.userData.dynamic = true;
      scene.add(grp);
      const mb = { i, group: grp, glow, lid, crank, done: false };
      this.interactables.push({
        pos: grp.position, radius: 1.3,
        prompt() { return mb.done ? null : `${verb()}, um die Spieluhr aufzuziehen`; },
        use() { self.windBox(mb); },
        update() {}, reset() {},
      });
      return mb;
    });

    buildables.onTurbinePlaced = (id) => this.onTurbine(id, true);
    buildables.onTurbineTaken = (id) => this.onTurbine(id, false);
    this.reset();
  }

  get turbineAtMast() { return this.b.turbine.state === 'placed' && this.b.turbine.placedAt === 'mast'; }

  voice(who, text, opts = {}) {
    const g = this.g;
    g.audio.say(text, { pitch: opts.pitch ?? 0.85, rate: opts.rate ?? 0.95, voice: opts.voice ?? 0, interrupt: true });
    g.hud.subtitle(who, text, Math.max(4500, text.length * 75));
  }

  // ── Tonbänder ───────────────────────────────────────────────
  playTape(tape) {
    const g = this.g;
    tape.played = true;
    tape.led.material.color.setRGB(0.1, 2.5, 0.4);
    g.audio.tapeClick();
    g.audio.radioStatic(tape.pos, 3);
    this.voice('Tonband', TAPE_TEXT[tape.i].replace('{d}', String(this.code[tape.i])), { pitch: 0.75, rate: 0.9 });
    this.heard.add(tape.i);
    this.renderDisplay();
  }

  // ── Funkempfänger ──────────────────────────────────────────
  turnDial(i) {
    const g = this.g, d = this.dials[i];
    d.v = (d.v + 1) % 10;
    d.knob.rotation.y = (d.v / 10) * Math.PI * 2;
    g.audio.radioTune(this.radioPos);
    this.renderDisplay();
    if (this.step === 'radio' || this.step === 'tapes') this.checkCode();
  }

  checkCode() {
    const g = this.g;
    const ok = this.dials.every((d, i) => d.v === this.code[i]);
    if (!ok) return;
    if (!g.map.power || !this.turbineAtMast) {
      g.audio.radioStatic(this.radioPos, 2);
      g.hud.subtitle('Funkempfänger', 'Rauschen … Sender 7 antwortet nicht. Er braucht Strom und eine Turbine.');
      return;
    }
    this.step = 'souls';
    this.souls = 0;
    g.audio.radioStatic(this.radioPos, 1.5);
    this.voice('Funkstimme', 'Frequenz bestätigt. Sender 7 ist bereit. Er braucht Energie. Tötet die Toten an seinem Fuß. Ich sammle ihre Seelen.');
    g.hud.notice('Sammle Seelen am Funkmast', 3500);
  }

  renderDisplay() {
    const c = this.dispCanvas.getContext('2d');
    c.fillStyle = '#0a1208'; c.fillRect(0, 0, 256, 96);
    c.font = 'bold 60px "Courier New", monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.shadowColor = '#5cff8a'; c.shadowBlur = 12; c.fillStyle = '#9cffb8';
    c.fillText(this.dials.map((d) => d.v).join(' '), 128, 52);
    this.dispTex.needsUpdate = true;
  }

  // ── Turbine am Mast ─────────────────────────────────────────
  onTurbine(id, placed) {
    if (id !== 'mast') return;
    const g = this.g;
    if (placed && this.step === 'idle' && g.map.power) this.wake();
    else if (placed && this.step === 'idle') g.hud.subtitle('Sender 7', 'Die Turbine dreht sich … aber ohne Strom aus dem Kraftwerk bleibt der Sender stumm.');
    if (!placed && this.step === 'transmit') this.abort('Die Turbine wurde entfernt!');
  }

  wake() {
    this.step = 'tapes';
    this.g.audio.radioStatic(new THREE.Vector3(MAST.x, 2, MAST.z), 3);
    this.voice('Funkstimme', 'Hier … Sender 7. Ist da jemand? Die Frequenz ist verloren. Sucht die Tonbänder. Drei Stück. Dann geht zum Funkempfänger im Busbahnhof.');
    this.g.hud.notice('Sender 7 ist erwacht', 3000);
  }

  // ── Seelen ──────────────────────────────────────────────────
  onKill(z) {
    if (this.step !== 'souls' || !this.turbineAtMast) return;
    const d = Math.hypot(z.pos.x - MAST.x, z.pos.z - MAST.z);
    if (d > SOUL_RADIUS) return;
    const orb = this.orbs.find((o) => !o.active);
    if (orb) {
      orb.active = true; orb.t = 0;
      orb.from.copy(z.pos).setY(1.2);
      orb.to.copy(this.mastTop);
      orb.s.visible = true;
    }
    this.souls++;
    this.g.audio.soulCollect(z.pos);
    this.g.hud.subtitle(null, `Seelen: ${this.souls} / ${SOULS}`, 2500);
    if (this.souls >= SOULS) this.startTransmit();
  }

  startTransmit() {
    const g = this.g;
    this.step = 'transmit';
    this.tx = TRANSMIT;
    this.away = 0;
    this.beam.visible = true;
    this.voice('Funkstimme', 'Genug! Die Übertragung beginnt. Haltet den Mast eine Minute lang. Lasst ihn nicht allein!');
    g.hud.notice('Verteidige Sender 7: 60 Sekunden', 3500);
    // Zusätzliche Horde
    if (g.roundActive) { g.zombies.toSpawn += 10; g.zombies.remaining += 10; }
  }

  abort(reason) {
    const g = this.g;
    this.step = 'souls';
    this.souls = Math.floor(SOULS * 0.6);
    this.beam.visible = false;
    g.hud.notice(reason, 3000);
    this.voice('Funkstimme', 'Die Übertragung ist abgebrochen! Ich brauche wieder Seelen.');
  }

  finish() {
    const g = this.g, p = g.player;
    this.step = 'done';
    this.beam.visible = false;
    g.map.fogScale = 0.42;
    g.flash = 0.8;
    g.zombieEyes(true); // die Toten gehorchen jetzt einer anderen Stimme
    g.audio.signalFinale();
    this.voice('Funkstimme', 'Ihr habt es geschafft. Das Signal ist draußen. Der Nebel weicht. Und jetzt … hören sie uns.');
    g.hud.notice('DAS SIGNAL IST GESENDET', 5000);
    // Belohnung: alle Perks (auch über dem Limit), Gewitter-Werfer, volle Munition
    for (const id in PERKS) p.perks.add(id);
    p.maxHealth = 250; p.health = 250;
    g.hud.perks(p.perks);
    if (!g.weapons.has('tesla') && !g.weapons.busy) g.weapons.give('tesla');
    g.weapons.refillAll();
    try { localStorage.setItem('nachtfall.ach.signal', '1'); } catch { /* */ }
    setTimeout(() => { if (this.step === 'done') { g.audio.achievement(); g.hud.notice('ERFOLG: Das Signal', 4000); } }, 6000);
    if (g.bus) setTimeout(() => { if (g.bus) g.bus.say('signal', {}, true); }, 12000);
  }

  // ── Spieluhren ──────────────────────────────────────────────
  windBox(mb) {
    const g = this.g;
    mb.done = true;
    mb.glow.material.opacity = 0.9;
    mb.lid.rotation.x = -1.1; mb.lid.position.set(0, 0.25, -0.08);
    g.audio.musicBox(mb.i);
    const n = this.boxes.filter((b) => b.done).length;
    if (n >= this.boxes.length && !this.songPlayed) {
      this.songPlayed = true;
      setTimeout(() => {
        const len = g.audio.secretSong();
        if (len) g.hud.notice('♪  Nebelfahrt  ♪', 4000);
      }, 1800);
    }
  }

  // ── Laufzeit ────────────────────────────────────────────────
  update(dt, time, active) {
    const g = this.g;
    const cam = g.camera.position;
    const near = (p) => Math.hypot(p.x - cam.x, p.z - cam.z) < 50;
    for (const t of this.tapes) {
      t.group.position.copy(t.pos);
      t.group.visible = near(t.pos);
      if (!t.played) t.led.material.color.setRGB(Math.sin(time * 6) > 0 ? 4 : 0.3, 0.15, 0.1);
    }
    for (const b of this.boxes) {
      b.group.visible = near(b.group.position);
      if (!b.done) b.glow.material.opacity = 0.15 + Math.sin(time * 2 + b.i) * 0.1;
    }
    // Seelen fliegen im Bogen zur Mastspitze
    for (const o of this.orbs) {
      if (!o.active) continue;
      o.t += dt / 1.4;
      const k = Math.min(1, o.t);
      o.s.position.lerpVectors(o.from, o.to, k * k);
      o.s.position.y += Math.sin(k * Math.PI) * 6;
      if (Math.random() < 0.5) g.effects.energy(o.s.position, [0.8, 1.6, 2.6], 1, 0.1);
      if (k >= 1) { o.active = false; o.s.visible = false; g.effects.lightning(this.mastTop.clone(), this.mastTop.clone().add(new THREE.Vector3(rand(-2, 2), -4, rand(-2, 2))), [0.6, 1.4, 2.6], 0.15); }
    }
    if (!active) return;
    // Sender wird wach, sobald Strom und Turbine da sind
    if (this.step === 'idle' && g.map.power && this.turbineAtMast) this.wake();
    if (this.step === 'transmit') {
      this.beamMat.uniforms.uTime.value = time;
      this.beamMat.uniforms.uAmp.value = 0.7 + Math.sin(time * 3) * 0.2;
      this.tx -= dt;
      const d = Math.hypot(g.player.pos.x - MAST.x, g.player.pos.z - MAST.z);
      this.away = d > 30 ? this.away + dt : 0;
      if (this.away > 6) { this.abort('Du hast den Mast verlassen!'); return; }
      this.pulseT = (this.pulseT || 0) - dt;
      if (this.pulseT <= 0) {
        this.pulseT = 1.6;
        g.audio.signalPulse(this.mastTop);
        g.player.shake = Math.max(g.player.shake, 0.12);
        const a = rand(0, Math.PI * 2), r = rand(6, 16);
        const hit = new THREE.Vector3(MAST.x + Math.cos(a) * r, 0.1, MAST.z + Math.sin(a) * r);
        g.effects.lightning(this.mastTop.clone(), hit, [0.7, 1.5, 3], 0.25, 0.05);
        for (const z of g.zombies.inRadius(hit, 2.5)) g.zombies.damage(z, 1e9, 'torso', { dir: new THREE.Vector3(0, 1, 0), explosive: true });
      }
      const sec = Math.ceil(this.tx);
      if (sec !== this.lastSec && sec % 10 === 0 && sec > 0) { this.lastSec = sec; g.hud.subtitle('Sender 7', `Übertragung: noch ${sec} Sekunden`, 2500); }
      if (this.tx <= 0) this.finish();
    }
  }

  reset() {
    this.step = 'idle';
    this.code = [randInt(1, 9), randInt(0, 9), randInt(0, 9)];
    this.heard = new Set();
    this.souls = 0;
    this.tx = 0;
    this.songPlayed = false;
    this.lastSec = -1;
    this.beam.visible = false;
    const spots = [...TAPE_SPOTS].sort(() => Math.random() - 0.5).slice(0, 3);
    this.tapes.forEach((t, i) => {
      t.played = false;
      t.pos.set(wx(spots[i][0]), 0, wx(spots[i][1]));
      t.group.position.copy(t.pos);
      t.group.rotation.y = rand(0, 6);
    });
    for (const d of this.dials) { d.v = 0; d.knob.rotation.y = 0; }
    this.renderDisplay();
    for (const b of this.boxes) { b.done = false; b.lid.rotation.x = 0; b.lid.position.set(0, 0.17, 0); }
    for (const o of this.orbs) { o.active = false; o.s.visible = false; }
    if (this.g.audio.song) this.g.audio.stopSong();
  }

  dispose() { if (this.g.audio.song) this.g.audio.stopSong(); }
}
