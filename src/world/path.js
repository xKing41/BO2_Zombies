// Geschlossene, glatte Route (Catmull-Rom) mit Bogenlänge – für Straße und Bus.
import * as THREE from 'three';

export class LoopPath {
  // points: Weltkoordinaten [x, z]; step: Abtastabstand in Metern
  constructor(points, step = 1) {
    const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal', 0.5);
    const approx = curve.getLength();
    const n = Math.max(16, Math.ceil(approx / step));
    this.pts = curve.getSpacedPoints(n);
    this.pts.pop(); // geschlossen: letzter Punkt = erster
    this.n = this.pts.length;
    this.cum = new Float32Array(this.n + 1);
    for (let i = 1; i <= this.n; i++) this.cum[i] = this.cum[i - 1] + this.pts[i - 1].distanceTo(this.pts[i % this.n]);
    this.length = this.cum[this.n];
  }

  wrap(s) { return ((s % this.length) + this.length) % this.length; }

  index(s) {
    s = this.wrap(s);
    let lo = 0, hi = this.n;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (this.cum[mid] <= s) lo = mid; else hi = mid; }
    return lo;
  }

  pointAt(s, out = new THREE.Vector3()) {
    s = this.wrap(s);
    const i = this.index(s);
    const a = this.pts[i], b = this.pts[(i + 1) % this.n];
    const seg = this.cum[i + 1] - this.cum[i] || 1;
    return out.copy(a).lerp(b, (s - this.cum[i]) / seg);
  }

  // Fahrtrichtung als Gierwinkel (Blickrichtung +z gedreht)
  headingAt(s) {
    const a = this.pointAt(s - 1.5, new THREE.Vector3()), b = this.pointAt(s + 1.5, new THREE.Vector3());
    return Math.atan2(b.x - a.x, b.z - a.z);
  }

  nearestS(x, z) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.n; i++) {
      const p = this.pts[i];
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bd) { bd = d; best = this.cum[i]; }
    }
    return best;
  }

  // Abstand von s nach t in Fahrtrichtung
  ahead(s, t) { return this.wrap(t - s); }
}
