import * as THREE from 'three';
import * as T from './textures.js';

// Erzeugt alle gemeinsam genutzten Materialien einmalig.
export function buildMaterials(onProgress = () => {}) {
  const M = {};
  const step = (label) => onProgress(label);
  const std = (o) => new THREE.MeshStandardMaterial(o);

  step('Wände');
  const wall = T.plasterWall(3);
  M.wall = std({ map: wall.map, bumpMap: wall.bump, bumpScale: 2.0, roughness: 0.92 });

  step('Böden');
  const con = T.concrete(1, [1.0, 0.98, 0.94]);
  M.floorConcrete = std({ map: con.map, bumpMap: con.bump, bumpScale: 1.2, roughness: 0.85 });
  const dirty = T.concrete(2, [0.95, 0.92, 0.85], 1);
  M.floorDirty = std({ map: dirty.map, bumpMap: dirty.bump, bumpScale: 1.2, roughness: 0.7 });
  const tiles = T.checkerTiles(11);
  M.floorTiles = std({ map: tiles.map, bumpMap: tiles.bump, bumpScale: 1.0, roughness: 0.35, metalness: 0.0 });
  const cob = T.cobble(13);
  M.floorCobble = std({ map: cob.map, bumpMap: cob.bump, bumpScale: 3.0, roughness: 0.8 });
  const dt = T.dirt(17);
  dt.map.repeat.set(50, 50); dt.bump.repeat.set(50, 50);
  M.ground = std({ map: dt.map, bumpMap: dt.bump, bumpScale: 2.0, roughness: 0.95 });

  step('Decken & Holz');
  const ce = T.ceiling(5);
  M.ceiling = std({ map: ce.map, bumpMap: ce.bump, bumpScale: 1.0, roughness: 0.95 });
  const pl = T.planks(7);
  M.wood = std({ map: pl.map, bumpMap: pl.bump, bumpScale: 1.5, roughness: 0.8 });
  const pl2 = T.planks(8, [0.75, 0.8, 0.85], 6);
  M.woodDark = std({ map: pl2.map, bumpMap: pl2.bump, bumpScale: 1.5, roughness: 0.85 });
  const board = T.planks(9, [1.1, 1.0, 0.9], 1);
  M.board = std({ map: board.map, bumpMap: board.bump, bumpScale: 1.5, roughness: 0.85 });

  step('Metall');
  const mt = T.metal(19, 0.5);
  M.metal = std({ map: mt.map, bumpMap: mt.bump, bumpScale: 1.0, roughness: 0.55, metalness: 0.75 });
  const rust = T.metal(20, 1.2);
  M.rust = std({ map: rust.map, bumpMap: rust.bump, bumpScale: 2.0, roughness: 0.8, metalness: 0.45 });
  const sh = T.shutter(23);
  M.shutter = std({ map: sh.map, bumpMap: sh.bump, bumpScale: 3.0, roughness: 0.6, metalness: 0.6 });
  const gm = T.metal(21, 0.05, [0.12, 0.12, 0.13]);
  M.gunMetal = std({ map: gm.map, bumpMap: gm.bump, bumpScale: 0.5, roughness: 0.35, metalness: 0.9 });
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
  // Neutrale Texturen + Farbton pro Instanz (spart Speicher und Draw-Calls)
  const tint = (base) => (c) => new THREE.Color().setRGB(c[0] / base, c[1] / base, c[2] / base, THREE.SRGBColorSpace);
  const zs = T.skin(60, [0.62, 0.62, 0.6]);
  const zsh = T.fabric(70, [0.72, 0.72, 0.72], 0.7);
  const zp = T.fabric(80, [0.6, 0.6, 0.6], 0.35);
  M.zombie = {
    skin: std({ map: zs.map, bumpMap: zs.bump, bumpScale: 1.5, roughness: 0.75 }),
    shirt: std({ map: zsh.map, bumpMap: zsh.bump, bumpScale: 1, roughness: 0.95 }),
    pants: std({ map: zp.map, bumpMap: zp.bump, bumpScale: 1, roughness: 0.95 }),
    tints: {
      skin: [[0.47, 0.49, 0.4], [0.42, 0.42, 0.37], [0.5, 0.45, 0.38], [0.36, 0.37, 0.32]].map(tint(0.62)),
      shirt: [[0.36, 0.33, 0.27], [0.16, 0.2, 0.28], [0.32, 0.1, 0.08], [0.3, 0.3, 0.31], [0.2, 0.24, 0.16], [0.4, 0.38, 0.32]].map(tint(0.72)),
      pants: [[0.15, 0.17, 0.22], [0.28, 0.24, 0.18], [0.12, 0.12, 0.12], [0.3, 0.32, 0.28]].map(tint(0.6)),
    },
    eye: new THREE.MeshBasicMaterial({ color: new THREE.Color(6.0, 2.4, 0.3) }),
    teeth: std({ color: 0x8f8466, roughness: 0.5 }),
    mouth: std({ color: 0x1a0505, roughness: 0.6 }),
    hair: std({ color: 0x161310, roughness: 0.9 }),
    shoe: std({ color: 0x15110e, roughness: 0.7 }),
    gore: std({ color: 0x4a0606, roughness: 0.35 }),
  };

  return M;
}
