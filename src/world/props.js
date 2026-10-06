// Prozedurale Requisiten (Kisten, Fässer, Möbel, Bäume, Lampen …)
import * as THREE from 'three';
import { rand } from '../core/utils.js';

const box = (w, h, d, mat, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
};
const cyl = (rt, rb, h, mat, seg = 16, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
};

export function crate(M, s = 1) {
  const g = new THREE.Group();
  g.add(box(s, s, s, M.wood, 0, s / 2, 0));
  const t = 0.06 * s;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(t, s + 0.01, t, M.woodDark, sx * (s / 2 - t / 2 + 0.005), s / 2, sz * (s / 2 - t / 2 + 0.005)));
  for (const y of [t / 2, s - t / 2]) {
    g.add(box(s + 0.01, t, t, M.woodDark, 0, y, s / 2 - t / 2 + 0.005));
    g.add(box(s + 0.01, t, t, M.woodDark, 0, y, -s / 2 + t / 2 - 0.005));
    g.add(box(t, t, s + 0.01, M.woodDark, s / 2 - t / 2 + 0.005, y, 0));
    g.add(box(t, t, s + 0.01, M.woodDark, -s / 2 + t / 2 - 0.005, y, 0));
  }
  return g;
}

export function barrel(M, mat) {
  const g = new THREE.Group();
  g.add(cyl(0.3, 0.3, 0.9, mat || M.rust, 20, 0, 0.45, 0));
  for (const y of [0.15, 0.45, 0.75]) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.305, 0.015, 6, 24), M.metal);
    r.rotation.x = Math.PI / 2; r.position.y = y; g.add(r);
  }
  return g;
}

export function table(M, w = 1.4, d = 0.8, h = 0.78, top = M.woodDark) {
  const g = new THREE.Group();
  g.add(box(w, 0.05, d, top, 0, h, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(cyl(0.025, 0.025, h, M.metal, 8, sx * (w / 2 - 0.08), h / 2, sz * (d / 2 - 0.08)));
  return g;
}

export function chair(M, fallen = false) {
  const g = new THREE.Group();
  g.add(box(0.45, 0.04, 0.45, M.woodDark, 0, 0.46, 0));
  g.add(box(0.45, 0.5, 0.04, M.woodDark, 0, 0.72, -0.21));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(cyl(0.02, 0.02, 0.46, M.metal, 6, sx * 0.19, 0.23, sz * 0.19));
  if (fallen) { g.rotation.x = -Math.PI / 2; g.position.y = 0.22; }
  return g;
}

export function counter(M, len) {
  const g = new THREE.Group();
  g.add(box(len, 1.0, 0.7, M.woodDark, 0, 0.5, 0));
  g.add(box(len + 0.1, 0.06, 0.85, M.chrome, 0, 1.03, 0));
  g.add(box(len, 0.08, 0.72, M.leather, 0, 0.12, 0));
  for (let i = 0; i < Math.floor(len / 0.8); i++) {
    const s = stool(M);
    s.position.set(-len / 2 + 0.4 + i * 0.8, 0, 0.75);
    g.add(s);
  }
  return g;
}

export function stool(M) {
  const g = new THREE.Group();
  g.add(cyl(0.2, 0.2, 0.08, M.leather, 16, 0, 0.72, 0));
  g.add(cyl(0.035, 0.035, 0.7, M.chrome, 8, 0, 0.36, 0));
  g.add(cyl(0.18, 0.2, 0.03, M.chrome, 16, 0, 0.015, 0));
  return g;
}

export function booth(M) {
  const g = new THREE.Group();
  g.add(table(M, 1.2, 0.7, 0.75, M.chrome));
  for (const s of [-1, 1]) {
    g.add(box(1.3, 0.45, 0.5, M.leather, 0, 0.22, s * 0.75));
    g.add(box(1.3, 0.75, 0.15, M.leather, 0, 0.75, s * 0.97));
  }
  return g;
}

export function workbench(M) {
  const g = new THREE.Group();
  g.add(box(1.8, 0.08, 0.8, M.wood, 0, 0.9, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.06, 0.9, 0.06, M.metal, sx * 0.85, 0.45, sz * 0.35));
  g.add(box(1.7, 0.04, 0.7, M.metal, 0, 0.25, 0));
  g.add(box(0.2, 0.15, 0.15, M.paintRed, -0.6, 1.01, 0.2)); // Schraubstock
  g.add(box(0.5, 0.18, 0.25, M.paintRed, 0.4, 1.03, -0.1)); // Werkzeugkiste
  g.add(box(1.8, 0.9, 0.04, M.woodDark, 0, 1.4, -0.38)); // Lochwand
  for (let i = 0; i < 5; i++) g.add(box(0.04, 0.25, 0.02, M.metal, -0.7 + i * 0.3, 1.5, -0.35));
  return g;
}

export function shelf(M) {
  const g = new THREE.Group();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.05, 2.0, 0.05, M.metal, sx * 0.7, 1.0, sz * 0.22));
  for (const y of [0.1, 0.7, 1.3, 1.9]) {
    g.add(box(1.45, 0.03, 0.5, M.metal, 0, y, 0));
    for (let i = 0; i < 3; i++) if (Math.random() < 0.7) g.add(box(rand(0.2, 0.35), rand(0.15, 0.4), 0.3, Math.random() < 0.5 ? M.paper : M.wood, -0.45 + i * 0.45, y + 0.15, 0));
  }
  return g;
}

export function generator(M) {
  const g = new THREE.Group();
  g.add(box(1.4, 0.9, 0.8, M.paintGreen, 0, 0.55, 0));
  g.add(box(1.5, 0.1, 0.9, M.metal, 0, 0.05, 0));
  const tank = cyl(0.25, 0.25, 0.7, M.metal, 16, -0.3, 1.0, 0);
  tank.rotation.z = Math.PI / 2;
  g.add(tank);
  g.add(cyl(0.05, 0.05, 0.9, M.rust, 8, 0.55, 1.4, 0.2));
  g.add(box(0.3, 0.2, 0.02, M.dark, 0.3, 0.7, 0.41));
  return g;
}

export function tree(M, h = rand(5, 8)) {
  const g = new THREE.Group();
  const bark = M.bark || (M.bark = new THREE.MeshStandardMaterial({ color: 0x1d1814, roughness: 1 }));
  const branch = (len, r, depth, parent) => {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.6, r, len, 6), bark);
    b.geometry.translate(0, len / 2, 0);
    b.castShadow = true;
    parent.add(b);
    if (depth <= 0) return b;
    const n = depth > 2 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const pivot = new THREE.Group();
      pivot.position.y = len * rand(0.55, 0.95);
      pivot.rotation.set(rand(0.4, 0.9), (i / n) * Math.PI * 2 + rand(-0.4, 0.4), 0, 'YXZ');
      b.add(pivot);
      branch(len * rand(0.5, 0.7), r * 0.6, depth - 1, pivot);
    }
    return b;
  };
  branch(h * 0.45, 0.25, 4, g);
  return g;
}

export function hangingLamp(M) {
  const g = new THREE.Group();
  g.add(cyl(0.008, 0.008, 0.8, M.dark, 4, 0, -0.4, 0));
  const shadeMat = M.lampShade || (M.lampShade = new THREE.MeshStandardMaterial({ color: 0x2a2d2a, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide }));
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.22, 20, 1, true), shadeMat);
  shade.position.y = -0.85; g.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 3.6, 2.2) }));
  bulb.position.y = -0.95; g.add(bulb);
  g.userData.bulb = bulb;
  return g;
}

export function fireBarrel(M) {
  const g = barrel(M, M.rust);
  const ember = new THREE.Mesh(new THREE.CircleGeometry(0.28, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 1.2, 0.2) }));
  ember.rotation.x = -Math.PI / 2; ember.position.y = 0.82;
  g.add(ember);
  return g;
}

export function lampPost(M) {
  const g = new THREE.Group();
  g.add(cyl(0.06, 0.09, 4.2, M.metal, 10, 0, 2.1, 0));
  g.add(box(0.7, 0.06, 0.06, M.metal, 0.3, 4.1, 0));
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.25, 12, 1, true), M.lampShade || M.metal);
  head.position.set(0.6, 3.98, 0); g.add(head);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.2, 2.2) }));
  bulb.position.set(0.6, 3.88, 0); g.add(bulb);
  g.userData.bulb = bulb;
  return g;
}

export function carWreck(M) {
  const g = new THREE.Group();
  const body = M.carPaint || (M.carPaint = new THREE.MeshStandardMaterial({ color: 0x3c4a52, roughness: 0.6, metalness: 0.5 }));
  g.add(box(4.2, 0.7, 1.8, body, 0, 0.65, 0));
  g.add(box(2.2, 0.6, 1.6, body, -0.2, 1.3, 0));
  g.add(box(2.0, 0.5, 1.62, M.glass, -0.2, 1.3, 0));
  for (const sx of [-1.4, 1.4]) for (const sz of [-0.85, 0.85]) {
    const w = cyl(0.33, 0.33, 0.25, M.dark, 14, sx, 0.33, sz);
    w.rotation.x = Math.PI / 2; g.add(w);
  }
  g.rotation.z = 0.04;
  return g;
}

export function wallPoster(M, tex, w = 0.6, h = 0.85) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
  m.receiveShadow = true;
  return m;
}

export function pipe(M, len, r = 0.06) {
  const m = cyl(r, r, len, M.rust, 10);
  m.rotation.z = Math.PI / 2;
  return m;
}
