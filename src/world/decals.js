// ─────────────────────────────────────────────────────────────
//  Abziehbilder: Ölflecken, Schmutz, Papierfetzen, Zeitungen, Laub,
//  Risse, Brandspuren, Wasserränder und weiche Kontaktschatten unter
//  Requisiten – alles aus einem selbst gemalten Atlas (Canvas, kein
//  Download). Dazu Graffiti für Außenwände. Jede Sorte wird zu einem
//  einzigen Mesh zusammengefasst (ein Draw-Call je Atlas und Kachel).
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mulberry32 } from '../core/noise.js';

const N = 4; // 4 × 4 Felder
export const DECAL = {
  oil1: 0, oil2: 1, dirt1: 2, dirt2: 3,
  dirt3: 4, paper1: 5, paper2: 6, paper3: 7,
  news: 8, leaves1: 9, leaves2: 10, crack1: 11,
  crack2: 12, blob: 13, scorch: 14, ring: 15,
};

let ATLAS = null;
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function blobPath(x, rnd, cx, cy, r, k = 0.35, n = 14) {
  x.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2, rr = r * (1 - k / 2 + rnd() * k);
    const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
    if (i === 0) x.moveTo(px, py); else x.quadraticCurveTo(cx + Math.cos(a - 0.2) * rr * 1.1, cy + Math.sin(a - 0.2) * rr * 1.1, px, py);
  }
  x.closePath();
}

// Malt ein Feld in Farbe (c) und Rauheit (r, Graustufen)
function paint(c, r, idx, rnd) {
  const S = c.canvas.width / N, ox = (idx % N) * S, oy = Math.floor(idx / N) * S, m = S / 2;
  c.save(); r.save();
  c.translate(ox, oy); r.translate(ox, oy);
  c.beginPath(); c.rect(0, 0, S, S); c.clip();
  r.beginPath(); r.rect(0, 0, S, S); r.clip();
  const rough = (v) => { r.fillStyle = `rgb(${v},${v},${v})`; };
  const soft = (cx, cy, rad, col, a0) => {
    const gr = c.createRadialGradient(cx, cy, 0, cx, cy, rad);
    gr.addColorStop(0, `rgba(${col},${a0})`); gr.addColorStop(0.6, `rgba(${col},${a0 * 0.7})`); gr.addColorStop(1, `rgba(${col},0)`);
    c.fillStyle = gr; c.fillRect(0, 0, S, S);
  };
  if (idx === DECAL.oil1 || idx === DECAL.oil2) {
    c.filter = 'blur(3px)';
    for (let i = 0; i < (idx === DECAL.oil1 ? 1 : 3); i++) {
      const cx = m + (rnd() - 0.5) * S * 0.3, cy = m + (rnd() - 0.5) * S * 0.3, rad = S * (i ? 0.16 : 0.32) * (0.8 + rnd() * 0.4);
      blobPath(c, rnd, cx, cy, rad, 0.5, 18);
      c.fillStyle = 'rgba(14,11,9,0.88)'; c.fill();
      blobPath(r, rnd, cx, cy, rad * 1.05, 0.5, 18); rough(30); r.fill();
    }
    for (let i = 0; i < 9; i++) {
      const a = rnd() * 6.28, d = S * (0.3 + rnd() * 0.15), cx = m + Math.cos(a) * d, cy = m + Math.sin(a) * d, rad = S * (0.012 + rnd() * 0.03);
      c.beginPath(); c.arc(cx, cy, rad, 0, 6.28); c.fillStyle = 'rgba(16,12,9,0.8)'; c.fill();
      r.beginPath(); r.arc(cx, cy, rad, 0, 6.28); rough(40); r.fill();
    }
    c.filter = 'none';
    // schwacher Regenbogenschimmer
    c.globalCompositeOperation = 'source-atop';
    const g = c.createLinearGradient(0, 0, S, S);
    g.addColorStop(0, 'rgba(90,40,120,0.12)'); g.addColorStop(0.5, 'rgba(30,90,80,0.1)'); g.addColorStop(1, 'rgba(120,90,30,0.12)');
    c.fillStyle = g; c.fillRect(0, 0, S, S);
    c.globalCompositeOperation = 'source-over';
  } else if (idx === DECAL.dirt1 || idx === DECAL.dirt2 || idx === DECAL.dirt3) {
    const col = idx === DECAL.dirt1 ? '52,44,34' : idx === DECAL.dirt2 ? '40,38,34' : '70,58,40';
    for (let i = 0; i < 40; i++) {
      const cx = m + (rnd() - 0.5) * S * 0.7, cy = m + (rnd() - 0.5) * S * 0.7;
      const d = Math.hypot(cx - m, cy - m) / (S * 0.45);
      soft(cx, cy, S * (0.06 + rnd() * 0.14), col, 0.22 * (1 - d * 0.7));
    }
    const id = c.getImageData(0, 0, S, S);
    for (let i = 0; i < id.data.length; i += 4) id.data[i + 3] *= 0.65 + rnd() * 0.55;
    c.putImageData(id, 0, 0);
    rough(255); r.fillRect(0, 0, S, S);
  } else if (idx === DECAL.paper1 || idx === DECAL.paper2 || idx === DECAL.paper3 || idx === DECAL.news) {
    const news = idx === DECAL.news;
    const w = S * (news ? 0.8 : 0.5 + rnd() * 0.15), h = S * (news ? 0.62 : 0.66 + rnd() * 0.1);
    c.translate(m, m); r.translate(m, m);
    const rot = (rnd() - 0.5) * 0.5; c.rotate(rot); r.rotate(rot);
    const base = news ? [196, 190, 172] : idx === DECAL.paper2 ? [214, 205, 170] : [222, 220, 210];
    c.beginPath();
    c.moveTo(-w / 2, -h / 2); c.lineTo(w / 2 - (idx === DECAL.paper3 ? S * 0.08 : 0), -h / 2);
    c.lineTo(w / 2, -h / 2 + (idx === DECAL.paper3 ? S * 0.08 : 0)); c.lineTo(w / 2, h / 2); c.lineTo(-w / 2 + S * 0.02, h / 2 - S * 0.01); c.closePath();
    const g = c.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
    g.addColorStop(0, `rgb(${base.map((v) => v - 12)})`); g.addColorStop(0.45, `rgb(${base})`); g.addColorStop(1, `rgb(${base.map((v) => v - 28)})`);
    c.fillStyle = g; c.shadowColor = 'rgba(0,0,0,0.35)'; c.shadowBlur = 4; c.fill(); c.shadowBlur = 0;
    rough(225); r.fillRect(-w / 2, -h / 2, w, h);
    c.fillStyle = 'rgba(40,38,36,0.55)';
    if (news) {
      c.fillRect(-w / 2 + 8, -h / 2 + 8, w - 16, h * 0.13);
      for (let col = 0; col < 3; col++) for (let ln = 0; ln < 14; ln++) c.fillRect(-w / 2 + 8 + col * (w - 16) / 3, -h / 2 + h * 0.2 + ln * h * 0.055, (w - 16) / 3 - 8 - rnd() * 8, 2);
      c.fillStyle = 'rgba(60,60,60,0.35)'; c.fillRect(w * 0.08, -h * 0.25, w * 0.3, h * 0.35);
    } else {
      for (let ln = 0; ln < 11; ln++) c.fillRect(-w / 2 + 10, -h / 2 + 14 + ln * h * 0.075, (w - 20) * (0.5 + rnd() * 0.5), 2);
    }
    // Knicke und Schmutz
    c.strokeStyle = 'rgba(0,0,0,0.12)'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(-w / 2, (rnd() - 0.5) * h * 0.4); c.lineTo(w / 2, (rnd() - 0.5) * h * 0.4); c.stroke();
    c.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < 6; i++) { const gx = (rnd() - 0.5) * w, gy = (rnd() - 0.5) * h; const gr = c.createRadialGradient(gx, gy, 0, gx, gy, S * 0.12); gr.addColorStop(0, 'rgba(70,55,35,0.25)'); gr.addColorStop(1, 'rgba(70,55,35,0)'); c.fillStyle = gr; c.fillRect(-m, -m, S, S); }
    c.globalCompositeOperation = 'source-over';
  } else if (idx === DECAL.leaves1 || idx === DECAL.leaves2) {
    const cols = ['92,58,26', '120,74,30', '70,52,30', '104,88,40', '60,40,24'];
    for (let i = 0; i < (idx === DECAL.leaves1 ? 26 : 14); i++) {
      const a = rnd() * 6.28, d = rnd() * S * 0.36, cx = m + Math.cos(a) * d, cy = m + Math.sin(a) * d;
      const L = S * (0.05 + rnd() * 0.05), rot = rnd() * 6.28, col = cols[Math.floor(rnd() * cols.length)];
      c.save(); c.translate(cx, cy); c.rotate(rot);
      c.beginPath(); c.ellipse(0, 0, L, L * 0.45, 0, 0, 6.28);
      c.fillStyle = `rgba(${col},0.95)`; c.shadowColor = 'rgba(0,0,0,0.4)'; c.shadowBlur = 3; c.fill(); c.shadowBlur = 0;
      c.strokeStyle = 'rgba(30,20,10,0.6)'; c.lineWidth = 1; c.beginPath(); c.moveTo(-L * 1.2, 0); c.lineTo(L, 0); c.stroke();
      c.restore();
      r.save(); r.translate(cx, cy); r.rotate(rot); r.beginPath(); r.ellipse(0, 0, L, L * 0.45, 0, 0, 6.28); rough(200); r.fill(); r.restore();
    }
  } else if (idx === DECAL.crack1 || idx === DECAL.crack2) {
    c.strokeStyle = 'rgba(10,9,8,0.85)'; c.lineCap = 'round';
    const branch = (x0, y0, a, len, w, depth) => {
      let x = x0, y = y0;
      c.lineWidth = w; c.beginPath(); c.moveTo(x, y);
      const steps = 8;
      for (let i = 0; i < steps; i++) { a += (rnd() - 0.5) * 0.7; x += Math.cos(a) * len / steps; y += Math.sin(a) * len / steps; c.lineTo(x, y); }
      c.stroke();
      if (depth > 0) for (let k = 0; k < 2; k++) if (rnd() < 0.7) branch(x0 + (x - x0) * rnd(), y0 + (y - y0) * rnd(), a + (rnd() - 0.5) * 1.6, len * 0.5, w * 0.6, depth - 1);
    };
    branch(S * 0.1, m + (rnd() - 0.5) * S * 0.3, (rnd() - 0.5) * 0.4, S * 0.8, idx === DECAL.crack1 ? 3 : 2, 3);
    rough(255); r.fillRect(0, 0, S, S);
  } else if (idx === DECAL.blob) {
    const gr = c.createRadialGradient(m, m, 0, m, m, m);
    gr.addColorStop(0, 'rgba(0,0,0,0.85)'); gr.addColorStop(0.45, 'rgba(0,0,0,0.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = gr; c.fillRect(0, 0, S, S);
    rough(255); r.fillRect(0, 0, S, S);
  } else if (idx === DECAL.scorch) {
    for (let i = 0; i < 30; i++) {
      const a = rnd() * 6.28, d = rnd() * S * 0.2;
      soft(m + Math.cos(a) * d, m + Math.sin(a) * d, S * (0.12 + rnd() * 0.2), '8,7,6', 0.28);
    }
    rough(255); r.fillRect(0, 0, S, S);
  } else if (idx === DECAL.ring) {
    c.lineWidth = S * 0.025;
    for (let i = 0; i < 3; i++) {
      blobPath(c, rnd, m + (rnd() - 0.5) * 20, m + (rnd() - 0.5) * 20, S * (0.25 + i * 0.07), 0.25, 20);
      c.strokeStyle = `rgba(60,50,40,${0.35 - i * 0.08})`; c.stroke();
    }
    soft(m, m, S * 0.3, '30,28,26', 0.18);
    rough(160); r.fillRect(0, 0, S, S);
  }
  c.restore(); r.restore();
}

/** Material des Boden-Atlas (einmal erzeugt, von allen Karten geteilt) */
export function decalMaterial() {
  if (ATLAS) return ATLAS;
  const S = 1024, cv = canvas(S, S), rv = canvas(S, S);
  const c = cv.getContext('2d'), r = rv.getContext('2d');
  r.fillStyle = '#e6e6e6'; r.fillRect(0, 0, S, S);
  const rnd = mulberry32(4711);
  for (let i = 0; i < N * N; i++) paint(c, r, i, rnd);
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const rough = new THREE.CanvasTexture(rv);
  ATLAS = new THREE.MeshStandardMaterial({
    map, roughnessMap: rough, roughness: 1, metalness: 0, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  ATLAS.userData.shared = true;
  return ATLAS;
}

// ── Graffiti (eigene Sprüche, Sprühdosen-Optik) ──────────────
const TAGS = [
  ['SIE KOMMEN', '#c81e1e'], ['LAUF!', '#e8e4d8'], ['13', '#f0c419'], ['KEIN AUSWEG', '#c81e1e'],
  ['HILFE →', '#e8e4d8'], ['NICHT BEISSEN LASSEN', '#9be04a'], ['WIR LEBEN NOCH', '#e8e4d8'], ['GRAUWEILER 1987', '#4aa8e0'],
];
let GRAF = null;
export const GRAFFITI_COUNT = TAGS.length;
export function graffitiMaterial() {
  if (GRAF) return GRAF;
  const W = 1024, H = 1024, cv = canvas(W, H), c = cv.getContext('2d');
  const rnd = mulberry32(1987);
  TAGS.forEach(([text, col], i) => {
    const cw = W / 2, ch = H / 4, ox = (i % 2) * cw, oy = Math.floor(i / 2) * ch;
    c.save();
    c.beginPath(); c.rect(ox, oy, cw, ch); c.clip();
    c.translate(ox + cw / 2, oy + ch / 2);
    c.rotate((rnd() - 0.5) * 0.12);
    let size = 120;
    c.font = `900 ${size}px Oswald, Impact, sans-serif`;
    while (c.measureText(text).width > cw * 0.9 && size > 30) { size -= 4; c.font = `900 ${size}px Oswald, Impact, sans-serif`; }
    c.textAlign = 'center'; c.textBaseline = 'middle';
    // Sprühnebel
    c.shadowColor = col; c.shadowBlur = 14;
    c.fillStyle = col; c.globalAlpha = 0.9;
    c.fillText(text, 0, 0);
    c.shadowBlur = 0;
    c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,0.5)'; c.strokeText(text, 0, 0);
    // Läufer
    const tw = c.measureText(text).width;
    c.strokeStyle = col; c.globalAlpha = 0.85;
    for (let k = 0; k < 7; k++) {
      const x = (rnd() - 0.5) * tw * 0.9, y0 = size * 0.3, len = 10 + rnd() * 50;
      c.lineWidth = 2 + rnd() * 3;
      c.beginPath(); c.moveTo(x, y0); c.lineTo(x + (rnd() - 0.5) * 2, y0 + len); c.stroke();
      c.beginPath(); c.arc(x, y0 + len, c.lineWidth * 0.8, 0, 6.28); c.fillStyle = col; c.fill();
    }
    c.restore();
  });
  // Ausbleichen: unregelmäßig schwächer
  const id = c.getImageData(0, 0, W, H);
  for (let i = 0; i < id.data.length; i += 4) id.data[i + 3] *= 0.7 + rnd() * 0.3;
  c.putImageData(id, 0, 0);
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  GRAF = new THREE.MeshStandardMaterial({
    map, roughness: 0.85, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  GRAF.userData.shared = true;
  return GRAF;
}

// ── Fenster für Außenfassaden (4 × 2 Felder) ─────────────────
// 0 dunkles Glas · 1 Jalousie · 2 vernagelt · 3 zerbrochen · 4 warm beleuchtet · 5 Vorhänge · 6 Rollladen · 7 vernagelt (hell)
export const WINDOW_VARIANTS = 8;
let FACADE = null;
export function facadeMaterial() {
  if (FACADE) return FACADE;
  const W = 1024, H = 512, S = 256;
  const cv = canvas(W, H), c = cv.getContext('2d');
  const ev = canvas(W, H), e = ev.getContext('2d');
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  const rnd = mulberry32(31337);
  for (let i = 0; i < 8; i++) {
    const ox = (i % 4) * S, oy = Math.floor(i / 4) * S;
    c.save(); c.translate(ox, oy);
    const fr = ['#d8d2c4', '#5a4030', '#8a8c88', '#e8e4da'][i % 4];
    c.fillStyle = fr; c.fillRect(0, 0, S, S); // Rahmen
    const g0 = 18, gx = g0, gy = g0, gw = S - g0 * 2, gh = S - g0 * 2;
    // Glas: dunkel mit Spiegelung
    const gl = c.createLinearGradient(0, gy, 0, gy + gh);
    gl.addColorStop(0, '#2a3440'); gl.addColorStop(1, '#0c1016');
    c.fillStyle = gl; c.fillRect(gx, gy, gw, gh);
    c.save(); c.beginPath(); c.rect(gx, gy, gw, gh); c.clip();
    c.globalAlpha = 0.18; c.fillStyle = '#9fb4c8';
    c.beginPath(); c.moveTo(gx + gw * 0.15, gy); c.lineTo(gx + gw * 0.45, gy); c.lineTo(gx + gw * 0.1, gy + gh); c.lineTo(gx - gw * 0.2, gy + gh); c.fill();
    c.globalAlpha = 1;
    if (i === 1) { // Jalousie
      for (let y = gy; y < gy + gh * (0.6 + rnd() * 0.4); y += 9) { c.fillStyle = '#b8b4a8'; c.fillRect(gx, y, gw, 6); c.fillStyle = '#8c887e'; c.fillRect(gx, y + 6, gw, 1); }
    } else if (i === 2 || i === 7) { // Bretter
      for (let k = 0; k < 4; k++) {
        c.save(); c.translate(S / 2, gy + 20 + k * (gh - 40) / 3); c.rotate((rnd() - 0.5) * 0.35);
        c.fillStyle = i === 2 ? `hsl(28,${30 + rnd() * 15}%,${22 + rnd() * 10}%)` : `hsl(35,${25 + rnd() * 10}%,${45 + rnd() * 10}%)`;
        c.fillRect(-S * 0.55, -14, S * 1.1, 28);
        c.fillStyle = 'rgba(0,0,0,0.35)'; for (let n = 0; n < 4; n++) c.fillRect(-S * 0.55 + rnd() * S * 1.1, -14, 2, 28);
        c.fillStyle = '#222'; c.beginPath(); c.arc(-S * 0.4, 0, 3, 0, 6.28); c.arc(S * 0.4, 0, 3, 0, 6.28); c.fill();
        c.restore();
      }
    } else if (i === 3) { // zerbrochen
      c.fillStyle = '#05070a';
      c.beginPath(); c.moveTo(gx + gw * 0.35, gy + gh * 0.3);
      for (let k = 0; k < 9; k++) { const a = k / 9 * 6.28; c.lineTo(gx + gw * (0.42 + Math.cos(a) * (0.12 + rnd() * 0.14)), gy + gh * (0.45 + Math.sin(a) * (0.12 + rnd() * 0.16))); }
      c.fill();
      c.strokeStyle = 'rgba(200,210,220,0.45)'; c.lineWidth = 1.5;
      for (let k = 0; k < 10; k++) { c.beginPath(); c.moveTo(gx + gw * 0.42, gy + gh * 0.45); const a = rnd() * 6.28; c.lineTo(gx + gw * 0.42 + Math.cos(a) * gw * 0.6, gy + gh * 0.45 + Math.sin(a) * gh * 0.6); c.stroke(); }
    } else if (i === 4) { // warm beleuchtet, mit Vorhang-Schatten
      const wl = c.createRadialGradient(gx + gw * 0.5, gy + gh * 0.4, 10, gx + gw * 0.5, gy + gh * 0.5, gw * 0.8);
      wl.addColorStop(0, '#ffd690'); wl.addColorStop(1, '#a8601c');
      c.fillStyle = wl; c.fillRect(gx, gy, gw, gh);
      c.fillStyle = 'rgba(60,20,10,0.75)'; c.fillRect(gx, gy, gw * 0.18, gh); c.fillRect(gx + gw * 0.82, gy, gw * 0.18, gh);
      e.save(); e.translate(ox, oy);
      const el = e.createRadialGradient(gx + gw * 0.5, gy + gh * 0.4, 10, gx + gw * 0.5, gy + gh * 0.5, gw * 0.8);
      el.addColorStop(0, '#ffcc80'); el.addColorStop(1, '#6a3810');
      e.fillStyle = el; e.fillRect(gx + gw * 0.18, gy, gw * 0.64, gh);
      e.restore();
    } else if (i === 5) { // Vorhänge
      c.fillStyle = '#5a1e1e'; c.fillRect(gx, gy, gw * 0.3, gh); c.fillRect(gx + gw * 0.7, gy, gw * 0.3, gh);
      c.fillStyle = 'rgba(0,0,0,0.25)'; for (let k = 0; k < 8; k++) { c.fillRect(gx + k * gw * 0.04, gy, 3, gh); c.fillRect(gx + gw * 0.7 + k * gw * 0.04, gy, 3, gh); }
    } else if (i === 6) { // Rollladen
      for (let y = gy; y < gy + gh; y += 12) { c.fillStyle = '#7c7f80'; c.fillRect(gx, y, gw, 10); c.fillStyle = '#4c4e50'; c.fillRect(gx, y + 10, gw, 2); }
    }
    c.restore();
    // Sprossen und Schmutz
    if (i !== 6) { c.fillStyle = fr; c.fillRect(S / 2 - 5, gy, 10, gh); c.fillRect(gx, S * 0.42, gw, 8); }
    const dirt = c.createLinearGradient(0, S * 0.6, 0, S);
    dirt.addColorStop(0, 'rgba(40,32,24,0)'); dirt.addColorStop(1, 'rgba(40,32,24,0.35)');
    c.fillStyle = dirt; c.fillRect(0, 0, S, S);
    c.restore();
  }
  const map = new THREE.CanvasTexture(cv); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  const emi = new THREE.CanvasTexture(ev); emi.colorSpace = THREE.SRGBColorSpace;
  FACADE = new THREE.MeshStandardMaterial({
    map, emissiveMap: emi, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 2.2, roughness: 0.35, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  FACADE.userData.shared = true;
  return FACADE;
}

/**
 * Sammelt Abziehbilder und baut daraus ein Mesh.
 * add(feld, x, y, z, breite, höhe, drehung, normale) – normale 'up' (Boden) oder [nx, nz] (Wand)
 */
export class DecalBatch {
  constructor(material, cols = N, rows = N) {
    this.mat = material;
    this.cols = cols; this.rows = rows;
    this.pos = []; this.nor = []; this.uv = []; this.idx = [];
  }
  get count() { return this.idx.length / 6; }
  add(cell, x, y, z, w, h, rot = 0, normal = 'up', opts = {}) {
    const b = this.pos.length / 3;
    const u0 = (cell % this.cols) / this.cols, v0 = 1 - (Math.floor(cell / this.cols) + 1) / this.rows;
    const du = 1 / this.cols, dv = 1 / this.rows, inset = 0.004;
    const uvs = [[u0 + inset, v0 + inset], [u0 + du - inset, v0 + inset], [u0 + du - inset, v0 + dv - inset], [u0 + inset, v0 + dv - inset]];
    if (opts.flip) for (const t of uvs) t[0] = 2 * u0 + du - t[0];
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const corners = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
    if (normal === 'up') {
      for (const [a, bb] of corners) {
        const lx = a * cs - bb * sn, lz = a * sn + bb * cs;
        this.pos.push(x + lx, y, z - lz); this.nor.push(0, 1, 0);
      }
    } else {
      const [nx, nz] = normal, tx = nz, tz = -nx; // Tangente entlang der Wand (Blick auf die Wand: nach rechts)
      for (const [a, bb] of corners) {
        const la = a * cs - bb * sn, lb = a * sn + bb * cs;
        this.pos.push(x + tx * la + nx * 0.004, y + lb, z + tz * la + nz * 0.004); this.nor.push(nx, 0, nz);
      }
    }
    for (const t of uvs) this.uv.push(t[0], t[1]);
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  build(scene, name = 'decals') {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.mat);
    m.receiveShadow = true;
    m.castShadow = false;
    m.renderOrder = 1;
    m.name = name;
    scene.add(m);
    return m;
  }
}
