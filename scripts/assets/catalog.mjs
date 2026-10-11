// ─────────────────────────────────────────────────────────────
//  Textur-Katalog (läuft in GitHub Actions mit Internet):
//  Holt die Listen der CC0-Sammlungen ambientCG und Poly Haven und baut je
//  gewünschter Kategorie (catalog-request.json) ein Übersichtsbild mit
//  nummerierten Vorschauen. Ergebnis in out/review/ – der Workflow lädt es
//  als Release „textur-auswahl“ hoch, damit es ausgewählt werden kann.
//  Aufruf: node scripts/assets/catalog.mjs
// ─────────────────────────────────────────────────────────────
import fs from 'node:fs/promises';
import sharp from 'sharp';

const OUT = 'out/review';
const UA = 'Nachtfall-Zombies asset script (github.com/xKing41/BO2_Zombies)';
const REQ = JSON.parse(await fs.readFile(new URL('./catalog-request.json', import.meta.url), 'utf8'));
await fs.mkdir(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, type = 'json', tries = 3) {
  for (let k = 1; ; k++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return type === 'json' ? await r.json() : type === 'text' ? await r.text() : Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (k >= tries) throw new Error(`${url}: ${e.message}`);
      await sleep(800 * k);
    }
  }
}
// Viele Abrufe gleichzeitig, aber nicht alle auf einmal
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
const prefixOf = (id) => id.replace(/\d+[A-Z]?$/, '');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── ambientCG ────────────────────────────────────────────────
async function ambientcg() {
  const all = [];
  let first = true;
  for (let offset = 0; offset < 20000; offset += 250) {
    const url = `https://ambientcg.com/api/v2/full_json?type=Material&include=tagData,displayData,previewData,downloadData&sort=Popular&limit=250&offset=${offset}`;
    const j = await get(url);
    const list = j.foundAssets || j.assets || [];
    if (first) {
      first = false;
      console.log('ambientCG: Felder eines Eintrags:', list[0] ? Object.keys(list[0]).join(', ') : '(leer)', '| Treffer gesamt:', j.numberOfResults);
      if (list[0]) await fs.writeFile(`${OUT}/ambientcg-beispiel.json`, JSON.stringify(list[0], null, 1));
    }
    all.push(...list);
    if (list.length < 250) break;
  }
  return all.map((a, rank) => {
    // Vorschau: kleinste JPG-Vorschau ab 128 px (Schlüssel wie „256-JPG-242424“)
    let thumb = null;
    const prev = a.previewImage || {};
    const keys = Object.keys(prev).map((k) => [k, parseInt(k, 10)]).filter(([, n]) => n >= 128).sort((x, y) => x[1] - y[1]);
    const jpg = keys.find(([k]) => /JPG/i.test(k)) || keys[0];
    if (jpg) thumb = prev[jpg[0]];
    // Downloads: alle Einträge mit „attribute“ (z. B. 1K-JPG) irgendwo unter downloadFolders
    const downloads = [];
    (function walk(o) {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (o.attribute && (o.downloadLink || o.fullDownloadPath)) downloads.push({ attr: o.attribute, url: o.fullDownloadPath || o.downloadLink, size: o.size });
      else for (const v of Object.values(o)) walk(v);
    })(a.downloadFolders);
    return {
      src: 'acg', id: a.assetId, name: a.displayName || a.assetId, cat: a.displayCategory || prefixOf(a.assetId), prefix: prefixOf(a.assetId),
      tags: a.tags || [], rank, thumb, downloads,
    };
  });
}

// ── Poly Haven ───────────────────────────────────────────────
async function polyhaven() {
  const j = await get('https://api.polyhaven.com/assets?t=textures');
  const list = Object.entries(j).map(([id, a]) => ({
    src: 'ph', id, name: a.name || id, cat: (a.categories || []).join(', '), tags: a.tags || [], categories: a.categories || [],
    downloads: a.download_count || 0, maxRes: a.max_resolution,
    thumb: a.thumbnail_url || `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=256&height=256`,
  }));
  list.sort((x, y) => y.downloads - x.downloads);
  list.forEach((a, i) => { a.rank = i; });
  const ex = Object.entries(j)[0];
  if (ex) await fs.writeFile(`${OUT}/polyhaven-beispiel.json`, JSON.stringify({ [ex[0]]: ex[1] }, null, 1));
  return list;
}

const [acg, ph] = await Promise.all([
  ambientcg().catch((e) => { console.log('ambientCG nicht erreichbar:', e.message); return []; }),
  polyhaven().catch((e) => { console.log('Poly Haven nicht erreichbar:', e.message); return []; }),
]);
console.log(`ambientCG: ${acg.length} Materialien, Poly Haven: ${ph.length} Texturen`);

// Präfix-Liste (um weitere Kategorien zu entdecken)
const counts = {};
for (const a of acg) counts[a.prefix] = (counts[a.prefix] || 0) + 1;
await fs.writeFile(`${OUT}/ambientcg-kategorien.txt`, Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}\t${n}`).join('\n') + '\n');
const phCats = {};
for (const a of ph) for (const c of a.categories) phCats[c] = (phCats[c] || 0) + 1;
await fs.writeFile(`${OUT}/polyhaven-kategorien.txt`, Object.entries(phCats).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}\t${n}`).join('\n') + '\n');

// Kompakter Gesamtkatalog (zum Nachschlagen beim Auswählen)
await fs.writeFile(`${OUT}/katalog.json`, JSON.stringify({
  ambientcg: acg.map(({ id, name, cat, tags, downloads }) => ({ id, name, cat, tags, res: downloads.map((d) => d.attr) })),
  polyhaven: ph.map(({ id, name, cat, tags, maxRes, downloads }) => ({ id, name, cat, tags, maxRes, downloads })),
}));

// ── Übersichtsbilder ─────────────────────────────────────────
const TILE = 176, LABEL = 22, COLS = 6;
async function sheet(name, items) {
  const thumbs = await pool(items, 8, async (it) => {
    try {
      const buf = await get(it.thumb, 'buf', 2);
      return await sharp(buf).flatten({ background: '#202020' }).resize(TILE, TILE, { fit: 'cover' }).jpeg().toBuffer();
    } catch (e) { console.log(`  Vorschau fehlt: ${it.id} (${e.message})`); return null; }
  });
  const rows = Math.ceil(items.length / COLS) || 1;
  const W = COLS * TILE, H = rows * (TILE + LABEL);
  const comps = [];
  let svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`;
  items.forEach((it, i) => {
    const x = (i % COLS) * TILE, y = Math.floor(i / COLS) * (TILE + LABEL);
    if (thumbs[i]) comps.push({ input: thumbs[i], left: x, top: y });
    const label = `${i + 1} ${it.src === 'ph' ? 'PH ' : ''}${it.id}`;
    svg += `<rect x="${x}" y="${y + TILE}" width="${TILE}" height="${LABEL}" fill="${it.src === 'ph' ? '#183048' : '#3a2412'}"/>`;
    svg += `<text x="${x + 4}" y="${y + TILE + 16}" font-family="DejaVu Sans, Arial, sans-serif" font-size="12" fill="#ffffff">${esc(label.slice(0, 26))}</text>`;
  });
  svg += '</svg>';
  comps.push({ input: Buffer.from(svg), left: 0, top: 0 });
  await sharp({ create: { width: W, height: H, channels: 3, background: '#111111' } }).composite(comps).jpeg({ quality: 80, mozjpeg: true }).toFile(`${OUT}/${name}.jpg`);
}

const matchPh = (a, words) => {
  const hay = [a.id.replace(/_/g, ' '), a.name.toLowerCase(), ...a.tags.map((t) => t.toLowerCase()), ...a.categories.map((c) => c.toLowerCase())];
  return words.some((w) => hay.some((h) => h === w || h.includes(w)));
};
let index = '# Textur-Auswahl\n\nNummern wie auf den Übersichtsbildern. acg = ambientCG, PH = Poly Haven (beide CC0).\n';
for (const s of REQ.sheets) {
  const skip = s.skip || 0;
  const fromAcg = acg.filter((a) => s.acg.includes(a.prefix)).slice(skip, skip + (REQ.perSheetAcg ?? 24));
  const fromPh = ph.filter((a) => matchPh(a, s.ph)).slice(0, REQ.perSheetPh ?? 12);
  const items = [...fromAcg, ...fromPh];
  console.log(`${s.name}: ${fromAcg.length} ambientCG + ${fromPh.length} Poly Haven`);
  index += `\n## ${s.name}\n`;
  items.forEach((it, i) => { index += `${i + 1}. ${it.src} ${it.id} – ${it.name} [${it.cat}] ${it.tags.slice(0, 8).join(', ')}${it.src === 'acg' ? ` {${it.downloads.map((d) => d.attr).filter((x) => /JPG/.test(x)).join(' ')}}` : ''}\n`; });
  if (items.length) await sheet(s.name, items);
}
await fs.writeFile(`${OUT}/index.md`, index);
console.log('fertig:', (await fs.readdir(OUT)).join(', '));
