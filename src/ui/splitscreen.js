// ─────────────────────────────────────────────────────────────
//  Splitscreen: 2–4 Spieler an einem Bildschirm. Jeder Spieler bekommt
//  eine eigene Spielinstanz (Bildausschnitt, HUD, Eingabegerät, eigene
//  Hörerposition). Verbunden sind die Instanzen über einen Raum im
//  Speicher – also mit genau dem Koop-Code, der auch übers Netz läuft.
//  Spieler 1 ist der Host. Tastatur & Maus spielt immer Spieler 1.
// ─────────────────────────────────────────────────────────────
import { Game } from '../game/game.js';
import { MemoryHub } from '../net/transport.js';
import { MAPS, MAP_ORDER } from '../maps/index.js';
import { SLOT_COLORS } from '../game/survivors.js';

const $ = (id) => document.getElementById(id);
const MAX = 4;
const Q = (x, y) => ({ x, y, w: 0.5, h: 0.5 });
// Aufteilung je Spielerzahl (Anteile des Fensters): zu zweit oben/unten wie in BO2, sonst Viertel
const LAYOUTS = {
  2: [{ x: 0, y: 0, w: 1, h: 0.5 }, { x: 0, y: 0.5, w: 1, h: 0.5 }],
  3: [Q(0, 0), Q(0.5, 0), Q(0, 0.5)],
  4: [Q(0, 0), Q(0.5, 0), Q(0, 0.5), Q(0.5, 0.5)],
};

// HUD auf einen Ausschnitt legen und passend verkleinern (null = ganzer Bildschirm)
export function placeHud(el, v) {
  const s = el.style;
  if (!v) {
    el.classList.remove('split');
    for (const k of ['inset', 'left', 'top', 'width', 'height', 'zoom']) s[k] = '';
    return;
  }
  el.classList.add('split');
  s.inset = 'auto';
  s.left = v.x * 100 + '%'; s.top = v.y * 100 + '%';
  s.width = v.w * 100 + '%'; s.height = v.h * 100 + '%';
  s.zoom = Math.max(0.42, Math.min(1, (innerWidth * v.w) / 1280, (innerHeight * v.h) / 720)).toFixed(3);
}

function padLabel(p) {
  const id = (p.id || '').toLowerCase();
  if (/xbox|045e|xinput/.test(id)) return 'Xbox-Controller';
  if (/054c|playstation|dualsense|dualshock|^wireless controller/.test(id)) return 'PlayStation-Controller';
  if (/057e|nintendo|switch|pro controller/.test(id)) return 'Switch-Controller';
  return 'Controller';
}

export class SplitScreen {
  // ui: { show(id), progress(pct, text), started(), paused() }
  constructor(game, settings, template, ui) {
    this.game = game;
    this.settings = settings;
    this.template = template; // unbenutzte Kopie von #hud
    this.ui = ui;
    this.players = []; // { dev: 'kbm' } | { dev: 'pad', index, label }
    this.map = settings.map;
    this.games = [];
    this.active = false;
    this.busy = false;
    this.prev = new Map(); // Controller-Index → vorheriger Knopfzustand
    this.fill = null;
    $('btnSplitKbm').onclick = () => this.toggleKbm();
    $('btnSplitStart').onclick = () => this.start();
    $('btnSplitBack').onclick = () => this.back();
    addEventListener('resize', () => this.layout());
    addEventListener('keydown', (e) => {
      if (this.ui.current() !== 'split') return;
      if (e.code === 'Escape') this.back();
      else if (e.code === 'Enter' && document.activeElement === document.body) this.start();
    });
  }

  get kbm() { return this.active && !!this.devs && this.devs[0].kbm; }

  // ── Beitritts-Bildschirm ────────────────────────────────────
  open() {
    this.prev.clear();
    this.map = this.game.mapDef ? this.game.mapDef.id : this.settings.map;
    // Wer den Bildschirm per Maus/Tastatur öffnet, spielt gleich als Spieler 1 mit;
    // ein Controller, dessen A-Knopf noch gedrückt ist, tritt im ersten Bild selbst bei
    const padA = this.game.input.getPads().some((p) => p.buttons[0] && p.buttons[0].pressed);
    this.players = padA ? [] : [{ dev: 'kbm' }];
    this.render();
    this.ui.show('split');
  }

  back() {
    this.players = [];
    this.ui.show('menu');
  }

  toggleKbm() {
    const i = this.players.findIndex((p) => p.dev === 'kbm');
    if (i >= 0) this.players.splice(i, 1);
    else if (this.players.length < MAX) this.players.unshift({ dev: 'kbm' });
    this.render();
  }

  join(p) {
    if (this.players.length >= MAX) return;
    this.players.push(p);
    this.render();
  }

  leave(p) {
    this.players.splice(this.players.indexOf(p), 1);
    this.render();
  }

  cycleMap(d) {
    const i = MAP_ORDER.indexOf(this.map);
    this.map = MAP_ORDER[(i + d + MAP_ORDER.length) % MAP_ORDER.length];
    this.render();
  }

  // Controller auf dem Beitritts-Bildschirm (ersetzt dort die normale Menüsteuerung)
  menuTick(pads) {
    for (const p of pads) {
      const prev = this.prev.get(p.index) || {};
      const b = (i) => !!p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.5);
      const ax = p.axes[0] || 0;
      const now = { a: b(0), b: b(1), start: b(9), left: b(14) || ax < -0.6, right: b(15) || ax > 0.6 };
      const edge = (k) => now[k] && !prev[k];
      this.prev.set(p.index, now);
      const me = this.players.find((x) => x.dev === 'pad' && x.index === p.index);
      if (edge('a') && !me) this.join({ dev: 'pad', index: p.index, label: padLabel(p) });
      else if (edge('b')) { if (me) this.leave(me); else { this.back(); return; } }
      else if (edge('start') && me) { this.start(); return; }
      else if (me && (edge('left') || edge('right'))) this.cycleMap(now.left ? -1 : 1);
    }
  }

  render() {
    const list = $('splitSlots');
    list.innerHTML = '';
    for (let i = 0; i < MAX; i++) {
      const p = this.players[i];
      const li = document.createElement('li');
      li.className = 'ss' + (p ? '' : ' empty');
      li.style.setProperty('--pc', SLOT_COLORS[i]);
      const num = document.createElement('span'); num.className = 'ss-num'; num.textContent = i + 1;
      const name = document.createElement('span'); name.className = 'ss-name';
      const dev = document.createElement('span'); dev.className = 'ss-dev';
      if (p) {
        name.textContent = `Spieler ${i + 1}`;
        dev.textContent = p.dev === 'kbm' ? 'Tastatur & Maus' : `${p.label} ${p.index + 1}`;
      } else {
        name.textContent = 'Frei';
        dev.textContent = 'Drücke A / ✕ auf einem Controller';
      }
      li.append(num, name, dev);
      list.appendChild(li);
    }
    const maps = $('splitMaps');
    maps.innerHTML = '';
    for (const id of MAP_ORDER) {
      const b = document.createElement('button');
      b.className = 'lm' + (id === this.map ? ' current' : '');
      b.dataset.map = id;
      b.textContent = MAPS[id].name;
      b.onclick = () => { this.map = id; this.render(); };
      maps.appendChild(b);
    }
    const hasKbm = this.players.some((p) => p.dev === 'kbm');
    $('btnSplitKbm').textContent = hasKbm ? 'Tastatur & Maus entfernen' : 'Tastatur & Maus hinzufügen';
    $('btnSplitStart').disabled = this.players.length < 2 || this.busy;
    const pads = this.game.input.getPads().length;
    $('splitMsg').textContent = this.players.length >= 2 ? ''
      : pads ? 'Mindestens zwei Spieler: weitere Controller mit A / ✕ beitreten lassen.'
        : 'Kein Controller erkannt – schließe einen an und drücke eine Taste darauf.';
  }

  // ── Partie ──────────────────────────────────────────────────
  async start() {
    if (this.busy || this.players.length < 2 || this.active) return;
    this.busy = true;
    this.render();
    const g = this.game, n = this.players.length, views = LAYOUTS[n], map = this.map;
    this.devs = this.players.map((p) => (p.dev === 'kbm' ? { kbm: true, pad: -1 } : { kbm: false, pad: p.index }));
    this.views = views;
    this.active = true;
    const progress = (pct, text) => this.ui.progress(pct, text);
    this.ui.show('loading');
    progress(0, 'Splitscreen wird vorbereitet …');
    try {
      g.split = true;
      // Mehrere Bilder zugleich: bei „Automatisch“ eine Stufe sparsamer (2 Spieler: mittel, 3–4: niedrig)
      const q = this.settings.quality === 'auto' ? (n >= 3 ? 'niedrig' : 'mittel') : null;
      if (q) g.setQualityOverride(q);
      g.input.assign(this.devs[0]);
      if (g.touch) { g.touch.setActive(false); g.touch.blocked = true; }
      g.rs.setView(views[0]);
      placeHud(g.hud.el.hud, views[0]);
      if (!g.mapDef || g.mapDef.id !== map) await g.loadMap(map, (p, t) => progress(p * 0.3, t));
      this.games = [g];
      for (let i = 1; i < n; i++) {
        const cv = document.createElement('canvas');
        cv.className = 'split-cv';
        cv.addEventListener('click', () => this.onClick());
        g.canvas.after(cv);
        const hud = this.template.cloneNode(true);
        hud.classList.add('hidden');
        document.body.appendChild(hud);
        placeHud(hud, views[i]);
        const gi = new Game(cv, { ...this.settings, map }, {
          input: this.devs[i], hudRoot: hud, view: views[i], sharedM: g.M, audioFrom: g.audio, split: true, secondary: true, quality: q,
        });
        gi.hudRoot = hud;
        gi.onPauseRequest = () => this.ui.paused();
        gi.onNetEnd = () => {};
        this.games.push(gi);
        const k0 = 30 + ((i - 1) / (n - 1)) * 65, k1 = 65 / (n - 1);
        await gi.init((p, t) => progress(k0 + (p / 100) * k1, `Spieler ${i + 1}: ${t}`));
      }
      if (n === 3) this.showFill(Q(0.5, 0.5));
      await this.launch();
    } catch (err) {
      console.error(err);
      this.stop();
      this.busy = false;
      this.ui.show('split');
      $('splitMsg').textContent = 'Start fehlgeschlagen: ' + (err && err.message ? err.message : err);
      return;
    }
    this.busy = false;
    this.ui.started();
  }

  // Alle Instanzen über einen frischen Speicher-Raum verbinden und loslegen (auch für „Nochmal“)
  async launch() {
    const hub = new MemoryHub('SPLIT');
    const rooms = this.games.map(() => hub.join());
    const players = rooms.map((r, i) => ({ slot: i, peerId: r.selfId, name: `Spieler ${i + 1}`, char: i }));
    const base = { hostId: rooms[0].selfId, players, map: this.map, code: 'SPLIT' };
    for (let i = 0; i < this.games.length; i++) {
      await this.games[i].startNetGame({ ...base, room: rooms[i], isHost: i === 0, selfId: rooms[i].selfId, slot: i });
    }
    for (const gi of this.games) gi.audio.resume();
  }

  async restart() {
    if (!this.active || this.busy) return;
    this.busy = true;
    for (const gi of this.games) gi.leaveNetGame(true);
    try { await this.launch(); } finally { this.busy = false; }
    this.ui.started();
  }

  // Alles abbauen; die Hauptinstanz wird wieder Vollbild für einen Spieler
  stop() {
    if (!this.active) return;
    for (const gi of this.games.slice(1)) {
      try { gi.dispose(); } catch (err) { console.error(err); }
      gi.canvas.remove();
      gi.hudRoot.remove();
    }
    this.games = [];
    const g = this.game;
    g.split = false;
    if (g.touch) g.touch.blocked = false;
    if (g.qualityOverride) g.setQualityOverride(null);
    g.input.assign({ kbm: true, pad: null });
    g.rs.setView({ x: 0, y: 0, w: 1, h: 1 });
    placeHud(g.hud.el.hud, null);
    if (this.fill) this.fill.classList.add('hidden');
    this.active = false;
    this.devs = null;
  }

  // Geänderte Einstellungen (Pausenmenü) gelten für alle Spieler am Gerät
  applySettings() {
    for (const gi of this.games) {
      if (gi === this.game) continue;
      Object.assign(gi.settings, this.settings, { map: gi.settings.map });
      gi.applySettings();
    }
  }

  pauseOthers() { for (const gi of this.games) if (gi !== this.game) gi.pause(); }
  resumeOthers() { for (const gi of this.games) if (gi !== this.game) gi.resume(); }

  // Klick in einen Ausschnitt: Maus wieder fangen (nur wenn Tastatur & Maus mitspielt)
  onClick() {
    for (const gi of this.games) if (gi.audio) gi.audio.resume();
    const g = this.game;
    if (this.kbm && g.state === 'playing' && !g.input.locked) g.input.lock();
  }

  // 3 Spieler: das freie Viertel zeigt das Logo
  showFill(v) {
    if (!this.fill) {
      this.fill = document.createElement('div');
      this.fill.className = 'split-fill';
      this.fill.innerHTML = '<div class="logo"><span class="logo-top">NACHTFALL</span><span class="logo-main">ZOMBIES</span></div>';
      document.body.appendChild(this.fill);
    }
    const s = this.fill.style;
    s.left = v.x * 100 + '%'; s.top = v.y * 100 + '%'; s.width = v.w * 100 + '%'; s.height = v.h * 100 + '%';
    this.fill.classList.remove('hidden');
  }

  layout() {
    if (!this.active) return;
    this.games.forEach((gi, i) => placeHud(gi === this.game ? gi.hud.el.hud : gi.hudRoot, this.views[i]));
  }
}
