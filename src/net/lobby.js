// ─────────────────────────────────────────────────────────────
//  Koop-Lobby: Name, Spiel erstellen oder per Code beitreten, Spielerliste
//  (Platz, Farbe, Ping, Host), Kartenwahl durch den Host, Start.
//
//  Protokoll (JSON über den Raum aus transport.js):
//    Gast → Host   lobby:hello  { name, version }
//    Host → alle   lobby:state  { hostId, code, map, players:[{ slot, peerId, name, char }], started, version }
//    Host → Gast   lobby:reject { reason: 'full' | 'started' | 'version' }
//    Host → alle   lobby:start  { map, players, hostId }
//  Danach startet jedes Gerät (auch der Host):
//    game.startNetGame({ room, isHost, hostId, selfId, slot, players, map, code })
// ─────────────────────────────────────────────────────────────
import { openRoom, makeCode, normalizeCode, isValidCode, netOptions, PROTOCOL, CODE_LENGTH } from './transport.js';
import { MAPS, MAP_ORDER } from '../maps/index.js';

export const MAX_PLAYERS = 4;
// Spielerfarben je Platz wie in BO2: 1 weiß, 2 blau, 3 gelb, 4 grün
export const SLOT_COLORS = ['#f2f2f2', '#5aa9ff', '#ffd84a', '#6ee06a'];
export const slotColor = (slot) => SLOT_COLORS[(slot - 1) % SLOT_COLORS.length] || SLOT_COLORS[0];
export const DEFAULT_NAME = 'Überlebender';
const NAME_KEY = 'nachtfall.name';
const NAME_MAX = 16;
const JOIN_TIMEOUT = 15000; // ohne Antwort eines Hosts: „Kein Spiel mit diesem Code gefunden“
const RELAY_TIMEOUT = 10000; // kein Vermittlungs-Relay erreichbar
const HELLO_RETRY = 3000;
const REJECT_TEXT = { full: 'Spiel ist voll', started: 'Spiel läuft bereits', version: 'Andere Spielversion' };

export function cleanName(text) {
  const s = String(text ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim();
  return [...s].slice(0, NAME_MAX).join('').trim() || DEFAULT_NAME;
}
export function loadName() {
  try { return cleanName(localStorage.getItem(NAME_KEY)); } catch { return DEFAULT_NAME; }
}
export function saveName(name) {
  try { localStorage.setItem(NAME_KEY, name); } catch { /* privater Modus */ }
}

// Spielerliste von außen: nur gültige Einträge, höchstens vier, nach Platz sortiert
function cleanPlayers(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const p of list) {
    if (!p || typeof p.peerId !== 'string' || !Number.isInteger(p.slot) || p.slot < 1 || p.slot > MAX_PLAYERS) continue;
    if (out.some((q) => q.slot === p.slot || q.peerId === p.peerId)) continue;
    out.push({ slot: p.slot, peerId: p.peerId, name: cleanName(p.name), char: Number.isInteger(p.char) ? p.char : p.slot - 1 });
  }
  return out.sort((a, b) => a.slot - b.slot).slice(0, MAX_PLAYERS);
}
const copyPlayers = (list) => list.map((p) => ({ ...p }));

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* z. B. WebView ohne Berechtigung → Rückfall */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;user-select:text;-webkit-user-select:text';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

// Link zum direkten Beitreten – nur, wenn die Seite unter einer echten Adresse läuft
function shareUrl(code) {
  try {
    if (location.protocol !== 'https:' || window.top !== window || location.hostname === 'appassets.androidplatform.net') return '';
    return location.origin + location.pathname + '#join=' + code;
  } catch { return ''; }
}

export class Lobby {
  /**
   * @param {object} o
   * @param {object} o.game      Spielinstanz (Kartenvorgabe, startNetGame über launch)
   * @param {(id: string) => void} o.show   Bildschirm wechseln (main.js)
   * @param {(ctx: object) => Promise<true|string>} o.launch  startet das Koop-Spiel; true oder Hinweistext
   * @param {() => void} [o.gesture]  bei Benutzer-Klick (Vollbild/Ton freischalten)
   */
  constructor({ game, show, launch, gesture = () => {} }) {
    this.game = game;
    this.show = show;
    this.launch = launch;
    this.gesture = gesture;
    this.mode = netOptions().mode;
    this.room = null;
    this.subs = [];
    this.phase = 'idle'; // idle → lobby → starting → game
    this.isHost = false;
    this.hostId = null;
    this.code = '';
    this.map = MAP_ORDER[0];
    this.players = [];
    this.name = loadName();
    this.reject = '';
    this.netError = '';
    this.note = '';
    this.noteUntil = 0;
    this.t0 = 0;
    this.lastHello = 0;
    this.timer = null;
    this.token = 0;
    const $ = (id) => document.getElementById(id);
    this.el = {
      name: $('coopName'), code: $('coopCode'), msg: $('coopMsg'),
      lobbyCode: $('lobbyCode'), status: $('lobbyStatus'), players: $('lobbyPlayers'),
      maps: $('lobbyMaps'), mapHint: $('lobbyMapHint'),
      start: $('btnStartNet'), copy: $('btnCopyCode'), share: $('btnShareCode'), leave: $('btnLeaveLobby'),
    };
    this.bind($);
  }

  // ── Bedienelemente ─────────────────────────────────────────
  bind($) {
    const e = this.el;
    e.name.maxLength = NAME_MAX;
    e.name.value = this.name;
    e.name.addEventListener('change', () => this.takeName());
    e.name.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); e.name.blur(); } });
    const fixCode = () => { const v = normalizeCode(e.code.value); if (v !== e.code.value) e.code.value = v; };
    e.code.maxLength = CODE_LENGTH;
    e.code.addEventListener('input', (ev) => { if (!ev.isComposing) fixCode(); this.setMsg(''); });
    e.code.addEventListener('change', fixCode);
    e.code.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); this.join(); } });
    $('btnCreate').onclick = () => this.create();
    $('btnJoin').onclick = () => this.join();
    $('btnCoopBack').onclick = () => this.show('menu');
    e.copy.onclick = () => this.copyCode();
    e.share.onclick = () => this.shareCode();
    e.share.classList.toggle('hidden', typeof navigator.share !== 'function');
    e.start.onclick = () => this.startGame();
    e.leave.onclick = () => this.leave();
    // Kartenknöpfe einmal anlegen (Fokus für die Controller-Steuerung bleibt so erhalten)
    e.maps.textContent = '';
    this.mapButtons = MAP_ORDER.map((id) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lm';
      b.dataset.map = id;
      b.textContent = MAPS[id].name;
      b.onclick = () => this.setMap(id);
      e.maps.appendChild(b);
      return b;
    });
  }

  takeName() {
    this.name = cleanName(this.el.name.value);
    this.el.name.value = this.name;
    saveName(this.name);
  }

  setMsg(text) {
    this.el.msg.textContent = text || '';
  }

  /** Koop-Bildschirm zeigen (optional mit Meldung und vorausgefülltem Code) */
  open(message = '', code = '') {
    if (this.phase !== 'idle') this.reset();
    this.name = loadName();
    this.el.name.value = this.name;
    if (code) this.el.code.value = normalizeCode(code);
    this.setMsg(message);
    this.show('coop');
  }

  /** #join=CODE in der Adresse → Koop-Bildschirm mit Code. Gibt true zurück, wenn verarbeitet. */
  consumeDeepLink() {
    const code = netOptions().join;
    if (!code) return false;
    try {
      const p = new URLSearchParams(location.hash.slice(1));
      p.delete('join');
      const rest = p.toString();
      history.replaceState(null, '', location.pathname + location.search + (rest ? '#' + rest : ''));
    } catch { /* z. B. in einer Sandbox */ }
    this.open('', code);
    return true;
  }

  /** Zurück-Taste / Controller B */
  back(screen) {
    if (screen === 'lobby') this.leave();
    else if (screen === 'coop') this.show('menu');
  }

  create() {
    this.takeName();
    this.gesture();
    this.enter(true, makeCode());
  }

  join() {
    this.takeName();
    const code = normalizeCode(this.el.code.value);
    this.el.code.value = code;
    if (!isValidCode(code)) {
      this.setMsg(`Bitte den ${CODE_LENGTH}-stelligen Code eingeben`);
      try { this.el.code.focus(); } catch { /* */ }
      return;
    }
    this.gesture();
    this.enter(false, code);
  }

  /** Lobby verlassen → Koop-Bildschirm */
  leave(message = '') {
    this.reset();
    this.open(message);
  }

  /** Raum schließen und alles zurücksetzen (auch beim Beenden eines laufenden Koop-Spiels) */
  reset() {
    this.token++;
    for (const off of this.subs) off();
    this.subs = [];
    clearInterval(this.timer);
    this.timer = null;
    if (this.room) {
      const r = this.room;
      this.room = null;
      r.leave();
    }
    this.phase = 'idle';
    this.isHost = false;
    this.hostId = null;
    this.players = [];
  }

  get active() { return this.phase !== 'idle'; }

  async enter(host, code) {
    this.reset();
    const token = this.token;
    Object.assign(this, {
      phase: 'lobby', isHost: host, code, hostId: null, players: [],
      reject: '', netError: '', note: '', t0: performance.now(), lastHello: 0,
    });
    const cur = this.game.settings?.map;
    this.map = host ? (MAPS[cur] ? cur : MAP_ORDER[0]) : null;
    this.show('lobby');
    this.render();
    let room;
    try {
      room = await openRoom({ code, mode: this.mode });
    } catch (err) {
      if (token !== this.token) return;
      console.error('[Koop]', err);
      this.phase = 'idle';
      this.open(err?.message || 'Verbindung nicht möglich');
      return;
    }
    if (token !== this.token) { room.leave(); return; }
    this.room = room;
    if (host) {
      this.hostId = room.selfId;
      this.players = [{ slot: 1, peerId: room.selfId, name: this.name, char: 0 }];
    }
    this.subs.push(
      room.on('lobby:hello', (d, from) => this.onHello(d, from)),
      room.on('lobby:state', (d, from) => this.onState(d, from)),
      room.on('lobby:reject', (d, from) => this.onReject(d, from)),
      room.on('lobby:start', (d, from) => this.onStart(d, from)),
      room.onPeerJoin((id) => this.onPeerJoin(id)),
      room.onPeerLeave((id) => this.onPeerLeave(id)),
      room.onError((e) => this.onNetError(e)),
    );
    this.timer = setInterval(() => this.tick(), 500);
    this.render();
  }

  // ── Protokoll ──────────────────────────────────────────────
  others() {
    const self = this.room?.selfId;
    return this.players.map((p) => p.peerId).filter((id) => id !== self);
  }

  stateMsg() {
    return {
      hostId: this.room.selfId, code: this.code, map: this.map, players: copyPlayers(this.players),
      started: this.phase !== 'lobby', version: PROTOCOL,
    };
  }

  broadcastState() {
    if (!this.room) return;
    const to = this.others();
    if (to.length) this.room.send('lobby:state', this.stateMsg(), to);
  }

  hello(to) {
    if (!this.room) return;
    this.lastHello = performance.now();
    this.room.send('lobby:hello', { name: this.name, version: PROTOCOL }, to);
  }

  onPeerJoin(id) {
    if (this.phase !== 'lobby') return;
    // Wer der Host ist, steht erst in dessen lobby:state – also alle grüßen; nur der Host antwortet
    if (!this.isHost && !this.hostId && !this.reject) this.hello(id);
    this.renderPlayers();
  }

  onPeerLeave(id) {
    if (this.phase !== 'lobby') return; // im Spiel kümmert sich das Spiel darum
    if (this.isHost) {
      if (!this.players.some((p) => p.peerId === id)) return;
      this.players = this.players.filter((p) => p.peerId !== id);
      this.broadcastState();
      this.render();
    } else if (id === this.hostId) {
      this.leave('Host hat das Spiel verlassen');
    } else {
      this.renderPlayers();
    }
  }

  // Host: Beitrittswunsch prüfen und niedrigsten freien Platz vergeben
  onHello(d, from) {
    if (!this.isHost || !this.room) return;
    const known = this.players.find((p) => p.peerId === from);
    if (known) {
      if (this.phase === 'lobby') this.room.send('lobby:state', this.stateMsg(), from);
      return;
    }
    const reason = !d || typeof d !== 'object' || d.version !== PROTOCOL ? 'version'
      : this.phase !== 'lobby' ? 'started'
        : this.players.length >= MAX_PLAYERS ? 'full' : null;
    if (reason) {
      this.room.send('lobby:reject', { reason }, from);
      return;
    }
    let slot = 1;
    while (this.players.some((p) => p.slot === slot)) slot++;
    this.players.push({ slot, peerId: from, name: cleanName(d.name), char: slot - 1 });
    this.players.sort((a, b) => a.slot - b.slot);
    this.broadcastState();
    this.render();
  }

  onState(d, from) {
    if (this.isHost || this.phase !== 'lobby' || !this.room || !d || typeof d !== 'object' || d.hostId !== from) return;
    if (d.version != null && d.version !== PROTOCOL) { this.fail('version'); return; }
    const players = cleanPlayers(d.players);
    if (!players.some((p) => p.peerId === this.room.selfId)) return; // (noch) nicht aufgenommen
    this.hostId = from;
    this.players = players;
    this.map = MAPS[d.map] ? d.map : MAP_ORDER[0];
    this.netError = '';
    this.render();
  }

  onReject(d, from) {
    if (this.isHost || this.phase !== 'lobby' || (this.hostId && from !== this.hostId)) return;
    this.fail(d && d.reason);
  }

  // Abgewiesen: Raum verlassen, Lobby mit Meldung stehen lassen („Verlassen“ führt zurück)
  fail(reason) {
    this.reject = REJECT_TEXT[reason] || 'Beitritt abgelehnt';
    for (const off of this.subs) off();
    this.subs = [];
    if (this.room) { this.room.leave(); this.room = null; }
    this.players = [];
    this.hostId = null;
    this.render();
  }

  onStart(d, from) {
    if (this.isHost || this.phase !== 'lobby' || !this.room || !this.hostId || from !== this.hostId || !d) return;
    const players = cleanPlayers(d.players);
    const me = players.find((p) => p.peerId === this.room.selfId);
    if (!me) return;
    this.players = players;
    if (MAPS[d.map]) this.map = d.map;
    this.begin({ isHost: false, hostId: from, slot: me.slot });
  }

  onNetError(e) {
    if (this.phase !== 'lobby') return;
    console.warn('[Koop] Verbindungsproblem:', e && e.error);
    if (!this.isHost && !this.hostId) this.netError = 'Direkte Verbindung fehlgeschlagen – anderes Netz (z. B. WLAN) versuchen';
    else this.flashNote('Ein Mitspieler konnte keine Direktverbindung aufbauen', 8000);
    this.renderStatus();
  }

  setMap(id) {
    if (!this.isHost || this.phase !== 'lobby' || !MAPS[id] || id === this.map) return;
    this.map = id;
    this.broadcastState();
    this.renderMaps();
  }

  startGame() {
    if (!this.isHost || this.phase !== 'lobby' || !this.room) return;
    const self = this.room.selfId;
    this.room.send('lobby:start', { map: this.map, players: copyPlayers(this.players), hostId: self }, this.others());
    const me = this.players.find((p) => p.peerId === self);
    this.begin({ isHost: true, hostId: self, slot: me ? me.slot : 1 });
  }

  async begin({ isHost, hostId, slot }) {
    const room = this.room;
    this.phase = 'starting';
    this.note = '';
    this.render();
    const ctx = { room, isHost, hostId, selfId: room.selfId, slot, players: copyPlayers(this.players), map: this.map, code: this.code };
    // Das Startsignal soll hinaus sein, bevor das Laden der Karte die Seite beschäftigt
    if (isHost) await new Promise((r) => setTimeout(r, 60));
    let result;
    try {
      result = room === this.room && this.phase === 'starting' ? await this.launch(ctx) : false;
    } catch (err) {
      console.error('[Koop] Start fehlgeschlagen:', err);
      result = 'Start fehlgeschlagen';
    }
    if (room !== this.room || this.phase !== 'starting') return; // inzwischen verlassen
    if (result === true) {
      // Ab jetzt gehört der Raum dem Spiel; die Lobby weist nur noch Nachzügler ab
      this.phase = 'game';
      clearInterval(this.timer);
      this.timer = null;
      return;
    }
    this.phase = 'lobby';
    if (typeof result === 'string') this.flashNote(result, 6000);
    if (this.isHost) this.broadcastState(); // läuft doch nicht → wieder offen
    this.render();
  }

  flashNote(text, ms) {
    this.note = text;
    this.noteUntil = performance.now() + ms;
  }

  tick() {
    if (this.phase !== 'lobby' && this.phase !== 'starting') return;
    // Gast: Gruß wiederholen, bis ein Host antwortet
    if (this.phase === 'lobby' && !this.isHost && !this.hostId && !this.reject && this.room?.peers.size
      && performance.now() - this.lastHello > HELLO_RETRY) this.hello();
    this.renderPlayers();
    this.renderStatus();
  }

  // ── Anzeige ────────────────────────────────────────────────
  statusText() {
    const t = performance.now() - this.t0;
    if (this.reject) return { text: this.reject, kind: 'err' };
    if (this.phase === 'starting') return { text: 'Spiel startet …', kind: 'ok' };
    if (this.note && performance.now() < this.noteUntil) return { text: this.note, kind: 'note' };
    if (!this.room) return { text: 'Verbinde …', kind: 'wait' };
    const st = this.room.status();
    const relaysDown = st.relays.total > 0 && st.relays.open === 0;
    if (this.isHost) {
      if (relaysDown) return t > RELAY_TIMEOUT ? { text: 'Keine Verbindung zum Vermittlungsnetz – Internet prüfen', kind: 'err' } : { text: 'Verbinde …', kind: 'wait' };
      const n = this.players.length;
      if (n <= 1) return { text: 'Warte auf Mitspieler …', kind: 'wait' };
      if (n >= MAX_PLAYERS) return { text: 'Lobby voll – bereit zum Start', kind: 'ok' };
      return { text: `${n} von ${MAX_PLAYERS} Spielern – warte auf Mitspieler …`, kind: 'ok' };
    }
    if (this.hostId) return { text: 'Warte auf den Host …', kind: 'ok' };
    if (this.netError) return { text: this.netError, kind: 'err' };
    if (relaysDown && t > RELAY_TIMEOUT) return { text: 'Keine Verbindung zum Vermittlungsnetz – Internet prüfen', kind: 'err' };
    if (t < JOIN_TIMEOUT || st.linking > 0) return { text: 'Verbinde …', kind: 'wait' };
    return { text: 'Kein Spiel mit diesem Code gefunden', kind: 'err' };
  }

  render() {
    const e = this.el;
    e.lobbyCode.textContent = this.code || '·····';
    e.start.classList.toggle('hidden', !this.isHost);
    e.start.disabled = !(this.isHost && this.phase === 'lobby' && this.room);
    e.copy.disabled = !this.code;
    e.share.disabled = !this.code;
    this.renderMaps();
    this.renderPlayers();
    this.renderStatus();
  }

  renderMaps() {
    const editable = this.isHost && this.phase === 'lobby' && !!this.room;
    for (const b of this.mapButtons) {
      const on = b.dataset.map === this.map;
      b.classList.toggle('current', on);
      b.setAttribute('aria-pressed', String(on));
      b.disabled = !editable;
    }
    const d = MAPS[this.map];
    this.el.mapHint.textContent = this.isHost ? (d ? d.tagline : '') : (d ? 'Der Host wählt die Karte' : 'Warte auf den Host …');
  }

  renderPlayers() {
    const self = this.room?.selfId;
    const rows = [];
    for (let slot = 1; slot <= MAX_PLAYERS; slot++) {
      const p = this.players.find((q) => q.slot === slot);
      const li = document.createElement('li');
      li.className = 'lp' + (p ? '' : ' empty') + (p && p.peerId === self ? ' me' : '');
      li.style.setProperty('--pc', slotColor(slot));
      li.dataset.slot = slot;
      if (p) li.dataset.peer = p.peerId;
      const add = (cls, text, tag = 'span') => {
        const el = document.createElement(tag);
        el.className = cls;
        if (text != null) el.textContent = text; // Namen nie als HTML einsetzen
        li.appendChild(el);
        return el;
      };
      add('lp-slot', String(slot));
      add('lp-dot', null, 'i');
      add('lp-name', p ? p.name : 'Freier Platz');
      if (p && p.peerId === this.hostId) add('lp-tag', 'Host');
      if (p && p.peerId === self) add('lp-ping you', 'Du');
      else if (p) {
        const ms = this.room?.peers.get(p.peerId)?.ping;
        const el = add('lp-ping', ms == null ? '…' : `${ms} ms`);
        if (ms != null) el.classList.add(ms < 80 ? 'good' : ms < 160 ? 'mid' : 'bad');
      }
      rows.push(li);
    }
    this.el.players.replaceChildren(...rows);
  }

  renderStatus() {
    const { text, kind } = this.statusText();
    const el = this.el.status;
    if (el.textContent !== text) el.textContent = text;
    el.className = 'lobby-status ' + kind;
  }

  // ── Code weitergeben ───────────────────────────────────────
  flashButton(btn, text) {
    clearTimeout(btn._flash);
    if (!btn.dataset.label) btn.dataset.label = btn.textContent;
    btn.textContent = text;
    btn._flash = setTimeout(() => { btn.textContent = btn.dataset.label; }, 1600);
  }

  async copyCode() {
    if (!this.code) return;
    const ok = await copyText(this.code);
    this.flashButton(this.el.copy, ok ? 'Kopiert ✓' : 'Nicht möglich');
  }

  async shareCode() {
    if (!this.code || typeof navigator.share !== 'function') return;
    const data = { title: 'Nachtfall – Koop', text: `Spiel mit mir Nachtfall Zombies im Koop! Spielcode: ${this.code}` };
    const url = shareUrl(this.code);
    if (url) data.url = url;
    try { await navigator.share(data); } catch (err) { if (err?.name !== 'AbortError') this.copyCode(); }
  }
}
