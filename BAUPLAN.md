# Bauplan: Persönliches Notizbuch (Notability-Ersatz)

Stand: 20.11.2026 · Eigenständige Web-App (PWA) für iPad und Windows-PC.

## Ziel
Ein Notizbuch, das sich beim Schreiben mit dem Apple Pencil anfühlt wie Notability (Stifttest am 20.11.2026 bestanden, siehe `stift-test.html`) und auf zwei Dinge zugeschnitten ist: Notizen und Zeichnungen in Beratungsgesprächen und alle Unterlagen eines Bauvorhabens griffbereit auf der Baustelle.

## Wofür die App genutzt wird
1. **Beratungsgespräche**: Notizen zu Kunde, Adresse, Interesse an Fliesen und Material, worum es geht.
2. **Zeichnungen und Skizzen** bei Beratungen und Vor-Ort-Terminen, z. B. ein Badezimmer als Grundlage für ein Angebot.
3. **Unterlagen-Ablage für die Baustelle**: Eingangsrechnungen, Besprechungen mit dem Bauträger, Pläne, Mehrpreisangebote je Wohnung usw. als PDF oder Foto im Projektordner, damit vor Ort alles dabei ist.

## Technische Eckpunkte (entschieden)
- Web-App als PWA: iPad über Safari „Zum Home-Bildschirm“, PC über Edge/Chrome installiert.
- **Läuft vollständig offline** (Service Worker); alle Notizen und Unterlagen liegen auf dem Gerät.
- Kein eigener Server, kein Apple-Entwicklerkonto. Hosting kostenlos über GitHub Pages (Code öffentlich, Notizen nicht).
- Speicherung lokal (IndexedDB, `navigator.storage.persist()` anfordern), später Sync über einen Cloudspeicher.
- Stift: Pointer Events mit Druckstärke, `getCoalescedEvents`, `getPredictedEvents`, Canvas mit `desynchronized: true`, „Nur Stift“-Modus (Finger/Handballen zeichnet nicht). Vorlage: `stift-test.html`.
- Handschrift als Vektor-Striche speichern (nicht als Bild).
- Datenmodell von Anfang an so, dass auf einer Seite neben Strichen auch Objekte liegen können (Sanitär-Symbole, Bilder, PDF-Seiten als Hintergrund, Textfelder).
- Offen: Cloud für Sync (Empfehlung OneDrive, Alternativen Dropbox, Google Drive; iCloud geht für Web-Apps nicht).

## Aufbau (wie heute in Notability, Screenshot liegt vor)
Seitenleiste links (dunkel):
- Einstellungen, Suche, Galerie (alle Fotos aus allen Notizen)
- **To Do**: Eingang für frisch erstellte, noch nicht einsortierte Notizen
- Hauptordner: **Auftrag**, **Offen** (laufende Angebote ohne Auftrag), **Abgeschlossene BV**
- Themenordner: Whirlpools, Team-Meeting, Ablage, Ausstellung, Mitarbeiter, Privat, Ecommerce
- Ordner frei anlegbar, mit Farbpunkt, beliebig tief verschachtelt (z. B. Auftrag › BV Musterweg › Whg 1)

Ordneransicht rechts:
- Großer Ordnertitel, darunter Unterordner als Kacheln (Farbpunkt, Name, „3 Notizen“)
- Darunter Notizen als Vorschaukarten mit erster Seite, Titel und Datum, neueste zuerst
- Button „Neu“ oben rechts: neue Notiz (mit Vorlagenwahl), PDF importieren, Foto importieren

## Notizen
- Seiten im Hochformat, Papier liniert, kariert, blanko oder Millimeterraster
- Stift, Textmarker, Radierer (ganze Striche), Farben, Strichstärken, Rückgängig/Wiederholen
- Lasso: Striche markieren, verschieben, löschen
- Fotos einfügen (Kamera oder Fotomediathek), mit Stift beschriften
- PDFs importieren und darauf schreiben und markieren (pdf.js)
- Textfelder, mehrere Seiten pro Notiz, Export als PDF

## Sanitär-Symbole für Badskizzen
Symbolleiste beim Zeichnen, Symbol antippen, erscheint in der Zeichnung. Grundriss-Symbole in Draufsicht als Vektor:
- WC, Einzelwaschbecken, Doppelwaschbecken, Urinal, Duschtasse, Dusche mit Rinne an der kurzen Seite

Bedienung: verschieben, drehen (90°-Schritte und frei), spiegeln, Größe ändern, duplizieren, löschen. Duschtasse und Dusche mit Rinne in Breite und Länge frei veränderbar, die Rinne bleibt immer an der Schmalseite. Symbole sind eigene Objekte; der Strich-Radierer löscht sie nicht. Später: Maßstab (z. B. 1:20), weitere Symbole (Badewanne, Heizkörper, Tür, Fenster).

## Skizzen-Werkzeuge
Gerade Linie (Strich kurz halten, wird begradigt), Rechteck, Maßlinie mit Beschriftung, Raster zum Einrasten.

## Vorlagen (wenige)
- **Beratungsgespräch**: Kunde, Adresse, Telefon, Interesse, Material/Formate, nächster Schritt, darunter freie Fläche
- **Badskizze**: Millimeterraster, Kopfzeile Kunde und Raum, Symbolleiste offen
- Beliebige Notiz als eigene Vorlage speichern

## Weitere Funktionen
- Status-Weg: Projektordner per Knopf von Offen → Auftrag → Abgeschlossene BV verschieben, mit allen Unterordnern
- Schnelleingang: „Neue Notiz“ landet in To Do, später einsortieren per Ziehen oder „Verschieben nach“
- Suche über Titel, getippten Text, Ordnernamen und PDF-Text; später auch Handschrift

## Bauschritte (nach jedem Schritt Test auf dem iPad)
1. **Grundgerüst**: installierbare, offline lauffähige PWA, Seitenleiste, Ordner/Unterordner anlegen, umbenennen, färben, verschieben, To-Do-Eingang, Notiz mit Stift schreiben und speichern, Vorschaukarten, Sicherung exportieren/importieren (eine Datei).
2. **Unterlagen**: PDFs und Fotos importieren und beschriften, mehrere Seiten, Papierarten, Lasso, Textfelder, PDF-Export.
3. **Badskizzen**: Sanitär-Symbole, Linie, Rechteck, Maßlinie, Vorlagen.
4. **Sync** über die gewählte Cloud.
5. **Suche und Galerie**.
6. **Umzug aus Notability**: Notizen als PDF exportieren und importieren.
