// ─────────────────────────────────────────────────────────────
//  NACHTFALL – zentrale Spielkonfiguration
//  Alle Balancing-Werte, Karte, Waffen und Perks an einem Ort.
// ─────────────────────────────────────────────────────────────

export const CELL = 2; // Meter pro Kartenzelle
export const WALL_H = 4; // Wandhöhe in Metern

// Legende:  '#' Wand · '0'-'9' Boden (Zone) · 'A'-'Z' kaufbare Tür
//           'w' Fenster mit Barrikade · 's' Zombie-Spawn draußen · ' ' Außenbereich
export const MAP = [
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

export const ZONES = [
  { name: 'Depot-Halle', ceiling: true, floor: 'concrete' },
  { name: 'Diner', ceiling: true, floor: 'tiles' },
  { name: 'Werkstatt', ceiling: true, floor: 'dirty' },
  { name: 'Innenhof', ceiling: false, floor: 'cobble' },
];

export const DOORS = {
  A: { cost: 750, zones: [0, 1], label: 'Diner' },
  B: { cost: 750, zones: [0, 2], label: 'Werkstatt' },
  C: { cost: 1000, zones: [1, 3], label: 'Innenhof' },
  D: { cost: 1000, zones: [2, 3], label: 'Innenhof' },
};

export const PLAYER_START = { cx: 6, cy: 6, yaw: -Math.PI * 0.5 }; // Blick nach Osten (Tür zum Diner)

// Richtungen: N = -z, S = +z, W = -x, E = +x  (zeigt zur Wand)
export const BOX_SPOTS = [
  { cx: 10, cy: 2, wall: 'N' },
  { cx: 13, cy: 9, wall: 'S' },
  { cx: 2, cy: 15, wall: 'W' },
  { cx: 13, cy: 18, wall: 'S' },
];
export const BOX_START = 0;

export const PERK_SPOTS = {
  phoenix: { cx: 2, cy: 3, wall: 'W' },
  titan: { cx: 22, cy: 3, wall: 'E' },
  blitz: { cx: 11, cy: 18, wall: 'S' },
  doppel: { cx: 13, cy: 11, wall: 'W' },
  sprint: { cx: 22, cy: 11, wall: 'E' },
};

export const WALLBUYS = [
  { weapon: 'k14', cx: 6, cy: 2, wall: 'N' },
  { weapon: 'dlf', cx: 2, cy: 8, wall: 'W' },
  { weapon: 'vmp', cx: 18, cy: 2, wall: 'N' },
  { weapon: 'grenade', cx: 22, cy: 8, wall: 'E' },
  { weapon: 'pump', cx: 7, cy: 18, wall: 'S' },
];

export const POWER_SWITCH = { cx: 3, cy: 11, wall: 'N' };
export const PAP_SPOT = { cx: 17, cy: 14 };

// ── Waffen ───────────────────────────────────────────────────
// damage pro Treffer/Pellet · rpm Schuss/Minute · spread in Radiant
export const WEAPONS = {
  p45: {
    name: 'P-45', cls: 'pistol', auto: false, damage: 45, headMult: 3, rpm: 420,
    mag: 8, reserve: 80, reload: 1.5, spread: 0.018, adsSpread: 0.003, recoil: 0.03,
    pellets: 1, cost: 0, sound: 'pistol',
    pap: { name: 'P-45 Höllenfeuer', damage: 120, mag: 12, reserve: 120, explosive: { damage: 260, radius: 2.6 } },
  },
  k14: {
    name: 'K-14 Karabiner', cls: 'rifle', auto: false, damage: 120, headMult: 3, rpm: 480,
    mag: 10, reserve: 110, reload: 2.0, spread: 0.02, adsSpread: 0.001, recoil: 0.04,
    pellets: 1, cost: 500, sound: 'rifle', penetrate: 1,
    pap: { name: 'K-14 Richter', damage: 320, mag: 15, reserve: 220 },
  },
  dlf: {
    name: 'Doppellauf', cls: 'shotgun2', auto: false, damage: 50, headMult: 1.5, rpm: 320,
    mag: 2, reserve: 60, reload: 2.1, spread: 0.075, adsSpread: 0.05, recoil: 0.09,
    pellets: 8, cost: 500, sound: 'shotgun',
    pap: { name: 'Zwillingsdrache', damage: 160, mag: 4, reserve: 120 },
  },
  vmp: {
    name: 'Vektor MP', cls: 'smg', auto: true, damage: 70, headMult: 2.2, rpm: 860,
    mag: 30, reserve: 210, reload: 2.0, spread: 0.035, adsSpread: 0.008, recoil: 0.014,
    pellets: 1, cost: 1200, sound: 'smg',
    pap: { name: 'Vektor Sturmwind', damage: 150, mag: 45, reserve: 360 },
  },
  pump: {
    name: 'Pumpgun 870', cls: 'shotgun', auto: false, damage: 80, headMult: 1.5, rpm: 75,
    mag: 6, reserve: 54, reload: 2.8, spread: 0.065, adsSpread: 0.045, recoil: 0.1,
    pellets: 8, cost: 1500, sound: 'shotgun',
    pap: { name: 'Donnerschlag 870', damage: 220, mag: 10, reserve: 100 },
  },
  ar: {
    name: 'AR-77', cls: 'ar', auto: true, damage: 110, headMult: 3, rpm: 650,
    mag: 30, reserve: 270, reload: 2.4, spread: 0.03, adsSpread: 0.004, recoil: 0.02,
    pellets: 1, cost: 1200, sound: 'ar', penetrate: 1,
    pap: { name: 'Glorreiche Wut', damage: 260, mag: 40, reserve: 400 },
  },
  lmg: {
    name: 'Hammer LMG', cls: 'lmg', auto: true, damage: 125, headMult: 2.5, rpm: 720,
    mag: 100, reserve: 400, reload: 4.6, spread: 0.04, adsSpread: 0.008, recoil: 0.018,
    pellets: 1, cost: 0, sound: 'lmg', penetrate: 2,
    pap: { name: 'Amboss', damage: 260, mag: 125, reserve: 625 },
  },
  sniper: {
    name: 'Falke .50', cls: 'sniper', auto: false, damage: 900, headMult: 5, rpm: 55,
    mag: 5, reserve: 40, reload: 3.2, spread: 0.06, adsSpread: 0.0, recoil: 0.12,
    pellets: 1, cost: 0, sound: 'sniper', penetrate: 4, scope: true,
    pap: { name: 'Raubvogel', damage: 2600, mag: 8, reserve: 80 },
  },
  ray: {
    name: 'Strahlenkanone', cls: 'ray', auto: false, damage: 1400, headMult: 1, rpm: 190,
    mag: 20, reserve: 160, reload: 2.6, spread: 0.01, adsSpread: 0.002, recoil: 0.03,
    pellets: 1, cost: 0, sound: 'ray',
    projectile: { speed: 38, color: 0x55ff66, splash: 1000, radius: 2.4 },
    pap: { name: 'Neutronen-Zerstörer', damage: 2800, mag: 40, reserve: 200,
      projectile: { speed: 45, color: 0xff3355, splash: 2200, radius: 3.0 } },
  },
};

// Gewichtung in der Mystery-Kiste
export const BOX_POOL = { ray: 1.2, lmg: 3, sniper: 3, ar: 4, vmp: 3, pump: 3, k14: 2, dlf: 2 };
export const BOX_COST = 950;
export const PAP_COST = 5000;
export const GRENADE_COST = 250;

// ── Perks ────────────────────────────────────────────────────
export const PERKS = {
  titan: { name: 'Titan-Trank', desc: 'Deutlich mehr Lebenspunkte', cost: 2500, color: '#d8232a', glyph: '✚' },
  blitz: { name: 'Blitz-Tonikum', desc: 'Doppelt so schnell nachladen', cost: 3000, color: '#2fbf4a', glyph: '⚡' },
  doppel: { name: 'Doppelschuss', desc: 'Höhere Feuerrate & doppelter Schaden', cost: 2000, color: '#f0a020', glyph: '❖' },
  phoenix: { name: 'Phönix-Soda', desc: 'Belebt dich selbst wieder (max. 3×)', cost: 500, color: '#2f9bff', glyph: '✦' },
  sprint: { name: 'Sprint-Elixier', desc: 'Schneller laufen & länger sprinten', cost: 2000, color: '#a050ff', glyph: '➤' },
};
export const PERK_LIMIT = 4;

// ── Runden & Zombies ─────────────────────────────────────────
export const MAX_ALIVE = 24;

export function zombiesForRound(r) {
  const early = [6, 8, 13, 18, 24];
  if (r <= 5) return early[r - 1];
  return Math.floor(0.0842 * r * r + 0.1954 * r + 22.05);
}

export function zombieHealth(r) {
  if (r < 10) return 150 + 100 * (r - 1);
  let h = 950;
  for (let i = 10; i <= r; i++) h *= 1.1;
  return Math.floor(h);
}

export function spawnDelay(r) {
  return Math.max(0.12, 2.0 * Math.pow(0.95, r - 1));
}

export function rollSpeedType(r) {
  const pSprint = Math.min(0.55, Math.max(0, (r - 6) * 0.07));
  const pRun = Math.min(0.9, Math.max(0, (r - 1) * 0.17));
  const x = Math.random();
  if (x < pSprint) return 'sprint';
  if (x < pSprint + pRun * (1 - pSprint)) return 'run';
  return 'walk';
}

export const POINTS = { hit: 10, kill: 60, head: 100, knife: 130, board: 10, nuke: 400, carpenter: 200 };
export const ZOMBIE_HIT_DAMAGE = 45;
