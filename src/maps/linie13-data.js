// ─────────────────────────────────────────────────────────────
//  Linie 13 – gemeinsame Kartendaten: Raster, Straße, Haltestellen,
//  Stationen und alle Orte für Baupläne, Rätsel und Geheimnisse.
//  Zellkoordinaten: x nach Osten, y nach Süden (Welt: z). 1 Zelle = 2 m.
// ─────────────────────────────────────────────────────────────
import { CELL } from '../config.js';
import { GridBuilder } from '../world/layout.js';
import { LoopPath } from '../world/path.js';
import { mulberry32 } from '../core/noise.js';

export const W = 160, H = 120;
export const Z = { DEPOT: 0, STORAGE: 1, OUT: 2, DINER: 3, GARAGE: 4, BARN: 5, HOUSE: 6, POWER: 7, LAB: 8, BAR: 9, BANK: 10, HUT: 11, STORE: 12, TUNNEL: 13 };

// Zellkoordinate (auch Bruchteile) → Weltkoordinate der Zellmitte
export const wx = (c) => c * CELL + CELL / 2;

// Straßenverlauf in Fahrtrichtung (rechts liegt jeweils die Station):
// Busbahnhof → Altstadt → Kraftwerk → Hof → Raststätte → Tunnel → Busbahnhof
export const ROUTE_CELLS = [
  [44, 76], [44, 86], [46.5, 90.5], [52, 92], [70, 92], [92, 92], [104, 91.5], [112, 88], [120, 81], [126, 72],
  [128, 64], [128, 50], [128, 32], [127, 27.5], [122, 26], [110, 26], [100, 26], [80, 26], [56, 26], [47, 26.5],
  [44.5, 31], [44, 40], [44, 60],
];
export const ROAD_W = 8; // Meter
export const LANE = 1.9; // Bus fährt rechts der Mittellinie

export const STOPS = [
  { id: 'depot', name: 'Busbahnhof Grauweiler', cell: [44, 76] },
  { id: 'town', name: 'Altstadt Grauweiler', cell: [92, 92] },
  { id: 'power', name: 'Kraftwerk Nord', cell: [128, 50] },
  { id: 'farm', name: 'Hof Morgenrot', cell: [110, 26] },
  { id: 'diner', name: 'Raststätte Zur Eule', cell: [60, 26] },
];

let ROUTE = null;
export function route() {
  if (!ROUTE) ROUTE = new LoopPath(ROUTE_CELLS.map(([x, y]) => [wx(x), wx(y)]), 1);
  return ROUTE;
}

// Benannte Bereiche: werden beim Betreten eingeblendet; außerhalb liegt dichter Nebel
export const STATIONS = [
  { id: 'depot', name: 'Busbahnhof Grauweiler', rect: [17, 63, 47, 90] },
  { id: 'tunnel', name: 'Tunnel', rect: [40, 43, 48, 57] },
  { id: 'diner', name: 'Raststätte Zur Eule', rect: [46, 5, 83, 30] },
  { id: 'farm', name: 'Hof Morgenrot', rect: [90, 2, 131, 30] },
  { id: 'hut', name: 'Die Hütte', rect: [98, 42, 110, 52] },
  { id: 'mast', name: 'Sender 7', rect: [57, 51, 75, 69] },
  { id: 'power', name: 'Kraftwerk Nord', rect: [124, 33, 156, 66] },
  { id: 'town', name: 'Altstadt Grauweiler', rect: [63, 88, 120, 114] },
];

export const CORN = [84, 31, 122, 64]; // Maisfeld (Zellen)
export const CORN_CLEAR = [98, 42, 110, 53]; // Lichtung um die Hütte
// Trampelpfade durchs Mais: [x0, y0, x1, y1]
export const CORN_PATHS = [[103.5, 31, 104.5, 43], [109, 46.5, 122, 47.5], [84, 38.5, 99, 39.5]];

// Funkmast "Sender 7" (Mitte zwischen den vier Beinen)
export const MAST = { x: 66 * CELL, z: 60 * CELL, height: 42 };
// Platz für die Turbine am Mast (Hauptquest)
export const MAST_PAD = { x: wx(68.5), z: wx(63) };

export const LAVA_RECTS = [
  [126, 34, 130, 37], // Straße vor dem Kraftwerk
  [131, 56, 133, 60], // neben dem Kraftwerk
  [117, 80, 121, 84], // Kurve Richtung Altstadt
  [82, 94, 86, 96], // Krater am Marktplatz
];

// Haltestellenhäuschen: Zelle, Blickrichtung (Gierwinkel zur Straße)
export const SHELTERS = [
  { stop: 'depot', x: 40.5, y: 70.5, yaw: Math.PI / 2 },
  { stop: 'town', x: 98, y: 95.3, yaw: Math.PI },
  { stop: 'power', x: 131.6, y: 44, yaw: -Math.PI / 2 },
  { stop: 'farm', x: 105, y: 22.7, yaw: 0 },
  { stop: 'diner', x: 66.5, y: 22.7, yaw: 0 },
];

// ── Spielrelevante Orte (Zellen) ─────────────────────────────
// Werkbänke für Baupläne
export const BENCHES = {
  turbine: { x: 35, y: 83, wall: 'S' },
  tesla: { x: 104, y: 45, wall: 'N' },
};

// Mögliche Fundorte der Bauteile (pro Spiel wird je Teil einer ausgewählt)
export const PART_SPOTS = {
  rotor: [[32, 80], [40.5, 83], [24, 66.5]],
  dynamo: [[36, 74], [41, 66], [20, 71]],
  tail: [[31, 83], [45.5, 64], [37, 66]],
  lever: [[64, 19], [74, 18], [52, 13]],
  board: [[138, 60], [151, 58], [136, 41]],
  reel: [[122, 8], [104, 21], [113, 17]],
  gears: [[112, 104], [80, 100], [108, 99]],
  crystal: [[45.5, 50], [70, 57], [62, 56]],
  battery: [[98, 14], [53, 12], [26, 80]],
  capacitor: [[151, 40], [98, 108], [137, 61]],
  coil: [[90, 40], [116, 58], [94, 56]],
  grip: [[104, 15], [68, 20], [115, 104]],
  tube: [[42.5, 46], [64, 56], [90, 108]],
};

// Hauptquest "Das Signal"
export const RADIO = { x: 31, y: 80, wall: 'W' };
export const TAPE_SPOTS = [[63, 14], [113, 15], [140, 58], [102, 48], [96, 106], [114, 104], [46, 53], [72, 106], [99, 10]];
// Musik-Geheimnis: drei Spieluhren
export const MUSIC_BOXES = [[42.4, 44.4], [125, 5], [88, 109]];

// Altstadt: Bank, Schließfach, Jagdmesser
export const BANK = { deposit: { x: 90.5, y: 104 }, withdraw: { x: 95.5, y: 104 }, locker: { x: 97, y: 109, wall: 'S' } };
export const KNIFE_SPOT = { x: 81, y: 101, wall: 'E' };

// Bäume als Hindernisse (Zellen); werden in layout() deterministisch erzeugt
export const TREES = [];

function inRect(x, y, r) { return x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]; }

export function layout() {
  const g = new GridBuilder(W, H, { type: 'floor', zone: Z.OUT });
  // Kartenrand
  g.fill(0, 0, W - 1, 1, { type: 'solid' }); g.fill(0, H - 2, W - 1, H - 1, { type: 'solid' });
  g.fill(0, 0, 1, H - 1, { type: 'solid' }); g.fill(W - 2, 0, W - 1, H - 1, { type: 'solid' });

  // Busbahnhof: Halle (Zone 0) + Lager hinter der Turbinentür (Zone 1)
  g.building({ x0: 22, y0: 68, x1: 38, y1: 84, zone: Z.DEPOT, mat: 'depot',
    openings: [[38, 74], [38, 75], [38, 76], [38, 77]], windows: [[34, 68], [34, 84], [22, 76]] });
  g.wall(30, 69, 30, 83, 'depot');
  g.zone(23, 69, 29, 83, Z.STORAGE);
  g.set(30, 76, { type: 'door', door: 'L', zone: -1, mat: 'depot' });
  g.set(30, 77, { type: 'door', door: 'L', zone: -1, mat: 'depot' });

  // Raststätte + Werkstatt
  g.building({ x0: 50, y0: 10, x1: 66, y1: 21, zone: Z.DINER, mat: 'diner',
    openings: [[57, 21], [58, 21]], windows: [[54, 10], [62, 10], [50, 15]] });
  g.building({ x0: 66, y0: 12, x1: 78, y1: 21, zone: Z.GARAGE, mat: 'garage', windows: [[72, 12]], doors: { G: [[66, 16], [66, 17]] } });
  for (let y = 12; y <= 21; y++) { const c = g.get(66, y); if (c.type === 'wall') c.mat = 'diner'; } // gemeinsame Wand

  // Hof: Bauernhaus + Scheune
  g.building({ x0: 96, y0: 8, x1: 106, y1: 17, zone: Z.HOUSE, mat: 'house', windows: [[101, 8], [96, 12], [106, 12]], doors: { H: [[100, 17], [101, 17]] } });
  g.building({ x0: 110, y0: 4, x1: 126, y1: 19, zone: Z.BARN, mat: 'barn',
    openings: [[116, 19], [117, 19], [118, 19], [119, 19]], windows: [[126, 10], [118, 4]] });

  // Hütte im Maisfeld
  g.building({ x0: 100, y0: 44, x1: 108, y1: 50, zone: Z.HUT, mat: 'hut', openings: [[104, 50]], windows: [[100, 47], [108, 47]] });

  // Kraftwerk mit Labor (Zone 8 hinter der Stromtür)
  g.building({ x0: 134, y0: 38, x1: 154, y1: 62, zone: Z.POWER, mat: 'power',
    openings: [[134, 48], [134, 49], [134, 50], [134, 51]], windows: [[140, 38], [140, 62], [150, 62], [154, 55]] });
  g.wall(145, 39, 145, 48, 'power');
  g.wall(145, 48, 153, 48, 'power');
  g.zone(146, 39, 153, 47, Z.LAB);
  g.set(145, 43, { type: 'door', door: 'P', zone: -1, mat: 'power' });
  g.set(145, 44, { type: 'door', door: 'P', zone: -1, mat: 'power' });

  // Altstadt: Bar, Bank, Laden
  g.building({ x0: 70, y0: 97, x1: 82, y1: 108, zone: Z.BAR, mat: 'brick', windows: [[70, 102], [76, 108]], doors: { B: [[75, 97], [76, 97]] } });
  g.building({ x0: 86, y0: 98, x1: 100, y1: 110, zone: Z.BANK, mat: 'bank', openings: [[92, 98], [93, 98]], windows: [[100, 104]] });
  g.building({ x0: 104, y0: 97, x1: 116, y1: 106, zone: Z.STORE, mat: 'brick2', openings: [[109, 97], [110, 97]], windows: [[116, 101]] });

  // Tunnel auf der Westseite
  g.wall(41, 44, 41, 56, 'tunnel');
  g.wall(47, 44, 47, 56, 'tunnel');
  g.zone(42, 44, 46, 56, Z.TUNNEL);
  g.fill(38, 44, 40, 56, { type: 'solid' }); // Böschung
  g.fill(48, 44, 50, 56, { type: 'solid' });

  // Funkmast (4 Beine auf 2×2 Zellen)
  for (const [x, y] of [[65, 59], [66, 59], [65, 60], [66, 60]]) g.solid(x, y);

  // Glutfelder
  for (const r of LAVA_RECTS) for (let y = r[1]; y <= r[3]; y++) for (let x = r[0]; x <= r[2]; x++) {
    const c = g.get(x, y);
    if (c && c.type === 'floor') c.lava = true;
  }

  // Bäume: Wälder und vereinzelte Bäume abseits von Straße, Gebäuden und Mais
  const rnd = mulberry32(1313);
  const path = route();
  const forests = [
    [3, 3, 18, 116, 0.09], [84, 66, 124, 86, 0.11], [50, 32, 80, 50, 0.025], [132, 66, 156, 116, 0.05],
    [3, 3, 156, 6, 0.06], [3, 112, 156, 116, 0.07], [120, 88, 156, 116, 0.05], [48, 70, 80, 88, 0.03],
    [19, 28, 40, 62, 0.06], [3, 92, 60, 116, 0.06], [140, 6, 156, 34, 0.06],
  ];
  const keepFree = [...Object.values(PART_SPOTS).flat(), ...TAPE_SPOTS, ...MUSIC_BOXES];
  TREES.length = 0;
  const taken = new Set();
  for (const [x0, y0, x1, y1, dens] of forests) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (rnd() > dens) continue;
      const c = g.get(x, y);
      if (!c || c.type !== 'floor' || c.zone !== Z.OUT || c.lava) continue;
      if (inRect(x, y, CORN) || STATIONS.some((s) => inRect(x, y, s.rect))) continue;
      const k = y * W + x;
      if (taken.has(k)) continue;
      if (keepFree.some(([px, py]) => Math.abs(px - x) < 2 && Math.abs(py - y) < 2)) continue;
      const ps = path.nearestS(wx(x), wx(y));
      const pp = path.pointAt(ps);
      if (Math.hypot(pp.x - wx(x), pp.z - wx(y)) < 10) continue;
      c.type = 'solid';
      taken.add(k);
      TREES.push([x, y]);
    }
  }
  return g.result();
}
