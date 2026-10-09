// ─────────────────────────────────────────────────────────────
//  Karte "Linie 13": Eine nächtliche Busfahrt durch Grauweiler.
//  Fünf Haltestellen an einer Ringstraße, dazwischen Nebel, Felder,
//  ein Tunnel, ein Maisfeld mit Hütte und der Funkmast "Sender 7".
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import * as T from '../core/textures.js';
import { Z, STATIONS, layout, wx, route } from './linie13-data.js';
import { buildDecor, buildLights } from './linie13-decor.js';
import { setupLinie13 } from '../game/linie13.js';

export default {
  id: 'linie13',
  name: 'Linie 13',
  tagline: 'Groß · Bus · Nebel · Geheimnisse',
  intro: ['Linie 13', 'Kreisstraße nach Grauweiler', 'Letzte Fahrt – 23:58 Uhr'],
  description: 'Fahr mit OTTOs Bus durch die neblige Nacht: fünf Haltestellen, Baupläne, eine Geheimwaffe, Glutfelder und ein Funkmast, der ein Signal senden will.',
  layout,
  chunkCells: 24,
  windowSpawn: [3, 5],
  spawnMode: 'mixed',
  outdoorLight: 2.2,
  zones: [
    { name: 'Busbahnhof', ceiling: true, floor: 'concrete', open: true, beams: true },
    { name: 'Lager', ceiling: true, floor: 'dirty' },
    { name: 'Draußen', ceiling: false, floor: 'none', open: true },
    { name: 'Raststätte', ceiling: true, floor: 'tiles', open: true },
    { name: 'Werkstatt', ceiling: true, floor: 'dirty', beams: 'rust' },
    { name: 'Scheune', ceiling: true, floor: 'wood', open: true, beams: true },
    { name: 'Bauernhaus', ceiling: true, floor: 'wood' },
    { name: 'Kraftwerk', ceiling: true, floor: 'metal', open: true, beams: 'rust', pipes: true },
    { name: 'Labor', ceiling: true, floor: 'tiles' },
    { name: 'Bar', ceiling: true, floor: 'wood', beams: true },
    { name: 'Bank', ceiling: true, floor: 'tiles', open: true },
    { name: 'Hütte', ceiling: true, floor: 'wood', open: true, beams: true },
    { name: 'Laden', ceiling: true, floor: 'concrete', open: true },
    { name: 'Tunnel', ceiling: true, floor: 'none', open: true, ceilingMat: 'tunnel' },
  ],
  doors: {
    L: { kind: 'turbine', zones: [Z.STORAGE], label: 'Lager' },
    G: { cost: 750, zones: [Z.GARAGE], label: 'Werkstatt' },
    H: { cost: 750, zones: [Z.HOUSE], label: 'Bauernhaus' },
    P: { kind: 'power', zones: [Z.LAB], label: 'Labor' },
    B: { cost: 1000, zones: [Z.BAR], label: 'Bar' },
  },
  stations: STATIONS,
  playerStart: { cx: 34, cy: 77, yaw: -Math.PI * 0.5 },
  boxSpots: [
    { cx: 32, cy: 69, wall: 'N' },
    { cx: 52, cy: 20, wall: 'S' },
    { cx: 125, cy: 17, wall: 'E' },
    { cx: 153, cy: 60, wall: 'E' },
    { cx: 81, cy: 106, wall: 'E' },
  ],
  boxStart: 0,
  perkSpots: {
    phoenix: { cx: 37, cy: 70, wall: 'E' },
    titan: { cx: 65, cy: 12, wall: 'E' },
    sprint: { cx: 111, cy: 6, wall: 'W' },
    blitz: { cx: 115, cy: 99, wall: 'E' },
    doppel: { cx: 71, cy: 99, wall: 'W' },
  },
  wallbuys: [
    { weapon: 'k14', cx: 36, cy: 69, wall: 'N' },
    { weapon: 'dlf', cx: 31, cy: 72, wall: 'W' },
    { weapon: 'vmp', cx: 60, cy: 11, wall: 'N' },
    { weapon: 'grenade', cx: 51, cy: 18, wall: 'W' },
    { weapon: 'pump', cx: 104, cy: 9, wall: 'N' },
    { weapon: 'ar', cx: 135, cy: 56, wall: 'W' },
    { weapon: 'vmp', cx: 78, cy: 98, wall: 'N' },
    { weapon: 'grenade', cx: 105, cy: 104, wall: 'W' },
    { weapon: 'ar', cx: 24, cy: 70, wall: 'N' },
  ],
  powerSwitch: { cx: 142, cy: 39, wall: 'N', build: true },
  papSpot: { cx: 150, cy: 44, build: true },
  env: {
    background: 0x06080d, fogColor: 0x0c1016, fogDensity: 0.03, hemi: 0.62, moon: 0.95,
    moonFollow: true, shadowBox: 42, far: 190, fogCull: 2.6, minCull: 60, ash: 2,
  },
  lightPool: (q) => ({
    spots: q.lightTier >= 3 ? 4 : q.lightTier >= 2 ? 3 : 2,
    points: q.lightTier >= 3 ? 5 : q.lightTier >= 2 ? 4 : 2,
    range: 70,
  }),

  materials(M) {
    const mk = (tex, opts = {}) => new THREE.MeshStandardMaterial({ map: tex.map, bumpMap: tex.bump, bumpScale: 1.5, roughness: 0.9, ...opts });
    const mats = {
      depot: mk(T.brick(90, [0.5, 0.46, 0.4])),
      diner: mk(T.siding(81, [0.78, 0.76, 0.7], 10)),
      garage: mk(T.corrugated(90, [0.4, 0.42, 0.43], 0.7), { roughness: 0.7, metalness: 0.35 }),
      house: mk(T.siding(82, [0.7, 0.68, 0.6], 14)),
      barn: mk(T.siding(83, [0.42, 0.11, 0.08], 12)),
      hut: mk(T.siding(84, [0.3, 0.24, 0.18], 12)),
      power: mk(T.concretePanels(85), { roughness: 0.85 }),
      tunnel: mk(T.concretePanels(86), { roughness: 0.9 }),
      brick: mk(T.brick(87)),
      brick2: mk(T.brick(88, [0.36, 0.22, 0.16])),
      bank: mk(T.brick(89, [0.5, 0.46, 0.4])),
    };
    for (const k of ['diner', 'house', 'barn', 'hut', 'garage']) mats[k].userData.uvScale = 4;
    return mats;
  },

  buildDecor,
  buildLights,
  setup: setupLinie13,

  // Dichter Nebel zwischen den Stationen, lichter in Gebäuden
  update(m, dt, time, cam) {
    if (!cam || !m.scene.fog) return;
    const c = m.cellAt(cam.x, cam.z);
    const st = m.stationAt(cam.x, cam.z);
    let target = 0.06;
    if (c && m.hasCeiling(c)) target = 0.022;
    else if (st) target = st.id === 'tunnel' ? 0.04 : 0.032;
    target *= m.fogScale ?? 1;
    m.scene.fog.density += (target - m.scene.fog.density) * Math.min(1, dt * 0.8);
    if (m.decorUpdate) m.decorUpdate(dt, time, cam);
  },

  reset(m) {
    m.fogScale = 1;
  },

  // Untergrund für Schrittgeräusche
  surfaceAt(m, p) {
    if (p.y > 0.3) return 'metal';
    const c = m.cellAt(p.x, p.z);
    if (!c || c.type !== 'floor') return 'stone';
    const fl = m.zones[c.zone].floor;
    if (fl === 'none') {
      if (c.zone !== Z.OUT) return 'stone';
      const r = route(), q = r.pointAt(r.nearestS(p.x, p.z));
      return Math.hypot(q.x - p.x, q.z - p.z) < 4.3 ? 'stone' : 'grass';
    }
    return { tiles: 'tiles', wood: 'wood', metal: 'metal', cobble: 'cobble' }[fl] || 'stone';
  },

  menuCamera(cam, t, game) {
    const bus = game.bus;
    if (bus) {
      // Kamera begleitet den Bus schräg von vorne
      const a = bus.yaw + 0.55 + Math.sin(t * 0.07) * 0.35;
      const p = bus.pos;
      cam.position.set(p.x + Math.sin(a) * 14, 4.5, p.z + Math.cos(a) * 14);
      const dx = p.x - cam.position.x, dz = p.z - cam.position.z;
      cam.rotation.set(-0.12, Math.atan2(-dx, -dz), 0, 'YXZ');
    } else {
      cam.position.set(wx(34), 1.8, wx(76));
      cam.rotation.set(0, -Math.PI / 2, 0, 'YXZ');
    }
  },
};
