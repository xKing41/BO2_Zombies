// ─────────────────────────────────────────────────────────────
//  Netzwerk für den Koop-Modus (bis zu 4 Spieler) – ohne eigenen Server.
//
//  'p2p'   Die Geräte verbinden sich direkt per WebRTC. Gefunden werden sie
//          über öffentliche Nostr-Relays (Bibliothek Trystero, MIT-Lizenz);
//          die Spieldaten selbst laufen nie über die Relays.
//  'local' BroadcastChannel: mehrere Tabs/Seiten im selben Browser
//          (für Tests und Entwicklung, gleiche Semantik wie 'p2p').
//  'memory' MemoryHub: mehrere Spielinstanzen in derselben Seite (Splitscreen).
//
//  Raum (Room):
//    room.selfId, room.code, room.mode
//    room.peers                    Map<peerId, { id, ping }> (ping in ms, null = noch unbekannt)
//    room.send(type, data, to, opts)
//        data: JSON-fähig oder ArrayBuffer/TypedArray (Binärdaten werden roh übertragen)
//        to:   undefined = alle, eine peerId oder ein Array von peerIds
//        opts.unreliable: über einen ungeordneten Kanal ohne Neuübertragung
//                         (Momentaufnahmen); fällt sonst auf den zuverlässigen zurück
//    room.on(type, fn)             fn(data, fromPeerId) – liefert eine Abmeldefunktion
//    room.onPeerJoin(fn) · room.onPeerLeave(fn) · room.onError(fn) – ebenso
//    room.ping(peerId)             Promise<ms>
//    room.status()                 { relays: { open, total }, linking }
//    room.leave()
//  Binärdaten kommen immer als ArrayBuffer an, undefined wird zu null.
//  Nachrichtentypen mit „~“ am Anfang sind für den Transport reserviert.
//
//  Zum Testen über die Adresse (#a=1&b=2):
//    relay=ws://localhost:7777[,…]   eigene Nostr-Relays statt der öffentlichen
//    ice=none | ice=stun:…[,…]       keine bzw. eigene STUN-Server
//    turn=turn:host:3478|nutzer|pw   zusätzlicher TURN-Server
//    net=local                       Lobby nutzt BroadcastChannel statt WebRTC
// ─────────────────────────────────────────────────────────────
import { joinRoom, selfId as p2pSelfId, getRelaySockets } from 'trystero';

export const PROTOCOL = 1; // bei inkompatiblen Änderungen erhöhen
export const APP_ID = 'nachtfall-zombies';
// Ohne leicht verwechselbare Zeichen (0/O, 1/I/L)
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 5;

const PING_EVERY = 2000; // ms – hält room.peers[…].ping aktuell
const PING_TIMEOUT = 5000;
const LOCAL_TIMEOUT = 8000; // lokaler Mitspieler ohne Lebenszeichen gilt als weg
const U_MAX_BUFFER = 64 * 1024; // unzuverlässiger Kanal: darüber wird verworfen statt gestaut
const U_MAX_SIZE = 60 * 1024;

const noop = () => {};
const enc = new TextEncoder();
const dec = new TextDecoder();

export class NetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'NetError';
    this.code = code;
  }
}

function randomInts(n) {
  const a = new Uint32Array(n);
  if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(a);
  else for (let i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 2 ** 32);
  return a;
}

const genId = (n = 20) => {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return Array.from(randomInts(n), (v) => chars[v % chars.length]).join('');
};

/** Neuer Raumcode, z. B. "K7QXH" */
export function makeCode() {
  return Array.from(randomInts(CODE_LENGTH), (v) => CODE_ALPHABET[v % CODE_ALPHABET.length]).join('');
}

/** Eingabe säubern: Großbuchstaben, nur gültige Zeichen, höchstens 5 */
export function normalizeCode(text) {
  let s = '';
  for (const c of String(text ?? '').toUpperCase()) if (CODE_ALPHABET.includes(c)) s += c;
  return s.slice(0, CODE_LENGTH);
}

export const isValidCode = (code) => typeof code === 'string' && code.length === CODE_LENGTH && normalizeCode(code) === code;

/** Einstellungen aus der Adresse (#relay=…&ice=none&net=local&join=CODE) */
export function netOptions(hash = globalThis.location?.hash || '') {
  const p = new URLSearchParams(String(hash).replace(/^#/, ''));
  const list = (k) => p.getAll(k).flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean);
  const ice = p.get('ice');
  const turn = p.get('turn');
  let turnConfig = null;
  if (turn) {
    const [urls, username, credential] = turn.split('|');
    turnConfig = [{ urls, ...(username ? { username } : {}), ...(credential ? { credential } : {}) }];
  }
  return {
    mode: p.get('net') === 'local' ? 'local' : 'p2p',
    relays: list('relay'),
    iceServers: ice == null ? null : ice === '' || ice === 'none' ? [] : list('ice').map((urls) => ({ urls })),
    turn: turnConfig,
    join: normalizeCode(p.get('join') || ''),
  };
}

const isBinary = (d) => d instanceof ArrayBuffer || ArrayBuffer.isView(d);

// Exakt die Bytes einer Ansicht als eigener ArrayBuffer
function toArrayBuffer(d) {
  if (d instanceof ArrayBuffer) return d;
  if (d.byteOffset === 0 && d.byteLength === d.buffer.byteLength && d.buffer instanceof ArrayBuffer) return d.buffer;
  return d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength);
}

function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new NetError('timeout', what + ': Zeitüberschreitung')), ms); }),
  ]).finally(() => clearTimeout(timer));
}

// Rahmen für den unzuverlässigen Kanal: [Format][Typlänge][Typ…][Nutzdaten…]
function packFrame(type, data) {
  const tag = enc.encode(type);
  if (tag.length > 255) return null;
  const bin = isBinary(data);
  const body = bin
    ? (data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
    : enc.encode(JSON.stringify(data));
  if (body.length > U_MAX_SIZE) return null;
  const out = new Uint8Array(2 + tag.length + body.length);
  out[0] = bin ? 1 : 2;
  out[1] = tag.length;
  out.set(tag, 2);
  out.set(body, 2 + tag.length);
  return out;
}

function unpackFrame(buf) {
  const b = new Uint8Array(buf);
  if (b.length < 2 || b.length < 2 + b[1]) return null;
  const type = dec.decode(b.subarray(2, 2 + b[1]));
  const body = b.subarray(2 + b[1]);
  if (b[0] === 1) return { type, data: body.slice().buffer };
  if (b[0] === 2) return { type, data: JSON.parse(dec.decode(body)) };
  return null;
}

// ── Gemeinsame Grundlage beider Raumarten ───────────────────
class Room {
  constructor(code, mode, selfId) {
    this.code = code;
    this.mode = mode;
    this.selfId = selfId;
    this.peers = new Map();
    this.left = false;
    this._handlers = new Map();
    this._joinFns = new Set();
    this._leaveFns = new Set();
    this._errorFns = new Set();
    this._pinging = new Set();
    this._pingTimer = setInterval(() => { for (const id of this.peers.keys()) this._measure(id); }, PING_EVERY);
  }

  on(type, fn) {
    let set = this._handlers.get(type);
    if (!set) this._handlers.set(type, (set = new Set()));
    const entry = (data, from) => fn(data, from); // eigene Hülle: dieselbe Funktion darf mehrfach angemeldet werden
    set.add(entry);
    return () => set.delete(entry);
  }

  onPeerJoin(fn) { return this._listen(this._joinFns, fn); }
  onPeerLeave(fn) { return this._listen(this._leaveFns, fn); }
  onError(fn) { return this._listen(this._errorFns, fn); }

  _listen(set, fn) {
    const entry = (...a) => fn(...a);
    set.add(entry);
    return () => set.delete(entry);
  }

  _call(set, args, what) {
    for (const fn of [...set]) {
      try { fn(...args); } catch (err) { console.error(`[Netz] Fehler in ${what}:`, err); }
    }
  }

  _emit(type, data, from) {
    if (this.left) return;
    const set = this._handlers.get(type);
    if (set) this._call(set, [data, from], `„${type}“`);
  }

  _addPeer(id) {
    if (this.left || this.peers.has(id) || id === this.selfId) return;
    this.peers.set(id, { id, ping: null });
    this._call(this._joinFns, [id], 'onPeerJoin');
    this._measure(id);
  }

  _removePeer(id) {
    if (!this.peers.has(id)) return;
    this.peers.delete(id);
    this._pinging.delete(id);
    if (!this.left) this._call(this._leaveFns, [id], 'onPeerLeave');
  }

  _emitError(info) {
    if (!this.left) this._call(this._errorFns, [info], 'onError');
  }

  // undefined → alle; sonst nur bekannte Mitspieler (leere Liste = niemand)
  _targets(to) {
    if (to == null) return null;
    return (Array.isArray(to) ? to : [to]).filter((id) => id !== this.selfId && this.peers.has(id));
  }

  send(type, data, to, opts) {
    if (this.left) return;
    if (typeof type !== 'string' || !type) throw new TypeError('room.send: Typ fehlt');
    if (data === undefined) data = null;
    const targets = this._targets(to);
    if (targets && !targets.length) return;
    if (!targets && !this.peers.size) return;
    this._send(type, data, targets, opts);
  }

  async ping(id) {
    if (this.left || !this.peers.has(id)) throw new NetError('peer', 'Unbekannter Mitspieler');
    const ms = await withTimeout(this._ping(id), PING_TIMEOUT, 'Ping');
    const p = this.peers.get(id);
    if (p) p.ping = ms;
    return ms;
  }

  // Hintergrund-Messung: höchstens eine offene Messung je Mitspieler
  _measure(id) {
    if (this.left || this._pinging.has(id) || !this.peers.has(id)) return;
    this._pinging.add(id);
    this.ping(id).catch(noop).finally(() => this._pinging.delete(id));
  }

  status() { return { relays: { open: 1, total: 1 }, linking: 0 }; }

  _close() {
    this.left = true;
    clearInterval(this._pingTimer);
    this.peers.clear();
    this._pinging.clear();
    this._handlers.clear();
    this._joinFns.clear();
    this._leaveFns.clear();
    this._errorFns.clear();
  }
}

// ── WebRTC über Trystero (Vermittlung: Nostr) ───────────────
class P2PRoom extends Room {
  constructor(code, o) {
    super(code, 'p2p', p2pSelfId);
    // Verbindungen mitzählen: so sieht die Lobby, ob schon jemand antwortet
    const pcs = (this._pcs = new Set());
    class TrackedPeerConnection extends RTCPeerConnection {
      constructor(cfg) { super(cfg); pcs.add(this); }
    }
    const config = { appId: APP_ID, rtcPolyfill: TrackedPeerConnection };
    if (o.relays?.length) config.relayConfig = { urls: o.relays };
    if (o.iceServers) config.rtcConfig = { iceServers: o.iceServers };
    if (o.turn) config.turnConfig = o.turn;
    this._t = joinRoom(config, code, {
      onJoinError: (e) => this._emitError({ peerId: e?.peerId || null, error: String(e?.error || 'Verbindungsfehler') }),
    });
    // Alle Nachrichtentypen teilen sich eine Trystero-Aktion: der Typ reist als Metadatum
    // mit, Binärdaten bleiben roh (Trystero erkennt JSON, Text und Bytes selbst).
    this._action = this._t.makeAction('nf');
    this._action.onMessage = (data, ctx) => this._receive(data, ctx);
    // Zusätzlicher Datenkanal ohne Reihenfolge und Neuübertragung (opts.unreliable).
    // „negotiated“: beide Seiten legen ihn mit derselben Nummer an, ohne neue Aushandlung.
    this._u = new Map(); // peerId → { ch, remote }
    this._uRemote = new Set(); // Gegenseite hat ihren Kanal schon gemeldet
    this._uId = 512 + ([...code].reduce((a, c) => a + c.charCodeAt(0) * 7, 0) % 480);
    this._t.onPeerJoin = (id) => { this._addPeer(id); this._openU(id); };
    this._t.onPeerLeave = (id) => { this._closeU(id); this._removePeer(id); };
  }

  _send(type, data, targets, opts) {
    let reliable = targets;
    if (opts?.unreliable && this._u.size) {
      const frame = packFrame(type, data);
      if (frame) {
        const rest = [];
        for (const id of targets ?? this.peers.keys()) if (!this._sendU(id, frame)) rest.push(id);
        if (!rest.length) return;
        reliable = rest;
      }
    }
    this._action.send(data, { target: reliable ?? undefined, metadata: type }).catch(noop);
  }

  _receive(data, ctx) {
    const type = ctx?.metadata;
    const from = ctx?.peerId;
    if (this.left || typeof type !== 'string' || !from) return;
    if (type[0] === '~') { this._control(type, data, from); return; }
    if (ArrayBuffer.isView(data)) data = toArrayBuffer(data);
    this._emit(type, data, from);
  }

  _control(type, data, from) {
    if (type === '~u') {
      const u = this._u.get(from);
      if (u) u.remote = true;
      else this._uRemote.add(from);
    }
  }

  _openU(id) {
    const pc = this._t.getPeers()[id];
    if (!pc || this.left) return;
    let ch;
    try {
      ch = pc.createDataChannel('nf-u', { negotiated: true, id: this._uId, ordered: false, maxRetransmits: 0 });
    } catch (err) {
      console.warn('[Netz] Schneller Kanal nicht verfügbar, nutze den zuverlässigen:', err?.message || err);
      return;
    }
    ch.binaryType = 'arraybuffer';
    const u = { ch, remote: this._uRemote.delete(id) };
    this._u.set(id, u);
    ch.onmessage = (e) => {
      if (this.left || !(e.data instanceof ArrayBuffer)) return;
      u.remote = true;
      let msg = null;
      try { msg = unpackFrame(e.data); } catch { /* defekter Rahmen */ }
      if (msg && msg.type[0] !== '~') this._emit(msg.type, msg.data, id);
    };
    ch.onclose = () => { if (this._u.get(id) === u) this._u.delete(id); };
    // Erst wenn die Gegenseite ihren Kanal gemeldet hat, wird er benutzt (sonst gingen Daten verloren)
    const announce = () => { if (!this.left && this.peers.has(id)) this._action.send(1, { target: id, metadata: '~u' }).catch(noop); };
    if (ch.readyState === 'open') announce();
    else ch.addEventListener('open', announce, { once: true });
  }

  _sendU(id, frame) {
    const u = this._u.get(id);
    if (!u || !u.remote || u.ch.readyState !== 'open') return false;
    if (u.ch.bufferedAmount > U_MAX_BUFFER) return true; // Leitung verstopft: verwerfen statt stauen
    try { u.ch.send(frame); return true; } catch { return false; }
  }

  _closeU(id) {
    const u = this._u.get(id);
    this._u.delete(id);
    this._uRemote.delete(id);
    if (u) try { u.ch.close(); } catch { /* schon zu */ }
  }

  _ping(id) { return this._t.ping(id); }

  status() {
    let open = 0, total = 0;
    try {
      for (const ws of Object.values(getRelaySockets())) { total++; if (ws && ws.readyState === 1) open++; }
    } catch { /* noch keine Relays */ }
    let linking = 0;
    for (const pc of this._pcs) {
      const st = pc.connectionState || pc.iceConnectionState;
      if (st === 'closed' || st === 'failed') { this._pcs.delete(pc); continue; }
      if (pc.remoteDescription && st !== 'connected' && st !== 'completed') linking++;
    }
    return { relays: { open, total }, linking };
  }

  leave() {
    if (this._leaving) return this._leaving;
    for (const id of [...this._u.keys()]) this._closeU(id);
    this._close();
    this._pcs.clear();
    const t = this._t;
    t.onPeerJoin = null;
    t.onPeerLeave = null;
    this._action.onMessage = null;
    this._leaving = Promise.resolve().then(() => t.leave()).catch(noop);
    return this._leaving;
  }
}

// ── BroadcastChannel (mehrere Tabs im selben Browser) ───────
class LocalRoom extends Room {
  constructor(code) {
    super(code, 'local', genId());
    this._ch = new BroadcastChannel('nachtfall-net-' + code);
    this._ch.onmessage = (e) => this._onMsg(e.data);
    this._seen = new Map();
    this._pongs = new Map();
    this._n = 0;
    this._bye = () => this.leave();
    addEventListener('pagehide', this._bye);
    addEventListener('beforeunload', this._bye);
    this._hb = setInterval(() => this._tick(), 1000);
    this._post({ k: 'hi' });
  }

  _post(m, to) {
    m.f = this.selfId;
    if (to != null) m.to = to;
    try { this._ch.postMessage(m); } catch (err) { console.error('[Netz] lokal:', err); }
  }

  _tick() {
    this._post({ k: 'hb' });
    const now = performance.now();
    for (const [id, t] of this._seen) if (now - t > LOCAL_TIMEOUT) { this._seen.delete(id); this._removePeer(id); }
  }

  _onMsg(m) {
    if (this.left || !m || typeof m !== 'object' || typeof m.f !== 'string' || m.f === this.selfId) return;
    if (m.to != null && m.to !== this.selfId && !(Array.isArray(m.to) && m.to.includes(this.selfId))) return;
    const id = m.f;
    if (m.k === 'bye') { this._seen.delete(id); this._removePeer(id); return; }
    this._seen.set(id, performance.now());
    if (!this.peers.has(id)) {
      // Neuling ('hi') oder verpasster Gruß ('hb') → bekannt machen und antworten
      this._addPeer(id);
      if (m.k !== 'hey') this._post({ k: 'hey' }, id);
    }
    switch (m.k) {
      case 'm':
        if (typeof m.t === 'string' && m.t[0] !== '~') this._emit(m.t, m.b ? m.d : JSON.parse(m.d), id);
        break;
      case 'pi': this._post({ k: 'po', n: m.n }, id); break;
      case 'po': {
        const done = this._pongs.get(m.n);
        if (done) { this._pongs.delete(m.n); done(); }
        break;
      }
    }
  }

  _send(type, data, targets) {
    const bin = isBinary(data);
    this._post({ k: 'm', t: type, b: bin ? 1 : 0, d: bin ? toArrayBuffer(data) : JSON.stringify(data) }, targets);
  }

  _ping(id) {
    return new Promise((resolve, reject) => {
      const n = ++this._n;
      const t0 = performance.now();
      const timer = setTimeout(() => { this._pongs.delete(n); reject(new NetError('timeout', 'Ping: Zeitüberschreitung')); }, PING_TIMEOUT);
      this._pongs.set(n, () => { clearTimeout(timer); resolve(Math.round(performance.now() - t0)); });
      this._post({ k: 'pi', n }, id);
    });
  }

  leave() {
    if (!this.left) {
      this._post({ k: 'bye' });
      clearInterval(this._hb);
      removeEventListener('pagehide', this._bye);
      removeEventListener('beforeunload', this._bye);
      this._close();
      this._seen.clear();
      this._pongs.clear();
      try { this._ch.close(); } catch { /* schon zu */ }
    }
    return Promise.resolve();
  }
}

// ── Im Speicher (Splitscreen: mehrere Spieler an einem Gerät) ──
// Gleiche Semantik wie übers Netz: Daten werden kopiert (JSON bzw. neue Puffer)
// und erst nach dem laufenden Ablauf zugestellt – in Sendereihenfolge, ohne Verluste.
class MemoryRoom extends Room {
  constructor(hub) {
    super(hub.code, 'memory', genId());
    this._hub = hub;
  }

  _send(type, data, targets) {
    const bin = isBinary(data);
    const body = bin ? toArrayBuffer(data).slice(0) : JSON.stringify(data);
    for (const r of this._hub.rooms) {
      if (r === this || (targets && !targets.includes(r.selfId))) continue;
      this._hub.post(() => r._emit(type, bin ? body.slice(0) : JSON.parse(body), this.selfId));
    }
  }

  _ping() { return Promise.resolve(0); }

  leave() {
    if (!this.left) {
      const hub = this._hub;
      hub.rooms.delete(this);
      this._close();
      for (const r of hub.rooms) hub.post(() => r._removePeer(this.selfId));
    }
    return Promise.resolve();
  }
}

export class MemoryHub {
  constructor(code = 'LOKAL') {
    this.code = code;
    this.rooms = new Set();
    this._q = [];
    this._queued = false;
  }

  // Neuer Teilnehmer; alle kennen sich sofort (wie nach dem Verbindungsaufbau)
  join() {
    const room = new MemoryRoom(this);
    for (const r of this.rooms) { r._addPeer(room.selfId); room._addPeer(r.selfId); }
    this.rooms.add(room);
    return room;
  }

  post(fn) {
    this._q.push(fn);
    if (this._queued) return;
    this._queued = true;
    queueMicrotask(() => {
      const q = this._q;
      this._q = [];
      this._queued = false;
      for (const f of q) f();
    });
  }
}

/**
 * Raum betreten (bzw. anlegen – es gibt keinen Unterschied, der Host ist eine Frage der Lobby).
 * @param {{ code: string, mode?: 'p2p'|'local', relays?: string[], iceServers?: RTCIceServer[], turn?: RTCIceServer[] }} o
 */
export async function openRoom({ code, mode = 'p2p', ...over } = {}) {
  const c = normalizeCode(code);
  if (!isValidCode(c)) throw new NetError('code', 'Ungültiger Spielcode');
  if (mode === 'local') {
    if (typeof BroadcastChannel !== 'function') throw new NetError('local', 'BroadcastChannel wird nicht unterstützt');
    return new LocalRoom(c);
  }
  if (typeof RTCPeerConnection !== 'function') throw new NetError('webrtc', 'Dieser Browser unterstützt keine Direktverbindungen (WebRTC)');
  if (!globalThis.crypto?.subtle) throw new NetError('insecure', 'Koop braucht eine sichere Verbindung (https)');
  const o = { ...netOptions(), ...over };
  return new P2PRoom(c, o);
}
