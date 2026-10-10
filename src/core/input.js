// ─────────────────────────────────────────────────────────────
//  Einheitliche Eingabe: Tastatur + Maus, Touch und Gamepad werden
//  zu Aktionen zusammengeführt (fire, ads, reload, use, …), damit das
//  Spiel auf jedem Gerät gleich funktioniert.
// ─────────────────────────────────────────────────────────────

const KEYS = {
  reload: ['KeyR'], use: ['KeyF'], knife: ['KeyV'], grenade: ['KeyG'], jump: ['Space'],
  crouch: ['KeyC', 'ControlLeft'], sprint: ['ShiftLeft', 'ShiftRight'], switch: ['KeyQ'],
  slot1: ['Digit1'], slot2: ['Digit2'], pause: ['Escape'],
};
const MOUSE = { fire: [0], ads: [2], knife: [3, 4] };
// W3C-Standardbelegung: 0 A/✕ · 1 B/○ · 2 X/▢ · 3 Y/△ · 4 LB · 5 RB · 6 LT · 7 RT · 8 Back · 9 Start · 10 L3 · 11 R3
const PAD = { jump: [0], crouch: [1], reload: [2], switch: [3], knife: [11, 4], grenade: [5], ads: [6], fire: [7], pause: [9] };
const ACTIONS = new Set(['fire', 'ads', 'reload', 'use', 'knife', 'grenade', 'jump', 'crouch', 'sprint', 'switch', 'slot1', 'slot2', 'pause']);

const MOUSE_RAD = 0.0022; // Radiant pro Maus-Zählschritt (Empfindlichkeit 1)

function deadzone(x, y, dz) {
  const m = Math.hypot(x, y);
  if (m < dz) return [0, 0];
  const k = Math.min(1, (m - dz) / (1 - dz)) / m;
  return [x * k, y * k];
}

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    // Rohzustand Tastatur/Maus
    this.keys = new Set();
    this.pressed = new Set();
    this.buttons = new Set();
    this.mPressed = new Set();
    this.dx = 0; this.dy = 0; this.wheel = 0;
    this.locked = false;
    this.onUnlock = null;
    this.lastUnlock = 0;
    // Touch-Zustand (wird von TouchControls befüllt)
    this.touch = { moveX: 0, moveY: 0, lookX: 0, lookY: 0, held: new Set(), hit: new Set(), sprint: false };
    // Gamepad
    this.pad = { connected: false, id: '', prev: [], sprintToggle: false };
    // Zusammengeführte Aktionen dieses Frames
    this.aHeld = new Set();
    this.aHit = new Set();
    this.moveX = 0; this.moveY = 0;
    this.lookX = 0; this.lookY = 0;
    this.device = 'kbm';
    this.useAvailable = false;

    addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) {
        if (document.activeElement === document.body || !document.activeElement) e.preventDefault();
      }
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.device = 'kbm';
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.buttons.clear(); });
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // Ausreißer einiger Browser beim Lock-Wechsel ignorieren
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.dx += e.movementX; this.dy += e.movementY;
      this.device = 'kbm';
    });
    addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.buttons.add(e.button); this.mPressed.add(e.button);
    });
    addEventListener('mouseup', (e) => this.buttons.delete(e.button));
    addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this.locked) this.device = 'kbm';
      else {
        this.buttons.clear();
        this.lastUnlock = performance.now();
        if (this.onUnlock) this.onUnlock();
      }
    });
  }

  // ── Maus-Fang ───────────────────────────────────────────────
  lock() {
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { this.canvas.requestPointerLock()?.catch?.(() => {}); } catch { /* */ } });
    } catch { /* Maus-Fang nicht verfügbar */ }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  // ── Abfragen ────────────────────────────────────────────────
  // Eingaben dieses Bildes verwerfen (z. B. Koop-Menü offen, Welt läuft weiter)
  suppress() {
    this.aHeld.clear(); this.aHit.clear();
    this.moveX = 0; this.moveY = 0; this.lookX = 0; this.lookY = 0;
  }

  held(a) { return ACTIONS.has(a) ? this.aHeld.has(a) : this.keys.has(a); }
  hit(a) { return ACTIONS.has(a) ? this.aHit.has(a) : this.pressed.has(a); }
  down(code) { return this.keys.has(code); }
  keyHit(code) { return this.pressed.has(code); }

  // Tasten-Bezeichnung für Hinweise ("Drücke F", "Drücke X", "Tippe auf Benutzen")
  verb(hold = false) {
    if (this.device === 'touch') return hold ? 'Halte „Benutzen“' : 'Tippe auf „Benutzen“';
    const key = this.device === 'pad' ? this.padGlyph() : 'F';
    return (hold ? 'Halte ' : 'Drücke ') + key;
  }

  padGlyph() {
    const id = this.pad.id.toLowerCase();
    if (/xbox|045e|xinput/.test(id)) return 'X';
    // Sony meldet sich teils nur als "Wireless Controller" (Hersteller-ID 054c)
    if (/054c|playstation|dualsense|dualshock|^wireless controller/.test(id)) return '▢';
    if (/057e|nintendo|switch|pro controller/.test(id)) return 'Y';
    return 'X';
  }

  getPads() {
    try { return navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : []; }
    catch { return []; } // z. B. durch Berechtigungsrichtlinie blockiert
  }

  // ── Pro Frame: alle Quellen zusammenführen ──────────────────
  poll(dt) {
    const held = this.aHeld, hit = this.aHit;
    held.clear(); hit.clear();

    // Tastatur
    for (const a in KEYS) for (const c of KEYS[a]) {
      if (this.keys.has(c)) held.add(a);
      if (this.pressed.has(c)) hit.add(a);
    }
    // Maus (nur mit Maus-Fang, sonst sind Klicks UI-Bedienung)
    if (this.locked) for (const a in MOUSE) for (const b of MOUSE[a]) {
      if (this.buttons.has(b)) held.add(a);
      if (this.mPressed.has(b)) hit.add(a);
    }
    if (this.wheel !== 0) hit.add('switch');

    let mx = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    let my = (this.keys.has('KeyS') ? 1 : 0) - (this.keys.has('KeyW') ? 1 : 0);
    const kl = Math.hypot(mx, my);
    if (kl > 1) { mx /= kl; my /= kl; }
    let lx = this.dx * MOUSE_RAD, ly = this.dy * MOUSE_RAD;
    // Pfeiltasten zum Umsehen (Barrierefreiheit)
    lx += ((this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('ArrowLeft') ? 1 : 0)) * 2.2 * dt;
    ly += ((this.keys.has('ArrowDown') ? 1 : 0) - (this.keys.has('ArrowUp') ? 1 : 0)) * 1.6 * dt;

    // Touch
    const T = this.touch;
    for (const a of T.held) held.add(a);
    for (const a of T.hit) hit.add(a);
    if (T.sprint) held.add('sprint');
    mx += T.moveX; my += T.moveY;
    const touchK = 4.4 / Math.max(innerWidth, innerHeight, 1);
    lx += T.lookX * touchK; ly += T.lookY * touchK;

    // Gamepad
    const pads = this.getPads();
    const gp = pads.find((p) => p.mapping === 'standard') || pads[0];
    this.pad.connected = !!gp;
    if (gp) {
      this.pad.id = gp.id || '';
      const btn = (i) => { const b = gp.buttons[i]; return !!b && (b.pressed || b.value > 0.35); };
      const prev = this.pad.prev;
      let any = false;
      const useMode = this.useAvailable;
      for (const a in PAD) for (const i of PAD[a]) {
        let act = a;
        if (i === 2 && useMode) act = 'use'; // X: Kaufen/Benutzen, wenn etwas in Reichweite ist
        const on = btn(i);
        if (on) { held.add(act); any = true; }
        if (on && !prev[i]) hit.add(act);
      }
      if (useMode && btn(2)) held.add('use');
      // D-Pad: hoch/runter = Waffe wechseln
      if ((btn(12) && !prev[12]) || (btn(13) && !prev[13])) hit.add('switch');
      // L3 schaltet Sprint ein, bis nicht mehr vorwärts gelaufen wird
      if (btn(10) && !prev[10]) this.pad.sprintToggle = !this.pad.sprintToggle;
      const [sx, sy] = deadzone(gp.axes[0] || 0, gp.axes[1] || 0, 0.16);
      const [rx, ry] = deadzone(gp.axes[2] || 0, gp.axes[3] || 0, 0.12);
      if (sy > -0.3) this.pad.sprintToggle = false;
      if (this.pad.sprintToggle) held.add('sprint');
      mx += sx; my += sy;
      // Ansprechkurve: feines Zielen bei kleinen Ausschlägen
      lx += Math.sign(rx) * rx * rx * 3.4 * dt;
      ly += Math.sign(ry) * ry * ry * 2.3 * dt;
      if (any || Math.abs(sx) + Math.abs(sy) + Math.abs(rx) + Math.abs(ry) > 0.2) this.device = 'pad';
      for (let i = 0; i < gp.buttons.length; i++) prev[i] = btn(i);
    }

    const ml = Math.hypot(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; }
    this.moveX = mx; this.moveY = my;
    this.lookX = lx; this.lookY = ly;
  }

  endFrame() {
    this.pressed.clear(); this.mPressed.clear();
    this.dx = 0; this.dy = 0; this.wheel = 0;
    this.touch.hit.clear();
    this.touch.lookX = 0; this.touch.lookY = 0;
  }
}
