// ─────────────────────────────────────────────────────────────
//  Licht-Pool: Große Karten haben sehr viele Lampen, aber jedes echte
//  Licht kostet in jedem Pixel Rechenzeit. Deshalb gibt es nur wenige
//  echte Lichter, die laufend den nächstgelegenen Lampen zugeteilt werden.
//  Alle anderen Lampen leuchten nur als Glühbirne (Bloom).
//  Die Anzahl echter Lichter bleibt konstant → keine Shader-Neukompilierung.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { rand, damp } from '../core/utils.js';

export class LightPool {
  constructor(scene, { spots = 4, points = 5, range = 70 } = {}) {
    this.sources = [];
    this.range = range;
    this.spots = [];
    this.points = [];
    for (let i = 0; i < spots; i++) {
      const l = new THREE.SpotLight(0xffffff, 0, 18, 1.0, 0.6, 1.7);
      l.userData.tier = 1;
      scene.add(l, l.target);
      this.spots.push({ light: l, src: null, fade: 0 });
    }
    for (let i = 0; i < points; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 12, 1.8);
      l.userData.tier = 1;
      scene.add(l);
      this.points.push({ light: l, src: null, fade: 0 });
    }
    this.t = 0;
  }

  // src: { pos, type: 'spot' | 'point', color, intensity, distance, angle, penumbra, target,
  //        flicker, poweredOnly, offFactor, bulb, bulbColor, dynamic }
  add(src) {
    src.phase = rand(0, 100);
    src.current = 0;
    src.color = new THREE.Color(src.color ?? 0xffc98a);
    if (src.enabled === undefined) src.enabled = true;
    this.sources.push(src);
    return src;
  }

  update(dt, cam, power) {
    for (const s of this.sources) {
      let f = 1;
      if (s.flicker) {
        s.phase += dt;
        const n = Math.sin(s.phase * 13) * Math.sin(s.phase * 7.3 + 1) * Math.sin(s.phase * 2.1);
        f = 1 - s.flicker * 0.25 * (n * 0.5 + 0.5);
        if (Math.random() < s.flicker * 0.012) f *= 0.15;
      }
      const pf = power ? 1 : s.poweredOnly ? 0 : s.offFactor ?? 0.35;
      const on = s.enabled ? 1 : 0;
      s.current = s.intensity * f * pf * on;
      if (s.bulb) {
        const k = f * pf * on;
        const bc = s.bulbColor || [5, 3.6, 2.2];
        s.bulb.material.color.setRGB(bc[0] * k + 0.05, bc[1] * k + 0.04, bc[2] * k + 0.03);
      }
    }

    this.t -= dt;
    if (this.t <= 0) {
      this.t = 0.25;
      const r2 = this.range * this.range;
      for (const [slots, type] of [[this.spots, 'spot'], [this.points, 'point']]) {
        const cands = [];
        for (const s of this.sources) {
          if (s.type !== type || s.current <= 0.01) continue;
          const d2 = (s.pos.x - cam.x) ** 2 + (s.pos.z - cam.z) ** 2;
          if (d2 < r2) cands.push([s, d2]);
        }
        cands.sort((a, b) => a[1] - b[1]);
        const chosen = cands.slice(0, slots.length).map((c) => c[0]);
        const free = slots.filter((sl) => !sl.src || !chosen.includes(sl.src));
        for (const sl of free) sl.src = null;
        for (const s of chosen) {
          if (slots.some((sl) => sl.src === s)) continue;
          const sl = free.shift();
          if (!sl) break;
          sl.src = s;
          sl.fade = 0;
          const l = sl.light;
          l.color.copy(s.color);
          l.distance = s.distance ?? (type === 'spot' ? 18 : 12);
          l.position.copy(s.pos);
          if (type === 'spot') {
            l.angle = s.angle ?? 1.0;
            l.penumbra = s.penumbra ?? 0.6;
            l.target.position.copy(s.target || new THREE.Vector3(s.pos.x, 0, s.pos.z));
            l.target.updateMatrixWorld();
          }
        }
      }
    }

    for (const sl of this.spots.concat(this.points)) {
      if (!sl.src) { sl.light.intensity = damp(sl.light.intensity, 0, 12, dt); continue; }
      sl.fade = Math.min(1, sl.fade + dt * 3);
      sl.light.intensity = sl.src.current * sl.fade;
      if (sl.src.dynamic) sl.light.position.copy(sl.src.pos);
    }
  }

  // Helligkeit an einer Position (für die Beleuchtung der Waffe in der Hand)
  levelAt(p) {
    let sum = 0;
    for (const s of this.sources) {
      if (s.current <= 0) continue;
      const d2 = (s.pos.x - p.x) ** 2 + (s.pos.y - p.y) ** 2 + (s.pos.z - p.z) ** 2;
      if (d2 < 900) sum += s.current / (1 + d2);
    }
    return sum;
  }
}
