// Test Badskizze: Sanitär-Symbole, Linie, Rechteck, Maßlinie, Auswählen/Verschieben/Drehen, Rückgängig.
// node test/skizze.mjs  (braucht Playwright)
import { createRequire } from 'node:module';
import { starteServer } from './server.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');

let fehler = 0;
const pruefe = (ok, text) => { console.log((ok ? 'OK   ' : 'FEHLER ') + text); if (!ok) fehler++; };
const SHOT = process.env.SHOT_DIR;
const server = starteServer();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
const logs = [];
page.on('pageerror', e => logs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') logs.push('console: ' + m.text()); });
await page.goto(server.url);
await page.waitForSelector('.logo');
pruefe(await page.evaluate(() => document.querySelector('.logo').naturalWidth > 100), 'Firmenlogo oben links');
await page.click('[data-a=neu]');
await page.click('.menue [data-k="notiz:mm"]');
await page.waitForSelector('.ed-page canvas.base');

const objekte = () => page.evaluate(async () => {
  const d = await new Promise(r => { const q = indexedDB.open('notizbuch'); q.onsuccess = () => r(q.result); });
  const ps = await new Promise(r => { const q = d.transaction('pages').objectStore('pages').getAll(); q.onsuccess = () => r(q.result); });
  d.close();
  return ps.flatMap(p => p.objects || []);
});
const zug = (typ, von, bis, id = 5) => page.evaluate(({ typ, von, bis, id }) => {
  const v = document.querySelector('.ed-view');
  const ev = (t, x, y) => v.dispatchEvent(new PointerEvent(t, { pointerType: typ, pointerId: id, clientX: x, clientY: y, pressure: 0.5, bubbles: true, cancelable: true }));
  ev('pointerdown', ...von);
  for (let i = 1; i <= 10; i++) ev('pointermove', von[0] + (bis[0] - von[0]) * i / 10, von[1] + (bis[1] - von[1]) * i / 10);
  ev('pointerup', ...bis);
}, { typ, von, bis, id });
const warte = () => page.waitForTimeout(600);

// Symbolleiste und WC einfügen
await page.click('[data-a=symbole]');
pruefe(await page.locator('.ed-symbole').isVisible(), 'Symbolleiste offen');
pruefe((await page.locator('[data-a=massstab]').innerText()).includes('1:20'), 'Maßstab 1:20 voreingestellt');
await page.click('[data-sym=wc]');
await warte();
let o = (await objekte())[0];
pruefe(o?.typ === 'symbol' && o.art === 'wc', 'WC eingefügt');
pruefe(Math.round(o.w / (10 / 20 * 1000 / 210)) === 37 && Math.round(o.h / (10 / 20 * 1000 / 210)) === 55, 'WC 37 × 55 cm bei 1:20');
pruefe(await page.locator('.ed-ctx').isVisible(), 'Kontextleiste sichtbar');

// Verschieben mit dem Stift (am Raster)
const box = await page.evaluate(() => { const r = document.querySelector('.ed-page').getBoundingClientRect(); return { x: r.left, y: r.top, k: r.width / 1000 }; });
const sx = box.x + o.x * box.k, sy = box.y + o.y * box.k;
await zug('pen', [sx, sy], [sx - 200, sy - 100]);
await warte();
const o2 = (await objekte())[0];
const R = 2.5 * 1000 / 210;
pruefe(o2.x < o.x - 150 && Math.abs(((o2.x - o2.w / 2) / R) - Math.round((o2.x - o2.w / 2) / R)) < 1e-6, 'Verschoben und am Raster eingerastet');

// 90° drehen, spiegeln, Maße, duplizieren
await page.click('.ed-ctx [data-k=drehen]'); await warte();
pruefe((await objekte())[0].rot === 90, 'Um 90° gedreht');
await page.click('.ed-ctx [data-k=spiegeln]'); await warte();
pruefe((await objekte())[0].spiegel === true, 'Gespiegelt');
await page.click('[data-sym=rinne]'); await warte();
await page.click('.ed-ctx [data-k=masse]');
await page.fill('.dlg input[name=b]', '160');
await page.fill('.dlg input[name=l]', '90');
await page.click('.dlg .primaer'); await warte();
let rinne = (await objekte()).find(x => x.art === 'rinne');
pruefe(Math.round(rinne.w / (10 / 20 * 1000 / 210)) === 160 && Math.round(rinne.h / (10 / 20 * 1000 / 210)) === 90, 'Dusche mit Rinne auf 160 × 90 cm geändert');
await page.click('.ed-ctx [data-k=dup]'); await warte();
pruefe((await objekte()).filter(x => x.art === 'rinne').length === 2, 'Dupliziert');
await page.click('.ed-ctx [data-k=del]'); await warte();
pruefe((await objekte()).filter(x => x.art === 'rinne').length === 1, 'Gelöscht');
await page.click('[data-a=undo]'); await warte();
pruefe((await objekte()).filter(x => x.art === 'rinne').length === 2, 'Rückgängig holt es zurück');
await page.click('[data-a=undo]'); await warte();

// Linie, Rechteck, Maß
await page.click('[data-tool=rechteck]');
await zug('pen', [box.x + 150 * box.k, box.y + 300 * box.k], [box.x + 850 * box.k, box.y + 800 * box.k]);
await page.click('[data-tool=linie]');
await zug('pen', [box.x + 150 * box.k, box.y + 900 * box.k], [box.x + 600 * box.k, box.y + 905 * box.k]);
await page.click('[data-tool=mass]');
await zug('pen', [box.x + 150 * box.k, box.y + 250 * box.k], [box.x + 850 * box.k, box.y + 250 * box.k]);
await warte();
const alle = await objekte();
const linie = alle.find(x => x.typ === 'linie');
pruefe(alle.some(x => x.typ === 'rechteck') && linie && alle.some(x => x.typ === 'mass'), 'Rechteck, Linie und Maßlinie gezeichnet');
pruefe(linie && linie.y1 === linie.y2, 'Linie waagrecht begradigt');

// Radierer löscht keine Objekte; Finger blättert im Auswahlmodus auf leerer Fläche
const vorher = (await objekte()).length;
await page.click('[data-tool=eraser]');
await zug('pen', [box.x + 150 * box.k, box.y + 300 * box.k], [box.x + 850 * box.k, box.y + 800 * box.k]);
await warte();
pruefe((await objekte()).length === vorher, 'Radierer lässt Symbole und Linien stehen');
await page.click('[data-tool=auswahl]');
if (SHOT) await page.screenshot({ path: SHOT + '/10-skizze.png' });
await page.click('[data-a=back]');
await page.waitForSelector('.karte img:not([hidden])');
if (SHOT) await page.screenshot({ path: SHOT + '/11-ordner.png' });

pruefe(logs.length === 0, 'Keine JavaScript-Fehler' + (logs.length ? ':\n  ' + logs.join('\n  ') : ''));
await browser.close();
server.close();
console.log(fehler ? `\n${fehler} Fehler` : '\nAlles OK');
process.exit(fehler ? 1 : 0);
