# NACHTFALL – Zombies

Ein rundenbasierter 3D-Zombie-Survival-Shooter im Geist von *Call of Duty: Black Ops 2 – Zombies*,
komplett neu entwickelt: eigene Karten, eigene Waffen, eigene Perks, eigener Sound.
Läuft direkt im Browser (Three.js / WebGL2), ohne externe Assets – alle Texturen, Modelle,
Animationen und Sounds werden prozedural im Code erzeugt.

> **Rechtlicher Hinweis:** Dies ist ein eigenständiges Fan-Projekt. Es verwendet **keine**
> Inhalte, Namen, Modelle, Sounds oder Musik von Activision/Treyarch. Perks, Waffen, Karten, Figuren
> und die Pack-a-Punch-Entsprechung („Äther-Schmiede“) sind eigene Schöpfungen. „Linie 13“ ist von
> der Idee einer Buskarte inspiriert, aber mit eigener Welt, eigenen Orten, Figuren und Rätseln gebaut.

## Karten

| Karte | Stil | Inhalt |
|---|---|---|
| **Station Nachtfall** | kompakt, eng, klassisch | Depot-Halle, Diner, Werkstatt, Innenhof; Stromschalter, Äther-Schmiede |
| **Linie 13** | groß, Bus, Nebel, Geheimnisse | 5 Haltestellen an einer Ringstraße, Tunnel, Maisfeld mit Hütte, Funkmast „Sender 7“, Glutfelder |

**Linie 13 im Überblick**
- **Der Bus:** Roboterfahrer **OTTO** fährt die Ringstraße ab (Busbahnhof → Altstadt → Kraftwerk → Hof → Raststätte → Tunnel), hält an jeder Haltestelle und kommentiert die Fahrt bissig. Einfach durch die offene Mitteltür einsteigen und mitfahren; Zombies rennen hinterher, springen durch Tür und Fenster hinein – oder werden überfahren. An jeder Haltestelle ruft ein Knopf den Bus, im Bus gibt es den Losfahr-Knopf und den Notausstieg.
- **Nebel:** Zwischen den Stationen ist dichter Nebel. Wer dort zu lange herumläuft, bekommt Besuch von **Nebelkriechern**, die ins Gesicht springen – mit dem Messer abschütteln.
- **Zombies** steigen auf freiem Feld aus dem Boden; in Gebäuden kommen sie durch die Fenster.
- **Glutfelder** verbrennen Spieler; Zombies, die hindurchlaufen, fangen Feuer und zerplatzen beim Tod in einer Flammenwolke.
- **Baupläne:** Bauteile finden (immer nur eines tragbar) und an der Werkbank einbauen – Turbine, Stromschalter, Äther-Schmiede und eine geheime Wunderwaffe.
- **Altstadt:** Bank (Punkte über Partien hinweg sparen), Schließfach (eine Waffe für die nächste Partie aufbewahren), Jagdmesser.
- **Geheimnisse:** eine mehrstufige Hauptquest und ein verstecktes Lied.

## Auf jedem Gerät spielbar

| Plattform | Steuerung | Hinweise |
|---|---|---|
| Windows, macOS, Linux (Chrome, Edge, Firefox, Safari) | Maus & Tastatur oder Controller | Grafik „Hoch“, Maus-Fang per Klick |
| Android-Handys & -Tablets (Chrome) | Touch oder Bluetooth-Controller | Grafik automatisch angepasst, Vollbild + Querformat |
| iPhone & iPad (Safari) | Touch oder Bluetooth-Controller | Über „Teilen → Zum Home-Bildschirm“ als App im Vollbild |
| Steam Deck, Handhelds, Fernseher mit Browser | Controller | Menüs komplett per Controller bedienbar |

- **Automatische Erkennung:** Touch-Steuerung erscheint bei der ersten Berührung, Controller werden beim ersten Tastendruck erkannt; Hinweise passen sich an („Drücke F“, „Drücke X/▢“, „Tippe auf Benutzen“).
- **Leistung:** Qualitätsstufe „Automatisch“ wählt passend zum Gerät; eine dynamische Auflösung hält die Bildrate flüssig. Zombies und Fensterbretter werden per Instancing gezeichnet, statische Deko in Kacheln zusammengefasst; auf Linie 13 werden Kacheln, die der Nebel verschluckt, gar nicht erst gezeichnet, und ein Licht-Pool verteilt wenige echte Lichter auf die vielen Lampen. Typischer Frame auf dem Handy-Profil: ca. 120–220 Draw-Calls.
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
- 10 Waffen inkl. Wunderwaffe „Strahlenkanone“ (Projektile, Flächenschaden) und dem baubaren „Gewitter-Werfer“ (Kettenblitz)
- Messer mit Ausfallschritt (auf Linie 13 als Jagdmesser aufrüstbar), Splittergranaten mit Abprallphysik
- Mehrere Karten mit Kartenauswahl, Rekord je Karte

**Linie 13 (zusätzlich)**
- Fahrender Bus mit Fahrplan, Türen, Mitfahren in lokalen Koordinaten, Zombies im Bus, Überfahren, Hupe, Motor- und Bremsgeräusche
- Roboterfahrer OTTO mit über 30 Sprüchen (Sprachsynthese + Untertitel), reagiert auf Beschuss
- Boden-Spawns, Nebelkriecher, Glutfelder, brennende Zombies
- Baupläne mit Werkbänken und Bauplan-Vorschau: Turbine, Stromschalter, Äther-Schmiede, Gewitter-Werfer
- Bank und Schließfach (bleiben über Partien gespeichert), Jagdmesser
- Hauptquest „Das Signal“ mit Tonbändern, Funkfrequenz, Seelensammeln und Übertragung; Erfolg wird gespeichert
- Musik-Geheimnis mit eigenem, live synthetisiertem Lied

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
- Waffensounds je Waffenklasse mit Hall, PaP-Variante, Nachlade-Mechanik, Blitz und Donner
- Zombie-Stimmen über Formant-Synthese (Stöhnen, Schreie, Gurgeln), Schläge, Todesgeräusche
- Runden-Start/-Ende-Musik, Perk-Jingles, Mystery-Kisten-Melodie, Ansager (Sprachsynthese)
- Ambiente: Wind, Drone, ferne Schreie, Donner; Herzschlag und dumpfer Klang bei wenig Leben

## Projektstruktur

```
src/
  config.js            Waffen, Perks, Balancing – alles an einem Ort
  maps/                Kartendefinitionen (Nachtfall, Linie 13 inkl. Daten und Deko)
  core/                Renderer + Post-FX, Input, Noise, prozedurale Texturen, Materialien
  world/               Generische Karte (Raster, Navigation, Kollision), Layout-Bauer, Licht-Pool, Routen, Requisiten
  zombies/             Zombie-Modell, Animation, KI, Spawn- & Flow-Field-Navigation
  weapons/             Waffenmodelle, Schießen, Viewmodel-Animation, Granaten, Projektile, Kettenblitz
  player/              Bewegung, Kamera, Gesundheit, Perks
  game/                Spiel-Loop, Runden, Interaktionen, Power-Ups; Linie 13: Bus, Baupläne, Gefahren, Quest, Bank
  audio/               Prozedurales Sound-Design
  ui/                  HUD und Touch-Steuerung
public/                App-Manifest, Service Worker (offline), Icons
scripts/               Einzeldatei-Build
```

Neue Waffen und Perks lassen sich größtenteils über `src/config.js` hinzufügen. Eine Karte ist eine
Definition in `src/maps/` (registriert in `src/maps/index.js`): kleine Karten als ASCII-Raster
(`#` Wand, Ziffern = Zonen, Buchstaben = Türen, `w` = Fenster), große Karten per `GridBuilder`
(Gebäude, Wände, Zonen), dazu Spots für Kiste, Perks, Wall-Buys sowie eigene Deko, Lichter und Spielsysteme.

<details>
<summary><b>Linie 13 – Komplettlösung (Spoiler!)</b></summary>

- **Turbine:** Rotorblatt, Dynamo und Leitwerk liegen rund um den Busbahnhof. Werkbank: Südwand der Halle. Aufgestellt vor dem Lagertor öffnet sie das Lager, am markierten Platz am Funkmast weckt sie Sender 7.
- **Stromschalter:** Hebel (Raststätte/Werkstatt), Schaltplatine (Kraftwerk), Kabeltrommel (Hof). Eingebaut direkt an der Nordwand des Kraftwerks, danach umlegen.
- **Äther-Schmiede:** Zahnradsatz (Altstadt), Ätherkristall (Tunnel oder Mast), Batteriepack (Bauernhaus, Raststätte oder Lager). Gebaut im Labor des Kraftwerks (öffnet sich mit Strom).
- **Gewitter-Werfer:** Kondensator, Kupferspule, Griffstück und Blitzröhre – über die ganze Karte verteilt. Werkbank in der Hütte im Maisfeld.
- **Das Signal:** Strom an, Turbine an den Mast → drei Tonbänder finden (jedes nennt eine Ziffer) → Frequenz am Funkempfänger im Busbahnhof einstellen → 25 Zombies in Mastnähe töten (Seelen) → Übertragung 60 Sekunden am Mast verteidigen. Belohnung: Nebel lichtet sich, alle Perks, Gewitter-Werfer, volle Munition und ein gespeicherter Erfolg.
- **Lied „Nebelfahrt“:** drei Spieluhren aufziehen – im Tunnel, in der Scheune und im Tresorraum der Bank.
</details>

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
4. **Mehr Inhalt:** weitere Karten (z. B. eine Gefängnisinsel oder eine Stadt im Ausnahmezustand),
   Höllenhund-Runden, Spezialzombies, Rangsystem und Statistiken.
5. **Verbesserungen ggü. BO2:** Barrierefreiheit (Farbfilter, frei belegbare Tasten; Untertitel gibt es
   schon), Speichern zwischen Runden, Mod-Support über die Kartendefinitionen.
6. **App-Stores & Konsolen:** Für Google Play und den App Store lässt sich das Spiel mit Capacitor
   verpacken, für Steam mit Electron oder Tauri. PlayStation, Xbox und Nintendo verlangen offizielle
   Entwicklerverträge und Dev-Kits – ein Browser-Spiel kann dort nicht direkt veröffentlicht werden.
   Im Browser einer Konsole (z. B. Edge auf der Xbox) sollte es mit Controller laufen; das ist ungetestet.
