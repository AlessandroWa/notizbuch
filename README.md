# Notizbuch

Persönliches Notizbuch nach dem Vorbild von Notability, für iPad mit Apple Pencil und Windows-PC.
Web-App (PWA), läuft komplett offline, alle Daten bleiben auf dem Gerät. Bauplan: siehe `BAUPLAN.md`.

## Stand: Version 0.5.0

### Neu in 0.5.0: OneDrive-Abgleich
- Alles wird im OneDrive-Ordner **„Notizbuch“** gespeichert: `index.json` (Ordner), `notizen/<id>.json` (je Notiz),
  `dateien/<id>` (PDFs, Fotos).
- Hochladen wenige Sekunden nach jeder Änderung, offline gesammelt bis wieder Netz da ist.
  Holen beim Start, beim Zurückkehren in die App und alle 5 Minuten.
- Konflikt (gleiche Notiz auf zwei Geräten offline geändert): neuere gewinnt, ältere bleibt als „(Konflikt)“.
- Gelöscht wird auf anderen Geräten nur, wenn in der App gelöscht wurde; fehlt eine Datei in OneDrive, wird sie neu hochgeladen.
- Statuszeile unten in der Seitenleiste, Einstellungen › OneDrive-Abgleich.

### Einrichtung OneDrive (einmalig, im Microsoft-Konto der Firma)
1. https://entra.microsoft.com › Anwendungen › App-Registrierungen › **Neue Registrierung**
2. Name `Notizbuch`, Kontotyp **Nur Konten in diesem Organisationsverzeichnis**
3. Umleitungs-URI: Plattform **Single-Page-Anwendung (SPA)**, `https://alessandrowa.github.io/notizbuch/`
4. API-Berechtigungen › Microsoft Graph › Delegiert: `Files.ReadWrite`, `offline_access` (`User.Read` ist schon da),
   ggf. **Administratorzustimmung erteilen**
5. Die **Anwendungs-ID (Client)** in der App unter Einstellungen › OneDrive-Abgleich › Einrichtung eintragen
   (oder fest in `js/sync.js`, `STANDARD_CLIENT_ID`). Mandant ist `marmor-walz.de`.
6. „Bei OneDrive anmelden“. Microsoft hält Web-Apps nur 24 h angemeldet, danach ggf. kurz neu anmelden.


### Neu in 0.4.0
- **Vorlage „Beratungsgespräch“** (Neu › Vorlage): Kunde, Adresse, Telefon/E-Mail, Worum geht es, Interesse,
  Material/Formate, Nächster Schritt, darunter freie Fläche.
- **Begradigen**: Stift am Ende des Strichs kurz ruhig halten → gerade Linie (rastet bei 0/45/90°), weiterziehen verlängert.
- **Badewanne** als Symbol (170 × 75 cm).
- **Zoom**: zwei Finger (bis 500 %), am PC Strg + Mausrad; Knopf unten links setzt auf 100 % zurück.
  Seiten werden dafür in Kacheln gezeichnet, nur sichtbare Kacheln belegen Speicher; PDFs bleiben scharf.
- **Fotos einfügen** (Kamera oder Mediathek), verkleinert auf max. 2000 px, verschieben/größer/drehen, darauf schreiben.
- **Lasso**: Handschrift und Objekte einkreisen, verschieben, duplizieren, löschen.
- **Textfelder**: Werkzeug „T“, auf die Seite tippen; ausgewählten Text nochmal antippen = ändern.
- **PDF-Export** (Knopf oben rechts im Editor oder „⋯“ an der Notiz): jede Seite als Bild mit 200 dpi.

### Neu in 0.3.0 (Bauschritt 3, Teil 1: Badskizzen)
- Sanitär-Symbole als Vektor (Draufsicht): WC wandhängend, Waschbecken, Doppel-WT, Urinal, Duschtasse,
  Dusche mit Rinne (Rinne bleibt an der Schmalseite). Echte Größen im Maßstab (Standard 1:20, je Seite 1:10/20/25/50).
- Auswählen: verschieben (rastet am Raster ein), Ecken ziehen = Größe, Punkt = frei drehen (rastet bei 90°),
  Leiste: 90°, Spiegeln, Duplizieren, Maße in cm, Löschen. Rückgängig/Wiederholen. Radierer löscht keine Objekte.
- Linie (rastet bei 0/45/90°), Rechteck, Maßlinie mit automatischer Länge in m/cm.
- Aussehen: Anthrazit aus dem WALZ-Logo (#424041), Firmenlogo oben links, gedämpfte Ordnerfarben
  (vorhandene Ordner werden automatisch umgestellt).

### Neu in 0.2.0 (Bauschritt 2, Teil 1)
- **Aus Notability übernehmen** (Einstellungen): ZIP des OneDrive-Ordners „Notability“ oder einzelne PDFs.
  Ordner werden 1:1 angelegt bzw. mit vorhandenen zusammengeführt, jede PDF wird eine Notiz.
  Schon übernommene Notizen werden übersprungen, d. h. man kann jederzeit nachholen.
- PDF-Seiten anzeigen und darauf schreiben/markieren (pdf.js, liegt in `vendor/`, läuft offline).
- Mehrere Seiten pro Notiz untereinander, „Neue Seite“ am Ende, Anzeige „Seite x von y“.
  Nur sichtbare Seiten belegen Speicher.
- „Neu › PDF importieren“ im gerade offenen Ordner.
- Sicherung jetzt als **ZIP** (inkl. PDFs). Alte JSON-Sicherungen lassen sich weiter laden.

### Bauschritt 1 (0.1.0)
- Installierbar (iPad: Safari › Teilen › „Zum Home-Bildschirm“, PC: Edge/Chrome › „App installieren“), startet offline.
- Seitenleiste mit Ordnern: anlegen, umbenennen, färben, verschieben, löschen, beliebig tief.
- To Do als Eingang. „Neu“ legt die Notiz im gerade offenen Ordner an.
- Notiz mit Stift schreiben (Technik aus `stift-test.html`): Stift, Textmarker, Radierer (ganze Striche),
  6 Farben, 3 Stärken, Rückgängig/Wiederholen, Papier liniert/kariert/blanko/Millimeter, „Nur Stift“
  (Finger blättert mit Schwung, schreibt nicht). Speichert automatisch.
- Vorschaukarten (erste Seite, Titel, Datum, neueste zuerst), Suche über Titel und Ordnernamen.
- Einstellungen: Sicherung exportieren/laden (eine JSON-Datei), Speicherstatus.

## Technik
Reines HTML/CSS/JavaScript (ES-Module), kein Framework, kein Build. Hosting: GitHub Pages.

| Datei | Inhalt |
|---|---|
| `index.html`, `app.css` | Grundgerüst, Aussehen |
| `js/main.js` | Oberfläche, Navigation (`#/ordner/…`, `#/notiz/…`, `#/suche/…`, `#/einstellungen`) |
| `js/editor.js` | Schreiben mit dem Stift |
| `js/ink.js` | Papier und Striche zeichnen, Radierer-Treffer, Vorschaubild |
| `js/store.js` | Datenmodell (Ordner, Notizen, Seiten) |
| `js/db.js` | IndexedDB |
| `js/backup.js` | Sicherung als eine Datei |
| `js/pdf.js` | PDF-Seiten zeichnen (pdf.js) |
| `js/import.js` | Übernahme aus Notability (ZIP/PDF) |
| `js/zip.js` | ZIP lesen/schreiben (ohne Fremdbibliothek) |
| `js/vorschau.js` | Vorschaubild der ersten Seite |
| `js/vorlagen.js` | Vorlagen (Beratungsgespräch) |
| `js/pdfexport.js` | Notiz als PDF |
| `js/sync.js` | OneDrive-Abgleich (Anmeldung, Microsoft Graph) |
| `js/objekte.js` | Sanitär-Symbole, Linien, Rechtecke, Maße: zeichnen, treffen, einrasten |
| `vendor/pdfjs/` | pdf.js 4.10.38 (Mozilla, Apache 2.0) |
| `sw.js` | Offline (Service Worker) |

## Datenmodell (IndexedDB „notizbuch“)
- `folders`: `{id, name, color, parentId, sort, system?, createdAt, updatedAt}` (`system: 'todo'` = Eingang)
- `notes`: `{id, folderId, title, pageIds[], fileIds?[], quelle?, createdAt, updatedAt, thumbAt?}` (`quelle` = Pfad im Notability-Export, verhindert Doppel-Import)
- `pages`: `{id, noteId, w: 1000, h, paper, bg?, strokes[], objects[]}`, Breite immer 1000 Einheiten (A4 hoch: h = 1414)
  - `bg`: `{art: 'pdf', fileId, seite}` = PDF-Seite als Hintergrund
  - Strich: `{id, t: 'pen'|'marker', c: '#farbe', w: stärke, pts: [x, y, druck, x, y, druck, …]}`
  - `objects[]`: Kasten `{id, typ: 'symbol'|'rechteck'|'bild'|'text', art?, x, y (Mitte), w, h, rot, spiegel, fileId?, text?, gr?}` oder
    Linie `{id, typ: 'linie'|'mass', x1, y1, x2, y2, c, lw}`; später auch Bilder und Textfelder
  - `massstab`: 10/20/25/50 (Standard 20)
- Notiz zusätzlich `syncAt` (letzte Änderung für den Abgleich); `meta`: `geloescht` (Grabsteine), `syncstand`, `onedrive` (Anmeldung)
- `thumbs`: `{noteId, blob}` Vorschaubild, `files`: `{id, noteId, name, type, blob}` PDFs (später Fotos), `meta`

## Neue Version veröffentlichen
1. `VERSION` in `js/util.js` **und** `sw.js` erhöhen (sonst bekommen installierte Geräte die Änderung nicht).
2. Tests: `node test/smoke.mjs`, `node test/import.mjs`, `node test/skizze.mjs`, `node test/funktionen.mjs`, `node test/onedrive.mjs`, `node test/ziehen.mjs` (brauchen Playwright; OneDrive wird im Test nachgestellt).
3. Auf GitHub pushen; GitHub Pages veröffentlicht automatisch.

## Lokal starten
```bash
python3 -m http.server 8000
```
Dann http://localhost:8000 öffnen. (Offline-Modus/Service Worker nur über https oder localhost.)
