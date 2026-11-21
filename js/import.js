// Import aus Notability: ZIP vom OneDrive-Ordner "Notability" (Ordner werden übernommen) oder einzelne PDFs.
import * as store from './store.js';
import { istZip, liesInhalt, eintragBlob } from './zip.js';
import { seitenInfo } from './pdf.js';
import { makeThumb } from './vorschau.js';

const istPdf = n => /\.pdf$/i.test(n);
const ohneEndung = n => n.replace(/\.pdf$/i, '');
const versteckt = teile => teile.some(t => t.startsWith('.') || t === '__MACOSX');

// Wie viele Ordner-Ebenen oben sind nur "Hülle" (z. B. "OneDrive_1_21-11-2026/Notability/")?
// Gemeinsame Ebenen über allen Dateien werden übersprungen, außer ein Name passt schon zu einem
// vorhandenen Hauptordner (z. B. "Auftrag"), dann wird dort einsortiert.
function huelle(pfade) {
  if (!pfade.length) return 0;
  const haupt = new Set(store.children(null).map(f => f.name.toLocaleLowerCase('de')));
  let n = 0;
  while (true) {
    const name = pfade[0][n];
    if (!name || pfade.some(t => t.length <= n + 1 || t[n] !== name)) break;
    if (haupt.has(name.toLocaleLowerCase('de'))) break;
    n++;
  }
  return n;
}

// Schon übernommen? (auch wenn ein früherer Import noch eine Hülle im Pfad hatte)
const schonDa = quelle => {
  const pfad = quelle.slice('notability:'.length);
  return [...store.state.notes.values()].some(n => n.quelle && (n.quelle === quelle || n.quelle.endsWith('/' + pfad)));
};

// dateien: FileList/Array. zielOrdner: Ordner für einzelne PDFs. melde(text, anteil, klein) für die Anzeige.
export async function importiere(dateien, zielOrdner, melde) {
  const auftraege = []; // {pfad: [ordner…], titel, datum, quelle, blob()}
  for (const d of dateien) {
    if (await istZip(d)) {
      melde('ZIP wird gelesen …', null, d.name);
      const eintraege = (await liesInhalt(d)).filter(e => !e.ordner && istPdf(e.name))
        .map(e => ({ e, teile: e.name.normalize('NFC').split('/').filter(Boolean) })) // Mac-ZIPs schreiben Umlaute zerlegt
        .filter(x => !versteckt(x.teile));
      const weg = huelle(eintraege.map(x => x.teile));
      for (const { e, teile: alle } of eintraege) {
        const teile = alle.slice(weg);
        auftraege.push({
          pfad: teile.slice(0, -1), titel: ohneEndung(teile.at(-1)), datum: e.datum,
          quelle: 'notability:' + teile.join('/'), blob: () => eintragBlob(d, e, 'application/pdf'),
        });
      }
    } else if (istPdf(d.name) || d.type === 'application/pdf') {
      auftraege.push({ pfad: null, titel: ohneEndung(d.name.normalize('NFC')), datum: d.lastModified || Date.now(), quelle: null, blob: async () => d });
    }
  }
  if (!auftraege.length) throw new Error('Keine PDF-Dateien gefunden.');

  const erg = { notizen: 0, ordnerVorher: store.state.folders.size, uebersprungen: 0, fehler: [], letzte: null };
  for (let i = 0; i < auftraege.length; i++) {
    const a = auftraege[i];
    melde(`PDF ${i + 1} von ${auftraege.length}`, i / auftraege.length, (a.pfad ? a.pfad.join(' › ') + ' › ' : '') + a.titel);
    if (a.quelle && schonDa(a.quelle)) { erg.uebersprungen++; continue; }
    try {
      const folderId = a.pfad ? (a.pfad.length ? await store.ordnerPfad(null, a.pfad) : store.todoId()) : zielOrdner;
      const blob = await a.blob();
      const { seiten, doc } = await seitenInfo(blob);
      try {
        const { note, pages } = await store.createPdfNote({ folderId, title: a.titel, blob, seiten, datum: a.datum, quelle: a.quelle });
        const vorschau = await makeThumb(pages[0], 420, doc);
        await store.saveThumb(note.id, vorschau);
        erg.letzte = note.id;
      } finally { doc.destroy(); }
      erg.notizen++;
    } catch (err) {
      console.error(err);
      erg.fehler.push(`${a.titel}: ${err.message || err}`);
    }
  }
  erg.ordner = store.state.folders.size - erg.ordnerVorher;
  return erg;
}
