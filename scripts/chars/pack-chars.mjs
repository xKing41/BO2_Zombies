// ─────────────────────────────────────────────────────────────
//  Figuren fürs Spiel aufbereiten (läuft im Workflow „Figuren“ nach Blender).
//  Eingabe: Roh-GLBs von make_chars.py + report.json (Rolle je Mesh).
//  Je Figur entsteht EIN Mesh mit EINEM Material: alle Teile (Haut, Kleidung,
//  Schuhe, Haare, Augen, Brauen) werden in einen Textur-Atlas gepackt, die UVs
//  umgerechnet und die Geometrie zusammengefügt – so zeichnet das Spiel alle
//  Zombies eines Typs mit einem einzigen Draw-Call. Dazu ein Attribut _SKIN
//  (1 = Haut), damit der Zombie-Shader Haut und Stoff unterschiedlich altern lässt.
//  Ausgabe in public/chars/: <name>.glb (PC) und <name>_lo.glb (Handy) + index.json.
//    node scripts/assets/../chars/pack-chars.mjs <roh-ordner> [ausgabe]
// ─────────────────────────────────────────────────────────────
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const RAW = process.argv[2] || 'out/chars';
const OUT = process.argv[3] || 'public/chars';
const S = 2048; // Arbeitsgröße des Atlas
const PAD = 6; // Rand gegen Ausbluten (Pixel im Arbeitsatlas)
await fs.mkdir(OUT, { recursive: true });
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

let report = { chars: {} };
try { report = JSON.parse(await fs.readFile(path.join(RAW, 'report.json'), 'utf8')); } catch { /* ohne Bericht: Rollen raten */ }
const charsCfg = JSON.parse(await fs.readFile(new URL('./chars.json', import.meta.url), 'utf8'));
const budget = charsCfg.budget || { tris: 9000, trisLo: 4000, tex: 1024, texLo: 512 };

// Atlas-Bereiche je Rolle [x, y, w, h] im 2048er-Arbeitsatlas; weitere Teile bekommen freie Felder
const SLOTS = {
  skin: [[0, 0, 1024, 1024]],
  clothes: [[1024, 0, 1024, 1024], [1024, 1024, 512, 512], [1536, 1024, 512, 512]],
  hair: [[0, 1024, 512, 512]],
  shoes: [[512, 1024, 512, 512]],
  hat: [[1536, 1024, 512, 512], [1024, 1024, 512, 512]],
  eyes: [[0, 1536, 256, 256]],
  eyebrows: [[256, 1536, 256, 128]],
  eyelashes: [[256, 1664, 256, 128]],
};
const SPARE = [[512, 1536, 512, 512], [1024, 1536, 512, 512], [1536, 1536, 512, 512]];

function guessRole(name) {
  const n = name.toLowerCase();
  if (/generic|proxy|female\d|male\d|muscle|body/.test(n)) return 'skin';
  if (/eyebrow/.test(n)) return 'eyebrows';
  if (/eyelash/.test(n)) return 'eyelashes';
  if (/low-poly|high-poly|eye/.test(n)) return 'eyes';
  if (/short|long|bob|braid|ponytail|afro|hair/.test(n)) return 'hair';
  if (/shoe/.test(n)) return 'shoes';
  if (/fedora|hat|cap/.test(n)) return 'hat';
  return 'clothes';
}

async function imageOf(tex, fallback) {
  if (!tex) return fallback;
  return Buffer.from(tex.getImage());
}

function flatColor(r, g, b, a = 255) {
  return sharp({ create: { width: 4, height: 4, channels: 4, background: { r, g, b, alpha: a / 255 } } }).png().toBuffer();
}

// Durchsichtige Pixel (Haare, Brauen, Hut) bekommen die mittlere Farbe der sichtbaren –
// sonst färbt beim Filtern die Hintergrundfarbe der Datei (oft Weiß/Grau) die Kanten.
async function bleedAlpha(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const C = info.channels;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += C) if (data[i + 3] > 160) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
  if (!n) return buf;
  r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
  for (let i = 0; i < data.length; i += C) {
    const a = data[i + 3];
    if (a < 160) { const k = a / 160; data[i] = Math.round(data[i] * k + r * (1 - k)); data[i + 1] = Math.round(data[i + 1] * k + g * (1 - k)); data[i + 2] = Math.round(data[i + 2] * k + b * (1 - k)); }
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: C } }).png().toBuffer();
}

// Aufdrucke (Logos) übermalen: In jedem Rechteck [x, y, b, h] (0…1 der Textur) werden
// Pixel, die deutlich von der Stofffarbe (Median) abweichen, aus der Umgebung aufgefüllt
// (8 Strahlen, nach Abstand gewichtet) und bekommen die Stoffstruktur eines sauberen
// Nachbarbereichs zurück – so bleibt kein glatter Fleck.
async function retouch(buf, rects) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  const T = 40;
  for (const [rx, ry, rw, rh] of rects) {
    const x0 = Math.max(0, Math.floor(rx * W)), y0 = Math.max(0, Math.floor(ry * H));
    const x1 = Math.min(W, Math.ceil((rx + rw) * W)), y1 = Math.min(H, Math.ceil((ry + rh) * H));
    const w = x1 - x0, h = y1 - y0;
    const ch = [[], [], []];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * C; for (let c = 0; c < 3; c++) ch[c].push(data[i + c]); }
    const med = ch.map((a) => a.sort((p, q) => p - q)[a.length >> 1]);
    const off = (x, y) => (y * W + x) * C;
    const diff = (i) => Math.abs(data[i] - med[0]) + Math.abs(data[i + 1] - med[1]) + Math.abs(data[i + 2] - med[2]);
    let mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (diff(off(x + x0, y + y0)) > T) mask[y * w + x] = 1;
    // Maske etwas weiten (Kantenreste des Aufdrucks)
    const R = Math.max(2, Math.round(W / 600));
    const grown = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h) grown[yy * w + xx] = 1;
      }
    }
    mask = grown;
    // Spender für die Stoffstruktur: Verschiebung mit den meisten sauberen Pixeln
    const cands = [[w, 0], [-w, 0], [0, h], [0, -h], [w >> 1, h], [-(w >> 1), h], [w >> 1, -h], [-(w >> 1), -h]];
    let best = null, bestScore = -1;
    for (const [dx, dy] of cands) {
      let s = 0;
      for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) {
        if (!mask[y * w + x]) continue;
        const xx = x + x0 + dx, yy = y + y0 + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && diff(off(xx, yy)) <= T) s++;
      }
      if (s > bestScore) { bestScore = s; best = [dx, dy]; }
    }
    const out = new Float32Array(w * h * 3);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      let sr = 0, sg = 0, sb = 0, sw = 0;
      for (const [dx, dy] of dirs) {
        let xx = x, yy = y, d = 0;
        while (true) {
          xx += dx; yy += dy; d++;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) break;
          if (!mask[yy * w + xx]) {
            const i = off(xx + x0, yy + y0), k = 1 / (d * d);
            sr += data[i] * k; sg += data[i + 1] * k; sb += data[i + 2] * k; sw += k;
            break;
          }
        }
      }
      const o = (y * w + x) * 3;
      if (sw > 0) { out[o] = sr / sw; out[o + 1] = sg / sw; out[o + 2] = sb / sw; } else { out[o] = med[0]; out[o + 1] = med[1]; out[o + 2] = med[2]; }
      const xx = x + x0 + best[0], yy = y + y0 + best[1];
      if (xx >= 0 && yy >= 0 && xx < W && yy < H) {
        const i = off(xx, yy);
        if (diff(i) <= T) for (let c = 0; c < 3; c++) out[o + c] += (data[i + c] - med[c]) * 0.85;
      }
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      const i = off(x + x0, y + y0), o = (y * w + x) * 3;
      for (let c = 0; c < 3; c++) data[i + c] = Math.max(0, Math.min(255, Math.round(out[o + c])));
    }
  }
  return sharp(data, { raw: { width: W, height: H, channels: C } }).png().toBuffer();
}

async function packOne(name, file) {
  const src = await io.read(file);
  const root = src.getRoot();
  const roles = report.chars?.[name]?.roles || {};
  const skins = root.listSkins();
  if (!skins.length) throw new Error('keine Skin-Daten');
  const skin = skins[0];
  const joints = skin.listJoints();
  // Teile einsammeln: Mesh-Knoten mit Rolle
  let parts = [];
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    // Kopie des Grundkörpers („Human_x“, „Human.003_x“) ist Haut, egal was der Bericht sagt
    const role = /^human(\.\d+)?_x$/i.test(node.getName()) ? 'skin' : (roles[node.getName()] || guessRole(node.getName()));
    if (role === 'eyelashes') continue; // winzig, braucht Transparenz – weglassen
    for (const prim of mesh.listPrimitives()) parts.push({ node, prim, role, mat: prim.getMaterial() });
  }
  // MPFB exportiert den Low-Poly-Körper doppelt (als Grundkörper-Kopie und als eigenes
  // Objekt) – nur einen behalten: den nach dem Körper-Asset benannten, sonst den größten.
  const skinParts = parts.filter((p) => p.role === 'skin');
  if (skinParts.length > 1) {
    const proxy = (report.chars?.[name]?.assets?.proxy || '').replace(/\.proxy$/, '').toLowerCase();
    const keep = (proxy && skinParts.find((p) => p.node.getName().toLowerCase().includes(proxy)))
      || skinParts.reduce((a, b) => (b.prim.getAttribute('POSITION').getCount() > a.prim.getAttribute('POSITION').getCount() ? b : a));
    parts = parts.filter((p) => p.role !== 'skin' || p === keep);
  }
  // Atlas belegen
  const used = { ...Object.fromEntries(Object.entries(SLOTS).map(([k, v]) => [k, [...v]])) };
  const spare = [...SPARE];
  const taken = new Set();
  for (const p of parts) {
    let r = null;
    for (const cand of used[p.role] || []) { const k = cand.join(','); if (!taken.has(k)) { r = cand; break; } }
    if (!r) r = spare.find((c) => !taken.has(c.join(',')));
    if (!r) throw new Error('Atlas voll');
    taken.add(r.join(','));
    p.rect = r;
  }
  // Farb-, Normal- und Rauheits-Atlas zeichnen
  const colorLayers = [], normalLayers = [], roughLayers = [];
  const neutralNormal = await flatColor(128, 128, 255);
  for (const p of parts) {
    const [x, y, w, h] = p.rect;
    const m = p.mat;
    const base = m?.getBaseColorTexture();
    const nrm = m?.getNormalTexture();
    const f = m?.getBaseColorFactor() || [1, 1, 1, 1];
    let col = await imageOf(base, await flatColor(Math.round(f[0] * 255), Math.round(f[1] * 255), Math.round(f[2] * 255)));
    // längster passender Name gewinnt („female_casualsuit02“ enthält „male_casualsuit02“)
    const fix = Object.entries(charsCfg.retouch || {}).filter(([k]) => !k.startsWith('_') && p.node.getName().toLowerCase().includes(k.toLowerCase()))
      .sort((a, b) => b[0].length - a[0].length)[0];
    if (base && fix) col = await retouch(col, fix[1]);
    // Grundfarbe-Faktor einrechnen (MPFB setzt ihn selten, aber sicher ist sicher)
    const cutout = ['hair', 'eyebrows', 'hat'].includes(p.role);
    if (cutout) col = await bleedAlpha(col);
    let img = sharp(col).ensureAlpha().resize(w - PAD * 2, h - PAD * 2, { fit: 'fill' });
    if (base && (f[0] < 0.99 || f[1] < 0.99 || f[2] < 0.99)) img = img.linear([f[0], f[1], f[2], 1], [0, 0, 0, 0]);
    // Haut, Kleidung, Schuhe, Augen: undurchsichtig; Haare/Brauen behalten Alpha
    if (!cutout) img = img.flatten({ background: '#808080' }).ensureAlpha(1);
    const tile = await img.png().toBuffer();
    // Rand: Kanten nach außen ziehen (gegen dunkle Säume beim Mipmapping)
    const ext = await sharp(tile).extend({ top: PAD, bottom: PAD, left: PAD, right: PAD, extendWith: 'copy' }).png().toBuffer();
    colorLayers.push({ input: ext, left: x, top: y });
    const ntile = await sharp(await imageOf(nrm, neutralNormal)).removeAlpha().resize(w - PAD * 2, h - PAD * 2, { fit: 'fill' })
      .extend({ top: PAD, bottom: PAD, left: PAD, right: PAD, extendWith: 'copy' }).png().toBuffer();
    normalLayers.push({ input: ntile, left: x, top: y });
    const rough = Math.round(Math.min(1, Math.max(0.05, m?.getRoughnessFactor() ?? 0.8)) * 255);
    roughLayers.push({ input: await sharp({ create: { width: w, height: h, channels: 3, background: { r: 255, g: rough, b: 0 } } }).png().toBuffer(), left: x, top: y });
  }
  // durchsichtiger Grund: sonst würde „over“ die Haar-Transparenz zu Grau zukleistern
  const atlasColor = await sharp({ create: { width: S, height: S, channels: 4, background: { r: 128, g: 128, b: 128, alpha: 0 } } }).composite(colorLayers).png().toBuffer();
  const atlasNormal = await sharp({ create: { width: S, height: S, channels: 3, background: { r: 128, g: 128, b: 255 } } }).composite(normalLayers).png().toBuffer();
  const atlasRough = await sharp({ create: { width: S, height: S, channels: 3, background: { r: 255, g: 204, b: 0 } } }).composite(roughLayers).png().toBuffer();

  // Zusammengefügte Geometrie
  const pos = [], nor = [], uv = [], jnt = [], wgt = [], skinMask = [], idx = [];
  let base = 0;
  const eyePts = [];
  for (const p of parts) {
    const pr = p.prim;
    const P = pr.getAttribute('POSITION'), N = pr.getAttribute('NORMAL'), T = pr.getAttribute('TEXCOORD_0');
    const J = pr.getAttribute('JOINTS_0'), W = pr.getAttribute('WEIGHTS_0'), I = pr.getIndices();
    if (!P || !J || !W) continue;
    const [x, y, w, h] = p.rect;
    const n = P.getCount();
    const v3 = [0, 0, 0], v2 = [0, 0], v4 = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      P.getElement(i, v3); pos.push(v3[0], v3[1], v3[2]);
      if (p.role === 'eyes') eyePts.push([v3[0], v3[1], v3[2]]);
      if (N) { N.getElement(i, v3); nor.push(v3[0], v3[1], v3[2]); } else nor.push(0, 1, 0);
      if (T) T.getElement(i, v2); else { v2[0] = 0.5; v2[1] = 0.5; }
      const u = Math.min(1, Math.max(0, v2[0])), vv = Math.min(1, Math.max(0, v2[1]));
      uv.push((x + PAD + u * (w - PAD * 2)) / S, (y + PAD + vv * (h - PAD * 2)) / S);
      J.getElement(i, v4); jnt.push(v4[0], v4[1], v4[2], v4[3]);
      W.getElement(i, v4);
      const ws = v4[0] + v4[1] + v4[2] + v4[3] || 1;
      wgt.push(v4[0] / ws, v4[1] / ws, v4[2] / ws, v4[3] / ws);
      skinMask.push(p.role === 'skin' ? 1 : p.role === 'eyes' ? 0.5 : 0);
    }
    if (I) { const ia = I.getArray(); for (let k = 0; k < ia.length; k++) idx.push(ia[k] + base); }
    else for (let k = 0; k < n; k++) idx.push(k + base);
    base += n;
  }

  // Neues Dokument: ein Knoten, ein Mesh, eine Haut (Gelenke übernommen)
  const doc = new Document();
  const buf = doc.createBuffer();
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buf);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', acc('VEC3', new Float32Array(pos)))
    .setAttribute('NORMAL', acc('VEC3', new Float32Array(nor)))
    .setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(uv)))
    .setAttribute('JOINTS_0', acc('VEC4', new Uint8Array(jnt)))
    .setAttribute('WEIGHTS_0', acc('VEC4', new Float32Array(wgt)))
    .setAttribute('_SKIN', acc('SCALAR', new Float32Array(skinMask)))
    .setIndices(acc('SCALAR', base > 65535 ? new Uint32Array(idx) : new Uint16Array(idx)));
  const texC = doc.createTexture('atlas').setImage(atlasColor).setMimeType('image/png');
  const texN = doc.createTexture('atlas_n').setImage(atlasNormal).setMimeType('image/png');
  const texR = doc.createTexture('atlas_r').setImage(atlasRough).setMimeType('image/png');
  const mat = doc.createMaterial(name).setBaseColorTexture(texC).setNormalTexture(texN).setMetallicRoughnessTexture(texR)
    .setMetallicFactor(0).setRoughnessFactor(1).setAlphaMode('MASK').setAlphaCutoff(0.5).setDoubleSided(true);
  prim.setMaterial(mat);
  const mesh = doc.createMesh(name).addPrimitive(prim);
  // Gelenk-Knoten nachbauen (gleiche Reihenfolge, Hierarchie, Ruhelage)
  const map = new Map();
  for (const j of joints) {
    const nj = doc.createNode(j.getName()).setTranslation(j.getTranslation()).setRotation(j.getRotation()).setScale(j.getScale());
    map.set(j, nj);
  }
  const rootJoints = [];
  for (const j of joints) {
    const parent = j.getParentNode();
    if (parent && map.has(parent)) map.get(parent).addChild(map.get(j)); else rootJoints.push(j);
  }
  // Übergeordnete Nicht-Gelenk-Knoten (Armatur) mitnehmen
  const scene = doc.createScene(name);
  for (const rj of rootJoints) {
    let top = map.get(rj), p = rj.getParentNode();
    while (p) {
      const np = doc.createNode(p.getName()).setTranslation(p.getTranslation()).setRotation(p.getRotation()).setScale(p.getScale());
      np.addChild(top); top = np; p = p.getParentNode();
    }
    scene.addChild(top);
  }
  const ibm = skin.getInverseBindMatrices();
  const newSkin = doc.createSkin(name);
  for (const j of joints) newSkin.addJoint(map.get(j));
  if (ibm) newSkin.setInverseBindMatrices(acc('MAT4', new Float32Array(ibm.getArray())));
  const meshNode = doc.createNode(name + '_mesh').setMesh(mesh).setSkin(newSkin);
  scene.addChild(meshNode);
  doc.getRoot().setDefaultScene(scene);

  // Maße und Augen (Kopf-Knochen-Raum) für das Spiel
  let minY = Infinity, maxY = -Infinity;
  for (let i = 1; i < pos.length; i += 3) { minY = Math.min(minY, pos[i]); maxY = Math.max(maxY, pos[i]); }
  const headIdx = joints.findIndex((j) => j.getName() === 'head');
  let eyes = null;
  if (ibm && headIdx >= 0 && eyePts.length) {
    const M = ibm.getArray().slice(headIdx * 16, headIdx * 16 + 16); // Spaltenweise
    const tf = ([x, y, z]) => [M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]];
    const L = eyePts.filter((p) => p[0] > 0), R = eyePts.filter((p) => p[0] <= 0);
    const avg = (a) => a.reduce((s, p) => [s[0] + p[0] / a.length, s[1] + p[1] / a.length, s[2] + p[2] / a.length], [0, 0, 0]);
    // vorderste Punkte = Pupille
    const front = (a) => { const zMax = Math.max(...a.map((p) => p[2])); return avg(a.filter((p) => p[2] > zMax - 0.004)); };
    if (L.length && R.length) eyes = [tf(front(L)).map((v) => +v.toFixed(4)), tf(front(R)).map((v) => +v.toFixed(4))];
  }
  return { doc, info: { height: +(maxY - minY).toFixed(3), joints: joints.map((j) => j.getName()), eyes, srcTris: idx.length / 3 } };
}

async function finish(doc, file, { tris, tex }) {
  await doc.transform(weld(), dedup());
  const before = doc.getRoot().listMeshes()[0].listPrimitives()[0].getIndices().getCount() / 3;
  const ratio = Math.min(1, tris / before);
  if (ratio < 0.98) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.004, lockBorder: false }));
  await doc.transform(
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tex, tex], quality: 90, slots: /^normalTexture$/ }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tex, tex], quality: 86, slots: /^(?!normalTexture$).*$/ }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  await io.write(file, doc);
  const after = doc.getRoot().listMeshes()[0].listPrimitives()[0].getIndices().getCount() / 3;
  return { tris: Math.round(after), bytes: (await fs.stat(file)).size };
}

const files = (await fs.readdir(RAW)).filter((f) => f.endsWith('.glb') && !f.endsWith('_lo.glb'));
const index = {};
for (const f of files.sort()) {
  const name = f.replace(/\.glb$/, '');
  try {
    const { doc, info } = await packOne(name, path.join(RAW, f));
    const hi = await finish(doc, path.join(OUT, name + '.glb'), { tris: budget.tris, tex: budget.tex });
    const { doc: doc2 } = await packOne(name, path.join(RAW, f));
    const lo = await finish(doc2, path.join(OUT, name + '_lo.glb'), { tris: budget.trisLo, tex: budget.texLo });
    const h = crypto.createHash('sha1');
    for (const x of [name + '.glb', name + '_lo.glb']) h.update(await fs.readFile(path.join(OUT, x)));
    index[name] = { ...info, tris: hi.tris, trisLo: lo.tris, bytes: hi.bytes, bytesLo: lo.bytes, v: h.digest('hex').slice(0, 10), assets: report.chars?.[name]?.assets || null };
    console.log(`+ ${name}: ${info.srcTris} → ${hi.tris} / ${lo.tris} Dreiecke, ${(hi.bytes / 1024).toFixed(0)} KB / ${(lo.bytes / 1024).toFixed(0)} KB, Höhe ${info.height} m, Augen ${JSON.stringify(info.eyes)}`);
  } catch (e) {
    console.log(`! ${name}: ${e.stack || e.message}`);
  }
}
await fs.writeFile(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1));
let md = '# Figuren – Herkunft\n\nAlle Figuren sind mit [MPFB](https://static.makehumancommunity.org/mpfb.html) (MakeHuman für Blender) aus dem CC0-Paket **makehuman_system_assets** gebaut: Körper, Häute, Kleidung, Haare und Augen stehen unter **CC0 1.0** (gemeinfrei). Aufbereitet (Atlas, vereinfacht, WebP, Meshopt) von scripts/chars/pack-chars.mjs.\n\n| Figur | Teile |\n|---|---|\n';
for (const [n, r] of Object.entries(index)) md += `| ${n} | ${r.assets ? Object.values(r.assets).flat().join(', ') : '–'} |\n`;
await fs.writeFile(path.join(OUT, 'QUELLEN.md'), md);
console.log(`${Object.keys(index).length} Figuren`);
