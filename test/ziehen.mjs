// Test Ziehen und Ablegen (lange drücken, ziehen): Ordner in Ordner, Hauptordner, Reihenfolge, Notiz einsortieren.
// node test/ziehen.mjs  (braucht Playwright)
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
page.on('console', m => { if (m.type() === 'error') logs.push(m.text()); });
await page.goto(server.url);
await page.waitForSelector('.baum-zeile');

const mitte = async (sel, anteil = 0.5) => { const b = await page.locator(sel).first().boundingBox(); return [b.x + b.width / 2, b.y + b.height * anteil]; };
async function ziehe(von, nach, { zwischen } = {}) {
  await page.mouse.move(...von); await page.mouse.down();
  await page.waitForTimeout(450);
  await page.mouse.move(von[0] + 20, von[1] + 10, { steps: 3 });
  if (zwischen) await zwischen();
  await page.mouse.move(...nach, { steps: 8 });
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.waitForTimeout(300);
}
const ordner = () => page.evaluate(async () => {
  const d = await new Promise(r => { const q = indexedDB.open('notizbuch'); q.onsuccess = () => r(q.result); });
  const a = await new Promise(r => { const q = d.transaction('folders').objectStore('folders').getAll(); q.onsuccess = () => r(q.result); });
  const n = await new Promise(r => { const q = d.transaction('notes').objectStore('notes').getAll(); q.onsuccess = () => r(q.result); });
  d.close();
  const pfad = f => { const p = []; for (let g = f; g; g = a.find(h => h.id === g.parentId)) p.unshift(g.name); return p.join('/'); };
  return { pfade: a.map(pfad), oben: a.filter(f => !f.parentId).sort((x, y) => x.sort - y.sort).map(f => f.name), notizen: n.map(x => pfad(a.find(f => f.id === x.folderId)) + '/' + x.title) };
});

// 1. Hauptordner "Whirlpools" in "Auftrag" ziehen → Unterordner
await ziehe(await mitte('.baum-zeile:has-text("Whirlpools")'), await mitte('.baum-zeile:has-text("Auftrag")'));
let o = await ordner();
pruefe(o.pfade.includes('Auftrag/Whirlpools'), 'Hauptordner in anderen Hauptordner gezogen → Unterordner');
pruefe(await page.locator('#hinweis.sichtbar').count() === 1, 'Hinweis „… → Auftrag“');

// 2. Kurz tippen ist weiter normales Öffnen, kein Ziehen
await page.click('.baum-zeile:has-text("Ablage")');
await page.waitForSelector('h1:has-text("Ablage")');
pruefe((await ordner()).pfade.includes('Ablage'), 'Kurz tippen öffnet nur');

// 3. Unterordner zurück auf "Ordner" (Überschrift) → wieder Hauptordner
if (await page.getAttribute('.baum-zeile:has-text("Auftrag")', 'aria-expanded') !== 'true') await page.click('.baum-zeile:has-text("Auftrag") [data-a=klapp]');
await page.waitForSelector('.baum-zeile:has-text("Whirlpools")');
await ziehe(await mitte('.baum-zeile:has-text("Whirlpools")'), await mitte('.side-kopf'));
o = await ordner();
pruefe(o.pfade.includes('Whirlpools') && !o.pfade.includes('Auftrag/Whirlpools'), 'Unterordner auf „Ordner“ gezogen → Hauptordner');

// 4. Reihenfolge: "Privat" an den oberen Rand von "Offen" → davor
await ziehe(await mitte('.baum-zeile:has-text("Privat")'), await mitte('.baum-zeile:has-text("Offen")', 0.12));
o = await ordner();
pruefe(o.oben.indexOf('Privat') === o.oben.indexOf('Offen') - 1, 'Reihenfolge geändert: „Privat“ vor „Offen“ (' + o.oben.join(', ') + ')');

// 5. Kachel in Ordneransicht auf Seitenleisten-Ordner ziehen
await page.click('.baum-zeile:has-text("Ablage")');
await page.click('[data-a=neu]'); await page.click('.menue [data-k=ordner]');
await page.fill('.dlg input', 'BV Ziehtest'); await page.click('.dlg .primaer');
await page.click('.baum-zeile:has-text("Ablage")');
await page.waitForSelector('.kachel:has-text("BV Ziehtest")');
await ziehe(await mitte('.kachel:has-text("BV Ziehtest")'), await mitte('.baum-zeile:has-text("Abgeschlossene BV")'));
pruefe((await ordner()).pfade.includes('Abgeschlossene BV/BV Ziehtest'), 'Unterordner-Kachel auf anderen Hauptordner gezogen');

// 6. Notiz-Karte in einen Ordner ziehen
await page.click('.baum-zeile:has-text("To Do")');
await page.click('[data-a=neu]'); await page.click('.menue [data-k="notiz:liniert"]');
await page.waitForSelector('.ed-title');
await page.fill('.ed-title', 'Zieh mich'); await page.press('.ed-title', 'Enter');
await page.click('[data-a=back]');
await page.waitForSelector('.karte:has-text("Zieh mich")');
await ziehe(await mitte('.karte:has-text("Zieh mich")'), await mitte('.baum-zeile:has-text("Mitarbeiter")'));
pruefe((await ordner()).notizen.includes('Mitarbeiter/Zieh mich'), 'Notiz auf Ordner gezogen → einsortiert');
if (SHOT) await page.screenshot({ path: SHOT + '/14-ziehen.png' });

// 7. Nicht erlaubt: Ordner in seinen eigenen Unterordner
await page.click('.baum-zeile:has-text("Abgeschlossene BV") [data-a=klapp]');
await page.waitForSelector('.baum-zeile:has-text("BV Ziehtest")');
await ziehe(await mitte('.baum-zeile:has-text("Abgeschlossene BV")'), await mitte('.baum-zeile:has-text("BV Ziehtest")'));
pruefe((await ordner()).pfade.includes('Abgeschlossene BV/BV Ziehtest'), 'Ordner lässt sich nicht in eigenen Unterordner ziehen');

// 8. Finger (Touch): lange halten, ziehen
const touch = async (von, nach) => page.evaluate(async ({ von, nach }) => {
  const el = document.elementFromPoint(...von);
  const ev = (z, t, [x, y]) => z.dispatchEvent(new PointerEvent(t, { pointerType: 'touch', pointerId: 31, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  ev(el, 'pointerdown', von);
  await new Promise(r => setTimeout(r, 550));
  for (let i = 1; i <= 8; i++) ev(document, 'pointermove', [von[0] + (nach[0] - von[0]) * i / 8, von[1] + (nach[1] - von[1]) * i / 8]);
  ev(document, 'pointerup', nach);
  await new Promise(r => setTimeout(r, 300));
}, { von, nach });
await touch(await mitte('.baum-zeile:has-text("Ecommerce")'), await mitte('.baum-zeile:has-text("Ausstellung")'));
pruefe((await ordner()).pfade.includes('Ausstellung/Ecommerce'), 'Mit dem Finger: lange halten und ziehen');

// 9. Maus: sofort ziehen, ohne vorher zu halten (wie am PC üblich)
await page.mouse.move(...await mitte('.baum-zeile:has-text("Team-Meeting")')); await page.mouse.down();
await page.mouse.move(...await mitte('.baum-zeile:has-text("Ablage")'), { steps: 10 });
await page.mouse.up(); await page.waitForTimeout(300);
pruefe((await ordner()).pfade.includes('Ablage/Team-Meeting'), 'Maus: klicken und sofort ziehen');

// 10. Mehrere auswählen: zwei BVs und eine Notiz auf einmal nach "Abgeschlossene BV"
await page.click('.baum-zeile:has-text("Auftrag")');
for (const n of ['BV Eins', 'BV Zwei', 'BV Drei']) {
  await page.click('[data-a=neu]'); await page.click('.menue [data-k=ordner]');
  await page.fill('.dlg input', n); await page.click('.dlg .primaer');
  await page.click('.baum-zeile:has-text("Auftrag") .nm');
}
await page.waitForSelector('.kachel:has-text("BV Drei")');
await page.click('[data-a=auswahl-an]');
await page.click('.kachel:has-text("BV Eins")');
await page.click('.kachel:has-text("BV Drei")');
pruefe((await page.locator('.auswahl-leiste b').innerText()) === '2 ausgewählt' && await page.locator('.kachel.gewaehlt').count() === 2, 'Auswahl: 2 Ordner markiert, öffnen nicht');
await page.click('.auswahl-leiste [data-x=move]');
await page.click('.dlg .baum-zeile:has-text("Abgeschlossene BV")');
await page.waitForTimeout(400);
o = await ordner();
pruefe(o.pfade.includes('Abgeschlossene BV/BV Eins') && o.pfade.includes('Abgeschlossene BV/BV Drei') && o.pfade.includes('Auftrag/BV Zwei'), 'Mehrere auf einmal nach „Abgeschlossene BV“ verschoben');
pruefe(await page.locator('.auswahl-leiste').count() === 0, 'Auswahl danach beendet');

pruefe(logs.length === 0, 'Keine JavaScript-Fehler' + (logs.length ? ':\n  ' + logs.join('\n  ') : ''));
await browser.close();
server.close();
console.log(fehler ? `\n${fehler} Fehler` : '\nAlles OK');
process.exit(fehler ? 1 : 0);
