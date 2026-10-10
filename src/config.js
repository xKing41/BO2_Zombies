// ─────────────────────────────────────────────────────────────
//  NACHTFALL – zentrale Spielkonfiguration
//  Balancing-Werte, Waffen und Perks an einem Ort (Karten: src/maps/).
// ─────────────────────────────────────────────────────────────

export const CELL = 2; // Meter pro Kartenzelle
export const WALL_H = 4; // Wandhöhe in Metern

// Karten (Layout, Spots, Deko) liegen in src/maps/.

// ── Waffen ───────────────────────────────────────────────────
// Spielwerte nach Black Ops 2 Zombies, soweit öffentlich dokumentiert (v. a. die Tabelle
// „Upgraded Weapons/Black Ops II“ im CoD-Wiki); das Gegenstück steht jeweils dabei.
// Schaden in denselben Einheiten wie die Zombie-Lebenspunkte (Runde 1 = 150).
// damage → dmgMin über range [nah, fern] in Metern (die Reichweiten selbst sind geschätzt),
// headMult Kopf, bodyMult Rumpf, rpm Schuss/Minute, spread in Radiant.
export const WEAPONS = {
  // ↔ M1911 · PaP ↔ Mustang & Sally: Direkttreffer 1000, Explosion 1200 → 75, 6+6 Schuss, 50 Reserve
  p45: {
    name: 'P-45', cls: 'pistol', auto: false, damage: 45, headMult: 3, rpm: 420,
    mag: 8, reserve: 80, reload: 1.5, spread: 0.018, adsSpread: 0.003, recoil: 0.03,
    pellets: 1, cost: 0, sound: 'pistol',
    pap: { name: 'P-45 Höllenfeuer', damage: 1000, mag: 12, reserve: 50, explosive: { damage: 1200, radius: 2.6, falloff: 0.06 } },
  },
  // ↔ M14: 105 → 80, Kopf ×3, Rumpf ×1,25, 8/96 · PaP ↔ Mnesia: 200 → 150, Kopf ×6, Rumpf ×2, 16/192
  k14: {
    name: 'K-14 Karabiner', cls: 'rifle', auto: false, damage: 105, dmgMin: 80, range: [30, 60], headMult: 3, bodyMult: 1.25, rpm: 625,
    mag: 8, reserve: 96, reload: 2.0, spread: 0.02, adsSpread: 0.001, recoil: 0.04,
    pellets: 1, cost: 500, sound: 'rifle', penetrate: 1,
    pap: { name: 'K-14 Richter', damage: 200, dmgMin: 150, headMult: 6, bodyMult: 2, mag: 16, reserve: 192 },
  },
  // ↔ Olympia: 4 Schrot je 150 → 29, 212/min, 2/38 · PaP ↔ Hades: 600 → 135, 2/60, schneller nachladen
  dlf: {
    name: 'Doppellauf', cls: 'shotgun2', auto: false, damage: 150, dmgMin: 29, range: [4, 15], headMult: 1.5, rpm: 212,
    mag: 2, reserve: 38, reload: 2.1, spread: 0.075, adsSpread: 0.05, recoil: 0.09,
    pellets: 4, cost: 500, sound: 'shotgun',
    pap: { name: 'Zwillingsdrache', damage: 600, dmgMin: 135, mag: 2, reserve: 60, reload: 1.6 },
  },
  // ↔ MP5 (1000 Punkte): 100 → 50, 30/120 · PaP ↔ MP115 Kollider: 140 → 80, Kopf ×5, 40/200
  vmp: {
    name: 'Vektor MP', cls: 'smg', auto: true, damage: 100, dmgMin: 50, range: [8, 25], headMult: 4, rpm: 750,
    mag: 30, reserve: 120, reload: 2.0, spread: 0.035, adsSpread: 0.008, recoil: 0.014,
    pellets: 1, cost: 1000, sound: 'smg',
    pap: { name: 'Vektor Sturmwind', damage: 140, dmgMin: 80, headMult: 5, mag: 40, reserve: 200 },
  },
  // ↔ Remington 870 MCS (1500 Punkte): im Zombie-Modus 4 Schrot je Patrone, 6 Patronen · PaP: 10 Patronen, 80 Reserve
  pump: {
    name: 'Pumpgun 870', cls: 'shotgun', auto: false, damage: 160, dmgMin: 40, range: [5, 16], headMult: 1.5, rpm: 75,
    mag: 6, reserve: 54, reload: 2.8, spread: 0.065, adsSpread: 0.045, recoil: 0.1,
    pellets: 4, cost: 1500, sound: 'shotgun',
    pap: { name: 'Donnerschlag 870', damage: 320, dmgMin: 80, mag: 10, reserve: 80 },
  },
  // ↔ M16A1 (1200 Punkte): 100 → 70, 30/120 (bei uns vollautomatisch) · PaP ↔ Skullcrusher: 150 → 100, 30/270
  ar: {
    name: 'AR-77', cls: 'ar', auto: true, damage: 100, dmgMin: 70, range: [20, 45], headMult: 3, rpm: 650,
    mag: 30, reserve: 120, reload: 2.4, spread: 0.03, adsSpread: 0.004, recoil: 0.02,
    pellets: 1, cost: 1200, sound: 'ar', penetrate: 1,
    pap: { name: 'Glorreiche Wut', damage: 150, dmgMin: 100, mag: 30, reserve: 270 },
  },
  // ↔ RPD: 100/400 (Schaden nicht verlässlich dokumentiert) · PaP: 125 im Gurt
  lmg: {
    name: 'Hammer LMG', cls: 'lmg', auto: true, damage: 125, headMult: 2.5, rpm: 720,
    mag: 100, reserve: 400, reload: 4.6, spread: 0.04, adsSpread: 0.008, recoil: 0.018,
    pellets: 1, cost: 0, sound: 'lmg', penetrate: 2,
    pap: { name: 'Amboss', damage: 260, mag: 125, reserve: 625 },
  },
  // ↔ Barrett M82A1: 600 → 500, 5/30 · PaP ↔ Macro Annihilator: 1000, 7/42
  sniper: {
    name: 'Falke .50', cls: 'sniper', auto: false, damage: 600, dmgMin: 500, range: [40, 80], headMult: 5, rpm: 120,
    mag: 5, reserve: 30, reload: 3.2, spread: 0.06, adsSpread: 0.0, recoil: 0.12,
    pellets: 1, cost: 0, sound: 'sniper', penetrate: 4, scope: true,
    pap: { name: 'Raubvogel', damage: 1000, dmgMin: 1000, mag: 7, reserve: 42 },
  },
  // ↔ Ray Gun: Direkttreffer 1000, Druckwelle 1500 → 300, 20/160 · PaP ↔ Porter's X2: Druckwelle 2000 → 300, 40/200
  ray: {
    name: 'Strahlenkanone', cls: 'ray', auto: false, damage: 1000, headMult: 1, rpm: 181,
    mag: 20, reserve: 160, reload: 2.6, spread: 0.01, adsSpread: 0.002, recoil: 0.03,
    pellets: 1, cost: 0, sound: 'ray',
    projectile: { speed: 38, color: 0x55ff66, splash: 1500, radius: 2.4, falloff: 0.2 },
    pap: { name: 'Neutronen-Zerstörer', damage: 1000, mag: 40, reserve: 200,
      projectile: { speed: 45, color: 0xff3355, splash: 2000, radius: 3.0, falloff: 0.15 } },
  },
  // Wunderwaffe aus Bauteilen (Linie 13): Kettenblitz, tötet sofort; Munition wie bei vergleichbaren Wunderwaffen (4/24)
  tesla: {
    name: 'Gewitter-Werfer', cls: 'tesla', auto: false, damage: 0, headMult: 1, rpm: 70,
    mag: 4, reserve: 24, reload: 3.2, spread: 0, adsSpread: 0, recoil: 0.09,
    pellets: 1, cost: 0, sound: 'tesla', wonder: true,
    lightning: { chains: 8, range: 9, reach: 45, color: [0.7, 1.7, 4.0] },
    pap: { name: 'Gewitter-Zorn', mag: 8, reserve: 48, lightning: { chains: 16, range: 12, reach: 55, color: [3.4, 0.9, 4.2] } },
  },
};

// Messer: 150 (Runde 1 mit einem Stich); Jagdmesser ↔ Bowie-Messer: 1000 (mit einem Stich bis Runde 9)
export const KNIFE_DAMAGE = 150, KNIFE_DAMAGE_UPGRADED = 1000;
// Splittergranate: 500–1000 Schaden in der Mitte, Radius 6,5 m (2 zu Beginn, +2 je Runde, höchstens 4)
export const GRENADE = { min: 500, max: 1000, radius: 6.5 };

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
// Allein: 24 + 3 × Faktor; im Koop je weiterem Spieler + 6 × Faktor (wie im Original)
export function zombiesForRound(r, players = 1) {
  let mult = Math.max(1, r / 5);
  if (r >= 10) mult *= r * 0.15;
  const max = 24 + Math.floor((players > 1 ? (players - 1) * 6 : 0.5 * 6) * mult);
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
