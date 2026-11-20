// Rauchtest: node test/smoke.mjs  (startet eigenen kleinen Server, braucht Playwright)
// Prüft: Start, Ordner anlegen, Notiz mit Stift schreiben, Speichern, Neu laden, Radierer, Rückgängig,
// Finger blättert statt zu schreiben, Sicherung exportieren/laden, Offline-Start über den Service Worker.
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPEN = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, r) => {
  let p = decodeURIComponent(new URL(q.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': TYPEN[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
}).listen(0);
const URL_ = `http://localhost:${server.address().port}/`;
const SHOT = process.env.SHOT_DIR;

let fehler = 0;
const pruefe = (ok, text) => { console.log((ok ? 'OK   ' : 'FEHLER ') + text); if (!ok) fehler++; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1, acceptDownloads: true });
const page = await ctx.newPage();
const logs = [];
page.on('pageerror', e => logs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') logs.push('console: ' + m.text()); });

await page.goto(URL_);
await page.waitForSelector('.baum-zeile');
pruefe(await page.locator('.baum-zeile').count() === 11, 'Startordner angelegt (11)');
if (SHOT) await page.screenshot({ path: SHOT + '/1-start.png' });

// Unterordner in "Auftrag"
await page.click('.baum-zeile:has-text("Auftrag")');
await page.click('[data-a=neu]');
await page.click('.menue [data-k=ordner]');
await page.fill('.dlg input', 'BV Musterweg 1');
await page.click('.dlg .primaer');
await page.waitForSelector('h1:has-text("BV Musterweg 1")');
pruefe(true, 'Unterordner angelegt');

// Neue Notiz kariert
await page.click('[data-a=neu]');
await page.click('.menue [data-k="notiz:kariert"]');
await page.waitForSelector('.ed-view canvas.base');
await page.waitForTimeout(200);

// Stift-Striche (synthetische Pointer Events mit Druck)
async function strich(typ, punkte, id = 7) {
  await page.evaluate(({ typ, punkte, id }) => {
    const v = document.querySelector('.ed-view');
    const ev = (t, [x, y], p) => v.dispatchEvent(new PointerEvent(t, { pointerType: typ, pointerId: id, clientX: x, clientY: y, pressure: p, bubbles: true, cancelable: true, buttons: t === 'pointerup' ? 0 : 1 }));
    ev('pointerdown', punkte[0], 0.4);
    for (let i = 1; i < punkte.length; i++) ev('pointermove', punkte[i], 0.3 + 0.5 * i / punkte.length);
    ev('pointerup', punkte.at(-1), 0);
  }, { typ, punkte, id });
}
const welle = (x0, y0) => Array.from({ length: 40 }, (_, i) => [x0 + i * 8, y0 + Math.sin(i / 3) * 15]);
await strich('pen', welle(200, 300));
await strich('pen', welle(200, 380));
const anzahl = () => page.evaluate(async () => {
  const d = await new Promise(r => { const q = indexedDB.open('notizbuch'); q.onsuccess = () => r(q.result); });
  const ps = await new Promise(r => { const q = d.transaction('pages').objectStore('pages').getAll(); q.onsuccess = () => r(q.result); });
  d.close();
  return ps.map(p => p.strokes.length).reduce((a, b) => a + b, 0);
});
await page.waitForTimeout(700);
pruefe(await anzahl() === 2, 'Zwei Stift-Striche gespeichert');

// Finger zeichnet im "Nur Stift"-Modus nicht, sondern blättert
const vorher = await page.evaluate(() => getComputedStyle(document.querySelector('.ed-stack')).transform);
await strich('touch', Array.from({ length: 10 }, (_, i) => [600, 600 - i * 30]), 9);
await page.waitForTimeout(700);
const nachher = await page.evaluate(() => getComputedStyle(document.querySelector('.ed-stack')).transform);
pruefe(await anzahl() === 2 && vorher !== nachher, 'Finger blättert und schreibt nicht');
await page.mouse.wheel(0, -2000);

// Radierer, dann Rückgängig
await page.click('[data-tool=eraser]');
await strich('pen', [[260, 290], [262, 302], [264, 310]]);
await page.waitForTimeout(700);
pruefe(await anzahl() === 1, 'Radierer löscht ganzen Strich');
await page.click('[data-a=undo]');
await page.waitForTimeout(700);
pruefe(await anzahl() === 2, 'Rückgängig stellt Strich wieder her');
await page.click('[data-tool=marker]');
await strich('pen', welle(200, 340));
await page.click('[data-tool=pen]');
await page.fill('.ed-title', 'Badskizze Test');
await page.press('.ed-title', 'Enter');
if (SHOT) await page.screenshot({ path: SHOT + '/2-editor.png' });

// Zurück: Vorschaukarte da
await page.click('[data-a=back]');
await page.waitForSelector('.karte img:not([hidden])', { timeout: 5000 });
pruefe(await page.locator('.karte b:has-text("Badskizze Test")').count() === 1, 'Vorschaukarte mit Titel und Bild');
if (SHOT) await page.screenshot({ path: SHOT + '/3-ordner.png' });

// Neu laden: Daten bleiben
await page.reload();
await page.waitForSelector('.karte');
pruefe(await anzahl() === 3, 'Nach Neuladen alles noch da (3 Striche)');

// Sicherung exportieren
await page.click('[data-a=einstellungen]');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-a=sicherung]')]);
const datei = await dl.path();
const inhalt = fs.readFileSync(datei);
pruefe(dl.suggestedFilename().endsWith('.zip') && inhalt.includes('notizbuch.json') && inhalt.includes('"format":"notizbuch-sicherung"'), 'Sicherung exportiert (ZIP)');
if (SHOT) await page.screenshot({ path: SHOT + '/4-einstellungen.png' });

// Notiz löschen, dann Sicherung wieder laden
await page.goto(URL_ + '#/suche/Badskizze');
await page.click('.karte [data-a=notiz-menue]');
await page.click('.menue [data-k=del]');
await page.click('.dlg .gefahr');
await page.waitForTimeout(300);
pruefe(await anzahl() === 0, 'Notiz gelöscht');
await page.click('[data-a=einstellungen]');
await page.setInputFiles('#import-datei', datei);
await page.click('.dlg .gefahr');
await page.waitForSelector('.dlg:not(.fortschritt) .primaer');
await page.click('.dlg .primaer');
await page.waitForTimeout(300);
pruefe(await anzahl() === 3, 'Sicherung geladen (3 Striche zurück)');

// Ordner verschieben: BV nach "Offen"
if (await page.getAttribute('.baum-zeile:has-text("Auftrag")', 'aria-expanded') !== 'true') await page.click('.baum-zeile:has-text("Auftrag") [data-a=klapp]');
await page.click('.baum-zeile:has-text("BV Musterweg 1")');
await page.click('[data-a=ordner-menue]');
await page.click('.menue [data-k=move]');
await page.click('.dlg .baum-zeile:has-text("Offen")');
await page.waitForTimeout(200);
pruefe((await page.locator('.krumen').innerText()).includes('Offen'), 'Ordner nach „Offen“ verschoben');

// Offline: Service Worker aktiv, dann ohne Netz neu laden
await page.goto(URL_);
await page.evaluate(() => navigator.serviceWorker.ready);
await page.waitForTimeout(500);
await ctx.setOffline(true);
await page.reload();
await page.waitForSelector('.baum-zeile', { timeout: 5000 });
pruefe(await page.locator('.baum-zeile').count() >= 11, 'Startet offline');
await ctx.setOffline(false);

pruefe(logs.length === 0, 'Keine JavaScript-Fehler' + (logs.length ? ':\n  ' + logs.join('\n  ') : ''));
await browser.close();
server.close();
console.log(fehler ? `\n${fehler} Fehler` : '\nAlles OK');
process.exit(fehler ? 1 : 0);
