// ─────────────────────────────────────────────────────────────
//  Der Bus der Linie 13 mit Roboterfahrer OTTO.
//  Fährt die Ringstraße ab, hält an fünf Haltestellen, nimmt Spieler
//  mit (Mitfahren in lokalen Koordinaten), Zombies steigen zu oder
//  werden überfahren. Eigene Lichter, Motor-, Hupen- und Türgeräusche.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { route, STOPS, LANE, wx, SHELTERS } from '../maps/linie13-data.js';
import { rand, pick, clamp, damp, smooth } from '../core/utils.js';
import * as T from '../core/textures.js';

export const BUS = { HALF_W: 1.3, HALF_L: 5.6, FLOOR: 0.55, ROOF: 3.05, CAB_Z: 3.85, DOOR_Z0: -0.8, DOOR_Z1: 0.8 };
const { HALF_W, HALF_L, FLOOR, CAB_Z, DOOR_Z0, DOOR_Z1 } = BUS;
const VMAX = 11.5, ACC = 2.1, BRAKE = 2.4;
const WAIT = 24, FIRST_WAIT = 40;
const AXLE = 3.1; // halber Radstand für die Spurführung

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _l = new THREE.Vector3(), _w = new THREE.Vector3();

// Sprüche von OTTO ({stop} = Haltestelle)
const LINES = {
  depart: [
    'Linie 13 fährt ab. Bitte nicht mit den Toten sprechen.',
    'Türen schließen. Wer draußen ist, bleibt draußen.',
    'Abfahrt. Festhalten ist freiwillig. Überleben auch.',
    'Nächster Halt: {stop}. Ich halte dort. Meistens.',
    'Weiter geht es nach {stop}. Bitte die Arme im Bus lassen. Draußen sind Hände.',
  ],
  arrive: [
    '{stop}. Bitte beachten Sie die Untoten beim Aussteigen.',
    'Halt: {stop}. Ich warte. Aber nicht ewig.',
    'Wir erreichen {stop}. Endstation für Ihre Hoffnungen.',
    '{stop}. Vergessen Sie Ihr Gehirn nicht. Die anderen tun es auch nicht.',
  ],
  soon: ['Abfahrt in fünf Sekunden.', 'Letzter Aufruf. Fünf Sekunden.', 'Ich zähle bis fünf. Dann bin ich weg.'],
  zombie: ['Fahrgast ohne Fahrschein entdeckt.', 'Bitte nicht die anderen Fahrgäste essen.', 'Untote fahren hier nicht umsonst!'],
  blocked: ['Aus dem Weg, Fleischsack!', 'Ich bremse für Menschen. Noch.', 'Bitte von der Fahrbahn treten.'],
  shot: ['Au. Das kommt in meinen Bericht.', 'Ich bin nur der Busfahrer!', 'Schäden am Fahrer kosten extra.', 'Schießen Sie lieber auf die da draußen.', 'Noch einmal und ich fahre ohne Sie.'],
  called: ['Ich komme ja schon.', 'Bin unterwegs. Keine Panik. Doch, ein bisschen Panik.', 'Taxi bin ich keins. Aber gut.'],
  idle: [
    'Schöne Nacht für eine Fahrt. Schade um die Fahrgäste.',
    'Sender 7 sendet seit Jahren. Niemand weiß, an wen.',
    'Diese Strecke fahre ich seit neunzehnhundertsiebenundachtzig. Die Zombies sind neu.',
    'Im Maisfeld steht eine Hütte. Ich halte dort nicht. Aus Gründen.',
    'Der Strom im Kraftwerk ist aus. Wie so vieles.',
  ],
  go: ['Na gut, dann eben jetzt.', 'Sie haben es eilig? Ich auch.'],
  signal: ['Der Nebel lichtet sich. Ich sehe zum ersten Mal seit Jahren die Straße.'],
};

export class Bus {
  constructor(game) {
    this.g = game;
    this.path = route();
    this.stops = STOPS.map((st, i) => ({ ...st, i, s: this.path.nearestS(wx(st.cell[0]), wx(st.cell[1])) }));
    this.group = this.buildModel(game.M);
    game.scene.add(this.group);
    this.pos = this.group.position;
    this.yaw = 0;
    this.interactables = this.makeInteractables();
    this.reset();
  }

  // ── Geometrie & Koordinaten ─────────────────────────────────
  lanePoint(s, out) {
    const p = this.path.pointAt(s, out);
    const h = this.path.headingAt(s);
    out.x = p.x - Math.cos(h) * LANE;
    out.z = p.z + Math.sin(h) * LANE;
    return out;
  }

  placeAt(s) {
    const f = this.lanePoint(s + AXLE, _a), r = this.lanePoint(s - AXLE, _b);
    this.yaw = Math.atan2(f.x - r.x, f.z - r.z);
    this.pos.set((f.x + r.x) / 2, 0, (f.z + r.z) / 2);
    this.group.rotation.y = this.yaw;
  }

  toLocal(p, out = new THREE.Vector3()) {
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z, c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    return out.set(dx * c - dz * s, p.y, dx * s + dz * c);
  }

  toWorld(l, out = new THREE.Vector3()) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    return out.set(this.pos.x + l.x * c + l.z * s, l.y, this.pos.z - l.x * s + l.z * c);
  }

  get doorIsOpen() { return this.door > 0.6; }
  inDoorway(l, margin = 0.1) { return this.doorIsOpen && l.z > DOOR_Z0 + margin && l.z < DOOR_Z1 - margin; }

  // Boden unter einer Position (Busboden, sonst 0)
  floorAt(p) {
    const l = this.toLocal(p, _l);
    if (Math.abs(l.z) < HALF_L - 0.05 && l.x < HALF_W - 0.05 && l.x > -HALF_W - 0.05) {
      if (p.y > FLOOR - 0.65) return FLOOR;
      if (this.inDoorway(l) && l.x < -HALF_W + 0.7) return FLOOR; // Stufe an der Tür
    }
    return 0;
  }

  // Kollision: innen an den Wänden halten, außen vom Bus wegschieben
  constrain(p, r) {
    const l = this.toLocal(p, _l);
    if (l.x < -HALF_W - r || l.x > HALF_W + r || Math.abs(l.z) > HALF_L + r) return false;
    if (p.y > FLOOR - 0.35) {
      if (l.x < -HALF_W + 0.05 && this.inDoorway(l, 0)) return false; // steigt gerade aus
      const inner = HALF_W - 0.1 - r;
      const minX = this.inDoorway(l, r * 0.6) ? -HALF_W - 3 : -inner;
      l.x = clamp(l.x, minX, inner);
      l.z = clamp(l.z, -HALF_L + 0.25 + r, CAB_Z - r);
    } else {
      if (this.inDoorway(l, r * 0.6) && l.x < -HALF_W + 0.8) return false; // Einstieg
      const pen = [l.x + HALF_W + r, HALF_W + r - l.x, l.z + HALF_L + r, HALF_L + r - l.z];
      const m = Math.min(...pen);
      if (m === pen[0]) l.x = -HALF_W - r; else if (m === pen[1]) l.x = HALF_W + r;
      else if (m === pen[2]) l.z = -HALF_L - r; else l.z = HALF_L + r;
    }
    const w = this.toWorld(l, _w);
    p.x = w.x; p.z = w.z;
    return true;
  }

  // Strahl gegen die Außenhaut (Brüstung unter den Fenstern und Dach)
  rayCast(o, d, maxDist) {
    const lo = this.toLocal(o, new THREE.Vector3());
    if (Math.abs(lo.x) < HALF_W && Math.abs(lo.z) < HALF_L && lo.y < BUS.ROOF + 0.2) return null; // von innen: Fenster offen
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const ld = new THREE.Vector3(d.x * c - d.z * s, d.y, d.x * s + d.z * c);
    let best = null;
    for (const [y0, y1] of [[0.3, 1.32], [2.68, BUS.ROOF]]) {
      const t = slab(lo, ld, [-HALF_W, y0, -HALF_L], [HALF_W, y1, HALF_L]);
      if (t !== null && t < maxDist && (!best || t < best.dist)) best = { dist: t, mat: 'metal' };
    }
    if (!best) return null;
    const hit = lo.clone().addScaledVector(ld, best.dist);
    const n = Math.abs(Math.abs(hit.x) - HALF_W) < 0.02 ? new THREE.Vector3(Math.sign(hit.x), 0, 0) : Math.abs(Math.abs(hit.z) - HALF_L) < 0.02 ? new THREE.Vector3(0, 0, Math.sign(hit.z)) : new THREE.Vector3(0, Math.sign(hit.y - 1.5), 0);
    best.normal = new THREE.Vector3(n.x * c + n.z * s, n.y, -n.x * s + n.z * c);
    return best;
  }

  // Einstiegspunkte (Welt) für Zombies: offene Tür oder Fenster
  boardPoints() {
    const pts = [];
    if (this.doorIsOpen) pts.push({ l: new THREE.Vector3(-HALF_W - 0.6, 0, 0), win: false });
    for (const z of [-4.2, -2.6, 2.0]) for (const sx of [-1, 1]) {
      if (sx < 0 && z > DOOR_Z0 - 0.5 && z < DOOR_Z1 + 0.5) continue;
      pts.push({ l: new THREE.Vector3(sx * (HALF_W + 0.55), 0, z), win: true });
    }
    for (const p of pts) p.w = this.toWorld(p.l, new THREE.Vector3());
    return pts;
  }

  // ── Zustand ─────────────────────────────────────────────────
  reset() {
    this.stopIdx = 0;
    this.s = this.stops[0].s;
    this.v = 0;
    this.state = 'wait';
    this.t = FIRST_WAIT;
    this.target = 1;
    this.door = 1;
    this.called = -1;
    this.playerOn = false;
    this.blockT = 0;
    this.honkCd = 0;
    this.voiceCd = 0;
    this.idleT = 30;
    this.braking = 0;
    this.shotCd = 0;
    this.headLook = 0;
    this.warned = false;
    this.zombieWarnCd = 0;
    this.wheelRot = 0;
    this.placeAt(this.s);
  }

  get nextStop() { return this.stops[this.target]; }

  // Wird nach dem Abfahren bestimmt: nächster Halt (gerufene Haltestelle hat Vorrang)
  willStopAt(stop) {
    if (this.called < 0) return true;
    return stop.i === this.called;
  }

  say(kind, vars = {}, force = false) {
    if (!force && this.voiceCd > 0) return;
    const g = this.g;
    const near = this.playerOn || g.player.pos.distanceTo(this.pos) < 28;
    if (!near || g.state !== 'playing') return;
    let text = pick(LINES[kind]);
    for (const k in vars) text = text.replace('{' + k + '}', vars[k]);
    this.voiceCd = 5;
    g.audio.say(text, { pitch: 0.55, rate: 1.08 });
    g.hud.subtitle('OTTO', text);
  }

  depart() {
    this.state = 'closing';
    this.t = 1.3;
    this.g.audio.busDoor(this.pos, false);
    let n = (this.stopIdx + 1) % this.stops.length;
    while (!this.willStopAt(this.stops[n])) n = (n + 1) % this.stops.length;
    this.target = n;
    this.say('depart', { stop: this.nextStop.name }, true);
  }

  // Spieler ruft den Bus an einer Haltestelle
  call(i) {
    if (this.state === 'wait' && this.stopIdx === i) return;
    this.called = i;
    if (this.state === 'wait') this.t = Math.min(this.t, 2.5);
    else if (this.state === 'drive' && this.target !== i && this.v > 0) this.target = i;
    this.g.audio.busChime(this.pos);
    const d = this.g.player.pos.distanceTo(this.pos);
    if (d < 28 || this.playerOn) this.say('called', {}, true);
    this.g.hud.notice('Der Bus ist unterwegs zu dir', 2500);
  }

  // ── Fahren (vor dem Spieler-Update: nimmt Mitfahrer mit) ──────
  early(dt, active) {
    const g = this.g, p = g.player;
    // Steht der Spieler im Bus?
    const lp = this.toLocal(p.pos, new THREE.Vector3());
    this.playerOn = active && !p.downed && Math.abs(lp.x) < HALF_W - 0.02 && Math.abs(lp.z) < HALF_L && p.pos.y > FLOOR - 0.3;
    const oldYaw = this.yaw;
    this.drive(dt);
    this.boardPts = this.boardPoints();
    if (this.playerOn) {
      const w = this.toWorld(lp, _w);
      p.pos.x = w.x; p.pos.z = w.z;
      p.yaw += this.yaw - oldYaw;
    }
    // Zombies im Bus fahren mit
    for (const z of g.zombies.pool) {
      if (!z.active || !z.onBus) continue;
      const w = this.toWorld(z.local, _w);
      z.pos.x = w.x; z.pos.z = w.z;
      z.yaw += this.yaw - oldYaw;
    }
  }

  drive(dt) {
    this.t -= dt;
    this.voiceCd -= dt;
    this.honkCd -= dt;
    this.zombieWarnCd -= dt;
    switch (this.state) {
      case 'wait':
        this.door = Math.min(1, this.door + dt * 1.5);
        if (this.t < 5 && !this.warned) { this.warned = true; if (this.playerOn || this.g.player.pos.distanceTo(this.pos) < 20) this.say('soon', {}, true); }
        if (this.t <= 0) this.depart();
        break;
      case 'closing':
        this.door = Math.max(0, this.door - dt / 1.1);
        if (this.t <= 0) { this.state = 'drive'; this.g.audio.horn(this.pos, 0.6); }
        break;
      case 'drive': {
        const stop = this.nextStop;
        const dist = this.path.ahead(this.s, stop.s);
        let vt = VMAX;
        // Kurven: Richtungsänderung auf den nächsten 14 m
        const h0 = this.path.headingAt(this.s), h1 = this.path.headingAt(this.s + 14);
        let dh = Math.abs(((h1 - h0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        vt = Math.min(vt, Math.sqrt(2.6 / Math.max(dh / 14, 1e-4)));
        vt = Math.min(vt, Math.sqrt(2 * BRAKE * Math.max(0, dist - 0.2)) + 0.3);
        // Spieler auf der Fahrbahn vor dem Bus → bremsen und hupen
        const lp = this.toLocal(this.g.player.pos, _l);
        const ahead = this.g.state === 'playing' && !this.playerOn && lp.z > HALF_L - 0.5 && lp.z < HALF_L + 3 + this.v * 0.6 && Math.abs(lp.x) < HALF_W + 0.5 && this.g.player.pos.y < 1;
        if (ahead) {
          vt = 0;
          this.blockT += dt;
          if (this.honkCd <= 0) { this.honkCd = 2.2; this.g.audio.horn(this.pos, 1); if (this.blockT > 1) this.say('blocked'); }
        } else this.blockT = 0;
        const prev = this.v;
        if (this.v < vt) this.v = Math.min(vt, this.v + ACC * dt);
        else this.v = Math.max(vt, this.v - BRAKE * 2.2 * dt);
        this.braking = this.v < prev - 0.01 ? 1 : Math.max(0, this.braking - dt * 3);
        if (prev > 4 && vt < 2.5 && dist < 18 && !this.squealed) { this.squealed = true; this.g.audio.brakeSqueal(this.pos); }
        this.s = this.path.wrap(this.s + this.v * dt);
        if (dist < 0.35 && this.v < 0.9) {
          this.v = 0;
          this.s = stop.s;
          this.stopIdx = stop.i;
          if (this.called === stop.i) this.called = -1;
          this.state = 'opening';
          this.t = 0.9;
          this.squealed = false;
          this.g.audio.busDoor(this.pos, true);
          this.g.audio.busChime(this.pos);
          this.say('arrive', { stop: stop.name }, true);
        }
        if (this.playerOn && this.v > 6) {
          this.idleT -= dt;
          if (this.idleT <= 0) { this.idleT = rand(35, 60); this.say('idle'); }
        }
        break;
      }
      case 'opening':
        this.door = Math.min(1, this.door + dt / 0.8);
        if (this.t <= 0) {
          this.state = 'wait';
          this.t = this.called >= 0 ? 4 : WAIT;
          this.warned = false;
        }
        break;
    }
    this.placeAt(this.s);
  }

  // ── Nach den Zombies: Überfahren, Wegschieben, Effekte ─────
  update(dt, time, active) {
    const g = this.g;
    this.shotCd -= dt;
    // Zombies vor dem Bus werden überfahren, an der Seite weggeschoben
    for (const z of g.zombies.pool) {
      if (!z.alive || z.onBus || z.state === 'rise') continue;
      const l = this.toLocal(z.pos, _l);
      if (Math.abs(l.x) > HALF_W + 0.45 || Math.abs(l.z) > HALF_L + 0.45) continue;
      if (this.v > 2.5 && l.z > HALF_L - 1.5) {
        const dir = new THREE.Vector3(Math.sin(this.yaw), 0.3, Math.cos(this.yaw));
        g.zombies.damage(z, 1e9, 'torso', { dir, point: z.pos.clone().setY(1.2), nuke: true, fling: 1.5 });
        g.audio.busHit(z.pos);
        continue;
      }
      if (this.inDoorway(l, 0) && l.x < 0) continue;
      const pen = [l.x + HALF_W + 0.45, HALF_W + 0.45 - l.x, l.z + HALF_L + 0.45, HALF_L + 0.45 - l.z];
      const m = Math.min(...pen);
      if (m === pen[0]) l.x = -HALF_W - 0.45; else if (m === pen[1]) l.x = HALF_W + 0.45;
      else if (m === pen[2]) l.z = -HALF_L - 0.45; else l.z = HALF_L + 0.45;
      const w = this.toWorld(l, _w);
      z.pos.x = w.x; z.pos.z = w.z;
    }
    if (active && this.zombieWarnCd <= 0 && this.playerOn && g.zombies.pool.some((z) => z.alive && z.onBus)) {
      this.zombieWarnCd = 25;
      this.say('zombie');
    }
    this.animate(dt, time);
    this.updateSound(dt);
  }

  onShot(o, d, maxDist) {
    if (this.shotCd > 0) return;
    const head = this.toWorld(this.otto.headLocal, new THREE.Vector3());
    const oc = head.clone().sub(o);
    const t = oc.dot(d);
    if (t < 0 || t > maxDist) return;
    if (oc.addScaledVector(d, -t).length() > 0.45) return;
    this.shotCd = 3;
    this.ottoHit = 0.6;
    this.g.effects.impact(head.clone().addScaledVector(d, -0.1), d.clone().negate(), 'metal');
    this.say('shot', {}, true);
    if (this.state === 'wait' && Math.random() < 0.35) { this.t = Math.min(this.t, 3); this.say('go', {}, true); }
  }

  // ── Darstellung ─────────────────────────────────────────────
  animate(dt, time) {
    const g = this.g;
    const k = smooth(clamp(this.door, 0, 1));
    for (const d of this.doors) d.mesh.position.z = d.home + d.dir * k * 0.78;
    this.wheelRot += (this.v * dt) / 0.5;
    for (const w of this.wheels) w.rotation.x = this.wheelRot;
    this.tail.color.setRGB(this.braking > 0.1 ? 6 : 2.2, 0.08, 0.05);
    // OTTO: Kopf dreht sich zum Spieler, wenn er nahe ist; zuckt bei Treffern
    const o = this.otto;
    const lp = this.toLocal(g.player.pos, _l);
    const look = lp.z < 6 && Math.hypot(lp.x - 0.7, lp.z - 4.6) < 7 ? Math.atan2(lp.x - 0.7, lp.z - 4.6) : Math.sin(time * 0.3) * 0.3;
    this.headLook = damp(this.headLook, clamp(look, -1.4, 1.4), 4, dt);
    this.ottoHit = Math.max(0, (this.ottoHit || 0) - dt);
    o.head.rotation.set(Math.sin(time * 40) * this.ottoHit * 0.3, this.headLook, Math.sin(time * 33) * this.ottoHit * 0.2);
    const eye = this.ottoHit > 0 ? (Math.random() < 0.5 ? 0.2 : 4) : 3.2 + Math.sin(time * 2) * 0.4;
    o.eyeMat.color.setRGB(eye * 0.25, eye * 0.9, eye);
    o.armL.rotation.x = -0.9 + Math.sin(time * 1.3) * 0.05;
    o.armR.rotation.x = -0.9 - Math.sin(time * 1.1) * 0.05;
    o.wheel.rotation.z = Math.sin(time * 0.7) * 0.2 + (this.state === 'drive' ? clamp(this.turnRate * 2, -0.8, 0.8) : 0);
    const prevYaw = this.prevYaw ?? this.yaw;
    this.turnRate = dt > 0 ? damp(this.turnRate || 0, (((this.yaw - prevYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) / dt, 4, dt) : 0;
    this.prevYaw = this.yaw;
    // Innenlicht flackert leicht, Scheinwerfer an
    this.inner.intensity = Math.random() < 0.01 ? 0.3 : 1.6;
    this.sign.color.setScalar(1.6 + Math.sin(time * 2) * 0.1);
  }

  updateSound(dt) {
    const a = this.g.audio;
    if (!a.ctx) return;
    if (!this.engine) this.engine = a.engineLoop();
    const d = this.g.camera.position.distanceTo(this.pos);
    this.engine.update(this.pos, this.v / VMAX, d < 90 ? 1 : 0, this.playerOn);
  }

  dispose() {
    if (this.engine) { this.engine.stop(); this.engine = null; }
    if (this.g.bus === this) this.g.bus = null;
  }

  // ── Interaktionen: Losfahren, Notausstieg, Rufknöpfe ────────
  makeInteractables() {
    const bus = this;
    const g = this.g;
    const verb = () => g.input.verb(false);
    const list = [];
    // Knopf beim Fahrer: sofort losfahren
    list.push({
      pos: new THREE.Vector3(), radius: 1.6,
      update() { bus.toWorld(new THREE.Vector3(-0.5, 0, CAB_Z - 0.4), this.pos); },
      prompt() { return bus.playerOn && bus.state === 'wait' && bus.t > 3 ? `${verb()}, damit OTTO sofort losfährt` : null; },
      use() { bus.t = Math.min(bus.t, 2.5); bus.say('go', {}, true); },
      reset() {},
    });
    // Notausstieg an der Tür während der Fahrt
    list.push({
      pos: new THREE.Vector3(), radius: 1.5,
      update() { bus.toWorld(new THREE.Vector3(-HALF_W + 0.5, 0, 0), this.pos); },
      prompt() { return bus.playerOn && !bus.doorIsOpen ? `${verb()} für den Notausstieg` : null; },
      use() {
        const p = g.player;
        const w = bus.toWorld(new THREE.Vector3(-HALF_W - 0.8, 0, 0), new THREE.Vector3());
        p.pos.set(w.x, FLOOR, w.z);
        const f = new THREE.Vector3(Math.sin(bus.yaw), 0, Math.cos(bus.yaw)).multiplyScalar(bus.v * 0.6);
        p.vel.set(f.x - Math.cos(bus.yaw) * 2, 2.5, f.z + Math.sin(bus.yaw) * 2);
        p.shake = Math.max(p.shake, 0.4);
        g.audio.busDoor(bus.pos, true);
      },
      reset() {},
    });
    // Rufknöpfe an den Haltestellen
    for (const sh of SHELTERS) {
      const i = this.stops.findIndex((s) => s.id === sh.stop);
      list.push({
        pos: new THREE.Vector3(), radius: 1.8,
        update() { if (sh.world) this.pos.set(sh.world.button.x, 0, sh.world.button.z); },
        prompt() {
          if (bus.playerOn) return null;
          if (bus.state === 'wait' && bus.stopIdx === i) return null;
          if (bus.called === i) return 'Der Bus ist unterwegs';
          return `${verb()}, um den Bus zu rufen`;
        },
        use() { bus.call(i); },
        reset() {},
      });
    }
    return list;
  }

  // ── Modell ──────────────────────────────────────────────────
  buildModel(M) {
    const root = new THREE.Group();
    root.userData.dynamic = true;
    const parts = new Map(); // Material → Geometrien (werden verschmolzen)
    const add = (geo, mat) => { if (!parts.has(mat)) parts.set(mat, []); parts.get(mat).push(geo.index ? geo.toNonIndexed() : geo); };
    const B = (w, h, d, x, y, z, mat, rx = 0, ry = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); g.translate(x, y, z); add(g, mat); };
    const Cy = (r, h, x, y, z, mat, axis = 'y', seg = 10) => { const g = new THREE.CylinderGeometry(r, r, h, seg); if (axis === 'x') g.rotateZ(Math.PI / 2); if (axis === 'z') g.rotateX(Math.PI / 2); g.translate(x, y, z); add(g, mat); };

    const std = (o) => new THREE.MeshStandardMaterial(o);
    const cream = std({ color: 0xd9cfae, roughness: 0.45, metalness: 0.2, envMapIntensity: 1.2 });
    const green = std({ color: 0x1e5b37, roughness: 0.4, metalness: 0.3 });
    const dark = std({ color: 0x151616, roughness: 0.7, metalness: 0.2 });
    const rubber = std({ color: 0x1b1b1b, roughness: 0.95 });
    const seatMat = std({ color: 0x5a1f22, roughness: 0.8 });
    const floorMat = std({ color: 0x2a2c2a, roughness: 0.9 });
    const glass = std({ color: 0x1f2a30, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.4 });
    const chrome = M.chrome;
    const light = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.6, 1.75) });
    const amber = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.6, 0.2) });
    const head = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5.6, 4.6) });
    this.tail = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.08, 0.05) });

    const W = HALF_W, L = HALF_L, t = 0.07;
    // Boden
    B(2 * W, 0.25, 2 * L, 0, 0.425, 0, floorMat);
    B(2 * W + 0.04, 0.12, 2 * L + 0.04, 0, 0.26, 0, dark); // Schürze
    // Seitenwände unten (mit Radkästen und Tür)
    const arches = [[-3.35, -1.85], [2.85, 4.35]];
    const lowerSeg = (side, z0, z1) => { if (z1 - z0 < 0.01) return; B(t, 1.0, z1 - z0, side * (W - t / 2), 0.82, (z0 + z1) / 2, green); };
    for (const side of [-1, 1]) {
      const cuts = [...arches];
      if (side < 0) cuts.push([DOOR_Z0, DOOR_Z1]);
      cuts.sort((a, b) => a[0] - b[0]);
      let z = -L;
      for (const [c0, c1] of cuts) { lowerSeg(side, z, c0); z = c1; }
      lowerSeg(side, z, L);
      for (const [c0, c1] of arches) {
        B(t, 0.3, c1 - c0, side * (W - t / 2), 1.17, (c0 + c1) / 2, green);
        B(0.5, 0.06, c1 - c0, side * (W - 0.25), 1.02, (c0 + c1) / 2, dark);
        B(0.5, 0.75, 0.06, side * (W - 0.25), 0.65, c0, dark); B(0.5, 0.75, 0.06, side * (W - 0.25), 0.65, c1, dark);
      }
      // Zierstreifen und Schriftzug-Band
      B(0.02, 0.08, 2 * L, side * (W + 0.005), 1.3, 0, chrome);
      // Fensterpfosten
      for (let z = -L + 0.05; z <= L - 1.6; z += 1.45) {
        if (side < 0 && z > DOOR_Z0 - 0.1 && z < DOOR_Z1 + 0.1) continue;
        B(t + 0.01, 1.36, 0.12, side * (W - t / 2), 2.0, z, dark);
      }
      B(t, 0.22, 2 * L, side * (W - t / 2), 2.79, 0, cream);
      B(t + 0.02, 0.06, 2 * L, side * (W - t / 2), 2.68, 0, dark);
    }
    // Tür-Rahmen (rechts)
    B(t + 0.01, 2.3, 0.1, -(W - t / 2), 1.5, DOOR_Z0, dark);
    B(t + 0.01, 2.3, 0.1, -(W - t / 2), 1.5, DOOR_Z1, dark);
    // Dach mit leichter Wölbung und Klimaanlage
    B(2 * W, 0.12, 2 * L, 0, 2.96, 0, cream);
    B(2 * W - 0.4, 0.1, 2 * L - 0.3, 0, 3.07, 0, cream);
    B(1.4, 0.35, 2.6, 0, 3.27, -2.4, dark);
    // Front: Scheibe, Zielanzeige, Scheinwerfer, Stoßstange
    B(2 * W, 0.85, t, 0, 0.82, L - t / 2, green);
    B(2 * W, 0.22, t, 0, 2.88, L - t / 2, dark);
    add(new THREE.PlaneGeometry(2 * W - 0.1, 1.5).translate(0, 2.0, L - 0.02), glass);
    B(2 * W + 0.06, 0.22, 0.18, 0, 0.42, L + 0.05, rubber);
    for (const sx of [-1, 1]) {
      B(0.36, 0.16, 0.05, sx * 0.88, 0.78, L + 0.01, head);
      B(0.18, 0.1, 0.05, sx * 1.12, 0.55, L + 0.01, amber);
      // Spiegel
      B(0.06, 0.06, 0.5, sx * (W + 0.25), 2.35, L - 0.3, dark, 0, sx * 0.4);
      B(0.08, 0.35, 0.2, sx * (W + 0.45), 2.2, L - 0.1, dark);
    }
    // Heck
    B(2 * W, 1.25, t, 0, 0.95, -L + t / 2, green);
    B(2 * W, 0.55, t, 0, 2.72, -L + t / 2, cream);
    add(new THREE.PlaneGeometry(2 * W - 0.2, 0.9).rotateY(Math.PI).translate(0, 2.0, -L + 0.02), glass);
    B(2 * W + 0.06, 0.22, 0.18, 0, 0.42, -L - 0.05, rubber);
    for (const sx of [-1, 1]) B(0.22, 0.45, 0.05, sx * 1.05, 1.0, -L - 0.01, this.tail);
    for (let i = 0; i < 5; i++) B(1.4, 0.04, 0.03, 0, 0.6 + i * 0.12, -L - 0.02, dark);
    // Innenraum: Sitze, Stangen, Leuchten, Trennwand zum Fahrer
    for (let z = -L + 0.7; z < CAB_Z - 0.6; z += 0.95) {
      for (const sx of [-1, 1]) {
        if (sx < 0 && z > DOOR_Z0 - 0.7 && z < DOOR_Z1 + 0.4) continue;
        const x = sx * (W - 0.5);
        B(0.85, 0.12, 0.45, x, 1.0, z, seatMat);
        B(0.85, 0.6, 0.1, x, 1.35, z - 0.22, seatMat, -0.15);
        B(0.08, 0.45, 0.08, x, 0.75, z, chrome);
      }
    }
    for (const z of [-3.5, -1.2, 1.2, 3.2]) Cy(0.025, 2.4, 0.35, 1.75, z, chrome);
    for (const sx of [-1, 1]) Cy(0.02, 2 * L - 1.5, sx * 0.55, 2.55, -0.5, chrome, 'z');
    for (const sx of [-1, 1]) B(0.12, 0.03, 2 * L - 1.4, sx * 0.5, 2.88, -0.4, light);
    B(1.2, 2.2, 0.05, 0.62, 1.65, CAB_Z + 0.05, glass);
    B(0.05, 2.2, 0.05, 0.0, 1.65, CAB_Z + 0.05, chrome);
    // Fahrerplatz
    B(0.6, 0.15, 0.6, 0.7, 1.0, 4.65, seatMat);
    B(0.6, 0.8, 0.12, 0.7, 1.45, 4.3, seatMat);
    B(2 * W - 0.2, 0.7, 0.5, 0, 1.0, L - 0.35, dark);
    // Haltestellen-Knöpfe (rot)
    for (const z of [-3.5, -1.2, 1.2, 3.2]) B(0.08, 0.06, 0.06, 0.35, 1.4, z + 0.04, this.tail);

    for (const [mat, geos] of parts) {
      const m = new THREE.Mesh(mergeGeometries(geos), mat);
      m.castShadow = mat !== glass && mat !== light;
      m.receiveShadow = true;
      root.add(m);
    }

    // Zielanzeige (LED)
    const signTex = T.textSign('13  RINGLINIE', '#ffa21a', '#050505', 1024, 160, 'bold 96px "Courier New", monospace');
    this.sign = new THREE.MeshBasicMaterial({ map: signTex, color: new THREE.Color(1.6, 1.6, 1.6) });
    const fs = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.32), this.sign);
    fs.position.set(0, 2.84, L + 0.01);
    root.add(fs);
    const rs = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.3), new THREE.MeshBasicMaterial({ map: T.textSign('13', '#ffa21a', '#050505', 256, 128, 'bold 96px "Courier New", monospace'), color: new THREE.Color(1.6, 1.6, 1.6) }));
    rs.position.set(0, 2.55, -L - 0.01); rs.rotation.y = Math.PI;
    root.add(rs);
    // Seitlicher Schriftzug
    const logo = T.textSign('LINIE 13 · GRAUWEILER', '#e9e2c8', '#1e5b37', 1024, 128, 'bold 64px Oswald, Impact, sans-serif');
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.5), new THREE.MeshStandardMaterial({ map: logo, roughness: 0.5 }));
      p.position.set(side * (W + 0.006), 0.95, side < 0 ? -2.9 : -1.0);
      p.rotation.y = side * Math.PI / 2;
      root.add(p);
    }

    // Türen (zwei Flügel, gleiten nach außen auf)
    this.doors = [];
    const doorMat = std({ color: 0x1e5b37, roughness: 0.4, metalness: 0.3 });
    for (const dir of [-1, 1]) {
      const leaf = new THREE.Group();
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.25, 0.78), doorMat);
      frame.position.y = 1.55;
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 1.3), glass);
      pane.position.set(-0.03, 1.85, 0); pane.rotation.y = -Math.PI / 2;
      leaf.add(frame, pane);
      const home = dir * 0.4;
      leaf.position.set(-W - 0.04, 0, home);
      root.add(leaf);
      this.doors.push({ mesh: leaf, home, dir });
    }

    // Räder
    this.wheels = [];
    const tire = std({ color: 0x111111, roughness: 0.9 });
    const hub = M.chrome;
    for (const z of [-2.6, 3.6]) for (const sx of [-1, 1]) {
      const w = new THREE.Group();
      const tg = new THREE.CylinderGeometry(0.5, 0.5, 0.32, 18); tg.rotateZ(Math.PI / 2);
      const tm = new THREE.Mesh(tg, tire); tm.castShadow = true;
      const hg = new THREE.CylinderGeometry(0.26, 0.26, 0.34, 10); hg.rotateZ(Math.PI / 2);
      w.add(tm, new THREE.Mesh(hg, hub));
      for (let i = 0; i < 5; i++) { const n = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.05, 0.05), dark); n.rotation.x = (i / 5) * Math.PI; w.add(n); }
      w.position.set(sx * (W - 0.18), 0.5, z);
      root.add(w);
      this.wheels.push(w);
    }

    // OTTO, der Roboterfahrer
    const otto = { eyeMat: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.8, 2.9, 3.2) }) };
    const metal = std({ color: 0x8a8f94, roughness: 0.35, metalness: 0.85 });
    const body = new THREE.Group();
    body.position.set(0.7, 1.05, 4.62);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.65, 0.35), metal); torso.position.y = 0.4; body.add(torso);
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.57, 0.3, 0.37), green); vest.position.y = 0.5; body.add(vest);
    const hd = new THREE.Group(); hd.position.y = 0.95; body.add(hd);
    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.3, 0.32), metal); hd.add(skull);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.02), otto.eyeMat); visor.position.set(0, 0.03, 0.17); hd.add(visor);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.21, 0.08, 14), green); cap.position.y = 0.19; hd.add(cap);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.14), dark); brim.position.set(0, 0.16, 0.2); hd.add(brim);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.22, 4), chrome); ant.position.set(0.12, 0.3, -0.05); hd.add(ant);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), this.tail); tip.position.set(0.12, 0.42, -0.05); hd.add(tip);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.16, 8), dark); neck.position.y = 0.78; body.add(neck);
    for (const sx of [-1, 1]) {
      const arm = new THREE.Group(); arm.position.set(sx * 0.33, 0.65, 0);
      const ua = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.45, 8), metal); ua.position.y = -0.22; arm.add(ua);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), dark); hand.position.y = -0.47; arm.add(hand);
      body.add(arm);
      if (sx < 0) otto.armR = arm; else otto.armL = arm;
    }
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 6, 20), dark);
    wheel.position.set(0.7, 1.55, 5.1); wheel.rotation.x = -0.9;
    root.add(body, wheel);
    otto.head = hd; otto.body = body; otto.wheel = wheel;
    this.otto = otto;
    otto.headLocal = new THREE.Vector3(0.7, 2.0, 4.62); // Kopf relativ zum Bus (für Treffer)

    // Lichter: Scheinwerfer (echtes Spotlicht) und Innenbeleuchtung
    const spot = new THREE.SpotLight(0xfff0d8, 70, 45, 0.55, 0.5, 1.4);
    spot.position.set(0, 0.9, L + 0.2);
    spot.target.position.set(0, 0, L + 22);
    spot.userData.tier = 1;
    root.add(spot, spot.target);
    this.headlight = spot;
    const inner = new THREE.PointLight(0xdcecff, 1.6, 9, 1.6);
    inner.position.set(0, 2.55, -0.5);
    inner.userData.tier = 1;
    root.add(inner);
    this.inner = inner;
    return root;
  }
}

// Strahl gegen achsenparallele Box (lokal); liefert Abstand oder null
function slab(o, d, min, max) {
  let t0 = 0, t1 = Infinity;
  for (const [a, lo, hi] of [['x', min[0], max[0]], ['y', min[1], max[1]], ['z', min[2], max[2]]]) {
    if (Math.abs(d[a]) < 1e-8) { if (o[a] < lo || o[a] > hi) return null; continue; }
    let ta = (lo - o[a]) / d[a], tb = (hi - o[a]) / d[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return t0 > 0 ? t0 : null;
}
