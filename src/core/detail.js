// ─────────────────────────────────────────────────────────────
//  Feinstruktur aus Foto-Höhenkarten (Stoff, Jeans, Leder – CC0, siehe
//  texlib.js) in prozedurale Canvas-Texturen einweben: Figuren, Zombies und
//  Arme behalten ihre gemalten Farben, Blutflecken und Risse und bekommen
//  zusätzlich echtes Gewebe bzw. Ledernarbung – in der Farbe (weiches
//  Licht) und in der Höhe (Bump, Mischmodus „Überlagern“: Mittelgrau
//  ändert nichts, Masken in anderen Kanälen bleiben an den Enden 0 und 1).
// ─────────────────────────────────────────────────────────────
import { ext } from './texlib.js';

/** Höhenbild eines Detail-Satzes (oder null, dann bleibt alles prozedural) */
export function detailImage(slot) {
  const img = ext(slot)?.height?.image;
  return img && (img.width || img.naturalWidth) ? img : null;
}

const patterns = new WeakMap(); // Bild → { Kachelgröße → Canvas }
function tileCanvas(img, px) {
  px = Math.max(8, Math.round(px));
  let m = patterns.get(img);
  if (!m) { m = new Map(); patterns.set(img, m); }
  let c = m.get(px);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = px;
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(img, 0, 0, px, px);
    m.set(px, c);
  }
  return c;
}

/**
 * Detail in ein Rechteck zweier Canvas-Kontexte zeichnen.
 * rect = [x, y, w, h] in Pixeln (Standard: ganze Fläche), tile = Kachelgröße in Pixeln,
 * bump/color = Deckkraft der Überlagerung (0 = aus).
 */
export function weave(img, { color = null, bump = null, rect = null, tile = 64, colorAlpha = 0.28, bumpAlpha = 0.55, rotate = 0 } = {}) {
  if (!img) return false;
  for (const [ctx, alpha, op] of [[color, colorAlpha, 'soft-light'], [bump, bumpAlpha, 'overlay']]) {
    if (!ctx || alpha <= 0) continue;
    const cv = ctx.canvas;
    const [x, y, w, h] = rect || [0, 0, cv.width, cv.height];
    const pat = ctx.createPattern(tileCanvas(img, tile), 'repeat');
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.globalCompositeOperation = op;
    ctx.globalAlpha = alpha;
    if (rotate) { ctx.translate(x + w / 2, y + h / 2); ctx.rotate(rotate); ctx.translate(-(x + w / 2), -(y + h / 2)); }
    ctx.fillStyle = pat;
    const pad = rotate ? Math.max(w, h) : 0;
    ctx.fillRect(x - pad, y - pad, w + pad * 2, h + pad * 2);
    ctx.restore();
  }
  return true;
}

/** Detail in fertige Canvas-Texturen ({ map, bump|data }) weben und neu hochladen */
export function weaveTextures(set, img, o = {}) {
  if (!img || !set) return false;
  const colorCtx = set.map?.image?.getContext ? set.map.image.getContext('2d') : null;
  const bt = set.bump || set.data;
  const bumpCtx = bt?.image?.getContext ? bt.image.getContext('2d') : null;
  const size = colorCtx?.canvas.width || bumpCtx?.canvas.width || 512;
  const ok = weave(img, { color: colorCtx, bump: bumpCtx, tile: size / (o.repeat ?? 6), ...o });
  if (ok) { if (set.map) set.map.needsUpdate = true; if (bt) bt.needsUpdate = true; }
  return ok;
}
