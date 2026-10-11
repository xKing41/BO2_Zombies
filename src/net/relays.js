// ─────────────────────────────────────────────────────────────
//  Vermittlungs-Relays (Nostr): Über sie finden sich die Geräte, bevor
//  die direkte Verbindung steht. Host und Gäste brauchen mindestens ein
//  gemeinsames, funktionierendes Relay – deshalb eine feste Liste statt
//  der Auswahl der Bibliothek. Geprüft mit scripts/coop-check.mjs.
// ─────────────────────────────────────────────────────────────
export const RELAYS = [
  // bisherige Auswahl (ältere Spielversionen benutzen genau diese – so finden sich alt und neu)
  'wss://nostrcity-club.fly.dev',
  'wss://nos.lol',
  'wss://relay.layer.systems',
  'wss://relay.piazza.today',
  'wss://relay.nostr.dev.br',
  // zusätzlich: schnell und zuverlässig im Test (Oktober 2026)
  'wss://cdn.satellite.earth',
  'wss://nostr.mom',
  'wss://relay.primal.net',
  'wss://nostr-pub.wellorder.net',
  // nicht: offchain.pub – lehnt Spiel-Nachrichten zeitweise ab („nicht im Web of Trust“)
];
