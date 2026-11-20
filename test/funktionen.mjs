// Test Version 0.4: Vorlage Beratungsgespräch, Begradigen durch Halten, Badewanne, Textfeld, Foto,
// Lasso, Zoomen mit zwei Fingern, PDF-Export.  node test/funktionen.mjs  (braucht Playwright)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { starteServer } from './server.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');

let fehler = 0;
const pruefe = (ok, text) => { console.log((ok ? 'OK   ' : 'FEHLER ') + text); if (!ok) fehler++; };
const SHOT = process.env.SHOT_DIR;
const server = starteServer();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 820 }, acceptDownloads: true });
const logs = [];
page.on('pageerror', e => logs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') logs.push('console: ' + m.text()); });
await page.goto(server.url);
await page.waitForSelector('.baum-zeile');

const seiten = () => page.evaluate(async () => {
  const d = await new Promise(r => { const q = indexedDB.open('notizbuch'); q.onsuccess = () => r(q.result); });
  const ps = await new Promise(r => { const q = d.transaction('pages').objectStore('pages').getAll(); q.onsuccess = () => r(q.result); });
  const fs_ = await new Promise(r => { const q = d.transaction('files').objectStore('files').getAll(); q.onsuccess = () => r(q.result.map(f => f.type)); });
  d.close();
  return { ps, files: fs_ };
});
const ev = (liste) => page.evaluate(liste => {
  const v = document.querySelector('.ed-view');
  for (const [t, typ, id, x, y] of liste) v.dispatchEvent(new PointerEvent(t, { pointerType: typ, pointerId: id, clientX: x, clientY: y, pressure: 0.5, bubbles: true, cancelable: true }));
}, liste);
const warte = (ms = 600) => page.waitForTimeout(ms);
const box = () => page.evaluate(() => { const r = document.querySelector('.ed-page').getBoundingClientRect(); return { x: r.left, y: r.top, k: r.width / 1000 }; });

// 1. Vorlage Beratungsgespräch
await page.click('[data-a=neu]');
await page.click('.menue [data-k="vorlage:beratung"]');
await page.waitForSelector('.ed-page canvas.base');
await warte();
let { ps } = await seiten();
const texte = ps[0].objects.filter(o => o.typ === 'text').map(o => o.text);
pruefe(texte.includes('Kunde') && texte.includes('Nächster Schritt') && texte.includes('Beratungsgespräch'), 'Vorlage Beratungsgespräch mit Feldern');
pruefe((await page.locator('.ed-title').inputValue()).startsWith('Beratung '), 'Titel „Beratung <Datum>“');
if (SHOT) await page.screenshot({ path: SHOT + '/12-beratung.png' });

// 2. Begradigen: wackelig ziehen, Stift halten
let b = await box();
const wackel = Array.from({ length: 20 }, (_, i) => ['pointermove', 'pen', 4, b.x + 200 + i * 15, b.y + 900 + Math.sin(i) * 6]);
await ev([['pointerdown', 'pen', 4, b.x + 200, b.y + 900], ...wackel]);
await warte(700);
await ev([['pointermove', 'pen', 4, b.x + 600, b.y + 901], ['pointerup', 'pen', 4, b.x + 600, b.y + 901]]);
await warte();
({ ps } = await seiten());
let s = ps[0].strokes.at(-1);
pruefe(s && s.pts.length === 6 && Math.abs(s.pts[1] - s.pts[4]) < 0.01, 'Stift halten macht den Strich gerade (und waagrecht)');
await ev([['pointerdown', 'pen', 5, b.x + 200, b.y + 980], ...Array.from({ length: 20 }, (_, i) => ['pointermove', 'pen', 5, b.x + 200 + i * 15, b.y + 980 + Math.sin(i) * 6]), ['pointerup', 'pen', 5, b.x + 500, b.y + 980]]);
await warte();
({ ps } = await seiten());
pruefe(ps[0].strokes.at(-1).pts.length > 6, 'Ohne Halten bleibt es Handschrift');

// 3. Textfeld
await page.click('[data-tool=text]');
await page.mouse.click(b.x + 300, 600);
await page.fill('.dlg textarea', 'Fliese 60x120\nanthrazit');
await page.click('.dlg .primaer');
await warte();
({ ps } = await seiten());
pruefe(ps[0].objects.some(o => o.typ === 'text' && o.text.includes('anthrazit')), 'Textfeld angelegt');

// 4. Badewanne
await page.click('[data-a=symbole]');
await page.click('[data-sym=wanne]');
await warte();
({ ps } = await seiten());
const wanne = ps[0].objects.find(o => o.art === 'wanne');
pruefe(wanne && Math.round(wanne.w / (10 / 20 * 1000 / 210)) === 170, 'Badewanne 170 × 75 cm');
await page.click('.ed-ctx [data-k=del]');

// 5. Foto einfügen
const png = await page.screenshot({ clip: { x: 0, y: 0, width: 300, height: 200 } });
fs.writeFileSync('/tmp/nb-foto.png', png);
const [wahl] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-a=foto]')]);
await wahl.setFiles('/tmp/nb-foto.png');
await page.waitForSelector('.ed-ctx:not([hidden]) [data-k=del]', { timeout: 10000 });
await warte(700);
let f;
({ ps, files: f } = await seiten());
pruefe(ps[0].objects.some(o => o.typ === 'bild') && f.includes('image/jpeg'), 'Foto eingefügt und gespeichert ' + JSON.stringify(f) + ' ' + await page.locator('.ed-status').innerText());
await page.click('.ed-ctx [data-k=del]');
await warte();

// 6. Lasso: Handschrift einkreisen, verschieben, löschen, rückgängig
await page.mouse.wheel(0, -3000);
await warte(200);
b = await box();
await page.click('[data-tool=pen]');
await ev([['pointerdown', 'pen', 6, b.x + 600, b.y + 700], ...Array.from({ length: 10 }, (_, i) => ['pointermove', 'pen', 6, b.x + 600 + i * 8, b.y + 700 + i * 3]), ['pointerup', 'pen', 6, b.x + 680, b.y + 730]]);
await warte();
({ ps } = await seiten());
const anzahl = ps[0].strokes.length, vorherX = ps[0].strokes.at(-1).pts[0];
await page.click('[data-tool=lasso]');
const kreis = Array.from({ length: 24 }, (_, i) => ['pointermove', 'pen', 7, b.x + 640 + Math.cos(i / 23 * Math.PI * 2) * 80, b.y + 715 + Math.sin(i / 23 * Math.PI * 2) * 50]);
await ev([['pointerdown', 'pen', 7, b.x + 720, b.y + 715], ...kreis, ['pointerup', 'pen', 7, b.x + 720, b.y + 715]]);
await warte(300);
pruefe(await page.locator('.ed-ctx').isVisible(), 'Lasso: Auswahl mit Leiste');
await ev([['pointerdown', 'pen', 8, b.x + 640, b.y + 715], ['pointermove', 'pen', 8, b.x + 700, b.y + 780], ['pointermove', 'pen', 8, b.x + 740, b.y + 815], ['pointerup', 'pen', 8, b.x + 740, b.y + 815]]);
await warte();
({ ps } = await seiten());
pruefe(Math.abs(ps[0].strokes.at(-1).pts[0] - vorherX - 100 / b.k) < 2, 'Lasso: verschoben');
await page.click('.ed-ctx [data-k=del]');
await warte();
({ ps } = await seiten());
pruefe(ps[0].strokes.length === anzahl - 1, 'Lasso: gelöscht');
await page.click('[data-a=undo]');
await warte();
({ ps } = await seiten());
pruefe(ps[0].strokes.length === anzahl, 'Lasso: Rückgängig');

// 7. Zoomen mit zwei Fingern
await page.click('[data-tool=pen]');
await ev([['pointerdown', 'touch', 21, 500, 500], ['pointerdown', 'touch', 22, 600, 500],
  ['pointermove', 'touch', 22, 700, 500], ['pointermove', 'touch', 21, 400, 500], ['pointerup', 'touch', 21, 400, 500], ['pointerup', 'touch', 22, 700, 500]]);
await warte(400);
const z = await page.locator('.ed-zoom').innerText();
pruefe(await page.locator('.ed-zoom').isVisible() && parseInt(z) > 250, 'Zwei Finger zoomen (' + z + ')');
({ ps } = await seiten());
pruefe(ps[0].strokes.length === anzahl, 'Zoomen zeichnet nichts');
const kacheln = await page.locator('.ed-page canvas.base').count();
pruefe(kacheln <= 20, 'Gezoomt nur sichtbare Kacheln (' + kacheln + ')');
const scharf = await page.evaluate(() => { const c = document.querySelector('.ed-page canvas.base'); return c.width / parseFloat(c.style.width); });
pruefe(scharf >= 1, 'Kacheln in voller Auflösung');
if (SHOT) await page.screenshot({ path: SHOT + '/13-zoom.png' });
await page.click('.ed-zoom');
await warte(300);
pruefe(await page.locator('.ed-zoom').isHidden(), 'Zoom zurück auf 100 %');

// 8. PDF-Export
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-a=export]')]);
const pdf = fs.readFileSync(await dl.path());
fs.writeFileSync('/tmp/nb-export.pdf', pdf);
pruefe(dl.suggestedFilename().endsWith('.pdf') && pdf.subarray(0, 5).toString() === '%PDF-' && /\/Count 1/.test(pdf.toString('latin1')), 'PDF exportiert (' + Math.round(pdf.length / 1024) + ' KB)');
// PDF mit pdf.js wieder öffnen
const ok = await page.evaluate(async b64 => {
  const lib = await import('./vendor/pdfjs/pdf.min.mjs');
  lib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.mjs';
  const d = await lib.getDocument({ data: Uint8Array.from(atob(b64), c => c.charCodeAt(0)) }).promise;
  return d.numPages;
}, pdf.toString('base64'));
pruefe(ok === 1, 'Exportiertes PDF lässt sich öffnen');
fs.writeFileSync('/tmp/nb-export.pdf', pdf);

pruefe(logs.length === 0, 'Keine JavaScript-Fehler' + (logs.length ? ':\n  ' + logs.join('\n  ') : ''));
await browser.close();
server.close();
console.log(fehler ? `\n${fehler} Fehler` : '\nAlles OK');
process.exit(fehler ? 1 : 0);
