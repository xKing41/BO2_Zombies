import * as THREE from 'three';
import * as T from './textures.js';
import * as X from './texlib.js';
import { surfaceVar } from '../world/surfacevar.js';
import { detailImage, weaveTextures } from './detail.js';

// Foto-Texturen, die alle Karten gemeinsam nutzen (werden vor buildMaterials geladen)
export const SHARED_SLOTS = [
  'wall', 'concrete', 'concreteDirty', 'tiles', 'cobble', 'ground', 'ceiling', 'wood', 'woodDark', 'board',
  'metal', 'diamond', 'rust', 'shutter', 'paintRed', 'paintGreen', 'leather', 'gunWood', 'glove', 'papCamo',
  'clothDetail', 'denimDetail', 'leatherDetail',
];

// Weltmaterialien: Normal-Map (Tiefe) statt Bump, Rauheit aus der Textur (nasse Stellen glänzen).
// Foto-Sätze (t.ext) bringen eigene Metall-Karten mit; prozedurale tragen Metall im Blau-Kanal der Rauheit.
export function surf(t, o = {}) {
  const m = { map: t.map, ...o };
  if (t.normal) { m.normalMap = t.normal; m.normalScale = new THREE.Vector2(o.ns ?? 1, o.ns ?? 1); }
  else if (t.bump) { m.bumpMap = t.bump; m.bumpScale = o.bs ?? 1.5; }
  if (t.rough) { m.roughnessMap = t.rough; m.roughness = o.rough ?? 1; }
  if (o.metalMap) {
    if (t.metal) { m.metalnessMap = t.metal; m.metalness = o.metalMax ?? 1; }
    else if (!t.ext && t.rough) m.metalnessMap = t.rough; // Blau-Kanal: blankes Metall 1, Rost 0
  }
  if (t.alpha) { m.alphaMap = t.alpha; m.alphaTest = o.alphaTest ?? 0.5; }
  delete m.ns; delete m.bs; delete m.rough; delete m.metalMap; delete m.metalMax;
  return new THREE.MeshStandardMaterial(m);
}

/**
 * Material aus Foto-Satz (falls geladen) oder prozedural.
 * o: Einstellungen für beide, x: Abweichungen nur für den Foto-Satz (z. B. Farbton).
 * Foto-Materialien merken sich ihre Kachelgröße (userData.uvScale, Meter je Wiederholung).
 */
export function slotMat(slot, make, o = {}, x = {}) {
  const e = X.ext(slot);
  const m = surf(e || make(), e ? { ...o, ...x } : o);
  if (e) photoMat(m, slot);
  return m;
}

/** Foto-Material kennzeichnen: echte Kachelgröße und Oberflächen-Variation gegen sichtbare Wiederholung */
export function photoMat(m, slot, svSlot = slot) {
  m.userData.uvScale = X.TILE[slot] ?? 4;
  m.userData.slot = slot;
  if (X.SV[svSlot]) surfaceVar(m, X.SV[svSlot]);
  return m;
}

// Erzeugt alle gemeinsam genutzten Materialien einmalig.
export function buildMaterials(onProgress = () => {}) {
  const M = {};
  const step = (label) => onProgress(label);
  const std = (o) => new THREE.MeshStandardMaterial(o);

  step('Wände');
  M.wall = slotMat('wall', () => T.plasterWall(3), { roughness: 0.92 }, { color: 0xd2ccb6, ns: 1.4 });

  step('Böden');
  M.floorConcrete = slotMat('concrete', () => T.concrete(1, [1.0, 0.98, 0.94]), { roughness: 0.85 });
  M.floorDirty = slotMat('concreteDirty', () => T.concrete(2, [0.95, 0.92, 0.85], 1), { roughness: 0.7 }, { color: 0xd8d2c8 });
  M.floorTiles = slotMat('tiles', () => T.checkerTiles(11), { roughness: 0.35, metalness: 0.0 }, { rough: 0.9 });
  if (M.floorTiles.userData.slot) M.floorTiles.userData.uvScale = 1.1; // Diner: kleine Fliesen (gut 25 cm)
  M.floorCobble = slotMat('cobble', () => T.cobble(13), { roughness: 0.8 });
  M.floorMetal = slotMat('diamond', () => T.metal(19, 0.5), { roughness: 0.55, metalness: 0.75, metalMap: true }, { metalness: 0.85 });
  // Boden draußen: große Ebene mit eigener Wiederholung (Meter je Kachel siehe texlib.TILE)
  const dtx = X.ext('ground');
  M.ground = surf(dtx ? X.repeated(dtx, 240 / X.TILE.ground) : (() => { const dt = T.dirt(17); for (const t of [dt.map, dt.normal, dt.rough]) if (t) t.repeat.set(50, 50); return dt; })(), { roughness: 0.95 });
  if (dtx) surfaceVar(M.ground, X.SV.ground);

  step('Decken & Holz');
  M.ceiling = slotMat('ceiling', () => T.ceiling(5), { roughness: 0.95 }, { color: 0x9a9a9a });
  let pl = null;
  const planks7 = () => pl || (pl = T.planks(7));
  M.wood = slotMat('wood', planks7, { roughness: 0.8 });
  M.woodDark = slotMat('woodDark', () => T.planks(8, [0.75, 0.8, 0.85], 6), { roughness: 0.85 });
  M.board = slotMat('board', () => T.planks(9, [1.1, 1.0, 0.9], 1), { roughness: 0.85 }, { color: 0xcfc2b0 });

  step('Metall');
  M.metal = slotMat('metal', () => T.metal(19, 0.5), { roughness: 0.55, metalness: 0.75, metalMap: true });
  M.rust = slotMat('rust', () => T.metal(20, 1.2), { roughness: 0.8, metalness: 0.45, metalMap: true }, { metalness: 0.35 });
  M.shutter = slotMat('shutter', () => T.shutter(23), { roughness: 0.6, metalness: 0.6, metalMap: true }, { color: 0xb0a49a, metalness: 0.15 });
  const gm = T.metal(21, 0.05, [0.12, 0.12, 0.13]);
  M.gunMetal = surf(gm, { roughness: 0.35, metalness: 0.9, ns: 0.5, metalMap: true });
  M.gunPolymer = std({ color: 0x1b1c1e, roughness: 0.7, metalness: 0.1 });
  const gw = X.ext('gunWood');
  M.gunWood = gw ? surf(X.repeated(gw, 2), { roughness: 0.55, rough: 0.8 }) : std({ map: planks7().map, color: 0xb07a4f, roughness: 0.55 });
  M.paintRed = slotMat('paintRed', () => ({}), { color: 0x6d1410, roughness: 0.6, metalness: 0.3 }, { color: 0xffffff, metalMap: true });
  M.paintGreen = slotMat('paintGreen', () => ({}), { color: 0x2c3a2a, roughness: 0.7, metalness: 0.2 }, { color: 0xffffff, metalMap: true });
  M.chrome = std({ color: 0xcfd3d6, roughness: 0.3, metalness: 1.0 });
  M.leather = slotMat('leather', () => ({}), { color: 0x4a1612, roughness: 0.55 }, { color: 0xa07a76 });
  M.cloth = std({ color: 0x1e2226, roughness: 0.95 });
  M.glove = slotMat('glove', () => ({}), { color: 0x23201d, roughness: 0.8 }, { color: 0xffffff });
  M.sleeve = std({ color: 0x3a3f33, roughness: 0.95 });
  M.dark = std({ color: 0x0c0c0c, roughness: 0.9 });
  M.glass = std({ color: 0x223038, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.35 });
  M.paper = std({ color: 0xc8bea4, roughness: 1 });

  step('Effekte');
  M.tex = {
    blood: [T.bloodDecal(29), T.bloodDecal(30), T.bloodDecal(31)],
    hole: T.bulletHole(),
    glow: T.glow(),
    flash: T.muzzleFlash(31),
    // Aufgerüstete Waffen: wirbelndes Onyx-Muster (Foto), sonst das gemalte Tarnmuster
    papCamo: X.ext('papCamo') ? X.repeated(X.ext('papCamo'), 1).map : T.papCamo(41),
    boxSide: T.boxSide(),
    moon: T.moon(),
  };
  M.tex.papCamo.repeat.set(2, 2);
  M.papGun = X.ext('papCamo')
    ? std({ map: M.tex.papCamo, color: 0xa898d8, emissive: 0x7038ff, emissiveMap: M.tex.papCamo, emissiveIntensity: 0.4, roughness: 0.22, metalness: 0.75 })
    : std({ map: M.tex.papCamo, color: 0x8070a0, emissive: 0x5020d0, emissiveMap: M.tex.papCamo, emissiveIntensity: 0.3, roughness: 0.3, metalness: 0.8 });

  step('Zombies');
  // Neutrale Texturen + Farbton pro Instanz (spart Speicher und Draw-Calls).
  // Die Färbemaske im G-Kanal der Bump-Map hält Blut, Wunden und Risse farbecht.
  const tint = (base) => (c) => new THREE.Color().setRGB(c[0] / base, c[1] / base, c[2] / base, THREE.SRGBColorSpace);
  const masked = (m) => {
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', /* glsl */`
        #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
          #ifdef USE_BUMPMAP
            diffuseColor.rgb *= mix( vec3( 1.0 ), vColor.rgb, texture2D( bumpMap, vBumpMapUv ).g );
          #else
            diffuseColor *= vColor;
          #endif
        #endif`);
    };
    m.customProgramCacheKey = () => 'zombieTintMask';
    return m;
  };
  const zs = T.zombieSkin(60), zh = T.zombieHead(62);
  const zsh = T.zombieCloth(86, 'shirt'), zp = T.zombieCloth(87, 'pants');
  const za = T.zombieApron(66), hh = T.hardhatTex(68);
  // Echte Stoff-, Jeans- und Lederstruktur (Foto-Höhenkarten) in die gemalten Texturen weben
  const cloth = detailImage('clothDetail'), denim = detailImage('denimDetail'), leather = detailImage('leatherDetail');
  weaveTextures(zsh, cloth, { repeat: 9, colorAlpha: 0.4, bumpAlpha: 0.75 });
  weaveTextures(zp, denim || cloth, { repeat: 7, colorAlpha: 0.3, bumpAlpha: 0.6 });
  weaveTextures(za, cloth, { repeat: 6, colorAlpha: 0.22, bumpAlpha: 0.5 });
  weaveTextures(zs, leather, { repeat: 5, colorAlpha: 0.16, bumpAlpha: 0.45 });
  weaveTextures(zh, leather, { repeat: 4, colorAlpha: 0.1, bumpAlpha: 0.3 });
  M.zombie = {
    skin: masked(std({ map: zs.map, bumpMap: zs.bump, bumpScale: 1.6, roughness: 0.62 })),
    head: masked(std({ map: zh.map, bumpMap: zh.bump, bumpScale: 1.6, roughness: 0.6 })),
    shirt: masked(std({ map: zsh.map, bumpMap: zsh.bump, bumpScale: 1.2, roughness: 0.92, side: THREE.DoubleSide })),
    pants: masked(std({ map: zp.map, bumpMap: zp.bump, bumpScale: 1.2, roughness: 0.92, side: THREE.DoubleSide })),
    apron: std({ map: za.map, bumpMap: za.bump, bumpScale: 1, roughness: 0.85, side: THREE.DoubleSide }),
    tie: std({ color: 0x9a9a9a, roughness: 0.6, side: THREE.DoubleSide }),
    hardhat: std({ map: hh.map, bumpMap: hh.bump, bumpScale: 0.6, roughness: 0.45 }),
    tints: {
      skin: [[0.4, 0.42, 0.33], [0.37, 0.37, 0.32], [0.42, 0.37, 0.3], [0.31, 0.33, 0.27], [0.39, 0.39, 0.4], [0.3, 0.24, 0.19], [0.38, 0.4, 0.3], [0.36, 0.33, 0.33]].map(tint(0.62)),
      shirt: [[0.36, 0.33, 0.27], [0.16, 0.2, 0.28], [0.32, 0.1, 0.08], [0.3, 0.3, 0.31], [0.2, 0.24, 0.16], [0.4, 0.38, 0.32], [0.45, 0.44, 0.4], [0.12, 0.13, 0.15], [0.42, 0.28, 0.12], [0.2, 0.3, 0.38]].map(tint(0.72)),
      pants: [[0.15, 0.17, 0.22], [0.28, 0.24, 0.18], [0.12, 0.12, 0.12], [0.3, 0.32, 0.28], [0.18, 0.22, 0.3], [0.32, 0.3, 0.25]].map(tint(0.72)),
    },
    eye: new THREE.MeshBasicMaterial({ color: new THREE.Color(6.0, 2.4, 0.3) }),
    teeth: std({ color: 0x8a7a55, roughness: 0.45 }),
    hair: std({ color: 0x14110f, roughness: 0.95 }),
    shoe: std({ color: 0x17120e, roughness: 0.65 }),
    gore: std({ color: 0xffffff, vertexColors: true, roughness: 0.3 }),
  };

  return M;
}
