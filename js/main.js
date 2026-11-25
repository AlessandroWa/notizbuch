// Oberfläche: Seitenleiste, Ordneransicht, Suche, Einstellungen, Editor. Navigation über #-Adressen.
import * as store from './store.js';
import * as ui from './ui.js';
import { exportiere, lies, stelleWiederHer } from './backup.js';
import { importiere, importiereAusOneDrive, ordnungWiederherstellen } from './import.js';
import { VORLAGEN } from './vorlagen.js';
import { notizAlsPdf } from './pdfexport.js';
import { makeThumb } from './vorschau.js';
import * as sync from './sync.js';
import { ziehenEinrichten } from './ziehen.js';
import { openEditor } from './editor.js';
import { PAPIERE } from './ink.js';
import { esc, datum, VERSION } from './util.js';

const side = document.getElementById('side');
const main = document.getElementById('main');
const SVG = {
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 2.8l1.6 2.3 2.7-.7.7 2.7 2.6 1-.9 2.6 1.8 2.1-2.2 1.7.3 2.8-2.8.2-1.2 2.5-2.5-1.2L12 21.2l-1.6-2.3-2.7.7-.7-2.7-2.6-1 .9-2.6L3.5 11l2.2-1.7-.3-2.8 2.8-.2 1.2-2.5 2.5 1.2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  lupe: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15.5 15.5L21 21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  mehr: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5.5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="18.5" cy="12" r="1.8" fill="currentColor"/></svg>',
  chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

// ---------- Zustand ----------
const offen = new Set(JSON.parse(localStorage.getItem('nb.offen') || '[]'));
const merkeOffen = () => localStorage.setItem('nb.offen', JSON.stringify([...offen]));
let editor = null;
let offeneNotiz = null;
let aktuellerOrdner = null;

const route = () => {
  const [, art = '', wert = ''] = location.hash.match(/^#\/([^/]*)\/?(.*)$/) || [];
  return { art, wert: decodeURIComponent(wert) };
};
const geh = (h, ersetzen = false) => {
  if (location.hash === h) return render();
  if (ersetzen) { history.replaceState(null, '', h); render(); } else location.hash = h;
};

// ---------- Seitenleiste ----------
function zeichneSeite() {
  const { art, wert } = route();
  const aktiv = art === 'ordner' ? wert : null;
  if (aktiv) for (const f of store.path(aktiv).slice(0, -1)) offen.add(f.id);
  const zeilen = [];
  const lauf = (pid, tiefe) => {
    for (const f of store.children(pid)) {
      const kinder = store.children(f.id).length > 0;
      const auf = offen.has(f.id);
      zeilen.push(`<div class="baum-zeile${f.id === aktiv ? ' aktiv' : ''}" data-ordner="${f.id}" data-zieh="ordner:${f.id}" style="padding-left:${14 + tiefe * 18}px" role="treeitem" ${kinder ? `aria-expanded="${auf}"` : ''}>
        <span class="dot" style="background:${f.color}"></span><span class="nm">${esc(f.name)}</span>
        ${kinder ? `<button class="chev${auf ? ' auf' : ''}" data-a="klapp" data-id="${f.id}" aria-label="${auf ? 'Zuklappen' : 'Aufklappen'}">${SVG.chev}</button>` : ''}
      </div>`);
      if (kinder && auf) lauf(f.id, tiefe + 1);
    }
  };
  lauf(null, 0);
  const q = art === 'suche' ? wert : '';
  side.innerHTML = `
    <div class="side-oben">
      <img class="logo" src="icons/logo-walz.svg" alt="WALZ">
      <button class="rund" data-a="einstellungen" aria-label="Einstellungen" title="Einstellungen">${SVG.gear}</button>
    </div>
    <label class="suche">${SVG.lupe}<input type="search" id="suche" placeholder="Suchen" value="${esc(q)}" autocomplete="off" enterkeyhint="search"></label>
    <div class="side-kopf" data-ziel="oben"><span>Ordner</span><button class="rund" data-a="neuer-ordner" aria-label="Neuer Ordner" title="Neuer Ordner">${SVG.plus}</button></div>
    <nav class="baum" role="tree" aria-label="Ordner">${zeilen.join('')}</nav>
    <button class="sync-zeile" id="sync-zeile" data-a="einstellungen" hidden></button>`;
  zeigeSync();
}

// Statuszeile OneDrive (unten in der Seitenleiste und in den Einstellungen)
function syncText() {
  const st = sync.status;
  if (!sync.eingerichtet()) return '';
  if (!st.angemeldet) return st.fehler || 'OneDrive: nicht angemeldet';
  if (st.laeuft) return 'OneDrive: wird abgeglichen …';
  if (st.fehler) return st.fehler;
  if (!navigator.onLine) return st.ausstehend ? 'Offline: Änderungen werden später hochgeladen' : 'Offline';
  if (st.ausstehend) return 'OneDrive: Änderungen werden hochgeladen …';
  if (st.zuletzt) return 'OneDrive: abgeglichen ' + new Date(st.zuletzt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return 'OneDrive: verbunden';
}
function zeigeSync() {
  const t = syncText();
  const z = document.getElementById('sync-zeile');
  if (z) { z.hidden = !t; z.textContent = t; z.classList.toggle('warnung', !!sync.status.fehler || !sync.status.angemeldet); }
  const e = document.getElementById('sync-status');
  if (e) e.textContent = t || 'Noch nicht eingerichtet.';
}
window.addEventListener('online', zeigeSync);
window.addEventListener('offline', zeigeSync);

side.addEventListener('click', async e => {
  const a = e.target.closest('[data-a]')?.dataset.a;
  if (a === 'klapp') {
    const id = e.target.closest('[data-a]').dataset.id;
    offen.has(id) ? offen.delete(id) : offen.add(id);
    merkeOffen(); zeichneSeite(); return;
  }
  if (a === 'einstellungen') { schliesseSeite(); return geh('#/einstellungen'); }
  if (a === 'neuer-ordner') return neuerOrdner(null);
  const z = e.target.closest('[data-ordner]');
  if (z) { schliesseSeite(); geh('#/ordner/' + z.dataset.ordner); }
});
side.addEventListener('input', e => {
  if (e.target.id !== 'suche') return;
  const q = e.target.value;
  const h = q.trim() ? '#/suche/' + encodeURIComponent(q) : '#/ordner/' + (aktuellerOrdner || store.todoId());
  history.replaceState(null, '', h);
  zeichneHaupt();
});
// ---------- Updates ----------
// Neue Version liegt bereit, sobald der neue Service Worker übernimmt. Dann neu laden – aber nie mitten
// im Schreiben: im Editor wird gewartet, bis die Notiz verlassen wird.
let swReg = null, updateBereit = false;
async function updatesEinrichten() {
  const hatteSchon = !!navigator.serviceWorker.controller;
  try { swReg = await navigator.serviceWorker.register('./sw.js'); } catch (err) { console.warn('Service Worker:', err); return; }
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hatteSchon) return; // allererste Installation: nichts zu tun
    updateBereit = true;
    if (!editor) location.reload();
    else hinweis('Neue Version geladen – wird nach dem Schließen der Notiz aktiv');
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') swReg?.update().catch(() => {}); });
}
async function nachUpdateSuchen() {
  if (!swReg) return ui.meldung('Updates gibt es nur in der installierten App (über https).');
  hinweis('Suche nach Update …');
  try { await swReg.update(); } catch { return ui.meldung('Keine Verbindung. Bitte später nochmal versuchen.'); }
  setTimeout(() => { if (!updateBereit && !swReg.installing && !swReg.waiting) ui.meldung(`Du hast die neueste Version (${VERSION}).`); }, 2500);
}

// Kurzer Hinweis unten in der Mitte
function hinweis(text) {
  let t = document.getElementById('hinweis');
  if (!t) { t = document.createElement('div'); t.id = 'hinweis'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.textContent = text;
  t.classList.add('sichtbar');
  clearTimeout(t.uhr);
  t.uhr = setTimeout(() => t.classList.remove('sichtbar'), 2500);
}

const schliesseSeite = () => document.body.classList.remove('side-offen');

// ---------- Hauptbereich ----------
const zaehler = id => {
  const n = store.notesIn(id).length, o = store.children(id).length;
  const t = n === 0 ? 'keine Notiz' : n === 1 ? 'eine Notiz' : `${n} Notizen`;
  return o ? `${t} · ${o} Ordner` : t;
};

const kachel = f => `<button class="kachel" data-ordner="${f.id}" data-zieh="ordner:${f.id}"><span class="dot" style="background:${f.color}"></span><b>${esc(f.name)}</b><span>${zaehler(f.id)}</span></button>`;

const karte = (n, unterzeile = datum(n.updatedAt)) => `<article class="karte" data-notiz="${n.id}" data-zieh="notiz:${n.id}">
  <button class="karte-bild" data-a="oeffnen" aria-label="${esc(n.title)} öffnen"><img alt="" data-thumb="${n.id}" hidden></button>
  <div class="karte-fuss">
    <div class="karte-text"><b>${esc(n.title)}</b><span>${esc(unterzeile)}</span></div>
    <button class="rund klein" data-a="notiz-menue" aria-label="Aktionen für ${esc(n.title)}">${SVG.mehr}</button>
  </div>
</article>`;

const kopf = (crumbs, knoepfe) => `<header class="kopf">
  <button class="rund nur-schmal" data-a="seite" aria-label="Ordner anzeigen">${SVG.menu}</button>
  <nav class="krumen" aria-label="Pfad">${crumbs}</nav>
  <div class="kopf-knoepfe">${knoepfe}</div>
</header>`;

const neuKnopf = '<button class="neu" data-a="neu">' + SVG.plus + '<span>Neu</span></button>';

function zeichneOrdner(id) {
  const f = store.folder(id);
  if (!f) return geh('#/ordner/' + store.todoId(), true);
  aktuellerOrdner = id;
  localStorage.setItem('nb.zuletzt', id);
  const pfad = store.path(id).slice(0, -1);
  const unter = store.children(id), notizen = store.notesIn(id);
  main.innerHTML = kopf(
    pfad.map(p => `<a href="#/ordner/${p.id}">${esc(p.name)}</a>`).join('<span>›</span>'),
    `<button class="rund" data-a="ordner-menue" aria-label="Ordner-Aktionen" title="Ordner-Aktionen">${SVG.mehr}</button>${neuKnopf}`) +
    `<h1><span class="dot gross" style="background:${f.color}"></span>${esc(f.name)}</h1>
    ${unter.length ? `<section class="kacheln" aria-label="Unterordner">${unter.map(kachel).join('')}</section>` : ''}
    ${notizen.length ? `<section class="karten" aria-label="Notizen">${notizen.map(n => karte(n)).join('')}</section>`
      : `<p class="leer">${f.system === 'todo' ? 'Hier landen neue Notizen, bis du sie einsortierst.' : 'Noch keine Notizen in diesem Ordner.'}<br>Tippe oben rechts auf „Neu“.</p>`}`;
  ladeVorschauen();
}

function zeichneSuche(q) {
  const s = q.trim().toLocaleLowerCase('de');
  const ordner = [...store.state.folders.values()].filter(f => f.name.toLocaleLowerCase('de').includes(s));
  const notizen = [...store.state.notes.values()].filter(n =>
    n.title.toLocaleLowerCase('de').includes(s) || store.path(n.folderId).some(f => f.name.toLocaleLowerCase('de').includes(s)))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  main.innerHTML = kopf('<span>Suche</span>', neuKnopf) + `<h1>„${esc(q.trim())}“</h1>
    ${ordner.length ? `<section class="kacheln">${ordner.map(kachel).join('')}</section>` : ''}
    ${notizen.length ? `<section class="karten">${notizen.map(n => karte(n, store.path(n.folderId).map(f => f.name).join(' › ') + ' · ' + datum(n.updatedAt))).join('')}</section>` : ''}
    ${!ordner.length && !notizen.length ? '<p class="leer">Nichts gefunden. Gesucht wird in Titeln und Ordnernamen.</p>' : ''}`;
  ladeVorschauen();
}

async function zeichneEinstellungen() {
  main.innerHTML = kopf('<span>Einstellungen</span>', '') + `<h1>Einstellungen</h1>
  <section class="einst">
    <h2>OneDrive-Abgleich</h2>
    ${sync.eingerichtet() ? `
      <p id="sync-status"></p>
      <p>${sync.status.angemeldet ? `Angemeldet${sync.status.konto ? ' als ' + esc(sync.status.konto) : ''}. Alles wird im OneDrive-Ordner „Notizbuch“ gespeichert und mit deinen anderen Geräten abgeglichen.` : 'Mit dem Firmenkonto anmelden, dann werden alle Notizen automatisch im OneDrive-Ordner „Notizbuch“ gespeichert.'}</p>
      <div class="reihe">${sync.status.angemeldet
        ? '<button class="knopf primaer" data-a="sync-jetzt">Jetzt abgleichen</button><button class="knopf" data-a="sync-ab">Abmelden</button>'
        : '<button class="knopf primaer" data-a="sync-an">Bei OneDrive anmelden</button>'}</div>`
    : `<p>Noch nicht eingerichtet. Dafür muss die App einmal im Microsoft-Konto der Firma registriert werden (Anleitung in der README auf GitHub). Danach hier die Anwendungs-ID (Client-ID) eintragen.</p>`}
    <details class="erweitert"${sync.eingerichtet() ? '' : ' open'}><summary>Einrichtung (Client-ID)</summary>
      <label>Anwendungs-ID (Client)<input id="sync-client" value="${esc(sync.konfig().clientId)}" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autocomplete="off"></label>
      <label>Verzeichnis (Mandant)<input id="sync-mandant" value="${esc(sync.konfig().mandant)}" autocomplete="off"></label>
      <p class="klein">Umleitungs-URI für die Registrierung: <code>${esc(sync.rueckAdresse())}</code></p>
      <button class="knopf" data-a="sync-konfig">Speichern</button>
    </details>
    <h2>Aus Notability übernehmen</h2>
    <p>In OneDrive den Ordner „Notability“ herunterladen (ergibt eine ZIP-Datei) und hier auswählen. Die Ordner werden übernommen, jede PDF wird eine Notiz, auf der du weiterschreiben kannst. Schon übernommene Notizen werden übersprungen, du kannst also jederzeit nachholen. Deine eigene Sortierung bleibt erhalten: Neue Notizen kommen dorthin, wo die übrigen Notizen aus demselben Notability-Ordner bei dir jetzt liegen.</p>
    <div class="reihe">${sync.eingerichtet() && sync.status.angemeldet ? '<button class="knopf primaer" data-a="notability-od">Aus OneDrive übernehmen</button>' : ''}
    <button class="knopf${sync.status.angemeldet ? '' : ' primaer'}" data-a="notability">ZIP oder PDFs auswählen …</button>
    <button class="knopf" data-a="ordnung">Notfall: alles zurück wie in Notability</button></div>
    <h2>Sicherung</h2>
    <p>Alle Ordner, Notizen und PDFs in eine ZIP-Datei sichern, z. B. in „Dateien“ auf dem iPad oder auf dem Mac. Mit „Sicherung laden“ lässt sie sich auf jedem Gerät wieder einspielen.</p>
    <div class="reihe"><button class="knopf primaer" data-a="sicherung">Sicherung exportieren</button>
    <button class="knopf" data-a="import">Sicherung laden …</button>
    <input type="file" id="import-datei" accept=".zip,.json,application/zip,application/json" hidden></div>
    <h2>Speicher</h2>
    <p id="speicher">Wird geprüft …</p>
    <h2>App</h2>
    <p>Version ${VERSION} · läuft komplett offline, alle Daten bleiben auf diesem Gerät.
    <button class="knopf" data-a="update" style="margin-left:8px">Nach Update suchen</button><br>
    ${store.state.folders.size} Ordner · ${store.state.notes.size} Notizen</p>
  </section>`;
  const p = document.getElementById('speicher');
  const sm = navigator.storage;
  const dauer = sm?.persisted ? await sm.persisted() : false;
  const est = sm?.estimate ? await sm.estimate() : null;
  const mb = b => (b / 1048576).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' MB';
  zeigeSync();
  p.innerHTML = (dauer ? '✅ Dauerhafter Speicher ist aktiv: das System löscht die Daten nicht von selbst.'
    : '⚠️ Dauerhafter Speicher ist (noch) nicht bestätigt. Auf dem iPad die App über „Zum Home-Bildschirm“ installieren und von dort öffnen; trotzdem regelmäßig sichern.')
    + (est ? `<br>Belegt: ${mb(est.usage || 0)}${est.quota ? ' von ca. ' + mb(est.quota) : ''}` : '');
}

async function oeffneNotiz(id) {
  const n = store.note(id);
  if (!n) return geh('#/ordner/' + store.todoId(), true);
  const pages = await store.loadPages(n);
  if (route().art !== 'notiz' || route().wert !== id) return; // inzwischen weg-navigiert
  document.body.classList.add('schreiben');
  offeneNotiz = id;
  main.innerHTML = '';
  editor = openEditor(main, {
    note: n, pages,
    ordnerName: store.folder(n.folderId)?.name || 'Zurück',
    onBack: () => geh('#/ordner/' + (store.note(id)?.folderId || store.todoId())),
    onTitle: t => store.updateNote(id, { title: t }),
    onSavePage: p => store.savePage(p),
    onAddPage: p => store.addPage(p),
    onAddFile: (blob, typ) => store.addFile(id, blob, typ),
    onExport: () => alsPdf(id),
    neueSeite: paper => store.newPage(id, paper),
    onSaveThumb: b => store.saveThumb(id, b),
  });
}

// Vorschaubilder nachladen (Blob aus IndexedDB, als Objekt-URL zwischengespeichert)
const vorschauCache = new Map();
async function ladeVorschauen() {
  for (const img of main.querySelectorAll('img[data-thumb]')) {
    const n = store.note(img.dataset.thumb);
    if (!n?.thumbAt) continue;
    let c = vorschauCache.get(n.id);
    if (!c || c.at !== n.thumbAt) {
      const t = await store.getThumb(n.id);
      if (!t) continue;
      if (c) URL.revokeObjectURL(c.url);
      c = { at: n.thumbAt, url: URL.createObjectURL(t.blob) };
      vorschauCache.set(n.id, c);
    }
    img.src = c.url; img.hidden = false;
  }
}

// ---------- Aktionen im Hauptbereich ----------
main.addEventListener('click', async e => {
  if (e.target.closest('.ed')) return; // Klicks im Editor behandelt der Editor selbst
  const el = e.target.closest('[data-a],[data-ordner]');
  if (!el) return;
  const a = el.dataset.a;
  if (!a && el.dataset.ordner) return geh('#/ordner/' + el.dataset.ordner);
  const nid = el.closest('[data-notiz]')?.dataset.notiz;
  if (a === 'seite') return document.body.classList.toggle('side-offen');
  if (a === 'oeffnen') return geh('#/notiz/' + nid);
  if (a === 'neu') return neuMenue(el);
  if (a === 'ordner-menue') return ordnerMenue(el, aktuellerOrdner);
  if (a === 'notiz-menue') return notizMenue(el, nid);
  if (a === 'sicherung') return exportieren(el);
  if (a === 'ordnung') {
    if (!await ui.bestaetige('ACHTUNG: Das macht dein eigenes Einsortieren rückgängig! Alle aus Notability übernommenen Notizen wandern zurück in ihre ursprünglichen Notability-Ordner, auch die, die du selbst verschoben hast. Doppelte ohne eigene Handschrift werden entfernt, leere Ordner aufgeräumt. Nur benutzen, wenn alles durcheinander ist.', 'Trotzdem zurücksetzen', true)) return;
    const f = ui.fortschritt('Ordnung wird wiederhergestellt');
    let r;
    try { r = await ordnungWiederherstellen((t, x) => f.setze(t, x)); }
    catch (err) { f.zu(); return ui.meldung('Fehler: ' + (err.message || err)); }
    f.zu();
    await ui.meldung(`Fertig: ${r.notizen} Notizen geprüft, ${r.verschoben} zurückgelegt${r.doppelt ? `, ${r.doppelt} doppelte entfernt` : ''}${r.weg ? `, ${r.weg} leere Ordner aufgeräumt` : ''}.`);
    return geh('#/ordner/' + store.todoId());
  }
  if (a === 'update') return nachUpdateSuchen();
  if (a === 'sync-an') return sync.anmelden();
  if (a === 'sync-ab') { if (await ui.bestaetige('Von OneDrive abmelden? Die Daten auf diesem Gerät bleiben erhalten, werden aber nicht mehr abgeglichen.', 'Abmelden')) { await sync.abmelden(); render(); } return; }
  if (a === 'sync-jetzt') { await sync.abgleichen(); return render(); }
  if (a === 'sync-konfig') {
    const id = document.getElementById('sync-client').value.trim(), m = document.getElementById('sync-mandant').value.trim();
    if (id && !/^[0-9a-f-]{36}$/i.test(id)) return ui.meldung('Die Anwendungs-ID sieht nicht richtig aus (Format xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).');
    sync.setzeKonfig(id, m);
    await ui.meldung(id ? 'Gespeichert. Jetzt „Bei OneDrive anmelden“ tippen.' : 'Gespeichert.');
    return render();
  }
  if (a === 'import') return document.getElementById('import-datei').click();
  if (a === 'notability-od') return uebernehmeAusOneDrive();
  if (a === 'notability') return waehleDateien('.zip,.pdf,application/zip,application/pdf', d => uebernehme(d, store.todoId()));
});
main.addEventListener('change', async e => {
  if (e.target.id !== 'import-datei' || !e.target.files[0]) return;
  try {
    const d = await lies(e.target.files[0]);
    const ok = await ui.bestaetige(`Sicherung vom ${datum(d.exportiertAm)} mit ${d.folders.length} Ordnern und ${d.notes.length} Notizen laden? Alle Daten auf diesem Gerät werden dadurch ERSETZT.`, 'Ersetzen und laden', true);
    if (!ok) return;
    const f = ui.fortschritt('Sicherung wird geladen');
    try { await stelleWiederHer(d, (t, x) => f.setze(t, x)); } finally { f.zu(); }
    await store.init();
    await ui.meldung('Sicherung geladen.');
    geh('#/ordner/' + store.todoId());
  } catch (err) { ui.meldung(err.message || String(err)); }
  finally { e.target.value = ''; }
});

// Datei-Auswahl öffnen (mehrere Dateien möglich).
function waehleDateien(accept, fertig) {
  const i = document.createElement('input');
  i.type = 'file'; i.accept = accept; i.multiple = true; i.hidden = true;
  i.addEventListener('change', () => { const d = [...i.files]; i.remove(); if (d.length) fertig(d); });
  document.body.append(i);
  i.click();
}

// PDFs oder Notability-ZIP übernehmen.
async function uebernehme(dateien, zielOrdner) {
  navigator.storage?.persist?.().catch(() => {});
  const f = ui.fortschritt('Wird übernommen');
  let erg;
  if (sync.eingerichtet() && sync.status.angemeldet && navigator.onLine) { f.setze('Abgleich mit OneDrive …', null); await sync.abgleichen().catch(() => {}); }
  try { erg = await importiere(dateien, zielOrdner, (t, x, k) => f.setze(t, x, k)); }
  catch (err) { f.zu(); return ui.meldung(err.message || String(err)); }
  f.zu();
  await zeigeImportBericht(erg);
  if (dateien.length === 1 && erg.notizen === 1 && erg.letzte && !erg.fehler.length && zielOrdner === aktuellerOrdner) return geh('#/notiz/' + erg.letzte);
  render();
}

// Datei weitergeben: am iPad über "Teilen" (In Dateien sichern, AirDrop, Mail …), sonst herunterladen.
async function gibDatei(datei, text) {
  const tablet = matchMedia('(pointer: coarse)').matches;
  if (tablet && navigator.canShare?.({ files: [datei] })) {
    // Teilen braucht ein frisches Antippen, deshalb erst bestätigen lassen.
    const mb = (datei.size / 1048576).toLocaleString('de-DE', { maximumFractionDigits: 1 });
    if (!await ui.bestaetige(`${text} (${mb} MB).`, 'Teilen …')) return;
    try { await navigator.share({ files: [datei], title: datei.name }); return; }
    catch (err) { if (err.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(datei); a.download = datei.name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function alsPdf(id) {
  const n = store.note(id);
  if (!n) return;
  const f = ui.fortschritt('PDF wird erstellt');
  let datei;
  try { datei = await notizAlsPdf(n.title, await store.loadPages(n), (t, x) => f.setze(t, x)); }
  catch (err) { f.zu(); return ui.meldung('PDF-Export fehlgeschlagen: ' + (err.message || err)); }
  f.zu();
  await gibDatei(datei, `PDF „${n.title}“ ist fertig`);
}

async function zeigeImportBericht(erg) {
  let text = erg.gesamt > 1 ? `In der Auswahl: ${erg.gesamt} PDFs\n` : '';
  text += `Neu übernommen: ${erg.notizen}`;
  if (erg.ordner) text += ` (${erg.ordner} Ordner angelegt)`;
  if (erg.uebersprungen) text += `\nSchon vorhanden: ${erg.uebersprungen}`;
  if (erg.fehler.length) text += `\nNicht lesbar: ${erg.fehler.length}\n\n` + erg.fehler.map(f => '• ' + f).join('\n');
  if (erg.neu.length && erg.gesamt > 1 && erg.neu.length <= 300) text += '\n\nNeu dazugekommen:\n' + erg.neu.map(f => '• ' + f).join('\n');
  await ui.meldung(text);
}

async function uebernehmeAusOneDrive() {
  if (!navigator.onLine) return ui.meldung('Dafür braucht es eine Internetverbindung.');
  navigator.storage?.persist?.().catch(() => {});
  const f = ui.fortschritt('Aus OneDrive übernehmen');
  let erg;
  try {
    // erst abgleichen: was ein anderes Gerät schon übernommen hat, wird so erkannt und nicht doppelt angelegt
    f.setze('Abgleich mit OneDrive …', null);
    await sync.abgleichen();
    if (sync.status.fehler) throw new Error(sync.status.fehler);
    const liste = await sync.notabilityListe((t, x, k) => f.setze(t, x, k));
    erg = await importiereAusOneDrive(liste, (t, x, k) => f.setze(t, x, k));
  } catch (err) { f.zu(); return ui.meldung('Übernehmen fehlgeschlagen: ' + (err.message || err)); }
  f.zu();
  await zeigeImportBericht(erg);
  render();
}

async function exportieren(knopf) {
  knopf.disabled = true;
  const f = ui.fortschritt('Sicherung wird erstellt');
  let datei;
  try { datei = await exportiere((t, x) => f.setze(t, x)); }
  catch (err) { knopf.disabled = false; return ui.meldung('Export fehlgeschlagen: ' + (err.message || err)); }
  finally { f.zu(); }
  try {
    await gibDatei(datei, 'Sicherung ist fertig. Im nächsten Schritt „In Dateien sichern“ wählen');
  } catch (err) { ui.meldung('Export fehlgeschlagen: ' + (err.message || err)); }
  finally { knopf.disabled = false; }
}

function zielOrdner() {
  const { art } = route();
  return art === 'ordner' && aktuellerOrdner ? aktuellerOrdner : store.todoId();
}

async function neuMenue(knopf) {
  const k = await ui.menue(knopf, [
    ...Object.entries(PAPIERE).map(([p, t]) => ({ k: 'notiz:' + p, t: `Neue Notiz · ${t}` })),
    ...Object.entries(VORLAGEN).map(([v, d]) => ({ k: 'vorlage:' + v, t: `Vorlage · ${d.name}` })),
    '-', { k: 'pdf', t: 'PDF importieren …' },
    '-', { k: 'ordner', t: route().art === 'ordner' ? 'Neuer Unterordner' : 'Neuer Ordner' },
  ]);
  if (!k) return;
  if (k === 'pdf') { const ziel = zielOrdner(); return waehleDateien('.pdf,application/pdf', d => uebernehme(d, ziel)); }
  if (k === 'ordner') return neuerOrdner(route().art === 'ordner' ? aktuellerOrdner : null);
  if (k.startsWith('vorlage:')) {
    const v = VORLAGEN[k.split(':')[1]];
    const n = await store.createNote(zielOrdner(), v.paper);
    await store.updateNote(n.id, { title: v.titel() });
    const [p] = await store.loadPages(n);
    p.objects = v.objekte();
    await store.savePage(p);
    await store.saveThumb(n.id, await makeThumb(p)).catch(() => {});
    return geh('#/notiz/' + n.id);
  }
  const n = await store.createNote(zielOrdner(), k.split(':')[1]);
  geh('#/notiz/' + n.id);
}

async function neuerOrdner(parentId) {
  const name = await ui.frage(parentId ? `Neuer Ordner in „${store.folder(parentId).name}“` : 'Neuer Ordner', '', 'Anlegen');
  if (!name) return;
  const farbe = parentId ? store.folder(parentId).color : undefined;
  const f = await store.createFolder({ name, parentId, color: farbe });
  if (parentId) { offen.add(parentId); merkeOffen(); }
  geh('#/ordner/' + f.id);
}

async function ordnerMenue(knopf, id) {
  const f = store.folder(id);
  const k = await ui.menue(knopf, [
    { k: 'neu', t: 'Unterordner anlegen' }, { k: 'name', t: 'Umbenennen' }, { k: 'farbe', t: 'Farbe ändern' },
    ...(f.system ? [] : [{ k: 'move', t: 'Verschieben nach …' }, { k: 'einsortieren', t: 'In vorhandene Ordner einsortieren' }, '-', { k: 'del', t: 'Ordner löschen', gefahr: true }]),
  ]);
  if (k === 'neu') return neuerOrdner(id);
  if (k === 'name') { const n = await ui.frage('Ordner umbenennen', f.name, 'Speichern'); if (n) await store.updateFolder(id, { name: n }); }
  if (k === 'farbe') { const c = await ui.waehleFarbe(f.color); if (c) await store.updateFolder(id, { color: c }); }
  if (k === 'move') {
    const ziel = await ui.waehleOrdner(`„${f.name}“ verschieben nach`, { ausschluss: store.descendants(id), oberste: true });
    if (ziel === undefined) return;
    await store.moveFolder(id, ziel);
    if (ziel) { offen.add(ziel); merkeOffen(); }
  }
  if (k === 'einsortieren') {
    const ebene = f.parentId ? `„${store.folder(f.parentId).name}“` : 'die oberste Ebene';
    if (!await ui.bestaetige(`Den Inhalt von „${f.name}“ in ${ebene} einsortieren? Gleichnamige Ordner werden zusammengelegt (z. B. „Auftrag“ in „Auftrag“), danach verschwindet „${f.name}“. Es wird nichts gelöscht.`, 'Einsortieren')) return;
    const eltern = f.parentId;
    const r = await store.einsortieren(id);
    await ui.meldung(`Fertig: ${r.ordner} Ordner zusammengelegt${r.notizen ? `, ${r.notizen} Notizen umsortiert` : ''}.`);
    return geh('#/ordner/' + (eltern || store.todoId()), true);
  }
  if (k === 'del') {
    const { ordner, notizen } = store.folderInhalt(id);
    const text = `Ordner „${f.name}“ löschen?` + (ordner || notizen ? ` Darin werden ${notizen} Notiz${notizen === 1 ? '' : 'en'} und ${ordner} Unterordner mit gelöscht.` : '') + ' Das lässt sich nicht rückgängig machen.';
    if (!await ui.bestaetige(text, 'Löschen', true)) return;
    const eltern = f.parentId;
    await store.deleteFolder(id);
    return geh('#/ordner/' + (eltern || store.todoId()), true);
  }
  render();
}

async function notizMenue(knopf, id) {
  const n = store.note(id);
  const k = await ui.menue(knopf, [
    { k: 'oeffnen', t: 'Öffnen' }, { k: 'name', t: 'Umbenennen' }, { k: 'move', t: 'Verschieben nach …' },
    { k: 'pdf', t: 'Als PDF exportieren' },
    '-', { k: 'del', t: 'Notiz löschen', gefahr: true },
  ]);
  if (k === 'oeffnen') return geh('#/notiz/' + id);
  if (k === 'pdf') return alsPdf(id);
  if (k === 'name') { const t = await ui.frage('Notiz umbenennen', n.title, 'Speichern'); if (t) await store.updateNote(id, { title: t }, { touch: false }); }
  if (k === 'move') {
    const ziel = await ui.waehleOrdner(`„${n.title}“ verschieben nach`, { ausschluss: [n.folderId] });
    if (ziel) await store.moveNote(id, ziel);
  }
  if (k === 'del') {
    if (!await ui.bestaetige(`Notiz „${n.title}“ löschen? Das lässt sich nicht rückgängig machen.`, 'Löschen', true)) return;
    await store.deleteNote(id);
  }
  render();
}

// ---------- Anzeigen ----------
function zeichneHaupt() {
  const { art, wert } = route();
  if (art === 'suche' && wert.trim()) return zeichneSuche(wert);
  if (art === 'einstellungen') return zeichneEinstellungen();
  return zeichneOrdner(art === 'ordner' ? wert : aktuellerOrdner || store.todoId());
}

let laeuft = Promise.resolve();
function render() {
  laeuft = laeuft.then(async () => {
    if (editor) { const e = editor; editor = null; await e.close(); offeneNotiz = null; sync.geaendert(); if (updateBereit) { location.reload(); return; } }
    document.body.classList.remove('schreiben');
    const { art, wert } = route();
    if (art === 'notiz') return oeffneNotiz(wert);
    if (!art) return geh('#/ordner/' + (store.folder(localStorage.getItem('nb.zuletzt')) ? localStorage.getItem('nb.zuletzt') : store.todoId()), true);
    zeichneSeite();
    zeichneHaupt();
  }).catch(err => { console.error(err); ui.meldung('Fehler: ' + (err.message || err)); });
  return laeuft;
}

// ---------- Start ----------
(async () => {
  try {
    await store.init();
  } catch (err) {
    main.innerHTML = `<p class="leer">Der Speicher konnte nicht geöffnet werden: ${esc(err.message || err)}<br>Im privaten Modus von Safari funktioniert die App nicht.</p>`;
    return;
  }
  navigator.storage?.persist?.().catch(() => {});
  try { await sync.nachAnmeldung(); } catch (err) { console.warn(err); }
  store.beiAenderung(sync.geaendert);
  window.notizbuchSync = sync; // für Tests und Fehlersuche
  sync.beiStatus(zeigeSync);
  window.addEventListener('hashchange', render);
  ziehenEinrichten({
    fertig: () => render(),
    meldung: hinweis,
    klappeAuf: id => { offen.add(id); merkeOffen(); zeichneSeite(); },
  });
  render();
  sync.start({
    gesperrt: () => offeneNotiz,
    nachAbgleich: async ids => {
      for (const id of ids) {
        const n = store.note(id);
        if (!n) continue;
        try { const [p] = await store.loadPages(n); await store.saveThumb(id, await makeThumb(p)); } catch { /* Vorschau später */ }
      }
      const { art } = route();
      if (art === 'ordner' || art === 'suche') render();
      else if (art !== 'notiz') zeichneSeite();
    },
  });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) updatesEinrichten();
})();
document.addEventListener('gesturestart', e => e.preventDefault());
