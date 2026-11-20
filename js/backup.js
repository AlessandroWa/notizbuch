// Sicherung: alle Daten in EINE Datei (JSON). Bilder/Vorschauen als data-URL.
import * as db from './db.js';
import { VERSION } from './util.js';

const FORMAT = 'notizbuch-sicherung';

const blobZuUrl = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
const urlZuBlob = u => fetch(u).then(r => r.blob());

export async function exportiere() {
  const d = { format: FORMAT, version: 1, app: VERSION, exportiertAm: new Date().toISOString() };
  for (const s of ['folders', 'notes', 'pages', 'meta']) d[s] = await db.getAll(s);
  d.thumbs = await Promise.all((await db.getAll('thumbs')).map(async t => ({ ...t, blob: await blobZuUrl(t.blob) })));
  d.files = await Promise.all((await db.getAll('files')).map(async f => ({ ...f, blob: await blobZuUrl(f.blob) })));
  const name = `notizbuch-sicherung-${new Date().toISOString().slice(0, 10)}.json`;
  return new File([JSON.stringify(d)], name, { type: 'application/json' });
}

export async function lies(datei) {
  let d;
  try { d = JSON.parse(await datei.text()); } catch { throw new Error('Die Datei ist keine gültige Sicherung.'); }
  if (d?.format !== FORMAT || !Array.isArray(d.folders) || !Array.isArray(d.notes) || !Array.isArray(d.pages))
    throw new Error('Die Datei ist keine Notizbuch-Sicherung.');
  if (d.version > 1) throw new Error('Die Sicherung stammt aus einer neueren App-Version. Bitte App aktualisieren.');
  return d;
}

// Ersetzt ALLE Daten auf diesem Gerät durch die Sicherung.
export async function stelleWiederHer(d) {
  const thumbs = await Promise.all((d.thumbs || []).map(async t => ({ ...t, blob: await urlZuBlob(t.blob) })));
  const files = await Promise.all((d.files || []).map(async f => ({ ...f, blob: await urlZuBlob(f.blob) })));
  await db.tx(db.STORES, o => {
    for (const s of db.STORES) o[s].clear();
    for (const s of ['folders', 'notes', 'pages', 'meta']) for (const v of d[s] || []) o[s].put(v);
    for (const t of thumbs) o.thumbs.put(t);
    for (const f of files) o.files.put(f);
    if (!(d.meta || []).some(m => m.key === 'schema')) o.meta.put({ key: 'schema', value: 1 });
  });
}
