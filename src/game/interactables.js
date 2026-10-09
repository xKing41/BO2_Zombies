// Alles, womit der Spieler interagieren kann: Türen, Barrikaden, Wall-Buys,
// Perk-Automaten, Stromschalter, Mystery-Kiste und Äther-Schmiede (Pack-a-Punch).
import * as THREE from 'three';
import { CELL, WEAPONS, PERKS, PERK_LIMIT, BOX_COST, BOX_POOL, PAP_COST, GRENADE_COST, POINTS } from '../config.js';
import { WALLDIR } from '../world/map.js';
import { buildGun } from '../weapons/guns.js';
import { mergeByMaterial } from '../world/batch.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as T from '../core/textures.js';
import { rand, smooth, weightedPick, clamp } from '../core/utils.js';

class Interactable {
  constructor(game, pos, radius) { this.g = game; this.pos = pos; this.radius = radius; }
  // Gerätegerechte Hinweise: "Drücke F", "Drücke X", "Tippe auf „Benutzen“"
  get press() { return this.g.input.verb(false); }
  get holdV() { return this.g.input.verb(true); }
  prompt() { return null; }
  use() { }
  update() { }
  reset() { }
}

function frontOf(map, cx, cy, wall, dist) {
  const p = map.center(cx, cy);
  const [dx, dz] = WALLDIR[wall];
  return p.add(new THREE.Vector3(dx, 0, dz).multiplyScalar(dist));
}

// ── Türen ─────────────────────────────────────────────────────
class DoorBuy extends Interactable {
  constructor(game, door) {
    super(game, door.center.clone(), 2.7);
    this.door = door;
  }
  prompt() {
    if (this.door.open) return null;
    return `${this.press}, um die Tür zu öffnen [Kosten: ${this.door.cost}]`;
  }
  use() {
    if (this.door.open) return;
    if (!this.g.spend(this.door.cost)) return;
    this.g.map.openDoor(this.door.id);
    this.g.audio.doorOpen(this.door.center.clone().setY(2));
    this.g.hud.notice(`${this.door.label} geöffnet`);
    for (let i = 0; i < 30; i++) this.g.effects.norm.spawn({ x: this.door.center.x + rand(-2, 2), y: rand(0.2, 3), z: this.door.center.z + rand(-1, 1), vx: rand(-0.5, 0.5), vy: rand(-0.2, 0.3), vz: rand(-0.5, 0.5), life: rand(1.5, 3), size: 0.3, size1: 1.2, alpha: 0.3, r: 0.4, g: 0.37, b: 0.33, drag: 1.5 });
  }
}

// ── Barrikaden ────────────────────────────────────────────────
class Barricade extends Interactable {
  constructor(game, win) {
    super(game, win.repairPoint.clone(), 1.7);
    this.win = win;
    this.hold = true;
    this.t = 0;
  }
  prompt() {
    if (this.win.boards >= 6) return null;
    if (!this.g.map.openZones.has(this.win.zone)) return null;
    return `${this.holdV}, um die Barrikade zu reparieren`;
  }
  reset() { this.t = 0; }
  holdUse(dt) {
    if (this.win.boards >= 6) return;
    this.t -= dt;
    if (this.t <= 0) {
      this.t = this.g.player.perks.has('blitz') ? 0.3 : 0.55;
      if (this.g.map.addBoard(this.win)) {
        this.g.audio.boardPlace(this.win.center.clone().setY(1.6));
        if (this.g.repairPoints < 500) { this.g.addPoints(POINTS.board); this.g.repairPoints += POINTS.board; }
      }
    }
  }
}

// ── Wall-Buys ────────────────────────────────────────────────
class WallBuy extends Interactable {
  constructor(game, def) {
    const map = game.map;
    super(game, map.center(def.cx, def.cy), 1.7);
    this.id = def.weapon;
    const isNade = this.id === 'grenade';
    const cls = isNade ? 'grenade' : WEAPONS[this.id].cls;
    const tex = T.chalkWeapon(cls === 'lmg' || cls === 'sniper' ? 'ar' : cls);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.85), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    plane.position.y = 1.55;
    plane.userData.dynamic = true; // wird nach dem ersten Kauf ausgeblendet
    map.place(plane, def.cx, def.cy, def.wall, 0.0);
    this.def = def; this.plane = plane; this.mount = null;
    this.cost = isNade ? GRENADE_COST : WEAPONS[this.id].cost;
    this.name = isNade ? 'Splittergranaten' : WEAPONS[this.id].name;
    // Kleine Lampe über der Kreidezeichnung
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: game.M.tex.glow, color: 0x60584a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    glow.scale.set(2.2, 1.4, 1);
    const [wdx, wdz] = WALLDIR[def.wall];
    this.out = new THREE.Vector3(-wdx, 0, -wdz);
    glow.position.copy(plane.position);
    glow.position.x -= wdx * 0.05; glow.position.z -= wdz * 0.05;
    game.scene.add(glow);
  }

  // Wie in BO2: Beim ersten Kauf wird aus der Kreidezeichnung die echte Waffe an der Wand
  materialize() {
    if (this.mount || this.id === 'grenade') return;
    const g = this.g, m = (this.mount = new THREE.Group());
    m.position.y = 1.5;
    m.userData.dynamic = true;
    g.map.place(m, this.def.cx, this.def.cy, this.def.wall, 0.0);
    const gun = buildGun(this.id, g.M, false).group;
    gun.rotation.y = Math.PI / 2;
    gun.position.z = 0.1;
    gun.scale.setScalar(1.15);
    gun.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    m.add(gun);
    this.plane.visible = false;
    g.effects.chalk(this.plane.getWorldPosition(new THREE.Vector3()), this.out);
  }

  reset() {
    if (this.mount) { this.mount.removeFromParent(); this.mount = null; }
    this.plane.visible = true;
  }
  prompt() {
    const w = this.g.weapons;
    if (this.id === 'grenade') return w.grenades >= 4 ? null : `${this.press} für ${this.name} [Kosten: ${this.cost}]`;
    const own = w.has(this.id);
    if (own) return `${this.press} für Munition [Kosten: ${own.pap ? 4500 : Math.round(this.cost / 2)}]`;
    return `${this.press} für ${this.name} [Kosten: ${this.cost}]`;
  }
  use() {
    const w = this.g.weapons;
    if (w.busy) return;
    if (this.id === 'grenade') {
      if (w.grenades >= 4 || !this.g.spend(this.cost)) return;
      w.grenades = 4;
      return;
    }
    const own = w.has(this.id);
    if (own) {
      if (own.reserve >= own.stats.reserve) return;
      if (!this.g.spend(own.pap ? 4500 : Math.round(this.cost / 2))) return;
      own.reserve = own.stats.reserve;
      return;
    }
    if (!this.g.spend(this.cost)) return;
    w.give(this.id);
    this.materialize();
  }
}

// ── Perk-Automaten ───────────────────────────────────────────
class PerkMachine extends Interactable {
  constructor(game, id) {
    const s = game.mapDef.perkSpots[id], map = game.map, M = game.M, P = PERKS[id];
    super(game, frontOf(map, s.cx, s.cy, s.wall, -0.2), 1.9);
    this.id = id;
    const col = new THREE.Color(P.color);
    const g = new THREE.Group();
    // Automat im Stil der alten Perk-Automaten: abgerundetes Gehäuse, gewölbte Krone
    // mit leuchtendem Kronkorken-Logo, Namensschild, Glasfront mit Flaschen, Chromleisten
    const paint = new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.5), roughness: 0.32, metalness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.18), roughness: 0.5, metalness: 0.4 });
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
    add(new RoundedBoxGeometry(1.1, 1.9, 0.76, 3, 0.07), paint, 0, 0.95, 0);
    const crown = new THREE.CylinderGeometry(0.55, 0.55, 0.7, 28, 1, false, Math.PI / 2, Math.PI);
    crown.rotateX(Math.PI / 2);
    add(crown, paint, 0, 1.9, -0.02);
    const rim = new THREE.TorusGeometry(0.55, 0.035, 8, 28, Math.PI);
    add(rim, M.chrome, 0, 1.9, 0.34);
    add(new THREE.BoxGeometry(1.18, 0.08, 0.82), M.chrome, 0, 0.04, 0);
    add(new THREE.BoxGeometry(1.14, 0.05, 0.8), M.chrome, 0, 1.9, 0);
    for (const x of [-0.53, 0.53]) add(new THREE.BoxGeometry(0.05, 1.8, 0.05), M.chrome, x, 0.95, 0.37);
    // Logo in der Krone, Namensschild darunter (beide leuchten mit Strom)
    this.logoMat = new THREE.MeshBasicMaterial({ map: T.toTexture(T.perkIconCanvas(id, 256), { repeat: false }), transparent: true, color: new THREE.Color(0.25, 0.25, 0.25) });
    add(new THREE.CircleGeometry(0.34, 32), this.logoMat, 0, 2.08, 0.335);
    add(new THREE.CircleGeometry(0.4, 32), dark, 0, 2.08, 0.332);
    this.signMat = new THREE.MeshBasicMaterial({ map: T.perkSign(P.name, P.color), color: new THREE.Color(0.25, 0.25, 0.25) });
    add(new THREE.PlaneGeometry(1.0, 0.31), this.signMat, 0, 1.66, 0.383);
    // Glasfront mit Flaschen
    this.panelMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, emissive: col, emissiveIntensity: 0.05, roughness: 0.08, metalness: 0.3 });
    add(new THREE.PlaneGeometry(0.74, 0.86), this.panelMat, -0.08, 1.06, 0.383);
    const glass = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.18, roughness: 0.12, metalness: 0.1 });
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      const b = add(new THREE.CylinderGeometry(0.048, 0.048, 0.2, 12), glass, -0.3 + i * 0.22, 0.82 + j * 0.42, 0.31);
      add(new THREE.CylinderGeometry(0.016, 0.042, 0.08, 10), glass, -0.3 + i * 0.22, 0.96 + j * 0.42, 0.31);
      b.userData.bottle = true;
    }
    add(new THREE.BoxGeometry(0.12, 0.22, 0.05), M.chrome, 0.42, 1.12, 0.39);
    add(new THREE.BoxGeometry(0.05, 0.06, 0.06), M.dark, 0.42, 1.16, 0.42);
    add(new THREE.BoxGeometry(0.62, 0.2, 0.1), M.dark, -0.05, 0.36, 0.39);
    add(new THREE.BoxGeometry(0.7, 0.04, 0.14), M.chrome, -0.05, 0.47, 0.4);
    // Statische Teile verschmelzen (wenige Draw-Calls)
    const merged = mergeByMaterial(g);
    g.clear();
    g.add(...merged.children);
    map.place(g, s.cx, s.cy, s.wall, 0.75);
    g.updateMatrixWorld(true);
    map.colliders.push(map.aabb(g, 0.03));
    this.group = g;
    // Farbiges Licht vor dem Automaten
    const lp = frontOf(map, s.cx, s.cy, s.wall, -0.1);
    if (map.lightPool) {
      this.light = map.lightPool.add({ type: 'point', pos: new THREE.Vector3(lp.x, 2.3, lp.z), color: col, intensity: 4, distance: 5, poweredOnly: id !== 'phoenix', flicker: 0.1, offFactor: id === 'phoenix' ? 1 : 0 });
    } else {
      const light = new THREE.PointLight(col, 4, 5, 1.8);
      light.position.set(lp.x, 2.3, lp.z);
      game.scene.add(light);
      this.light = map.addLight(light, { poweredOnly: id !== 'phoenix', flicker: 0.1, tier: 3 });
    }
    this.col = col;
    // Klang: Lautsprecher im Automaten, Zufallstakt für die eigene Melodie
    this.spk = g.position.clone().setY(1.3);
    this.jingleT = rand(15, 45);
    this.hum = null;
  }
  get powered() { return this.g.map.power || this.id === 'phoenix'; }
  prompt() {
    const p = this.g.player, P = PERKS[this.id];
    if (p.perks.has(this.id)) return null;
    if (this.gone) return null;
    if (!this.powered) return 'Kein Strom';
    if (p.perks.size >= PERK_LIMIT) return `Perk-Limit erreicht (${PERK_LIMIT})`;
    return `${this.press} für ${P.name} – ${P.desc} [Kosten: ${P.cost}]`;
  }
  use() {
    const g = this.g, p = g.player, P = PERKS[this.id];
    if (p.perks.has(this.id) || !this.powered || p.perks.size >= PERK_LIMIT || g.weapons.busy) return;
    if (this.id === 'phoenix' && p.selfRevives >= 3) return;
    if (!g.spend(P.cost)) return;
    g.audio.perkJingle(this.id);
    g.weapons.drink(this.col.getHex(), () => {
      p.perks.add(this.id);
      if (this.id === 'titan') { p.maxHealth = 250; p.health = 250; }
      g.hud.perks(p.perks);
      g.hud.notice(P.name);
    });
  }
  // Phönix-Soda: Nach der dritten Selbst-Wiederbelebung verschwindet der Automat
  get gone() { return this.id === 'phoenix' && this.g.player.selfRevives >= 3 && !this.g.player.downed; }
  update(dt, time) {
    const gone = this.gone;
    if (gone === this.group.visible) {
      this.group.visible = !gone;
      if (this.light.pos) this.light.enabled = !gone; else if (this.light.light) this.light.light.visible = !gone;
      if (gone) {
        const c = this.group.position;
        this.g.effects.explosion(c.clone().setY(1.2), 2.2, [0.5, 1.2, 3], true);
        if (this.g.audio.boxWhoosh) this.g.audio.boxWhoosh(c);
        this.g.hud.notice('Phönix-Soda ist weitergezogen', 2600);
      }
    }
    const on = this.powered && !gone;
    const k = on ? 1.6 + Math.sin(time * 3 + this.id.length) * 0.15 : 0.25;
    this.signMat.color.setScalar(k);
    this.logoMat.color.setScalar(on ? k * 1.15 : 0.2);
    this.panelMat.emissiveIntensity = on ? 0.22 : 0.03;
    this.sound(dt, on);
  }
  // Leises Brummen in der Nähe; ab und zu spielt der Automat seine Melodie
  // (nur bis ~12 m, alle 45–120 s, nie während ein anderer Jingle läuft)
  sound(dt, on) {
    const g = this.g, a = g.audio, live = on && g.state === 'playing';
    const d = live ? g.player.pos.distanceTo(this.spk) : Infinity;
    if (d < 7) {
      if (!this.hum || !this.hum.alive) this.hum = a.machineHum(this.spk);
      this.hum.keep();
    } else if (this.hum) { this.hum.stop(); this.hum = null; }
    if (!live || (this.jingleT -= dt) > 0) return;
    this.jingleT = d < 12 && a.perkJingle(this.id, this.spk) ? rand(45, 120) : rand(4, 9);
  }
  reset() {
    this.jingleT = rand(15, 45);
    if (this.hum) { this.hum.stop(); this.hum = null; }
    this.group.visible = true;
    if (this.light.pos) this.light.enabled = true; else if (this.light.light) this.light.light.visible = true;
  }
}

// ── Stromschalter ─────────────────────────────────────────────
class PowerSwitch extends Interactable {
  constructor(game) {
    const s = game.mapDef.powerSwitch, map = game.map, M = game.M;
    super(game, map.center(s.cx, s.cy), 1.8);
    const g = new THREE.Group();
    this.group = g;
    // Auf manchen Karten muss der Schalter erst aus Teilen gebaut werden
    this.needsBuild = !!s.build;
    this.built = !this.needsBuild;
    if (this.needsBuild) { g.userData.dynamic = true; g.visible = false; }
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.25), M.metal); box.position.y = 1.5; box.castShadow = true; g.add(box);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.18), new THREE.MeshBasicMaterial({ map: T.textSign('STROM', '#ffd23a', '#1a1408', 256, 96, 'bold 60px Oswald, Impact, sans-serif') }));
    plate.position.set(0, 1.85, 0.13); g.add(plate);
    this.lever = new THREE.Group(); this.lever.position.set(0, 1.5, 0.15);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.38, 0.05), M.chrome); arm.position.y = 0.17; this.lever.add(arm);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), M.paintRed); knob.position.y = 0.36; this.lever.add(knob);
    this.lever.rotation.x = -0.6;
    this.lever.userData.dynamic = true;
    g.add(this.lever);
    this.lamp = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.1, 0.05) }));
    this.lamp.position.set(0.25, 1.85, 0.13); g.add(this.lamp);
    map.place(g, s.cx, s.cy, s.wall, 0.25);
    this.anim = 0;
  }
  prompt() { return this.g.map.power || !this.built ? null : `${this.press}, um den Strom einzuschalten`; }
  setBuilt() { this.built = true; this.group.visible = true; }
  use() {
    if (this.g.map.power || !this.built) return;
    this.anim = 0.0001;
    this.g.audio.lever();
    setTimeout(() => this.g.powerOn(), 700);
  }
  reset() {
    this.anim = 0; this.lever.rotation.x = -0.6;
    if (this.needsBuild) { this.built = false; this.group.visible = false; }
  }
  update(dt) {
    if (this.anim > 0 && this.anim < 1) {
      this.anim = Math.min(1, this.anim + dt / 0.6);
      this.lever.rotation.x = -0.6 + smooth(this.anim) * 1.9;
    }
    this.lamp.material.color.setRGB(this.g.map.power ? 0.1 : 3, this.g.map.power ? 3 : 0.1, 0.05);
  }
}

// ── Mystery-Kiste ────────────────────────────────────────────
class MysteryBox extends Interactable {
  // opts.temp: Zusatzkiste, die nur während eines Ausverkaufs an ihrem Platz steht
  constructor(game, opts = {}) {
    super(game, new THREE.Vector3(), 2.0);
    const M = game.M;
    this.temp = !!opts.temp;
    this.spots = game.mapDef.boxSpots;
    this.spot = opts.spot ?? (game.mapDef.boxStart || 0);
    this.uses = 0;
    this.totalUses = 0;
    this.moves = 0;
    this.state = 'idle';
    this.t = 0;
    this.models = {};

    // Paletten an allen möglichen Plätzen (baut nur die Hauptkiste)
    if (!this.temp) for (const s of this.spots) {
      const pal = new THREE.Group();
      for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.04, 0.18), M.woodDark); b.position.set(0, 0.12, -0.33 + i * 0.22); b.receiveShadow = true; pal.add(b); }
      for (const x of [-0.85, 0, 0.85]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.9), M.wood); b.position.set(x, 0.05, 0); pal.add(b); }
      game.map.place(pal, s.cx, s.cy, s.wall, 0.95);
      pal.updateMatrixWorld(true);
      game.map.colliders.push(game.map.aabb(pal, 0.02));
    }

    // Kiste
    const g = (this.group = new THREE.Group());
    const body = new THREE.Group(); g.add(body);
    const add = (geo, mat, x, y, z, p = body) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; p.add(m); return m; };
    add(new THREE.BoxGeometry(1.75, 0.62, 0.78), M.wood, 0, 0.45, 0);
    for (const x of [-0.86, 0.86]) for (const z of [-0.38, 0.38]) add(new THREE.BoxGeometry(0.06, 0.64, 0.06), M.metal, x, 0.45, z);
    add(new THREE.BoxGeometry(1.8, 0.06, 0.82), M.metal, 0, 0.16, 0);
    const qm = new THREE.MeshBasicMaterial({ map: M.tex.boxSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(1.6, 1.6, 1.6) });
    for (const s of [1, -1]) { const q = add(new THREE.PlaneGeometry(1.5, 0.6), qm, 0, 0.47, s * 0.395); if (s < 0) q.rotation.y = Math.PI; }
    this.lid = new THREE.Group(); this.lid.position.set(0, 0.76, -0.39); body.add(this.lid);
    add(new THREE.BoxGeometry(1.75, 0.1, 0.78), M.wood, 0, 0.05, 0.39, this.lid);
    add(new THREE.BoxGeometry(1.8, 0.04, 0.82), M.metal, 0, 0.1, 0.39, this.lid);
    this.inner = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.68), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 1.4, 2.4), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.inner.rotation.x = -Math.PI / 2; this.inner.position.y = 0.74; body.add(this.inner);
    // Starre Teile zu wenigen Meshes verschmelzen (Deckel und Innenleuchten bleiben beweglich)
    body.remove(this.lid, this.inner);
    const solidBody = mergeByMaterial(body);
    body.clear();
    body.add(...solidBody.children, this.lid, this.inner);
    g.userData.dynamic = true;
    game.scene.add(g);

    // Lichtsäule (sichtbar über die Mauern hinweg)
    const beamGeo = new THREE.CylinderGeometry(0.35, 0.6, 70, 16, 1, true);
    beamGeo.translate(0, 35 + 4.4, 0); // beginnt über dem Dach
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0.35, 0.75, 1.6) }, uTime: { value: 0 } },
      vertexShader: 'varying float vY; varying vec3 vN; varying vec3 vV; void main(){ vY = position.y; vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
      fragmentShader: 'uniform vec3 uColor; uniform float uTime; varying float vY; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(abs(dot(vN, vV)), 1.5); float a = f * (1.0 - smoothstep(0.0, 70.0, vY)) * (0.35 + 0.1*sin(vY*0.6 - uTime*3.0)); gl_FragColor = vec4(uColor * a, a); }',
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.beam = new THREE.Mesh(beamGeo, this.beamMat);
    this.beam.userData.dynamic = true;
    game.scene.add(this.beam);
    if (game.map.lightPool) {
      // Quelle im Licht-Pool; .position/.intensity wie bei einem echten Licht
      this.light = game.map.lightPool.add({ type: 'point', pos: new THREE.Vector3(), color: 0x66ccff, intensity: 0, distance: 6, offFactor: 1, dynamic: true });
      this.light.position = this.light.pos;
    } else if (this.temp) {
      // Ohne Licht-Pool kein weiteres Szenenlicht (jedes kostet in allen Shadern)
      this.light = { intensity: 0, position: new THREE.Vector3() };
    } else {
      this.light = new THREE.PointLight(0x66ccff, 0, 6, 1.6);
      this.light.userData.tier = 2;
      game.scene.add(this.light);
    }

    // Teddy
    this.teddy = this.buildTeddy(M);
    this.teddy.visible = false;
    this.teddy.userData.dynamic = true;
    game.scene.add(this.teddy);

    this.display = new THREE.Group();
    this.display.userData.dynamic = true;
    game.scene.add(this.display);
    this.moveTo(this.spot);
    if (this.temp) this.hide();
  }

  reset() {
    this.state = 'idle'; this.t = 0;
    this.uses = 0; this.totalUses = 0; this.moves = 0;
    this.vanish = false;
    this.teddy.visible = false;
    this.showWeapon(null);
    this.group.rotation.set(0, 0, 0);
    this.inner.material.opacity = 0;
    this.onFireSale(false);
    this.vanish = false;
    this.moveTo(this.temp ? this.spot : this.g.mapDef.boxStart || 0);
    if (this.temp) this.hide();
  }

  hide() {
    this.state = 'hidden'; this.t = 0;
    this.group.visible = false; this.beam.visible = false;
    this.light.intensity = 0;
    this.teddy.visible = false;
    this.showWeapon(null);
  }

  buildTeddy(M) {
    const g = new THREE.Group();
    const fur = new THREE.MeshStandardMaterial({ color: 0x6b4426, roughness: 1 });
    const s = (r, x, y, z, sx = 1, sy = 1, sz = 1) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), fur); m.position.set(x, y, z); m.scale.set(sx, sy, sz); g.add(m); return m; };
    s(0.16, 0, 0, 0, 1, 1.15, 0.9); s(0.12, 0, 0.25, 0);
    s(0.045, -0.09, 0.35, 0); s(0.045, 0.09, 0.35, 0);
    s(0.05, -0.16, 0.05, 0.05, 1, 1.6, 1); s(0.05, 0.16, 0.05, 0.05, 1, 1.6, 1);
    s(0.06, -0.08, -0.17, 0.06); s(0.06, 0.08, -0.17, 0.06);
    const eyeM = new THREE.MeshBasicMaterial({ color: 0x050505 });
    for (const x of [-0.04, 0.04]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 4), eyeM); e.position.set(x, 0.28, 0.11); g.add(e); }
    return g;
  }

  moveTo(i) {
    this.spot = i;
    const s = this.spots[i], map = this.g.map;
    map.place(this.group, s.cx, s.cy, s.wall, 0.95);
    this.group.position.y = 0.1;
    this.group.visible = true;
    this.pos.copy(this.group.position).setY(0);
    const fwd = new THREE.Vector3(Math.sin(this.group.rotation.y), 0, Math.cos(this.group.rotation.y));
    this.fwd = fwd;
    this.pos.addScaledVector(fwd, 0.8);
    this.beam.position.copy(this.group.position).setY(0);
    this.beam.visible = true;
    this.light.position.copy(this.group.position).setY(1.4);
    this.lid.rotation.x = 0;
  }

  getModel(id) {
    if (!this.models[id]) {
      const info = buildGun(id, this.g.M, false);
      info.group.scale.setScalar(1.1);
      this.models[id] = info.group;
    }
    return this.models[id];
  }

  showWeapon(id) {
    this.display.clear();
    if (!id) return;
    const m = this.getModel(id);
    this.display.add(m);
  }

  get cost() { return this.g.powerups && this.g.powerups.fireSale ? 10 : BOX_COST; }

  // Ausverkauf: Kiste kostet 10 Punkte und zieht nicht um; an allen anderen
  // Plätzen tauchen Zusatzkisten auf, die danach wieder verschwinden
  onFireSale(on) {
    this.beamMat.uniforms.uColor.value.setRGB(on ? 1.6 : 0.35, on ? 0.9 : 0.75, on ? 0.3 : 1.6);
    if (!this.temp) return;
    if (!on) { if (this.state !== 'hidden') this.vanish = true; return; }
    this.vanish = false;
    const main = this.g.interact && this.g.interact.box;
    if (this.state !== 'hidden' || !main || main.spot === this.spot || !main.group.visible) return;
    this.state = 'idle'; this.t = 0; this.uses = 0;
    this.group.rotation.set(0, 0, 0);
    this.moveTo(this.spot);
    this.poof();
  }

  poof() {
    const c = this.group.position;
    this.g.effects.explosion(c.clone().setY(0.6), 2, [3, 1.6, 0.4]);
    if (this.g.audio.boxWhoosh) this.g.audio.boxWhoosh(c);
  }

  // Teddy-Regel wie bei Treyarch: an einem Standort frühestens ab der 4. Benutzung
  // (15 %), beim allerersten Standort spätestens bei der 8.; danach 30 % ab 8, 50 % ab 13
  rollTeddy() {
    if (this.temp || (this.g.powerups && this.g.powerups.fireSale)) return false;
    const n = this.uses, r = Math.random();
    if (this.moves === 0 && n >= 8) return true;
    if (n >= 4 && n < 8) return r < 0.15;
    if (this.moves > 0 && n >= 8 && n < 13) return r < 0.3;
    if (this.moves > 0 && n >= 13) return r < 0.5;
    return false;
  }

  prompt() {
    if (this.state === 'idle') return `${this.press} für eine Zufallswaffe [Kosten: ${this.cost}]`;
    if (this.state === 'offer') return `${this.press} für ${WEAPONS[this.result].name}`;
    return null;
  }

  use() {
    const g = this.g;
    if (this.state === 'idle') {
      const price = this.cost;
      if (!g.spend(price)) return;
      this.paid = price;
      this.state = 'spin'; this.t = 0; this.uses++; this.totalUses++;
      g.audio.boxJingle();
      const owned = g.weapons.slots.filter(Boolean).map((s) => s.id);
      const pool = Object.entries(BOX_POOL).filter(([k]) => !owned.includes(k));
      this.result = weightedPick(pool);
      this.isTeddy = this.rollTeddy();
      this.cycleT = 0;
    } else if (this.state === 'offer') {
      if (g.weapons.busy) return;
      g.weapons.give(this.result);
      this.close();
    }
  }

  close() {
    this.state = 'closing'; this.t = 0;
    this.showWeapon(null);
  }

  update(dt, time) {
    const g = this.g;
    if (this.state === 'hidden') return;
    this.t += dt;
    this.beamMat.uniforms.uTime.value = time;
    const base = this.group.position.clone();
    const ry = this.group.rotation.y;
    this.display.position.copy(base).setY(0.9);
    this.display.rotation.set(0, ry + Math.PI / 2, 0);

    switch (this.state) {
      case 'idle':
        if (this.vanish) { this.vanish = false; this.poof(); this.hide(); break; }
        this.lid.rotation.x = 0;
        this.inner.material.opacity = 0;
        this.light.intensity = 0.6 + Math.sin(time * 2) * 0.2;
        break;
      case 'spin': {
        this.lid.rotation.x = -smooth(Math.min(1, this.t / 0.4)) * 1.6;
        this.inner.material.opacity = Math.min(1, this.t * 2);
        this.light.intensity = 6;
        const k = this.t / 4.3;
        this.display.position.y = 0.9 + smooth(Math.min(1, k)) * 0.55;
        this.cycleT -= dt;
        if (this.cycleT <= 0) {
          this.cycleT = 0.07 + k * k * 0.3;
          const ids = Object.keys(BOX_POOL);
          this.showWeapon(ids[Math.floor(Math.random() * ids.length)]);
        }
        if (this.t >= 4.3) {
          if (this.isTeddy) {
            this.state = 'teddy'; this.t = 0;
            this.showWeapon(null);
            this.teddy.visible = true;
            g.audio.teddyLaugh();
          } else {
            this.state = 'offer'; this.t = 0;
            this.showWeapon(this.result);
          }
        }
        break;
      }
      case 'offer': {
        this.display.position.y = 1.45 - (this.t / 12) * 0.5;
        this.display.rotation.y += Math.sin(time * 2) * 0.05;
        if (this.t > 12) this.close();
        break;
      }
      case 'teddy': {
        this.teddy.position.copy(base).setY(1.5);
        this.teddy.rotation.y = ry;
        if (this.t > 2.2) {
          this.teddy.visible = false;
          this.state = 'leaving'; this.t = 0;
          g.addPoints(this.paid || BOX_COST, true);
          g.hud.notice('Die Kiste zieht weiter …');
        }
        break;
      }
      case 'leaving': {
        const k = Math.min(1, this.t / 3);
        this.group.position.y = 0.1 + smooth(k) * 6;
        this.group.rotation.y += dt * (2 + k * 12);
        this.light.intensity = 8 * (1 - k);
        this.beam.visible = false;
        if (k >= 1) {
          this.group.visible = false;
          this.state = 'moving'; this.t = 0;
        }
        break;
      }
      case 'moving':
        if (this.t > 2.5) {
          // freier Platz (dort steht gerade keine Ausverkaufs-Kiste)
          const extra = g.interact.extraBoxes || [];
          let free = this.spots.map((_, i) => i).filter((i) => i !== this.spot && !(extra[i] && extra[i].state !== 'hidden'));
          if (!free.length) free = this.spots.map((_, i) => i).filter((i) => i !== this.spot);
          const n = free.length ? free[Math.floor(Math.random() * free.length)] : this.spot;
          if (extra[n] && extra[n].state !== 'hidden') extra[n].hide();
          this.moveTo(n);
          this.uses = 0;
          this.moves++;
          this.state = 'idle';
          g.effects.explosion(this.group.position.clone().setY(0.6), 2, [0.4, 1.4, 3]);
        }
        break;
      case 'closing':
        this.lid.rotation.x = -1.6 * (1 - smooth(Math.min(1, this.t / 0.5)));
        this.inner.material.opacity = Math.max(0, 1 - this.t * 2);
        if (this.t > 0.5) this.state = 'idle';
        break;
    }
  }
}

// ── Äther-Schmiede (Pack-a-Punch) ────────────────────────────
class PackAPunch extends Interactable {
  constructor(game) {
    const map = game.map, M = game.M;
    const spot = game.mapDef.papSpot;
    const c = map.center(spot.cx, spot.cy);
    super(game, c.clone(), 2.3);
    const g = (this.group = new THREE.Group());
    this.needsBuild = !!spot.build;
    this.built = !this.needsBuild;
    const add = (geo, mat, x, y, z, p = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; p.add(m); return m; };
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1820, roughness: 0.4, metalness: 0.85 });
    add(new THREE.BoxGeometry(1.5, 1.2, 1.1), dark, 0, 0.75, 0);
    add(new THREE.BoxGeometry(1.7, 0.15, 1.25), M.metal, 0, 0.08, 0);
    add(new THREE.BoxGeometry(1.0, 0.8, 0.8), dark, 0, 1.75, 0);
    for (const x of [-0.68, 0.68]) for (const z of [-0.48, 0.48]) add(new THREE.CylinderGeometry(0.05, 0.06, 2.1, 8), M.chrome, x, 1.1, z);
    this.coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.8, 0.2, 2.5) });
    add(new THREE.CylinderGeometry(0.18, 0.18, 1.08, 16), this.coreMat, 0, 0.8, 0).rotation.z = Math.PI / 2;
    this.gears = [];
    for (const s of [-1, 1]) {
      const gear = add(new THREE.TorusGeometry(0.32, 0.06, 6, 18), M.chrome, s * 0.78, 0.85, 0);
      gear.rotation.y = Math.PI / 2;
      gear.userData.dynamic = true;
      this.gears.push(gear);
    }
    const trim = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.35, 2.2) });
    this.trimMat = trim;
    for (const y of [0.32, 1.32]) add(new THREE.BoxGeometry(1.52, 0.035, 1.12), trim, 0, y, 0);
    for (const s of [1, -1]) {
      add(new THREE.BoxGeometry(0.9, 0.22, 0.02), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.02, 0.08) }), 0, 0.85, s * 0.56);
      for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(0.12, 0.03, 0.02), trim, -0.3 + i * 0.15, 0.55, s * 0.56);
    }
    add(new THREE.CylinderGeometry(0.42, 0.5, 0.12, 20), M.metal, 0, 2.2, 0);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const rod = add(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 6), M.chrome, Math.cos(a) * 0.32, 2.45, Math.sin(a) * 0.32);
      rod.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4);
    }
    this.emitter = add(new THREE.SphereGeometry(0.16, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 0.6, 3) }), 0, 2.3, 0);
    for (const s of [1, -1]) { const p = add(new THREE.PlaneGeometry(0.9, 0.3), new THREE.MeshBasicMaterial({ map: T.textSign('ÄTHER-SCHMIEDE', '#b06bff', '#0a0612', 512, 128, 'bold 54px Oswald, Impact, sans-serif') }), 0, 1.9, s * 0.405); if (s < 0) p.rotation.y = Math.PI; }
    // Starre Teile verschmelzen; Zahnräder drehen sich und bleiben einzeln
    const gears = this.gears;
    for (const gr of gears) g.remove(gr);
    const solid = mergeByMaterial(g);
    g.clear();
    g.add(...solid.children, ...gears);
    g.position.set(c.x, 0, c.z);
    if (spot.yaw) g.rotation.y = spot.yaw;
    game.scene.add(g);
    g.updateMatrixWorld(true);
    map.blockCell(spot.cx, spot.cy, map.aabb(g, 0.05));
    if (this.needsBuild) { g.userData.dynamic = true; g.visible = false; }
    if (map.lightPool) {
      this.light = map.lightPool.add({ type: 'point', pos: new THREE.Vector3(c.x, 2.6, c.z), color: 0xa040ff, intensity: 9, distance: 9, poweredOnly: true, flicker: 0.3, enabled: this.built });
    } else {
      const light = new THREE.PointLight(0xa040ff, 9, 9, 1.7);
      light.position.set(c.x, 2.6, c.z);
      game.scene.add(light);
      this.light = map.addLight(light, { poweredOnly: true, flicker: 0.3, tier: 2 });
    }
    this.state = 'idle'; this.t = 0;
    this.display = new THREE.Group();
    this.display.userData.dynamic = true;
    game.scene.add(this.display);
    this.slot = null;
  }
  reset() {
    this.state = 'idle'; this.t = 0; this.slot = null; this.display.clear(); this.display.visible = true;
    if (this.needsBuild) { this.built = false; this.group.visible = false; if (this.light.pos) this.light.enabled = false; }
  }
  setBuilt() { this.built = true; this.group.visible = true; if (this.light.pos) this.light.enabled = true; }
  prompt() {
    const g = this.g, w = g.weapons.weapon;
    if (!this.built) return null;
    if (!g.map.power) return 'Kein Strom';
    if (this.state === 'ready') return `${this.press} für ${this.slot.stats.name}`;
    if (this.state !== 'idle') return null;
    if (!w) return null;
    if (w.pap) return 'Diese Waffe ist bereits verbessert';
    return `${this.press}, um deine Waffe zu verbessern [Kosten: ${PAP_COST}]`;
  }
  use() {
    const g = this.g;
    if (!g.map.power || g.weapons.busy) return;
    if (this.state === 'ready') {
      g.weapons.giveSlot(this.slot);
      this.slot = null; this.state = 'idle'; this.display.clear();
      return;
    }
    const w = g.weapons.weapon;
    if (this.state !== 'idle' || !w || w.pap) return;
    if (!g.spend(PAP_COST)) return;
    const taken = g.weapons.takeCurrent();
    this.slot = g.weapons.makeSlot(taken.id, true);
    this.state = 'work'; this.t = 0;
    g.audio.papMachine();
    const info = buildGun(taken.id, g.M, true);
    info.group.scale.setScalar(1.5);
    this.display.clear(); this.display.add(info.group);
  }
  update(dt, time) {
    const g = this.g, on = g.map.power && this.built;
    this.t += dt;
    const spin = this.state === 'work' ? 8 : on ? 0.6 : 0;
    this.gears.forEach((gr, i) => (gr.rotation.x += dt * spin * (i ? 1 : -1)));
    const pulse = on ? 1 + Math.sin(time * (this.state === 'work' ? 20 : 3)) * 0.3 : 0.1;
    this.coreMat.color.setRGB(0.8 * pulse, 0.2 * pulse, 2.5 * pulse);
    this.emitter.material.color.setRGB(1.5 * pulse, 0.6 * pulse, 3 * pulse);
    this.trimMat.color.setRGB(0.9 * pulse * 0.8, 0.35 * pulse * 0.8, 2.2 * pulse * 0.8);
    const c = this.group.position;
    this.display.position.set(c.x, 0.85, c.z);
    if (this.state === 'work') {
      const k = Math.min(1, this.t / 3.6);
      this.display.position.z = c.z + 0.6 - k * 0.6 + (k > 0.5 ? (k - 0.5) * 2.4 : 0);
      this.display.visible = k < 0.25 || k > 0.75;
      if (Math.random() < 0.4) g.effects.energy(new THREE.Vector3(c.x, 2.3, c.z), [2, 0.8, 4], 2, 0.2);
      if (k >= 1) { this.state = 'ready'; this.t = 0; this.display.visible = true; }
    } else if (this.state === 'ready') {
      this.display.position.z = c.z + 1.2 - Math.min(1, this.t / 15) * 0.6;
      this.display.rotation.y = Math.sin(time * 1.5) * 0.2;
      if (this.t > 15) { this.state = 'idle'; this.display.clear(); this.slot = null; g.hud.notice('Waffe verloren – zu lange gewartet!'); }
    }
    if (on && Math.random() < 0.15) g.effects.energy(new THREE.Vector3(c.x, 2.3, c.z), [1.5, 0.6, 3], 1, 0.12);
  }
}

// ── Sammlung ──────────────────────────────────────────────────
export class Interactables {
  constructor(game) {
    this.g = game;
    this.list = [];
    const map = game.map;
    const def = game.mapDef;
    for (const id in map.doors) if (map.doors[id].kind === 'buy') this.list.push(new DoorBuy(game, map.doors[id]));
    for (const w of map.windows) this.list.push(new Barricade(game, w));
    for (const wb of def.wallbuys || []) this.list.push(new WallBuy(game, wb));
    this.perks = {};
    for (const id in PERKS) if (def.perkSpots && def.perkSpots[id]) this.list.push((this.perks[id] = new PerkMachine(game, id)));
    if (def.powerSwitch) { this.power = new PowerSwitch(game); this.list.push(this.power); }
    if (def.boxSpots && def.boxSpots.length) {
      this.box = new MysteryBox(game); this.list.push(this.box);
      // Ausverkaufs-Kisten (eine je Platz, versteckt bis zum Ausverkauf)
      this.extraBoxes = def.boxSpots.map((_, i) => new MysteryBox(game, { temp: true, spot: i }));
      this.list.push(...this.extraBoxes);
    }
    if (def.papSpot) { this.pap = new PackAPunch(game); this.list.push(this.pap); }
    this.current = null;
  }

  update(dt, time, input) {
    const g = this.g, p = g.player;
    for (const it of this.list) it.update(dt, time);
    let best = null, bd = Infinity;
    if (g.state === 'playing' && !p.downed) {
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
      for (const it of this.list) {
        const dx = it.pos.x - p.pos.x, dz = it.pos.z - p.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > it.radius) continue;
        const facing = d < 0.6 ? 1 : (dx * fx + dz * fz) / d;
        if (facing < -0.2) continue;
        const score = d - facing * 0.8;
        if (!it.prompt()) continue;
        if (score < bd) { bd = score; best = it; }
      }
    }
    this.current = best;
    const text = best ? best.prompt() : null;
    g.hud.prompt(text);
    // Nur echte Aktionen (nicht "Kein Strom" o. Ä.) zeigen den Benutzen-Knopf
    const actionable = !!text && (text.startsWith(input.verb(false)) || text.startsWith(input.verb(true)));
    input.useAvailable = actionable;
    if (g.touch) g.touch.setUse(actionable ? 'Benutzen' : null);
    if (best && actionable) {
      if (best.hold) { if (input.held('use')) best.holdUse(dt); }
      else if (input.hit('use')) best.use();
    }
  }

  reset() { for (const it of this.list) it.reset(); }

  fireSale(on) {
    if (this.box) this.box.onFireSale(on);
    for (const b of this.extraBoxes || []) b.onFireSale(on);
  }
}
