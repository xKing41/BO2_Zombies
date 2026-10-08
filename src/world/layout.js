// ─────────────────────────────────────────────────────────────
//  Karten-Raster erzeugen: entweder aus ASCII-Zeilen (kleine Karten)
//  oder per Bau-Befehlen (große Karten mit Gebäuden, Straßen, Feldern).
//
//  Zelltypen: floor · wall · door · window · solid (unsichtbares Hindernis,
//  z. B. Baumstamm) · spawn (Zombie-Spawnfläche außerhalb) · void (Nichts)
// ─────────────────────────────────────────────────────────────

// Legende: '#' Wand · '0'-'9' Boden (Zone) · 'A'-'Z' Tür · 'w' Fenster · 's' Spawn · ' ' Außenbereich
export function parseRows(rows) {
  const h = rows.length, w = rows[0].length;
  const cells = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      const c = { type: 'void', zone: -1, door: null };
      if (ch === '#') c.type = 'wall';
      else if (ch >= '0' && ch <= '9') { c.type = 'floor'; c.zone = +ch; }
      else if (ch >= 'A' && ch <= 'Z') { c.type = 'door'; c.door = ch; }
      else if (ch === 'w') c.type = 'window';
      else if (ch === 's') c.type = 'spawn';
      cells.push(c);
    }
  }
  return { w, h, cells };
}

export class GridBuilder {
  constructor(w, h, fill = { type: 'floor', zone: 0 }) {
    this.w = w;
    this.h = h;
    this.cells = [];
    for (let i = 0; i < w * h; i++) this.cells.push({ type: fill.type, zone: fill.zone, door: null });
  }

  inside(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  get(x, y) { return this.inside(x, y) ? this.cells[y * this.w + x] : null; }

  set(x, y, props) {
    const c = this.get(x, y);
    if (c) Object.assign(c, props);
    return c;
  }

  // Rechteck (inklusive Ränder) mit Eigenschaften füllen
  fill(x0, y0, x1, y1, props) {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, props);
  }

  // Gebäude: Außenwände, Innenboden, Öffnungen, Fenster, Türen
  // openings/windows: Listen von [x, y]; doors: { id: [[x, y], …] }
  building({ x0, y0, x1, y1, zone, mat = 'wall', openings = [], windows = [], doors = {} }) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const edge = x === x0 || x === x1 || y === y0 || y === y1;
        this.set(x, y, edge ? { type: 'wall', zone: -1, mat, door: null } : { type: 'floor', zone, door: null });
      }
    }
    for (const [x, y] of openings) this.set(x, y, { type: 'floor', zone, door: null });
    for (const [x, y] of windows) this.set(x, y, { type: 'window', zone: -1, mat, door: null });
    for (const id in doors) for (const [x, y] of doors[id]) this.set(x, y, { type: 'door', zone: -1, mat, door: id });
    return this;
  }

  // Innenwand (Linie) mit optionalen Türen/Öffnungen
  wall(x0, y0, x1, y1, mat = 'wall') {
    this.fill(x0, y0, x1, y1, { type: 'wall', zone: -1, mat, door: null });
    return this;
  }

  // Bereich gehört zu einer Zone (z. B. Lager hinter einer Innenwand)
  zone(x0, y0, x1, y1, zone) {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
        const c = this.get(x, y);
        if (c && c.type === 'floor') c.zone = zone;
      }
    return this;
  }

  solid(x, y) { return this.set(x, y, { type: 'solid', door: null }); }

  result() { return { w: this.w, h: this.h, cells: this.cells }; }
}
