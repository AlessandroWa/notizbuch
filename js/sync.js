// Abgleich mit OneDrive (Microsoft Graph), ohne Fremdbibliothek.
//
// Anmeldung: OAuth 2.0 mit PKCE (Single-Page-App). Dafür braucht es eine App-Registrierung im
// Microsoft-Konto der Firma (Entra ID), siehe README. Die Client-ID ist nicht geheim.
//
// Ablage in OneDrive, Ordner "Notizbuch":
//   index.json              Ordnerstruktur + Liste gelöschter Ordner/Notizen ("Grabsteine")
//   notizen/<id>.json       je Notiz: Notiz + alle Seiten (Striche, Objekte)
//   dateien/<id>            PDFs und Fotos (ändern sich nie, werden nur einmal übertragen)
//
// Regeln: Lokale Änderungen werden wenige Sekunden später hochgeladen (offline: sobald wieder Netz da ist).
// Beim Start und regelmäßig werden Änderungen anderer Geräte geholt. Ändern zwei Geräte dieselbe Notiz,
// gewinnt die neuere Fassung, die andere bleibt als Kopie "(Konflikt)" erhalten. Gelöscht wird auf anderen
// Geräten nur über Grabsteine, nie weil eine Datei in OneDrive fehlt (dann wird sie neu hochgeladen).
import * as db from './db.js';
import * as store from './store.js';
import { uid } from './util.js';

const STANDARD_CLIENT_ID = ''; // nach der App-Registrierung hier eintragen (oder in den Einstellungen)
const STANDARD_MANDANT = 'marmor-walz.de';
const SCOPES = 'offline_access User.Read Files.ReadWrite';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const WURZEL = 'Notizbuch';
const KLEIN = 4 * 1024 * 1024; // bis 4 MB in einem Stück hochladen
const STUECK = 320 * 1024 * 12; // größere Dateien in Stücken (Vielfaches von 320 KB)

export const konfig = () => ({
  clientId: (localStorage.getItem('nb.clientId') || STANDARD_CLIENT_ID).trim(),
  mandant: (localStorage.getItem('nb.mandant') || STANDARD_MANDANT).trim(),
});
export const eingerichtet = () => !!konfig().clientId;
export function setzeKonfig(clientId, mandant) {
  localStorage.setItem('nb.clientId', clientId.trim());
  localStorage.setItem('nb.mandant', (mandant || STANDARD_MANDANT).trim());
}
export const rueckAdresse = () => new URL('./', location.href).href;
const authUrl = p => `https://login.microsoftonline.com/${encodeURIComponent(konfig().mandant)}/oauth2/v2.0/${p}`;

// ---------- Status für die Anzeige ----------
export const status = { angemeldet: false, konto: '', laeuft: false, zuletzt: 0, fehler: '', ausstehend: false };
let melder = () => {};
export const beiStatus = fn => { melder = fn; };
const setze = patch => { Object.assign(status, patch); try { melder(status); } catch { /* egal */ } };

let hooks = { gesperrt: () => null, nachAbgleich: () => {} };

// ---------- Anmeldung ----------
let tok;
async function ladeTok() { if (tok === undefined) tok = (await db.get('meta', 'onedrive')) || null; return tok; }
async function speichereTok(t) { tok = { ...t, key: 'onedrive' }; await db.put('meta', tok); }
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const zufall = n => b64url(crypto.getRandomValues(new Uint8Array(n)));

class AnmeldungNoetig extends Error {}

export async function anmelden() {
  const verifier = zufall(48), state = zufall(16);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  localStorage.setItem('nb.pkce', JSON.stringify({ verifier, state, ziel: location.hash }));
  const q = new URLSearchParams({
    client_id: konfig().clientId, response_type: 'code', redirect_uri: rueckAdresse(), response_mode: 'query',
    scope: SCOPES, state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
  });
  location.assign(authUrl('authorize') + '?' + q);
}

async function tokenAnfrage(felder) {
  const r = await fetch(authUrl('token'), { method: 'POST', body: new URLSearchParams({ client_id: konfig().clientId, scope: SCOPES, ...felder }) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}
async function merkeTokens(j) {
  await speichereTok({ ...(tok || {}), access: j.access_token, exp: Date.now() + ((j.expires_in || 3600) - 120) * 1000, refresh: j.refresh_token || tok?.refresh });
}

// Beim Start: Rückkehr von der Microsoft-Anmeldung verarbeiten. Gibt true zurück, wenn es eine war.
export async function nachAnmeldung() {
  const u = new URL(location.href);
  const code = u.searchParams.get('code'), st = u.searchParams.get('state'), err = u.searchParams.get('error');
  if (!code && !err) return false;
  const pk = JSON.parse(localStorage.getItem('nb.pkce') || 'null');
  localStorage.removeItem('nb.pkce');
  history.replaceState(null, '', rueckAdresse() + (pk?.ziel || '#/einstellungen'));
  if (err) { setze({ fehler: 'Anmeldung abgebrochen: ' + (u.searchParams.get('error_description') || err) }); return true; }
  if (!pk || pk.state !== st) { setze({ fehler: 'Anmeldung ungültig, bitte nochmal anmelden.' }); return true; }
  const { ok, j } = await tokenAnfrage({ grant_type: 'authorization_code', code, redirect_uri: rueckAdresse(), code_verifier: pk.verifier });
  if (!ok) { setze({ fehler: 'Anmeldung fehlgeschlagen: ' + (j.error_description || j.error || 'unbekannt') }); return true; }
  await merkeTokens(j);
  try { const me = await graph('/me?$select=userPrincipalName'); await speichereTok({ ...tok, konto: me.userPrincipalName || '' }); } catch { /* nur Anzeige */ }
  setze({ angemeldet: true, konto: tok.konto || '', fehler: '' });
  return true;
}

async function zugang() {
  await ladeTok();
  if (!tok?.access && !tok?.refresh) throw new AnmeldungNoetig('Nicht angemeldet');
  if (tok.access && Date.now() < tok.exp) return tok.access;
  if (!tok.refresh) throw new AnmeldungNoetig('Anmeldung abgelaufen');
  const { ok, status: st, j } = await tokenAnfrage({ grant_type: 'refresh_token', refresh_token: tok.refresh });
  if (!ok) {
    if (st === 400 || st === 401) { await speichereTok({ ...tok, access: null, refresh: null }); throw new AnmeldungNoetig('Anmeldung abgelaufen'); }
    throw new Error('Anmeldedienst antwortet nicht (' + st + ')');
  }
  await merkeTokens(j);
  return tok.access;
}

export async function abmelden() {
  tok = null;
  await db.tx(['meta'], o => { o.meta.delete('onedrive'); o.meta.delete('syncstand'); });
  setze({ angemeldet: false, konto: '', fehler: '', zuletzt: 0 });
}

// ---------- Microsoft Graph ----------
const warte = ms => new Promise(r => setTimeout(r, ms));
async function graph(pfad, { methode = 'GET', body, kopf = {}, ok404 = false } = {}) {
  const url = pfad.startsWith('http') ? pfad : GRAPH + pfad;
  for (let versuch = 0; ; versuch++) {
    const r = await fetch(url, { method: methode, body, headers: { Authorization: 'Bearer ' + await zugang(), ...kopf } });
    if (r.status === 401 && versuch === 0) { tok.exp = 0; continue; }
    if ((r.status === 429 || r.status >= 500) && versuch < 3) { await warte((+r.headers.get('Retry-After') || 2 ** versuch) * 1000); continue; }
    if (r.status === 404 && ok404) return null;
    if (!r.ok) { const e = new Error('OneDrive meldet Fehler ' + r.status); e.status = r.status; throw e; }
    return r.status === 204 ? null : r.json();
  }
}
const pfad = teile => `/me/drive/root:/${[WURZEL, ...teile].map(encodeURIComponent).join('/')}`;

async function hochladen(teile, blob, ifMatch) {
  if (blob.size <= KLEIN) {
    return graph(pfad(teile) + ':/content', {
      methode: 'PUT', body: blob,
      kopf: { 'Content-Type': blob.type || 'application/octet-stream', ...(ifMatch ? { 'If-Match': ifMatch } : {}) },
    });
  }
  const s = await graph(pfad(teile) + ':/createUploadSession', {
    methode: 'POST', body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }), kopf: { 'Content-Type': 'application/json' },
  });
  let antwort = null;
  for (let a = 0; a < blob.size; a += STUECK) {
    const e = Math.min(blob.size, a + STUECK);
    const r = await fetch(s.uploadUrl, { method: 'PUT', body: blob.slice(a, e), headers: { 'Content-Range': `bytes ${a}-${e - 1}/${blob.size}` } });
    if (!r.ok) throw new Error('Hochladen fehlgeschlagen (' + r.status + ')');
    if (e === blob.size) antwort = await r.json();
  }
  return antwort;
}
async function inhalt(item) {
  const r = await fetch(item['@microsoft.graph.downloadUrl']);
  if (!r.ok) throw new Error('Herunterladen fehlgeschlagen (' + r.status + ')');
  return r.blob();
}
async function holeDatei(teile) {
  const item = await graph(pfad(teile), { ok404: true });
  return item ? { item, blob: await inhalt(item) } : null;
}
async function liste(teile) {
  const out = [];
  let url = pfad(teile) + ':/children?$top=999';
  while (url) {
    const j = await graph(url, { ok404: true });
    if (!j) break;
    out.push(...j.value);
    url = j['@odata.nextLink'];
  }
  return out;
}
const loesche = teile => graph(pfad(teile), { methode: 'DELETE', ok404: true });

// ---------- Abgleich ----------
let laeuft = null, nochmal = false;
export function abgleichen() {
  if (laeuft) { nochmal = true; return laeuft; }
  laeuft = lauf().finally(() => { laeuft = null; if (nochmal) { nochmal = false; abgleichen(); } });
  return laeuft;
}

async function lauf() {
  if (!eingerichtet()) return;
  await ladeTok();
  if (!tok?.access && !tok?.refresh) return;
  if (!navigator.onLine) { setze({ fehler: '' }); return; }
  setze({ laeuft: true, fehler: '' });
  try {
    const stand = (await db.get('meta', 'syncstand')) || { key: 'syncstand', notes: {}, files: {}, grab: {} };
    stand.grab ||= {};
    const merke = () => db.put('meta', stand);
    const ordnerNeu = await abgleichIndex(stand, merke);
    const notizenNeu = await abgleichNotizen(stand, merke);
    await abgleichDateien(stand, merke);
    stand.erstmals = false;
    await merke();
    setze({ laeuft: false, angemeldet: true, zuletzt: Date.now(), ausstehend: false });
    if (ordnerNeu || notizenNeu.length) await hooks.nachAbgleich(notizenNeu);
  } catch (e) {
    console.warn('Abgleich:', e);
    if (e instanceof AnmeldungNoetig) setze({ laeuft: false, angemeldet: false, fehler: 'Bitte bei OneDrive neu anmelden.' });
    else setze({ laeuft: false, fehler: navigator.onLine ? 'Abgleich fehlgeschlagen: ' + e.message : '' });
  }
}

function mischeGrab(a = {}, b = {}) {
  const o = { ...(a.ordner || {}) }, n = { ...(a.notizen || {}) };
  for (const [id, at] of Object.entries(b.ordner || {})) if (!(o[id] >= at)) o[id] = at;
  for (const [id, t] of Object.entries(b.notizen || {})) if (!(n[id]?.at >= t.at)) n[id] = t;
  return { ordner: o, notizen: n };
}

// Ordnerstruktur zusammenführen (je Ordner gewinnt die neuere Änderung), lokal übernehmen und hochladen.
async function abgleichIndex(stand, merke) {
  for (let versuch = 0; versuch < 4; versuch++) {
    const r = await holeDatei(['index.json']);
    const fern = r ? JSON.parse(await r.blob.text()) : { ordner: [], geloescht: {} };
    const erstmals = !stand.indexEtag;
    // Beim ersten Abgleich eines Geräts: gleichnamige Ordner zusammenlegen (z. B. die Startordner)
    if (erstmals && fern.ordner.length) await legeZusammen(fern.ordner);
    const grab = mischeGrab(store.state.geloescht, fern.geloescht);
    const alle = new Map();
    for (const f of [...fern.ordner, ...store.state.folders.values()]) {
      const a = alle.get(f.id);
      if (!a || (f.updatedAt || 0) > (a.updatedAt || 0)) alle.set(f.id, f);
    }
    for (const [id, at] of Object.entries(grab.ordner)) { const f = alle.get(id); if (f && !f.system && (f.updatedAt || 0) <= at) alle.delete(id); }
    // lokal übernehmen
    const neu = [...alle.values()].filter(f => JSON.stringify(f) !== JSON.stringify(store.folder(f.id)));
    const weg = [...store.state.folders.keys()].filter(id => !alle.has(id));
    let geaendert = neu.length > 0 || weg.length > 0;
    if (geaendert) await store.uebernehmeOrdner(neu, weg);
    await store.merkeGeloescht(grab);
    // Notizen in verschwundenen Ordnern landen in "To Do"
    for (const n of store.state.notes.values()) if (!store.folder(n.folderId)) await store.updateNote(n.id, { folderId: store.todoId() }, { touch: false });
    // hochladen, wenn sich etwas gegenüber OneDrive geändert hat
    const index = { format: 'notizbuch-index', version: 1, ordner: [...alle.values()], geloescht: grab };
    if (JSON.stringify({ o: fern.ordner, g: fern.geloescht }) !== JSON.stringify({ o: index.ordner, g: index.geloescht }) || !r) {
      try {
        const item = await hochladen(['index.json'], new Blob([JSON.stringify(index)], { type: 'application/json' }), r?.item.eTag);
        stand.indexEtag = item.eTag;
      } catch (e) { if (e.status === 412) continue; throw e; } // gleichzeitig geändert: nochmal
    } else stand.indexEtag = r.item.eTag;
    await merke();
    return geaendert;
  }
  throw new Error('Ordnerliste wird gerade von einem anderen Gerät geändert');
}

async function legeZusammen(fernOrdner) {
  const fernIds = new Set(fernOrdner.map(f => f.id));
  const tiefe = f => store.path(f.id).length;
  const lokal = [...store.state.folders.values()].filter(f => !fernIds.has(f.id)).sort((a, b) => tiefe(a) - tiefe(b));
  const karte = new Map();
  for (const f of lokal) {
    const eltern = karte.get(f.parentId) ?? f.parentId ?? null;
    const gleich = fernOrdner.find(g => (f.system && g.system === f.system) ||
      (!f.system && !g.system && (g.parentId ?? null) === eltern && g.name.toLocaleLowerCase('de') === f.name.toLocaleLowerCase('de')));
    if (!gleich) continue;
    karte.set(f.id, gleich.id);
  }
  if (!karte.size) return;
  const ziel = id => karte.get(id) ?? id;
  const neu = [];
  for (const g of fernOrdner) if (!store.folder(g.id) && [...karte.values()].includes(g.id)) neu.push(g);
  for (const f of store.state.folders.values()) if (!karte.has(f.id) && karte.has(f.parentId)) neu.push({ ...f, parentId: ziel(f.parentId) });
  await store.uebernehmeOrdner(neu, [...karte.keys()]);
  for (const n of [...store.state.notes.values()]) if (karte.has(n.folderId)) await store.updateNote(n.id, { folderId: ziel(n.folderId) }, { touch: false });
}

const ohneLokales = n => { const { thumbAt, ...rest } = n; return rest; };

async function konfliktKopie(note, pages) {
  const id = uid(), neuePages = pages.map(p => ({ ...p, id: uid(), noteId: id }));
  const kopie = { ...note, id, title: note.title + ' (Konflikt)', pageIds: neuePages.map(p => p.id), syncAt: Date.now() };
  delete kopie.thumbAt; delete kopie.quelle;
  await store.uebernehmeNotiz(kopie, neuePages);
  return id;
}

async function abgleichNotizen(stand, merke) {
  const fern = new Map((await liste(['notizen'])).filter(i => i.name.endsWith('.json')).map(i => [i.name.slice(0, -5), i]));
  const grab = store.state.geloescht.notizen;
  const geaendert = [];
  // 1. Gelöschte Notizen: lokal und in OneDrive entfernen
  for (const [id, t] of Object.entries(grab)) {
    if (stand.grab[id]) continue;
    const lokal = store.note(id);
    if (lokal && store.syncMarke(lokal) > t.at) continue; // nach dem Löschen woanders weiterbearbeitet: bleibt
    if (lokal && hooks.gesperrt() !== id) { await store.entferneNotiz(id); geaendert.push(id); }
    if (fern.has(id)) { await loesche(['notizen', id + '.json']); fern.delete(id); }
    for (const f of t.fileIds || []) if (!store.dateiInBenutzung(f)) { await loesche(['dateien', f]); delete stand.files[f]; }
    delete stand.notes[id];
    stand.grab[id] = 1;
    await merke();
  }
  // 2. In OneDrive neu oder geändert: herunterladen
  for (const [id, item] of fern) {
    if (grab[id]) continue;
    const s = stand.notes[id], lokal = store.note(id);
    if (s && s.etag === item.eTag) continue;
    if (hooks.gesperrt() === id) continue; // gerade im Editor offen: beim nächsten Mal
    const d = JSON.parse(await (await inhalt(item)).text());
    if (d.format !== 'notizbuch-notiz') continue;
    await holeDateien(d.note.fileIds || [], stand, merke);
    const lokalGeaendert = lokal && (!s || store.syncMarke(lokal) > s.rev);
    if (lokalGeaendert && store.syncMarke(lokal) !== store.syncMarke(d.note)) {
      if (store.syncMarke(lokal) > store.syncMarke(d.note)) {
        geaendert.push(await konfliktKopie(d.note, d.pages)); // OneDrive-Fassung als Kopie, lokale gewinnt
        stand.notes[id] = { rev: -1, etag: item.eTag };
        await merke();
        continue;
      }
      geaendert.push(await konfliktKopie(lokal, await store.loadPages(lokal))); // lokale als Kopie
    }
    await store.uebernehmeNotiz(d.note, d.pages);
    stand.notes[id] = { rev: store.syncMarke(d.note), etag: item.eTag };
    await merke();
    geaendert.push(id);
  }
  // 3. Fehlt in OneDrive (z. B. dort von Hand gelöscht): nichts löschen, sondern neu hochladen
  for (const id of Object.keys(stand.notes)) if (!fern.has(id)) delete stand.notes[id];
  // 4. Lokal neu oder geändert: hochladen
  for (const n of [...store.state.notes.values()]) {
    const s = stand.notes[n.id], marke = store.syncMarke(n);
    if (s && marke <= s.rev) continue;
    const pages = await store.loadPages(n);
    const blob = new Blob([JSON.stringify({ format: 'notizbuch-notiz', version: 1, note: ohneLokales(n), pages })], { type: 'application/json' });
    const item = await hochladen(['notizen', n.id + '.json'], blob);
    stand.notes[n.id] = { rev: marke, etag: item.eTag };
    await merke();
  }
  return geaendert;
}

async function holeDateien(ids, stand, merke) {
  const da = new Set(await store.dateiIds());
  for (const id of ids) {
    if (da.has(id)) continue;
    const r = await holeDatei(['dateien', id]);
    if (!r) continue;
    await store.speichereDatei({ id, name: '', type: r.blob.type || r.item.file?.mimeType || 'application/octet-stream', blob: r.blob });
    stand.files[id] = 1;
    await merke();
  }
}

async function abgleichDateien(stand, merke) {
  for (const id of await store.dateiIds()) {
    if (stand.files[id]) continue;
    const f = await store.datei(id);
    if (!f) continue;
    await hochladen(['dateien', id], f.blob.type ? f.blob : new Blob([f.blob], { type: f.type || 'application/octet-stream' }));
    stand.files[id] = 1;
    await merke();
  }
  const brauche = new Set();
  for (const n of store.state.notes.values()) for (const f of n.fileIds || []) brauche.add(f);
  await holeDateien([...brauche], stand, merke);
}

// ---------- Automatik ----------
let uhr = 0;
export function geaendert() {
  if (!eingerichtet() || !status.angemeldet) return;
  setze({ ausstehend: true });
  clearTimeout(uhr);
  uhr = setTimeout(abgleichen, 4000);
}

export async function start(h) {
  hooks = { ...hooks, ...h };
  await ladeTok();
  setze({ angemeldet: !!(tok?.access || tok?.refresh), konto: tok?.konto || '' });
  if (!eingerichtet() || !status.angemeldet) return;
  window.addEventListener('online', () => abgleichen());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - status.zuletzt > 60000) abgleichen();
  });
  setInterval(() => { if (document.visibilityState === 'visible') abgleichen(); }, 5 * 60000);
  abgleichen();
}
