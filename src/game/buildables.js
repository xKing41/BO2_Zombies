// ─────────────────────────────────────────────────────────────
//  Baupläne: Bauteile finden (immer nur eines tragbar), an Werkbänken
//  einbauen. Turbine (tragbar, treibt Tor und Funkmast an), Stromschalter,
//  Äther-Schmiede und die geheime Wunderwaffe "Gewitter-Werfer".
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { BENCHES, PART_SPOTS, MAST_PAD, wx } from '../maps/linie13-data.js';
import { WALLDIR } from '../world/map.js';
import { buildGun } from '../weapons/guns.js';
import * as P from '../world/props.js';
import { mergeByMaterial } from '../world/batch.js';
import { pick, rand, smooth } from '../core/utils.js';

export const PARTS = {
  rotor: { name: 'Rotorblatt', icon: '✇', bp: 'turbine' },
  dynamo: { name: 'Dynamo', icon: '⚙', bp: 'turbine' },
  tail: { name: 'Leitwerk', icon: '➹', bp: 'turbine' },
  lever: { name: 'Hebel', icon: '⏚', bp: 'power' },
  board: { name: 'Schaltplatine', icon: '▦', bp: 'power' },
  reel: { name: 'Kabeltrommel', icon: '◎', bp: 'power' },
  gears: { name: 'Zahnradsatz', icon: '⚙', bp: 'pap' },
  crystal: { name: 'Ätherkristall', icon: '◆', bp: 'pap' },
  battery: { name: 'Batteriepack', icon: '▮', bp: 'pap' },
  capacitor: { name: 'Kondensator', icon: '⧈', bp: 'tesla' },
  coil: { name: 'Kupferspule', icon: '§', bp: 'tesla' },
  grip: { name: 'Griffstück', icon: '⌐', bp: 'tesla' },
  tube: { name: 'Blitzröhre', icon: 'ϟ', bp: 'tesla' },
};
export const BLUEPRINTS = {
  turbine: { name: 'Turbine', parts: ['rotor', 'dynamo', 'tail'] },
  power: { name: 'Stromschalter', parts: ['lever', 'board', 'reel'] },
  pap: { name: 'Äther-Schmiede', parts: ['gears', 'crystal', 'battery'] },
  tesla: { name: 'Gewitter-Werfer', parts: ['capacitor', 'coil', 'grip', 'tube'] },
};
const BUILD_TIME = 1.3;

// ── Modelle der Bauteile ──────────────────────────────────────
function partModel(id, M) {
  const g = new THREE.Group();
  const m = (geo, mat, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
  const copper = M.copper || (M.copper = new THREE.MeshStandardMaterial({ color: 0xb8673a, roughness: 0.35, metalness: 0.9 }));
  const glowB = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.8, 3.2) });
  switch (id) {
    case 'rotor':
      m(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 10), M.metal).rotation.x = Math.PI / 2;
      for (let i = 0; i < 3; i++) { const b = m(new THREE.BoxGeometry(0.08, 0.5, 0.02), M.wood); b.geometry.translate(0, 0.27, 0); b.rotation.z = (i / 3) * Math.PI * 2; }
      break;
    case 'dynamo':
      m(new THREE.CylinderGeometry(0.11, 0.11, 0.32, 14), M.paintGreen).rotation.z = Math.PI / 2;
      for (const x of [-0.08, 0, 0.08]) m(new THREE.TorusGeometry(0.115, 0.012, 6, 16), copper, x).rotation.y = Math.PI / 2;
      m(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 6), M.chrome, 0.2).rotation.z = Math.PI / 2;
      break;
    case 'tail':
      m(new THREE.BoxGeometry(0.02, 0.3, 0.42), M.metal, 0, 0.1, -0.1);
      m(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 6), M.metal, 0, 0, 0.15).rotation.x = Math.PI / 2;
      break;
    case 'lever':
      m(new THREE.BoxGeometry(0.16, 0.06, 0.16), M.metal);
      m(new THREE.CylinderGeometry(0.018, 0.018, 0.34, 8), M.chrome, 0, 0.17, 0).rotation.z = 0.3;
      m(new THREE.SphereGeometry(0.04, 10, 8), M.paintRed, -0.05, 0.34, 0);
      break;
    case 'board': {
      m(new THREE.BoxGeometry(0.34, 0.02, 0.24), new THREE.MeshStandardMaterial({ color: 0x1d5a2a, roughness: 0.6 }));
      for (let i = 0; i < 6; i++) m(new THREE.BoxGeometry(0.04, 0.03, 0.06), M.dark, -0.12 + (i % 3) * 0.12, 0.025, -0.05 + Math.floor(i / 3) * 0.1);
      m(new THREE.BoxGeometry(0.03, 0.02, 0.03), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.3, 0.2) }), 0.14, 0.025, 0.09);
      break;
    }
    case 'reel':
      m(new THREE.CylinderGeometry(0.18, 0.18, 0.04, 16), M.wood, 0, 0, -0.12).rotation.x = Math.PI / 2;
      m(new THREE.CylinderGeometry(0.18, 0.18, 0.04, 16), M.wood, 0, 0, 0.12).rotation.x = Math.PI / 2;
      m(new THREE.CylinderGeometry(0.13, 0.13, 0.22, 16), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 })).rotation.x = Math.PI / 2;
      break;
    case 'gears':
      for (const [x, r] of [[-0.08, 0.12], [0.11, 0.08]]) {
        const t = m(new THREE.TorusGeometry(r, 0.03, 6, 12), M.chrome, x); t.rotation.x = Math.PI / 2;
        for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; m(new THREE.BoxGeometry(0.03, 0.04, 0.03), M.chrome, x + Math.cos(a) * (r + 0.03), 0, Math.sin(a) * (r + 0.03)); }
      }
      break;
    case 'crystal': {
      const c = m(new THREE.OctahedronGeometry(0.14, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.6, 3.2) }), 0, 0.08, 0);
      c.scale.set(0.8, 1.6, 0.8);
      m(new THREE.CylinderGeometry(0.1, 0.13, 0.06, 8), M.metal, 0, -0.12, 0);
      break;
    }
    case 'battery':
      m(new THREE.BoxGeometry(0.3, 0.2, 0.18), M.paintRed);
      m(new THREE.BoxGeometry(0.05, 0.04, 0.05), M.chrome, -0.08, 0.12, 0); m(new THREE.BoxGeometry(0.05, 0.04, 0.05), M.dark, 0.08, 0.12, 0);
      m(new THREE.BoxGeometry(0.31, 0.04, 0.19), M.dark, 0, 0.04, 0);
      break;
    case 'capacitor':
      m(new THREE.CylinderGeometry(0.08, 0.08, 0.26, 14), new THREE.MeshStandardMaterial({ color: 0x2a3550, roughness: 0.4, metalness: 0.5 }));
      m(new THREE.CylinderGeometry(0.02, 0.02, 0.08, 6), M.chrome, -0.03, 0.17, 0); m(new THREE.CylinderGeometry(0.02, 0.02, 0.08, 6), M.chrome, 0.03, 0.17, 0);
      break;
    case 'coil':
      for (let i = 0; i < 6; i++) m(new THREE.TorusGeometry(0.08, 0.018, 6, 16), copper, 0, -0.1 + i * 0.04, 0).rotation.x = Math.PI / 2;
      m(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8), M.dark);
      break;
    case 'grip':
      m(new THREE.BoxGeometry(0.06, 0.2, 0.09), M.gunWood, 0, -0.05, 0).rotation.x = -0.3;
      m(new THREE.BoxGeometry(0.07, 0.07, 0.24), M.gunMetal, 0, 0.06, -0.06);
      break;
    case 'tube':
      m(new THREE.CylinderGeometry(0.045, 0.045, 0.34, 12), new THREE.MeshStandardMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.35, roughness: 0.05 })).rotation.z = Math.PI / 2;
      m(new THREE.CylinderGeometry(0.015, 0.015, 0.32, 6), glowB).rotation.z = Math.PI / 2;
      for (const x of [-0.18, 0.18]) m(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 12), M.chrome, x).rotation.z = Math.PI / 2;
      break;
  }
  return g;
}

// Zusammengesetzte Turbine (Stativ, Mast, Dynamo, Rotor, Leitwerk)
function turbineModel(M) {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.85, 6), M.metal);
    leg.position.set(Math.cos(a) * 0.25, 0.38, Math.sin(a) * 0.25);
    leg.rotation.set(Math.sin(a) * 0.55, 0, -Math.cos(a) * 0.55);
    g.add(leg);
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.9, 8), M.metal);
  mast.position.y = 1.1; g.add(mast);
  const head = new THREE.Group(); head.position.y = 1.6; g.add(head);
  const dyn = partModel('dynamo', M); dyn.rotation.y = Math.PI / 2; head.add(dyn);
  const rotor = partModel('rotor', M); rotor.position.z = 0.24; head.add(rotor);
  const tail = partModel('tail', M); tail.position.z = -0.32; head.add(tail);
  g.userData.rotor = rotor;
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  return g;
}

export class Buildables {
  constructor(game) {
    this.g = game;
    const M = game.M, scene = game.scene;
    this.ghostMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.8, 1.6), transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false });
    this.glowTex = M.tex.glow;
    this.parts = {};
    this.interactables = [];
    this.carried = null;
    // Bauteile (Modell + Leuchten)
    for (const id in PARTS) {
      const grp = new THREE.Group();
      grp.userData.dynamic = true;
      const model = mergeByMaterial(partModel(id, M));
      grp.add(model);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.tex.glow, color: 0x5ab8ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 }));
      glow.scale.set(1.1, 1.1, 1);
      grp.add(glow);
      scene.add(grp);
      const part = { id, ...PARTS[id], group: grp, model, glow, state: 'ground', pos: new THREE.Vector3(), phase: rand(0, 6) };
      this.parts[id] = part;
      this.interactables.push(this.pickupInteractable(part));
    }
    // Werkbänke
    this.benches = {};
    this.makeBench('turbine', BENCHES.turbine);
    this.makeBench('tesla', BENCHES.tesla);
    this.makeMachineBench('power', game.interact.power, game.mapDef.powerSwitch);
    this.makeMachineBench('pap', game.interact.pap, game.mapDef.papSpot);
    // Turbine als Gerät
    this.turbine = { model: turbineModel(M), state: 'none', placedAt: null, spin: 0 };
    this.turbine.model.userData.dynamic = true;
    this.turbine.model.visible = false;
    scene.add(this.turbine.model);
    this.turbineSpots = this.makeTurbineSpots();
    this.reset();
  }

  // ── Bauteile ────────────────────────────────────────────────
  pickupInteractable(part) {
    const self = this, g = this.g;
    return {
      pos: part.pos, radius: 1.6,
      prompt() {
        if (part.state !== 'ground') return null;
        return `${g.input.verb(false)}, um ${part.name} aufzuheben`;
      },
      use() { self.act('bpPick', { id: part.id }, () => { g.hud.notice(`${part.name} – Bauteil für: ${BLUEPRINTS[part.bp].name}`, 2600); g.audio.partPickup(); }); },
      update() {},
      reset() {},
    };
  }

  // ── Koop: Aktionen führt der Host aus, Mitspieler fragen an ──
  act(kind, data, done) {
    const g = this.g;
    if (g.isClient) { g.net.request(kind, data).then((r) => { if (r.ok && done) done(); }); return; }
    const r = this.hostAct(kind, data, g.me);
    if (r.ok && done) done();
  }

  hostAct(kind, d, s) {
    const g = this.g, t = this.turbine;
    switch (kind) {
      case 'bpPick': {
        const part = this.parts[d.id];
        if (!part || part.state !== 'ground') return { ok: false };
        this.dropBy(s);
        part.state = 'carried'; part.carrier = s.slot; part.group.visible = false;
        break;
      }
      case 'bpInstall': {
        const bench = this.benches[d.bp];
        const part = Object.values(this.parts).find((p) => p.state === 'carried' && p.carrier === s.slot);
        if (!bench || bench.done || !part || part.bp !== d.bp) return { ok: false };
        this.install(bench, part);
        break;
      }
      case 'turbTake':
        if (t.state !== 'bench' && t.state !== 'placed') return { ok: false };
        this.dropBy(s, true);
        if (t.placedAt) this.onTurbineRemoved(t.placedAt);
        t.state = 'carried'; t.carrier = s.slot; t.placedAt = null; t.model.visible = false;
        break;
      case 'turbPlace': {
        const spot = this.turbineSpots.find((x) => x.id === d.spot);
        if (!spot || t.state !== 'carried' || t.carrier !== s.slot) return { ok: false };
        this.placeTurbine(spot);
        break;
      }
      case 'teslaTake': return { ok: !!(this.benches.tesla && this.benches.tesla.done) };
      default: return undefined;
    }
    this.syncMine();
    this.share();
    return { ok: true };
  }

  netRequest(kind, d, s) { return this.hostAct(kind, d, s); }

  // Was ein Spieler trägt, fällt an seiner Position zu Boden
  dropBy(s, partsOnly = false) {
    for (const id in this.parts) {
      const p = this.parts[id];
      if (p.state === 'carried' && p.carrier === s.slot) { p.state = 'ground'; p.carrier = -1; p.pos.set(s.pos.x, 0, s.pos.z); p.group.visible = true; }
    }
    void partsOnly;
  }

  // Eigenes Tragen (HUD) aus dem gemeinsamen Zustand ableiten
  syncMine() {
    const g = this.g, me = g.me.slot;
    this.carried = Object.values(this.parts).find((p) => p.state === 'carried' && p.carrier === me) || null;
    const turb = this.turbine.state === 'carried' && this.turbine.carrier === me;
    g.hud.carry(this.carried || (turb ? { name: 'Turbine', icon: '✇' } : null));
  }

  netState() {
    const parts = {};
    for (const id in this.parts) { const p = this.parts[id]; parts[id] = [p.state, +p.pos.x.toFixed(2), +p.pos.z.toFixed(2), p.carrier ?? -1]; }
    const benches = {};
    for (const bp in this.benches) { const b = this.benches[bp]; benches[bp] = [[...b.installed], b.done ? 1 : 0]; }
    const t = this.turbine, m = t.model;
    return { parts, benches, tb: [t.state, t.placedAt, t.carrier ?? -1, +m.position.x.toFixed(2), +m.position.z.toFixed(2), +m.rotation.y.toFixed(2)] };
  }

  share() { if (this.g.net && this.g.net.isHost) this.g.net.ev({ t: 'bld', s: this.netState() }); }
  netShare() { this.share(); }

  netEvent(e) {
    if (e.t !== 'bld') return false;
    this.applyNet(e.s);
    return true;
  }

  applyNet(s) {
    const g = this.g;
    for (const id in s.parts) {
      const [st, x, z, car] = s.parts[id], p = this.parts[id];
      if (!p) continue;
      p.state = st; p.pos.set(x, 0, z); p.carrier = car;
      p.group.visible = st === 'ground';
    }
    for (const bp in s.benches) {
      const b = this.benches[bp], [inst, done] = s.benches[bp];
      if (!b) continue;
      for (const id of inst) if (!b.installed.has(id)) { b.installed.add(id); b.onInstall(this.parts[id]); }
      if (done && !b.done) { b.done = true; g.audio.buildDone(); g.hud.notice(`${BLUEPRINTS[bp].name} gebaut!`, 3000); b.onDone(); }
    }
    const t = this.turbine, [tst, at, car, x, z, ry] = s.tb;
    t.state = tst; t.placedAt = at; t.carrier = car;
    if (tst === 'placed') { t.model.visible = true; t.model.scale.setScalar(1.35); t.model.position.set(x, 0, z); t.model.rotation.y = ry; }
    else if (tst === 'bench') t.model.visible = true;
    else t.model.visible = false;
    this.syncMine();
  }

  // ── Werkbänke ───────────────────────────────────────────────
  benchPrompt(bp, bench) {
    const g = this.g, c = this.carried;
    const B = BLUEPRINTS[bp];
    if (bench.done) return null;
    if (c && c.bp === bp) return `${g.input.verb(true)}, um ${c.name} einzubauen${bench.t > 0 ? ' ' + bar(bench.t / BUILD_TIME) : ''}`;
    const n = bench.installed.size;
    return `${B.name}: ${n}/${B.parts.length} Teile${c ? ` – ${c.name} passt hier nicht` : ''}`;
  }

  benchHold(bp, bench, dt) {
    const c = this.carried, g = this.g;
    if (!c || c.bp !== bp || bench.done) return;
    bench.t += dt;
    bench.click -= dt;
    if (bench.click <= 0) { bench.click = 0.16; g.audio.buildStep(bench.pos); }
    if (bench.t >= BUILD_TIME) {
      bench.t = 0;
      this.act('bpInstall', { bp });
    }
  }

  // Host: Teil einbauen; mit dem letzten Teil ist der Bauplan fertig
  install(bench, c) {
    const g = this.g;
    bench.installed.add(c.id);
    c.state = 'installed'; c.carrier = -1;
    bench.onInstall(c);
    if (bench.installed.size >= BLUEPRINTS[bench.bp].parts.length) {
      bench.done = true;
      g.audio.buildDone();
      g.hud.notice(`${BLUEPRINTS[bench.bp].name} gebaut!`, 3000);
      bench.onDone();
    }
  }

  makeBench(bp, spot) {
    const g = this.g, map = g.map, M = g.M;
    const wb = P.workbench(M);
    map.place(wb, spot.x, spot.y, spot.wall, 0.8);
    wb.updateMatrixWorld(true);
    map.colliders.push(map.aabb(wb, 0.03));
    const [dx, dz] = WALLDIR[spot.wall];
    const front = map.center(spot.x, spot.y).add(new THREE.Vector3(-dx * 0.6, 0, -dz * 0.6));
    // Geist des fertigen Objekts auf der Werkbank
    const ghost = mergeByMaterial(bp === 'turbine' ? turbineModel(M) : buildGun('tesla', M, false).group, this.ghostMat);
    if (bp === 'turbine') ghost.scale.setScalar(0.55); else ghost.scale.setScalar(2.2);
    ghost.position.set(wb.position.x + dx * 0.05, bp === 'turbine' ? 0.95 : 1.15, wb.position.z + dz * 0.05);
    ghost.rotation.y = wb.rotation.y + (bp === 'tesla' ? Math.PI / 2 : 0);
    ghost.userData.dynamic = true;
    g.scene.add(ghost);
    // Eingebaute Teile liegen sichtbar auf der Werkbank
    const shelf = new THREE.Group();
    shelf.position.copy(wb.position); shelf.rotation.y = wb.rotation.y;
    shelf.userData.dynamic = true;
    g.scene.add(shelf);
    const bench = { bp, pos: front, installed: new Set(), done: false, t: 0, click: 0, ghost, shelf, taken: false };
    bench.onInstall = (part) => {
      const pm = partModel(part.id, M);
      const i = bench.installed.size - 1;
      pm.position.set(-0.6 + i * 0.4, 0.98, 0.15);
      shelf.add(pm);
    };
    bench.onDone = () => {
      shelf.clear();
      if (bp === 'turbine') {
        // fertige Turbine steht auf der Werkbank, bis man sie nimmt
        this.turbine.state = 'bench';
        this.turbine.model.visible = true;
        this.turbine.model.position.copy(ghost.position).setY(0.94);
        this.turbine.model.scale.setScalar(0.55);
        ghost.visible = false;
      } else {
        bench.solid = buildGun('tesla', M, false).group;
        bench.solid.scale.setScalar(2.2);
        bench.solid.position.copy(ghost.position);
        bench.solid.rotation.copy(ghost.rotation);
        bench.solid.userData.dynamic = true;
        g.scene.add(bench.solid);
        ghost.visible = false;
      }
    };
    this.benches[bp] = bench;
    const self = this;
    this.interactables.push({
      pos: front, radius: 1.9, hold: true,
      prompt() {
        if (bench.done) {
          if (bp === 'turbine') return self.turbine.state === 'bench' ? `${g.input.verb(false)}, um die Turbine zu nehmen` : null;
          if (bp === 'tesla') return g.weapons.has('tesla') ? null : `${g.input.verb(false)} für den Gewitter-Werfer`;
        }
        return self.benchPrompt(bp, bench);
      },
      // Halten baut ein; ein kurzer Druck nimmt fertige Objekte
      holdUse(dt) {
        if (bench.done) {
          if (!g.input.hit('use')) return;
          if (bp === 'turbine' && self.turbine.state === 'bench') self.takeTurbine();
          else if (bp === 'tesla' && !g.weapons.has('tesla') && !g.weapons.busy) {
            self.act('teslaTake', {}, () => {
              g.weapons.give('tesla');
              g.hud.notice('Gewitter-Werfer', 2500);
              g.audio.teslaPickup();
              if (bench.solid) bench.solid.visible = false;
            });
          }
          return;
        }
        self.benchHold(bp, bench, dt);
      },
      update() { if (!g.input.held('use')) bench.t = 0; if (bench.done && bp === 'tesla' && bench.solid) bench.solid.visible = !g.weapons.has('tesla'); },
      reset() {},
    });
  }

  // Bauplatz direkt am Zielort (Stromschalter, Äther-Schmiede)
  makeMachineBench(bp, machine, spot) {
    const g = this.g, map = g.map;
    if (!machine) return;
    const src = machine.group.clone(true);
    src.visible = true;
    src.traverse((o) => { o.visible = true; });
    const ghost = mergeByMaterial(src, this.ghostMat);
    ghost.position.copy(machine.group.position);
    ghost.rotation.copy(machine.group.rotation);
    ghost.scale.copy(machine.group.scale);
    ghost.visible = true;
    ghost.userData.dynamic = true;
    g.scene.add(ghost);
    let front;
    if (spot.wall) {
      const [dx, dz] = WALLDIR[spot.wall];
      front = map.center(spot.cx, spot.cy).add(new THREE.Vector3(-dx * 0.4, 0, -dz * 0.4));
    } else front = map.center(spot.cx, spot.cy).add(new THREE.Vector3(0, 0, 1.4));
    const pile = new THREE.Group();
    pile.userData.dynamic = true;
    g.scene.add(pile);
    const bench = { bp, pos: front, installed: new Set(), done: false, t: 0, click: 0, ghost, pile };
    bench.onInstall = (part) => {
      const pm = partModel(part.id, g.M);
      const i = bench.installed.size - 1;
      pm.position.set(front.x + (i - 1) * 0.45, 0.15, front.z);
      pile.add(pm);
    };
    bench.onDone = () => {
      pile.clear();
      ghost.visible = false;
      machine.setBuilt();
    };
    this.benches[bp] = bench;
    const self = this;
    this.interactables.push({
      pos: front, radius: bp === 'pap' ? 2.4 : 1.9, hold: true,
      prompt() { return self.benchPrompt(bp, bench); },
      holdUse(dt) { self.benchHold(bp, bench, dt); },
      update() { if (!g.input.held('use')) bench.t = 0; },
      reset() {},
    });
  }

  // ── Turbine ─────────────────────────────────────────────────
  takeTurbine() {
    const g = this.g;
    this.act('turbTake', {}, () => {
      g.audio.partPickup();
      g.hud.notice('Turbine – stell sie an einem markierten Platz auf', 3000);
    });
  }

  makeTurbineSpots() {
    const g = this.g, map = g.map, self = this;
    const door = map.doors.L;
    const spots = [];
    if (door) {
      // vor der Lagertür (Hallenseite)
      const p = door.center.clone().add(new THREE.Vector3(1.6, 0, 0));
      spots.push({ id: 'door', pos: p, label: 'Lagertor' });
    }
    spots.push({ id: 'mast', pos: new THREE.Vector3(MAST_PAD.x, 0, MAST_PAD.z), label: 'Sender 7' });
    for (const s of spots) {
      this.interactables.push({
        pos: s.pos, radius: 2.0,
        prompt() {
          const t = self.turbine;
          if (t.state === 'carried' && t.carrier === g.me.slot) return `${g.input.verb(false)}, um die Turbine aufzustellen`;
          if (t.state === 'placed' && t.placedAt === s.id) return `${g.input.verb(false)}, um die Turbine aufzunehmen`;
          return null;
        },
        use() {
          const t = self.turbine;
          if (t.state === 'carried' && t.carrier === g.me.slot) self.act('turbPlace', { spot: s.id });
          else if (t.state === 'placed' && t.placedAt === s.id) self.takeTurbine();
        },
        update() {},
        reset() {},
      });
    }
    return spots;
  }

  placeTurbine(spot) {
    const g = this.g, t = this.turbine;
    t.state = 'placed';
    t.placedAt = spot.id;
    t.carrier = -1;
    t.model.visible = true;
    t.model.scale.setScalar(1.35);
    t.model.position.set(spot.pos.x, 0, spot.pos.z);
    t.model.rotation.y = rand(0, Math.PI * 2);
    g.hud.carry(this.carried);
    g.audio.turbineStart(spot.pos);
    if (spot.id === 'door') {
      if (g.net && g.net.isHost && !g.map.doors.L.open) g.net.ev({ t: 'door', id: 'L' });
      if (g.map.openDoor('L')) {
        g.audio.doorOpen(g.map.doors.L.center.clone().setY(2));
        g.hud.notice('Die Turbine treibt das Lagertor an!', 3000);
      }
    } else if (spot.id === 'mast') g.hud.notice('Die Turbine summt am Funkmast …', 3000);
    this.onTurbinePlaced?.(spot.id);
  }

  onTurbineRemoved(id) { this.onTurbineTaken?.(id); }

  // ── Laufzeit ────────────────────────────────────────────────
  update(dt, time) {
    const g = this.g;
    if (g.net && g.net.isHost) {
      for (const s of g.survivors) {
        if (!(s.downed || s.dead || s.left)) continue;
        const has = Object.values(this.parts).some((p) => p.state === 'carried' && p.carrier === s.slot);
        if (has) { this.dropBy(s); this.syncMine(); this.share(); }
        const t = this.turbine;
        if (t.state === 'carried' && t.carrier === s.slot) { t.state = 'bench'; t.carrier = -1; t.model.visible = true; const b = this.benches.turbine; if (b) { t.model.position.copy(b.ghost.position).setY(0.94); t.model.scale.setScalar(0.55); } this.syncMine(); this.share(); }
      }
    }
    const cam = this.g.camera.position;
    for (const id in this.parts) {
      const p = this.parts[id];
      if (p.state !== 'ground') continue;
      p.group.visible = Math.hypot(p.pos.x - cam.x, p.pos.z - cam.z) < 55;
      if (!p.group.visible) continue;
      p.group.position.set(p.pos.x, 0.32 + Math.sin(time * 2 + p.phase) * 0.06, p.pos.z);
      p.model.rotation.y = time * 0.8 + p.phase;
      p.glow.material.opacity = 0.4 + Math.sin(time * 3 + p.phase) * 0.15;
    }
    this.ghostMat.opacity = 0.14 + Math.sin(time * 2.2) * 0.05;
    const t = this.turbine;
    if (t.state === 'placed') {
      t.spin += dt * 14;
      t.model.userData.rotor.rotation.z = t.spin;
      this.whirT = (this.whirT || 0) - dt;
      if (this.whirT <= 0 && this.g.player.pos.distanceTo(t.model.position) < 18) { this.whirT = 0.42; this.g.audio.turbineWhir(t.model.position); }
      if (Math.random() < 0.1) this.g.effects.energy(t.model.position.clone().setY(1.6), [0.6, 1.8, 3.2], 1, 0.15);
    } else if (t.state === 'bench') {
      t.model.userData.rotor.rotation.z += dt * 0.6;
    }
  }

  reset() {
    this.carried = null;
    for (const id in this.parts) {
      const p = this.parts[id];
      const [cx, cy] = pick(PART_SPOTS[id]);
      p.state = 'ground'; p.carrier = -1;
      p.pos.set(wx(cx), 0, wx(cy));
      p.group.visible = true;
    }
    for (const bp in this.benches) {
      const b = this.benches[bp];
      b.installed.clear();
      b.done = false; b.t = 0;
      b.ghost.visible = true;
      if (b.shelf) b.shelf.clear();
      if (b.pile) b.pile.clear();
      if (b.solid) { b.solid.removeFromParent(); b.solid = null; }
    }
    const t = this.turbine;
    t.state = 'none'; t.placedAt = null; t.carrier = -1; t.model.visible = false;
  }

  dispose() {}
}

function bar(k) {
  const n = Math.round(Math.min(1, k) * 8);
  return '[' + '■'.repeat(n) + '□'.repeat(8 - n) + ']';
}
