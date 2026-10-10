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
- **Der Funkenmann:** Ab Runde 4 zieht manchmal ein Gewitter auf – mit ihm kommt ein Wesen aus Elektrizität. Es springt als Blitzkugel umher und entlädt sich auf dich. Kugeln verpuffen in Funken, nur das Messer verletzt es. Fährst du Bus, setzt es sich aufs Dach und legt den Bus lahm.
- **Geheimnisse:** eine mehrstufige Hauptquest und ein verstecktes Lied.

## Koop & Splitscreen (bis zu 4 Spieler)

**Online-Koop ohne eigenen Server:** „Koop“ → Namen eingeben → „Spiel erstellen“. Den fünfstelligen Code
(oder den Einladungslink `…#join=CODE`) an die Mitspieler schicken, die mit „Beitreten“ dazukommen. Die Geräte
finden sich über öffentliche Nostr-Relays (Bibliothek *Trystero*) und verbinden sich dann direkt per WebRTC –
die Spieldaten selbst laufen über keinen Server. Wer das Spiel erstellt (Host), wählt die Karte und startet.

**Splitscreen an einem Gerät:** „Splitscreen“ im Hauptmenü. Controller treten mit A / ✕ bei (B / ○ verlässt),
Tastatur & Maus spielt immer Spieler 1, Start legt los. Zu zweit wird das Bild wie in BO2 oben/unten geteilt,
zu dritt oder viert in Viertel. Jeder hat sein eigenes HUD und hört die Welt aus seiner Position; die Grafikstufe
„Automatisch“ wird dabei eine Stufe sparsamer. Pause hält hier – anders als online – alle an.

**Vier eigene Überlebende:** Willi (Bergmann a. D. mit Schiebermütze und Bart), Dr. Albers (Landtierarzt im
fleckigen Kittel), Hanne (Kfz-Mechanikerin mit Schweißerbrille) und Kai (Funkamateur mit Bomberjacke und
Kopfhörern). Modelle und Texturen sind prozedural, die Bewegungen auch: Gehen und Rennen in alle Richtungen, Ducken,
Springen, Hechtsprung, Liegen, am Boden mit Pistole, Nachladen, Messer, Granate, Trinken und Wiederbeleben.
In den Händen liegt immer die echte Waffe des Spielers, gegriffen per IK. Name und Wiederbelebungs-Symbol
stehen in fester Größe über der Figur, das Armband zeigt die Spielerfarbe.

**Regeln wie in BO2:**
- Wer zu Boden geht, verliert 5 % seiner Punkte und alle Perks und blutet nach 45 Sekunden aus. Mitspieler beleben mit gehaltener Benutzen-Taste in 3 Sekunden wieder (mit Phönix-Soda in 1,5 Sekunden).
- Ausgeblutet heißt zuschauen bis zur nächsten Runde, dann geht es mit der Startpistole weiter. Vorbei ist die Partie erst, wenn alle gleichzeitig am Boden liegen oder ausgeblutet sind.
- Phönix-Soda kostet im Koop 1500 Punkte und belebt nicht selbst wieder.
- Jeder hat eigene Punkte; Atombombe und Zimmermann zahlen jedem Spieler aus. Waffen aus Kiste und Äther-Schmiede kann nur nehmen, wer bezahlt hat. Barrikaden bringen je Spieler und Runde höchstens 500 Punkte.
- Mehr Spieler bedeuten mehr Zombies pro Runde (Formel wie im Original).

**So funktioniert es:** Der Host berechnet Zombies, Runden, Power-Ups, Kiste, Türen, Bus, Baupläne und Quest und
verteilt den Stand an alle (Zombie-Momentaufnahmen 15-mal pro Sekunde über einen schnellen, ungesicherten Kanal).
Jedes Gerät steuert seinen eigenen Spieler, zeigt Treffer sofort an und meldet sie dem Host. Splitscreen nutzt
genau diese Koop-Logik: Jeder Bildausschnitt ist eine eigene Spielinstanz, verbunden über einen Raum im Speicher.

**Noch offen:** Projektile der Wunderwaffen anderer Spieler sind noch nicht sichtbar; man kann einer laufenden Partie nicht nachträglich beitreten; liegt das Spiel des Hosts
im Hintergrund-Tab, steht die Partie. Hinter sehr strengen Firewalls kann die Direktverbindung scheitern – dafür
lässt sich ein eigener TURN-Server angeben (`#turn=turn:host:3478|nutzer|passwort`, siehe `src/net/transport.js`).

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

## Android-App (APK)

Das Spiel gibt es auch als Android-App: eine schlanke Hülle (`android/`), die das gebaute Spiel
offline in einer WebView zeigt – im Vollbild, im Querformat, mit Bildschirm-wach-halten. OTTO und
der Ansager sprechen über die Android-Stimme, die Zurück-Taste pausiert das Spiel bzw. führt durch
die Menüs.

| Weg | So geht's |
|---|---|
| **Cloud (ohne PC)** | Jeder Push baut automatisch (Workflow „APK bauen“). APK unter **Actions → letzter Lauf → Artifacts → Nachtfall-APK** herunterladen, ZIP entpacken, `Nachtfall.apk` antippen und installieren. Von Hand starten: Actions → „APK bauen“ → *Run workflow*. |
| **Eigener Rechner** | `android/build-apk.sh` (braucht Node.js und das Android-SDK); die APK liegt danach als `Nachtfall.apk` im Projektordner. |

- **Feste Signatur:** Alle Builds sind mit demselben Schlüssel (`android/ci-signing.jks`) signiert.
  Neue Versionen lassen sich deshalb einfach über die alte installieren; Speicherstände
  (Einstellungen, Rekorde, Bank, Schließfach) bleiben erhalten.
- Beim ersten Installieren fragt Android, ob der Browser bzw. Dateimanager „unbekannte Apps“
  installieren darf – das einmal erlauben.

## Steuerung

| Aktion | Tastatur & Maus | Controller (Xbox / PlayStation) | Touch |
|---|---|---|---|
| Bewegen | W A S D | Linker Stick | Joystick links (erscheint unter dem Daumen) |
| Umsehen | Maus / Pfeiltasten | Rechter Stick | Rechte Bildschirmhälfte wischen |
| Schießen | Linke Maustaste | RT / R2 | Feuerknopf (halten + ziehen zum Nachzielen) |
| Zielen | Rechte Maustaste | LT / L2 | Zielfernrohr-Knopf (an/aus) |
| Sprinten | Shift | Linken Stick drücken | Joystick ganz nach vorne |
| Springen / Ducken | Leertaste / C | A ✕ / B ○ | Knöpfe |
| Hechtsprung | im Sprint C | im Sprint B ○ | im Sprint „Ducken“ |
| Nachladen | R | X ▢ | Knopf |
| Kaufen / Benutzen | F (halten: reparieren) | X ▢ (wenn etwas in Reichweite ist) | „Benutzen“-Knopf erscheint automatisch |
| Messer / Granate | V / G | R3 oder LB / RB | Knöpfe |
| Waffe wechseln | 1 / 2 / Q / Mausrad | Y △ / Steuerkreuz | Knopf |
| Pause | Esc | Start / Options | Pause-Knopf |

## Was schon drin ist

**Im Stil von Black Ops 2**
- Zombies als verrottete Menschen: gebeugt, mit eingefallenem Schädel, leuchtenden Augen (mit Leuchtspur), offenem Mund, Krallenhänden und zerrissener, blutiger Kleidung; Varianten wie Koch, Büroangestellter, Bauarbeiter
- Zerstückelung: Köpfe platzen, Unterarme lassen sich abschießen, Explosionen reißen Beine ab – die Zombies kriechen weiter („Kriecher“). Explosionen und der Bus schleudern Körper durch die Luft, der Gewitter-Werfer lässt sie unter Strom zucken
- HUD wie im Original: Kreide-Strichliste und handgemalte rote Rundenzahlen, die beim Rundenende weiß-rot pulsieren; Intro mit Ort und Uhrzeit auf der Schreibmaschine; Perk-Kronkorken; Blut am Bildschirmrand; keine Trefferanzeige (in den Einstellungen zuschaltbar)
- Waffen in der Hand wie im Original: detaillierte Modelle (abgegriffene Kanten, Holzmaserung, Kratzer), schmutzige Hände mit fingerlosen Handschuhen und hochgekrempelten Ärmeln, Waffe groß unten rechts im Bild
- Nachladen mit echten Handgriffen: Magazin raus/rein, Schlitten oder Spannhebel bei leerem Magazin, Pumpgun Patrone für Patrone, Doppellauf abkippen, MG-Deckel und Trommel; beim ersten Ziehen jeder Waffe eine kurze Vorführ-Animation
- Hülsen fliegen aus dem Auswurf und klimpern auf dem Boden, Mündungsfeuer mit Seitenflammen, Rauch aus dem Lauf, Messer-Ausfallschritt, Granate mit Splint, Perk-Flasche mit Kronkorken
- Last Stand: Am Boden schleppst du dich mit der Pistole weiter (eigene, sonst eine Leihwaffe), ein Ring zeigt die Wiederbelebung; danach kommt die vorige Waffe zurück. Nach dem Tod steigt die Kamera über den Körper auf
- Atmosphäre: Feuertonnen mit Flammen, Asche und Glut rieseln im Freien, kontrastreiche Farbstimmung
- Musik-Easter-Egg auf beiden Karten (Station Nachtfall: drei versteckte Teddys)
- Spielregeln nach den öffentlich dokumentierten Formeln der Treyarch-Zombies nachgebaut:
  - Zombies: 150 Lebenspunkte in Runde 1, +100 je Runde bis Runde 9, danach ×1,1; Anzahl 24 + Bonus (die ersten fünf Runden 25–90 %), höchstens 24 gleichzeitig; Spawn-Pause 2 s × 0,95 je Runde; Tempo-Würfel (Runde × 4 … +35) für Geher/Läufer/Sprinter
  - Punkte: 10 je Treffer, Kill 50 + Zonenbonus (Gliedmaßen 50, Rumpf 60, Kopf 100, Messer 130), Explosionen 50, Barrikaden höchstens 500 je Runde
  - Power-Ups: Drop, sobald die verdienten Punkte eine Schwelle überschreiten (2000, dann jeweils ×1,14), dazu 3 % Zufall, höchstens 4 je Runde; gemischter Zyklus; 15 s ruhig, dann immer schneller blinkend, nach 26,5 s weg; neu: **Ausverkauf** (30 s lang steht an jedem Kistenplatz eine Kiste für 10 Punkte)
  - Zufallskiste: Teddy frühestens bei der 4. Benutzung (15 %), am Startplatz spätestens bei der 8., nach dem ersten Umzug 30 % bzw. ab der 13. Benutzung 50 %; Punkte zurück
  - Perks: höchstens vier; Phönix-Soda belebt solo nach 10 s wieder – nach dem dritten Mal zieht der Automat weiter; Blitz-Tonikum beschleunigt auch das Reparieren
  - Wandwaffen sind Kreidezeichnungen – nach dem ersten Kauf wird daraus in einer Kreidestaubwolke die echte Waffe an der Wand
  - Ab Runde 4 sprintet der letzte Zombie einer Runde – außer er hat keine Beine mehr (Kriecher)
  - Hechtsprung aus dem Sprint (Ducken drücken): flach nach vorn, kurz liegen bleiben – wer vor einem Perk-Automaten landet, findet einmalig 100 Punkte

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
- Viewmodel: Arme mit IK an der Waffe, Animations-Zeitachsen je Waffe, Laufen, Atmen, Sway, Sprint-Haltung, Rückstoß, Nachladen, Ziehen, Messer, Granate, Perk-Trinken

**Sound** (vollständig synthetisiert, Web Audio API, HRTF-3D)
- Waffensounds je Waffenklasse in Schichten (Knall, Körper, Tiefdruck, Verschluss, Raumecho), PaP-Variante; Nachlade-Geräusche synchron zur Animation, Hülsen-Klimpern
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
  player/              Bewegung, Kamera, Gesundheit, Perks; Spielfiguren der Mitspieler (Modell, Atlas, Animation)
  game/                Spiel-Loop, Runden, Interaktionen, Power-Ups, Überlebende (Koop); Linie 13: Bus, Baupläne, Gefahren, Quest, Bank
  net/                 Koop: Verbindung (WebRTC über Trystero, BroadcastChannel, Speicher), Lobby, Sitzung mit Host-Autorität
  audio/               Prozedurales Sound-Design
  ui/                  HUD, Touch-Steuerung, Splitscreen
public/                App-Manifest, Service Worker (offline), Icons
android/               Android-App (WebView-Hülle, Gradle-Projekt, fester Signaturschlüssel)
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
- **Funkenmann:** Messer! Drei Treffer (mit dem Jagdmesser zwei). Sitzt er auf dem Busdach, vertreiben ihn etwa zwölf Treffer oder er springt nach 16 Sekunden ab. Belohnung: 500 Punkte und ein Power-Up.
- **Station Nachtfall – Lied:** drei Teddys drücken – oben auf dem Kistenstapel in der Depot-Halle, auf der Diner-Theke und auf dem Generator in der Werkstatt.
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
3. **Koop ausbauen:** Online-Koop und Splitscreen gibt es schon (siehe oben). Als Nächstes:
   Gesichtsanimation und eigene Sprüche der Figuren, späteres Dazustoßen, Host-Wechsel, wenn der Host geht, und Sprach-Chat.
4. **Mehr Inhalt:** weitere Karten (z. B. eine Gefängnisinsel oder eine Stadt im Ausnahmezustand),
   Höllenhund-Runden, weitere Spezialgegner, Spielfiguren mit eigenen Sprüchen, Rangsystem und Statistiken.
5. **Verbesserungen ggü. BO2:** Barrierefreiheit (Farbfilter, frei belegbare Tasten; Untertitel gibt es
   schon), Speichern zwischen Runden, Mod-Support über die Kartendefinitionen.
6. **App-Stores & Konsolen:** Eine Android-App (APK) wird bereits automatisch gebaut (siehe oben);
   für Google Play fehlt noch ein Store-Paket (AAB) mit eigenem Upload-Schlüssel, für iPhone eine
   Xcode-Hülle, für Steam z. B. Electron oder Tauri. PlayStation, Xbox und Nintendo verlangen offizielle
   Entwicklerverträge und Dev-Kits – ein Browser-Spiel kann dort nicht direkt veröffentlicht werden.
   Im Browser einer Konsole (z. B. Edge auf der Xbox) sollte es mit Controller laufen; das ist ungetestet.
