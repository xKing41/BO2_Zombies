# NACHTFALL – Zombies

Ein rundenbasierter 3D-Zombie-Survival-Shooter im Geist von *Call of Duty: Black Ops 2 – Zombies*,
komplett neu entwickelt: eigene Karte, eigene Waffen, eigene Perks, eigener Sound.
Läuft direkt im Browser (Three.js / WebGL2), ohne externe Assets – alle Texturen, Modelle,
Animationen und Sounds werden prozedural im Code erzeugt.

> **Rechtlicher Hinweis:** Dies ist ein eigenständiges Fan-Projekt. Es verwendet **keine**
> Inhalte, Namen, Modelle, Sounds oder Musik von Activision/Treyarch. Perks, Waffen, Karte und
> die Pack-a-Punch-Entsprechung („Äther-Schmiede“) sind eigene Schöpfungen.

## Starten

```bash
npm install
npm run dev        # Entwicklungsserver → http://localhost:5173
npm run build      # Produktions-Build nach dist/
npm run preview    # Build lokal testen
```

Benötigt einen aktuellen Desktop-Browser mit WebGL2 (Chrome, Edge, Firefox). Maus + Tastatur.

## Steuerung

| Taste | Aktion |
|---|---|
| W A S D | Bewegen |
| Maus | Umsehen |
| Linke / Rechte Maustaste | Schießen / Zielen (ADS) |
| Shift | Sprinten |
| Leertaste | Springen |
| C / Strg | Ducken |
| R | Nachladen |
| F | Kaufen / Interagieren (halten: Barrikade reparieren) |
| V / Maus 4 | Messer |
| G | Granate |
| 1 / 2 / Q / Mausrad | Waffe wechseln |
| Esc | Pause |

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
  ui/                  HUD
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
5. **Verbesserungen ggü. BO2:** Controller-Support, Barrierefreiheit (Untertitel, Farbfilter),
   Speichern zwischen Runden, Mod-Support über die Konfigurationsdatei.
