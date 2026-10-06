export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Kachelbares Value-Noise. Für nahtlose Texturen: x = u * period.
export class ValueNoise {
  constructor(seed = 1, size = 256) {
    const r = mulberry32(seed * 9973 + 17);
    this.size = size;
    this.v = new Float32Array(size * size);
    for (let i = 0; i < this.v.length; i++) this.v[i] = r();
  }

  noise(x, y, period = this.size) {
    const s = this.size;
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const x0 = ((xi % period) + period) % period;
    const y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
    const a = this.v[y0 * s + x0], b = this.v[y0 * s + x1];
    const c = this.v[y1 * s + x0], d = this.v[y1 * s + x1];
    const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
  }

  fbm(x, y, oct = 5, period = 8) {
    let sum = 0, amp = 0.5, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += amp * this.noise(x * f, y * f, period * f);
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  }
}
