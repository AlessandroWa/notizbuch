// Import aus Notability: ZIP vom OneDrive-Ordner "Notability" (Ordner werden übernommen) oder einzelne PDFs.
import * as store from './store.js';
import { istZip, liesInhalt, eintragBlob } from './zip.js';
import { seitenInfo } from './pdf.js';
import { makeThumb } from './vorschau.js';

const istPdf = n => /\.pdf$/i.test(n);
const ohneEndung = n => n.replace(/\.pdf$/i, '');
const versteckt = teile => teile.some(t => t.startsWith('.') || t === '__MACOSX');

// dateien: FileList/Array. zielOrdner: Ordner für einzelne PDFs. melde(text, anteil, klein) für die Anzeige.
export async function importiere(dateien, zielOrdner, melde) {
  const auftraege = []; // {pfad: [ordner…], titel, datum, quelle, blob()}
  for (const d of dateien) {
    if (await istZip(d)) {
      melde('ZIP wird gelesen …', null, d.name);
      const eintraege = (await liesInhalt(d)).filter(e => !e.ordner && istPdf(e.name));
      for (const e of eintraege) {
        let teile = e.name.split('/').filter(Boolean);
        if (versteckt(teile)) continue;
        if (teile.length > 1 && teile[0].toLowerCase() === 'notability') teile = teile.slice(1);
        auftraege.push({
          pfad: teile.slice(0, -1), titel: ohneEndung(teile.at(-1)), datum: e.datum,
          quelle: 'notability:' + teile.join('/'), blob: () => eintragBlob(d, e, 'application/pdf'),
        });
      }
    } else if (istPdf(d.name) || d.type === 'application/pdf') {
      auftraege.push({ pfad: null, titel: ohneEndung(d.name), datum: d.lastModified || Date.now(), quelle: null, blob: async () => d });
    }
  }
  if (!auftraege.length) throw new Error('Keine PDF-Dateien gefunden.');

  const erg = { notizen: 0, ordnerVorher: store.state.folders.size, uebersprungen: 0, fehler: [], letzte: null };
  for (let i = 0; i < auftraege.length; i++) {
    const a = auftraege[i];
    melde(`PDF ${i + 1} von ${auftraege.length}`, i / auftraege.length, (a.pfad ? a.pfad.join(' › ') + ' › ' : '') + a.titel);
    if (a.quelle && store.noteMitQuelle(a.quelle)) { erg.uebersprungen++; continue; }
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
