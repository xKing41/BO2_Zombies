// ─────────────────────────────────────────────────────────────
//  Gewählte CC0-Texturen laden und fürs Spiel aufbereiten (läuft in
//  GitHub Actions mit Internet). Eingabe: scripts/assets/textures.json
//    { "sizes": [1024, 512], "items": { "<slot>": { "src": "acg"|"ph", "id": "…",
//      "metal": true, "opacity": true, "height": true, "ao": 0.6, "tint": [r,g,b],
//      "only": ["normal", "rough", "height"] } } }
//  Ausgabe je Slot in public/tex/<slot>/ (WebP):
//    color_<S>  Farbe (sRGB), Umgebungsverdeckung (AO) eingerechnet
//    normal_<S> Normal-Map (OpenGL-Ausrichtung)
//    rough_<S>  Rauheit (grau)
//    metal_<S>  Metall (grau, nur wenn "metal": true)
//    alpha_<S>  Deckkraft (grau, nur wenn "opacity": true)
//    height_<S> Höhe (grau, nur wenn "height": true – z. B. Stoffstruktur für Figuren)
//  "only" begrenzt die Ausgabe auf einzelne Karten (Detail-Texturen ohne Farbe).
//  Dazu public/tex/index.json (Dateien, Größen, Herkunft) und QUELLEN.md.
//  Schon vorhandene Slots mit gleicher Quelle werden übersprungen.
// ─────────────────────────────────────────────────────────────
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import sharp from 'sharp';

const UA = 'Nachtfall-Zombies asset script (github.com/xKing41/BO2_Zombies)';
const CFG = JSON.parse(await fs.readFile(new URL('./textures.json', import.meta.url), 'utf8'));
const OUT = 'public/tex';
const SIZES = CFG.sizes || [1024, 512];
const FORCE = process.argv.includes('--force');
await fs.mkdir(OUT, { recursive: true });

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

// ── Quellen: liefern Rohbilder je Kanal ─────────────────────
async function fromAmbientCG(id) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'acg-'));
  let info = null;
  try { info = (await get(`https://ambientcg.com/api/v2/full_json?id=${id}&include=downloadData,displayData,dimensionsData`)).foundAssets?.[0]; } catch (e) { console.log('  (Info nicht abrufbar:', e.message, ')'); }
  const links = [];
  (function walk(o) {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (o.attribute && (o.downloadLink || o.fullDownloadPath)) links.push({ attr: o.attribute, url: o.fullDownloadPath || o.downloadLink });
    else for (const v of Object.values(o)) walk(v);
  })(info?.downloadFolders);
  const pick = links.find((l) => l.attr === '1K-JPG') || links.find((l) => l.attr === '2K-JPG') || links.find((l) => /JPG/.test(l.attr));
  const url = pick?.url || `https://ambientcg.com/get?file=${id}_1K-JPG.zip`;
  const zip = path.join(tmp, 'a.zip');
  await fs.writeFile(zip, await get(url, 'buf'));
  execFileSync('unzip', ['-q', '-o', zip, '-d', tmp]);
  const files = await fs.readdir(tmp);
  const find = (re) => { const f = files.find((n) => re.test(n)); return f ? path.join(tmp, f) : null; };
  return {
    color: find(/_Color\.(jpg|png)$/i),
    normal: find(/_NormalGL\.(jpg|png)$/i),
    rough: find(/_Roughness\.(jpg|png)$/i),
    ao: find(/_AmbientOcclusion\.(jpg|png)$/i),
    metal: find(/_Metalness\.(jpg|png)$/i),
    opacity: find(/_Opacity\.(jpg|png)$/i),
    height: find(/_Displacement\.(jpg|png)$/i),
    meta: { name: info?.displayName || id, page: `https://ambientcg.com/view?id=${id}`, dims: info?.dimensionX ? [info.dimensionX, info.dimensionY] : null },
  };
}

async function fromPolyHaven(id) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-'));
  const files = await get(`https://api.polyhaven.com/files/${id}`);
  let info = null;
  try { info = await get(`https://api.polyhaven.com/info/${id}`); } catch { /* optional */ }
  const keys = Object.keys(files);
  const pickMap = async (names, fmt = ['jpg', 'png']) => {
    const low = names.map((n) => n.toLowerCase());
    const key = names.find((n) => files[n]) || keys.find((k) => low.includes(k.toLowerCase())) || keys.find((k) => low.some((n) => k.toLowerCase().includes(n)));
    if (!key) return null;
    const res = files[key]['1k'] || files[key]['2k'] || files[key][Object.keys(files[key])[0]];
    const f = fmt.map((x) => res?.[x]).find(Boolean);
    if (!f?.url) return null;
    const p = path.join(tmp, `${key}.${f.url.split('.').pop().split('?')[0]}`);
    await fs.writeFile(p, await get(f.url, 'buf'));
    return p;
  };
  return {
    color: await pickMap(['Diffuse', 'diff', 'Color']),
    normal: await pickMap(['nor_gl', 'Normal']),
    rough: await pickMap(['Rough', 'rough', 'Roughness']),
    ao: await pickMap(['AO', 'ao']),
    metal: await pickMap(['Metal', 'metal', 'Metalness']),
    opacity: await pickMap(['Opacity', 'alpha', 'Alpha']),
    height: await pickMap(['Displacement', 'disp', 'Height']),
    meta: { name: info?.name || id, page: `https://polyhaven.com/a/${id}`, dims: info?.dimensions || null, maps: keys.join(',') },
  };
}

// ── Aufbereitung ─────────────────────────────────────────────
const gray = (file, S) => sharp(file).resize(S, S, { fit: 'fill', kernel: 'lanczos3' }).toColourspace('b-w');
async function processSlot(slot, it) {
  const raw = it.src === 'ph' ? await fromPolyHaven(it.id) : await fromAmbientCG(it.id);
  const want = (k) => !it.only || it.only.includes(k);
  if (!raw.color && want('color')) throw new Error(`keine Farbtextur gefunden (vorhanden: ${raw.meta?.maps || '?'})`);
  const dir = `${OUT}/${slot}`;
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  const out = {
    color: !!raw.color && want('color'), normal: !!raw.normal && want('normal'), rough: !!raw.rough && want('rough'),
    metal: !!(it.metal && raw.metal), alpha: !!(it.opacity && raw.opacity), height: !!((it.height || it.only?.includes('height')) && raw.height),
  };
  const aoStrength = it.ao ?? 0.6;
  for (const S of SIZES) {
    // Farbe: AO einrechnen (dunkelt Fugen und Ritzen ab), optional einfärben
    if (out.color) {
    let col = sharp(raw.color).resize(S, S, { fit: 'fill', kernel: 'lanczos3' }).removeAlpha();
    if (raw.ao && aoStrength > 0) {
      const ao = await gray(raw.ao, S).linear(aoStrength, 255 * (1 - aoStrength)).toBuffer();
      col = sharp(await col.toBuffer()).composite([{ input: await sharp(ao).toColourspace('srgb').toBuffer(), blend: 'multiply' }]);
    }
    if (it.tint) col = sharp(await col.toBuffer()).linear(it.tint, [0, 0, 0]);
    await col.webp({ quality: 80, effort: 6, smartSubsample: true }).toFile(`${dir}/color_${S}.webp`);
    }
    if (out.normal) await sharp(raw.normal).resize(S, S, { fit: 'fill', kernel: 'lanczos3' }).removeAlpha().webp({ quality: 84, effort: 6, smartSubsample: true }).toFile(`${dir}/normal_${S}.webp`);
    if (out.rough) await gray(raw.rough, S).webp({ quality: 85, effort: 6 }).toFile(`${dir}/rough_${S}.webp`);
    if (out.metal) await gray(raw.metal, S).webp({ quality: 85, effort: 6 }).toFile(`${dir}/metal_${S}.webp`);
    if (out.alpha) await gray(raw.opacity, S).webp({ quality: 90, effort: 6 }).toFile(`${dir}/alpha_${S}.webp`);
    if (out.height) await gray(raw.height, S).normalise().webp({ quality: 88, effort: 6 }).toFile(`${dir}/height_${S}.webp`);
  }
  // Durchschnittsfarbe (für Ersatzfarbe beim Laden und zum Abgleich)
  let avg = null;
  if (out.color) { const st = await sharp(`${dir}/color_${SIZES[SIZES.length - 1]}.webp`).stats(); avg = st.channels.slice(0, 3).map((c) => Math.round(c.mean)); }
  let bytes = 0;
  for (const f of await fs.readdir(dir)) bytes += (await fs.stat(`${dir}/${f}`)).size;
  return { src: it.src, id: it.id, name: raw.meta.name, page: raw.meta.page, dims: raw.meta.dims, maps: out, sizes: SIZES, avg, bytes, license: 'CC0 1.0' };
}

const wanted = Object.entries(CFG.items || {});
let failed = 0;
for (const [slot, it] of wanted) {
  const old = index[slot];
  if (!FORCE && old && old.src === it.src && old.id === it.id && JSON.stringify(old.opts || {}) === JSON.stringify(it)) { console.log(`= ${slot}: ${it.id} (schon da)`); continue; }
  try {
    const r = await processSlot(slot, it);
    index[slot] = { ...r, opts: it };
    console.log(`+ ${slot}: ${it.src} ${it.id} – ${(r.bytes / 1024).toFixed(0)} KB, Karten: ${Object.entries(r.maps).filter(([, v]) => v).map(([k]) => k).join(' ')}${r.dims ? `, Maße ${JSON.stringify(r.dims)}` : ''}`);
  } catch (e) {
    failed++;
    console.log(`! ${slot}: ${it.src} ${it.id} – ${e.message}`);
  }
}
// Versionskennung je Slot (Prüfsumme der Dateien): hängt als ?v=… an den Adressen,
// damit Browser-Cache und Offline-Speicher neue Fassungen sicher holen
for (const slot of Object.keys(index)) {
  if (!CFG.items[slot]) continue;
  try {
    const h = crypto.createHash('sha1');
    for (const f of (await fs.readdir(`${OUT}/${slot}`)).sort()) h.update(await fs.readFile(`${OUT}/${slot}/${f}`));
    index[slot].v = h.digest('hex').slice(0, 10);
  } catch { /* Ordner fehlt */ }
}
// Nicht mehr gewünschte Slots entfernen
for (const slot of Object.keys(index)) {
  if (!CFG.items[slot]) { delete index[slot]; await fs.rm(`${OUT}/${slot}`, { recursive: true, force: true }); console.log(`- ${slot}`); }
}
await fs.writeFile(`${OUT}/index.json`, JSON.stringify(index, null, 1));
let md = '# Texturen – Herkunft\n\nAlle Texturen stehen unter **CC0 1.0** (gemeinfrei): frei nutzbar, auch kommerziell, ohne Namensnennung.\nAufbereitet (verkleinert, komprimiert, Umgebungsverdeckung eingerechnet) von scripts/assets/fetch.mjs.\n\n| Verwendung | Quelle | Textur |\n|---|---|---|\n';
for (const [slot, r] of Object.entries(index).sort()) md += `| ${slot} | ${r.src === 'ph' ? 'Poly Haven' : 'ambientCG'} | [${r.name}](${r.page}) |\n`;
await fs.writeFile(`${OUT}/QUELLEN.md`, md);
let total = 0;
for (const r of Object.values(index)) total += r.bytes || 0;
console.log(`\n${Object.keys(index).length} Texturen, zusammen ${(total / 1048576).toFixed(1)} MB${failed ? `, ${failed} fehlgeschlagen` : ''}`);
if (failed) console.log(`::warning::${failed} Textur(en) fehlgeschlagen – siehe oben`);
