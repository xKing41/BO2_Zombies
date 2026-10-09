// ─────────────────────────────────────────────────────────────
//  Linie 13: alle Spielsysteme der Karte zusammenstecken
// ─────────────────────────────────────────────────────────────
import { Bus } from './bus.js';
import { Buildables } from './buildables.js';
import { Hazards } from './hazards.js';
import { Quest } from './quest.js';
import { Bank } from './bank.js';
import { Sparkman } from './sparkman.js';

export function setupLinie13(game) {
  const bus = new Bus(game);
  game.bus = bus;
  const build = new Buildables(game);
  const quest = new Quest(game, build);
  return [bus, build, new Hazards(game), quest, new Bank(game), new Sparkman(game)];
}
