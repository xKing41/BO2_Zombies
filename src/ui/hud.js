// HUD: Runde (mit Strichliste), Punkte, Munition, Perks, Hinweise, Effekte
import { PERKS } from '../config.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = {
      hud: $('hud'), prompt: $('prompt'), notice: $('notice'), banner: $('banner'), round: $('round'), roundNum: $('roundNum'), tally: $('tally'),
      perks: $('perks'), score: $('score'), popups: $('popups'), wname: $('wname'), ammo: $('ammo'), mag: $('mag'), reserve: $('reserve'), nades: $('nades'),
      powerups: $('powerups'), damage: $('damage'), dmgdir: $('dmgdir'), hit: $('hitmarker'), cross: $('crosshair'), scope: $('scope'), downed: $('downed'), fps: $('fps'),
    };
    this.cross = ['t', 'b', 'l', 'r'].map((c) => this.el.cross.querySelector('.' + c));
    this.cache = {};
    this.hitT = 0;
    this.dirT = 0;
    this.noticeTimer = null;
    this.bannerTimer = null;
  }

  show(v) { this.el.hud.classList.toggle('hidden', !v); }

  set(key, val, fn) {
    if (this.cache[key] === val) return;
    this.cache[key] = val;
    fn(val);
  }

  // ── Runde ───────────────────────────────────────────────────
  round(r, flash = false) {
    const el = this.el;
    if (r <= 5) {
      el.roundNum.textContent = '';
      let d = '';
      for (let i = 0; i < Math.min(r, 4); i++) {
        const x = 20 + i * 34, j = () => (Math.random() - 0.5) * 6;
        d += `M${x + j()},${12 + j()} Q${x + 4 + j()},60 ${x + j()},${108 + j()} `;
      }
      if (r === 5) d += 'M6,96 Q80,58 150,22 ';
      el.tally.innerHTML = `<path d="${d}"/>`;
      el.tally.style.display = '';
    } else {
      el.tally.style.display = 'none';
      el.roundNum.textContent = r;
    }
    if (flash) {
      el.round.classList.add('flash');
      setTimeout(() => el.round.classList.remove('flash'), 2600);
    }
  }

  // ── Punkte ──────────────────────────────────────────────────
  points(v) { this.set('pts', v, (x) => (this.el.score.textContent = x)); }
  pointsPop(n) {
    const d = document.createElement('div');
    d.className = 'pop' + (n < 0 ? ' neg' : '');
    d.textContent = (n > 0 ? '+' : '') + n;
    d.style.right = Math.random() * 30 + 'px';
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
      this.el.nades.textContent = '●'.repeat(nades);
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
  hitmarker(head) {
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
      d.style.background = `radial-gradient(circle at 35% 30%, ${p.color}, #000 120%)`;
      d.style.color = p.color;
      d.innerHTML = `<span style="color:#fff">${p.glyph}</span>`;
      d.title = p.name;
      this.el.perks.appendChild(d);
    }
  }
  powerupTimers(t) {
    const key = `${Math.ceil(t.instakill)}|${Math.ceil(t.double)}`;
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
    const names = { maxammo: 'Volle Munition!', instakill: 'Sofort-Kill!', double: 'Doppelte Punkte!', nuke: 'Atombombe!', carpenter: 'Zimmermann!' };
    this.el.banner.textContent = names[type];
    this.el.banner.style.opacity = 1;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => (this.el.banner.style.opacity = 0), 2200);
  }

  // ── Texte ───────────────────────────────────────────────────
  prompt(text) { this.set('prompt', text || '', (x) => (this.el.prompt.textContent = x)); }
  notice(text, ms = 2600) {
    this.el.notice.textContent = text;
    this.el.notice.style.opacity = 1;
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => (this.el.notice.style.opacity = 0), ms);
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
    const dmg = Math.max(player.hurtFlash * 0.8, low > 0.3 ? low * 0.9 : 0, player.downed ? 0.8 : 0);
    this.set('dmg', Math.round(dmg * 50), () => (this.el.damage.style.opacity = dmg));
    this.set('downed', player.downed, (x) => this.el.downed.classList.toggle('hidden', !x));
    if (fps !== null) this.el.fps.textContent = fps;
    else this.el.fps.textContent = '';
  }
}
