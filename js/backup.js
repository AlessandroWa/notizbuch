// Sicherung: alles in EINE ZIP-Datei.
//   notizbuch.json  Ordner, Notizen, Seiten (Striche), Einstellungen
//   dateien/<id>    PDFs (und später Fotos)
//   vorschau/<id>.jpg  Vorschaubilder
// Ältere Sicherungen (eine JSON-Datei) lassen sich weiter laden.
import * as db from './db.js';
import { VERSION } from './util.js';
import { ZipSchreiber, istZip, liesInhalt, eintragBlob } from './zip.js';

const FORMAT = 'notizbuch-sicherung';
const urlZuBlob = u => fetch(u).then(r => r.blob());

export async function exportiere(melde = () => {}) {
  const z = new ZipSchreiber();
  const d = { format: FORMAT, version: 2, app: VERSION, exportiertAm: new Date().toISOString() };
  for (const s of ['folders', 'notes', 'pages', 'meta']) d[s] = await db.getAll(s);
  const thumbs = await db.getAll('thumbs');
  const files = await db.getAll('files');
  d.thumbs = thumbs.map(t => ({ noteId: t.noteId, at: t.at, datei: `vorschau/${t.noteId}.jpg` }));
  d.files = files.map(({ blob, ...f }) => ({ ...f, datei: `dateien/${f.id}` }));
  await z.dazu('notizbuch.json', new Blob([JSON.stringify(d)]));
  let i = 0;
  for (const f of files) { melde('Dateien werden gesichert', ++i / (files.length + 1)); await z.dazu(`dateien/${f.id}`, f.blob); }
  for (const t of thumbs) await z.dazu(`vorschau/${t.noteId}.jpg`, t.blob);
  const name = `notizbuch-sicherung-${new Date().toISOString().slice(0, 10)}.zip`;
  return new File([z.fertig()], name, { type: 'application/zip' });
}

// Liest eine Sicherung und gibt die Daten plus eine Funktion zum Holen der Dateien zurück.
export async function lies(datei) {
  let d, holen;
  if (await istZip(datei)) {
    const eintraege = new Map((await liesInhalt(datei)).map(e => [e.name, e]));
    const j = eintraege.get('notizbuch.json');
    if (!j) throw new Error('Diese ZIP-Datei ist keine Notizbuch-Sicherung. (Für Notability-Daten: „Aus Notability übernehmen“.)');
    d = JSON.parse(await (await eintragBlob(datei, j)).text());
    holen = async (pfad, typ) => { const e = eintraege.get(pfad); if (!e) throw new Error('Fehlt in der Sicherung: ' + pfad); return eintragBlob(datei, e, typ); };
  } else {
    try { d = JSON.parse(await datei.text()); } catch { throw new Error('Die Datei ist keine gültige Sicherung.'); }
    holen = async url => urlZuBlob(url);
    for (const t of d.thumbs || []) t.datei = t.blob;
    for (const f of d.files || []) f.datei = f.blob;
  }
  if (d?.format !== FORMAT || !Array.isArray(d.folders) || !Array.isArray(d.notes) || !Array.isArray(d.pages))
    throw new Error('Die Datei ist keine Notizbuch-Sicherung.');
  if (d.version > 2) throw new Error('Die Sicherung stammt aus einer neueren App-Version. Bitte App aktualisieren.');
  d.holen = holen;
  return d;
}

// Ersetzt ALLE Daten auf diesem Gerät durch die Sicherung.
export async function stelleWiederHer(d, melde = () => {}) {
  await db.tx(db.STORES, o => {
    for (const s of db.STORES) o[s].clear();
    for (const s of ['folders', 'notes', 'pages', 'meta']) for (const v of d[s] || []) o[s].put(v);
    if (!(d.meta || []).some(m => m.key === 'schema')) o.meta.put({ key: 'schema', value: 1 });
  });
  const files = d.files || [], thumbs = d.thumbs || [];
  let i = 0;
  for (const { datei, ...f } of files) {
    melde('Dateien werden geladen', ++i / (files.length + thumbs.length));
    const blob = await d.holen(datei, f.type || 'application/pdf');
    await db.put('files', { ...f, blob });
  }
  for (const { datei, ...t } of thumbs) {
    melde('Vorschaubilder werden geladen', ++i / (files.length + thumbs.length));
    await db.put('thumbs', { ...t, blob: await d.holen(datei, 'image/jpeg') });
  }
}
