# Notizbuch

Persönliches Notizbuch nach dem Vorbild von Notability, für iPad mit Apple Pencil und Windows-PC.
Web-App (PWA), läuft komplett offline, alle Daten bleiben auf dem Gerät. Bauplan: siehe `BAUPLAN.md`.

## Stand: Version 0.2.0

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
| `vendor/pdfjs/` | pdf.js 4.10.38 (Mozilla, Apache 2.0) |
| `sw.js` | Offline (Service Worker) |

## Datenmodell (IndexedDB „notizbuch“)
- `folders`: `{id, name, color, parentId, sort, system?, createdAt, updatedAt}` (`system: 'todo'` = Eingang)
- `notes`: `{id, folderId, title, pageIds[], fileIds?[], quelle?, createdAt, updatedAt, thumbAt?}` (`quelle` = Pfad im Notability-Export, verhindert Doppel-Import)
- `pages`: `{id, noteId, w: 1000, h, paper, bg?, strokes[], objects[]}`, Breite immer 1000 Einheiten (A4 hoch: h = 1414)
  - `bg`: `{art: 'pdf', fileId, seite}` = PDF-Seite als Hintergrund
  - Strich: `{id, t: 'pen'|'marker', c: '#farbe', w: stärke, pts: [x, y, druck, x, y, druck, …]}`
  - `objects[]`: für Bilder, PDF-Seiten, Sanitär-Symbole, Textfelder (ab Schritt 2/3)
- `thumbs`: `{noteId, blob}` Vorschaubild, `files`: `{id, noteId, name, type, blob}` PDFs (später Fotos), `meta`

## Neue Version veröffentlichen
1. `VERSION` in `js/util.js` **und** `sw.js` erhöhen (sonst bekommen installierte Geräte die Änderung nicht).
2. Tests: `node test/smoke.mjs` und `node test/import.mjs` (brauchen Playwright).
3. Auf GitHub pushen; GitHub Pages veröffentlicht automatisch.

## Lokal starten
```bash
python3 -m http.server 8000
```
Dann http://localhost:8000 öffnen. (Offline-Modus/Service Worker nur über https oder localhost.)
