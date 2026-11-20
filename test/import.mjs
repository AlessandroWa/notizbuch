// Test für Bauschritt 2a: Notability-ZIP importieren, PDF beschreiben, mehrere Seiten, Sicherung als ZIP.
// node test/import.mjs  (braucht Playwright)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { starteServer } from './server.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');

let fehler = 0;
const pruefe = (ok, text) => { console.log((ok ? 'OK   ' : 'FEHLER ') + text); if (!ok) fehler++; };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-'));
const SHOT = process.env.SHOT_DIR;

// --- ZIP wie von OneDrive (deflate, UTF-8-Namen) ---
function crc32(b) { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return ~c >>> 0; }
function zip(eintraege) {
  const teile = [], cd = []; let off = 0;
  for (const [name, daten] of eintraege) {
    const n = Buffer.from(name), roh = Buffer.from(daten), pack = zlib.deflateRawSync(roh), crc = crc32(roh);
    const k = Buffer.alloc(30); k.writeUInt32LE(0x04034b50, 0); k.writeUInt16LE(20, 4); k.writeUInt16LE(0x800, 6); k.writeUInt16LE(8, 8);
    k.writeUInt16LE(0x6000, 10); k.writeUInt16LE(0x5b74, 12); k.writeUInt32LE(crc, 14); k.writeUInt32LE(pack.length, 18); k.writeUInt32LE(roh.length, 22); k.writeUInt16LE(n.length, 26);
    const z = Buffer.alloc(46); z.writeUInt32LE(0x02014b50, 0); z.writeUInt16LE(20, 4); z.writeUInt16LE(20, 6); z.writeUInt16LE(0x800, 8); z.writeUInt16LE(8, 10);
    z.writeUInt16LE(0x6000, 12); z.writeUInt16LE(0x5b74, 14); z.writeUInt32LE(crc, 16); z.writeUInt32LE(pack.length, 20); z.writeUInt32LE(roh.length, 24); z.writeUInt16LE(n.length, 28); z.writeUInt32LE(off, 42);
    teile.push(k, n, pack); cd.push(z, n); off += 30 + n.length + pack.length;
  }
  const cdb = Buffer.concat(cd), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(eintraege.length, 8); e.writeUInt16LE(eintraege.length, 10); e.writeUInt32LE(cdb.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...teile, cdb, e]);
}

const server = starteServer();
const browser = await chromium.launch();

// Test-PDFs erzeugen (erfundene Inhalte)
const pdfSeite = await browser.newPage();
await pdfSeite.setContent('<h1 style="font:40px Helvetica">Testplan EG</h1><div style="break-after:page"></div><h1>Seite 2</h1><div style="break-after:page"></div><h1>Seite 3</h1>');
const plan = await pdfSeite.pdf({ format: 'A4' });
await pdfSeite.setContent('<h1 style="font:40px Helvetica">Angebot Muster</h1><table border=1><tr><td>Fliese 60x60</td><td>49,90</td></tr></table>');
const angebot = await pdfSeite.pdf({ format: 'A4', landscape: true });
await pdfSeite.close();
const zipDatei = path.join(TMP, 'OneDrive_1_20-11-2026.zip');
fs.writeFileSync(zipDatei, zip([
  ['Notability/Auftrag/BV Teststraße 1/Pläne/EG.pdf', plan],
  ['Notability/Offen/Kunde Ä Muster/Angebot.pdf', angebot],
  ['Notability/Auftrag/BV Teststraße 1/Notiz.note', 'kein pdf'],
  ['__MACOSX/Notability/._x.pdf', 'müll'],
]));
const einzel = path.join(TMP, 'Rechnung 4711.pdf');
fs.writeFileSync(einzel, angebot);

const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, acceptDownloads: true });
const page = await ctx.newPage();
const logs = [];
page.on('pageerror', e => logs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') logs.push('console: ' + m.text()); });
await page.goto(server.url);
await page.waitForSelector('.baum-zeile');

const db = (fn) => page.evaluate(async fn => {
  const d = await new Promise(r => { const q = indexedDB.open('notizbuch'); q.onsuccess = () => r(q.result); });
  const alle = s => new Promise(r => { const q = d.transaction(s).objectStore(s).getAll(); q.onsuccess = () => r(q.result); });
  const x = { folders: await alle('folders'), notes: await alle('notes'), pages: await alle('pages'), files: await alle('files'), thumbs: await alle('thumbs') };
  d.close();
  return new Function('x', 'return ' + fn)(x);
}, fn);

async function uebernehmen(datei) {
  await page.click('[data-a=einstellungen]');
  const [wahl] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-a=notability]')]);
  await wahl.setFiles(datei);
  await page.waitForSelector('.dlg:not(.fortschritt) .primaer', { timeout: 30000 });
  const text = await page.locator('.dlg .dlg-text').innerText();
  await page.click('.dlg .primaer');
  return text;
}

// 1. Notability-ZIP übernehmen
let t = await uebernehmen(zipDatei);
console.log('     Meldung: ' + t.replace(/\n/g, ' | '));
pruefe(/2 Notizen übernommen/.test(t), 'ZIP: 2 Notizen übernommen');
const pfade = await db(`x.folders.map(f => { const p=[]; for (let g=f; g; g=x.folders.find(h=>h.id===g.parentId)) p.unshift(g.name); return p.join('/'); })`);
pruefe(pfade.includes('Auftrag/BV Teststraße 1/Pläne') && pfade.includes('Offen/Kunde Ä Muster'), 'Ordnerstruktur mit Umlauten übernommen');
pruefe(pfade.filter(p => p === 'Auftrag').length === 1 && !pfade.some(p => /notability|MACOSX/i.test(p)), 'Keine doppelten oder überflüssigen Ordner');
pruefe(await db(`x.files.length === 2 && x.thumbs.length === 2`), 'PDF-Dateien und Vorschaubilder gespeichert');
const seiten = await db(`x.pages.filter(p => p.bg).map(p => p.h).sort()`);
pruefe(seiten.length === 4 && seiten.includes(707) && seiten.filter(h => h === 1414).length === 3, 'Seiten: 3 × A4 hoch + 1 × quer');

// 2. Gleiche ZIP nochmal: nichts doppelt
t = await uebernehmen(zipDatei);
pruefe(/0 Notizen übernommen/.test(t) && /2 schon vorhanden/.test(t), 'Zweiter Import überspringt Vorhandenes');

// 3. PDF öffnen: 3 Seiten, PDF sichtbar, auf Seite 2 schreiben
await page.goto(server.url + '#/suche/EG');
await page.click('.karte [data-a=oeffnen]');
await page.waitForSelector('.ed-page canvas.bg');
await page.waitForTimeout(1500);
const dunkel = await page.evaluate(() => {
  const c = document.querySelector('.ed-page canvas.bg'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0; for (let i = 0; i < d.length; i += 16) if (d[i] < 100) n++; return n;
});
pruefe(dunkel > 50, 'PDF-Seite wird angezeigt');
pruefe(await page.locator('.ed-page').count() === 3, 'Drei Seiten untereinander');
pruefe(await page.locator('.ed-page canvas.base').count() < 3 * 1, 'Nur sichtbare Seiten haben Canvas (' + await page.locator('.ed-page canvas.base').count() + ')');
if (SHOT) await page.screenshot({ path: SHOT + '/7-pdf.png' });
await page.mouse.move(600, 500);
await page.mouse.wheel(0, 1500);
await page.waitForTimeout(300);
pruefe((await page.locator('.ed-seitenzahl').innerText()).startsWith('Seite 2'), 'Seitenanzeige „Seite 2 von 3“');
await page.evaluate(() => {
  const v = document.querySelector('.ed-view');
  const ev = (t, x, y) => v.dispatchEvent(new PointerEvent(t, { pointerType: 'pen', pointerId: 3, clientX: x, clientY: y, pressure: 0.6, bubbles: true, cancelable: true }));
  ev('pointerdown', 300, 400); for (let i = 1; i < 30; i++) ev('pointermove', 300 + i * 10, 400 + Math.sin(i / 3) * 20); ev('pointerup', 590, 400);
});
await page.waitForTimeout(800);
pruefe(await db(`x.pages.filter(p => p.bg && p.strokes.length === 1).length === 1 && x.pages.find(p => p.strokes.length).bg.seite === 2`), 'Strich auf PDF-Seite 2 gespeichert');
if (SHOT) await page.screenshot({ path: SHOT + '/8-pdf-beschriftet.png' });

// 4. Neue Seite anhängen
await page.mouse.wheel(0, 5000);
await page.click('.ed-add');
await page.waitForTimeout(500);
pruefe(await page.locator('.ed-page').count() === 4 && await db(`x.notes.find(n => n.title === 'EG').pageIds.length === 4`), 'Neue leere Seite angehängt und gespeichert');
await page.click('[data-a=back]');

// 5. Einzelne PDF über „Neu › PDF importieren“
await page.goto(server.url + '#/ordner/' + await db(`x.folders.find(f => f.name === 'Pläne').id`));
await page.click('[data-a=neu]');
const [wahl] = await Promise.all([page.waitForEvent('filechooser'), page.click('.menue [data-k=pdf]')]);
await wahl.setFiles(einzel);
await page.waitForSelector('.dlg:not(.fortschritt) .primaer', { timeout: 20000 });
await page.click('.dlg .primaer');
await page.waitForSelector('.ed-page canvas.bg');
pruefe(await page.locator('.ed-title').inputValue() === 'Rechnung 4711', 'Einzelne PDF importiert und geöffnet');
await page.click('[data-a=back]');
await page.waitForSelector('.karte img:not([hidden])');
if (SHOT) await page.screenshot({ path: SHOT + '/9-ordner-pdf.png' });

// 6. Sicherung als ZIP, alles löschen, wieder laden
await page.click('[data-a=einstellungen]');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-a=export]')]);
const sicherung = await dl.path();
pruefe(dl.suggestedFilename().endsWith('.zip'), 'Sicherung ist eine ZIP-Datei (' + Math.round(fs.statSync(sicherung).size / 1024) + ' KB)');
await page.evaluate(async () => {
  const d = await new Promise(r => { const q = indexedDB.open('notizbuch'); q.onsuccess = () => r(q.result); });
  await new Promise(r => { const t = d.transaction(['files', 'pages'], 'readwrite'); t.objectStore('files').clear(); t.objectStore('pages').clear(); t.oncomplete = r; });
  d.close();
});
await page.setInputFiles('#import-datei', sicherung);
await page.click('.dlg .gefahr');
await page.waitForSelector('.dlg:not(.fortschritt) .primaer', { timeout: 20000 });
await page.click('.dlg .primaer');
pruefe(await db(`x.files.length === 3 && x.pages.length === 6 && x.pages.some(p => p.strokes.length === 1)`), 'Sicherung geladen: PDFs, Seiten und Striche zurück');
await page.goto(server.url + '#/suche/EG');
await page.click('.karte [data-a=oeffnen]');
await page.waitForTimeout(1500);
const dunkel2 = await page.evaluate(() => {
  const c = document.querySelector('.ed-page canvas.bg'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0; for (let i = 0; i < d.length; i += 16) if (d[i] < 100) n++; return n;
});
pruefe(dunkel2 > 50, 'PDF nach Wiederherstellen sichtbar');

pruefe(logs.length === 0, 'Keine JavaScript-Fehler' + (logs.length ? ':\n  ' + logs.join('\n  ') : ''));
await browser.close();
server.close();
fs.rmSync(TMP, { recursive: true, force: true });
console.log(fehler ? `\n${fehler} Fehler` : '\nAlles OK');
process.exit(fehler ? 1 : 0);
