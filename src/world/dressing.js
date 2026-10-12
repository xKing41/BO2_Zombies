// ─────────────────────────────────────────────────────────────
//  Einrichtung: füllt Räume und Außenbereiche mit Kleinkram aus den
//  CC0-Modellen – Kartons, Müllsäcke, Fässer, Kanister, Reifen, Werkzeug,
//  Feuerlöscher, Uhren, Wandkästen, Unkraut … – passend zum Raum (Thema
//  je Zone). Dazu Abziehbilder (Ölflecken, Schmutz, Papier, Laub, Risse),
//  weiche Kontaktschatten unter allen Requisiten und Graffiti außen.
//
//  Regeln: nur an Wänden (Mitte bleibt frei), nie vor Fenstern, Türen,
//  Wandwaffen, Perks, Kisten, Schaltern und Quest-Orten, nie in
//  einzelligen Gängen, nie auf der Fahrbahn. Alles ist mit festem Seed
//  ausgewürfelt: Im Koop sehen alle dieselbe Welt, und feste Dinge
//  (mit Kollision) hängen nicht von der Grafikstufe ab – nur Unkraut,
//  Kleinkram und Abziehbilder werden auf schwächeren Stufen ausgedünnt.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { CELL, WALL_H } from '../config.js';
import { mulberry32 } from '../core/noise.js';
import { model, hasModel, worldBox } from '../core/modellib.js';
import { DecalBatch, decalMaterial, graffitiMaterial, DECAL, GRAFFITI_COUNT } from './decals.js';
import * as P from './props.js';
import * as T from '../core/textures.js';

const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]]; // N S W E
const WALLDIR = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] };

// ── Gruppen an der Wand ──────────────────────────────────────
// Einträge: s Modell, h Höhe (m), a Versatz entlang der Wand (m), o zusätzlicher Abstand
// zur Wand, r Drehung, p Teile (RegExp), y Höhe über Boden, lie umgelegt, small = Kleinkram
const G = {
  trash: [{ s: 'trashBag', h: 0.55, small: 1 }, { s: 'trashBag', h: 0.42, a: 0.5, r: 1.3, small: 1 }, { s: 'cardboard', h: 0.28, a: -0.5, r: 0.4, lie: 1 }],
  trash2: [{ s: 'trashBag', h: 0.5, small: 1 }, { s: 'canRusted', h: 0.14, a: 0.42, o: 0.15, small: 1, lie: 1 }],
  boxes: [{ s: 'cardboard', h: 0.34 }, { s: 'cardboard', h: 0.3, a: 0.48, r: 0.25 }, { s: 'cardboard', h: 0.26, a: 0.06, y: 0.34, r: -0.3, small: 1 }],
  boxes2: [{ s: 'cardboard', h: 0.3, r: 0.6 }, { s: 'cardboard', h: 0.22, a: -0.4, o: 0.25, lie: 1, small: 1 }],
  drums: [{ s: 'drumBlue', h: 0.9 }, { s: 'drumRust', h: 0.88, a: 0.66 }],
  drumsRed: [{ s: 'drumRed', h: 0.9 }, { s: 'drumRed', h: 0.9, a: 0.64, r: 1.1 }, { s: 'jerrycan', h: 0.45, a: -0.55, small: 1 }],
  drumPlastic: [{ s: 'drumPlastic', h: 0.88 }, { s: 'cardboard', h: 0.28, a: 0.52 }],
  crates: [{ s: 'crateRifle', r: Math.PI / 2 }, { s: 'crateRifle', y: 0.46, r: Math.PI / 2 + 0.08 }],
  crateMil: [{ s: 'crateMilitary', p: /_b$|_b_|crate_b/ }],
  crateWood: [{ s: 'crateWood', r: Math.PI / 2 }, { s: 'cardboard', h: 0.3, a: 0.75, r: 0.3 }],
  cans: [{ s: 'jerrycan', h: 0.45 }, { s: 'jerrycan', h: 0.45, a: 0.4, r: 0.2 }, { s: 'jerrycanPlastic', h: 0.32, a: -0.4, small: 1 }],
  propane: [{ s: 'propane', h: 0.55 }, { s: 'propane', h: 0.55, a: 0.38, r: 1 }],
  tyres: [{ s: 'tyre', lie: 1, rx: Math.PI / 2 }, { s: 'tyre', lie: 1, rx: Math.PI / 2, y: 0.17, r: 0.3 }, { s: 'wheelRim', a: 0.7, o: 0.1, small: 1, lean: 1 }],
  tyreLean: [{ s: 'tyre', lean: 1 }, { s: 'tyre', lean: 1, a: 0.25, r: 0.1 }],
  cement: [{ s: 'cementBag', r: Math.PI / 2 }, { s: 'cementBag', y: 0.18, r: Math.PI / 2 + 0.2 }, { s: 'cementBag', a: 0.75, r: Math.PI / 2 - 0.1 }],
  ladder: [{ s: 'ladder', h: 1.6, lean: 1 }],
  handTruck: [{ s: 'handTruck', h: 1.3, lean: 1 }, { s: 'cardboard', h: 0.3, a: 0.6 }],
  broom: [{ s: 'broom', h: 1.25, lean: 1, small: 1 }],
  wetSign: [{ s: 'wetSign', o: 0.3, small: 1, r: 0.6 }],
  extinguisher: [{ s: 'extinguisher', h: 0.62, small: 1 }],
  toolChest: [{ s: 'toolChest' }, { s: 'jerrycan', h: 0.45, a: 0.62, small: 1 }],
  toolCart: [{ s: 'toolCart', h: 0.95 }],
  compressor: [{ s: 'compressor', r: Math.PI / 2 }],
  generator: [{ s: 'generator', h: 0.6 }, { s: 'jerrycan', h: 0.45, a: 0.65, small: 1 }],
  medic: [{ s: 'medBox', small: 1, o: 0.05 }, { s: 'gasMask', h: 0.25, a: 0.35, lie: 1, small: 1 }],
  bottles: [{ s: 'bottles', p: /bordeaux/, h: 0.3, small: 1 }, { s: 'bottles', p: /burgundy/, h: 0.3, a: 0.12, small: 1, lie: 1 }, { s: 'canRusted', h: 0.13, a: -0.2, small: 1 }],
  chairDown: [{ s: 'chairSchool', h: 0.92, lie: 1, rx: -Math.PI / 2 + 0.1, o: 0.2 }],
  chairWoodDown: [{ s: 'chairWood', h: 0.95, lie: 1, rz: Math.PI / 2, o: 0.2 }],
  chairPlastic: [{ s: 'chairPlastic', r: 0.5, o: 0.1 }],
  tv: [{ s: 'tv', h: 0.42, r: 0.3 }, { s: 'radio', h: 0.24, a: 0.55, small: 1 }],
  microwave: [{ s: 'microwave', h: 0.36, r: -0.2 }, { s: 'cardboard', h: 0.28, a: 0.7 }],
  bookshelf: [{ s: 'bookshelf', h: 1.9, solid: 1 }],
  rack: [{ s: 'rackMetal', h: 1.9, solid: 1 }],
  shelfFull: [{ fn: 'shelf', solid: 1 }],
  shelfBoxes: [{ fn: 'shelf', solid: 1 }, { s: 'cardboard', h: 0.32, a: 1.05, r: 0.2 }, { s: 'cardboard', h: 0.26, a: 1.05, y: 0.32, r: -0.3, small: 1 }],
  desk: [{ s: 'deskMetal', h: 0.78, solid: 1 }],
  utility: [{ s: 'utilityBox', h: 1.1, p: /./ }],
  trashCan: [{ s: 'trashCan', p: /^metal_trash_can(_handle_left|_handle_right|_lid)?$/ }],
  trashCanRust: [{ s: 'trashCan', p: /rust(?!_lid)/ }, { s: 'trashCan', p: /rust_lid/, a: 0.55, o: 0.15, small: 1 }],
  logs: [{ s: 'logDead', h: 0.28, r: 0, o: 0.1 }],
  branches: [{ s: 'branches', small: 1, s2: 1.2 }],
  weeds: [{ s: 'weeds', p: /_a_/, small: 1, weed: 1, sc: 3.2 }, { s: 'weeds', p: /_c_/, a: 0.5, small: 1, weed: 1, sc: 3.5 }],
  weeds2: [{ s: 'nettle', p: /tall_a/, small: 1, weed: 1, sc: 2.6 }, { s: 'nettle', p: /medium_b/, a: 0.35, small: 1, weed: 1, sc: 2.8 }],
  grass: [{ s: 'grassTuft', p: /./, small: 1, weed: 1, pick: 1, sc: 1.2 }],
  rocks: [{ s: 'rocks', p: /rock0[1-6]$/, pick: 1, h: 0.35 }],
};

// Streukram in der Raummitte (ohne Kollision): wie Gruppen-Einträge
const S = {
  can: { s: 'canRusted', h: 0.13, lie: 1, small: 1 },
  tin: { s: 'foodCans', p: /can_cond|can_fish/, pick: 1, h: 0.045, small: 1 },
  bottle: { s: 'bottles', p: /bordeaux|burgundy|alsace/, pick: 1, h: 0.3, lie: 1, small: 1 },
  box: { s: 'cardboard', h: 0.24, lie: 1, small: 1 },
  spray: { s: 'sprayCans', pick: 1, h: 0.22, lie: 1, small: 1 },
  bag: { s: 'trashBag', h: 0.38, small: 1 },
  oil: { s: 'oilCan', h: 0.2, lie: 1, small: 1 },
  mask: { s: 'gasMask', h: 0.22, lie: 1, small: 1 },
  branch: { s: 'branches', pick: 1, small: 1 },
  weed: { s: 'weeds', pick: 1, sc: 3.0, weed: 1, small: 1 },
  grass: { s: 'grassTuft', pick: 1, weed: 1, sc: 1.1, small: 1 },
  rock: { s: 'rocks', pick: 1, h: 0.22, small: 1 },
};
const POSTERS = ['VERMISST', 'QUARANTÄNE', 'EVAKUIERUNG', 'AUSGANGSSPERRE', 'WARNUNG', 'GESCHLOSSEN', 'BLUTSPENDE', 'NOTRUF 112', 'ZUTRITT VERBOTEN', 'SAMMELSTELLE'];

// Wandhalterungen: s Modell, h Höhe des Modells, y Montagehöhe (Unterkante)
const MOUNT = {
  fireAlarm: { s: 'fireAlarm', h: 0.16, y: 1.35 },
  powerBox: { s: 'powerBox', h: 0.55, y: 1.25 },
  clock: { s: 'wallClock', h: 0.34, y: 2.35 },
  camera: { s: 'securityCam', h: 0.3, y: 3.1 },
  lamp: { s: 'lampWall', h: 0.42, y: 2.4 },
  aircon: { s: 'aircon', p: /^exterior_aircon_unit$/, h: 0.85, y: 0.2 },
  airconRust: { s: 'aircon', p: /rusted/, h: 0.85, y: 2.6 },
  secLight: { s: 'securityLight', h: 0.45, y: 3.0 },
};

// Themen: wall = [Gruppe, Gewicht], mount = [Halterung, Wahrscheinlichkeit je Wandzelle],
// decals = [Feld, Dichte je Zelle], wallP = Anteil der Wandzellen mit Gruppe
const THEMES = {
  depot: { wallP: 0.6, wall: [['shelfBoxes', 2], ['trash', 3], ['boxes', 3], ['boxes2', 2], ['drums', 2], ['crateMil', 1], ['cement', 1], ['ladder', 1], ['handTruck', 1], ['broom', 1], ['wetSign', 1], ['extinguisher', 1], ['trashCan', 1], ['cans', 1]],
    mount: [['fireAlarm', 0.05], ['clock', 0.03], ['powerBox', 0.03], ['camera', 0.02]], decals: [['dirt', 0.35], ['paper', 0.12], ['news', 0.04], ['oil', 0.05], ['crack', 0.06], ['ring', 0.04]] , pipes: 0.35, posters: 0.05, scatter: [['can', 0.04], ['box', 0.03], ['bottle', 0.02], ['tin', 0.02]] },
  storage: { wallP: 0.75, wall: [['shelfFull', 3], ['boxes', 3], ['boxes2', 2], ['crates', 2], ['crateWood', 1], ['crateMil', 1], ['drums', 2], ['drumPlastic', 1], ['cement', 2], ['rack', 2], ['handTruck', 1], ['cans', 1], ['ladder', 1]],
    mount: [['powerBox', 0.04], ['lamp', 0.03]], decals: [['dirt', 0.45], ['oil', 0.06], ['crack', 0.08], ['paper', 0.05]] , pipes: 0.3, scatter: [['box', 0.06], ['can', 0.03]] },
  diner: { wallP: 0.42, wall: [['shelfFull', 1], ['trash', 2], ['trash2', 2], ['boxes2', 1], ['chairDown', 2], ['wetSign', 1], ['bottles', 2], ['microwave', 1], ['extinguisher', 1], ['broom', 1]],
    mount: [['clock', 0.05], ['fireAlarm', 0.04]], decals: [['dirt', 0.2], ['paper', 0.1], ['ring', 0.08], ['news', 0.03]] , posters: 0.04, scatter: [['can', 0.03], ['bottle', 0.03], ['tin', 0.03]] },
  workshop: { wallP: 0.7, wall: [['shelfFull', 2], ['tyres', 3], ['tyreLean', 2], ['drums', 2], ['drumsRed', 1], ['cans', 2], ['toolChest', 2], ['toolCart', 1], ['compressor', 1], ['generator', 1], ['propane', 1], ['ladder', 1], ['boxes2', 1], ['extinguisher', 1], ['trash', 1]],
    mount: [['powerBox', 0.06], ['lamp', 0.04], ['fireAlarm', 0.03]], decals: [['oil', 0.22], ['dirt', 0.4], ['crack', 0.06], ['ring', 0.03]] , pipes: 0.5, pipeMat: 'rust', posters: 0.03, scatter: [['oil', 0.04], ['can', 0.04], ['spray', 0.03], ['box', 0.02]] },
  barn: { wallP: 0.55, wall: [['crateWood', 2], ['drums', 1], ['tyreLean', 1], ['logs', 2], ['branches', 1], ['ladder', 1], ['trash', 1], ['cans', 1], ['boxes2', 1]],
    mount: [['lamp', 0.03]], decals: [['dirt', 0.45], ['leaves1', 0.12], ['leaves2', 0.1]] , scatter: [['branch', 0.04], ['bottle', 0.02]] },
  house: { wallP: 0.55, wall: [['chairWoodDown', 2], ['bookshelf', 2], ['tv', 1], ['boxes2', 2], ['trash2', 1], ['bottles', 1], ['medic', 1]],
    mount: [['clock', 0.05]], decals: [['dirt', 0.25], ['paper', 0.1], ['ring', 0.05], ['leaves2', 0.04]] , posters: 0.03, scatter: [['bottle', 0.03], ['can', 0.02], ['box', 0.02]] },
  power: { wallP: 0.55, wall: [['shelfFull', 1], ['rack', 2], ['crateMil', 2], ['crates', 1], ['toolCart', 1], ['propane', 1], ['drums', 2], ['cans', 1], ['extinguisher', 1], ['compressor', 1], ['boxes', 1]],
    mount: [['powerBox', 0.07], ['fireAlarm', 0.04], ['camera', 0.02], ['lamp', 0.03]], decals: [['oil', 0.1], ['dirt', 0.3], ['crack', 0.05]] , pipes: 0.6, scatter: [['can', 0.02], ['mask', 0.02], ['oil', 0.02]] },
  lab: { wallP: 0.5, wall: [['medic', 2], ['boxes2', 2], ['rack', 1], ['desk', 1], ['chairDown', 1], ['extinguisher', 1]],
    mount: [['fireAlarm', 0.05], ['clock', 0.03], ['camera', 0.03]], decals: [['paper', 0.15], ['ring', 0.06], ['dirt', 0.15]] , pipes: 0.3, posters: 0.04, scatter: [['mask', 0.03], ['box', 0.02]] },
  bar: { wallP: 0.5, wall: [['bottles', 3], ['chairDown', 2], ['trash2', 2], ['boxes2', 1], ['drumPlastic', 1], ['tv', 1]],
    mount: [['clock', 0.04]], decals: [['ring', 0.12], ['dirt', 0.25], ['paper', 0.06]] , posters: 0.05, scatter: [['bottle', 0.08], ['can', 0.03]] },
  bank: { wallP: 0.45, wall: [['chairDown', 2], ['boxes', 2], ['desk', 1], ['trash2', 1], ['medic', 1], ['wetSign', 1]],
    mount: [['clock', 0.05], ['camera', 0.04], ['fireAlarm', 0.04]], decals: [['paper', 0.3], ['news', 0.08], ['dirt', 0.2]] , posters: 0.04, scatter: [['box', 0.02]] },
  store: { wallP: 0.55, wall: [['shelfFull', 2], ['boxes', 3], ['boxes2', 3], ['trash', 2], ['bottles', 2], ['drumPlastic', 1], ['handTruck', 1], ['wetSign', 1]],
    mount: [['camera', 0.04], ['fireAlarm', 0.03]], decals: [['paper', 0.18], ['news', 0.06], ['ring', 0.06], ['dirt', 0.25]] , posters: 0.04, scatter: [['tin', 0.06], ['can', 0.04], ['bottle', 0.03], ['box', 0.04], ['spray', 0.02]] },
  hut: { wallP: 0.6, wall: [['logs', 2], ['branches', 2], ['bottles', 2], ['trash2', 1], ['boxes2', 1], ['drums', 1]],
    mount: [], decals: [['leaves1', 0.2], ['leaves2', 0.15], ['dirt', 0.4]] , scatter: [['bottle', 0.05], ['branch', 0.05], ['can', 0.03]] },
  tunnel: { wallP: 0.5, wall: [['drums', 2], ['tyreLean', 2], ['trash', 2], ['trashCanRust', 1], ['cement', 1], ['branches', 1]],
    mount: [['lamp', 0.05]], decals: [['dirt', 0.45], ['crack', 0.12], ['oil', 0.08], ['ring', 0.06], ['leaves2', 0.05]] , pipes: 0.5, pipeMat: 'rust', scatter: [['can', 0.03], ['bag', 0.02], ['bottle', 0.02], ['rock', 0.02]] },
  yard: { wallP: 0.6, wall: [['weeds', 3], ['weeds2', 3], ['grass', 2], ['trashCanRust', 1], ['trashCan', 1], ['trash', 2], ['drums', 1], ['tyreLean', 1], ['boxes2', 1], ['rocks', 1]],
    mount: [['airconRust', 0.04], ['secLight', 0.03], ['aircon', 0.02]], decals: [['leaves1', 0.07], ['leaves2', 0.06], ['dirt', 0.1], ['paper', 0.02], ['crack', 0.03]], graffiti: 0.06 , posters: 0.02, scatter: [['weed', 0.08], ['grass', 0.06], ['can', 0.02], ['rock', 0.02], ['branch', 0.02]] },
};

const DECAL_SETS = {
  dirt: [DECAL.dirt1, DECAL.dirt2, DECAL.dirt3], oil: [DECAL.oil1, DECAL.oil2], paper: [DECAL.paper1, DECAL.paper2, DECAL.paper3],
  news: [DECAL.news], crack: [DECAL.crack1, DECAL.crack2], ring: [DECAL.ring], leaves1: [DECAL.leaves1], leaves2: [DECAL.leaves2], scorch: [DECAL.scorch],
};
const DECAL_SIZE = { dirt: [1.2, 2.4], oil: [0.8, 1.8], paper: [0.22, 0.34], news: [0.45, 0.6], crack: [1.0, 2.2], ring: [0.5, 1.0], leaves1: [0.8, 1.4], leaves2: [0.7, 1.2], scorch: [1.2, 2] };

const _box = new THREE.Box3();
const _v = new THREE.Vector3();

/**
 * Karte einrichten. cfg (aus der Kartendefinition, Feld "dress"):
 *  seed, themes { Zone: Thema }, reserved(m) → [[cx, cy], …], outdoor(cx, cy) → true wenn Außenzelle
 *  dekoriert werden darf (z. B. nur an Stationen, nicht auf der Straße), graffiti (Anzahl außen)
 * q: Grafikstufe (dünnt Kleinkram aus)
 */
export function dressMap(m, scene, cfg = {}, q = {}) {
  const out = { solids: 0, items: 0, decals: 0, blobs: 0, dbg: { cells: 0, reserved: 0, walls: 0, corridor: 0, prob: 0, nomodel: 0, bounds: 0, overlap: 0, groups: 0 } };
  if (!cfg.themes) return out;
  const rnd = mulberry32(cfg.seed ?? 77);
  // Ausdünnen nur für Dinge ohne Kollision (Koop: feste Dinge sind überall gleich)
  const thin = q.texScale >= 1 ? 1 : q.gridLight === false ? 0.35 : 0.6;
  const weedsOk = q.gridLight !== false;
  const decals = new DecalBatch(decalMaterial());
  const graffiti = new DecalBatch(graffitiMaterial(), 2, 4);

  // ── gesperrte Zellen ──
  const reserved = new Set();
  const res = (cx, cy, r = 0) => { for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) reserved.add(m.key(x, y)); };
  const def = m.def;
  // Geräte an der Wand: nur ihre Zelle (daneben darf etwas stehen, davor bleibt die Raummitte frei)
  for (const s of def.boxSpots || []) res(s.cx, s.cy, 0);
  for (const k in def.perkSpots || {}) res(def.perkSpots[k].cx, def.perkSpots[k].cy, 0);
  for (const w of def.wallbuys || []) res(w.cx, w.cy, 0);
  if (def.powerSwitch) res(def.powerSwitch.cx, def.powerSwitch.cy, 0);
  if (def.papSpot) res(def.papSpot.cx, def.papSpot.cy, 1);
  if (def.playerStart) res(def.playerStart.cx, def.playerStart.cy, 1);
  for (const [x, y] of cfg.reserved ? cfg.reserved(m) : []) res(Math.floor(x), Math.floor(y), 1);
  // Fenster und Türen: die Zellen direkt davor und dahinter (Durchgang, Barrikade reparieren)
  for (const c of m.cells) {
    if (c.type === 'window' || c.type === 'door') { res(c.x, c.y, 0); for (const [dx, dy] of DIRS) res(c.x + dx, c.y + dy, 0); }
    if (c.lava) res(c.x, c.y, 0);
  }
  for (const k of m.navBlocked) reserved.add(k);
  // belegte Flächen (vorhandene Kollider + neue Dinge)
  const taken = m.colliders.map((b) => ({ ...b }));
  const overlaps = (b, pad = 0.05) => taken.some((t) => b.minX < t.maxX + pad && b.maxX > t.minX - pad && b.minZ < t.maxZ + pad && b.maxZ > t.minZ - pad);

  const themeOf = (c) => (c && c.type === 'floor' ? cfg.themes[c.zone] : null);
  const isFloor = (x, y) => { const c = m.get(x, y); return c && c.type === 'floor'; };
  const isWall = (x, y) => { const c = m.get(x, y); return c && c.type === 'wall'; };
  const pick = (list) => {
    let t = 0; for (const [, w] of list) t += w;
    let r = rnd() * t;
    for (const [k, w] of list) { r -= w; if (r <= 0) return k; }
    return list[list.length - 1][0];
  };

  // Ein Ding bauen (gedreht, auf dem Boden, noch nicht platziert)
  const build = (e, yaw) => {
    const opts = { parts: e.p, shadow: !e.small };
    if (e.h) opts.h = e.h;
    let obj = e.fn === 'shelf' ? P.shelf(m.M, mulberry32((rnd() * 4294967296) >>> 0)) : model(e.s, opts);
    if (!obj || (e.fn && !obj.userData.model)) return null;
    if (e.pick) {
      // eines der Teile auswählen
      const inner = obj.children[0];
      const kids = inner.children;
      if (kids.length > 1) {
        const keepK = kids[Math.floor(rnd() * kids.length)];
        for (const k of [...kids]) if (k !== keepK) inner.remove(k);
        obj = model(e.s, { ...opts, parts: (nm) => nm === keepK.name });
        if (!obj) return null;
      }
    }
    if (e.sc) obj.scale.setScalar(e.sc);
    let holder = obj;
    if (e.lie || e.rx || e.rz) {
      const g = new THREE.Group();
      obj.rotation.set(e.rx ?? (e.lie && !e.rz ? -Math.PI / 2 : 0), 0, e.rz ?? 0);
      g.add(obj);
      g.updateMatrixWorld(true);
      worldBox(obj, _box);
      obj.position.y -= _box.min.y;
      obj.position.x -= (_box.min.x + _box.max.x) / 2;
      obj.position.z -= (_box.min.z + _box.max.z) / 2;
      holder = g;
    }
    holder.rotation.y = yaw;
    if (e.lean) { holder.rotation.x = 0; holder.rotateX(-0.22); }
    holder.position.set(0, e.y ?? 0, 0);
    return holder;
  };

  // Ein Ding an eine Wand stellen. n = Richtung von der Wand in den Raum, t = entlang der Wand
  const placeItem = (e, wx, wz, n, t, along, extraOut, keep) => {
    const holder = build(e, Math.atan2(n[0], n[1]) + (e.r ?? 0) + (rnd() - 0.5) * 0.5);
    if (!holder) return null;
    holder.updateMatrixWorld(true);
    worldBox(holder, _box);
    const dn = (n[0] !== 0 ? (_box.max.x - _box.min.x) : (_box.max.z - _box.min.z)) / 2;
    const off = dn + 0.03 + (e.o ?? 0) + extraOut;
    holder.position.x = wx + n[0] * off + t[0] * along;
    holder.position.z = wz + n[1] * off + t[1] * along;
    holder.updateMatrixWorld(true);
    worldBox(holder, _box);
    if (_box.min.y < -0.02) holder.position.y -= _box.min.y;
    const b = { minX: _box.min.x, maxX: _box.max.x, minZ: _box.min.z, maxZ: _box.max.z, h: _box.max.y };
    if (!keep(b)) return null;
    return { obj: holder, box: b, small: !!e.small, weed: !!e.weed };
  };

  const add = (r) => {
    // Schatten werfen nur hohe Dinge (Regale, Fässer, Leitern); flaches übernimmt der weiche Bodenschatten
    if (r.box.h < 1.1) r.obj.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    scene.add(r.obj);
    out.items++;
    // weicher Schatten darunter
    if (!r.weed && r.box.h > 0.12) {
      const w = (r.box.maxX - r.box.minX) * 1.35 + 0.15, d = (r.box.maxZ - r.box.minZ) * 1.35 + 0.15;
      decals.add(DECAL.blob, (r.box.minX + r.box.maxX) / 2, 0.012, (r.box.minZ + r.box.maxZ) / 2, w, d, 0);
      out.blobs++;
    }
    // Kollision: alles, was im Weg steht (nicht flach, nicht winzig)
    const fx = r.box.maxX - r.box.minX, fz = r.box.maxZ - r.box.minZ;
    if (!r.small && !r.weed && r.box.h > 0.3 && fx * fz > 0.04) {
      const b = { minX: r.box.minX - 0.02, maxX: r.box.maxX + 0.02, minZ: r.box.minZ - 0.02, maxZ: r.box.maxZ + 0.02 };
      m.colliders.push(b);
      out.solids++;
    }
    taken.push(r.box);
  };

  // Gleichmäßiger Zufall je Wandlinie (Rohre laufen über die ganze Wand)
  const lineRand = (str) => { let h = 2166136261 ^ (cfg.seed ?? 0); for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000; };
  const pipeGeo = [new THREE.CylinderGeometry(0.06, 0.06, CELL, 8), new THREE.CylinderGeometry(0.04, 0.04, CELL, 8)];
  for (const g of pipeGeo) g.rotateZ(Math.PI / 2);
  const bracketGeo = new THREE.BoxGeometry(0.05, 0.08, 0.32);
  // ein Rohrstück vor einer Wand (Wandfläche wx/wz, n = in den Raum)
  const pipeSegment = (wx, wz, n, mat) => {
    const yaw = Math.atan2(n[0], n[1]);
    [[3.28, 0.14, 0], [3.46, 0.27, 1]].forEach(([y, off, k]) => {
      const p = new THREE.Mesh(pipeGeo[k], mat);
      p.position.set(wx + n[0] * off, y, wz + n[1] * off);
      p.rotation.y = yaw;
      p.castShadow = true; p.receiveShadow = true;
      scene.add(p);
    });
    const br = new THREE.Mesh(bracketGeo, m.M.metal);
    br.position.set(wx + n[0] * 0.16, 3.37, wz + n[1] * 0.16);
    br.rotation.y = yaw;
    scene.add(br);
  };
  let posters = 0;

  // ── Wandzellen durchgehen ──
  const cells = m.cells.filter((c) => c.type === 'floor' && cfg.themes[c.zone]);
  for (const c of cells) {
    const theme = THEMES[themeOf(c)];
    if (!theme) continue;
    const outdoor = !m.zones[c.zone]?.ceiling;
    if (outdoor && cfg.outdoor && !cfg.outdoor(c.x, c.y)) continue;
    const key = m.key(c.x, c.y);
    const cxw = c.x * CELL + CELL / 2, czw = c.y * CELL + CELL / 2;
    // Bodenflecken (auch in der Raummitte)
    for (const [kind, dens] of theme.decals || []) {
      if (rnd() > dens) continue;
      // erst alle Würfe, dann ausdünnen: gleich viele Würfe auf allen Grafikstufen
      const skip = rnd() > thin;
      const set = DECAL_SETS[kind], [s0, s1] = DECAL_SIZE[kind];
      const sz = s0 + rnd() * (s1 - s0), cell = set[Math.floor(rnd() * set.length)];
      const dx = (rnd() - 0.5) * 1.4, dy = 0.008 + rnd() * 0.004, dz = (rnd() - 0.5) * 1.4, rot = rnd() * 6.28;
      if (skip) continue;
      decals.add(cell, cxw + dx, dy, czw + dz, sz, sz * (kind === 'paper' ? 1.3 : 1), rot);
      out.decals++;
    }
    out.dbg.cells++;
    // Rohrleitungen unter der Decke entlang ganzer Wände (auch über Fenstern und Türen)
    if (theme.pipes && !outdoor) {
      for (let d = 0; d < 4; d++) {
        const [dx, dy] = DIRS[d];
        const nb = m.get(c.x + dx, c.y + dy);
        if (!nb || nb.type === 'floor' || nb.type === 'solid') continue;
        const line = d < 2 ? `${d}|${c.y}|${c.zone}` : `${d}|${c.x}|${c.zone}`;
        if (lineRand(line) > theme.pipes) continue;
        pipeSegment(cxw + dx * CELL / 2, czw + dy * CELL / 2, [-dx, -dy], theme.pipeMat === 'rust' ? m.M.rust : m.M.metal);
      }
    }
    if (reserved.has(key)) { out.dbg.reserved++; continue; }
    // Streukram in der Raummitte (ohne Kollision)
    for (const [sk, dens] of theme.scatter || []) {
      if (rnd() > dens) continue;
      const e = S[sk];
      const x = c.x * CELL + 0.35 + rnd() * (CELL - 0.7), z = c.y * CELL + 0.35 + rnd() * (CELL - 0.7);
      const keepIt = rnd() <= thin;
      const h = build(e, rnd() * 6.28);
      if (!h) continue;
      h.position.x = x; h.position.z = z;
      h.updateMatrixWorld(true);
      worldBox(h, _box);
      if (_box.min.y < -0.02) h.position.y -= _box.min.y;
      const b = { minX: _box.min.x, maxX: _box.max.x, minZ: _box.min.z, maxZ: _box.max.z, h: _box.max.y };
      if (overlaps(b, 0.05)) continue;
      if (!keepIt || (e.weed && !weedsOk)) { taken.push(b); continue; }
      add({ obj: h, box: b, small: true, weed: !!e.weed });
    }
    for (const [dx, dy] of DIRS) {
      if (!isWall(c.x + dx, c.y + dy)) continue;
      out.dbg.walls++;
      // Gang mit nur einer Zelle Breite: frei lassen
      if (!isFloor(c.x - dx, c.y - dy)) { out.dbg.corridor++; continue; }
      const n = [-dx, -dy], t = [-dy, dx];
      const wx = cxw + dx * CELL / 2, wz = czw + dy * CELL / 2;
      // Wandhalterungen
      for (const [mk, p] of theme.mount || []) {
        if (rnd() > p) continue;
        const M = MOUNT[mk];
        const obj = model(M.s, { h: M.h, parts: M.p, shadow: false });
        if (!obj) continue;
        obj.rotation.y = Math.atan2(n[0], n[1]);
        const along = (rnd() - 0.5) * 1.2;
        obj.updateMatrixWorld(true);
        worldBox(obj, _box);
        const depth = (n[0] !== 0 ? _box.max.x - _box.min.x : _box.max.z - _box.min.z) / 2;
        obj.position.set(wx + n[0] * (depth + 0.01) + t[0] * along, Math.min(M.y, WALL_H - M.h - 0.15), wz + n[1] * (depth + 0.01) + t[1] * along);
        scene.add(obj);
        out.items++;
        break;
      }
      // Plakate
      if (theme.posters && posters < (cfg.posters ?? 8) && rnd() < theme.posters) {
        const title = POSTERS[Math.floor(rnd() * POSTERS.length)];
        const pm = P.wallPoster(m.M, T.poster(9000 + posters * 17 + (cfg.seed ?? 0), title), 0.6, 0.85);
        const along = (rnd() - 0.5) * 1.1;
        pm.position.set(wx + n[0] * 0.012 + t[0] * along, 1.55 + rnd() * 0.35, wz + n[1] * 0.012 + t[1] * along);
        pm.rotation.set(0, Math.atan2(n[0], n[1]), (rnd() - 0.5) * 0.12, 'YXZ');
        scene.add(pm);
        posters++;
      }
      // Graffiti (außen)
      if (theme.graffiti && outdoor && rnd() < theme.graffiti * (cfg.graffiti ?? 1)) {
        const along = (rnd() - 0.5) * 0.4;
        graffiti.add(Math.floor(rnd() * GRAFFITI_COUNT), wx + t[0] * along, 1.25 + rnd() * 0.8, wz + t[1] * along, 2.4, 1.2, (rnd() - 0.5) * 0.08, n, {});
      }
      if (rnd() > theme.wallP) { out.dbg.prob++; continue; }
      const grp = G[pick(theme.wall)];
      const base = (rnd() - 0.5) * 0.5;
      // ganze Gruppe nur, wenn das größte Teil passt
      const parts = [];
      let ok = true;
      for (let i = 0; i < grp.length; i++) {
        const e = grp[i];
        const r = placeItem(e, wx, wz, n, t, base + (e.a ?? 0), 0, (b) => {
          // innerhalb der Zelle bleiben und nichts überdecken
          if (b.minX < c.x * CELL - 0.6 || b.maxX > (c.x + 1) * CELL + 0.6 || b.minZ < c.y * CELL - 0.6 || b.maxZ > (c.y + 1) * CELL + 0.6) { if (i === 0) out.dbg.bounds++; return false; }
          if (e.y) return true; // obenauf gestapelt
          const ov = overlaps(b, 0.02) || parts.some((p) => !p.stack && b.minX < p.box.maxX && b.maxX > p.box.minX && b.minZ < p.box.maxZ && b.maxZ > p.box.minZ);
          if (ov && i === 0) out.dbg.overlap++;
          return !ov;
        });
        if (!r) { if (i === 0) { ok = false; if (!e.fn && !model(e.s)) { out.dbg.nomodel++; (out.dbg.missing ||= []).push(e.s); } break; } continue; }
        r.stack = !!e.y;
        parts.push(r);
      }
      if (!ok || !parts.length) continue;
      out.dbg.groups++;
      for (const r of parts) {
        // Würfel immer ziehen und Platz immer belegen – sonst wiche die Verteilung je Grafikstufe ab
        const drop = (r.small || r.weed) && rnd() > thin;
        if (drop || (r.weed && !weedsOk)) { taken.push(r.box); continue; }
        add(r);
      }
      break; // eine Gruppe je Zelle
    }
  }

  // Rund ums Gebäude (außerhalb der Spielfläche, durch die Fenster zu sehen): Unkraut, Steine,
  // Äste, Reifen, Fässer – ohne Kollision, nicht vor Fenstern und Spawn-Punkten
  if (cfg.ring) {
    const R = cfg.ring, [x0, z0, x1, z1] = R.rect;
    const avoid = m.cells.filter((c) => c.type === 'window' || c.type === 'spawn').map((c) => [c.x * CELL + CELL / 2, c.y * CELL + CELL / 2]);
    for (let i = 0; i < (R.count ?? 80); i++) {
      const side = Math.floor(rnd() * 4), d = 0.4 + rnd() * rnd() * (R.depth ?? 6);
      const along = rnd();
      let x, z, n;
      if (side === 0) { x = x0 + (x1 - x0) * along; z = z0 - d; n = [0, -1]; }
      else if (side === 1) { x = x0 + (x1 - x0) * along; z = z1 + d; n = [0, 1]; }
      else if (side === 2) { x = x0 - d; z = z0 + (z1 - z0) * along; n = [-1, 0]; }
      else { x = x1 + d; z = z0 + (z1 - z0) * along; n = [1, 0]; }
      const e = R.items[Math.floor(rnd() * R.items.length)];
      const keepIt = rnd() <= thin;
      if (avoid.some(([ax, az]) => Math.hypot(ax - x, az - z) < 3.2)) continue;
      const h = build(e, Math.atan2(n[0], n[1]) + rnd() * 6.28);
      if (!h) continue;
      h.position.x = x; h.position.z = z;
      h.updateMatrixWorld(true);
      worldBox(h, _box);
      if (_box.min.y < -0.02) h.position.y -= _box.min.y;
      const bx = { minX: _box.min.x, maxX: _box.max.x, minZ: _box.min.z, maxZ: _box.max.z, h: _box.max.y };
      if (overlaps(bx, 0.1)) continue;
      if (!keepIt || (e.weed && !weedsOk)) { taken.push(bx); continue; }
      add({ obj: h, box: bx, small: true, weed: !!e.weed });
    }
  }

  // weiche Schatten unter den Requisiten der Karte (Fässer, Tische, Regale …)
  scene.traverse((o) => {
    if (!o.userData.model || o.userData.blob === false) return;
    if (o.parent && o.parent !== scene && o.parent.userData.model) return;
    o.updateMatrixWorld(true);
    worldBox(o, _box);
    if (_box.min.y > 0.08 || _box.max.y < 0.15) return;
    if (taken.some((t) => Math.abs(t.minX - _box.min.x) < 1e-3 && Math.abs(t.minZ - _box.min.z) < 1e-3)) return;
    const w = (_box.max.x - _box.min.x) * 1.3 + 0.15, d = (_box.max.z - _box.min.z) * 1.3 + 0.15;
    if (w * d > 30) return;
    decals.add(DECAL.blob, (_box.min.x + _box.max.x) / 2, 0.011, (_box.min.z + _box.max.z) / 2, w, d, 0);
    out.blobs++;
  });

  decals.build(scene, 'decals');
  graffiti.build(scene, 'graffiti');
  out.decals += graffiti.count;
  return out;
}

// Modelle, die die Requisiten (world/props.js) benutzen
export const PROP_SLOTS = ['drumRed', 'drumBlue', 'drumRust', 'tableWood', 'tableRound', 'chairSchool', 'chairWood', 'stoolMetal', 'register',
  'vise', 'toolbox', 'oilCan', 'shelfSteel', 'cardboard', 'foodCans', 'bottles', 'sprayCans', 'jerrycanPlastic', 'canRusted', 'medBox',
  'generator', 'lampHanging', 'coveredCar', 'crateRifle', 'crateWood', 'cementBag'];

/** Alle Modelle, die eine Karte braucht: Requisiten, Einrichtungs-Themen und def.models */
export function mapModelSlots(def) {
  const out = new Set([...PROP_SLOTS, ...(def.models || [])]);
  const themes = new Set(Object.values(def.dress?.themes || {}));
  for (const t of themes) {
    const th = THEMES[t];
    if (!th) continue;
    for (const [g] of th.wall) for (const e of G[g] || []) out.add(e.s);
    for (const [mk] of th.mount || []) if (MOUNT[mk]) out.add(MOUNT[mk].s);
  }
  return [...out];
}

export { hasModel };
