import './style.css';
import { Game, DEFAULT_SETTINGS } from './game/game.js';

const $ = (id) => document.getElementById(id);
const screens = ['loading', 'menu', 'pause', 'settings', 'controls', 'gameover'];
const show = (id) => screens.forEach((s) => $(s).classList.toggle('hidden', s !== id));
const hideAll = () => screens.forEach((s) => $(s).classList.add('hidden'));

function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('nachtfall.settings') || '{}') }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings(s) { try { localStorage.setItem('nachtfall.settings', JSON.stringify(s)); } catch { /* */ } }

const settings = loadSettings();
const game = new Game($('game'), settings);
window.__game = game;
let backTo = 'menu';

function requestPlay() {
  hideAll();
  $('clickToPlay').classList.add('hidden');
  game.input.lock();
}

// Pointer-Lock steuert Pause/Weiter
game.input.onUnlock = () => {
  if (game.state === 'playing') {
    game.pause();
    show('pause');
  }
};
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === $('game')) {
    hideAll();
    if (game.state === 'menu') game.start();
    else if (game.state === 'paused') game.resume();
  }
});
document.addEventListener('pointerlockerror', () => {
  $('clickToPlay').classList.remove('hidden');
});
$('game').addEventListener('click', () => {
  if (game.state === 'playing' && !game.input.locked) game.input.lock();
});

$('btnPlay').onclick = requestPlay;
$('btnResume').onclick = requestPlay;
$('btnQuit').onclick = () => location.reload();
$('btnAgain').onclick = () => { sessionStorage.setItem('nachtfall.autostart', '1'); location.reload(); };
$('btnMenu').onclick = () => location.reload();
$('btnSettings').onclick = () => { backTo = 'menu'; openSettings(); };
$('btnSettings2').onclick = () => { backTo = 'pause'; openSettings(); };
$('btnControls').onclick = () => { backTo = 'menu'; show('controls'); };
$('btnControls2').onclick = () => { backTo = 'pause'; show('controls'); };
document.querySelectorAll('.back').forEach((b) => (b.onclick = () => { saveSettings(settings); game.applySettings(); show(backTo); }));

game.onGameOver = () => show('gameover');

// ── Einstellungen ────────────────────────────────────────────
const bind = (id, key, fmt = (v) => v) => {
  const el = $(id);
  const out = el.parentElement.querySelector('span');
  const sync = () => { if (out) out.textContent = fmt(settings[key]); };
  if (el.type === 'checkbox') { el.checked = settings[key]; el.onchange = () => { settings[key] = el.checked; }; }
  else if (el.tagName === 'SELECT') { el.value = settings[key]; el.onchange = () => { settings[key] = el.value; }; }
  else { el.value = settings[key]; el.oninput = () => { settings[key] = +el.value; sync(); game.applySettings && game.audio && game.applySettings(); }; }
  sync();
};
function openSettings() { show('settings'); }
bind('sSens', 'sensitivity', (v) => (+v).toFixed(2));
bind('sFov', 'fov', (v) => v);
bind('sVol', 'master', (v) => Math.round(v * 100) + '%');
bind('sMus', 'music', (v) => Math.round(v * 100) + '%');
bind('sQual', 'quality');
bind('sInv', 'invertY');
bind('sFps', 'showFps');

// ── Laden ────────────────────────────────────────────────────
show('loading');
game.init((pct, text) => {
  $('loadbar').style.width = pct + '%';
  $('loadtext').textContent = text;
}).then(() => {
  show('menu');
  try {
    const best = localStorage.getItem('nachtfall.best');
    if (best) document.querySelector('#menu .hint').textContent += ` Rekord: Runde ${best}.`;
  } catch { /* */ }
  if (sessionStorage.getItem('nachtfall.autostart')) {
    sessionStorage.removeItem('nachtfall.autostart');
    hideAll();
    $('clickToPlay').classList.remove('hidden');
    $('clickToPlay').textContent = 'Klicken, um zu starten';
    const once = () => { removeEventListener('mousedown', once); requestPlay(); };
    addEventListener('mousedown', once);
  }
}).catch((err) => {
  console.error(err);
  $('loadtext').textContent = 'Fehler beim Laden: ' + err.message + ' (WebGL2 wird benötigt)';
});
