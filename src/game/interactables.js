// Alles, womit der Spieler interagieren kann: Türen, Barrikaden, Wall-Buys,
// Perk-Automaten, Stromschalter, Mystery-Kiste und Äther-Schmiede (Pack-a-Punch).
import * as THREE from 'three';
import { CELL, WEAPONS, PERKS, PERK_LIMIT, PERK_SPOTS, WALLBUYS, BOX_SPOTS, BOX_START, BOX_COST, BOX_POOL, PAP_COST, PAP_SPOT, POWER_SWITCH, GRENADE_COST, POINTS } from '../config.js';
import { WALLDIR } from '../world/map.js';
import { buildGun } from '../weapons/guns.js';
import * as T from '../core/textures.js';
import { rand, smooth, weightedPick, clamp } from '../core/utils.js';

const F = 'F';

class Interactable {
  constructor(game, pos, radius) { this.g = game; this.pos = pos; this.radius = radius; }
  prompt() { return null; }
  use() { }
  update() { }
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
    return `Drücke ${F}, um die Tür zu öffnen [Kosten: ${this.door.cost}]`;
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
    return `Halte ${F}, um die Barrikade zu reparieren`;
  }
  holdUse(dt) {
    if (this.win.boards >= 6) return;
    this.t -= dt;
    if (this.t <= 0) {
      this.t = 0.55;
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
    map.place(plane, def.cx, def.cy, def.wall, 0.0);
    this.cost = isNade ? GRENADE_COST : WEAPONS[this.id].cost;
    this.name = isNade ? 'Splittergranaten' : WEAPONS[this.id].name;
    // Kleine Lampe über der Kreidezeichnung
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: game.M.tex.glow, color: 0x60584a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    glow.scale.set(2.2, 1.4, 1);
    const [wdx, wdz] = WALLDIR[def.wall];
    glow.position.copy(plane.position);
    glow.position.x -= wdx * 0.05; glow.position.z -= wdz * 0.05;
    game.scene.add(glow);
  }
  prompt() {
    const w = this.g.weapons;
    if (this.id === 'grenade') return w.grenades >= 4 ? null : `Drücke ${F} für ${this.name} [Kosten: ${this.cost}]`;
    const own = w.has(this.id);
    if (own) return `Drücke ${F} für Munition [Kosten: ${own.pap ? 4500 : Math.round(this.cost / 2)}]`;
    return `Drücke ${F} für ${this.name} [Kosten: ${this.cost}]`;
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
  }
}

// ── Perk-Automaten ───────────────────────────────────────────
class PerkMachine extends Interactable {
  constructor(game, id) {
    const s = PERK_SPOTS[id], map = game.map, M = game.M, P = PERKS[id];
    super(game, frontOf(map, s.cx, s.cy, s.wall, -0.2), 1.9);
    this.id = id;
    const col = new THREE.Color(P.color);
    const g = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.55), roughness: 0.45, metalness: 0.4 });
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
    add(new THREE.BoxGeometry(1.1, 2.1, 0.75), paint, 0, 1.05, 0);
    add(new THREE.BoxGeometry(1.16, 0.12, 0.8), M.chrome, 0, 2.12, 0);
    add(new THREE.BoxGeometry(1.16, 0.1, 0.8), M.chrome, 0, 0.05, 0);
    this.signMat = new THREE.MeshBasicMaterial({ map: T.perkSign(P.name, P.color), color: new THREE.Color(0.25, 0.25, 0.25) });
    add(new THREE.PlaneGeometry(1.02, 0.32), this.signMat, 0, 1.85, 0.376);
    this.panelMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: col, emissiveIntensity: 0.05, roughness: 0.1, metalness: 0.2 });
    add(new THREE.PlaneGeometry(0.75, 0.95), this.panelMat, -0.08, 1.15, 0.376);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      const b = add(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 10), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.15, roughness: 0.2 }), -0.3 + i * 0.22, 0.85 + j * 0.45, 0.3);
      b.userData.bottle = true;
    }
    add(new THREE.BoxGeometry(0.12, 0.2, 0.05), M.chrome, 0.42, 1.2, 0.38);
    add(new THREE.BoxGeometry(0.6, 0.18, 0.08), M.dark, -0.05, 0.4, 0.38);
    map.place(g, s.cx, s.cy, s.wall, 0.75);
    g.updateMatrixWorld(true);
    map.colliders.push(map.aabb(g, 0.03));
    this.group = g;
    // Farbiges Licht vor dem Automaten
    const lp = frontOf(map, s.cx, s.cy, s.wall, -0.1);
    const light = new THREE.PointLight(col, 4, 5, 1.8);
    light.position.set(lp.x, 2.3, lp.z);
    game.scene.add(light);
    this.light = map.addLight(light, { poweredOnly: id !== 'phoenix', flicker: 0.1 });
    this.col = col;
  }
  get powered() { return this.g.map.power || this.id === 'phoenix'; }
  prompt() {
    const p = this.g.player, P = PERKS[this.id];
    if (p.perks.has(this.id)) return null;
    if (this.id === 'phoenix' && p.selfRevives >= 3) return 'Phönix-Soda ist ausverkauft';
    if (!this.powered) return 'Kein Strom';
    if (p.perks.size >= PERK_LIMIT) return `Perk-Limit erreicht (${PERK_LIMIT})`;
    return `Drücke ${F} für ${P.name} – ${P.desc} [Kosten: ${P.cost}]`;
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
  update(dt, time) {
    const on = this.powered;
    this.signMat.color.setScalar(on ? 1.6 + Math.sin(time * 3 + this.id.length) * 0.15 : 0.25);
    this.panelMat.emissiveIntensity = on ? 0.22 : 0.03;
  }
}

// ── Stromschalter ─────────────────────────────────────────────
class PowerSwitch extends Interactable {
  constructor(game) {
    const s = POWER_SWITCH, map = game.map, M = game.M;
    super(game, map.center(s.cx, s.cy), 1.8);
    const g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.25), M.metal); box.position.y = 1.5; box.castShadow = true; g.add(box);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.18), new THREE.MeshBasicMaterial({ map: T.textSign('STROM', '#ffd23a', '#1a1408', 256, 96, 'bold 60px Oswald, Impact, sans-serif') }));
    plate.position.set(0, 1.85, 0.13); g.add(plate);
    this.lever = new THREE.Group(); this.lever.position.set(0, 1.5, 0.15);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.38, 0.05), M.chrome); arm.position.y = 0.17; this.lever.add(arm);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), M.paintRed); knob.position.y = 0.36; this.lever.add(knob);
    this.lever.rotation.x = -0.6;
    g.add(this.lever);
    this.lamp = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.1, 0.05) }));
    this.lamp.position.set(0.25, 1.85, 0.13); g.add(this.lamp);
    map.place(g, s.cx, s.cy, s.wall, 0.25);
    this.anim = 0;
  }
  prompt() { return this.g.map.power ? null : `Drücke ${F}, um den Strom einzuschalten`; }
  use() {
    if (this.g.map.power) return;
    this.anim = 0.0001;
    this.g.audio.lever();
    setTimeout(() => this.g.powerOn(), 700);
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
  constructor(game) {
    super(game, new THREE.Vector3(), 2.0);
    const M = game.M;
    this.spot = BOX_START;
    this.uses = 0;
    this.totalUses = 0;
    this.state = 'idle';
    this.t = 0;
    this.models = {};

    // Paletten an allen möglichen Plätzen
    for (const s of BOX_SPOTS) {
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
    game.scene.add(this.beam);
    this.light = new THREE.PointLight(0x66ccff, 0, 6, 1.6);
    game.scene.add(this.light);

    // Teddy
    this.teddy = this.buildTeddy(M);
    this.teddy.visible = false;
    game.scene.add(this.teddy);

    this.display = new THREE.Group();
    game.scene.add(this.display);
    this.moveTo(this.spot);
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
    const s = BOX_SPOTS[i], map = this.g.map;
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

  prompt() {
    if (this.state === 'idle') return `Drücke ${F} für eine Zufallswaffe [Kosten: ${BOX_COST}]`;
    if (this.state === 'offer') return `Drücke ${F} für ${WEAPONS[this.result].name}`;
    return null;
  }

  use() {
    const g = this.g;
    if (this.state === 'idle') {
      if (!g.spend(BOX_COST)) return;
      this.state = 'spin'; this.t = 0; this.uses++; this.totalUses++;
      g.audio.boxJingle();
      const owned = g.weapons.slots.filter(Boolean).map((s) => s.id);
      const pool = Object.entries(BOX_POOL).filter(([k]) => !owned.includes(k));
      this.result = weightedPick(pool);
      this.isTeddy = this.totalUses > 1 && this.uses >= 3 && Math.random() < 0.3;
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
    this.t += dt;
    this.beamMat.uniforms.uTime.value = time;
    const base = this.group.position.clone();
    const ry = this.group.rotation.y;
    this.display.position.copy(base).setY(0.9);
    this.display.rotation.set(0, ry + Math.PI / 2, 0);

    switch (this.state) {
      case 'idle':
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
          g.addPoints(BOX_COST);
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
          let n;
          do { n = Math.floor(Math.random() * BOX_SPOTS.length); } while (n === this.spot);
          this.moveTo(n);
          this.uses = 0;
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
    const c = map.center(PAP_SPOT.cx, PAP_SPOT.cy);
    super(game, c.clone(), 2.3);
    const g = (this.group = new THREE.Group());
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
    g.position.set(c.x, 0, c.z);
    game.scene.add(g);
    g.updateMatrixWorld(true);
    map.blockCell(PAP_SPOT.cx, PAP_SPOT.cy, map.aabb(g, 0.05));
    const light = new THREE.PointLight(0xa040ff, 9, 9, 1.7);
    light.position.set(c.x, 2.6, c.z);
    game.scene.add(light);
    this.light = map.addLight(light, { poweredOnly: true, flicker: 0.3 });
    this.state = 'idle'; this.t = 0;
    this.display = new THREE.Group(); game.scene.add(this.display);
    this.slot = null;
  }
  prompt() {
    const g = this.g, w = g.weapons.weapon;
    if (!g.map.power) return 'Kein Strom';
    if (this.state === 'ready') return `Drücke ${F} für ${this.slot.stats.name}`;
    if (this.state !== 'idle') return null;
    if (!w) return null;
    if (w.pap) return 'Diese Waffe ist bereits verbessert';
    return `Drücke ${F}, um deine Waffe zu verbessern [Kosten: ${PAP_COST}]`;
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
    const g = this.g, on = g.map.power;
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
    for (const id in map.doors) this.list.push(new DoorBuy(game, map.doors[id]));
    for (const w of map.windows) this.list.push(new Barricade(game, w));
    for (const wb of WALLBUYS) this.list.push(new WallBuy(game, wb));
    for (const id in PERKS) this.list.push(new PerkMachine(game, id));
    this.power = new PowerSwitch(game); this.list.push(this.power);
    this.box = new MysteryBox(game); this.list.push(this.box);
    this.pap = new PackAPunch(game); this.list.push(this.pap);
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
    g.hud.prompt(best ? best.prompt() : null);
    if (best) {
      if (best.hold) { if (input.down('KeyF')) best.holdUse(dt); }
      else if (input.hit('KeyF')) best.use();
    }
  }
}
