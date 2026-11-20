// Test OneDrive-Abgleich mit zwei Geräten und einem nachgestellten Microsoft-Dienst (Anmeldung + Graph).
// node test/onedrive.mjs  (braucht Playwright)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { starteServer } from './server.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');

let fehler = 0;
const pruefe = (ok, text) => { console.log((ok ? 'OK   ' : 'FEHLER ') + text); if (!ok) fehler++; };
const server = starteServer();
const browser = await chromium.launch();

// ---------- Nachgestellter Microsoft-Dienst ----------
const ablage = new Map(); // Pfad -> {daten: Buffer, typ, ver}
const uploads = new Map();
let anfragen = 0;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
const item = (p, e) => ({ name: p.split('/').pop(), eTag: `"${e.ver}"`, size: e.daten.length, file: { mimeType: e.typ }, '@microsoft.graph.downloadUrl': 'https://download.fake/' + encodeURIComponent(p) });
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
let ver = 0;
async function microsoft(route) {
  const req = route.request(), url = new URL(req.url()), m = req.method();
  anfragen++;
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  if (url.host === 'login.microsoftonline.com') {
    if (url.pathname.endsWith('/authorize')) {
      const ziel = url.searchParams.get('redirect_uri') + '?code=TESTCODE&state=' + url.searchParams.get('state');
      return route.fulfill({ status: 302, headers: { location: ziel } });
    }
    const f = new URLSearchParams(req.postData() || '');
    if (f.get('grant_type') === 'authorization_code' && (!f.get('code_verifier') || f.get('code') !== 'TESTCODE')) return json(route, 400, { error: 'invalid_grant' });
    return json(route, 200, { access_token: 'AT' + Date.now(), refresh_token: 'RT', expires_in: 3600 });
  }
  if (url.host === 'download.fake') {
    const e = ablage.get(decodeURIComponent(url.pathname.slice(1)));
    return e ? route.fulfill({ status: 200, headers: { ...CORS, 'content-type': e.typ }, body: e.daten }) : route.fulfill({ status: 404, headers: CORS });
  }
  if (url.host === 'upload.fake') {
    const p = decodeURIComponent(url.pathname.slice(1)), [, a, , g] = req.headers()['content-range'].match(/bytes (\d+)-(\d+)\/(\d+)/);
    const teile = uploads.get(p) || []; teile.push(req.postDataBuffer()); uploads.set(p, teile);
    const daten = Buffer.concat(teile);
    if (daten.length < +g) return json(route, 202, { nextExpectedRanges: [daten.length + '-'] });
    uploads.delete(p);
    const e = { daten, typ: 'application/octet-stream', ver: ++ver }; ablage.set(p, e);
    return json(route, 201, item(p, e));
  }
  if (!req.headers().authorization?.startsWith('Bearer AT')) return json(route, 401, { error: 'unauthenticated' });
  if (url.pathname === '/v1.0/me') return json(route, 200, { userPrincipalName: 'test@beispiel.de' });
  const roh = decodeURIComponent(url.pathname.replace('/v1.0/me/drive/root:/', ''));
  const [p, aktion] = roh.split(':/');
  if (aktion === 'content' && m === 'PUT') {
    const alt = ablage.get(p), im = req.headers()['if-match'];
    if (im && alt && im !== `"${alt.ver}"`) return json(route, 412, { error: 'precondition' });
    const e = { daten: req.postDataBuffer() || Buffer.alloc(0), typ: req.headers()['content-type'] || 'application/octet-stream', ver: ++ver };
    ablage.set(p, e);
    return json(route, 201, item(p, e));
  }
  if (aktion === 'createUploadSession') return json(route, 200, { uploadUrl: 'https://upload.fake/' + encodeURIComponent(p) });
  if (aktion === 'children') {
    const kinder = [...ablage.entries()].filter(([k]) => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/'));
    if (!kinder.length) return json(route, 404, { error: 'itemNotFound' });
    return json(route, 200, { value: kinder.map(([k, e]) => item(k, e)) });
  }
  if (m === 'DELETE') { ablage.delete(p); return route.fulfill({ status: 204, headers: CORS }); }
  const e = ablage.get(p);
  return e ? json(route, 200, item(p, e)) : json(route, 404, { error: 'itemNotFound' });
}

async function geraet(name) {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, serviceWorkers: 'block' });
  await ctx.route(/login\.microsoftonline\.com|graph\.microsoft\.com|download\.fake|upload\.fake/, microsoft);
  const page = await ctx.newPage();
  page.logs = [];
  page.on('pageerror', e => page.logs.push(name + ' pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') page.logs.push(name + ': ' + m.text()); });
  await page.goto(server.url);
  await page.waitForSelector('.baum-zeile');
  return { ctx, page };
}
async function anmelden(page) {
  await page.click('[data-a=einstellungen]');
  await page.fill('#sync-client', '11111111-2222-3333-4444-555555555555');
  await page.click('[data-a=sync-konfig]');
  await page.click('.dlg .primaer');
  await page.click('[data-a=sync-an]');
  await page.waitForFunction(() => /abgeglichen \d/.test(document.getElementById('sync-zeile')?.textContent || ''), null, { timeout: 20000 });
}
async function abgleich(page) {
  if (page.url().includes('#/notiz/')) { await page.goto(server.url + '#/einstellungen'); await page.waitForSelector('#sync-status'); }
  const f = await page.evaluate(async () => { await window.notizbuchSync.abgleichen(); await window.notizbuchSync.abgleichen(); return window.notizbuchSync.status.fehler; });
  if (f) console.log('     Status: ' + f);
}
const daten = page => page.evaluate(async () => {
  const d = await new Promise(r => { const q = indexedDB.open('notizbuch'); q.onsuccess = () => r(q.result); });
  const alle = s => new Promise(r => { const q = d.transaction(s).objectStore(s).getAll(); q.onsuccess = () => r(q.result); });
  const x = { folders: await alle('folders'), notes: await alle('notes'), pages: await alle('pages'), files: (await alle('files')).map(f => ({ id: f.id, size: f.blob.size })) };
  d.close();
  return x;
});
async function schreibe(page, y, id) {
  await page.evaluate(({ y, id }) => {
    const v = document.querySelector('.ed-view');
    const ev = (t, x) => v.dispatchEvent(new PointerEvent(t, { pointerType: 'pen', pointerId: id, clientX: x, clientY: y, pressure: 0.5, bubbles: true, cancelable: true }));
    ev('pointerdown', 200); for (let i = 1; i < 20; i++) ev('pointermove', 200 + i * 12); ev('pointerup', 440);
  }, { y, id });
  await page.waitForTimeout(600);
}

// ---------- Gerät A: anmelden, Ordner + Notiz anlegen ----------
const A = await geraet('A');
await anmelden(A.page);
pruefe(ablage.has('Notizbuch/index.json'), 'A: angemeldet, Ordnerliste in OneDrive');
pruefe((await A.page.locator('#sync-zeile').innerText()).includes('abgeglichen'), 'Statuszeile zeigt „abgeglichen“');
await A.page.click('.baum-zeile:has-text("Auftrag")');
await A.page.click('[data-a=neu]'); await A.page.click('.menue [data-k=ordner]');
await A.page.fill('.dlg input', 'BV Synctest'); await A.page.click('.dlg .primaer');
await A.page.waitForSelector('h1:has-text("BV Synctest")');
await A.page.click('[data-a=neu]'); await A.page.click('.menue [data-k="notiz:kariert"]');
await A.page.waitForSelector('.ed-page canvas.base');
await A.page.fill('.ed-title', 'Aufmaß Bad'); await A.page.press('.ed-title', 'Enter');
await schreibe(A.page, 300, 3);
await schreibe(A.page, 360, 4);
await abgleich(A.page);
let dA = await daten(A.page);
const notiz = dA.notes.find(n => n.title === 'Aufmaß Bad');
pruefe(notiz && ablage.has(`Notizbuch/notizen/${notiz.id}.json`), 'A: Notiz in OneDrive hochgeladen');

// PDF auf A importieren (Datei > 4 MB, damit das Hochladen in Stücken geprüft wird)
const pdfSeite = await A.ctx.newPage();
await pdfSeite.setContent('<h1>Plan</h1>' + '<p>' + 'x'.repeat(200) + '</p>'.repeat(1));
let pdf = await pdfSeite.pdf({ format: 'A4' });
await pdfSeite.close();
pdf = Buffer.concat([pdf, Buffer.from('\n%' + 'p'.repeat(4.5 * 1024 * 1024) + '\n')]); // Kommentar am Ende = größer, bleibt gültig
fs.writeFileSync('/tmp/nb-gross.pdf', pdf);
await A.page.goto(server.url + '#/ordner/' + notiz.folderId);
await A.page.click('[data-a=neu]');
const [wahl] = await Promise.all([A.page.waitForEvent('filechooser'), A.page.click('.menue [data-k=pdf]')]);
await wahl.setFiles('/tmp/nb-gross.pdf');
await A.page.waitForSelector('.dlg:not(.fortschritt) .primaer', { timeout: 20000 });
await A.page.click('.dlg .primaer');
await abgleich(A.page);
dA = await daten(A.page);
const pdfDatei = dA.files[0];
pruefe(pdfDatei && ablage.get('Notizbuch/dateien/' + pdfDatei.id)?.daten.length === pdfDatei.size, 'A: große PDF in Stücken hochgeladen (' + Math.round(pdfDatei.size / 1048576 * 10) / 10 + ' MB)');

// ---------- Gerät B: anmelden, alles kommt an ----------
const B = await geraet('B');
await anmelden(B.page);
let dB = await daten(B.page);
const pfade = x => x.folders.map(f => { const p = []; for (let g = f; g; g = x.folders.find(h => h.id === g.parentId)) p.unshift(g.name); return p.join('/'); }).sort();
pruefe(pfade(dB).includes('Auftrag/BV Synctest'), 'B: Ordner von A angekommen');
pruefe(dB.folders.length === dA.folders.length && new Set(pfade(dB)).size === pfade(dB).length, 'B: Startordner nicht doppelt (' + dB.folders.length + ' Ordner)');
const nB = dB.notes.find(n => n.id === notiz.id);
pruefe(nB && dB.pages.find(p => p.noteId === notiz.id)?.strokes.length === 2, 'B: Notiz mit Handschrift angekommen');
pruefe(dB.files.some(f => f.id === pdfDatei.id && f.size === pdfDatei.size), 'B: PDF angekommen');
await B.page.goto(server.url + '#/ordner/' + notiz.folderId);
await B.page.waitForSelector('.karte');
pruefe(await B.page.locator('.karte').count() === 2, 'B: beide Notizen in der Ordneransicht');

// ---------- B ändert, A holt ----------
await B.page.goto(server.url + '#/notiz/' + notiz.id);
await B.page.waitForSelector('.ed-page canvas.base');
await schreibe(B.page, 420, 5);
await B.page.fill('.ed-title', 'Aufmaß Bad OG'); await B.page.press('.ed-title', 'Enter');
await abgleich(B.page);
await abgleich(A.page);
dA = await daten(A.page);
pruefe(dA.notes.find(n => n.id === notiz.id)?.title === 'Aufmaß Bad OG' && dA.pages.find(p => p.noteId === notiz.id).strokes.length === 3, 'A: Änderung von B angekommen');

// ---------- Konflikt: beide offline ändern ----------
await A.ctx.setOffline(true);
await A.page.goto(server.url + '#/notiz/' + notiz.id);
await A.page.waitForSelector('.ed-page canvas.base');
await schreibe(A.page, 480, 6);
await A.page.goto(server.url + '#/ordner/' + notiz.folderId);
await B.page.goto(server.url + '#/notiz/' + notiz.id);
await B.page.waitForSelector('.ed-page canvas.base');
await schreibe(B.page, 540, 7);
await abgleich(B.page);
await A.ctx.setOffline(false);
await abgleich(A.page);
dA = await daten(A.page);
const kopie = dA.notes.find(n => n.title.includes('(Konflikt)'));
pruefe(kopie, 'Konflikt: beide Fassungen bleiben erhalten (Kopie „(Konflikt)“)');
await abgleich(B.page);
dB = await daten(B.page);
pruefe(dB.notes.some(n => n.title.includes('(Konflikt)')), 'Konflikt-Kopie auch auf B');

// ---------- Löschen auf A kommt auf B an ----------
await A.page.goto(server.url + '#/suche/Konflikt');
await A.page.click('.karte [data-a=notiz-menue]');
await A.page.click('.menue [data-k=del]');
await A.page.click('.dlg .gefahr');
await abgleich(A.page);
await abgleich(B.page);
dB = await daten(B.page);
pruefe(!dB.notes.some(n => n.title.includes('(Konflikt)')), 'Löschen kommt auf dem anderen Gerät an');
pruefe(dB.files.some(f => f.id === pdfDatei.id), 'Geteilte PDF bleibt erhalten');

// ---------- Ordner verschieben auf B kommt auf A an ----------
await B.page.goto(server.url + '#/ordner/' + notiz.folderId);
await B.page.click('[data-a=ordner-menue]');
await B.page.click('.menue [data-k=move]');
await B.page.click('.dlg .baum-zeile:has-text("Abgeschlossene BV")');
await abgleich(B.page);
await abgleich(A.page);
dA = await daten(A.page);
pruefe(pfade(dA).includes('Abgeschlossene BV/BV Synctest'), 'Ordner verschoben (B → A)');

const logs = [...A.page.logs, ...B.page.logs].filter(l => !/Failed to load resource|ERR_INTERNET_DISCONNECTED|net::/.test(l));
pruefe(logs.length === 0, 'Keine JavaScript-Fehler' + (logs.length ? ':\n  ' + logs.join('\n  ') : ''));
console.log('     (' + anfragen + ' Anfragen an den nachgestellten Microsoft-Dienst)');
await browser.close();
server.close();
console.log(fehler ? `\n${fehler} Fehler` : '\nAlles OK');
process.exit(fehler ? 1 : 0);
