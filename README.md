# Notizbuch

Persönliches Notizbuch nach dem Vorbild von Notability, für iPad mit Apple Pencil und Windows-PC.
Web-App (PWA), läuft komplett offline, alle Daten bleiben auf dem Gerät. Bauplan: siehe `BAUPLAN.md`.

## Stand: Bauschritt 1 (Version 0.1.0)
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
| `sw.js` | Offline (Service Worker) |

## Datenmodell (IndexedDB „notizbuch“)
- `folders`: `{id, name, color, parentId, sort, system?, createdAt, updatedAt}` (`system: 'todo'` = Eingang)
- `notes`: `{id, folderId, title, pageIds[], createdAt, updatedAt, thumbAt?}`
- `pages`: `{id, noteId, w: 1000, h: 1414, paper, strokes[], objects[]}`, A4 hochkant in Seiten-Einheiten
  - Strich: `{id, t: 'pen'|'marker', c: '#farbe', w: stärke, pts: [x, y, druck, x, y, druck, …]}`
  - `objects[]`: für Bilder, PDF-Seiten, Sanitär-Symbole, Textfelder (ab Schritt 2/3)
- `thumbs`: `{noteId, blob}` Vorschaubild, `files`: `{id, blob, …}` für PDFs/Fotos (ab Schritt 2), `meta`

## Neue Version veröffentlichen
1. `VERSION` in `js/util.js` **und** `sw.js` erhöhen (sonst bekommen installierte Geräte die Änderung nicht).
2. Test: `node test/smoke.mjs` (braucht Playwright).
3. Auf GitHub pushen; GitHub Pages veröffentlicht automatisch.

## Lokal starten
```bash
python3 -m http.server 8000
```
Dann http://localhost:8000 öffnen. (Offline-Modus/Service Worker nur über https oder localhost.)
