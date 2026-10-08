// Verzeichnis aller Karten
import nachtfall from './nachtfall.js';
import linie13 from './linie13.js';

export const MAPS = { [nachtfall.id]: nachtfall, [linie13.id]: linie13 };
export const MAP_ORDER = [nachtfall.id, linie13.id];
