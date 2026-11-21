// Datenmodell: Ordner, Notizen, Seiten. Ordner und Notizen liegen zusätzlich im Speicher (schnell),
// Seiten (Striche) werden erst beim Öffnen einer Notiz geladen.
import * as db from './db.js';
import { uid, datumZeit } from './util.js';
import { PAGE_W, PAGE_H } from './ink.js';

export const state = { folders: new Map(), notes: new Map(), geloescht: { key: 'geloescht', ordner: {}, notizen: {} } };

// Abgleich (OneDrive): jede Änderung meldet sich hier; "syncAt" je Notiz = letzte Änderung (auch Umbenennen/Verschieben).
let aenderung = () => {};
export const beiAenderung = fn => { aenderung = fn; };
const gemeldet = () => { try { aenderung(); } catch { /* egal */ } };
const stempel = n => ({ ...n, syncAt: Date.now() });

// Gedämpfte Ordnerfarben (passend zum Anthrazit des Logos)
export const FARBEN = ['#5f8f97', '#8a8687', '#6f8f6a', '#647d99', '#857597', '#9c6b78',
  '#b58a91', '#a8645b', '#bb8c62', '#bba567', '#8c7564', '#5d666e'];
// Frühere, kräftige Farben (Version 0.1/0.2) werden beim Start auf die gedämpften umgestellt.
const ALTE_FARBEN = ['#0e8fa3', '#5b6270', '#2e9d3a', '#1f5fd6', '#7b3fc4', '#c2185b',
  '#e91e63', '#e53935', '#f57c00', '#f2b705', '#795548', '#37474f'];

const [PETROL, GRAU, GRUEN, , , BEERE, ROSE, ZIEGEL, OCKER, , , SCHIEFER] = FARBEN;
export const START_NAMEN = () => START.map(s => s[0]);
const START = [
  ['To Do', PETROL, 'todo'], ['Auftrag', GRAU], ['Offen', GRAU], ['Abgeschlossene BV', GRAU],
  ['Whirlpools', BEERE], ['Team-Meeting', ROSE], ['Ablage', GRUEN], ['Ausstellung', ZIEGEL],
  ['Mitarbeiter', OCKER], ['Privat', SCHIEFER], ['Ecommerce', GRAU],
];

export async function init() {
  let [folders, notes, schema, geloescht] = await Promise.all([db.getAll('folders'), db.getAll('notes'), db.get('meta', 'schema'), db.get('meta', 'geloescht')]);
  state.geloescht = geloescht || { key: 'geloescht', ordner: {}, notizen: {} };
  if (!schema) {
    const jetzt = Date.now();
    folders = START.map(([name, color, system], i) => ({
      id: uid(), name, color, parentId: null, sort: i, createdAt: jetzt, updatedAt: jetzt, ...(system ? { system } : {}),
    }));
    await db.tx(['folders', 'meta'], o => {
      for (const f of folders) o.folders.put(f);
      o.meta.put({ key: 'schema', value: 1 });
    });
  }
  const umstellen = folders.filter(f => ALTE_FARBEN.includes(f.color));
  if (umstellen.length) {
    for (const f of umstellen) f.color = FARBEN[ALTE_FARBEN.indexOf(f.color)];
    await db.tx(['folders'], o => { for (const f of umstellen) o.folders.put(f); });
  }
  state.folders = new Map(folders.map(f => [f.id, f]));
  state.notes = new Map(notes.map(n => [n.id, n]));
}

// ---------- Lesen ----------
export const folder = id => state.folders.get(id);
export const note = id => state.notes.get(id);
export const todoId = () => [...state.folders.values()].find(f => f.system === 'todo')?.id;

export const children = parentId => [...state.folders.values()]
  .filter(f => (f.parentId ?? null) === (parentId ?? null))
  .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'de'));

export const notesIn = folderId => [...state.notes.values()]
  .filter(n => n.folderId === folderId)
  .sort((a, b) => b.updatedAt - a.updatedAt);

export function path(id) {
  const out = [];
  for (let f = folder(id); f && out.length < 100; f = folder(f.parentId)) out.unshift(f);
  return out;
}

export function descendants(id) {
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const c of children(out[i])) out.push(c.id);
  return out;
}

// ---------- Ordner ----------
export async function createFolder({ name, parentId = null, color = FARBEN[1] }) {
  const sort = Math.max(-1, ...children(parentId).map(f => f.sort)) + 1;
  const f = { id: uid(), name, color, parentId, sort, createdAt: Date.now(), updatedAt: Date.now() };
  await db.put('folders', f);
  state.folders.set(f.id, f);
  gemeldet();
  return f;
}

export async function updateFolder(id, patch) {
  const f = { ...folder(id), ...patch, updatedAt: Date.now() };
  await db.put('folders', f);
  state.folders.set(id, f);
  gemeldet();
  return f;
}

export function canMoveFolder(id, ziel) {
  const f = folder(id);
  if (!f || f.system) return false;
  if (ziel && descendants(id).includes(ziel)) return false; // nicht in sich selbst
  return true;
}

export async function moveFolder(id, ziel) {
  if (!canMoveFolder(id, ziel)) throw new Error('Ordner kann dorthin nicht verschoben werden.');
  const sort = Math.max(-1, ...children(ziel).filter(f => f.id !== id).map(f => f.sort)) + 1;
  return updateFolder(id, { parentId: ziel ?? null, sort });
}

// Ordner an eine Stelle legen: in "parentId" an Position "index" (Reihenfolge wird neu durchnummeriert).
export async function ordneOrdner(id, parentId, index = Infinity) {
  parentId = parentId ?? null;
  if (!canMoveFolder(id, parentId)) throw new Error('Ordner kann dorthin nicht verschoben werden.');
  const geschw = children(parentId).filter(f => f.id !== id);
  geschw.splice(Math.max(0, Math.min(index, geschw.length)), 0, folder(id));
  const jetzt = Date.now(), neu = [];
  geschw.forEach((f, i) => {
    const wandert = f.id === id && (f.parentId ?? null) !== parentId;
    if (f.sort !== i || wandert) neu.push({ ...f, sort: i, ...(f.id === id ? { parentId } : {}), updatedAt: jetzt });
  });
  if (!neu.length) return;
  await db.tx(['folders'], o => { for (const f of neu) o.folders.put(f); });
  for (const f of neu) state.folders.set(f.id, f);
  gemeldet();
}

export function folderInhalt(id) {
  const ids = descendants(id);
  const notes = [...state.notes.values()].filter(n => ids.includes(n.folderId));
  return { ordner: ids.length - 1, notizen: notes.length };
}

const dateiInBenutzungAusser = (fileId, notes) =>
  [...state.notes.values()].some(n => !notes.includes(n) && (n.fileIds || []).includes(fileId));

export async function deleteFolder(id) {
  if (folder(id)?.system) throw new Error('Dieser Ordner kann nicht gelöscht werden.');
  const ids = descendants(id);
  const notes = [...state.notes.values()].filter(n => ids.includes(n.folderId));
  const jetzt = Date.now(), g = state.geloescht;
  for (const fid of ids) g.ordner[fid] = jetzt;
  for (const n of notes) g.notizen[n.id] = { at: jetzt, fileIds: n.fileIds || [] };
  await db.tx(['folders', 'notes', 'pages', 'thumbs', 'files', 'meta'], o => {
    o.meta.put(g);
    for (const fid of ids) o.folders.delete(fid);
    for (const n of notes) {
      o.notes.delete(n.id);
      o.thumbs.delete(n.id);
      for (const p of n.pageIds) o.pages.delete(p);
      for (const f of n.fileIds || []) if (!dateiInBenutzungAusser(f, notes)) o.files.delete(f);
    }
  });
  for (const fid of ids) state.folders.delete(fid);
  for (const n of notes) state.notes.delete(n.id);
  gemeldet();
}

// Inhalt eines Ordners eine Ebene höher einsortieren: gleichnamige Ordner werden zusammengelegt,
// der leere Ordner verschwindet. Nichts wird gelöscht außer leeren Ordnern.
export async function einsortieren(id) {
  const quelle = folder(id);
  if (!quelle || quelle.system) throw new Error('Dieser Ordner kann nicht einsortiert werden.');
  const ziel = quelle.parentId ?? null;
  let ordner = 0, notizen = 0;
  async function lege(qid, zielParent) {
    for (const k of children(qid)) {
      const gleich = children(zielParent).find(f => f.id !== k.id && f.name.toLocaleLowerCase('de') === k.name.toLocaleLowerCase('de'));
      if (gleich) { await lege(k.id, gleich.id); await legeNotizen(k.id, gleich.id); await entferneLeer(k.id); ordner++; }
      else { await moveFolder(k.id, zielParent); }
    }
  }
  async function legeNotizen(von, nach) {
    for (const n of notesIn(von)) { await moveNote(n.id, nach); notizen++; }
  }
  await lege(id, ziel);
  await legeNotizen(id, ziel ?? todoId());
  await entferneLeer(id);
  return { ordner, notizen };
}

export async function entferneLeer(id) {
  if (children(id).length || notesIn(id).length) return;
  state.geloescht.ordner[id] = Date.now();
  await db.tx(['folders', 'meta'], o => { o.folders.delete(id); o.meta.put(state.geloescht); });
  state.folders.delete(id);
  gemeldet();
}

// ---------- Notizen ----------
export function newPage(noteId, paper = 'liniert') {
  return { id: uid(), noteId, w: PAGE_W, h: PAGE_H, paper, strokes: [], objects: [] };
}

export async function createNote(folderId, paper = 'liniert') {
  const jetzt = Date.now();
  const n = { id: uid(), folderId, title: 'Notiz ' + datumZeit(jetzt), pageIds: [], createdAt: jetzt, updatedAt: jetzt, syncAt: jetzt };
  const p = newPage(n.id, paper);
  n.pageIds.push(p.id);
  await db.tx(['notes', 'pages'], o => { o.notes.put(n); o.pages.put(p); });
  state.notes.set(n.id, n);
  gemeldet();
  return n;
}

export async function updateNote(id, patch, { touch = true } = {}) {
  const n = stempel({ ...note(id), ...patch, ...(touch ? { updatedAt: Date.now() } : {}) });
  await db.put('notes', n);
  state.notes.set(id, n);
  gemeldet();
  return n;
}

export const moveNote = (id, folderId) => updateNote(id, { folderId }, { touch: false });

export async function deleteNote(id) {
  const n = note(id);
  if (!n) return;
  state.geloescht.notizen[id] = { at: Date.now(), fileIds: n.fileIds || [] };
  await db.tx(['notes', 'pages', 'thumbs', 'files', 'meta'], o => {
    o.meta.put(state.geloescht);
    o.notes.delete(id);
    o.thumbs.delete(id);
    for (const p of n.pageIds) o.pages.delete(p);
    for (const f of n.fileIds || []) if (!dateiInBenutzung(f, id)) o.files.delete(f);
  });
  state.notes.delete(id);
  gemeldet();
}

// Neue leere Seite am Ende einer Notiz.
export async function addPage(page) {
  const n = stempel({ ...note(page.noteId), updatedAt: Date.now() });
  n.pageIds = [...n.pageIds, page.id];
  await db.tx(['pages', 'notes'], o => { o.pages.put(page); o.notes.put(n); });
  state.notes.set(n.id, n);
  gemeldet();
}

// Notiz aus einer PDF: jede PDF-Seite wird eine Seite (Breite 1000, Höhe nach Seitenverhältnis).
export async function createPdfNote({ folderId, title, blob, seiten, datum = Date.now(), quelle = null }) {
  const n = { id: uid(), folderId, title, pageIds: [], fileIds: [], createdAt: datum, updatedAt: datum, syncAt: Date.now(), ...(quelle ? { quelle } : {}) };
  const file = { id: uid(), noteId: n.id, name: title + '.pdf', type: 'application/pdf', blob };
  n.fileIds.push(file.id);
  const pages = seiten.map((s, i) => ({
    ...newPage(n.id, 'blanko'), h: Math.round(PAGE_W * s.h / s.w), bg: { art: 'pdf', fileId: file.id, seite: i + 1 },
  }));
  n.pageIds = pages.map(p => p.id);
  await db.tx(['notes', 'pages', 'files'], o => { o.files.put(file); for (const p of pages) o.pages.put(p); o.notes.put(n); });
  state.notes.set(n.id, n);
  gemeldet();
  return { note: n, pages };
}

// Ordnerpfad unter "parentId" finden oder anlegen (Namen ohne Rücksicht auf Groß/Klein).
export async function ordnerPfad(parentId, namen) {
  let pid = parentId;
  for (const name of namen) {
    const f = children(pid).find(c => c.name.toLocaleLowerCase('de') === name.toLocaleLowerCase('de'))
      || await createFolder({ name, parentId: pid, color: pid ? folder(pid).color : FARBEN[1] });
    pid = f.id;
  }
  return pid;
}

// Datei (z. B. Foto) zu einer Notiz speichern, gibt die Datei-ID zurück.
export async function addFile(noteId, blob, type) {
  const n = stempel({ ...note(noteId) });
  const f = { id: uid(), noteId, name: '', type, blob };
  n.fileIds = [...(n.fileIds || []), f.id];
  await db.tx(['files', 'notes'], o => { o.files.put(f); o.notes.put(n); });
  state.notes.set(noteId, n);
  return f.id;
}

export const noteMitQuelle = quelle => [...state.notes.values()].find(n => n.quelle === quelle);

export async function loadPages(n) {
  const pages = await Promise.all(n.pageIds.map(id => db.get('pages', id)));
  const ok = pages.filter(Boolean);
  if (!ok.length) ok.push(newPage(n.id)); // Notfall: Notiz ohne Seite
  return ok;
}

// Eine Seite speichern und die Notiz als geändert markieren (eine Transaktion).
export async function savePage(page) {
  const n = stempel({ ...note(page.noteId), updatedAt: Date.now() });
  await db.tx(['pages', 'notes'], o => { o.pages.put(page); o.notes.put(n); });
  state.notes.set(n.id, n);
  gemeldet();
}

export async function saveThumb(noteId, blob) {
  const n = note(noteId);
  if (!n) return;
  const t = Date.now();
  const n2 = { ...n, thumbAt: t };
  await db.tx(['thumbs', 'notes'], o => { o.thumbs.put({ noteId, blob, at: t }); o.notes.put(n2); });
  state.notes.set(noteId, n2);
}

export const getThumb = noteId => db.get('thumbs', noteId);

// ---------- Für den Abgleich: Änderungen von anderen Geräten übernehmen (ohne neue Änderungsmeldung) ----------
export const syncMarke = n => n.syncAt || n.updatedAt || 0;

export async function uebernehmeOrdner(liste, weg) {
  await db.tx(['folders'], o => { for (const f of liste) o.folders.put(f); for (const id of weg) o.folders.delete(id); });
  for (const f of liste) state.folders.set(f.id, f);
  for (const id of weg) state.folders.delete(id);
}

export async function merkeGeloescht(g) {
  state.geloescht = { ...g, key: 'geloescht' };
  await db.put('meta', state.geloescht);
}

// Notiz mit Seiten aus dem Abgleich speichern (ersetzt die lokale Fassung)
export async function uebernehmeNotiz(n, pages) {
  const alt = note(n.id);
  const weg = (alt?.pageIds || []).filter(id => !n.pageIds.includes(id));
  const neu = alt?.thumbAt ? { ...n, thumbAt: alt.thumbAt } : n;
  await db.tx(['notes', 'pages'], o => { o.notes.put(neu); for (const p of pages) o.pages.put(p); for (const id of weg) o.pages.delete(id); });
  state.notes.set(n.id, neu);
}

export async function entferneNotiz(id) {
  const n = note(id);
  if (!n) return;
  await db.tx(['notes', 'pages', 'thumbs', 'files'], o => {
    o.notes.delete(id); o.thumbs.delete(id);
    for (const p of n.pageIds) o.pages.delete(p);
    for (const f of n.fileIds || []) if (!dateiInBenutzung(f, id)) o.files.delete(f);
  });
  state.notes.delete(id);
}

export const dateiInBenutzung = (fileId, ausser = null) =>
  [...state.notes.values()].some(n => n.id !== ausser && (n.fileIds || []).includes(fileId));

export async function speichereDatei(f) { await db.put('files', f); }
export const dateiIds = () => db.keys('files');
export const datei = id => db.get('files', id);
