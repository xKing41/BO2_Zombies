// ─────────────────────────────────────────────────────────────
//  Gewählte CC0-3D-Modelle (Poly Haven) laden und fürs Spiel aufbereiten
//  (läuft in GitHub Actions mit Internet). Eingabe: scripts/assets/models.json
//    { "defaults": { "tex": 512, "tris": 5000 },
//      "items": { "<slot>": { "id": "<Poly-Haven-ID>", "tex": 512, "tris": 5000 } } }
//  Je Modell entstehen zwei GLB-Dateien in public/models/:
//    <slot>.glb     PC (hoch/mittel): Texturen bis "tex" Pixel, bis "tris" Dreiecke
//    <slot>_lo.glb  Handy (niedrig/minimal): halbe Texturgröße, ~40 % der Dreiecke
//  Aufbereitung: Geometrie vereinfachen (meshoptimizer), Fuß des Modells auf den
//  Ursprung setzen, Texturen als WebP, Meshopt-Kompression, teure Material-Erweiterungen
//  (Transmission, Volumen, Glanzlack …) entfernen – Glas wird halbtransparent.
//  Dazu public/models/index.json (Maße, Dreiecke, Teile) und QUELLEN.md.
//  Test ohne Netz: MODELS_TEST=<pfad.gltf> node scripts/assets/fetch-models.mjs
// ─────────────────────────────────────────────────────────────
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { center, dedup, getBounds, meshopt, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const UA = 'Nachtfall-Zombies asset script (github.com/xKing41/BO2_Zombies)';
const CFG = JSON.parse(await fs.readFile(new URL('./models.json', import.meta.url), 'utf8'));
const OUT = process.env.MODELS_OUT || 'public/models';
const FORCE = process.argv.includes('--force');
const TEST = process.env.MODELS_TEST || '';
await fs.mkdir(OUT, { recursive: true });
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, type = 'json', tries = 3) {
  for (let k = 1; ; k++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return type === 'json' ? await r.json() : Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (k >= tries) throw new Error(`${url}: ${e.message}`);
      await sleep(1000 * k);
    }
  }
}

let index = {};
try { index = JSON.parse(await fs.readFile(`${OUT}/index.json`, 'utf8')); } catch { /* neu */ }

// ── Quelle: glTF (1k-Texturen) samt Dateien von Poly Haven ──
async function download(id) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'phm-'));
  const files = await get(`https://api.polyhaven.com/files/${id}`);
  let info = null;
  try { info = await get(`https://api.polyhaven.com/info/${id}`); } catch { /* optional */ }
  const res = files.gltf?.['1k'] || files.gltf?.['2k'] || Object.values(files.gltf || {})[0];
  const g = res?.gltf;
  if (!g?.url) throw new Error(`kein glTF (vorhanden: ${Object.keys(files).join(',')})`);
  const main = path.join(tmp, g.url.split('/').pop().split('?')[0]);
  await fs.writeFile(main, await get(g.url, 'buf'));
  for (const [rel, f] of Object.entries(g.include || {})) {
    const p = path.join(tmp, rel);
    if (!p.startsWith(tmp)) continue; // nur innerhalb des Arbeitsordners
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, await get(f.url, 'buf'));
  }
  return { file: main, meta: { name: info?.name || id, page: `https://polyhaven.com/a/${id}`, authors: Object.keys(info?.authors || {}) } };
}

// ── Aufbereitung ─────────────────────────────────────────────
function triangles(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const idx = p.getIndices();
    const pos = p.getAttribute('POSITION');
    if (p.getMode() === 4) n += (idx ? idx.getCount() : pos?.getCount() || 0) / 3;
  }
  return Math.round(n);
}

// Teure Material-Erweiterungen entfernen: das Spiel nutzt einfache PBR-Materialien
// (keine zusätzlichen Render-Durchgänge für Transmission). Glas → halbtransparent.
const DROP = ['KHR_materials_transmission', 'KHR_materials_volume', 'KHR_materials_specular', 'KHR_materials_ior',
  'KHR_materials_clearcoat', 'KHR_materials_sheen', 'KHR_materials_iridescence', 'KHR_materials_anisotropy',
  'KHR_materials_dispersion', 'KHR_materials_diffuse_transmission', 'KHR_materials_variants', 'KHR_materials_pbrSpecularGlossiness'];
function simplifyMaterials(doc) {
  for (const m of doc.getRoot().listMaterials()) {
    const tr = m.getExtension('KHR_materials_transmission');
    if (tr && tr.getTransmissionFactor() > 0.3) {
      const c = m.getBaseColorFactor();
      m.setAlphaMode('BLEND');
      m.setBaseColorFactor([c[0], c[1], c[2], Math.min(c[3], 0.35)]);
      m.setRoughnessFactor(Math.min(m.getRoughnessFactor(), 0.15));
    }
  }
  for (const ext of doc.getRoot().listExtensionsUsed()) if (DROP.includes(ext.extensionName)) ext.dispose();
}

// Skelette und Animationen entfernen: Im Spiel sind alle Modelle starre Requisiten
function stripRig(doc) {
  const root = doc.getRoot();
  for (const a of root.listAnimations()) a.dispose();
  for (const n of root.listNodes()) if (n.getSkin()) n.setSkin(null);
  for (const sk of root.listSkins()) sk.dispose();
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
    for (const sem of p.listSemantics()) if (/^(JOINTS|WEIGHTS)_/.test(sem)) p.setAttribute(sem, null);
  }
}

async function variant(src, outFile, { tex, tris, error }) {
  const doc = await io.read(src);
  const before = triangles(doc);
  stripRig(doc);
  simplifyMaterials(doc);
  await doc.transform(dedup(), prune(), weld());
  const ratio = Math.min(1, tris / Math.max(1, before));
  if (ratio < 0.98) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error, lockBorder: false }));
  await doc.transform(
    center({ pivot: 'below' }),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tex, tex], quality: 90, slots: /^normalTexture$/ }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tex, tex], quality: 80, slots: /^(?!normalTexture$).*$/ }),
  );
  const after = triangles(doc);
  // Maße und Teile (oberste Knoten) vor der Kompression bestimmen
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  const b = getBounds(scene);
  const size = b.max.map((v, i) => +(v - b.min[i]).toFixed(3));
  const nodes = scene.listChildren().map((n) => {
    const nb = getBounds(n);
    return { name: n.getName(), size: nb.max.map((v, i) => +(v - nb.min[i]).toFixed(3)), center: nb.max.map((v, i) => +((v + nb.min[i]) / 2).toFixed(3)) };
  });
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(outFile, doc);
  const bytes = (await fs.stat(outFile)).size;
  return { before, after, size, nodes, bytes };
}

async function processModel(slot, it, src) {
  const d = CFG.defaults || {};
  const tex = it.tex ?? d.tex ?? 512, tris = it.tris ?? d.tris ?? 5000;
  const hi = await variant(src.file, `${OUT}/${slot}.glb`, { tex, tris, error: it.error ?? 0.01 });
  const lo = await variant(src.file, `${OUT}/${slot}_lo.glb`, { tex: Math.max(128, tex / 2), tris: Math.round(tris * (it.loRatio ?? 0.4)), error: (it.error ?? 0.01) * 2.5 });
  return {
    id: it.id, name: src.meta.name, page: src.meta.page, license: 'CC0 1.0',
    size: hi.size, nodes: hi.nodes, srcTris: hi.before, tris: hi.after, trisLo: lo.after,
    bytes: hi.bytes, bytesLo: lo.bytes, tex,
  };
}

const wanted = TEST ? [['test', { id: 'test' }]] : Object.entries(CFG.items || {});
let failed = 0;
for (const [slot, it] of wanted) {
  const old = index[slot];
  const opts = { ...(CFG.defaults || {}), ...it };
  if (!FORCE && !TEST && old && old.id === it.id && JSON.stringify(old.opts || {}) === JSON.stringify(opts)) { console.log(`= ${slot}: ${it.id} (schon da)`); continue; }
  try {
    const src = TEST ? { file: TEST, meta: { name: 'Test', page: '' } } : await download(it.id);
    const r = await processModel(slot, it, src);
    index[slot] = { ...r, opts };
    console.log(`+ ${slot}: ${it.id} – ${r.srcTris} → ${r.tris} / ${r.trisLo} Dreiecke, ${(r.bytes / 1024).toFixed(0)} KB / ${(r.bytesLo / 1024).toFixed(0)} KB, Maße ${r.size.join(' × ')} m, Teile: ${r.nodes.map((n) => n.name).join(', ')}`);
  } catch (e) {
    failed++;
    console.log(`! ${slot}: ${it.id} – ${e.stack || e.message}`);
  }
}
// Versionskennung je Modell (Prüfsumme): hängt als ?v=… an den Adressen
for (const slot of Object.keys(index)) {
  try {
    const h = crypto.createHash('sha1');
    for (const f of [`${slot}.glb`, `${slot}_lo.glb`]) h.update(await fs.readFile(`${OUT}/${f}`));
    index[slot].v = h.digest('hex').slice(0, 10);
  } catch { /* Datei fehlt */ }
}
// Nicht mehr gewünschte Modelle entfernen
if (!TEST) {
  for (const slot of Object.keys(index)) {
    if (CFG.items[slot]) continue;
    delete index[slot];
    for (const f of [`${slot}.glb`, `${slot}_lo.glb`]) await fs.rm(`${OUT}/${f}`, { force: true });
    console.log(`- ${slot}`);
  }
}
await fs.writeFile(`${OUT}/index.json`, JSON.stringify(index, null, 1));
let md = '# 3D-Modelle – Herkunft\n\nAlle Modelle stammen von [Poly Haven](https://polyhaven.com) und stehen unter **CC0 1.0** (gemeinfrei): frei nutzbar, auch kommerziell, ohne Namensnennung.\nAufbereitet (vereinfacht, Texturen verkleinert und als WebP, Meshopt-komprimiert) von scripts/assets/fetch-models.mjs.\n\n| Verwendung | Modell | Dreiecke (PC / Handy) |\n|---|---|---|\n';
for (const [slot, r] of Object.entries(index).sort()) md += `| ${slot} | [${r.name}](${r.page}) | ${r.tris} / ${r.trisLo} |\n`;
await fs.writeFile(`${OUT}/QUELLEN.md`, md);
let total = 0;
for (const r of Object.values(index)) total += (r.bytes || 0) + (r.bytesLo || 0);
console.log(`\n${Object.keys(index).length} Modelle, zusammen ${(total / 1048576).toFixed(1)} MB${failed ? `, ${failed} fehlgeschlagen` : ''}`);
if (failed) console.log(`::warning::${failed} Modell(e) fehlgeschlagen – siehe oben`);
