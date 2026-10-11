// ─────────────────────────────────────────────────────────────
//  Foto-Texturen (CC0 von ambientCG und Poly Haven, siehe public/tex/
//  QUELLEN.md). Sie liegen als WebP in 1024 und 512 Pixeln bereit und
//  werden beim Laden geholt: 1024 bei den Stufen hoch/mittel, 512 auf
//  niedrig/minimal (Handys). Fehlen sie – Einzeldatei-Build, Datei kaputt –,
//  bleiben die prozeduralen Texturen aus textures.js.
//
//  preload(slots) holt Sätze im Voraus (während des Ladebildschirms),
//  ext(slot) liefert danach sofort { map, normal, rough, metal, alpha, height }.
//  Gemeinsame Sätze bleiben geladen; kartenspezifische gibt release() frei.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';

let INDEX = null;
let indexPromise = null;
let SIZE = 1024;
let ANISO = 4;
let ENABLED = true;
const sets = new Map(); // slot → { promise, set }
const loader = new THREE.TextureLoader();

// Kachelgröße in Metern (eine Wiederholung der Textur) – nach den Maßangaben der Quellen,
// sonst geschätzt. Gilt für Flächen mit Welt-UVs (Wände, Böden, Decken, Dächer).
export const TILE = {
  wall: 2.5, concrete: 3, concreteDirty: 2, tiles: 2.1, cobble: 1.5, ground: 3, ceiling: 3,
  wood: 2, woodDark: 2, board: 0.6, metal: 2, diamond: 0.6, rust: 2.2, shutter: 2,
  brick: 1, brickLight: 2.1, siding: 2, corrugated: 1.8, panels: 3, grass: 2, road: 3,
  dirt: 2.5, roofRed: 3.5, roofSlate: 3, fence: 1.5, lava: 2.5, hay: 1.5,
};

// Oberflächen-Variation je Satz (siehe world/surfacevar.js): Flecken, Rauheits-Streuung,
// Pfützen auf Böden, Fleckengröße in m, Sockelanstrich
export const SV = {
  wall: { stain: 0.48, rough: 0.3, size: 7, band: { h: 1.15, color: 0x5d7356, strength: 1, line: 0.035 } },
  concrete: { stain: 0.38, rough: 0.5, wet: 1, size: 9 },
  concreteDirty: { stain: 0.38, rough: 0.5, wet: 1, size: 8 },
  tiles: { stain: 0.2, rough: 0.4, wet: 0.6, size: 7 },
  cobble: { stain: 0.3, rough: 0.4, wet: 1, size: 8 },
  ground: { stain: 0.32, rough: 0.3, wet: 0.7, size: 11 },
  ceiling: { stain: 0.35, rough: 0.2, size: 8 },
  wood: { stain: 0.25, rough: 0.3, wet: 0.4, size: 6 },
  woodDark: { stain: 0.2, size: 5 },
  board: { stain: 0.15, size: 3 },
  metal: { stain: 0.25, rough: 0.4, size: 4 },
  diamond: { stain: 0.25, rough: 0.4, wet: 0.5, size: 5 },
  rust: { stain: 0.2, size: 4 },
  shutter: { stain: 0.28, rough: 0.3, size: 5 },
  paintRed: { stain: 0.15, size: 3 },
  paintGreen: { stain: 0.15, size: 3 },
  leather: { stain: 0.1, size: 2 },
  brick: { stain: 0.32, rough: 0.3, size: 9 },
  brickLight: { stain: 0.32, size: 9 },
  siding: { stain: 0.3, size: 7 },
  corrugated: { stain: 0.3, size: 6 },
  panels: { stain: 0.38, size: 8 },
  grass: { stain: 0.42, rough: 0.2, size: 14 },
  dirt: { stain: 0.3, wet: 0.8, size: 9 },
  road: { stain: 0.3, wet: 1, size: 10 },
  roofRed: { stain: 0.35, size: 8 },
  roofSlate: { stain: 0.35, size: 8 },
  hay: { stain: 0.2, size: 3 },
  fence: { stain: 0.15, size: 4 },
};

export function configureTexLib({ size = 1024, anisotropy = 4, enabled = true } = {}) {
  SIZE = size;
  ANISO = anisotropy;
  ENABLED = enabled;
}

export function loadIndex() {
  if (!indexPromise) {
    indexPromise = (async () => {
      try {
        if (typeof fetch !== 'function' || location.protocol === 'file:') return null;
        const r = await fetch('tex/index.json', { cache: 'no-cache' });
        INDEX = r.ok ? await r.json() : null;
      } catch { INDEX = null; }
      return INDEX;
    })();
  }
  return indexPromise;
}

export const available = (slot) => ENABLED && !!INDEX?.[slot];

function loadTex(url, srgb) {
  return new Promise((resolve) => {
    loader.load(url, (t) => {
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = ANISO;
      t.userData.texlib = true;
      resolve(t);
    }, undefined, () => resolve(null));
  });
}

async function loadSet(slot) {
  const e = INDEX?.[slot];
  if (!e) return null;
  const S = e.sizes.includes(SIZE) ? SIZE : e.sizes[e.sizes.length - 1];
  const m = e.maps || {};
  const f = (k) => `tex/${slot}/${k}_${S}.webp${e.v ? `?v=${e.v}` : ''}`;
  const [map, normal, rough, metal, alpha, height] = await Promise.all([
    m.color ? loadTex(f('color'), true) : null,
    m.normal ? loadTex(f('normal'), false) : null,
    m.rough ? loadTex(f('rough'), false) : null,
    m.metal ? loadTex(f('metal'), false) : null,
    m.alpha ? loadTex(f('alpha'), false) : null,
    m.height ? loadTex(f('height'), false) : null,
  ]);
  if (m.color && !map) return null; // ohne Farbe lieber ganz prozedural
  // Nicht quadratische Vorlagen (z. B. Klinker 210 × 105 cm) liegen quadratisch gespeichert vor:
  // senkrecht entsprechend öfter wiederholen, damit die Proportionen stimmen
  const aspect = e.dims && e.dims[1] > 0 ? e.dims[0] / e.dims[1] : 1;
  if (Math.abs(aspect - 1) > 0.05) for (const t of [map, normal, rough, metal, alpha, height]) if (t) t.repeat.set(1, aspect);
  return { map, normal, rough, metal, alpha, height, ext: true, slot, size: S, avg: e.avg, aspect };
}

/** Sätze im Voraus laden (parallel). Gibt zurück, wie viele geladen sind. */
export async function preload(slots, onEach = () => {}) {
  if (!ENABLED) return 0;
  await loadIndex();
  let n = 0;
  await Promise.all(slots.map(async (slot) => {
    if (!INDEX?.[slot]) return;
    let s = sets.get(slot);
    if (!s) { s = { promise: loadSet(slot), set: null }; sets.set(slot, s); }
    s.set = await s.promise;
    if (s.set) n++;
    onEach(slot);
  }));
  return n;
}

/** Fertig geladener Satz oder null (dann prozedural weitermachen) */
export function ext(slot) {
  if (!ENABLED) return null;
  return sets.get(slot)?.set || null;
}

/** Kopie mit eigener Wiederholung (teilt die Bilddaten und den Grafikspeicher) */
export function repeated(set, rx, ry = rx) {
  if (!set) return set;
  const out = { ...set };
  for (const k of ['map', 'normal', 'rough', 'metal', 'alpha', 'height']) {
    if (!set[k]) continue;
    const t = set[k].clone();
    t.repeat.set(rx, ry * (set.aspect || 1));
    t.userData.texlib = true;
    out[k] = t;
  }
  return out;
}

/** Kartenspezifische Sätze freigeben (Grafikspeicher) */
export function release(slots) {
  for (const slot of slots) {
    const s = sets.get(slot);
    if (!s) continue;
    sets.delete(slot);
    if (s.set) for (const k of ['map', 'normal', 'rough', 'metal', 'alpha', 'height']) s.set[k]?.dispose();
  }
}

export function isTexlib(t) { return !!t?.userData?.texlib; }
