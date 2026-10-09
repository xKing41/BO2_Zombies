// HUD im Stil der Treyarch-Zombies: Kreide-Rundenzähler, Punkte, Munition,
// Perk-Kronkorken, Power-Ups, Intro-Schreibmaschine, Blut am Bildschirmrand
import { PERKS } from '../config.js';
import { mulberry32 } from '../core/noise.js';

const $ = (id) => document.getElementById(id);

// Ziffern als Pinsel-/Kreidestriche (Feld 60 × 100)
const DIGITS = {
  0: ['M31,8 C12,7 6,38 8,56 C10,82 19,96 33,94 C49,92 55,68 52,46 C50,22 44,9 31,8'],
  1: ['M18,24 L36,8 L35,96'],
  2: ['M9,28 C12,6 48,2 50,28 C52,50 22,70 8,94 L56,92'],
  3: ['M9,18 C22,1 54,4 49,29 C46,45 33,49 23,50 C41,50 56,60 53,76 C50,99 17,100 7,84'],
  4: ['M40,96 L41,8 L6,67 L57,66'],
  5: ['M51,8 L17,10 L12,48 C25,37 51,40 53,64 C55,93 25,101 8,86'],
  6: ['M47,13 C31,2 9,20 8,57 C7,85 20,96 33,94 C49,92 55,74 51,60 C47,43 22,42 9,58'],
  7: ['M7,10 L55,9 L24,96'],
  8: ['M31,50 C10,45 10,9 31,8 C51,8 51,44 31,50 C8,56 7,94 31,95 C54,95 53,56 31,50'],
  9: ['M51,40 C47,57 22,59 12,43 C3,26 16,7 33,8 C51,9 55,31 53,53 C51,81 38,97 15,91'],
};

// Kronkorken-Symbole der Perks (Canvas → Bild-URL)
function perkIcon(id) {
  const P = PERKS[id];
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const c = cv.getContext('2d');
  c.translate(64, 64);
  // gezackter Rand
  c.beginPath();
  for (let i = 0; i <= 42; i++) {
    const a = (i / 42) * Math.PI * 2, r = i % 2 ? 58 : 62;
    c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const rim = c.createRadialGradient(-18, -22, 6, 0, 0, 62);
  rim.addColorStop(0, '#fff'); rim.addColorStop(0.35, P.color); rim.addColorStop(1, '#120606');
  c.fillStyle = rim; c.fill();
  c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,0.6)'; c.stroke();
  // Innenfläche
  const g = c.createRadialGradient(-14, -18, 4, 0, 0, 50);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.18, P.color); g.addColorStop(1, '#1a0707');
  c.beginPath(); c.arc(0, 0, 48, 0, Math.PI * 2); c.fillStyle = g; c.fill();
  c.lineWidth = 3; c.strokeStyle = 'rgba(255,255,255,0.55)'; c.stroke();
  // Symbol
  c.fillStyle = '#fff'; c.strokeStyle = '#fff'; c.lineJoin = 'round'; c.lineCap = 'round';
  c.shadowColor = 'rgba(0,0,0,0.7)'; c.shadowBlur = 6; c.shadowOffsetY = 2;
  c.beginPath();
  if (id === 'titan') { // Schild mit Kreuz
    c.moveTo(0, -30); c.lineTo(24, -20); c.lineTo(20, 10); c.quadraticCurveTo(12, 26, 0, 32); c.quadraticCurveTo(-12, 26, -20, 10); c.lineTo(-24, -20); c.closePath(); c.fill();
    c.fillStyle = P.color; c.shadowBlur = 0; c.fillRect(-4, -18, 8, 34); c.fillRect(-14, -6, 28, 8);
  } else if (id === 'blitz') { // Blitz
    c.moveTo(6, -32); c.lineTo(-18, 4); c.lineTo(-2, 4); c.lineTo(-8, 32); c.lineTo(18, -6); c.lineTo(2, -6); c.closePath(); c.fill();
  } else if (id === 'doppel') { // zwei Patronen
    for (const x of [-11, 11]) { c.beginPath(); c.moveTo(x - 7, 26); c.lineTo(x - 7, -8); c.quadraticCurveTo(x - 7, -30, x, -32); c.quadraticCurveTo(x + 7, -30, x + 7, -8); c.lineTo(x + 7, 26); c.closePath(); c.fill(); }
    c.fillStyle = P.color; c.shadowBlur = 0; c.fillRect(-20, 8, 40, 4);
  } else if (id === 'phoenix') { // aufsteigender Flügel
    c.moveTo(-26, 22); c.quadraticCurveTo(-24, -10, 4, -30); c.quadraticCurveTo(-4, -12, 14, -20); c.quadraticCurveTo(6, -2, 26, -6); c.quadraticCurveTo(12, 14, -26, 22); c.fill();
  } else if (id === 'sprint') { // Doppelpfeil
    c.lineWidth = 9;
    for (const x of [-12, 8]) { c.beginPath(); c.moveTo(x - 6, -22); c.lineTo(x + 12, 0); c.lineTo(x - 6, 22); c.stroke(); }
  }
  return cv.toDataURL();
}

// Blutspritzer am Bildschirmrand (Schaden), einmalig erzeugt:
// dunkelroter Rand und unregelmäßige Spritzer in Ecken und an Kanten
function bloodOverlay() {
  const W = 1024, H = 576, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d'), r = mulberry32(5);
  const v = c.createRadialGradient(W / 2, H / 2, H * 0.36, W / 2, H / 2, W * 0.6);
  v.addColorStop(0, 'rgba(70,0,0,0)'); v.addColorStop(0.75, 'rgba(90,0,0,0.38)'); v.addColorStop(1, 'rgba(40,0,0,0.85)');
  c.fillStyle = v; c.fillRect(0, 0, W, H);
  const blob = (x, y, rad, a) => {
    const g = c.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(105,3,3,${a})`); g.addColorStop(0.65, `rgba(85,2,2,${a * 0.9})`); g.addColorStop(1, 'rgba(70,0,0,0)');
    c.fillStyle = g; c.beginPath(); c.arc(x, y, rad, 0, Math.PI * 2); c.fill();
  };
  // Spritzer-Cluster: viele kleine Kleckse um einen Kern, nach außen kleiner
  const spots = [[0.02, 0.05], [0.97, 0.08], [0.03, 0.92], [0.96, 0.95], [0.5, 0.0], [0.25, 0.99], [0.78, 0.02], [0.0, 0.5], [1.0, 0.45]];
  for (const [fx, fy] of spots) {
    const cx = fx * W, cy = fy * H, R = 60 + r() * 90;
    blob(cx, cy, R * 0.55, 0.55);
    for (let i = 0; i < 40; i++) {
      const a = r() * Math.PI * 2, d = Math.pow(r(), 0.6) * R * 1.3;
      blob(cx + Math.cos(a) * d, cy + Math.sin(a) * d, (1.2 - d / (R * 1.3)) * (3 + r() * 12), 0.4 + r() * 0.35);
    }
    // Tropfen nach unten
    if (fy < 0.2) for (let k = 0; k < 4; k++) {
      let x = cx + (r() - 0.5) * R, y = cy + R * 0.2, w = 2 + r() * 3.5;
      const len = 30 + r() * 120;
      for (let s = 0; s < len; s += 2) { blob(x, y + s, w, 0.6); x += (r() - 0.5) * 0.5; w *= 0.988; }
    }
  }
  return cv.toDataURL();
}

export class HUD {
  constructor() {
    this.el = {
      hud: $('hud'), prompt: $('prompt'), notice: $('notice'), banner: $('banner'), round: $('round'), tally: $('tally'),
      perks: $('perks'), score: $('score'), popups: $('popups'), wname: $('wname'), ammo: $('ammo'), mag: $('mag'), reserve: $('reserve'), nades: $('nades'),
      powerups: $('powerups'), damage: $('damage'), dmgdir: $('dmgdir'), hit: $('hitmarker'), cross: $('crosshair'), scope: $('scope'), downed: $('downed'), fps: $('fps'),
      subtitle: $('subtitle'), carry: $('carry'), latch: $('latch'), intro: $('intro'), reviveRing: $('reviveRing'),
    };
    this.cross = ['t', 'b', 'l', 'r'].map((c) => this.el.cross.querySelector('.' + c));
    this.cache = {};
    this.hitT = 0;
    this.dirT = 0;
    this.noticeTimer = null;
    this.bannerTimer = null;
    this.showHits = false;
    this.perkUrls = {};
    this.el.damage.style.backgroundImage = `url(${bloodOverlay()})`;
    this.introTimers = [];
  }

  show(v) { this.el.hud.classList.toggle('hidden', !v); }

  set(key, val, fn) {
    if (this.cache[key] === val) return;
    this.cache[key] = val;
    fn(val);
  }

  // ── Runde: Strichliste bis 5, danach Kreideziffern ─────────
  round(r, flash = false) {
    const el = this.el, j = () => (Math.random() - 0.5) * 6;
    let d = '', w = 220;
    if (r <= 5) {
      for (let i = 0; i < Math.min(r, 4); i++) {
        const x = 20 + i * 34;
        d += `<path d="M${x + j()},${12 + j()} Q${x + 4 + j()},60 ${x + j()},${108 + j()}"/>`;
      }
      if (r === 5) d += `<path d="M6,96 Q80,58 150,22"/>`;
    } else {
      const s = String(r);
      w = s.length * 64 + 10;
      [...s].forEach((ch, i) => {
        const rot = (Math.random() - 0.5) * 6;
        d += `<g transform="translate(${6 + i * 64 + j() * 0.5},${10 + j() * 0.5}) rotate(${rot} 30 50)">` + DIGITS[ch].map((p) => `<path d="${p}"/>`).join('') + '</g>';
      });
    }
    el.tally.setAttribute('viewBox', `0 0 ${w} 120`);
    el.tally.style.width = (w / 220) * 220 + 'px';
    el.tally.innerHTML = `<g filter="url(#chalkRough)">${d}</g>`;
    el.round.classList.remove('ending');
    if (flash) {
      el.round.classList.remove('starting');
      void el.round.offsetWidth; // Animation neu starten
      el.round.classList.add('starting');
    }
  }

  // Runde geschafft: Zähler blinkt weiß/rot, bis die nächste beginnt
  roundEnding() {
    this.el.round.classList.remove('starting');
    this.el.round.classList.add('ending');
  }

  // ── Intro: Ort und Zeit wie auf einer Schreibmaschine ───────
  intro(lines, audio) {
    const el = this.el.intro;
    for (const t of this.introTimers) clearTimeout(t);
    this.introTimers = [];
    el.innerHTML = '';
    el.classList.remove('fade');
    if (!lines || !lines.length) return;
    let delay = 600;
    lines.forEach((text, li) => {
      const row = document.createElement('div');
      if (li === 0) row.className = 'first';
      el.appendChild(row);
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        this.introTimers.push(setTimeout(() => {
          row.textContent += ch;
          if (ch !== ' ' && audio && audio.typeClick) audio.typeClick();
        }, delay));
        delay += ch === ' ' ? 45 : 70;
      }
      delay += 450;
    });
    this.introTimers.push(setTimeout(() => el.classList.add('fade'), delay + 3800));
    this.introTimers.push(setTimeout(() => { el.innerHTML = ''; el.classList.remove('fade'); }, delay + 6000));
  }

  // ── Punkte ──────────────────────────────────────────────────
  points(v) { this.set('pts', v, (x) => (this.el.score.textContent = x)); }
  pointsPop(n) {
    const d = document.createElement('div');
    d.className = 'pop' + (n < 0 ? ' neg' : '');
    d.textContent = (n > 0 ? '+' : '') + n;
    d.style.right = Math.random() * 30 + 'px';
    d.style.setProperty('--dy', (Math.random() * 30 - 15).toFixed(0) + 'px');
    this.el.popups.appendChild(d);
    setTimeout(() => d.remove(), 1100);
  }
  deny() {
    this.el.score.classList.add('deny');
    setTimeout(() => this.el.score.classList.remove('deny'), 400);
  }

  // ── Waffe ───────────────────────────────────────────────────
  weaponName(slot) {
    this.el.wname.textContent = slot ? slot.stats.name : '';
    this.el.wname.classList.toggle('pap', !!(slot && slot.pap));
  }
  ammo(w, nades) {
    const key = w ? `${w.mag}|${w.reserve}|${nades}` : `-|${nades}`;
    this.set('ammo', key, () => {
      this.el.mag.textContent = w ? w.mag : '-';
      this.el.reserve.textContent = w ? w.reserve : '-';
      this.el.ammo.classList.toggle('low', !!w && w.mag <= Math.ceil(w.stats.mag * 0.25));
      this.el.nades.innerHTML = '<i></i>'.repeat(nades);
    });
  }
  crosshair(spread, hidden) {
    const gap = Math.round(6 + spread * 900);
    this.set('cross', hidden ? -1 : gap, () => {
      const [t, b, l, r] = this.cross;
      const o = hidden ? 0 : 1;
      t.style.cssText = `top:${-gap - 9}px;opacity:${o}`; b.style.cssText = `top:${gap}px;opacity:${o}`;
      l.style.cssText = `left:${-gap - 9}px;opacity:${o}`; r.style.cssText = `left:${gap}px;opacity:${o}`;
    });
  }
  scope(v) { this.set('scope', !!v, (x) => this.el.scope.classList.toggle('hidden', !x)); }
  // Trefferanzeige gibt es in den Treyarch-Zombies nicht – nur auf Wunsch (Einstellungen)
  hitmarker(head) {
    if (!this.showHits) return;
    this.hitT = 0.18;
    this.el.hit.classList.toggle('head', head);
  }

  // ── Perks / Power-Ups ───────────────────────────────────────
  perks(set) {
    this.el.perks.innerHTML = '';
    for (const id of set) {
      const p = PERKS[id];
      const d = document.createElement('div');
      d.className = 'perk';
      d.style.backgroundImage = `url(${this.perkUrls[id] || (this.perkUrls[id] = perkIcon(id))})`;
      d.style.color = p.color;
      d.title = p.name;
      this.el.perks.appendChild(d);
    }
  }
  powerupTimers(t) {
    const key = Object.entries(t).map(([k, v]) => `${k}${Math.ceil(v)}`).join('|');
    this.set('pu', key, () => {
      this.el.powerups.innerHTML = '';
      for (const [k, v] of Object.entries(t)) {
        if (v <= 0) continue;
        const d = document.createElement('div');
        d.className = 'pu' + (v < 6 ? ' blink' : '');
        d.style.backgroundImage = `url(${this.iconUrls?.[k] || ''})`;
        this.el.powerups.appendChild(d);
      }
    });
  }
  powerupBanner(type) {
    const names = { maxammo: 'Volle Munition', instakill: 'Sofort-Kill', double: 'Doppelte Punkte', nuke: 'Atombombe', carpenter: 'Zimmermann', firesale: 'Ausverkauf' };
    this.el.banner.textContent = names[type] || '';
    this.el.banner.classList.remove('show');
    void this.el.banner.offsetWidth;
    this.el.banner.classList.add('show');
  }

  // ── Texte ───────────────────────────────────────────────────
  prompt(text) { this.set('prompt', text || '', (x) => (this.el.prompt.textContent = x)); }
  notice(text, ms = 2600) {
    this.el.notice.textContent = text;
    this.el.notice.style.opacity = 1;
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => (this.el.notice.style.opacity = 0), ms);
  }

  // Untertitel für Figuren (OTTO, Funkstimme, Tonbänder)
  subtitle(who, text, ms = 5200) {
    const el = this.el.subtitle;
    el.innerHTML = '';
    if (who) { const b = document.createElement('b'); b.textContent = who + ': '; el.appendChild(b); }
    el.appendChild(document.createTextNode(text));
    el.style.opacity = 1;
    clearTimeout(this.subTimer);
    this.subTimer = setTimeout(() => (el.style.opacity = 0), ms);
  }
  // Getragenes Bauteil
  carry(item) {
    this.set('carry', item ? item.name : '', () => {
      this.el.carry.innerHTML = '';
      if (!item) return;
      const i = document.createElement('span'); i.className = 'ic'; i.textContent = item.icon || '⚙';
      this.el.carry.append(i, document.createTextNode(item.name));
    });
  }
  latch(on) { this.set('latch', !!on, (x) => this.el.latch.classList.toggle('on', x)); }
  clearMapHud() {
    this.el.subtitle.style.opacity = 0;
    this.carry(null);
    this.latch(false);
    this.intro(null);
  }

  // ── Schaden ─────────────────────────────────────────────────
  damageDir(from, player) {
    const ang = Math.atan2(from.x - player.pos.x, from.z - player.pos.z);
    const rel = ang - player.yaw + Math.PI; // 0 = vorne
    this.el.dmgdir.style.transform = `rotate(${-rel}rad)`;
    this.dirT = 1;
  }

  update(dt, player, fps) {
    this.hitT = Math.max(0, this.hitT - dt);
    this.el.hit.style.opacity = this.hitT > 0 ? 1 : 0;
    this.dirT = Math.max(0, this.dirT - dt * 1.2);
    this.el.dmgdir.style.opacity = this.dirT;
    const low = 1 - player.health / player.maxHealth;
    const dmg = Math.min(0.85, Math.max(player.hurtFlash * 0.6, (low - 0.3) * 1.15, player.downed ? 0.75 : 0));
    this.set('dmg', Math.round(dmg * 50), () => (this.el.damage.style.opacity = dmg));
    this.set('downed', player.downed, (x) => this.el.downed.classList.toggle('hidden', !x));
    if (player.downed) {
      const k = 1 - Math.max(0, player.reviveT) / (player.reviveTotal || 6);
      this.set('revive', Math.round(k * 100), (v) => (this.el.reviveRing.style.strokeDashoffset = (283 * (1 - v / 100)).toFixed(1)));
    }
    if (fps !== null) this.el.fps.textContent = fps;
    else this.el.fps.textContent = '';
  }
}
