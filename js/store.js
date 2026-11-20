// Datenmodell: Ordner, Notizen, Seiten. Ordner und Notizen liegen zusätzlich im Speicher (schnell),
// Seiten (Striche) werden erst beim Öffnen einer Notiz geladen.
import * as db from './db.js';
import { uid, datumZeit } from './util.js';
import { PAGE_W, PAGE_H } from './ink.js';

export const state = { folders: new Map(), notes: new Map() };

export const FARBEN = ['#0e8fa3', '#5b6270', '#2e9d3a', '#1f5fd6', '#7b3fc4', '#c2185b',
  '#e91e63', '#e53935', '#f57c00', '#f2b705', '#795548', '#37474f'];

const START = [
  ['To Do', '#0e8fa3', 'todo'], ['Auftrag', '#5b6270'], ['Offen', '#5b6270'], ['Abgeschlossene BV', '#5b6270'],
  ['Whirlpools', '#c2185b'], ['Team-Meeting', '#e91e63'], ['Ablage', '#2e9d3a'], ['Ausstellung', '#e53935'],
  ['Mitarbeiter', '#f57c00'], ['Privat', '#37474f'], ['Ecommerce', '#5b6270'],
];

export async function init() {
  let [folders, notes, schema] = await Promise.all([db.getAll('folders'), db.getAll('notes'), db.get('meta', 'schema')]);
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
  return f;
}

export async function updateFolder(id, patch) {
  const f = { ...folder(id), ...patch, updatedAt: Date.now() };
  await db.put('folders', f);
  state.folders.set(id, f);
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

export function folderInhalt(id) {
  const ids = descendants(id);
  const notes = [...state.notes.values()].filter(n => ids.includes(n.folderId));
  return { ordner: ids.length - 1, notizen: notes.length };
}

export async function deleteFolder(id) {
  if (folder(id)?.system) throw new Error('Dieser Ordner kann nicht gelöscht werden.');
  const ids = descendants(id);
  const notes = [...state.notes.values()].filter(n => ids.includes(n.folderId));
  await db.tx(['folders', 'notes', 'pages', 'thumbs', 'files'], o => {
    for (const fid of ids) o.folders.delete(fid);
    for (const n of notes) {
      o.notes.delete(n.id);
      o.thumbs.delete(n.id);
      for (const p of n.pageIds) o.pages.delete(p);
      for (const f of n.fileIds || []) o.files.delete(f);
    }
  });
  for (const fid of ids) state.folders.delete(fid);
  for (const n of notes) state.notes.delete(n.id);
}

// ---------- Notizen ----------
export function newPage(noteId, paper = 'liniert') {
  return { id: uid(), noteId, w: PAGE_W, h: PAGE_H, paper, strokes: [], objects: [] };
}

export async function createNote(folderId, paper = 'liniert') {
  const jetzt = Date.now();
  const n = { id: uid(), folderId, title: 'Notiz ' + datumZeit(jetzt), pageIds: [], createdAt: jetzt, updatedAt: jetzt };
  const p = newPage(n.id, paper);
  n.pageIds.push(p.id);
  await db.tx(['notes', 'pages'], o => { o.notes.put(n); o.pages.put(p); });
  state.notes.set(n.id, n);
  return n;
}

export async function updateNote(id, patch, { touch = true } = {}) {
  const n = { ...note(id), ...patch, ...(touch ? { updatedAt: Date.now() } : {}) };
  await db.put('notes', n);
  state.notes.set(id, n);
  return n;
}

export const moveNote = (id, folderId) => updateNote(id, { folderId }, { touch: false });

export async function deleteNote(id) {
  const n = note(id);
  if (!n) return;
  await db.tx(['notes', 'pages', 'thumbs', 'files'], o => {
    o.notes.delete(id);
    o.thumbs.delete(id);
    for (const p of n.pageIds) o.pages.delete(p);
    for (const f of n.fileIds || []) o.files.delete(f);
  });
  state.notes.delete(id);
}

// Neue leere Seite am Ende einer Notiz.
export async function addPage(page) {
  const n = { ...note(page.noteId), updatedAt: Date.now() };
  n.pageIds = [...n.pageIds, page.id];
  await db.tx(['pages', 'notes'], o => { o.pages.put(page); o.notes.put(n); });
  state.notes.set(n.id, n);
}

// Notiz aus einer PDF: jede PDF-Seite wird eine Seite (Breite 1000, Höhe nach Seitenverhältnis).
export async function createPdfNote({ folderId, title, blob, seiten, datum = Date.now(), quelle = null }) {
  const n = { id: uid(), folderId, title, pageIds: [], fileIds: [], createdAt: datum, updatedAt: datum, ...(quelle ? { quelle } : {}) };
  const file = { id: uid(), noteId: n.id, name: title + '.pdf', type: 'application/pdf', blob };
  n.fileIds.push(file.id);
  const pages = seiten.map((s, i) => ({
    ...newPage(n.id, 'blanko'), h: Math.round(PAGE_W * s.h / s.w), bg: { art: 'pdf', fileId: file.id, seite: i + 1 },
  }));
  n.pageIds = pages.map(p => p.id);
  await db.tx(['notes', 'pages', 'files'], o => { o.files.put(file); for (const p of pages) o.pages.put(p); o.notes.put(n); });
  state.notes.set(n.id, n);
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

export const noteMitQuelle = quelle => [...state.notes.values()].find(n => n.quelle === quelle);

export async function loadPages(n) {
  const pages = await Promise.all(n.pageIds.map(id => db.get('pages', id)));
  const ok = pages.filter(Boolean);
  if (!ok.length) ok.push(newPage(n.id)); // Notfall: Notiz ohne Seite
  return ok;
}

// Eine Seite speichern und die Notiz als geändert markieren (eine Transaktion).
export async function savePage(page) {
  const n = { ...note(page.noteId), updatedAt: Date.now() };
  await db.tx(['pages', 'notes'], o => { o.pages.put(page); o.notes.put(n); });
  state.notes.set(n.id, n);
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
