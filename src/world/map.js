// ─────────────────────────────────────────────────────────────
//  Generische Karte: Raster, Navigation, Kollision, Barrikaden, Türen,
//  Licht und Umgebung. Der Inhalt (Layout, Deko, Lichter, Spots) kommt
//  aus einer Kartendefinition in src/maps/.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL, WALL_H } from '../config.js';
import { rand, smooth, clamp, damp } from '../core/utils.js';
import * as P from './props.js';
import * as T from '../core/textures.js';
import { LightPool } from './lightpool.js';

export const WALLDIR = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] };
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const BOARDS = 6;
export const SILL = 1.0, LINTEL = 2.6, DOOR_H = 3.2;
const ZERO4 = new THREE.Matrix4().makeScale(0, 0, 0);

export function worldUV(geo, scale) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); }
    else if (ax >= az) { u = p.getZ(i); v = p.getY(i); }
    else { u = p.getX(i); v = p.getY(i); }
    uv.setXY(i, u / scale, v / scale);
  }
  uv.needsUpdate = true;
  return geo;
}

export class GameMap {
  constructor(def) {
    this.def = def;
    const L = def.layout();
    this.w = L.w;
    this.h = L.h;
    this.zones = def.zones;
    this.cells = [];
    this.windows = [];
    this.doors = {};
    this.navBlocked = new Set();
    this.colliders = [];
    this.lights = [];
    this.emberSources = [];
    this.power = false;
    this.anims = [];
    this.lightPool = null;
    this.initialZones = this.zones.map((z, i) => (z.open ? i : -1)).filter((i) => i >= 0);
    this.openZones = new Set(this.initialZones);

    L.cells.forEach((src, i) => {
      const c = { x: i % this.w, y: Math.floor(i / this.w), type: src.type, zone: src.zone ?? -1, door: null, window: null, mat: src.mat || null, lava: !!src.lava };
      if (c.type === 'door') {
        const id = src.door;
        if (!this.doors[id]) this.doors[id] = { id, kind: 'buy', ...def.doors[id], cells: [], open: false, progress: 0 };
        this.doors[id].cells.push(c);
        c.door = this.doors[id];
      }
      this.cells.push(c);
    });

    // Fenster: Außenseite = Nachbar ohne Dach (Spawnfläche, Außenbereich), Innenseite gegenüber
    const [sMin, sMax] = def.windowSpawn || [7, 10];
    for (const c of this.cells) {
      if (c.type !== 'window') continue;
      let best = null, bestScore = -9;
      for (const [dx, dy] of N4) {
        const out = this.get(c.x + dx, c.y + dy), inn = this.get(c.x - dx, c.y - dy);
        if (!out || !inn || inn.type !== 'floor') continue;
        let s = 0;
        if (out.type === 'spawn' || out.type === 'void') s = 3;
        else if (out.type === 'floor' && !this.zones[out.zone].ceiling) s = 2;
        else if (out.type === 'floor') s = 1;
        if (this.zones[inn.zone].ceiling) s += 1;
        if (s > bestScore) { bestScore = s; best = [dx, dy, inn.zone]; }
      }
      if (!best) continue;
      const [ox, oz, zone] = best;
      const cx = c.x * CELL + CELL / 2, cz = c.y * CELL + CELL / 2;
      const o = new THREE.Vector3(ox, 0, oz);
      const win = {
        cell: c, zone, out: o, boards: BOARDS, boardMeshes: [], occupant: null, queue: 0,
        center: new THREE.Vector3(cx, 0, cz),
        outside: new THREE.Vector3(cx + o.x * 1.45, 0, cz + o.z * 1.45),
        inside: new THREE.Vector3(cx - o.x * 1.5, 0, cz - o.z * 1.5),
        repairPoint: new THREE.Vector3(cx - o.x * 1.9, 0, cz - o.z * 1.9),
        spawn: new THREE.Vector3(cx + o.x * rand(sMin, sMax), 0, cz + o.z * rand(sMin, sMax)),
      };
      c.window = win;
      this.windows.push(win);
    }
  }

  // ── Abfragen ────────────────────────────────────────────────
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    return this.cells[y * this.w + x];
  }
  cellAt(x, z) { return this.get(Math.floor(x / CELL), Math.floor(z / CELL)); }
  center(cx, cy, out = new THREE.Vector3()) { return out.set(cx * CELL + CELL / 2, 0, cy * CELL + CELL / 2); }
  key(cx, cy) { return cy * this.w + cx; }

  playerWalkable(cx, cy) {
    const c = this.get(cx, cy);
    if (!c) return false;
    if (c.type === 'floor') return true;
    if (c.type === 'door') return c.door.open;
    return false;
  }

  zombieWalkable(cx, cy) {
    const c = this.get(cx, cy);
    if (!c) return false;
    if (c.type === 'floor') return this.openZones.has(c.zone) && !this.navBlocked.has(this.key(cx, cy));
    if (c.type === 'door') return c.door.open;
    return false;
  }

  hasCeiling(c) {
    if (c.type === 'floor') return !!this.zones[c.zone].ceiling;
    return false;
  }

  zoneAt(x, z) {
    const c = this.cellAt(x, z);
    return c && c.type === 'floor' ? c.zone : -1;
  }

  isLava(x, z) {
    const c = this.cellAt(x, z);
    return !!(c && c.lava);
  }

  // Station (benannter Bereich) an einer Weltposition
  stationAt(x, z) {
    const st = this.def.stations;
    if (!st) return null;
    const cx = x / CELL, cy = z / CELL;
    for (const s of st) {
      const [x0, y0, x1, y1] = s.rect;
      if (cx >= x0 && cx <= x1 + 1 && cy >= y0 && cy <= y1 + 1) return s;
    }
    return null;
  }

  // Strahl gegen Wände/Boden/Decke (Raster-DDA). Liefert {dist, normal, mat}
  rayCast(o, d, maxDist = 120) {
    let best = maxDist, normal = new THREE.Vector3(0, 1, 0), mat = 'stone';
    if (d.y < -1e-6) {
      const tf = -o.y / d.y;
      if (tf < best) { best = tf; normal.set(0, 1, 0); mat = 'floor'; }
    }
    let cx = Math.floor(o.x / CELL), cy = Math.floor(o.z / CELL);
    const sx = d.x > 0 ? 1 : -1, sy = d.z > 0 ? 1 : -1;
    const tdx = d.x !== 0 ? Math.abs(CELL / d.x) : Infinity;
    const tdy = d.z !== 0 ? Math.abs(CELL / d.z) : Infinity;
    let tmx = d.x !== 0 ? (d.x > 0 ? (cx + 1) * CELL - o.x : o.x - cx * CELL) / Math.abs(d.x) : Infinity;
    let tmy = d.z !== 0 ? (d.z > 0 ? (cy + 1) * CELL - o.z : o.z - cy * CELL) / Math.abs(d.z) : Infinity;
    let t = 0, side = -1;
    for (let i = 0; i < 160 && t < best; i++) {
      const c = this.get(cx, cy);
      if (c) {
        const tNext = Math.min(tmx, tmy);
        if (i > 0) {
          const y = o.y + d.y * t;
          let block = (c.type === 'wall' && y < WALL_H) || (c.type === 'door' && !c.door.open && c.door.progress < 0.5);
          if (c.type === 'door' && c.door.open && y > DOOR_H && y < WALL_H) block = true;
          if (c.type === 'window' && (y < SILL || (y > LINTEL && y < WALL_H))) block = true;
          if (block) {
            best = t;
            if (side === 0) normal.set(-sx, 0, 0); else normal.set(0, 0, -sy);
            mat = c.type === 'door' ? 'metal' : 'stone';
            break;
          }
        }
        if (d.y > 1e-6 && this.hasCeiling(c) && o.y < WALL_H) {
          const tc = (WALL_H - o.y) / d.y;
          if (tc >= t && tc <= tNext && tc < best) { best = tc; normal.set(0, -1, 0); mat = 'ceiling'; break; }
        }
      } else if (i > 0 && t > 60) break;
      if (tmx < tmy) { t = tmx; tmx += tdx; cx += sx; side = 0; }
      else { t = tmy; tmy += tdy; cy += sy; side = 1; }
    }
    return { dist: best, normal, mat };
  }

  // Kreis gegen blockierte Zellen + Prop-Kollider schieben
  collide(pos, r, walkFn, useProps = true) {
    const C = CELL;
    for (let it = 0; it < 2; it++) {
      const cx = Math.floor(pos.x / C), cy = Math.floor(pos.z / C);
      for (let y = cy - 1; y <= cy + 1; y++) {
        for (let x = cx - 1; x <= cx + 1; x++) {
          if (walkFn(x, y)) continue;
          this.pushOut(pos, r, x * C, (x + 1) * C, y * C, (y + 1) * C);
        }
      }
      if (useProps) {
        for (const b of this.colliders) {
          if (pos.x < b.minX - r - 0.5 || pos.x > b.maxX + r + 0.5 || pos.z < b.minZ - r - 0.5 || pos.z > b.maxZ + r + 0.5) continue;
          this.pushOut(pos, r, b.minX, b.maxX, b.minZ, b.maxZ);
        }
      }
    }
  }

  pushOut(pos, r, x0, x1, z0, z1) {
    const qx = clamp(pos.x, x0, x1), qz = clamp(pos.z, z0, z1);
    let dx = pos.x - qx, dz = pos.z - qz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) return false;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      pos.x += (dx / d) * (r - d);
      pos.z += (dz / d) * (r - d);
    } else {
      const l = pos.x - x0 + r, rr = x1 - pos.x + r, t = pos.z - z0 + r, b = z1 - pos.z + r;
      const m = Math.min(l, rr, t, b);
      if (m === l) pos.x = x0 - r; else if (m === rr) pos.x = x1 + r; else if (m === t) pos.z = z0 - r; else pos.z = z1 + r;
    }
    return true;
  }

  // Sichtlinie für Zombie-Navigation (mit Körperbreite)
  clearPath(a, b, r = 0.3) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return true;
    const nx = -dz / len, nz = dx / len;
    const steps = Math.ceil(len / 0.35);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const px = a.x + dx * t, pz = a.z + dz * t;
      for (const s of [-r, 0, r]) {
        if (!this.zombieWalkable(Math.floor((px + nx * s) / CELL), Math.floor((pz + nz * s) / CELL))) return false;
      }
    }
    return true;
  }

  // ── Türen & Barrikaden ──────────────────────────────────────
  openDoor(id) {
    const d = this.doors[id];
    if (!d || d.open) return false;
    d.open = true;
    (d.zones || []).forEach((z) => this.openZones.add(z));
    this.anims.push({ t: 0, dur: 1.6, fn: (k) => {
      d.progress = k;
      const s = 1 - smooth(k) * 0.96;
      d.mesh.scale.y = s;
      d.mesh.position.y = DOOR_H - (DOOR_H * s) / 2;
    } });
    return true;
  }

  removeBoard(win) {
    if (win.boards <= 0) return false;
    win.boards--;
    if (this.onBoards) this.onBoards(win);
    const b = win.boardMeshes[win.boards];
    const from = b.position.clone(), q0 = b.quaternion.clone();
    const to = from.clone().addScaledVector(win.out, rand(2.2, 3.2));
    to.y = 0.05;
    const q1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(-1, 1), rand(0, 6), rand(-1.5, 1.5)));
    this.anims.push({ t: 0, dur: 0.5, fn: (k) => {
      b.position.lerpVectors(from, to, k);
      b.position.y = from.y + (to.y - from.y) * k + Math.sin(k * Math.PI) * 0.6;
      b.quaternion.slerpQuaternions(q0, q1, k);
      if (k >= 1) b.visible = false;
    } });
    return true;
  }

  addBoard(win) {
    if (win.boards >= BOARDS) return false;
    const b = win.boardMeshes[win.boards];
    win.boards++;
    if (this.onBoards) this.onBoards(win);
    const home = b.userData.home, hq = b.userData.homeQ;
    const from = home.clone().addScaledVector(win.out, 1.8);
    from.y = home.y + 0.6;
    const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, b.rotation.y, 1.2));
    b.visible = true;
    this.anims.push({ t: 0, dur: 0.35, fn: (k) => {
      const e = smooth(k);
      b.position.lerpVectors(from, home, e);
      b.quaternion.slerpQuaternions(q0, hq, e);
    } });
    return true;
  }

  // Koop (Mitspieler): Brettanzahl vom Host übernehmen – liefert die Änderung
  setBoards(win, n) {
    const before = win.boards;
    while (win.boards > n && this.removeBoard(win));
    while (win.boards < n && this.addBoard(win));
    return win.boards - before;
  }

  setPower(on) {
    this.power = on;
    if (on) for (const id in this.doors) if (this.doors[id].kind === 'power') this.openDoor(id);
  }

  // Für eine neue Partie: Türen zu, alle Bretter dran, Strom aus
  reset() {
    this.anims.length = 0;
    this.power = false;
    this.openZones = new Set(this.initialZones);
    for (const id in this.doors) {
      const d = this.doors[id];
      d.open = false; d.progress = 0;
      d.mesh.scale.y = 1;
      d.mesh.position.y = DOOR_H / 2;
    }
    for (const win of this.windows) {
      win.boards = BOARDS;
      win.occupant = null;
      for (const b of win.boardMeshes) {
        b.visible = true;
        b.position.copy(b.userData.home);
        b.quaternion.copy(b.userData.homeQ);
      }
    }
    this.boardsDirty = true;
    if (this.def.reset) this.def.reset(this);
  }

  // ── Aufbau der Geometrie ────────────────────────────────────
  build(scene, M, ctx = {}) {
    this.scene = scene;
    this.M = M;
    this.ctx = ctx;
    this.mats = { wall: M.wall, ...(this.def.materials ? this.def.materials(M) : {}) };
    const C = CELL;
    const chunk = this.def.chunkCells || 0;
    const ck = (c) => (chunk ? `${Math.floor(c.x / chunk)},${Math.floor(c.y / chunk)}` : '0');
    const groups = new Map(); // "art|material|kachel" → Geometrien
    const push = (kind, mat, c, g) => {
      const k = `${kind}|${mat}|${ck(c)}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(g);
    };
    const box = (w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; };
    const floorOf = (c) => {
      if (c.type === 'floor') return this.zones[c.zone].floor;
      for (const [dx, dy] of N4) {
        const n = this.get(c.x + dx, c.y + dy);
        if (n && n.type === 'floor' && this.zones[n.zone].floor !== 'none') return this.zones[n.zone].floor;
      }
      return 'concrete';
    };

    for (const c of this.cells) {
      const x = c.x * C + C / 2, z = c.y * C + C / 2;
      const wm = c.mat || 'wall';
      if (c.type === 'wall') push('wall', wm, c, box(C, WALL_H, C, x, WALL_H / 2, z));
      else if (c.type === 'window') {
        push('wall', wm, c, box(C, SILL, C, x, SILL / 2, z));
        push('wall', wm, c, box(C, WALL_H - LINTEL, C, x, (LINTEL + WALL_H) / 2, z));
        if (c.window) {
          const along = c.window.out.x !== 0 ? 'z' : 'x';
          for (const s of [-1, 1]) {
            if (along === 'z') push('wall', wm, c, box(C, LINTEL - SILL, 0.3, x, (SILL + LINTEL) / 2, z + s * (C / 2 - 0.15)));
            else push('wall', wm, c, box(0.3, LINTEL - SILL, C, x + s * (C / 2 - 0.15), (SILL + LINTEL) / 2, z));
          }
        }
      } else if (c.type === 'door') {
        push('wall', wm, c, box(C, WALL_H - DOOR_H, C, x, (DOOR_H + WALL_H) / 2, z));
        const fl = floorOf(c);
        if (fl !== 'none') { const pg = new THREE.PlaneGeometry(C, C); pg.rotateX(-Math.PI / 2); pg.translate(x, 0.002, z); push('floor', fl, c, pg); }
      } else if (c.type === 'floor') {
        const zd = this.zones[c.zone];
        if (zd.floor !== 'none') {
          const pg = new THREE.PlaneGeometry(C, C); pg.rotateX(-Math.PI / 2); pg.translate(x, 0.002, z);
          push('floor', zd.floor, c, pg);
        }
        if (zd.ceiling) push('ceil', zd.ceilingMat || 'ceiling', c, box(C, 0.3, C, x, WALL_H + 0.15, z));
      }
    }

    const floorMat = {
      concrete: [M.floorConcrete, 4], tiles: [M.floorTiles, 2], dirty: [M.floorDirty, 4], cobble: [M.floorCobble, 2],
      wood: [M.wood, 2], metal: [M.metal, 2],
    };
    for (const [k, geos] of groups) {
      const [kind, key] = k.split('|');
      let mat, scale = 4;
      if (kind === 'wall') { mat = this.mats[key] || M.wall; scale = this.mats[key]?.userData?.uvScale || 4; }
      else if (kind === 'ceil') mat = this.mats[key] || M.ceiling;
      else {
        const f = this.mats['floor_' + key] ? [this.mats['floor_' + key], this.mats['floor_' + key].userData.uvScale || 4] : floorMat[key] || floorMat.concrete;
        mat = f[0]; scale = f[1];
      }
      const m = new THREE.Mesh(worldUV(mergeGeometries(geos), scale), mat);
      m.receiveShadow = true;
      m.castShadow = kind !== 'floor';
      scene.add(m);
    }

    this.buildWindows(scene, M);
    this.buildDoors(scene, M);
    this.buildBeams(scene, M);
    this.buildEnvironment(scene, M);
    if (this.def.lightPool) this.lightPool = new LightPool(scene, this.def.lightPool(ctx.quality || {}));
    if (this.def.buildDecor) this.def.buildDecor(this, scene, M);
    if (this.def.buildLights) this.def.buildLights(this, scene, M);
    // Spots für Kiste und Perks blockieren die Navigation
    for (const s of this.def.boxSpots || []) this.blockCell(s.cx, s.cy);
    for (const k in this.def.perkSpots || {}) this.blockCell(this.def.perkSpots[k].cx, this.def.perkSpots[k].cy);
  }

  buildWindows(scene, M) {
    const bgeo = new THREE.BoxGeometry(1.55, 0.17, 0.05);
    const frameMat = M.woodDark;
    // Alle Bretter als eine Instanz-Gruppe (ein Draw-Call); die Logik bewegt unsichtbare Platzhalter
    this.boardList = [];
    for (const win of this.windows) {
      const yaw = win.out.x !== 0 ? Math.PI / 2 : 0;
      const face = win.center.clone().addScaledVector(win.out, -(CELL / 2 - 0.06));
      for (let i = 0; i < BOARDS; i++) {
        const b = new THREE.Object3D();
        const tilt = (i % 2 ? 1 : -1) * rand(0.12, 0.35);
        b.position.copy(face);
        b.position.y = SILL + 0.15 + i * 0.25 + rand(-0.03, 0.03);
        b.position.addScaledVector(win.out, -0.02 * (i % 3));
        b.rotation.set(0, yaw, tilt, 'YXZ');
        b.userData.home = b.position.clone();
        b.userData.homeQ = b.quaternion.clone();
        win.boardMeshes.push(b);
        this.boardList.push(b);
      }
      const fr = new THREE.Group();
      fr.position.copy(face); fr.rotation.y = yaw;
      const fb = (w, h, x, y) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.12), frameMat); m.position.set(x, y, 0); m.castShadow = true; fr.add(m); };
      fb(1.5, 0.08, 0, SILL); fb(1.5, 0.08, 0, LINTEL); fb(0.08, LINTEL - SILL, -0.72, (SILL + LINTEL) / 2); fb(0.08, LINTEL - SILL, 0.72, (SILL + LINTEL) / 2);
      scene.add(fr);
    }
    const inst = new THREE.InstancedMesh(bgeo, M.board, Math.max(1, this.boardList.length));
    inst.castShadow = true; inst.receiveShadow = true;
    inst.frustumCulled = false;
    inst.userData.dynamic = true;
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    inst.count = this.boardList.length;
    scene.add(inst);
    this.boardInst = inst;
    this.syncBoards();
  }

  syncBoards() {
    const inst = this.boardInst;
    if (!inst) return;
    this.boardList.forEach((b, i) => {
      if (b.visible) { b.updateMatrix(); inst.setMatrixAt(i, b.matrix); } else inst.setMatrixAt(i, ZERO4);
    });
    inst.instanceMatrix.needsUpdate = true;
  }

  doorMaterial(kind, M) {
    if (kind === 'buy') return M.shutter;
    if (!this._doorMats) this._doorMats = {};
    if (!this._doorMats[kind]) {
      const tex = T.hazardDoor(kind === 'power' ? '⚡ STROM' : '⚙ TURBINE', kind === 'power' ? '#f2c230' : '#3fd0ff');
      this._doorMats[kind] = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.5 });
    }
    return this._doorMats[kind];
  }

  buildDoors(scene, M) {
    for (const id in this.doors) {
      const d = this.doors[id];
      const xs = d.cells.map((c) => c.x), ys = d.cells.map((c) => c.y);
      const cx = ((Math.min(...xs) + Math.max(...xs) + 1) * CELL) / 2;
      const cz = ((Math.min(...ys) + Math.max(...ys) + 1) * CELL) / 2;
      // Tür liegt in einer Zeile → Öffnung entlang x; bei einer Zelle entscheidet die Nachbarwand
      let horizontal = new Set(ys).size === 1 && d.cells.length > 1;
      if (d.cells.length === 1) {
        const c = d.cells[0];
        const l = this.get(c.x - 1, c.y), r = this.get(c.x + 1, c.y);
        horizontal = !!(l && r && (l.type === 'wall' || l.type === 'window') && (r.type === 'wall' || r.type === 'window'));
      }
      const width = d.cells.length * CELL;
      const g = new THREE.Mesh(new THREE.BoxGeometry(width, DOOR_H, 0.14), this.doorMaterial(d.kind, M));
      g.position.set(cx, DOOR_H / 2, cz);
      g.rotation.y = horizontal ? 0 : Math.PI / 2;
      g.castShadow = g.receiveShadow = true;
      g.userData.dynamic = true;
      scene.add(g);
      d.mesh = g;
      d.center = new THREE.Vector3(cx, 0, cz);
      d.horizontal = horizontal;
      const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, width, 16), M.metal);
      roll.rotation.z = Math.PI / 2;
      const holder = new THREE.Group();
      holder.position.set(cx, DOOR_H - 0.15, cz);
      holder.rotation.y = g.rotation.y;
      holder.add(roll);
      scene.add(holder);
    }
  }

  buildBeams(scene, M) {
    this.zones.forEach((zd, zi) => {
      if (!zd.ceiling || !zd.beams) return;
      const cs = this.cells.filter((c) => c.type === 'floor' && c.zone === zi);
      if (!cs.length) return;
      const minX = Math.min(...cs.map((c) => c.x)) * CELL, maxX = (Math.max(...cs.map((c) => c.x)) + 1) * CELL;
      const minZ = Math.min(...cs.map((c) => c.y)) * CELL, maxZ = (Math.max(...cs.map((c) => c.y)) + 1) * CELL;
      for (let z = minZ + 2; z < maxZ - 0.5; z += 4) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(maxX - minX, 0.32, 0.22), zd.beams === 'rust' ? M.rust : M.woodDark);
        b.position.set((minX + maxX) / 2, WALL_H - 0.16, z);
        b.castShadow = true;
        scene.add(b);
      }
      if (zd.pipes) {
        for (const off of [0.6, 1.0]) {
          const p = P.pipe(M, maxX - minX, 0.07);
          p.position.set((minX + maxX) / 2, WALL_H - 0.45 - off * 0.2, minZ + off);
          scene.add(p);
        }
      }
    });
  }

  place(obj, cx, cy, wall = null, depth = 0.8, ox = 0, oz = 0) {
    const p = this.center(cx, cy);
    if (wall) {
      const [dx, dz] = WALLDIR[wall];
      p.x += dx * (CELL / 2 - depth / 2 - 0.02);
      p.z += dz * (CELL / 2 - depth / 2 - 0.02);
      obj.rotation.y = Math.atan2(-dx, -dz);
    }
    p.x += ox; p.z += oz;
    obj.position.set(p.x, obj.position.y, p.z);
    this.scene.add(obj);
    return obj;
  }

  blockCell(cx, cy, collider = null) {
    this.navBlocked.add(this.key(cx, cy));
    if (collider) this.colliders.push(collider);
  }

  aabb(obj, pad = 0) {
    const b = new THREE.Box3().setFromObject(obj);
    return { minX: b.min.x - pad, maxX: b.max.x + pad, minZ: b.min.z - pad, maxZ: b.max.z + pad };
  }

  // tier: 1 = immer an, 2 = ab Qualität "mittel", 3 = nur "hoch"
  addLight(light, { flicker = 0, poweredOnly = false, offFactor = 0.35, base = light.intensity, tier = 1 } = {}) {
    light.userData.tier = tier;
    const entry = { light, base, flicker, poweredOnly, offFactor, phase: rand(0, 100), bulb: null };
    this.lights.push(entry);
    return entry;
  }

  // Himmel, Nebel, Mond, Grundlicht
  buildEnvironment(scene, M) {
    const env = this.def.env || {};
    const C = CELL;
    scene.background = new THREE.Color(env.background ?? 0x05070c);
    this.fogBase = env.fogDensity ?? 0.032;
    scene.fog = new THREE.FogExp2(env.fogColor ?? 0x0b0f16, this.fogBase);
    const hemi = new THREE.HemisphereLight(env.hemiSky ?? 0x51607c, env.hemiGround ?? 0x15110d, env.hemi ?? 0.55);
    scene.add(hemi);
    this.hemi = hemi;

    const moon = new THREE.DirectionalLight(env.moonColor ?? 0x9fb4e0, env.moon ?? 1.1);
    const cx = (this.w * C) / 2, cz = (this.h * C) / 2;
    this.moonOffset = new THREE.Vector3(-30, 55, -40);
    moon.position.set(cx, 0, cz).add(this.moonOffset);
    moon.target.position.set(cx, 0, cz);
    moon.castShadow = true;
    moon.userData.shadowTier = 1;
    const sc = moon.shadow.camera;
    const sb = env.shadowBox ?? 32;
    sc.left = -sb; sc.right = sb; sc.top = sb; sc.bottom = -sb; sc.near = 10; sc.far = 160;
    moon.shadow.mapSize.set(2048, 2048);
    moon.shadow.bias = -0.0005; moon.shadow.normalBias = 0.04;
    scene.add(moon, moon.target);
    this.moon = moon;

    const N = 1600, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const th = Math.random() * Math.PI * 2, ph = Math.acos(rand(0.15, 1));
      const r = 300;
      pos[i * 3] = Math.sin(ph) * Math.cos(th) * r;
      pos[i * 3 + 1] = Math.cos(ph) * r;
      pos[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * r;
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.sky = new THREE.Group();
    this.sky.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xaab4cc, size: 1.4, sizeAttenuation: false, fog: false })));
    const moonSpr = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.tex.moon, color: new THREE.Color(2.2, 2.2, 2.4), fog: false, depthWrite: false }));
    moonSpr.position.copy(this.moonOffset).normalize().multiplyScalar(250);
    moonSpr.scale.set(26, 26, 1);
    this.sky.add(moonSpr);
    this.sky.position.set(cx, 0, cz);
    this.sky.userData.dynamic = true;
    scene.add(this.sky);
  }

  // ── Laufzeit ────────────────────────────────────────────────
  update(dt, time, camPos) {
    const boardsMoving = this.anims.length > 0 || this.boardsDirty;
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const a = this.anims[i];
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      a.fn(k);
      if (k >= 1) this.anims.splice(i, 1);
    }
    if (boardsMoving) { this.syncBoards(); this.boardsDirty = false; }
    for (const e of this.lights) {
      let f = 1;
      if (e.flicker > 0) {
        e.phase += dt;
        const n = Math.sin(e.phase * 13) * Math.sin(e.phase * 7.3 + 1) * Math.sin(e.phase * 2.1);
        f = 1 - e.flicker * 0.25 * (n * 0.5 + 0.5);
        if (Math.random() < e.flicker * 0.012) f *= 0.15; // kurzes Aussetzen
      }
      const pf = this.power ? 1 : e.poweredOnly ? 0 : e.offFactor;
      e.light.intensity = e.base * f * pf;
      if (e.bulb) e.bulb.material.color.setRGB(5 * f * pf + 0.05, 3.6 * f * pf + 0.04, 2.2 * f * pf + 0.03);
    }
    if (camPos) {
      if (this.lightPool) this.lightPool.update(dt, camPos, this.power);
      // Große Karten: Mondschatten und Himmel folgen der Kamera (auf Raster eingerastet → kein Flimmern)
      if (this.def.env && this.def.env.moonFollow) {
        const sx = Math.round(camPos.x / 4) * 4, sz = Math.round(camPos.z / 4) * 4;
        this.moon.target.position.set(sx, 0, sz);
        this.moon.position.set(sx, 0, sz).add(this.moonOffset);
        this.moon.target.updateMatrixWorld();
        this.sky.position.set(camPos.x, 0, camPos.z);
      }
    }
    if (this.def.update) this.def.update(this, dt, time, camPos);
  }
}
