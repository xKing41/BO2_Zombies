// ─────────────────────────────────────────────────────────────
//  NACHTFALL – zentrale Spielkonfiguration
//  Balancing-Werte, Waffen und Perks an einem Ort (Karten: src/maps/).
// ─────────────────────────────────────────────────────────────

export const CELL = 2; // Meter pro Kartenzelle
export const WALL_H = 4; // Wandhöhe in Metern

// Karten (Layout, Spots, Deko) liegen in src/maps/.

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
  // Wunderwaffe aus Bauteilen (Linie 13): Kettenblitz, tötet sofort
  tesla: {
    name: 'Gewitter-Werfer', cls: 'tesla', auto: false, damage: 0, headMult: 1, rpm: 70,
    mag: 4, reserve: 24, reload: 3.2, spread: 0, adsSpread: 0, recoil: 0.09,
    pellets: 1, cost: 0, sound: 'tesla', wonder: true,
    lightning: { chains: 8, range: 9, reach: 45, color: [0.7, 1.7, 4.0] },
    pap: { name: 'Gewitter-Zorn', mag: 8, reserve: 48, lightning: { chains: 16, range: 12, reach: 55, color: [3.4, 0.9, 4.2] } },
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

// Zombies pro Runde (solo), wie bei Treyarch: 24 + 3 × Multiplikator, die ersten
// fünf Runden anteilig (25 %, 30 %, 50 %, 70 %, 90 %) → 6, 8, 13, 18, 24, 27, …
export function zombiesForRound(r) {
  let mult = Math.max(1, r / 5);
  if (r >= 10) mult *= r * 0.15;
  const max = 24 + Math.floor(0.5 * 6 * mult);
  const early = [0.25, 0.3, 0.5, 0.7, 0.9];
  return r <= 5 ? Math.floor(max * early[r - 1]) : max;
}

export function zombieHealth(r) {
  if (r < 10) return 150 + 100 * (r - 1);
  let h = 950;
  for (let i = 10; i <= r; i++) h *= 1.1;
  return Math.floor(h);
}

// Spawn-Abstand: 2 s in Runde 1, jede Runde ×0,95, mindestens 0,08 s
export function spawnDelay(r) {
  return Math.max(0.08, 2.0 * Math.pow(0.95, r - 1));
}

// Lauftempo wie bei Treyarch: Grundwert = Runde × 4, jeder Zombie würfelt
// zwischen Grundwert und Grundwert + 35; bis 35 gehen, bis 70 rennen, darüber sprinten.
// → Runde 1 fast nur Geher, ab Runde 9 alle rennend, ab Runde 10 erste Sprinter, ab 18 alle.
export function rollSpeedType(r) {
  const base = r * 4;
  const x = base + Math.floor(Math.random() * 35);
  return x <= 35 ? 'walk' : x <= 70 ? 'run' : 'sprint';
}

// Punkte: Treffer 10, Kill 60, Kopfschuss 100, Messer 130, Explosion/Wunderwaffe 50
// Kill = 50 Grundpunkte + Trefferzonen-Bonus (Rumpf +10, Kopf +50, Messer +80)
export const POINTS = { hit: 10, kill: 60, limb: 50, head: 100, knife: 130, blast: 50, board: 10, nuke: 400, carpenter: 200 };
// Ein Zombie-Schlag: 50 → ohne Titan-Trank nach 2 Schlägen am Boden, mit (250) nach 5
export const ZOMBIE_HIT_DAMAGE = 50;
