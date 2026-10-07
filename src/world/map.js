// ─────────────────────────────────────────────────────────────
//  Karte "Station Nachtfall": Geometrie, Navigation, Kollision,
//  Barrikaden, Türen, Licht und Dekoration.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL, WALL_H, MAP, DOORS, ZONES, BOX_SPOTS, PERK_SPOTS } from '../config.js';
import { rand, smooth, clamp } from '../core/utils.js';
import * as P from './props.js';
import * as T from '../core/textures.js';

export const WALLDIR = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] };
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BOARDS = 6;
const SILL = 1.0, LINTEL = 2.6, DOOR_H = 3.2;

function worldUV(geo, scale) {
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
  constructor() {
    this.h = MAP.length;
    this.w = MAP[0].length;
    this.cells = [];
    this.windows = [];
    this.doors = {};
    this.openZones = new Set([0]);
    this.navBlocked = new Set();
    this.colliders = [];
    this.lights = [];
    this.power = false;
    this.anims = [];

    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const ch = MAP[y][x];
        const c = { x, y, type: 'void', zone: -1, door: null, window: null };
        if (ch === '#') c.type = 'wall';
        else if (ch >= '0' && ch <= '9') { c.type = 'floor'; c.zone = +ch; }
        else if (ch >= 'A' && ch <= 'Z') {
          c.type = 'door';
          if (!this.doors[ch]) this.doors[ch] = { id: ch, ...DOORS[ch], cells: [], open: false, progress: 0 };
          this.doors[ch].cells.push(c);
          c.door = this.doors[ch];
        } else if (ch === 'w') c.type = 'window';
        else if (ch === 's') c.type = 'spawn';
        this.cells.push(c);
      }
    }

    for (const c of this.cells) {
      if (c.type !== 'window') continue;
      let out = null, zone = -1;
      for (const [dx, dy] of N4) {
        const n = this.get(c.x + dx, c.y + dy);
        if (!n) continue;
        if (n.type === 'spawn') out = [dx, dy];
        if (n.type === 'floor') zone = n.zone;
      }
      const cx = c.x * CELL + CELL / 2, cz = c.y * CELL + CELL / 2;
      const o = new THREE.Vector3(out[0], 0, out[1]);
      const win = {
        cell: c, zone, out: o, boards: BOARDS, boardMeshes: [], occupant: null, queue: 0,
        center: new THREE.Vector3(cx, 0, cz),
        outside: new THREE.Vector3(cx + o.x * 1.45, 0, cz + o.z * 1.45),
        inside: new THREE.Vector3(cx - o.x * 1.5, 0, cz - o.z * 1.5),
        repairPoint: new THREE.Vector3(cx - o.x * 1.9, 0, cz - o.z * 1.9),
        spawn: new THREE.Vector3(cx + o.x * rand(7, 10), 0, cz + o.z * rand(7, 10)),
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
    if (c.type === 'floor') return ZONES[c.zone].ceiling;
    return false;
  }

  zoneAt(x, z) {
    const c = this.cellAt(x, z);
    return c && c.type === 'floor' ? c.zone : -1;
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
    for (let i = 0; i < 128 && t < best; i++) {
      const c = this.get(cx, cy);
      if (c) {
        const tNext = Math.min(tmx, tmy);
        if (i > 0) {
          const y = o.y + d.y * t;
          let block = c.type === 'wall' || (c.type === 'door' && !c.door.open && c.door.progress < 0.5);
          if (c.type === 'door' && c.door.open && y > DOOR_H) block = true;
          if (c.type === 'window' && (y < SILL || y > LINTEL)) block = true;
          if (block) {
            best = t;
            if (side === 0) normal.set(-sx, 0, 0); else normal.set(0, 0, -sy);
            mat = c.type === 'door' ? 'metal' : 'stone';
            break;
          }
        }
        if (d.y > 1e-6 && this.hasCeiling(c)) {
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
      if (useProps) for (const b of this.colliders) this.pushOut(pos, r, b.minX, b.maxX, b.minZ, b.maxZ);
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
    if (d.open) return;
    d.open = true;
    d.zones.forEach((z) => this.openZones.add(z));
    this.anims.push({ t: 0, dur: 1.6, fn: (k) => {
      d.progress = k;
      const s = 1 - smooth(k) * 0.96;
      d.mesh.scale.y = s;
      d.mesh.position.y = DOOR_H - (DOOR_H * s) / 2;
    } });
  }

  removeBoard(win) {
    if (win.boards <= 0) return false;
    win.boards--;
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

  setPower(on) {
    this.power = on;
  }

  // Für eine neue Partie: Türen zu, alle Bretter dran, Strom aus
  reset() {
    this.anims.length = 0;
    this.power = false;
    this.openZones = new Set([0]);
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
  }

  // ── Aufbau der Geometrie ────────────────────────────────────
  build(scene, M) {
    this.scene = scene;
    this.M = M;
    const C = CELL;
    const walls = [], floors = { concrete: [], tiles: [], dirty: [], cobble: [] }, ceil = [];
    const add = (arr, w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); arr.push(g); };

    for (const c of this.cells) {
      const x = c.x * C + C / 2, z = c.y * C + C / 2;
      if (c.type === 'wall') add(walls, C, WALL_H, C, x, WALL_H / 2, z);
      else if (c.type === 'window') {
        add(walls, C, SILL, C, x, SILL / 2, z);
        add(walls, C, WALL_H - LINTEL, C, x, (LINTEL + WALL_H) / 2, z);
        const along = c.window.out.x !== 0 ? 'z' : 'x';
        for (const s of [-1, 1]) {
          if (along === 'z') add(walls, C, LINTEL - SILL, 0.3, x, (SILL + LINTEL) / 2, z + s * (C / 2 - 0.15));
          else add(walls, 0.3, LINTEL - SILL, C, x + s * (C / 2 - 0.15), (SILL + LINTEL) / 2, z);
        }
      } else if (c.type === 'door') {
        add(walls, C, WALL_H - DOOR_H, C, x, (DOOR_H + WALL_H) / 2, z);
        const pg = new THREE.PlaneGeometry(C, C); pg.rotateX(-Math.PI / 2); pg.translate(x, 0.001, z);
        floors.concrete.push(pg);
      } else if (c.type === 'floor') {
        const pg = new THREE.PlaneGeometry(C, C); pg.rotateX(-Math.PI / 2); pg.translate(x, 0.001, z);
        floors[ZONES[c.zone].floor].push(pg);
        if (ZONES[c.zone].ceiling) add(ceil, C, 0.3, C, x, WALL_H + 0.15, z);
      }
    }

    const wallMesh = new THREE.Mesh(worldUV(mergeGeometries(walls), 4), M.wall);
    wallMesh.castShadow = wallMesh.receiveShadow = true;
    scene.add(wallMesh);
    const ceilMesh = new THREE.Mesh(worldUV(mergeGeometries(ceil), 4), M.ceiling);
    ceilMesh.castShadow = ceilMesh.receiveShadow = true;
    scene.add(ceilMesh);
    const fmat = { concrete: [M.floorConcrete, 4], tiles: [M.floorTiles, 2], dirty: [M.floorDirty, 4], cobble: [M.floorCobble, 2] };
    for (const k in floors) {
      if (!floors[k].length) continue;
      const m = new THREE.Mesh(worldUV(mergeGeometries(floors[k]), fmat[k][1]), fmat[k][0]);
      m.receiveShadow = true;
      scene.add(m);
    }

    // Außengelände
    const gsize = 240;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(gsize, gsize), M.ground);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((this.w * C) / 2, -0.01, (this.h * C) / 2);
    ground.receiveShadow = true;
    scene.add(ground);

    this.buildWindows(scene, M);
    this.buildDoors(scene, M);
    this.buildBeams(scene, M);
    this.buildDecor(scene, M);
    this.buildLights(scene, M);
    this.buildSky(scene, M);
  }

  buildWindows(scene, M) {
    const bgeo = new THREE.BoxGeometry(1.55, 0.17, 0.05);
    const frameMat = M.woodDark;
    for (const win of this.windows) {
      const yaw = win.out.x !== 0 ? Math.PI / 2 : 0;
      const face = win.center.clone().addScaledVector(win.out, -(CELL / 2 - 0.06));
      for (let i = 0; i < BOARDS; i++) {
        const b = new THREE.Mesh(bgeo, M.board);
        b.castShadow = true; b.receiveShadow = true;
        const tilt = (i % 2 ? 1 : -1) * rand(0.12, 0.35);
        b.position.copy(face);
        b.position.y = SILL + 0.15 + i * 0.25 + rand(-0.03, 0.03);
        b.position.addScaledVector(win.out, -0.02 * (i % 3));
        b.rotation.set(0, yaw, tilt, 'YXZ');
        b.userData.home = b.position.clone();
        b.userData.homeQ = b.quaternion.clone();
        b.userData.dynamic = true;
        scene.add(b);
        win.boardMeshes.push(b);
      }
      // Rahmen
      const fr = new THREE.Group();
      fr.position.copy(face); fr.rotation.y = yaw;
      const fb = (w, h, x, y) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.12), frameMat); m.position.set(x, y, 0); m.castShadow = true; fr.add(m); };
      fb(1.5, 0.08, 0, SILL); fb(1.5, 0.08, 0, LINTEL); fb(0.08, LINTEL - SILL, -0.72, (SILL + LINTEL) / 2); fb(0.08, LINTEL - SILL, 0.72, (SILL + LINTEL) / 2);
      scene.add(fr);
    }
  }

  buildDoors(scene, M) {
    for (const id in this.doors) {
      const d = this.doors[id];
      const xs = d.cells.map((c) => c.x), ys = d.cells.map((c) => c.y);
      const cx = ((Math.min(...xs) + Math.max(...xs) + 1) * CELL) / 2;
      const cz = ((Math.min(...ys) + Math.max(...ys) + 1) * CELL) / 2;
      const horizontal = new Set(ys).size === 1; // Tür liegt in einer Zeile → Öffnung entlang x
      const width = d.cells.length * CELL;
      const g = new THREE.Mesh(new THREE.BoxGeometry(width, DOOR_H, 0.14), M.shutter);
      g.position.set(cx, DOOR_H / 2, cz);
      g.rotation.y = horizontal ? 0 : Math.PI / 2;
      g.castShadow = g.receiveShadow = true;
      g.userData.dynamic = true;
      scene.add(g);
      d.mesh = g;
      d.center = new THREE.Vector3(cx, 0, cz);
      d.horizontal = horizontal;
      // Rollladenkasten
      const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, width, 16), M.metal);
      roll.rotation.z = Math.PI / 2;
      roll.position.set(0, 0, 0);
      const holder = new THREE.Group();
      holder.position.set(cx, DOOR_H - 0.15, cz);
      holder.rotation.y = g.rotation.y;
      holder.add(roll);
      scene.add(holder);
    }
  }

  buildBeams(scene, M) {
    for (let zi = 0; zi < ZONES.length; zi++) {
      if (!ZONES[zi].ceiling) continue;
      const cs = this.cells.filter((c) => c.type === 'floor' && c.zone === zi);
      const minX = Math.min(...cs.map((c) => c.x)) * CELL, maxX = (Math.max(...cs.map((c) => c.x)) + 1) * CELL;
      const minZ = Math.min(...cs.map((c) => c.y)) * CELL, maxZ = (Math.max(...cs.map((c) => c.y)) + 1) * CELL;
      for (let z = minZ + 2; z < maxZ - 0.5; z += 4) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(maxX - minX, 0.32, 0.22), zi === 2 ? M.rust : M.woodDark);
        b.position.set((minX + maxX) / 2, WALL_H - 0.16, z);
        b.castShadow = true;
        scene.add(b);
      }
      if (zi === 2) {
        for (const off of [0.6, 1.0]) {
          const p = P.pipe(M, maxX - minX, 0.07);
          p.position.set((minX + maxX) / 2, WALL_H - 0.45 - off * 0.2, minZ + off);
          scene.add(p);
        }
      }
    }
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

  buildDecor(scene, M) {
    const solid = (obj, cx, cy, wall, depth, block = true, ox = 0, oz = 0) => {
      this.place(obj, cx, cy, wall, depth, ox, oz);
      obj.updateMatrixWorld(true);
      if (block) this.blockCell(cx, cy, this.aabb(obj, 0.02));
      else this.colliders.push(this.aabb(obj, 0.02));
      return obj;
    };

    // Zone 0 – Depot-Halle
    const cr = new THREE.Group();
    const a = P.crate(M, 1.1); cr.add(a);
    const b = P.crate(M, 0.9); b.position.set(0.05, 1.1, 0.05); b.rotation.y = 0.3; cr.add(b);
    const c2 = P.crate(M, 0.8); c2.position.set(-0.2, 0, 1.0); c2.rotation.y = -0.2; cr.add(c2);
    solid(cr, 11, 9, null, 0, true, 0.2, -0.2);
    const bar = new THREE.Group();
    [[0, 0], [0.62, 0.1], [0.25, 0.55]].forEach(([x, z]) => { const br = P.barrel(M); br.position.set(x, 0, z); bar.add(br); });
    solid(bar, 2, 9, null, 0, true, -0.3, 0.2);
    const t0 = P.table(M); t0.rotation.y = 0.4; solid(t0, 7, 4, null, 0, false);
    this.place(P.chair(M), 7, 4, null, 0, 0.9, 0.5);
    this.place(P.chair(M, true), 6, 4, null, 0, 0.3, -0.4);
    const sh0 = P.shelf(M); solid(sh0, 11, 5, 'E', 0.5, false);

    // Zone 1 – Diner
    const ctr = P.counter(M, 5.0); solid(ctr, 16, 4, null, 0, false, -0.5, -0.2);
    this.blockCell(15, 4); this.blockCell(16, 4); this.blockCell(17, 4);
    const bo1 = P.booth(M); solid(bo1, 20, 5, null, 0, true);
    const bo2 = P.booth(M); solid(bo2, 20, 8, null, 0, true);
    const neon = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.75), new THREE.MeshBasicMaterial({ map: T.textSign('DINER', '#ff2f6a', '#000', 512, 160), transparent: true, blending: THREE.AdditiveBlending, color: new THREE.Color(2.2, 2.2, 2.2) }));
    neon.position.y = 3.0; this.place(neon, 14, 2, 'N', 0.02);
    this.neon = neon;

    // Zone 2 – Werkstatt
    const wb = P.workbench(M); solid(wb, 10, 11, 'N', 0.8, true);
    const gen = P.generator(M); gen.rotation.y = 0.2; solid(gen, 7, 15, null, 0, true);
    const bar2 = new THREE.Group();
    [[0, 0], [0.65, 0], [0.3, 0.6]].forEach(([x, z]) => { const br = P.barrel(M, M.paintRed); br.position.set(x, 0, z); bar2.add(br); });
    solid(bar2, 2, 18, null, 0, true, -0.2, 0.2);
    const sh2 = P.shelf(M); solid(sh2, 11, 14, 'E', 0.5, false);

    // Zone 3 – Innenhof
    const tr = P.tree(M, 7); solid(tr, 20, 15, null, 0, true);
    this.colliders[this.colliders.length - 1] = { minX: tr.position.x - 0.3, maxX: tr.position.x + 0.3, minZ: tr.position.z - 0.3, maxZ: tr.position.z + 0.3 };
    const fb = P.fireBarrel(M); solid(fb, 14, 16, null, 0, false, -0.3, 0.3);
    this.fireBarrelPos = fb.position.clone();
    const lp = P.lampPost(M); this.place(lp, 21, 12, null, 0, 0.6, -0.6);
    this.colliders.push({ minX: lp.position.x - 0.12, maxX: lp.position.x + 0.12, minZ: lp.position.z - 0.12, maxZ: lp.position.z + 0.12 });

    // Mystery-Kisten-Plätze und Perk-Automaten blockieren Navigation
    for (const s of BOX_SPOTS) this.blockCell(s.cx, s.cy);
    for (const k in PERK_SPOTS) this.blockCell(PERK_SPOTS[k].cx, PERK_SPOTS[k].cy);

    // Poster und Blut an Wänden/Böden
    const posters = [['VERMISST', 3, 2, 'N', 0.9], ['QUARANTÄNE', 9, 9, 'S', 0], ['GESCHLOSSEN', 22, 5, 'E', 0], ['WARNUNG', 3, 18, 'S', 0.3]];
    posters.forEach(([title, cx, cy, w, ox], i) => {
      const pm = P.wallPoster(M, T.poster(100 + i, title));
      pm.position.y = 1.9;
      this.place(pm, cx, cy, w, 0.0, w === 'N' || w === 'S' ? ox : 0, 0);
      pm.rotation.z = rand(-0.06, 0.06);
    });
    const bloodMats = M.tex.blood.map((t) => new THREE.MeshStandardMaterial({ map: t, transparent: true, depthWrite: false, roughness: 0.3, polygonOffset: true, polygonOffsetFactor: -2 }));
    for (let i = 0; i < 16; i++) {
      const fc = this.cells.filter((c) => c.type === 'floor');
      const c = fc[Math.floor(Math.random() * fc.length)];
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bloodMats[i % 3]);
      m.rotation.set(-Math.PI / 2, 0, rand(0, 6.28));
      const s = rand(0.6, 1.8); m.scale.set(s, s, 1);
      m.position.set(c.x * CELL + rand(0.3, 1.7), 0.006 + i * 0.0003, c.y * CELL + rand(0.3, 1.7));
      m.receiveShadow = true;
      scene.add(m);
    }

    // Außen: tote Bäume, Autowrack, Zaunpfähle
    const W = this.w * CELL, H = this.h * CELL;
    for (let i = 0; i < 26; i++) {
      const side = i % 4;
      let x, z;
      const along = rand(-10, (side < 2 ? W : H) + 10);
      const dist = rand(14, 40);
      if (side === 0) { x = along; z = -dist; } else if (side === 1) { x = along; z = H + dist; }
      else if (side === 2) { x = -dist; z = along; } else { x = W + dist; z = along; }
      const t = P.tree(M);
      t.position.set(x, 0, z); t.rotation.y = rand(0, 6);
      scene.add(t);
    }
    const car = P.carWreck(M); car.position.set(-9, 0, 30); car.rotation.y = 1.1; scene.add(car);
    const car2 = P.carWreck(M); car2.position.set(W + 10, 0, 8); car2.rotation.y = -0.4; scene.add(car2);
    const postMat = M.woodDark;
    for (let x = -14; x < W + 14; x += 3.2) for (const z of [-15, H + 15]) {
      if (Math.random() < 0.25) continue;
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, rand(1.0, 1.5), 0.12), postMat);
      p.position.set(x + rand(-0.3, 0.3), 0.6, z); p.rotation.z = rand(-0.2, 0.2); p.castShadow = true;
      scene.add(p);
    }
  }

  // tier: 1 = immer an, 2 = ab Qualität "mittel", 3 = nur "hoch"
  addLight(light, { flicker = 0, poweredOnly = false, offFactor = 0.35, base = light.intensity, tier = 1 } = {}) {
    light.userData.tier = tier;
    const entry = { light, base, flicker, poweredOnly, offFactor, phase: rand(0, 100), bulb: null };
    this.lights.push(entry);
    return entry;
  }

  buildLights(scene, M) {
    const C = CELL;
    const hemi = new THREE.HemisphereLight(0x51607c, 0x15110d, 0.55);
    scene.add(hemi);

    const moon = new THREE.DirectionalLight(0x9fb4e0, 1.1);
    const cx = (this.w * C) / 2, cz = (this.h * C) / 2;
    moon.position.set(cx - 30, 55, cz - 40);
    moon.target.position.set(cx, 0, cz);
    moon.castShadow = true;
    moon.userData.shadowTier = 1;
    const sc = moon.shadow.camera;
    sc.left = -32; sc.right = 32; sc.top = 32; sc.bottom = -32; sc.near = 10; sc.far = 140;
    moon.shadow.mapSize.set(2048, 2048);
    moon.shadow.bias = -0.0005; moon.shadow.normalBias = 0.04;
    scene.add(moon, moon.target);
    this.moon = moon;

    const lamp = (cx, cy, opts = {}) => {
      const p = this.center(cx, cy);
      const lg = P.hangingLamp(M);
      lg.position.set(p.x + (opts.ox || 0), WALL_H, p.z + (opts.oz || 0));
      scene.add(lg);
      const sl = new THREE.SpotLight(opts.color || 0xffc98a, opts.intensity || 38, 16, 1.05, 0.65, 1.7);
      sl.position.set(lg.position.x, WALL_H - 0.92, lg.position.z);
      sl.target.position.set(lg.position.x, 0, lg.position.z);
      sl.castShadow = !!opts.shadowTier;
      if (opts.shadowTier) {
        sl.userData.shadowTier = opts.shadowTier;
        sl.shadow.mapSize.set(1024, 1024); sl.shadow.bias = -0.0004; sl.shadow.normalBias = 0.03; sl.shadow.camera.near = 0.3;
      }
      scene.add(sl, sl.target);
      const e = this.addLight(sl, { flicker: opts.flicker || 0, offFactor: opts.offFactor ?? 0.3, tier: opts.tier || 1 });
      e.bulb = lg.userData.bulb;
      return e;
    };
    lamp(5, 4, { shadowTier: 2, offFactor: 0.75 });
    lamp(9, 7, { flicker: 0.6, offFactor: 0.6, tier: 2 });
    lamp(16, 6, { shadowTier: 2, color: 0xffd9b0, offFactor: 0.25 });
    lamp(20, 3, { flicker: 0.3, offFactor: 0.25, tier: 2 });
    lamp(6, 14, { shadowTier: 3, color: 0xfff1d6, offFactor: 0.2 });
    lamp(10, 16, { flicker: 0.8, offFactor: 0.2, tier: 2 });

    const point = (x, y, z, color, intensity, dist, opts) => {
      const l = new THREE.PointLight(color, intensity, dist, 1.8);
      l.position.set(x, y, z);
      scene.add(l);
      return this.addLight(l, opts);
    };
    const n = this.center(14, 2);
    point(n.x, 2.9, n.z + 0.8, 0xff2f6a, 7, 9, { flicker: 0.15, offFactor: 1, tier: 2 });
    const f = this.fireBarrelPos;
    this.fireLight = point(f.x, 1.4, f.z, 0xff7a2a, 14, 14, { flicker: 1.0, offFactor: 1 });
    const lp = this.center(21, 12);
    point(lp.x + 1.2, 3.7, lp.z - 0.6, 0xffd6a0, 10, 14, { offFactor: 0, poweredOnly: true, tier: 2 });
    const w = this.center(3, 12);
    point(w.x, 2.8, w.z, 0xff2010, 3.5, 8, { flicker: 0.0, offFactor: 1, tier: 3 }); // Notlicht Werkstatt
  }

  buildSky(scene, M) {
    scene.background = new THREE.Color(0x05070c);
    scene.fog = new THREE.FogExp2(0x0b0f16, 0.032);
    const N = 1600, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const th = Math.random() * Math.PI * 2, ph = Math.acos(rand(0.15, 1));
      const r = 300;
      pos[i * 3] = Math.sin(ph) * Math.cos(th) * r + 25;
      pos[i * 3 + 1] = Math.cos(ph) * r;
      pos[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * r + 21;
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xaab4cc, size: 1.4, sizeAttenuation: false, fog: false }));
    scene.add(stars);
    const moonSpr = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.tex.moon, color: new THREE.Color(2.2, 2.2, 2.4), fog: false, depthWrite: false }));
    const dir = new THREE.Vector3().subVectors(this.moon.position, this.moon.target.position).normalize();
    moonSpr.position.copy(this.moon.target.position).addScaledVector(dir, 250);
    moonSpr.scale.set(26, 26, 1);
    scene.add(moonSpr);
  }

  // ── Laufzeit ────────────────────────────────────────────────
  update(dt, time) {
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const a = this.anims[i];
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      a.fn(k);
      if (k >= 1) this.anims.splice(i, 1);
    }
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
    if (this.neon) this.neon.material.opacity = 0.75 + Math.sin(time * 30) * 0.05 + (Math.random() < 0.01 ? -0.6 : 0);
  }
}
