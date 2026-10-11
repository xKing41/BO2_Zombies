// ─────────────────────────────────────────────────────────────
//  Koop-Verbindungstest (läuft in GitHub Actions mit echtem Internet):
//  1. Prüft jedes öffentliche Nostr-Relay einzeln: Verbindung, Annahme
//     eines Vermittlungs-Ereignisses (wie es Trystero sendet) und Zustellung
//     an einen zweiten Teilnehmer.
//  2. Spielt mit zwei getrennten Browsern „Spiel erstellen“ + „Beitreten“
//     durch – mit den Relays, die das Spiel benutzt, und optional mit
//     weiteren Relay-Listen zum Vergleich.
//  Aufruf: node scripts/coop-check.mjs [--relays-only] [--extra=wss://a,wss://b]
//          [--no-probe --hash='#relay=ws://localhost:7777&ice=none']  (lokal mit eigenem Test-Relay)
// ─────────────────────────────────────────────────────────────
import { spawn } from 'node:child_process';
import { schnorr } from '@noble/secp256k1';
import { defaultRelayUrls } from '@trystero-p2p/nostr';
import { RELAYS } from '../src/net/relays.js';

const args = process.argv.slice(2);
const RELAYS_ONLY = args.includes('--relays-only');
const EXTRA = (args.find((a) => a.startsWith('--extra=')) || '').slice(8).split(',').filter(Boolean);
const NO_PROBE = args.includes('--no-probe');
const HASH = (args.find((a) => a.startsWith('--hash=')) || '').slice(7);

// Bekannte große Relays als Vergleich
const KNOWN = ['relay.damus.io', 'nos.lol', 'relay.primal.net', 'nostr.mom', 'relay.snort.social', 'offchain.pub',
  'relay.nostr.bg', 'nostr-pub.wellorder.net', 'relay.nostr.band', 'nostr.oxtr.dev', 'relay.nos.social',
  'nostr.bitcoiner.social', 'nostr.fmt.wiz.biz', 'relay.0xchat.com', 'nostr21.com', 'relay.nostrplebs.com',
  'nostr.data.haus', 'relay.nostr.net', 'nostr.einundzwanzig.space', 'relay.lnfi.network'].map((h) => 'wss://' + h);

const hex = (b) => Buffer.from(b).toString('hex');
const sha256 = async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const { secretKey, publicKey } = schnorr.keygen();
const pubkey = hex(publicKey);
const strToNum = (str, limit) => [...str].reduce((a, c) => a + c.charCodeAt(0), 0) % limit;
const rid = () => Math.random().toString(36).slice(2, 12);

async function makeEvent(topic, content) {
  const ev = { kind: strToNum(topic, 1e4) + 2e4, tags: [['x', topic]], created_at: Math.floor(Date.now() / 1000), content, pubkey };
  const id = await sha256(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]));
  return { ...ev, id: hex(id), sig: hex(await schnorr.signAsync(id, secretKey)) };
}

function openSocket(url, ms) {
  return new Promise((resolve, reject) => {
    let ws;
    const t = setTimeout(() => { try { ws.close(); } catch { /* */ } reject(new Error('Zeitüberschreitung')); }, ms);
    try { ws = new WebSocket(url); } catch (e) { clearTimeout(t); reject(e); return; }
    ws.onopen = () => { clearTimeout(t); resolve(ws); };
    ws.onerror = () => { clearTimeout(t); reject(new Error('Verbindungsfehler')); };
  });
}

// Ein Relay prüfen: abonnieren (Socket A), senden (Socket B), Zustellung an A messen
async function probe(url) {
  const r = { url, open: false, accepted: null, reason: '', delivered: false, ms: null };
  let a, b;
  try {
    const t0 = Date.now();
    [a, b] = await Promise.all([openSocket(url, 7000), openSocket(url, 7000)]);
    r.open = true;
    r.openMs = Date.now() - t0;
    const topic = 'nfprobe-' + rid();
    const kind = strToNum(topic, 1e4) + 2e4;
    const sub = rid();
    const eose = new Promise((res) => {
      a.onmessage = (m) => { try { const d = JSON.parse(m.data); if (d[0] === 'EOSE' && d[1] === sub) res(); if (d[0] === 'CLOSED') { r.reason = 'Abo abgelehnt: ' + d[2]; res(); } } catch { /* */ } };
      setTimeout(res, 4000);
    });
    a.send(JSON.stringify(['REQ', sub, { kinds: [kind], since: Math.floor(Date.now() / 1000) - 5, '#x': [topic] }]));
    await eose;
    const ev = await makeEvent(topic, JSON.stringify({ peerId: rid(), offer: 'x'.repeat(400) }));
    const sent = Date.now();
    const got = new Promise((res) => {
      a.onmessage = (m) => { try { const d = JSON.parse(m.data); if (d[0] === 'EVENT' && d[2] && d[2].id === ev.id) res(true); } catch { /* */ } };
      setTimeout(() => res(false), 7000);
    });
    const ok = new Promise((res) => {
      b.onmessage = (m) => { try { const d = JSON.parse(m.data); if (d[0] === 'OK' && d[1] === ev.id) { r.accepted = !!d[2]; if (!d[2]) r.reason = d[3] || 'abgelehnt'; res(); } if (d[0] === 'NOTICE') r.reason = r.reason || 'NOTICE: ' + d[1]; } catch { /* */ } };
      setTimeout(res, 7000);
    });
    b.send(JSON.stringify(['EVENT', ev]));
    const [delivered] = await Promise.all([got, ok]);
    r.delivered = delivered;
    if (delivered) r.ms = Date.now() - sent;
  } catch (e) {
    r.reason = r.reason || e.message;
  } finally {
    for (const s of [a, b]) try { s && s.close(); } catch { /* */ }
  }
  return r;
}

async function probeAll() {
  const urls = [...new Set([...RELAYS, ...defaultRelayUrls, ...KNOWN, ...EXTRA])];
  console.log(`\n── Relay-Test (${urls.length} Relays) ──`);
  const res = await Promise.all(urls.map(probe));
  res.sort((x, y) => (y.delivered - x.delivered) || ((x.ms ?? 1e9) - (y.ms ?? 1e9)));
  for (const r of res) {
    const tags = [RELAYS.includes(r.url) ? 'SPIEL' : '', defaultRelayUrls.includes(r.url) ? 'trystero' : '', KNOWN.includes(r.url) ? 'bekannt' : ''].filter(Boolean).join('+');
    console.log(`${r.delivered ? 'OK  ' : 'FEHL'} ${r.url.padEnd(44)} ${String(r.ms ?? '-').padStart(5)} ms  offen=${r.open} angenommen=${r.accepted} ${tags} ${r.reason}`);
  }
  const good = res.filter((r) => r.delivered).map((r) => r.url);
  const gameGood = RELAYS.filter((u) => good.includes(u));
  console.log(`\nFunktionierende Relays: ${good.length} von ${urls.length}`);
  console.log(`Vom Spiel genutzt: ${gameGood.length} von ${RELAYS.length} funktionieren (${gameGood.join(', ') || 'keins'})`);
  console.log('GUT=' + good.join(','));
  return { res, good };
}

// ── Zwei Browser: erstellen + beitreten ───────────────────────
async function browserCheck(configs) {
  const { chromium } = await import('playwright');
  const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 4000));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const results = [];
  try {
    for (const cfg of configs) {
      console.log(`\n── Host/Gast: ${cfg.name} ──`);
      const mk = async () => {
        const ctx = await browser.newContext({ viewport: { width: 800, height: 450 } });
        await ctx.addInitScript(() => localStorage.setItem('nachtfall.settings', JSON.stringify({ quality: 'minimal', map: 'nachtfall' })));
        return ctx;
      };
      const [c1, c2] = [await mk(), await mk()];
      const H = await c1.newPage(), G = await c2.newPage();
      const log = [];
      for (const [p, tag] of [[H, 'H'], [G, 'G']]) {
        p.on('console', (m) => { const t = m.text(); if (/Koop|Netz|relay|trystero/i.test(t)) log.push(`${tag}: ${t.slice(0, 200)}`); });
        p.on('pageerror', (e) => log.push(`${tag} Fehler: ${e.message}`));
        await p.goto('http://localhost:4173/' + cfg.hash, { waitUntil: 'load' });
      }
      for (const p of [H, G]) await p.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 180000 });
      const t0 = Date.now();
      await H.click('#btnCoop'); await H.fill('#coopName', 'Host'); await H.click('#btnCreate');
      await H.waitForFunction(() => /^[A-Z0-9]{5}$/.test(document.getElementById('lobbyCode').textContent.trim()), null, { timeout: 30000 });
      const code = (await H.textContent('#lobbyCode')).trim();
      await G.click('#btnCoop'); await G.fill('#coopName', 'Gast'); await G.fill('#coopCode', code); await G.click('#btnJoin');
      let ok = false;
      for (let s = 0; s < 18 && !ok; s++) {
        await H.waitForTimeout(5000);
        const st = await Promise.all([H, G].map((p) => p.evaluate(() => {
          const l = window.__lobby, r = l.room;
          return { status: document.getElementById('lobbyStatus').textContent, players: document.querySelectorAll('#lobbyPlayers li[data-peer]').length, net: r ? r.status() : null, peers: r ? r.peers.size : 0 };
        })));
        console.log(`${((Date.now() - t0) / 1000).toFixed(0).padStart(3)} s  Host: ${st[0].status} | Relays ${st[0].net?.relays.open}/${st[0].net?.relays.total}, Peers ${st[0].peers}   Gast: ${st[1].status} | Relays ${st[1].net?.relays.open}/${st[1].net?.relays.total}, Peers ${st[1].peers}`);
        ok = st[0].players === 2 && /Warte auf den Host|Spiel startet/.test(st[1].status);
      }
      const ms = Date.now() - t0;
      console.log(ok ? `ERFOLG: Gast ist nach ${(ms / 1000).toFixed(1)} s in der Lobby des Hosts` : 'FEHLGESCHLAGEN: Gast findet den Host nicht');
      if (log.length) console.log(log.slice(0, 20).join('\n'));
      results.push({ name: cfg.name, ok, ms });
      await c1.close(); await c2.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }
  return results;
}

const { good } = NO_PROBE ? { good: [] } : await probeAll();
if (!RELAYS_ONLY) {
  const configs = [{ name: 'Relays des Spiels', hash: HASH }];
  const others = good.filter((u) => !RELAYS.includes(u)).slice(0, 8);
  if (others.length) configs.push({ name: 'nur andere funktionierende Relays', hash: '#relay=' + others.join(',') });
  const results = await browserCheck(configs);
  console.log('\n── Ergebnis ──');
  for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FEHL'} ${r.name}${r.ok ? ` (${(r.ms / 1000).toFixed(1)} s)` : ''}`);
  if (!results[0].ok) process.exitCode = 1;
}
