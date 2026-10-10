import * as THREE from 'three';
import * as T from './textures.js';

// Erzeugt alle gemeinsam genutzten Materialien einmalig.
export function buildMaterials(onProgress = () => {}) {
  const M = {};
  const step = (label) => onProgress(label);
  const std = (o) => new THREE.MeshStandardMaterial(o);

  step('Wände');
  // Weltmaterialien: Normal-Map (Tiefe) statt Bump, Rauheit aus der Textur (nasse Stellen glänzen)
  const surf = (t, o = {}) => {
    const m = { map: t.map, ...o };
    if (t.normal) { m.normalMap = t.normal; m.normalScale = new THREE.Vector2(o.ns ?? 1, o.ns ?? 1); }
    else { m.bumpMap = t.bump; m.bumpScale = o.bs ?? 1.5; }
    if (t.rough) { m.roughnessMap = t.rough; m.roughness = o.rough ?? 1; }
    if (t.rough && o.metalMap) m.metalnessMap = t.rough; // Blau-Kanal: blankes Metall 1, Rost 0
    delete m.ns; delete m.bs; delete m.rough; delete m.metalMap;
    return std(m);
  };
  const wall = T.plasterWall(3);
  M.wall = surf(wall, { roughness: 0.92 });

  step('Böden');
  const con = T.concrete(1, [1.0, 0.98, 0.94]);
  M.floorConcrete = surf(con, { roughness: 0.85 });
  const dirty = T.concrete(2, [0.95, 0.92, 0.85], 1);
  M.floorDirty = surf(dirty, { roughness: 0.7 });
  const tiles = T.checkerTiles(11);
  M.floorTiles = surf(tiles, { roughness: 0.35, metalness: 0.0 });
  const cob = T.cobble(13);
  M.floorCobble = surf(cob, { roughness: 0.8 });
  const dt = T.dirt(17);
  for (const t of [dt.map, dt.normal, dt.rough]) if (t) t.repeat.set(50, 50);
  M.ground = surf(dt, { roughness: 0.95 });

  step('Decken & Holz');
  const ce = T.ceiling(5);
  M.ceiling = surf(ce, { roughness: 0.95 });
  const pl = T.planks(7);
  M.wood = surf(pl, { roughness: 0.8 });
  const pl2 = T.planks(8, [0.75, 0.8, 0.85], 6);
  M.woodDark = surf(pl2, { roughness: 0.85 });
  const board = T.planks(9, [1.1, 1.0, 0.9], 1);
  M.board = surf(board, { roughness: 0.85 });

  step('Metall');
  const mt = T.metal(19, 0.5);
  M.metal = surf(mt, { roughness: 0.55, metalness: 0.75, metalMap: true });
  const rust = T.metal(20, 1.2);
  M.rust = surf(rust, { roughness: 0.8, metalness: 0.45, metalMap: true });
  const sh = T.shutter(23);
  M.shutter = surf(sh, { roughness: 0.6, metalness: 0.6, metalMap: true });
  const gm = T.metal(21, 0.05, [0.12, 0.12, 0.13]);
  M.gunMetal = surf(gm, { roughness: 0.35, metalness: 0.9, ns: 0.5, metalMap: true });
  M.gunPolymer = std({ color: 0x1b1c1e, roughness: 0.7, metalness: 0.1 });
  M.gunWood = std({ map: pl.map, color: 0xb07a4f, roughness: 0.55 });
  M.paintRed = std({ color: 0x6d1410, roughness: 0.6, metalness: 0.3 });
  M.paintGreen = std({ color: 0x2c3a2a, roughness: 0.7, metalness: 0.2 });
  M.chrome = std({ color: 0xcfd3d6, roughness: 0.3, metalness: 1.0 });
  M.leather = std({ color: 0x4a1612, roughness: 0.55 });
  M.cloth = std({ color: 0x1e2226, roughness: 0.95 });
  M.glove = std({ color: 0x23201d, roughness: 0.8 });
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
    papCamo: T.papCamo(41),
    boxSide: T.boxSide(),
    moon: T.moon(),
  };
  M.tex.papCamo.repeat.set(2, 2);
  M.papGun = std({ map: M.tex.papCamo, color: 0x8070a0, emissive: 0x5020d0, emissiveMap: M.tex.papCamo, emissiveIntensity: 0.3, roughness: 0.3, metalness: 0.8 });

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
