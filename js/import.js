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

// Zielordner für eine neue Notiz aus Notability-Ordner "pfad":
// 1. dorthin, wo ihre Geschwister (andere Notizen aus demselben Notability-Ordner) jetzt liegen
// 2. sonst in einen Ordner mit genau diesem Namen, wenn es ihn nur einmal gibt (z. B. ein verschobenes BV)
// 3. sonst nach dem Notability-Pfad (Ordner werden bei Bedarf angelegt)
async function zielFuer(pfad, orte) {
  if (!pfad.length) return store.todoId();
  const da = orte.get(pfad.join('/').normalize('NFC'));
  if (da) {
    const [id] = [...da.entries()].filter(([fid]) => store.folder(fid)).sort((a, b) => b[1] - a[1])[0] || [];
    if (id) return id;
  }
  const name = pfad.at(-1).toLocaleLowerCase('de');
  const gleich = [...store.state.folders.values()].filter(f => f.name.toLocaleLowerCase('de') === name);
  if (gleich.length === 1 && pfad.length > 1) return gleich[0].id;
  return store.ordnerPfad(null, pfad);
}

// Interne Notability-Dateien, keine Notizen
const MUELL = /^NBMetadataCache$/i;

// Schlüssel für "schon übernommen": genauer Pfad im Notability-Export, ohne Hüllordner
const schluessel = quelle => notabilityPfad(quelle).join('/').normalize('NFC');

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
        if (MUELL.test(ohneEndung(teile.at(-1)))) continue;
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

  const erg = { notizen: 0, ordnerVorher: store.state.folders.size, uebersprungen: 0, fehler: [], neu: [], gesamt: auftraege.length, letzte: null };
  // Wo liegen die Notizen aus einem Notability-Ordner jetzt? (nach eigenem Umsortieren)
  const orte = new Map(); // Notability-Ordnerpfad -> Map(folderId -> Anzahl)
  const merkeOrt = (quelle, folderId) => {
    const k = notabilityPfad(quelle).slice(0, -1).join('/').normalize('NFC');
    if (!orte.has(k)) orte.set(k, new Map());
    orte.get(k).set(folderId, (orte.get(k).get(folderId) || 0) + 1);
  };
  for (const n of store.state.notes.values()) if (n.quelle?.startsWith('notability:')) merkeOrt(n.quelle, n.folderId);
  const vorhanden = new Set([...store.state.notes.values()].filter(n => n.quelle?.startsWith('notability:')).map(n => schluessel(n.quelle)));
  // Während des Imports nicht in den Ruhezustand gehen (sonst bricht er ab)
  let wach = null;
  try { wach = await navigator.wakeLock?.request('screen'); } catch { /* nicht unterstützt */ }
  try {
  for (let i = 0; i < auftraege.length; i++) {
    const a = auftraege[i];
    melde(`PDF ${i + 1} von ${auftraege.length}`, i / auftraege.length, (a.pfad ? a.pfad.join(' › ') + ' › ' : '') + a.titel);
    if (a.quelle && vorhanden.has(schluessel(a.quelle))) { erg.uebersprungen++; continue; }
    try {
      const folderId = a.pfad ? await zielFuer(a.pfad, orte) : zielOrdner;
      const blob = await a.blob();
      const { seiten, doc } = await seitenInfo(blob);
      try {
        const { note, pages } = await store.createPdfNote({ folderId, title: a.titel, blob, seiten, datum: a.datum, quelle: a.quelle });
        const vorschau = await makeThumb(pages[0], 420, doc);
        await store.saveThumb(note.id, vorschau);
        erg.letzte = note.id;
      } finally { doc.destroy(); }
      erg.notizen++;
      if (a.quelle) { vorhanden.add(schluessel(a.quelle)); merkeOrt(a.quelle, folderId); }
      erg.neu.push((a.pfad?.length ? a.pfad.join(' › ') + ' › ' : '') + a.titel);
    } catch (err) {
      console.error(err);
      erg.fehler.push(`${(a.pfad?.length ? a.pfad.join(' › ') + ' › ' : '') + a.titel}: ${err.message || err}`);
    }
  }
  // Früher übernommene interne Notability-Dateien (NBMetadataCache) ohne eigene Notizen entfernen
  for (const n of [...store.state.notes.values()]) {
    if (!n.quelle?.startsWith('notability:') || !MUELL.test(ohneEndung(notabilityPfad(n.quelle).at(-1)))) continue;
    const pages = await store.loadPages(n);
    if (!pages.some(p => p.strokes.length || (p.objects || []).length)) await store.deleteNote(n.id);
  }
  } finally { wach?.release().catch(() => {}); }
  erg.ordner = store.state.folders.size - erg.ordnerVorher;
  return erg;
}

// ---------- Ordnung wie in Notability wiederherstellen ----------
// Jede übernommene Notiz kennt ihren Notability-Pfad ("quelle"). Damit wird sie an ihren Platz
// zurückgelegt, auch wenn sie inzwischen verschoben wurde. Doppelte ohne eigene Handschrift fallen weg,
// leer gewordene Ordner werden aufgeräumt (die Startordner wie "Auftrag" bleiben).
const HUELLE = /^(notability|onedrive)/i;
export function notabilityPfad(quelle) {
  let t = quelle.slice('notability:'.length).split('/').filter(Boolean);
  while (t.length > 1 && HUELLE.test(t[0])) t = t.slice(1);
  return t; // [Ordner …, Dateiname]
}

export async function ordnungWiederherstellen(melde = () => {}) {
  let notes = [...store.state.notes.values()].filter(n => n.quelle?.startsWith('notability:'));
  let muell = 0;
  for (const n of notes) {
    if (!MUELL.test(ohneEndung(notabilityPfad(n.quelle).at(-1)))) continue;
    const pages = await store.loadPages(n);
    if (!pages.some(p => p.strokes.length || (p.objects || []).length)) { await store.deleteNote(n.id); muell++; }
  }
  notes = notes.filter(n => store.note(n.id));
  const gruppen = new Map();
  for (const n of notes) {
    const k = schluessel(n.quelle);
    if (!gruppen.has(k)) gruppen.set(k, []);
    gruppen.get(k).push(n);
  }
  let verschoben = 0, doppelt = 0, i = 0;
  for (const liste of gruppen.values()) {
    melde(`Notiz ${++i} von ${gruppen.size}`, i / gruppen.size);
    const bewertet = [];
    for (const n of liste) {
      const pages = await store.loadPages(n);
      bewertet.push({ n, eigen: pages.reduce((s, p) => s + p.strokes.length + (p.objects || []).length, 0) });
    }
    bewertet.sort((a, b) => b.eigen - a.eigen || store.syncMarke(b.n) - store.syncMarke(a.n));
    const [behalte, ...rest] = bewertet;
    for (const r of rest) if (r.eigen === 0) { await store.deleteNote(r.n.id); doppelt++; }
    const pfad = notabilityPfad(behalte.n.quelle);
    const ziel = pfad.length > 1 ? await store.ordnerPfad(null, pfad.slice(0, -1)) : store.todoId();
    const quelle = 'notability:' + pfad.join('/');
    for (const r of [behalte, ...rest.filter(r => r.eigen > 0)]) {
      const n = store.note(r.n.id);
      if (n.folderId !== ziel || n.quelle !== quelle) {
        if (n.folderId !== ziel) verschoben++;
        await store.updateNote(n.id, { folderId: ziel, quelle }, { touch: false });
      }
    }
  }
  // Leere Ordner aufräumen; von jedem Startordner (Auftrag, Offen …) bleibt der erste oben stehen
  const bleiben = new Set();
  for (const name of store.START_NAMEN()) {
    const f = store.children(null).find(x => x.name.toLocaleLowerCase('de') === name.toLocaleLowerCase('de'));
    if (f) bleiben.add(f.id);
  }
  let weg = 0, nochmal = true;
  while (nochmal) {
    nochmal = false;
    for (const f of [...store.state.folders.values()]) {
      if (f.system || bleiben.has(f.id)) continue;
      if (!store.children(f.id).length && !store.notesIn(f.id).length) { await store.entferneLeer(f.id); weg++; nochmal = true; }
    }
  }
  return { notizen: notes.length - doppelt, verschoben, doppelt: doppelt + muell, weg };
}
