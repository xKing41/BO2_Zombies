// ─────────────────────────────────────────────────────────────
//  Karte "Station Nachtfall": kompakte Station mit 4 Bereichen.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { CELL, WALL_H } from '../config.js';
import { parseRows } from '../world/layout.js';
import { rand } from '../core/utils.js';
import * as P from '../world/props.js';
import * as T from '../core/textures.js';
import { Teddies } from '../game/teddies.js';

// Legende: '#' Wand · '0'-'9' Boden (Zone) · 'A'-'Z' kaufbare Tür · 'w' Fenster · 's' Spawn draußen · ' ' Außenbereich
const ROWS = [
  '    s    s      s   s    ', // 0
  ' ###w####w######w###w### ', // 1
  ' #0000000000#1111111111# ', // 2
  ' #0000000000#1111111111# ', // 3
  ' #0000000000#1111111111# ', // 4
  ' #0000000000A1111111111# ', // 5
  'sw0000000000A1111111111ws', // 6
  ' #0000000000#1111111111# ', // 7
  ' #0000000000#1111111111# ', // 8
  ' #0000000000#1111111111# ', // 9
  ' #####BB#########CC##### ', // 10
  ' #2222222222#3333333333# ', // 11
  ' #2222222222#3333333333# ', // 12
  'sw2222222222#3333333333ws', // 13
  ' #2222222222D3333333333# ', // 14
  ' #2222222222D3333333333# ', // 15
  ' #2222222222#3333333333# ', // 16
  'sw2222222222#3333333333ws', // 17
  ' #2222222222#3333333333# ', // 18
  ' ####w###w######w###w### ', // 19
  '     s   s      s   s    ', // 20
];

export default {
  id: 'nachtfall',
  name: 'Station Nachtfall',
  tagline: 'Kompakt · eng · klassisch',
  intro: ['Station Nachtfall', 'Güterbahnhof bei Brennsdorf', '13. November – 2:47 Uhr'],
  description: 'Eine verlassene Station mit Depot-Halle, Diner, Werkstatt und Innenhof. Vier Bereiche, ein Stromschalter, die Äther-Schmiede im Innenhof.',
  layout: () => parseRows(ROWS),
  zones: [
    { name: 'Depot-Halle', ceiling: true, floor: 'concrete', open: true, beams: true },
    { name: 'Diner', ceiling: true, floor: 'tiles', beams: true },
    { name: 'Werkstatt', ceiling: true, floor: 'dirty', beams: 'rust', pipes: true },
    { name: 'Innenhof', ceiling: false, floor: 'cobble' },
  ],
  doors: {
    A: { cost: 750, zones: [0, 1], label: 'Diner' },
    B: { cost: 750, zones: [0, 2], label: 'Werkstatt' },
    C: { cost: 1000, zones: [1, 3], label: 'Innenhof' },
    D: { cost: 1000, zones: [2, 3], label: 'Innenhof' },
  },
  spawnMode: 'windows',
  playerStart: { cx: 6, cy: 6, yaw: -Math.PI * 0.5 }, // Blick nach Osten (Tür zum Diner)
  // Richtungen: N = -z, S = +z, W = -x, E = +x (zeigt zur Wand)
  boxSpots: [
    { cx: 10, cy: 2, wall: 'N' },
    { cx: 13, cy: 9, wall: 'S' },
    { cx: 2, cy: 15, wall: 'W' },
    { cx: 13, cy: 18, wall: 'S' },
  ],
  boxStart: 0,
  perkSpots: {
    phoenix: { cx: 2, cy: 3, wall: 'W' },
    titan: { cx: 22, cy: 3, wall: 'E' },
    blitz: { cx: 11, cy: 18, wall: 'S' },
    doppel: { cx: 13, cy: 11, wall: 'W' },
    sprint: { cx: 22, cy: 11, wall: 'E' },
  },
  wallbuys: [
    { weapon: 'k14', cx: 6, cy: 2, wall: 'N' },
    { weapon: 'dlf', cx: 2, cy: 8, wall: 'W' },
    { weapon: 'vmp', cx: 18, cy: 2, wall: 'N' },
    { weapon: 'grenade', cx: 22, cy: 8, wall: 'E' },
    { weapon: 'pump', cx: 7, cy: 18, wall: 'S' },
  ],
  powerSwitch: { cx: 3, cy: 11, wall: 'N' },
  papSpot: { cx: 17, cy: 14 },
  env: { fogDensity: 0.032, ash: 1 },
  // Drei versteckte Teddys starten das geheime Lied (Kistenstapel, Theke, Generator)
  setup: (game) => [new Teddies(game, [
    { x: 23.25, y: 2.0, z: 18.85, yaw: -2.25 },
    { x: 30.5, y: 1.06, z: 8.8, yaw: 0.3 },
    { x: 15.36, y: 1.0, z: 30.77, yaw: 2.6 },
  ])],

  menuCamera(cam, t) {
    const a = t * 0.05;
    cam.position.set(13 + Math.sin(a) * 3, 1.8, 13 + Math.cos(a) * 3);
    cam.rotation.set(-0.05, a * 0.8 - 1.2, 0, 'YXZ');
  },

  buildDecor(m, scene, M) {
    const solid = (obj, cx, cy, wall, depth, block = true, ox = 0, oz = 0) => {
      m.place(obj, cx, cy, wall, depth, ox, oz);
      obj.updateMatrixWorld(true);
      if (block) m.blockCell(cx, cy, m.aabb(obj, 0.02));
      else m.colliders.push(m.aabb(obj, 0.02));
      return obj;
    };

    // Außengelände
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), M.ground);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((m.w * CELL) / 2, -0.01, (m.h * CELL) / 2);
    ground.receiveShadow = true;
    scene.add(ground);

    // Zone 0 – Depot-Halle
    const cr = new THREE.Group();
    cr.add(P.crate(M, 1.1));
    const b = P.crate(M, 0.9); b.position.set(0.05, 1.1, 0.05); b.rotation.y = 0.3; cr.add(b);
    const c2 = P.crate(M, 0.8); c2.position.set(-0.2, 0, 1.0); c2.rotation.y = -0.2; cr.add(c2);
    solid(cr, 11, 9, null, 0, true, 0.2, -0.2);
    const bar = new THREE.Group();
    [[0, 0], [0.62, 0.1], [0.25, 0.55]].forEach(([x, z]) => { const br = P.barrel(M); br.position.set(x, 0, z); bar.add(br); });
    solid(bar, 2, 9, null, 0, true, -0.3, 0.2);
    const t0 = P.table(M); t0.rotation.y = 0.4; solid(t0, 7, 4, null, 0, false);
    m.place(P.chair(M), 7, 4, null, 0, 0.9, 0.5);
    m.place(P.chair(M, true), 6, 4, null, 0, 0.3, -0.4);
    solid(P.shelf(M), 11, 5, 'E', 0.5, false);

    // Zone 1 – Diner
    solid(P.counter(M, 5.0), 16, 4, null, 0, false, -0.5, -0.2);
    m.blockCell(15, 4); m.blockCell(16, 4); m.blockCell(17, 4);
    solid(P.booth(M), 20, 5, null, 0, true);
    solid(P.booth(M), 20, 8, null, 0, true);
    const neon = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.75), new THREE.MeshBasicMaterial({ map: T.textSign('DINER', '#ff2f6a', '#000', 512, 160), transparent: true, blending: THREE.AdditiveBlending, color: new THREE.Color(2.2, 2.2, 2.2) }));
    neon.position.y = 3.0; m.place(neon, 14, 2, 'N', 0.02);
    m.neon = neon;

    // Zone 2 – Werkstatt
    solid(P.workbench(M), 10, 11, 'N', 0.8, true);
    const gen = P.generator(M); gen.rotation.y = 0.2; solid(gen, 7, 15, null, 0, true);
    const bar2 = new THREE.Group();
    [[0, 0], [0.65, 0], [0.3, 0.6]].forEach(([x, z]) => { const br = P.barrel(M, M.paintRed); br.position.set(x, 0, z); bar2.add(br); });
    solid(bar2, 2, 18, null, 0, true, -0.2, 0.2);
    solid(P.shelf(M), 11, 14, 'E', 0.5, false);

    // Zone 3 – Innenhof
    const tr = P.tree(M, 7); solid(tr, 20, 15, null, 0, true);
    m.colliders[m.colliders.length - 1] = { minX: tr.position.x - 0.3, maxX: tr.position.x + 0.3, minZ: tr.position.z - 0.3, maxZ: tr.position.z + 0.3 };
    const fb = P.fireBarrel(M); solid(fb, 14, 16, null, 0, false, -0.3, 0.3);
    m.fireBarrelPos = fb.position.clone();
    const flame = fb.position.clone().setY(0.9); flame.flame = true;
    m.emberSources.push(flame);
    const lp = P.lampPost(M); m.place(lp, 21, 12, null, 0, 0.6, -0.6);
    m.colliders.push({ minX: lp.position.x - 0.12, maxX: lp.position.x + 0.12, minZ: lp.position.z - 0.12, maxZ: lp.position.z + 0.12 });

    // Poster und Blut an Wänden/Böden
    const posters = [['VERMISST', 3, 2, 'N', 0.9], ['QUARANTÄNE', 9, 9, 'S', 0], ['GESCHLOSSEN', 22, 5, 'E', 0], ['WARNUNG', 3, 18, 'S', 0.3]];
    posters.forEach(([title, cx, cy, w, ox], i) => {
      const pm = P.wallPoster(M, T.poster(100 + i, title));
      pm.position.y = 1.9;
      m.place(pm, cx, cy, w, 0.0, w === 'N' || w === 'S' ? ox : 0, 0);
      pm.rotation.z = rand(-0.06, 0.06);
    });
    const bloodMats = M.tex.blood.map((t) => new THREE.MeshStandardMaterial({ map: t, transparent: true, depthWrite: false, roughness: 0.3, polygonOffset: true, polygonOffsetFactor: -2 }));
    const fc = m.cells.filter((c) => c.type === 'floor');
    for (let i = 0; i < 16; i++) {
      const c = fc[Math.floor(Math.random() * fc.length)];
      const d = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bloodMats[i % 3]);
      d.rotation.set(-Math.PI / 2, 0, rand(0, 6.28));
      const s = rand(0.6, 1.8); d.scale.set(s, s, 1);
      d.position.set(c.x * CELL + rand(0.3, 1.7), 0.006 + i * 0.0003, c.y * CELL + rand(0.3, 1.7));
      d.receiveShadow = true;
      scene.add(d);
    }

    // Außen: tote Bäume, Autowracks, Zaunpfähle
    const W = m.w * CELL, H = m.h * CELL;
    for (let i = 0; i < 26; i++) {
      const side = i % 4;
      let x, z;
      const along = rand(-10, (side < 2 ? W : H) + 10);
      const dist = rand(14, 40);
      if (side === 0) { x = along; z = -dist; } else if (side === 1) { x = along; z = H + dist; }
      else if (side === 2) { x = -dist; z = along; } else { x = W + dist; z = along; }
      const t = P.tree(M);
      t.position.set(x, 0, z); t.rotation.y = rand(0, 6);
      scene.add(t);
    }
    const car = P.carWreck(M); car.position.set(-9, 0, 30); car.rotation.y = 1.1; scene.add(car);
    const car2 = P.carWreck(M); car2.position.set(W + 10, 0, 8); car2.rotation.y = -0.4; scene.add(car2);
    for (let x = -14; x < W + 14; x += 3.2) for (const z of [-15, H + 15]) {
      if (Math.random() < 0.25) continue;
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, rand(1.0, 1.5), 0.12), M.woodDark);
      p.position.set(x + rand(-0.3, 0.3), 0.6, z); p.rotation.z = rand(-0.2, 0.2); p.castShadow = true;
      scene.add(p);
    }
  },

  buildLights(m, scene, M) {
    const lamp = (cx, cy, opts = {}) => {
      const p = m.center(cx, cy);
      const lg = P.hangingLamp(M);
      lg.position.set(p.x + (opts.ox || 0), WALL_H, p.z + (opts.oz || 0));
      scene.add(lg);
      const sl = new THREE.SpotLight(opts.color || 0xffc98a, opts.intensity || 38, 16, 1.05, 0.65, 1.7);
      sl.position.set(lg.position.x, WALL_H - 0.92, lg.position.z);
      sl.target.position.set(lg.position.x, 0, lg.position.z);
      sl.castShadow = !!opts.shadowTier;
      if (opts.shadowTier) {
        sl.userData.shadowTier = opts.shadowTier;
        sl.shadow.mapSize.set(1024, 1024); sl.shadow.bias = -0.0004; sl.shadow.normalBias = 0.03; sl.shadow.camera.near = 0.3;
      }
      scene.add(sl, sl.target);
      const e = m.addLight(sl, { flicker: opts.flicker || 0, offFactor: opts.offFactor ?? 0.3, tier: opts.tier || 1 });
      e.bulb = lg.userData.bulb;
      return e;
    };
    lamp(5, 4, { shadowTier: 2, offFactor: 0.75 });
    lamp(9, 7, { flicker: 0.6, offFactor: 0.6, tier: 2 });
    lamp(16, 6, { shadowTier: 2, color: 0xffd9b0, offFactor: 0.25 });
    lamp(20, 3, { flicker: 0.3, offFactor: 0.25, tier: 2 });
    lamp(6, 14, { shadowTier: 3, color: 0xfff1d6, offFactor: 0.2 });
    lamp(10, 16, { flicker: 0.8, offFactor: 0.2, tier: 2 });

    const point = (x, y, z, color, intensity, dist, opts) => {
      const l = new THREE.PointLight(color, intensity, dist, 1.8);
      l.position.set(x, y, z);
      scene.add(l);
      return m.addLight(l, opts);
    };
    const n = m.center(14, 2);
    point(n.x, 2.9, n.z + 0.8, 0xff2f6a, 7, 9, { flicker: 0.15, offFactor: 1, tier: 2 });
    const f = m.fireBarrelPos;
    point(f.x, 1.4, f.z, 0xff7a2a, 14, 14, { flicker: 1.0, offFactor: 1 });
    const lp = m.center(21, 12);
    point(lp.x + 1.2, 3.7, lp.z - 0.6, 0xffd6a0, 10, 14, { offFactor: 0, poweredOnly: true, tier: 2 });
    const w = m.center(3, 12);
    point(w.x, 2.8, w.z, 0xff2010, 3.5, 8, { flicker: 0.0, offFactor: 1, tier: 3 }); // Notlicht Werkstatt
  },

  update(m, dt, time) {
    if (m.neon) m.neon.material.opacity = 0.75 + Math.sin(time * 30) * 0.05 + (Math.random() < 0.01 ? -0.6 : 0);
  },
};
