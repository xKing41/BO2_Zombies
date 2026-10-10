import './style.css';
import { Game, DEFAULT_SETTINGS, bestKey } from './game/game.js';
import { TouchControls } from './ui/touch.js';
import { IS_TOUCH, IS_IOS, IS_STANDALONE } from './core/platform.js';
import { MAPS, MAP_ORDER } from './maps/index.js';
import { Lobby } from './net/lobby.js';
import { openRoom, makeCode, PROTOCOL } from './net/transport.js';
import { SplitScreen } from './ui/splitscreen.js';

const $ = (id) => document.getElementById(id);
const screens = ['loading', 'menu', 'mapselect', 'coop', 'lobby', 'split', 'pause', 'settings', 'controls', 'gameover'];
let current = 'loading';
const show = (id) => {
  current = id;
  screens.forEach((s) => $(s).classList.toggle('hidden', s !== id));
  padNav.focusFirst();
};
const hideAll = () => { current = null; screens.forEach((s) => $(s).classList.add('hidden')); };

function loadSettings() {
  try {
    const s = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('nachtfall.settings') || '{}') };
    if (s.quality === 'hoch' && !localStorage.getItem('nachtfall.v2')) s.quality = 'auto'; // alte Voreinstellung
    return s;
  } catch { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings(s) {
  try { localStorage.setItem('nachtfall.settings', JSON.stringify(s)); localStorage.setItem('nachtfall.v2', '1'); } catch { /* */ }
}

// Läuft das Spiel in der Android-App? (Die App stellt window.NachtfallApp bereit)
const IN_APP = !!window.NachtfallApp;
const settings = loadSettings();
const HUD_TEMPLATE = $('hud').cloneNode(true); // unberührte Vorlage für die HUDs weiterer Splitscreen-Spieler
const game = new Game($('game'), settings);
const touch = new TouchControls(game.input);
game.touch = touch;
touch.setActive(IS_TOUCH);
window.__game = game;
let backTo = 'menu';

// ── Start / Pause / Weiter ───────────────────────────────────
function play() {
  if (game.audio && game.audio.ctx) game.audio.resume();
  hideAll();
  $('clickToPlay').classList.add('hidden');
  if (game.state === 'menu' || game.state === 'gameover') game.start();
  else if (game.state === 'paused' || game.menuOpen) { game.resume(); split.resumeOthers(); }
  if (split.active) { if (split.kbm) game.input.lock(); }
  else if (!touch.active) game.input.lock();
  else enterFullscreen();
  requestWakeLock();
}

function pauseGame() {
  if (!game.pause()) return;
  split.pauseOthers();
  game.input.unlock();
  show('pause');
}
game.onPauseRequest = pauseGame;
game.onGameOver = () => {
  $('btnAgain').classList.toggle('hidden', !!game.net && !split.active); // Koop: neue Runde nur über die Lobby
  show('gameover');
};

// Maus-Fang (Desktop) steuert Pause/Weiter
game.input.onUnlock = () => { if (game.state === 'playing' && !touch.active) pauseGame(); };
let lockErrors = 0, lastLockError = 0;
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === $('game')) {
    lockErrors = 0;
    $('clickToPlay').classList.add('hidden');
    if (!IS_TOUCH) touch.setActive(false);
  }
});
document.addEventListener('pointerlockerror', () => {
  if (game.state !== 'playing') return;
  if (split.active) { $('clickToPlay').classList.remove('hidden'); return; }
  const now = performance.now();
  if (now - lastLockError > 400) lockErrors++; // ein Versuch kann zwei Fehler melden
  lastLockError = now;
  // Kurz nach Esc sperrt der Browser den Maus-Fang → einfach nochmal klicken
  if (now - game.input.lastUnlock < 2500 || lockErrors < 2) { $('clickToPlay').classList.remove('hidden'); return; }
  // Maus-Fang dauerhaft nicht verfügbar → Bildschirm-Steuerung (funktioniert auch mit Maus)
  touch.setActive(true);
  $('clickToPlay').classList.add('hidden');
  game.hud.notice('Maus-Fang nicht verfügbar – Bildschirm-Steuerung aktiv', 4000);
});
$('game').addEventListener('click', () => {
  if (game.audio && game.audio.ctx) game.audio.resume();
  if (split.active) { split.onClick(); return; }
  if (game.state === 'playing' && !game.input.locked && !touch.active) game.input.lock();
});

// Tab-Wechsel, App im Hintergrund, Hochformat → Pause (und im Menü Ton aus)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pauseGame();
    if (game.audio) game.audio.suspend();
  } else {
    if (game.state === 'playing') requestWakeLock();
    if (game.audio && game.audio.ctx && game.state !== 'paused') game.audio.resume();
  }
});
function checkOrientation() {
  const portrait = touch.active && innerHeight > innerWidth * 1.05;
  document.body.classList.toggle('portrait', portrait);
  if (portrait && game.state === 'playing') pauseGame();
}
addEventListener('resize', checkOrientation);
addEventListener('orientationchange', () => setTimeout(checkOrientation, 200));

// ── Vollbild, Querformat, Bildschirm wach halten ─────────────
function enterFullscreen() {
  if (IN_APP) return; // die App ist schon im Vollbild
  try {
    const el = document.documentElement;
    if (document.fullscreenElement || !el.requestFullscreen || IS_STANDALONE) return;
    el.requestFullscreen({ navigationUI: 'hide' })
      .then(() => screen.orientation?.lock?.('landscape').catch(() => {}))
      .catch(() => {});
  } catch { /* Vollbild ist optional */ }
}
let wakeLock = null;
async function requestWakeLock() {
  try {
    if (!('wakeLock' in navigator) || wakeLock) return;
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => (wakeLock = null));
  } catch { /* optional */ }
}

// ── Kartenauswahl ────────────────────────────────────────────
function buildMapCards() {
  const wrap = $('mapCards');
  wrap.innerHTML = '';
  for (const id of MAP_ORDER) {
    const d = MAPS[id];
    const b = document.createElement('button');
    b.className = 'mapcard' + (game.mapDef && game.mapDef.id === id ? ' current' : '');
    let extra = '';
    try {
      const best = localStorage.getItem(bestKey(id));
      if (best) extra += `Rekord: Runde ${best}`;
      if (id === 'linie13' && localStorage.getItem('nachtfall.ach.signal')) extra += `${extra ? ' · ' : ''}Erfolg: Das Signal ✓`;
    } catch { /* */ }
    b.innerHTML = `<span class="mc-name">${d.name}</span><span class="mc-tag">${d.tagline}</span><span class="mc-desc">${d.description}</span>${extra ? `<span class="mc-best">${extra}</span>` : ''}`;
    b.onclick = () => chooseMap(id);
    wrap.appendChild(b);
  }
}
let loadingMap = false;
async function chooseMap(id) {
  if (loadingMap) return;
  if (game.mapDef && game.mapDef.id === id) { play(); return; }
  loadingMap = true;
  show('loading');
  try {
    await game.loadMap(id, (pct, text) => { $('loadbar').style.width = pct + '%'; $('loadtext').textContent = text; });
    saveSettings(settings);
    menuTitle();
    play();
  } catch (err) {
    console.error(err);
    $('loadtext').textContent = 'Fehler beim Laden der Karte: ' + err.message;
  }
  loadingMap = false;
}

// ── Koop (Lobby in src/net/lobby.js) ─────────────────────────
// Startet ein Koop-Spiel; true = läuft, sonst ein Hinweis für die Lobby-Statuszeile
async function startNet(ctx) {
  if (typeof game.startNetGame !== 'function') {
    game.hud.notice('Koop-Spiel folgt');
    console.info('[Koop] game.startNetGame fehlt noch – Startdaten:', { ...ctx, room: ctx.room && ctx.room.code });
    return 'Koop-Spiel folgt';
  }
  if (game.audio && game.audio.ctx) game.audio.resume();
  $('loadbar').style.width = '0%';
  $('loadtext').textContent = 'Koop-Spiel startet …';
  show('loading');
  try {
    await game.startNetGame({
      ...ctx,
      onProgress: (pct, text) => { $('loadbar').style.width = pct + '%'; if (text) $('loadtext').textContent = text; },
    });
  } catch (err) {
    console.error(err);
    show('lobby');
    return 'Start fehlgeschlagen: ' + (err && err.message ? err.message : err);
  }
  saveSettings(settings);
  menuTitle();
  hideAll();
  $('clickToPlay').classList.add('hidden');
  if (!touch.active) game.input.lock();
  else enterFullscreen();
  requestWakeLock();
  return true;
}
const lobby = new Lobby({
  game, show, launch: startNet,
  // Klick auf „Erstellen“/„Beitreten“: Ton und Vollbild jetzt freischalten – der Start kommt später per Netz
  gesture: () => {
    if (game.audio && game.audio.ctx) game.audio.resume();
    if (touch.active) enterFullscreen();
  },
});
window.__lobby = lobby;
window.__net = { openRoom, makeCode, PROTOCOL };

// ── Splitscreen (src/ui/splitscreen.js) ──────────────────────
const split = new SplitScreen(game, settings, HUD_TEMPLATE, {
  show,
  current: () => current,
  progress: (pct, text) => { $('loadbar').style.width = pct + '%'; if (text) $('loadtext').textContent = text; },
  paused: () => pauseGame(),
  started: () => {
    saveSettings(settings);
    menuTitle();
    hideAll();
    $('clickToPlay').classList.add('hidden');
    if (game.audio && game.audio.ctx) game.audio.resume();
    if (split.kbm) game.input.lock();
    requestWakeLock();
  },
});
window.__split = split;

// Laufendes Spiel verlassen (Pause → „Spiel beenden“, Game Over → „Hauptmenü“)
function quitToMenu() {
  if (split.active) { split.stop(); touch.setActive(IS_TOUCH); }
  if (game.net) {
    try { game.leaveNetGame?.(); } catch (err) { console.error(err); }
  }
  lobby.reset();
  game.toMenu();
  show('menu');
}
// Vom Spiel gemeldet: Koop-Partie vorbei (Host weg, Verbindung verloren …)
game.onNetEnd = (reason) => {
  game.input.unlock();
  $('clickToPlay').classList.add('hidden');
  if (game.state === 'playing' || game.state === 'paused' || game.state === 'gameover') game.toMenu();
  lobby.open(typeof reason === 'string' && reason ? reason : 'Koop-Spiel beendet');
};

// ── Menü-Knöpfe ──────────────────────────────────────────────
$('btnPlay').onclick = () => { buildMapCards(); show('mapselect'); };
$('btnCoop').onclick = () => lobby.open();
$('btnSplit').onclick = () => split.open();
$('btnMapBack').onclick = () => show('menu');
$('btnResume').onclick = play;
$('btnAgain').onclick = () => (split.active ? split.restart() : play());
$('btnQuit').onclick = quitToMenu;
$('btnMenu').onclick = quitToMenu;
$('btnSettings').onclick = () => { backTo = 'menu'; show('settings'); };
$('btnSettings2').onclick = () => { backTo = 'pause'; show('settings'); };
$('btnControls').onclick = () => { backTo = 'menu'; show('controls'); };
$('btnControls2').onclick = () => { backTo = 'pause'; show('controls'); };
document.querySelectorAll('.back').forEach((b) => (b.onclick = () => { saveSettings(settings); game.applySettings(); split.applySettings(); show(backTo); }));

// ── Einstellungen ────────────────────────────────────────────
const bind = (id, key, fmt = (v) => v) => {
  const el = $(id);
  const out = el.parentElement.querySelector('span');
  const sync = () => { if (out) out.textContent = fmt(settings[key]); };
  if (el.type === 'checkbox') { el.checked = !!settings[key]; el.onchange = () => { settings[key] = el.checked; }; }
  else if (el.tagName === 'SELECT') { el.value = settings[key]; el.onchange = () => { settings[key] = el.value; }; }
  else { el.value = settings[key]; el.oninput = () => { settings[key] = +el.value; sync(); if (game.audio) game.applySettings(); }; }
  sync();
};
bind('sSens', 'sensitivity', (v) => (+v).toFixed(2));
bind('sFov', 'fov', (v) => v);
bind('sVol', 'master', (v) => Math.round(v * 100) + '%');
bind('sMus', 'music', (v) => Math.round(v * 100) + '%');
bind('sQual', 'quality');
bind('sAim', 'aimAssist');
bind('sInv', 'invertY');
bind('sFps', 'showFps');
bind('sHit', 'hitmarker');

// ── Controller-Steuerung in Menüs ────────────────────────────
const padNav = {
  prev: [], idx: 0, used: false, repeat: 0,
  items() {
    if (!current) return [];
    return [...$(current).querySelectorAll('button, input, select')].filter((e) => e.offsetParent !== null && !e.disabled);
  },
  focusFirst() {
    if (!this.used) return;
    const it = this.items();
    this.idx = 0;
    if (it[0]) it[0].focus({ preventScroll: true });
  },
  move(d) {
    const it = this.items();
    if (!it.length) return;
    const i = it.indexOf(document.activeElement);
    this.idx = ((i < 0 ? 0 : i + d) + it.length) % it.length;
    it[this.idx].focus({ preventScroll: true });
  },
  adjust(d) {
    const el = document.activeElement;
    if (!el) return;
    if (el.type === 'range') { d > 0 ? el.stepUp(5) : el.stepDown(5); el.dispatchEvent(new Event('input')); }
    else if (el.tagName === 'SELECT') {
      el.selectedIndex = (el.selectedIndex + d + el.options.length) % el.options.length;
      el.dispatchEvent(new Event('change'));
    }
  },
  tick() {
    requestAnimationFrame(() => this.tick());
    const pads = game.input.getPads();
    if (!pads.length) return;
    // Splitscreen-Beitritt: jeder Controller einzeln (A = beitreten, B = gehen, Start = los)
    if (current === 'split') { split.menuTick(pads); this.prev = { a: true, b: true, start: true }; return; }
    // Sonst steuern alle Controller gemeinsam das Menü
    const b = (i) => pads.some((gp) => !!gp.buttons[i] && gp.buttons[i].pressed);
    const ax = (k, s) => pads.some((gp) => s * (gp.axes[k] || 0) > 0.6);
    const now = { up: b(12) || ax(1, -1), down: b(13) || ax(1, 1), left: b(14) || ax(0, -1), right: b(15) || ax(0, 1), a: b(0), b: b(1), start: b(9) };
    const p = this.prev;
    const edge = (k) => now[k] && !p[k];
    if (current) {
      if (Object.values(now).some(Boolean) && !this.used) { this.used = true; this.focusFirst(); }
      if (edge('up')) this.move(-1);
      if (edge('down')) this.move(1);
      if (edge('left')) this.adjust(-1);
      if (edge('right')) this.adjust(1);
      if (edge('a')) {
        const el = document.activeElement;
        if (el && el.tagName === 'INPUT' && el.type === 'checkbox') { el.click(); }
        else if (el && el.tagName === 'BUTTON') el.click();
      }
      if (edge('b')) {
        if (current === 'pause') play();
        else if (current === 'settings' || current === 'controls') $(current).querySelector('.back').click();
        else if (current === 'coop' || current === 'lobby') lobby.back(current);
      }
      if (edge('start') && current === 'pause') play();
    }
    this.prev = now;
  },
};
padNav.tick();
addEventListener('gamepadconnected', () => {
  padNav.used = true;
  padNav.focusFirst();
  if (game.hud && game.state === 'playing') game.hud.notice('Controller verbunden');
});

// ── Als App installieren (PWA) ───────────────────────────────
let installPrompt = null;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  $('btnInstall').classList.remove('hidden');
});
$('btnInstall').onclick = async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  try { await installPrompt.userChoice; } catch { /* */ }
  installPrompt = null;
  $('btnInstall').classList.add('hidden');
};
if (import.meta.env.PROD && !IN_APP && 'serviceWorker' in navigator && window.isSecureContext) {
  addEventListener('load', () => {
    try { navigator.serviceWorker.register('./sw.js').catch(() => {}); } catch { /* nicht verfügbar */ }
  });
}

// ── Android-App: Zurück-Taste und Hintergrund ───────────────
// Liefert 'exit', wenn die App beendet werden soll (nur im Hauptmenü)
window.__nfBack = () => {
  if (game.state === 'playing') { pauseGame(); return 'handled'; }
  switch (current) {
    case 'pause': play(); return 'handled';
    case 'settings': case 'controls': $(current).querySelector('.back').click(); return 'handled';
    case 'mapselect': show('menu'); return 'handled';
    case 'coop': show('menu'); return 'handled';
    case 'lobby': lobby.leave(); return 'handled';
    case 'split': split.back(); return 'handled';
    case 'gameover': quitToMenu(); return 'handled';
    case 'loading': return 'handled';
    default: return 'exit';
  }
};
window.__nfAppPause = () => {
  pauseGame();
  if (game.audio) game.audio.suspend();
};
window.__nfAppResume = () => {
  if (game.audio && game.audio.ctx && game.state !== 'paused') game.audio.resume();
};

// Untertitel im Hauptmenü zeigt die geladene Karte
function menuTitle() {
  const el = document.querySelector('#menu .subtitle');
  if (el && game.mapDef) el.textContent = game.mapDef.name;
}

// ── Laden ────────────────────────────────────────────────────
show('loading');
game.init((pct, text) => {
  $('loadbar').style.width = pct + '%';
  $('loadtext').textContent = text;
}).then(() => {
  show('menu');
  menuTitle();
  // Installations-Tipp nur dort, wo das Spiel wirklich als App installierbar ist
  const installable = !!document.querySelector('link[rel="manifest"]') && window.top === window;
  if (IS_IOS && !IS_STANDALONE && installable) $('iosHint').classList.remove('hidden');
  checkOrientation();
  // Einladungslink (#join=CODE) → Koop-Bildschirm mit vorausgefülltem Code
  lobby.consumeDeepLink();
  addEventListener('hashchange', () => { if (current === 'menu' || current === 'coop') lobby.consumeDeepLink(); });
}).catch((err) => {
  console.error(err);
  $('loadtext').textContent = 'Fehler beim Laden: ' + err.message + ' (WebGL2 wird benötigt)';
});
