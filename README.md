# NACHTFALL – Zombies

Ein rundenbasierter 3D-Zombie-Survival-Shooter im Geist von *Call of Duty: Black Ops 2 – Zombies*,
komplett neu entwickelt: eigene Karte, eigene Waffen, eigene Perks, eigener Sound.
Läuft direkt im Browser (Three.js / WebGL2), ohne externe Assets – alle Texturen, Modelle,
Animationen und Sounds werden prozedural im Code erzeugt.

> **Rechtlicher Hinweis:** Dies ist ein eigenständiges Fan-Projekt. Es verwendet **keine**
> Inhalte, Namen, Modelle, Sounds oder Musik von Activision/Treyarch. Perks, Waffen, Karte und
> die Pack-a-Punch-Entsprechung („Äther-Schmiede“) sind eigene Schöpfungen.

## Auf jedem Gerät spielbar

| Plattform | Steuerung | Hinweise |
|---|---|---|
| Windows, macOS, Linux (Chrome, Edge, Firefox, Safari) | Maus & Tastatur oder Controller | Grafik „Hoch“, Maus-Fang per Klick |
| Android-Handys & -Tablets (Chrome) | Touch oder Bluetooth-Controller | Grafik automatisch angepasst, Vollbild + Querformat |
| iPhone & iPad (Safari) | Touch oder Bluetooth-Controller | Über „Teilen → Zum Home-Bildschirm“ als App im Vollbild |
| Steam Deck, Handhelds, Fernseher mit Browser | Controller | Menüs komplett per Controller bedienbar |

- **Automatische Erkennung:** Touch-Steuerung erscheint bei der ersten Berührung, Controller werden beim ersten Tastendruck erkannt; Hinweise passen sich an („Drücke F“, „Drücke X/▢“, „Tippe auf Benutzen“).
- **Leistung:** Qualitätsstufe „Automatisch“ wählt passend zum Gerät; eine dynamische Auflösung hält die Bildrate flüssig. Zombies werden per Instancing gezeichnet, statische Deko zusammengefasst – ein Frame mit 24 Zombies braucht so ca. 460 statt über 10 000 Draw-Calls.
- **Als App installierbar (PWA)** und danach **offline spielbar**: Menüpunkt „Als App installieren“ (Chrome/Edge/Android) bzw. „Zum Home-Bildschirm“ (iOS).
- **Zielhilfe** für Controller und Touch (abschaltbar), Bildschirm bleibt während des Spiels an, Pause beim App-Wechsel.

## Starten

```bash
npm install
npm run dev           # Entwicklungsserver → http://localhost:5173 (im WLAN auch vom Handy: npm run dev -- --host)
npm run build         # Produktions-Build nach dist/ (inkl. App-Manifest und Offline-Cache)
npm run preview       # Build lokal testen
npm run build:single  # zusätzlich dist/nachtfall.html: das ganze Spiel in EINER Datei
```

Die Einzeldatei `dist/nachtfall.html` läuft ohne Server – zum Weitergeben, Hochladen (z. B. itch.io)
oder direkt Öffnen im Browser.

**Online spielen (GitHub Pages):** Der Workflow `.github/workflows/deploy.yml` baut das Spiel bei jedem
Push auf `main` und veröffentlicht es. Einmalig unter *Settings → Pages → Source* „GitHub Actions“ wählen.

## Steuerung

| Aktion | Tastatur & Maus | Controller (Xbox / PlayStation) | Touch |
|---|---|---|---|
| Bewegen | W A S D | Linker Stick | Joystick links (erscheint unter dem Daumen) |
| Umsehen | Maus / Pfeiltasten | Rechter Stick | Rechte Bildschirmhälfte wischen |
| Schießen | Linke Maustaste | RT / R2 | Feuerknopf (halten + ziehen zum Nachzielen) |
| Zielen | Rechte Maustaste | LT / L2 | Zielfernrohr-Knopf (an/aus) |
| Sprinten | Shift | Linken Stick drücken | Joystick ganz nach vorne |
| Springen / Ducken | Leertaste / C | A ✕ / B ○ | Knöpfe |
| Nachladen | R | X ▢ | Knopf |
| Kaufen / Benutzen | F (halten: reparieren) | X ▢ (wenn etwas in Reichweite ist) | „Benutzen“-Knopf erscheint automatisch |
| Messer / Granate | V / G | R3 oder LB / RB | Knöpfe |
| Waffe wechseln | 1 / 2 / Q / Mausrad | Y △ / Steuerkreuz | Knopf |
| Pause | Esc | Start / Options | Pause-Knopf |

## Was schon drin ist

**Gameplay-Kern**
- Endlose Runden mit BO-ähnlicher Skalierung (Anzahl, Lebenspunkte, Spawn-Tempo, Geher → Läufer → Sprinter)
- Punktesystem (Treffer, Kills, Kopfschüsse, Messer-Kills, Barrikaden reparieren)
- Fenster-Barrikaden mit 6 Brettern: Zombies reißen sie ab, klettern hinein, schlagen durchs Fenster
- 4 Zonen, 4 kaufbare Rolltore, Stromschalter
- 5 Wall-Buys inkl. Granaten, Munition nachkaufen
- Mystery-Kiste mit Spieluhr-Melodie, Waffen-Karussell, Teddy und Umzug (Lichtsäule zeigt den Standort)
- **Äther-Schmiede** (Pack-a-Punch): verbessert Waffen mit Tarnmuster, neuen Namen und Spezialeffekten
- 5 Perks (Perk-Limit 4): Titan-Trank, Blitz-Tonikum, Doppelschuss, Phönix-Soda (Selbst-Wiederbelebung), Sprint-Elixier
- 5 Power-Ups: Volle Munition, Sofort-Kill, Doppelte Punkte, Atombombe, Zimmermann
- 9 Waffen inkl. Wunderwaffe „Strahlenkanone“ mit Projektilen und Flächenschaden
- Messer mit Ausfallschritt, Splittergranaten mit Abprallphysik

**Grafik**
- PBR-Materialien mit prozeduralen Textur- und Bump-Maps (Putz über Ziegel, Diner-Fliesen, Kopfsteinpflaster …)
- Echtzeit-Schatten (Mond + Hängelampen), flackernde Lichter, Feuer, Neon
- HDR-Pipeline: MSAA, Bloom, ACES-Tonemapping, Color-Grading, chromatische Aberration, Filmkorn, Vignette
- Leuchtende Zombie-Augen, Blut-Partikel und -Decals, Einschusslöcher, Funken, Rauch, Mündungsfeuer, Tracer
- Eigene Viewmodel-Pipeline (Waffe clippt nie in Wände)

**Animation**
- Zombies mit Knochenhierarchie: Schlurfen, Rennen, Sprinten, Hinken, Angriffe, Bretter reißen, Klettern, Treffer-Zucken, Sterbe-Animationen, Kopfschuss-Enthauptung
- Viewmodel: Laufen, Atmen, Sway, Sprint-Haltung, Rückstoß, Nachladen (Magazin raus/rein, Pumpgun, Kipplauf), Messer, Granate, Perk-Trinken

**Sound** (vollständig synthetisiert, Web Audio API, HRTF-3D)
- Waffensounds je Waffenklasse mit Hall, PaP-Variante, Nachlade-Mechanik
- Zombie-Stimmen über Formant-Synthese (Stöhnen, Schreie, Gurgeln), Schläge, Todesgeräusche
- Runden-Start/-Ende-Musik, Perk-Jingles, Mystery-Kisten-Melodie, Ansager (Sprachsynthese)
- Ambiente: Wind, Drone, ferne Schreie, Donner; Herzschlag und dumpfer Klang bei wenig Leben

## Projektstruktur

```
src/
  config.js            Karte, Waffen, Perks, Balancing – alles an einem Ort
  core/                Renderer + Post-FX, Input, Noise, prozedurale Texturen, Materialien
  world/               Kartengeometrie, Navigation, Kollision, Requisiten, Licht
  zombies/             Zombie-Modell, Animation, KI, Spawn- & Flow-Field-Navigation
  weapons/             Waffenmodelle, Schießen, Viewmodel-Animation, Granaten, Projektile
  player/              Bewegung, Kamera, Gesundheit, Perks
  game/                Spiel-Loop, Runden, Interaktionen (Kiste, Perks, Türen …), Power-Ups
  audio/               Prozedurales Sound-Design
  ui/                  HUD und Touch-Steuerung
public/                App-Manifest, Service Worker (offline), Icons
scripts/               Einzeldatei-Build
```

Neue Waffen, Perks oder Kartenbereiche lassen sich größtenteils über `src/config.js` hinzufügen –
die Karte ist ein ASCII-Raster (`#` Wand, Ziffern = Zonen, Buchstaben = Türen, `w` = Fenster).

Entwickler-Modus: `http://localhost:5173/#dev` → 50 000 Punkte, unverwundbar, `P` beendet die Runde.

## Ehrliche Einordnung & Roadmap

Ein Spiel, das BO2 Zombies wirklich *ersetzt*, ist ein Mehrjahresprojekt für ein Team
(Artists, Animatoren mit Motion-Capture, Sounddesigner, Level-Designer). Dieses Repository ist das
**spielbare Fundament**: Kernmechaniken, Systeme und Atmosphäre stehen, alles ist prozedural und
damit sofort lauffähig. Die größten Hebel für „perfekte“ Optik und Animationen sind:

1. **Engine-Entscheidung für AAA-Optik:** Für fotorealistische Grafik (Lumen, Nanite, MetaHuman,
   Motion-Matching) ist **Unreal Engine 5** der realistische Weg. Die Spiellogik hier (Rundenformeln,
   Balancing, Zustandsautomaten) lässt sich 1:1 übertragen. Alternativ im Browser bleiben und
   Three.js mit WebGPU + echten Assets ausbauen.
2. **Echte Assets:** gescannte/handmodellierte Zombies mit Skinning und Motion-Capture-Animationen
   (z. B. glTF-Import), PBR-Texturen aus Substance, aufgenommene Foley-Sounds und komponierte Musik.
3. **Koop-Multiplayer (1–4 Spieler)** – das Herzstück der Kindheitserinnerungen: WebRTC/WebSocket
   mit autoritativem Server, Wiederbeleben von Mitspielern.
4. **Mehr Inhalt:** weitere Karten, Höllenhund-Runden, Easter-Egg-Quest, buildables, Spezialzombies,
   Wunderwaffen, Bank/Waffenkammer, Rangsystem und Statistiken.
5. **Verbesserungen ggü. BO2:** Barrierefreiheit (Untertitel, Farbfilter, frei belegbare Tasten),
   Speichern zwischen Runden, Mod-Support über die Konfigurationsdatei.
6. **App-Stores & Konsolen:** Für Google Play und den App Store lässt sich das Spiel mit Capacitor
   verpacken, für Steam mit Electron oder Tauri. PlayStation, Xbox und Nintendo verlangen offizielle
   Entwicklerverträge und Dev-Kits – ein Browser-Spiel kann dort nicht direkt veröffentlicht werden.
   Im Browser einer Konsole (z. B. Edge auf der Xbox) sollte es mit Controller laufen; das ist ungetestet.
