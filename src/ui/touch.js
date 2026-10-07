// ─────────────────────────────────────────────────────────────
//  Touch-Steuerung für Handy & Tablet: schwebender Joystick links,
//  Wischen rechts zum Umsehen, Feuerknopf (auch zum Zielen ziehbar)
//  und Aktionsknöpfe. Funktioniert per Pointer Events auch mit Maus.
// ─────────────────────────────────────────────────────────────

const S = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  fire: S('<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>'),
  ads: S('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/>'),
  reload: S('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
  jump: S('<path d="M6 14l6-6 6 6"/><path d="M6 19h12"/>'),
  crouch: S('<path d="M6 10l6 6 6-6"/><path d="M6 5h12"/>'),
  knife: S('<path d="M4 20l7-7"/><path d="M11 13l8-9 1 1-6 10z" fill="currentColor"/><path d="M9 11l4 4"/>'),
  grenade: S('<circle cx="12" cy="14" r="6"/><path d="M10 8V5h4v3"/><path d="M14 6h4l1 3"/>'),
  switch: S('<path d="M4 8h13l-3-3"/><path d="M20 16H7l3 3"/>'),
  pause: S('<path d="M9 5v14M15 5v14"/>'),
  use: S('<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12"/><path d="M11 11V4.5a1.5 1.5 0 0 1 3 0V12"/><path d="M14 11.5V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7l-2.6-4a1.5 1.5 0 0 1 2.4-1.8L8 14"/>'),
};
const BUTTONS = [
  ['fire', 'Feuer'], ['ads', 'Zielen'], ['reload', 'Nachladen'], ['jump', 'Springen'], ['crouch', 'Ducken'],
  ['knife', 'Messer'], ['grenade', 'Granate'], ['switch', 'Waffe wechseln'], ['pause', 'Pause'], ['use', 'Benutzen'],
];
const TOGGLES = new Set(['ads', 'crouch']);

export class TouchControls {
  constructor(input) {
    this.input = input;
    this.active = false;
    this.visible = false;
    this.R = 58; // Joystick-Radius in px
    const root = (this.root = document.createElement('div'));
    root.id = 'touch';
    root.className = 'hidden';
    root.innerHTML = '<div class="stick idle"><div class="knob"></div></div>' + BUTTONS.map(([a, label]) =>
      `<div class="tb tb-${a}" data-a="${a}" role="button" aria-label="${label}">${ICON[a]}${a === 'use' ? '<span>Benutzen</span>' : ''}</div>`).join('');
    document.body.appendChild(root);
    // Misst die Sicherheitsabstände (Notch) in Pixeln
    this.probe = document.createElement('div');
    this.probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;'
      + 'padding-left:env(safe-area-inset-left,0px);padding-bottom:env(safe-area-inset-bottom,0px)';
    document.body.appendChild(this.probe);
    this.stick = root.querySelector('.stick');
    this.knob = root.querySelector('.knob');
    this.btn = {};
    root.querySelectorAll('.tb').forEach((el) => (this.btn[el.dataset.a] = el));
    this.ptr = new Map();
    this.stickId = null;
    this.adsOn = false;
    this.crouchOn = false;

    const opt = { passive: false };
    root.addEventListener('pointerdown', (e) => this.down(e), opt);
    root.addEventListener('pointermove', (e) => this.move(e), opt);
    root.addEventListener('pointerup', (e) => this.up(e), opt);
    root.addEventListener('pointercancel', (e) => this.up(e), opt);
    // Erste Berührung irgendwo → Touch-Modus einschalten
    addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      this.input.device = 'touch';
      if (!this.active) this.setActive(true);
    }, { capture: true, passive: true });
    // iOS: Pinch-Zoom und Doppeltipp-Zoom verhindern
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    addEventListener('resize', () => this.placeStick());
    this.placeStick();
    this.setUse(null);
  }

  setActive(on) {
    this.active = on;
    document.body.classList.toggle('touch', on);
    if (!on) this.releaseAll();
    this.refresh();
  }

  // Nur während des Spiels sichtbar
  show(playing) {
    this.visible = playing;
    if (!playing) this.releaseAll();
    this.refresh();
  }

  refresh() { this.root.classList.toggle('hidden', !(this.active && this.visible)); }

  releaseAll() {
    const T = this.input.touch;
    this.ptr.clear();
    this.stickId = null;
    T.moveX = 0; T.moveY = 0; T.sprint = false;
    T.held.clear();
    this.adsOn = false; this.crouchOn = false;
    Object.values(this.btn).forEach((b) => b.classList.remove('on'));
    this.placeStick();
  }

  setUse(label) {
    const b = this.btn.use;
    if (!b) return;
    if (this.useLabel === label) return;
    this.useLabel = label;
    b.classList.toggle('hidden', !label);
    if (label) b.querySelector('span').textContent = label;
  }

  placeStick(x, y) {
    const live = x !== undefined;
    if (!live) {
      const cs = getComputedStyle(this.probe);
      x = 40 + this.R + (parseFloat(cs.paddingLeft) || 0);
      y = innerHeight - 40 - this.R - (parseFloat(cs.paddingBottom) || 0);
    }
    this.stick.style.left = x + 'px';
    this.stick.style.top = y + 'px';
    this.stick.classList.toggle('idle', !live);
    if (!live) this.knob.style.transform = 'translate(-50%, -50%)';
  }

  down(e) {
    e.preventDefault();
    try { this.root.setPointerCapture(e.pointerId); } catch { /* */ }
    if (e.pointerType === 'touch') this.input.device = 'touch';
    const x = e.clientX, y = e.clientY;
    const t = e.target.closest ? e.target.closest('.tb') : null;
    const T = this.input.touch;
    if (t && !t.classList.contains('hidden')) {
      const a = t.dataset.a;
      this.ptr.set(e.pointerId, { kind: 'btn', a, x, y, el: t });
      t.classList.add('on');
      if (a === 'ads') this.adsOn = !this.adsOn;
      else if (a === 'crouch') this.crouchOn = !this.crouchOn;
      else T.held.add(a);
      if (a === 'jump') this.crouchOn = false;
      T.hit.add(a);
      if (navigator.vibrate && a !== 'fire') { try { navigator.vibrate(8); } catch { /* */ } }
      return;
    }
    if (x < innerWidth * 0.45 && this.stickId === null) {
      this.stickId = e.pointerId;
      this.ptr.set(e.pointerId, { kind: 'stick', ox: x, oy: y });
      this.placeStick(x, y);
      return;
    }
    this.ptr.set(e.pointerId, { kind: 'look', x, y });
  }

  move(e) {
    const p = this.ptr.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    const x = e.clientX, y = e.clientY;
    const T = this.input.touch;
    if (p.kind === 'stick') {
      let dx = x - p.ox, dy = y - p.oy;
      const m = Math.hypot(dx, dy), R = this.R;
      if (m > R) { // Ursprung folgt dem Daumen
        p.ox = x - (dx / m) * R; p.oy = y - (dy / m) * R;
        dx = x - p.ox; dy = y - p.oy;
        this.stick.style.left = p.ox + 'px';
        this.stick.style.top = p.oy + 'px';
      }
      T.moveX = dx / R; T.moveY = dy / R;
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      // Joystick ganz nach vorne = Sprinten
      T.sprint = Math.hypot(T.moveX, T.moveY) > 0.95 && T.moveY < -0.72;
      if (T.sprint) this.adsOn = false;
      this.stick.classList.toggle('sprint', T.sprint);
    } else if (p.kind === 'look' || (p.kind === 'btn' && p.a === 'fire')) {
      T.lookX += x - p.x; T.lookY += y - p.y;
      p.x = x; p.y = y;
    }
  }

  up(e) {
    const p = this.ptr.get(e.pointerId);
    if (!p) return;
    this.ptr.delete(e.pointerId);
    const T = this.input.touch;
    if (p.kind === 'stick') {
      this.stickId = null;
      T.moveX = 0; T.moveY = 0; T.sprint = false;
      this.stick.classList.remove('sprint');
      this.placeStick();
    } else if (p.kind === 'btn') {
      p.el.classList.remove('on');
      const still = [...this.ptr.values()].some((q) => q.kind === 'btn' && q.a === p.a);
      if (!still && !TOGGLES.has(p.a)) T.held.delete(p.a);
    }
  }

  // Pro Frame vor dem Einlesen der Eingabe
  update() {
    const T = this.input.touch;
    if (this.adsOn) T.held.add('ads'); else T.held.delete('ads');
    if (this.crouchOn) T.held.add('crouch'); else T.held.delete('crouch');
    this.btn.ads.classList.toggle('toggled', this.adsOn);
    this.btn.crouch.classList.toggle('toggled', this.crouchOn);
  }
}
