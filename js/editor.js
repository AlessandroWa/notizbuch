// Notiz-Editor: Schreiben mit dem Apple Pencil.
// Schreibtechnik wie stift-test.html: Striche-Canvas (desynchronized) plus Live-Ebene,
// getCoalescedEvents für alle Zwischenpunkte, getPredictedEvents gegen Verzögerung.
// Seiten liegen untereinander und werden in Kacheln (512 px) gezeichnet. Nur sichtbare Kacheln haben
// Canvas, dadurch bleibt auch beim Zoomen alles scharf und der Speicher klein.
// Je Kachel: Hintergrund (Papier oder PDF) + Inhalt (Objekte, darüber Handschrift).
// "Nur Stift": Finger blättert, zwei Finger zoomen.
import { PAPIERE, drawPaper, drawInkPart, drawInkTail, drawMarker, drawStroke, drawStrokes, wOf, trifft, strokeBox, vergissBox } from './ink.js';
import { zeichne as zeichnePdf } from './pdf.js';
import {
  SYMBOLE, MASSSTAEBE, STANDARD_MASSSTAB, RASTER, zeichneSymbol, zeichneObjekt, zeichneObjekte, istKasten, lokal, global,
  trefferObjekt, griffe, rasten, rasteKasten, rasteLinie, neuesSymbol, inCm, proCm, beiBildGeladen, ladeBild,
  textMasse, imVieleck, verschiebe,
} from './objekte.js';
import * as ui from './ui.js';
import { makeThumb } from './vorschau.js';
import { uid, esc, debounce } from './util.js';

const PEN_FARBEN = ['#1b1d21', '#1f5fd6', '#d23a2f', '#1d8a4e', '#e07b00', '#7b3fc4'];
const MARKER_FARBEN = ['#ffd60a', '#7ee07e', '#ff8ad8', '#7cc4ff'];
const PEN_BREITEN = [1.8, 2.8, 4.5];
const MARKER_BREITEN = [14, 22, 32];
const PAPIER_REIHE = Object.keys(PAPIERE);
const RAND = 16; // Abstand Seite zum Rand in px
const LUECKE = 18; // Abstand zwischen Seiten in px
const KACHEL = 512; // Kachelgröße in px
const VORLAUF = 256; // Kacheln so weit außerhalb des Bildschirms schon vorbereiten (px)
const ZOOM_MIN = 0.5, ZOOM_MAX = 5;
const HALTEN_MS = 450; // Stift so lange ruhig halten = Strich wird gerade
const FORMEN = ['linie', 'rechteck', 'mass'];

const LS = 'nb.werkzeug';
const STANDARD = { tool: 'pen', pen: { c: 0, w: 1 }, marker: { c: 0, w: 1 }, penOnly: true };
function ladeWerkzeug() {
  try { return { ...STANDARD, ...JSON.parse(localStorage.getItem(LS) || '{}') }; } catch { return { ...STANDARD }; }
}

const ICON = {
  pen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1.2-4.4L15.6 5.2a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L8.4 18.8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M13.8 7l3.2 3.2" stroke="currentColor" stroke-width="1.8"/></svg>',
  marker: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14l-3 3v3h3l3-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8.5 13.5l7-9 4 4-9 7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M3 21h8" stroke="#ffd60a" stroke-width="3" stroke-linecap="round"/></svg>',
  eraser: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 19l-4-4a1.6 1.6 0 0 1 0-2.3l8.2-8.2a1.6 1.6 0 0 1 2.3 0l4.6 4.6a1.6 1.6 0 0 1 0 2.3L12 19z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 11l6 6M8.5 19H20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7L4 12l5 5M4 12h10a6 6 0 0 1 0 12" transform="translate(0 -3)" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  redo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 7l5 5-5 5M20 12H10a6 6 0 0 0 0 12" transform="translate(0 -3)" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  auswahl: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3l14 8-6 1.6L10 19z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  linie: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20L20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  rechteck: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="6" width="17" height="12" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  mass: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 14h18M3 10v8M21 10v8" stroke="#ff6b61" stroke-width="1.8" stroke-linecap="round"/><path d="M8 9h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  symbole: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3h8v4H8zM7 7h10v3c0 6-2 11-5 11s-5-5-5-11z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  lasso: '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="10" rx="8" ry="5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="3 2.5"/><path d="M8 15c-1 2 0 4 2 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  text: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6V4h14v2M12 4v16M9 20h6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
  foto: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="10" r="1.8" fill="currentColor"/><path d="M4 17l5-4 4 3 3-2 4 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  teilen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7.5 7.5L12 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 11H5v9h14v-9h-1" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

export function openEditor(root, { note, pages, ordnerName, onBack, onTitle, onSavePage, onAddPage, onSaveThumb, onAddFile, onExport, neueSeite }) {
  let W = ladeWerkzeug();
  if (W.tool === 'eraser' || W.tool === 'lasso') W.tool = 'pen';
  const merke = () => localStorage.setItem(LS, JSON.stringify(W));

  root.innerHTML = `
  <div class="ed">
    <div class="ed-bar" role="toolbar" aria-label="Werkzeuge">
      <div class="grp grp-titel">
        <button class="ed-back" data-a="back" title="Zurück">${ICON.back}<span>${esc(ordnerName)}</span></button>
        <input class="ed-title" value="${esc(note.title)}" aria-label="Titel der Notiz" maxlength="120" enterkeyhint="done">
      </div>
      <div class="grp">
        <button data-a="undo" title="Rückgängig" aria-label="Rückgängig">${ICON.undo}</button>
        <button data-a="redo" title="Wiederholen" aria-label="Wiederholen">${ICON.redo}</button>
      </div>
      <div class="grp">
        <button data-a="paper" class="txt" title="Papier wechseln"></button>
        <button data-a="penonly" class="txt" title="Finger blättert nur, nur der Stift schreibt">Nur Stift</button>
        <button data-a="export" title="Als PDF exportieren" aria-label="Als PDF exportieren">${ICON.teilen}</button>
      </div>
      <div class="ed-zeile">
        <div class="grp" data-g="tools">
          <button data-tool="pen" title="Stift (Stift am Ende halten = gerade Linie)" aria-label="Stift">${ICON.pen}</button>
          <button data-tool="marker" title="Textmarker" aria-label="Textmarker">${ICON.marker}</button>
          <button data-tool="eraser" title="Radierer (ganze Striche)" aria-label="Radierer">${ICON.eraser}</button>
          <button data-tool="lasso" title="Lasso: Striche einkreisen, verschieben, löschen" aria-label="Lasso">${ICON.lasso}</button>
        </div>
        <div class="grp" data-g="skizze">
          <button data-tool="auswahl" title="Objekte auswählen und verschieben" aria-label="Auswählen">${ICON.auswahl}</button>
          <button data-tool="linie" title="Gerade Linie" aria-label="Linie">${ICON.linie}</button>
          <button data-tool="rechteck" title="Rechteck" aria-label="Rechteck">${ICON.rechteck}</button>
          <button data-tool="mass" title="Maßlinie" aria-label="Maßlinie">${ICON.mass}</button>
          <button data-tool="text" title="Textfeld: auf die Seite tippen" aria-label="Textfeld">${ICON.text}</button>
          <button data-a="foto" title="Foto einfügen" aria-label="Foto einfügen">${ICON.foto}</button>
          <button data-a="symbole" title="Sanitär-Symbole" aria-label="Sanitär-Symbole">${ICON.symbole}</button>
        </div>
        <div class="grp" data-g="colors"></div>
        <div class="grp" data-g="widths"></div>
        <span class="ed-status" aria-live="polite"></span>
      </div>
      <div class="ed-symbole" hidden>
        ${Object.entries(SYMBOLE).map(([k, v]) => `<button data-sym="${k}" title="${v.name} einfügen"><canvas width="88" height="64" data-icon="${k}"></canvas><span>${v.name}</span></button>`).join('')}
        <button data-a="massstab" class="txt" title="Maßstab dieser Seite"></button>
      </div>
    </div>
    <div class="ed-view">
      <div class="ed-stack"></div>
      <canvas class="ed-live"></canvas>
      <div class="ed-ctx" hidden role="toolbar" aria-label="Auswahl">
        <button data-k="drehen">↻ 90°</button><button data-k="spiegeln">⇋ Spiegeln</button><button data-k="text">Text ändern</button>
        <button data-k="dup">Duplizieren</button><button data-k="masse">Maße …</button><button data-k="del" class="gefahr">Löschen</button>
      </div>
      <button class="ed-zoom" hidden title="Zoom zurücksetzen"></button>
      <div class="ed-seitenzahl" aria-live="off"></div>
    </div>
    <input type="file" accept="image/*" multiple hidden class="ed-foto">
  </div>`;

  const $ = s => root.querySelector(s);
  const bar = $('.ed-bar'), view = $('.ed-view'), stack = $('.ed-stack');
  const ctxBar = $('.ed-ctx'), symbolLeiste = $('.ed-symbole'), zoomKnopf = $('.ed-zoom'), fotoInput = $('.ed-foto');
  const live = $('.ed-live'), titel = $('.ed-title'), status = $('.ed-status'), seitenzahl = $('.ed-seitenzahl');
  const lctx = live.getContext('2d', { desynchronized: true }) || live.getContext('2d');

  // Seiten-Elemente und Knopf "Neue Seite"
  const slots = [];
  const addBtn = document.createElement('button');
  addBtn.className = 'ed-add';
  addBtn.innerHTML = ICON.plus + '<span>Neue Seite</span>';
  const slotFuer = p => { const el = document.createElement('div'); el.className = 'ed-page'; return { el, p, kacheln: new Map() }; };
  for (const p of pages) { p.objects ||= []; slots.push(slotFuer(p)); }
  stack.append(...slots.map(s => s.el), addBtn);
  for (const c of symbolLeiste.querySelectorAll('canvas[data-icon]')) {
    const art = c.dataset.icon, s = SYMBOLE[art], g = c.getContext('2d'), k = Math.min(70 / s.b, 52 / s.l);
    g.translate(44, 32); g.scale(k, k);
    zeichneSymbol(g, art, s.b, s.l, 2.4 / k, '#f3f2f2');
  }

  // ---------- Werkzeugleiste ----------
  const hatPapier = () => pages.some(p => !p.bg);
  function zeichneLeiste() {
    for (const b of bar.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', b.dataset.tool === W.tool);
    const art = W.tool === 'marker' ? 'marker' : 'pen';
    const farben = art === 'marker' ? MARKER_FARBEN : PEN_FARBEN;
    const breiten = art === 'marker' ? MARKER_BREITEN : PEN_BREITEN;
    const aus = !['pen', 'marker', 'linie', 'rechteck', 'text'].includes(W.tool);
    bar.querySelector('[data-g=colors]').innerHTML = farben.map((c, i) =>
      `<button data-c="${i}" aria-pressed="${!aus && i === W[art].c}" title="Farbe" aria-label="Farbe ${i + 1}"><span class="dot" style="background:${c}"></span></button>`).join('');
    bar.querySelector('[data-g=widths]').innerHTML = breiten.map((w, i) => {
      const d = art === 'marker' ? 6 + i * 4 : Math.round(w * 2.2 + 3);
      return `<button data-w="${i}" aria-pressed="${!aus && i === W[art].w}" title="Strichstärke" aria-label="Strichstärke ${i + 1}"><span class="wdot" style="width:${d}px;height:${d}px"></span></button>`;
    }).join('');
    const pb = $('[data-a=paper]');
    pb.hidden = !hatPapier();
    pb.textContent = PAPIERE[pages.find(p => !p.bg)?.paper] || 'Papier';
    $('[data-a=penonly]').setAttribute('aria-pressed', W.penOnly);
    $('[data-a=symbole]').setAttribute('aria-pressed', !!W.symbole);
    symbolLeiste.hidden = !W.symbole;
    $('[data-a=massstab]').textContent = 'Maßstab 1:' + (slots[mitte]?.p.massstab || STANDARD_MASSSTAB);
    $('[data-a=undo]').disabled = !undo.length;
    $('[data-a=redo]').disabled = !redo.length;
    live.classList.toggle('multiply', W.tool === 'marker');
  }

  bar.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const art = W.tool === 'marker' ? 'marker' : 'pen';
    if (b.dataset.sym) { einfuegen(b.dataset.sym); return; }
    if (b.dataset.tool) { W.tool = b.dataset.tool; waehle(null); lasso = null; zeigeAuswahl(); }
    else if (b.dataset.c) { W[art].c = +b.dataset.c; if (!['pen', 'marker', 'linie', 'rechteck', 'text'].includes(W.tool)) W.tool = art; }
    else if (b.dataset.w) { W[art].w = +b.dataset.w; if (!['pen', 'marker', 'linie', 'rechteck', 'text'].includes(W.tool)) W.tool = art; }
    else if (b.dataset.a === 'undo') rueckgaengig();
    else if (b.dataset.a === 'redo') wiederholen();
    else if (b.dataset.a === 'penonly') W.penOnly = !W.penOnly;
    else if (b.dataset.a === 'symbole') W.symbole = !W.symbole;
    else if (b.dataset.a === 'foto') { fotoInput.click(); return; }
    else if (b.dataset.a === 'export') { sichern().then(() => onExport()); return; }
    else if (b.dataset.a === 'massstab') {
      const p = slots[mitte].p, alt = p.massstab || STANDARD_MASSSTAB;
      p.massstab = MASSSTAEBE[(MASSSTAEBE.indexOf(alt) + 1) % MASSSTAEBE.length];
      neuZeichnen(mitte); geaendert(p);
    } else if (b.dataset.a === 'paper') {
      const erste = pages.find(p => !p.bg);
      const neu = PAPIER_REIHE[(PAPIER_REIHE.indexOf(erste.paper) + 1) % PAPIER_REIHE.length];
      slots.forEach((s, i) => { if (!s.p.bg) { s.p.paper = neu; for (const k of s.kacheln.values()) hintergrund(k); geaendert(s.p); } });
    } else if (b.dataset.a === 'back') { onBack(); return; }
    merke(); zeichneLeiste();
  });

  let titelStand = note.title;
  titel.addEventListener('keydown', e => { if (e.key === 'Enter') titel.blur(); });
  titel.addEventListener('change', () => {
    const t = titel.value.trim() || 'Ohne Titel';
    titel.value = t;
    if (t !== titelStand) { titelStand = t; onTitle(t); }
  });

  // ---------- Lage, Zoom und Kacheln ----------
  let zoom = 1, basis = 1, scale = 1, offX = RAND, offY = RAND, vw = 0, vh = 0, stapelH = 0, stapelW = 0, dpr = 1;
  let tops = [], mitte = 0;

  // Welcher Seitenpunkt liegt an Bildschirmstelle sx/sy (relativ zur Ansicht)?
  function ankerBei(sx, sy) {
    let i = 0;
    for (let k = 0; k < slots.length; k++) if (sy - offY >= tops[k] - LUECKE) i = k;
    return { i, ux: (sx - offX) / scale, uy: (sy - offY - tops[i]) / scale, sx, sy };
  }

  function layout(anker = vw ? ankerBei(vw / 2, 0) : null) {
    const r = view.getBoundingClientRect();
    if (!r.width || !r.height) return;
    vw = r.width; vh = r.height; dpr = Math.min(window.devicePixelRatio || 1, 2);
    basis = Math.min((vw - 2 * RAND) / 1000, 1.25);
    scale = basis * zoom;
    tops = [];
    let y = 0;
    for (const s of slots) {
      tops.push(y);
      Object.assign(s.el.style, { top: y + 'px', width: s.p.w * scale + 'px', height: s.p.h * scale + 'px' });
      y += s.p.h * scale + LUECKE;
    }
    addBtn.style.top = y + 'px';
    addBtn.style.width = 1000 * scale + 'px';
    stapelH = y + 64; stapelW = 1000 * scale;
    live.width = Math.round(vw * dpr); live.height = Math.round(vh * dpr);
    live.style.width = vw + 'px'; live.style.height = vh + 'px';
    for (const s of slots) for (const k of [...s.kacheln.values()]) abbauen(k);
    stack.style.transformOrigin = '0 0';
    if (anker && tops[anker.i] !== undefined) setze(anker.sx - anker.ux * scale, anker.sy - tops[anker.i] - anker.uy * scale);
    else setze(RAND, RAND);
    zoomKnopf.hidden = Math.abs(zoom - 1) < 0.01;
    zoomKnopf.textContent = Math.round(zoom * 100) + ' %';
  }

  function setze(x, y) {
    if (stapelW + 2 * RAND <= vw) x = (vw - stapelW) / 2;
    else x = Math.max(vw - stapelW - RAND, Math.min(RAND, x));
    y = Math.max(Math.min(RAND, vh - stapelH - RAND), Math.min(RAND, y));
    offX = x; offY = y;
    stack.style.transform = `translate3d(${offX}px,${offY}px,0)`;
    sichtbar();
    if (!cur) zeigeAuswahl();
  }

  function sichtbar() {
    const vorher = mitte;
    mitte = 0;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i], t = offY + tops[i], h = s.p.h * scale, w = s.p.w * scale;
      if (t < vh / 2) mitte = i;
      const brauche = new Set();
      if (t + h > -VORLAUF && t < vh + VORLAUF) {
        const r0 = Math.max(0, Math.floor((-VORLAUF - t) / KACHEL)), r1 = Math.min(Math.ceil(h / KACHEL) - 1, Math.floor((vh + VORLAUF - t) / KACHEL));
        const c0 = Math.max(0, Math.floor((-VORLAUF - offX) / KACHEL)), c1 = Math.min(Math.ceil(w / KACHEL) - 1, Math.floor((vw + VORLAUF - offX) / KACHEL));
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) brauche.add(r + ':' + c);
      }
      for (const [key, k] of s.kacheln) if (!brauche.has(key) && !(cur && cur.pi === i)) abbauen(k);
      for (const key of brauche) if (!s.kacheln.has(key)) aufbauen(i, key);
    }
    seitenzahl.textContent = slots.length > 1 ? `Seite ${mitte + 1} von ${slots.length}` : '';
    if (mitte !== vorher && !symbolLeiste.hidden) zeichneLeiste();
  }

  const vorrat = []; // wiederverwendbare Canvas
  const neuerCanvas = () => vorrat.pop() || document.createElement('canvas');

  function aufbauen(i, key) {
    const s = slots[i], p = s.p, [r, c] = key.split(':').map(Number);
    const x0 = c * KACHEL, y0 = r * KACHEL;
    const tw = Math.min(KACHEL, p.w * scale - x0), th = Math.min(KACHEL, p.h * scale - y0);
    if (tw <= 0 || th <= 0) return;
    const k = { i, key, x0, y0, tw, th, d: dpr, bg: neuerCanvas(), base: neuerCanvas() };
    for (const cv of [k.bg, k.base]) {
      cv.width = Math.ceil(tw * dpr); cv.height = Math.ceil(th * dpr);
      Object.assign(cv.style, { left: x0 + 'px', top: y0 + 'px', width: cv.width / dpr + 'px', height: cv.height / dpr + 'px' });
    }
    k.bg.className = 'bg'; k.base.className = 'base';
    k.bctx = k.base.getContext('2d', { desynchronized: true }) || k.base.getContext('2d');
    k.bctx.setTransform(dpr * scale, 0, 0, dpr * scale, -x0 * dpr, -y0 * dpr);
    k.bctx.lineCap = 'round'; k.bctx.lineJoin = 'round';
    s.el.append(k.bg, k.base);
    s.kacheln.set(key, k);
    hintergrund(k);
    inhalt(k);
  }

  function hintergrund(k) {
    const p = slots[k.i].p;
    k.task?.cancel(); k.task = null;
    if (p.bg?.art === 'pdf') {
      k.task = zeichnePdf(k.bg, p.bg.fileId, p.bg.seite, null, { breite: p.w * scale * k.d, x: k.x0 * k.d, y: k.y0 * k.d });
      k.task.promise.catch(err => zeigeStatus('PDF-Seite konnte nicht angezeigt werden: ' + (err.message || err), true));
    } else {
      const g = k.bg.getContext('2d');
      g.setTransform(k.d * scale, 0, 0, k.d * scale, -k.x0 * k.d, -k.y0 * k.d);
      drawPaper(g, p.paper, p.w, p.h);
    }
  }

  function inhalt(k) {
    const p = slots[k.i].p, g = k.bctx;
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, k.base.width, k.base.height); g.restore();
    zeichneObjekte(g, p);
    drawStrokes(g, p);
  }

  function abbauen(k) {
    k.task?.cancel();
    k.bg.remove(); k.base.remove();
    if (vorrat.length < 40) vorrat.push(k.bg, k.base); else { k.bg.width = k.bg.height = k.base.width = k.base.height = 0; }
    slots[k.i].kacheln.delete(k.key);
  }

  const neuZeichnen = i => { if (i >= 0) for (const k of slots[i].kacheln.values()) inhalt(k); };
  const neuZeichnenSeite = page => neuZeichnen(slots.findIndex(s => s.p === page));
  beiBildGeladen(() => slots.forEach((_, i) => neuZeichnen(i)));

  // Kacheln einer Seite, die einen Bereich (Seiten-Einheiten) berühren
  function kachelnIm(i, x0, y0, x1, y1) {
    const out = [];
    for (const k of slots[i].kacheln.values()) {
      const kx0 = k.x0 / scale, ky0 = k.y0 / scale, kx1 = (k.x0 + k.tw) / scale, ky1 = (k.y0 + k.th) / scale;
      if (x1 >= kx0 && x0 <= kx1 && y1 >= ky0 && y0 <= ky1) out.push(k);
    }
    return out;
  }

  // ---------- Hilfen ----------
  function seiteBei(e) {
    const r = view.getBoundingClientRect();
    const y = e.clientY - r.top - offY;
    for (let i = 0; i < slots.length; i++) if (y >= tops[i] - LUECKE / 2 && y < tops[i] + slots[i].p.h * scale + LUECKE / 2) return i;
    return -1;
  }
  function pt(e, i) {
    const r = view.getBoundingClientRect();
    const p = e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5;
    return {
      x: Math.round((e.clientX - r.left - offX) / scale * 10) / 10,
      y: Math.round((e.clientY - r.top - offY - tops[i]) / scale * 10) / 10,
      p: Math.round(p * 100) / 100,
    };
  }
  function liveSeite(i) {
    lctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offX, dpr * (offY + tops[i]));
    lctx.lineCap = 'round'; lctx.lineJoin = 'round';
  }
  let tailBox = null;
  function liveLeeren(ganz) {
    if (ganz) { lctx.save(); lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.clearRect(0, 0, live.width, live.height); lctx.restore(); tailBox = null; return; }
    if (tailBox) { const [x, y, w, h] = tailBox; lctx.clearRect(x, y, w, h); tailBox = null; }
  }
  function fang(e) { try { view.setPointerCapture(e.pointerId); } catch { /* synthetische Events */ } }

  // ---------- Rückgängig / Wiederholen ----------
  // Einträge: add {page, s} · erase {items:[{page,s,i}]} · obj {page, vorher, nachher}
  //           schieb {page, strokes, objIds, dx, dy} · gruppe {ops}
  const undo = [], redo = [];
  function anwenden(a, zurueck, betroffen) {
    if (a.op === 'gruppe') { for (const o of zurueck ? [...a.ops].reverse() : a.ops) anwenden(o, zurueck, betroffen); return; }
    if (a.op === 'obj') { a.page.objects = structuredClone(zurueck ? a.vorher : a.nachher); betroffen.add(a.page); return; }
    if (a.op === 'add') {
      if (zurueck) { const i = a.page.strokes.indexOf(a.s); if (i >= 0) a.page.strokes.splice(i, 1); } else a.page.strokes.push(a.s);
      betroffen.add(a.page); return;
    }
    if (a.op === 'erase') {
      if (zurueck) for (const { page, s, i } of a.items) { page.strokes.splice(Math.min(i, page.strokes.length), 0, s); betroffen.add(page); }
      else for (const { page, s } of [...a.items].reverse()) { const i = page.strokes.indexOf(s); if (i >= 0) page.strokes.splice(i, 1); betroffen.add(page); }
      return;
    }
    if (a.op === 'schieb') {
      const f = zurueck ? -1 : 1;
      schiebeAuswahl(a.page, a.strokes, a.objIds, f * a.dx, f * a.dy);
      betroffen.add(a.page);
    }
  }
  function schritt(von, nach, zurueck) {
    const a = von.pop();
    if (!a) return;
    const betroffen = new Set();
    anwenden(a, zurueck, betroffen);
    nach.push(a);
    waehle(null); lasso = null;
    for (const p of betroffen) { neuZeichnenSeite(p); geaendert(p); }
    zeigeAuswahl(); zeichneLeiste();
  }
  const rueckgaengig = () => schritt(undo, redo, true);
  const wiederholen = () => schritt(redo, undo, false);
  function merkeSchritt(a) { undo.push(a); redo.length = 0; }

  // ---------- Schreiben ----------
  let cur = null, curId = null, drawn = 0;

  function radiere(e) {
    const i = seiteBei(e);
    if (i < 0) return;
    const p = pt(e, i), page = slots[i].p, R = 9 / scale;
    let weg = false;
    for (let k = page.strokes.length - 1; k >= 0; k--) {
      const s = page.strokes[k];
      if (trifft(s, p.x, p.y, R)) { cur.removed.push({ page, s, i: k }); page.strokes.splice(k, 1); weg = true; }
    }
    if (weg) neuZeichnen(i);
  }

  function start(e) {
    stoppeSchwung(); pan = null;
    const i = seiteBei(e);
    if (i < 0) return;
    e.preventDefault();
    fang(e);
    curId = e.pointerId;
    if (W.tool === 'eraser' || e.button === 5) { cur = { erase: true, removed: [], pi: i }; radiere(e); return; }
    const p = pt(e, i), art = W.tool === 'marker' ? 'marker' : 'pen';
    cur = {
      pi: i, finger: e.pointerType === 'touch',
      s: {
        id: uid(), t: art,
        c: (art === 'marker' ? MARKER_FARBEN : PEN_FARBEN)[W[art].c],
        w: (art === 'marker' ? MARKER_BREITEN : PEN_BREITEN)[W[art].w],
        pts: [p.x, p.y, p.p],
      },
      halt: { x: e.clientX, y: e.clientY }, timer: 0,
    };
    drawn = 0;
    liveSeite(i);
    if (art === 'pen') for (const k of kachelnIm(i, p.x - 20, p.y - 20, p.x + 20, p.y + 20)) drawInkPart(k.bctx, cur.s, 0);
    else { liveLeeren(true); drawMarker(lctx, cur.s); }
    halteUhr(e);
  }

  // Stift ruhig halten => Strich wird zur geraden Linie (wie bei Notability)
  function halteUhr(e) {
    if (!cur || cur.gerade) return;
    if (Math.hypot(e.clientX - cur.halt.x, e.clientY - cur.halt.y) > 4 || !cur.timer) {
      cur.halt = { x: e.clientX, y: e.clientY };
      clearTimeout(cur.timer);
      const c = cur;
      cur.timer = setTimeout(() => { if (cur === c) begradige(); }, HALTEN_MS);
    }
  }
  function geradeEnde(x1, y1, x2, y2) {
    const l = Math.hypot(x2 - x1, y2 - y1), w = Math.atan2(y2 - y1, x2 - x1), s = Math.round(w / (Math.PI / 4)) * (Math.PI / 4);
    if (Math.abs(w - s) < 0.06) return { x: x1 + Math.cos(s) * l, y: y1 + Math.sin(s) * l };
    return { x: x2, y: y2 };
  }
  function begradige() {
    const s = cur.s, a = s.pts, n = a.length / 3;
    if (Math.hypot(a[(n - 1) * 3] - a[0], a[(n - 1) * 3 + 1] - a[1]) * scale < 14) return;
    let pm = 0;
    for (let i = 0; i < n; i++) pm += a[i * 3 + 2];
    pm = Math.round(pm / n * 100) / 100;
    const e = geradeEnde(a[0], a[1], a[(n - 1) * 3], a[(n - 1) * 3 + 1]);
    s.pts = [a[0], a[1], pm, e.x, e.y, pm];
    cur.gerade = true; cur.pm = pm;
    neuZeichnen(cur.pi); // bisherige Freihand-Linie entfernen
    zeigeGerade();
  }
  function zeigeGerade() {
    liveLeeren(true); liveSeite(cur.pi);
    if (cur.s.t === 'marker') drawMarker(lctx, cur.s); else drawStroke(lctx, cur.s);
  }

  function weiter(e) {
    e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    const liste = evs.length ? evs : [e];
    if (cur.erase) { for (const ev of liste) radiere(ev); return; }
    const s = cur.s, a = s.pts;
    if (cur.gerade) {
      const p = pt(e, cur.pi), g = geradeEnde(a[0], a[1], p.x, p.y);
      a[3] = g.x; a[4] = g.y;
      zeigeGerade(); return;
    }
    halteUhr(e);
    const minD = 0.6 / scale;
    for (const ev of liste) {
      const p = pt(ev, cur.pi), n = a.length;
      if (Math.hypot(p.x - a[n - 3], p.y - a[n - 2]) >= minD) a.push(p.x, p.y, p.p);
    }
    if (s.t === 'marker') { liveLeeren(true); drawMarker(lctx, s); return; }
    const n = a.length / 3, von = Math.max(1, drawn);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = Math.max(0, von - 1); i < n; i++) { x0 = Math.min(x0, a[i * 3]); y0 = Math.min(y0, a[i * 3 + 1]); x1 = Math.max(x1, a[i * 3]); y1 = Math.max(y1, a[i * 3 + 1]); }
    const m = s.w * 1.5 + 2;
    for (const k of kachelnIm(cur.pi, x0 - m, y0 - m, x1 + m, y1 + m)) drawInkPart(k.bctx, s, von);
    drawn = Math.max(1, n - 1);
    // Live-Ebene: Ende des Strichs plus vorhergesagte Punkte, damit der Strich "an der Spitze klebt".
    liveLeeren();
    const pred = e.getPredictedEvents ? e.getPredictedEvents() : [];
    const tail = [];
    for (let i = Math.max(0, n - 2); i < n; i++) tail.push({ x: a[i * 3], y: a[i * 3 + 1], p: a[i * 3 + 2] });
    for (const ev of pred) tail.push(pt(ev, cur.pi));
    if (tail.length > 1) {
      let tx0 = Infinity, ty0 = Infinity, tx1 = -Infinity, ty1 = -Infinity;
      lctx.strokeStyle = s.c;
      lctx.beginPath();
      lctx.moveTo((tail[0].x + tail[1].x) / 2, (tail[0].y + tail[1].y) / 2);
      for (let i = 1; i < tail.length; i++) { lctx.lineWidth = wOf(s, tail[i].p); lctx.lineTo(tail[i].x, tail[i].y); }
      lctx.stroke();
      for (const q of tail) { tx0 = Math.min(tx0, q.x); ty0 = Math.min(ty0, q.y); tx1 = Math.max(tx1, q.x); ty1 = Math.max(ty1, q.y); }
      const mm = s.w * 2 + 2;
      tailBox = [tx0 - mm, ty0 - mm, tx1 - tx0 + 2 * mm, ty1 - ty0 + 2 * mm];
    }
  }

  function ende() {
    if (!cur) return;
    clearTimeout(cur.timer);
    if (cur.erase) {
      if (cur.removed.length) {
        merkeSchritt({ op: 'erase', items: cur.removed.reverse() });
        for (const p of new Set(cur.removed.map(r => r.page))) geaendert(p);
      }
    } else {
      const { s, pi } = cur, sl = slots[pi];
      liveLeeren(true);
      if (s.t === 'marker' || cur.gerade) {
        const b = strokeBox(s), m = s.w + 2;
        for (const k of kachelnIm(pi, b[0] - m, b[1] - m, b[2] + m, b[3] + m)) drawStroke(k.bctx, s);
        vergissBox(s);
      } else {
        const a = s.pts, n = a.length / 3, x = a[(n - 1) * 3], y = a[(n - 1) * 3 + 1];
        for (const k of kachelnIm(pi, x - 20, y - 20, x + 20, y + 20)) drawInkTail(k.bctx, s);
      }
      sl.p.strokes.push(s);
      merkeSchritt({ op: 'add', page: sl.p, s });
      geaendert(sl.p);
    }
    cur = null; curId = null;
    zeichneLeiste();
    sichtbar();
  }

  // Strich abbrechen (z. B. wenn ein zweiter Finger zum Zoomen dazukommt)
  function abbrechen() {
    if (!cur) return;
    clearTimeout(cur.timer);
    const pi = cur.pi;
    if (cur.erase && cur.removed.length) { for (const { page, s, i } of [...cur.removed].reverse()) page.strokes.splice(i, 0, s); }
    cur = null; curId = null;
    liveLeeren(true);
    neuZeichnen(pi);
  }

  // ---------- Objekte: Symbole, Linien, Rechtecke, Maße, Text, Fotos ----------
  let sel = null; // {pi, o}
  const PENFARBE = () => PEN_FARBEN[W.pen.c];
  const PENBREITE = () => PEN_BREITEN[W.pen.w] * 1.4;
  function waehle(s) { sel = s; zeigeAuswahl(); }

  // Änderung an den Objekten einer Seite mit Rückgängig-Eintrag
  function objektAenderung(i, fn, vorher = structuredClone(slots[i].p.objects)) {
    const page = slots[i].p;
    fn(page);
    const nachher = structuredClone(page.objects);
    if (JSON.stringify(vorher) === JSON.stringify(nachher)) return;
    merkeSchritt({ op: 'obj', page, vorher, nachher });
    neuZeichnen(i); geaendert(page); zeichneLeiste();
  }

  function sichtbareMitte(i, h = 0) {
    const page = slots[i].p;
    return {
      x: Math.max(0, Math.min(page.w, (vw / 2 - offX) / scale)),
      y: Math.max(h / 2 + 10, Math.min(page.h - h / 2 - 10, (vh / 2 - offY - tops[i]) / scale)),
    };
  }

  function neuesObjekt(i, o) {
    objektAenderung(i, p => p.objects.push(o));
    W.tool = 'auswahl'; merke();
    lasso = null;
    waehle({ pi: i, o });
    zeichneLeiste();
  }

  function einfuegen(art) {
    const i = mitte, page = slots[i].p, m = sichtbareMitte(i, 120);
    neuesObjekt(i, neuesSymbol(art, m.x, m.y, page.massstab, uid()));
  }

  fotoInput.addEventListener('change', async () => {
    const dateien = [...fotoInput.files];
    fotoInput.value = '';
    for (const f of dateien) {
      try {
        zeigeStatus('Foto wird eingefügt …');
        const bmp = await createImageBitmap(f);
        const max = 2000, k = Math.min(1, max / Math.max(bmp.width, bmp.height));
        const c = document.createElement('canvas');
        c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        bmp.close?.();
        const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
        const ratio = c.height / c.width;
        c.width = c.height = 0;
        const fileId = await onAddFile(blob, 'image/jpeg');
        const i = mitte, page = slots[i].p;
        let w = page.w * 0.6, h = w * ratio;
        if (h > page.h * 0.6) { h = page.h * 0.6; w = h / ratio; }
        const m = sichtbareMitte(i, h);
        await ladeBild(fileId);
        neuesObjekt(i, { id: uid(), typ: 'bild', fileId, x: m.x, y: m.y, w, h, rot: 0, spiegel: false });
        zeigeStatus('');
      } catch (err) { zeigeStatus('Foto konnte nicht eingefügt werden: ' + (err.message || err), true); }
    }
  });

  async function textFeld(i, x, y, alt) {
    const t = await ui.frageText(alt ? 'Text ändern' : 'Neues Textfeld', alt?.text || '');
    if (t == null) return;
    if (alt) {
      objektAenderung(i, p => {
        const o = p.objects.find(q => q.id === alt.id);
        if (!t.trim()) { p.objects = p.objects.filter(q => q !== o); return; }
        const lx = o.x - o.w / 2, ly = o.y - o.h / 2, m = textMasse(t, o.gr);
        Object.assign(o, { text: t, w: m.w, h: m.h, x: lx + m.w / 2, y: ly + m.h / 2 });
      });
      const o = slots[i].p.objects.find(q => q.id === alt.id);
      waehle(o ? { pi: i, o } : null);
      return;
    }
    if (!t.trim()) return;
    const gr = 18, m = textMasse(t, gr);
    neuesObjekt(i, { id: uid(), typ: 'text', text: t, gr, c: PENFARBE(), x: x + m.w / 2, y: y + m.h / 2, w: m.w, h: m.h, rot: 0, spiegel: false });
  }

  function zeigeAuswahl() {
    liveLeeren(true);
    ctxBar.hidden = true;
    if (lasso && slots[lasso.pi]) return zeigeLasso();
    if (!sel || W.tool !== 'auswahl' || !slots[sel.pi]) return;
    const o = sel.o, k = 1 / scale;
    liveSeite(sel.pi);
    lctx.save();
    lctx.strokeStyle = '#3d8bf5'; lctx.lineWidth = 1.6 * k;
    if (istKasten(o)) {
      lctx.save();
      lctx.translate(o.x, o.y); lctx.rotate(o.rot * Math.PI / 180);
      lctx.setLineDash([6 * k, 4 * k]);
      lctx.strokeRect(-o.w / 2, -o.h / 2, o.w, o.h);
      lctx.setLineDash([]);
      lctx.beginPath(); lctx.moveTo(0, -o.h / 2); lctx.lineTo(0, -o.h / 2 - 30 * k); lctx.stroke();
      lctx.restore();
    }
    for (const g of griffe(o, 30 * k)) {
      lctx.beginPath(); lctx.arc(g.x, g.y, (g.art === 'drehen' ? 9 : 7) * k, 0, Math.PI * 2);
      lctx.fillStyle = g.art === 'drehen' ? '#3d8bf5' : '#fff'; lctx.fill(); lctx.stroke();
    }
    lctx.restore();
    const pts = griffe(o, 30 * k).map(g => ({ x: offX + g.x * scale, y: offY + tops[sel.pi] + g.y * scale }));
    zeigeLeiste(pts, { drehen: istKasten(o), spiegeln: o.typ === 'symbol', text: o.typ === 'text', masse: o.typ === 'symbol' || o.typ === 'rechteck' });
  }

  function zeigeLeiste(pts, knoepfe) {
    const x0 = Math.min(...pts.map(q => q.x)), x1 = Math.max(...pts.map(q => q.x));
    const y0 = Math.min(...pts.map(q => q.y)), y1 = Math.max(...pts.map(q => q.y));
    for (const k of ['drehen', 'spiegeln', 'text', 'masse']) ctxBar.querySelector(`[data-k=${k}]`).hidden = !knoepfe[k];
    ctxBar.hidden = false;
    const bw = ctxBar.offsetWidth, bh = ctxBar.offsetHeight;
    let top = y1 + 14;
    if (top + bh > vh - 8) top = Math.max(8, y0 - bh - 14);
    ctxBar.style.left = Math.max(8, Math.min(vw - bw - 8, (x0 + x1) / 2 - bw / 2)) + 'px';
    ctxBar.style.top = Math.min(top, vh - bh - 8) + 'px';
  }

  function auswahlStart(e) {
    const finger = e.pointerType === 'touch';
    const i = seiteBei(e);
    if (i < 0) { waehle(null); if (finger) panStart(e); return; }
    const page = slots[i].p, p = pt(e, i), tol = (finger ? 14 : 8) / scale;
    let griff = null;
    if (sel && sel.pi === i) griff = griffe(sel.o, 30 / scale).find(g => Math.hypot(g.x - p.x, g.y - p.y) <= (finger ? 22 : 14) / scale);
    if (!griff) {
      const o = trefferObjekt(page, p.x, p.y, tol);
      if (!o) { waehle(null); if (finger) panStart(e); return; }
      sel = { pi: i, o };
    }
    stoppeSchwung();
    e.preventDefault();
    fang(e);
    curId = e.pointerId;
    cur = { obj: griff ? griff.art : 'move', griff, pi: i, start: p, orig: structuredClone(sel.o), vorher: structuredClone(page.objects), bewegt: false };
    zeigeAuswahl();
    ctxBar.hidden = true;
  }

  function auswahlMove(e) {
    e.preventDefault();
    const p = pt(e, cur.pi), o = sel.o, g = cur.orig;
    if (Math.hypot(p.x - cur.start.x, p.y - cur.start.y) * scale > 3) cur.bewegt = true;
    if (!cur.bewegt) return;
    if (cur.obj === 'move') {
      const dx = p.x - cur.start.x, dy = p.y - cur.start.y;
      if (istKasten(o)) { o.x = g.x + dx; o.y = g.y + dy; if (o.typ === 'symbol' || o.typ === 'rechteck') rasteKasten(o); }
      else {
        const sx = rasten(g.x1 + dx) - g.x1, sy = rasten(g.y1 + dy) - g.y1;
        Object.assign(o, { x1: g.x1 + sx, y1: g.y1 + sy, x2: g.x2 + sx, y2: g.y2 + sy });
      }
    } else if (cur.obj === 'ecke') {
      const { sx, sy } = cur.griff, lp = lokal(g, p.x, p.y);
      const ox = -sx * g.w / 2, oy = -sy * g.h / 2;
      let w, h;
      if (o.typ === 'bild' || o.typ === 'text') { // Seitenverhältnis bleibt
        w = Math.max(20, Math.abs(lp.x - ox)); h = w * g.h / g.w;
        if (o.typ === 'text') o.gr = g.gr * w / g.w;
      } else {
        w = Math.max(RASTER, rasten(Math.abs(lp.x - ox))); h = Math.max(RASTER, rasten(Math.abs(lp.y - oy)));
      }
      const m = global(g, ox + sx * w / 2, oy + sy * h / 2);
      Object.assign(o, { w, h, x: m.x, y: m.y });
    } else if (cur.obj === 'drehen') {
      let r = Math.atan2(p.y - o.y, p.x - o.x) * 180 / Math.PI + 90;
      const r90 = Math.round(r / 90) * 90;
      r = Math.abs(r - r90) < 6 ? r90 : Math.round(r);
      o.rot = ((r % 360) + 360) % 360;
      if (o.rot % 90 === 0 && (o.typ === 'symbol' || o.typ === 'rechteck')) rasteKasten(o);
    } else if (cur.obj === 'ende') {
      const n = cur.griff.n, a = n === 1 ? 2 : 1;
      const { x2, y2 } = rasteLinie(o['x' + a], o['y' + a], p.x, p.y);
      o['x' + n] = x2; o['y' + n] = y2;
    }
    neuZeichnen(cur.pi);
    zeigeAuswahl();
    ctxBar.hidden = true;
  }

  function auswahlEnde() {
    const { pi, vorher, bewegt } = cur, o = sel?.o;
    cur = null; curId = null;
    objektAenderung(pi, () => {}, vorher);
    zeigeAuswahl();
    // Doppeltipp-Ersatz: Text antippen ohne Bewegung = bearbeiten, wenn er schon ausgewählt war
    if (!bewegt && o?.typ === 'text' && tippZuletzt === o.id) textFeld(pi, 0, 0, o);
    tippZuletzt = !bewegt && o ? o.id : null;
  }
  let tippZuletzt = null;

  function formStart(e) {
    const i = seiteBei(e);
    if (i < 0) return;
    e.preventDefault();
    fang(e);
    stoppeSchwung(); pan = null;
    const p = pt(e, i), x = rasten(p.x), y = rasten(p.y);
    curId = e.pointerId;
    cur = { form: W.tool, pi: i, x1: x, y1: y, x2: x, y2: y };
    waehle(null);
    liveSeite(i);
  }
  function formObjekt(f) {
    if (f.form === 'rechteck') return { id: uid(), typ: 'rechteck', x: (f.x1 + f.x2) / 2, y: (f.y1 + f.y2) / 2, w: Math.abs(f.x2 - f.x1), h: Math.abs(f.y2 - f.y1), rot: 0, spiegel: false, c: PENFARBE(), lw: PENBREITE() };
    if (f.form === 'linie') return { id: uid(), typ: 'linie', x1: f.x1, y1: f.y1, x2: f.x2, y2: f.y2, c: PENFARBE(), lw: PENBREITE() };
    return { id: uid(), typ: 'mass', x1: f.x1, y1: f.y1, x2: f.x2, y2: f.y2 };
  }
  function formMove(e) {
    e.preventDefault();
    const p = pt(e, cur.pi);
    if (cur.form === 'rechteck') { cur.x2 = rasten(p.x); cur.y2 = rasten(p.y); }
    else Object.assign(cur, rasteLinie(cur.x1, cur.y1, p.x, p.y));
    liveLeeren(true); liveSeite(cur.pi);
    zeichneObjekt(lctx, formObjekt(cur), slots[cur.pi].p.massstab);
  }
  function formEnde() {
    const f = cur;
    cur = null; curId = null;
    liveLeeren(true);
    const o = formObjekt(f);
    const gross = o.typ === 'rechteck' ? o.w >= RASTER && o.h >= RASTER : Math.hypot(o.x2 - o.x1, o.y2 - o.y1) >= RASTER;
    if (gross) objektAenderung(f.pi, p => p.objects.push(o));
  }

  // ---------- Lasso ----------
  let lasso = null; // {pi, strokes: [Strich], objIds: [id], box: [x0,y0,x1,y1]}
  function lassoBox(page, strokes, objIds) {
    let b = [Infinity, Infinity, -Infinity, -Infinity];
    const dazu = (x0, y0, x1, y1) => { b = [Math.min(b[0], x0), Math.min(b[1], y0), Math.max(b[2], x1), Math.max(b[3], y1)]; };
    for (const s of strokes) { vergissBox(s); const q = strokeBox(s); dazu(q[0] - s.w, q[1] - s.w, q[2] + s.w, q[3] + s.w); }
    for (const o of page.objects.filter(x => objIds.includes(x.id))) {
      if (istKasten(o)) { const r = Math.hypot(o.w, o.h) / 2; dazu(o.x - r, o.y - r, o.x + r, o.y + r); }
      else dazu(Math.min(o.x1, o.x2), Math.min(o.y1, o.y2), Math.max(o.x1, o.x2), Math.max(o.y1, o.y2));
    }
    return b;
  }
  function schiebeAuswahl(page, strokes, objIds, dx, dy) {
    for (const s of strokes) { const a = s.pts; for (let i = 0; i < a.length; i += 3) { a[i] += dx; a[i + 1] += dy; } vergissBox(s); }
    for (const o of page.objects) if (objIds.includes(o.id)) verschiebe(o, dx, dy);
  }
  function zeigeLasso() {
    const k = 1 / scale, [x0, y0, x1, y1] = lasso.box;
    liveSeite(lasso.pi);
    lctx.save();
    lctx.strokeStyle = '#3d8bf5'; lctx.lineWidth = 1.6 * k; lctx.setLineDash([6 * k, 4 * k]);
    lctx.fillStyle = 'rgba(61,139,245,.06)';
    lctx.fillRect(x0, y0, x1 - x0, y1 - y0); lctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    lctx.restore();
    if (cur?.lassoMove) return;
    const t = offY + tops[lasso.pi];
    zeigeLeiste([{ x: offX + x0 * scale, y: t + y0 * scale }, { x: offX + x1 * scale, y: t + y1 * scale }], {});
  }
  function lassoStart(e) {
    const finger = e.pointerType === 'touch';
    const i = seiteBei(e);
    if (i < 0) { lasso = null; zeigeAuswahl(); if (finger) panStart(e); return; }
    const p = pt(e, i);
    if (lasso && lasso.pi === i) {
      const [x0, y0, x1, y1] = lasso.box, m = 10 / scale;
      if (p.x >= x0 - m && p.x <= x1 + m && p.y >= y0 - m && p.y <= y1 + m) {
        e.preventDefault(); fang(e); curId = e.pointerId;
        cur = { lassoMove: true, pi: i, start: p, dx: 0, dy: 0 };
        zeigeAuswahl();
        return;
      }
    }
    lasso = null; zeigeAuswahl();
    if (finger && W.penOnly) { panStart(e); return; }
    e.preventDefault(); fang(e); curId = e.pointerId;
    cur = { lassoPfad: [p.x, p.y], pi: i };
  }
  function lassoMove(e) {
    e.preventDefault();
    const p = pt(e, cur.pi);
    if (cur.lassoMove) {
      const dx = p.x - cur.start.x - cur.dx, dy = p.y - cur.start.y - cur.dy;
      const page = slots[cur.pi].p;
      schiebeAuswahl(page, lasso.strokes, lasso.objIds, dx, dy);
      cur.dx += dx; cur.dy += dy;
      lasso.box = [lasso.box[0] + dx, lasso.box[1] + dy, lasso.box[2] + dx, lasso.box[3] + dy];
      neuZeichnen(cur.pi); liveLeeren(true); zeigeLasso();
      return;
    }
    const a = cur.lassoPfad;
    if (Math.hypot(p.x - a[a.length - 2], p.y - a[a.length - 1]) * scale < 3) return;
    a.push(p.x, p.y);
    liveLeeren(true); liveSeite(cur.pi);
    lctx.save();
    lctx.strokeStyle = '#3d8bf5'; lctx.lineWidth = 1.6 / scale; lctx.setLineDash([5 / scale, 4 / scale]);
    lctx.beginPath(); lctx.moveTo(a[0], a[1]);
    for (let i = 2; i < a.length; i += 2) lctx.lineTo(a[i], a[i + 1]);
    lctx.stroke(); lctx.restore();
  }
  function lassoEnde() {
    const c = cur;
    cur = null; curId = null;
    liveLeeren(true);
    const page = slots[c.pi].p;
    if (c.lassoMove) {
      if (c.dx || c.dy) { merkeSchritt({ op: 'schieb', page, strokes: [...lasso.strokes], objIds: [...lasso.objIds], dx: c.dx, dy: c.dy }); geaendert(page); zeichneLeiste(); }
      zeigeAuswahl(); return;
    }
    const poly = c.lassoPfad;
    if (poly.length < 8) { lasso = null; zeigeAuswahl(); return; }
    const strokes = page.strokes.filter(s => {
      const a = s.pts, n = a.length / 3;
      let drin = 0;
      for (let i = 0; i < n; i++) if (imVieleck(a[i * 3], a[i * 3 + 1], poly)) drin++;
      return drin / n >= 0.5;
    });
    const objIds = page.objects.filter(o => istKasten(o) ? imVieleck(o.x, o.y, poly) : imVieleck((o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2, poly)).map(o => o.id);
    lasso = strokes.length || objIds.length ? { pi: c.pi, strokes, objIds, box: lassoBox(page, strokes, objIds) } : null;
    zeigeAuswahl();
  }

  async function aktion(k) {
    if (lasso) {
      const { pi, strokes, objIds } = lasso, page = slots[pi].p;
      const vorher = structuredClone(page.objects);
      if (k === 'del') {
        const items = strokes.map(s => ({ page, s, i: page.strokes.indexOf(s) })).sort((a, b) => b.i - a.i);
        for (const it of items) page.strokes.splice(it.i, 1);
        page.objects = page.objects.filter(o => !objIds.includes(o.id));
        merkeSchritt({ op: 'gruppe', ops: [{ op: 'erase', items }, { op: 'obj', page, vorher, nachher: structuredClone(page.objects) }] });
        lasso = null;
      } else if (k === 'dup') {
        const d = RASTER * 2, neuS = strokes.map(s => ({ ...structuredClone(s), id: uid() }));
        const neuO = page.objects.filter(o => objIds.includes(o.id)).map(o => ({ ...structuredClone(o), id: uid() }));
        for (const s of neuS) { page.strokes.push(s); }
        page.objects.push(...neuO);
        schiebeAuswahl(page, neuS, neuO.map(o => o.id), d, d);
        merkeSchritt({ op: 'gruppe', ops: [...neuS.map(s => ({ op: 'add', page, s })), { op: 'obj', page, vorher, nachher: structuredClone(page.objects) }] });
        lasso = { pi, strokes: neuS, objIds: neuO.map(o => o.id), box: lassoBox(page, neuS, neuO.map(o => o.id)) };
      }
      neuZeichnen(pi); geaendert(page); zeigeAuswahl(); zeichneLeiste();
      return;
    }
    if (!sel) return;
    const { pi } = sel, page = slots[pi].p, id = sel.o.id;
    const finde = p => p.objects.find(x => x.id === id);
    if (k === 'del') { objektAenderung(pi, p => { p.objects = p.objects.filter(x => x.id !== id); }); waehle(null); return; }
    if (k === 'dup') {
      const kopie = { ...structuredClone(sel.o), id: uid() };
      verschiebe(kopie, RASTER * 2, RASTER * 2);
      objektAenderung(pi, p => p.objects.push(kopie));
      waehle({ pi, o: kopie }); return;
    }
    if (k === 'text') { textFeld(pi, 0, 0, sel.o); return; }
    if (k === 'drehen') objektAenderung(pi, p => { const o = finde(p); o.rot = (Math.round(o.rot / 90) * 90 + 90) % 360; if (o.typ === 'symbol' || o.typ === 'rechteck') rasteKasten(o); });
    if (k === 'spiegeln') objektAenderung(pi, p => { const o = finde(p); o.spiegel = !o.spiegel; });
    if (k === 'masse') {
      const o = sel.o, name = o.typ === 'symbol' ? SYMBOLE[o.art].name : 'Rechteck';
      const m = await ui.frageMasse(`${name}: Maße bei 1:${page.massstab || STANDARD_MASSSTAB}`, inCm(o.w, page.massstab), inCm(o.h, page.massstab));
      if (!m) return;
      objektAenderung(pi, p => { const x = finde(p); x.w = m.b * proCm(p.massstab); x.h = m.l * proCm(p.massstab); rasteKasten(x); });
    }
    const o = finde(slots[pi].p);
    sel = o ? { pi, o } : null;
    zeigeAuswahl();
  }
  ctxBar.addEventListener('pointerdown', e => e.stopPropagation());
  ctxBar.addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (b) aktion(b.dataset.k); });

  // ---------- Neue Seite ----------
  addBtn.addEventListener('click', async () => {
    const letzte = [...pages].reverse().find(p => !p.bg);
    const p = neueSeite(letzte?.paper || 'liniert');
    try { await onAddPage(p); } catch (err) { zeigeStatus('Seite konnte nicht angelegt werden: ' + (err.message || err), true); return; }
    pages.push(p);
    const s = slotFuer(p);
    slots.push(s);
    stack.insertBefore(s.el, addBtn);
    layout();
    setze(offX, RAND - tops[tops.length - 1]);
    zeichneLeiste();
  });

  // ---------- Blättern (ein Finger, mit Schwung), Zoomen (zwei Finger, Strg+Mausrad) ----------
  let pan = null, schwung = 0;
  function stoppeSchwung() { if (schwung) cancelAnimationFrame(schwung); schwung = 0; }
  function panStart(e) {
    if (cur || pan) return;
    stoppeSchwung();
    fang(e);
    pan = { id: e.pointerId, x: e.clientX, y: e.clientY, ox: offX, oy: offY, lx: e.clientX, ly: e.clientY, lt: performance.now(), vx: 0, vy: 0 };
  }
  function panMove(e) {
    const t = performance.now(), dt = Math.max(1, t - pan.lt);
    pan.vx = 0.7 * ((e.clientX - pan.lx) / dt) + 0.3 * pan.vx;
    pan.vy = 0.7 * ((e.clientY - pan.ly) / dt) + 0.3 * pan.vy;
    pan.lx = e.clientX; pan.ly = e.clientY; pan.lt = t;
    setze(pan.ox + e.clientX - pan.x, pan.oy + e.clientY - pan.y);
  }
  function panEnde() {
    const alt = performance.now() - pan.lt > 80;
    let vx = alt ? 0 : pan.vx, vy = alt ? 0 : pan.vy, t0 = performance.now();
    pan = null;
    if (Math.hypot(vx, vy) < 0.1) return;
    const lauf = t => {
      const dt = t - t0; t0 = t;
      setze(offX + vx * dt, offY + vy * dt);
      const f = Math.pow(0.95, dt / 16); vx *= f; vy *= f;
      schwung = Math.hypot(vx, vy) > 0.02 ? requestAnimationFrame(lauf) : 0;
    };
    schwung = requestAnimationFrame(lauf);
  }

  const finger = new Map(); // pointerId -> {x, y}
  let pinch = null;
  function viewXY(x, y) { const r = view.getBoundingClientRect(); return { x: x - r.left, y: y - r.top }; }
  function pinchStart() {
    const [a, b] = [...finger.values()];
    if (cur) { if (cur.finger) abbrechen(); else return; }
    pan = null; stoppeSchwung();
    const m = viewXY((a.x + b.x) / 2, (a.y + b.y) / 2);
    pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, m0: m, m, z0: zoom, f: 1, anker: ankerBei(m.x, m.y), ox: offX, oy: offY };
    liveLeeren(true); ctxBar.hidden = true;
  }
  function pinchMove() {
    const [a, b] = [...finger.values()];
    const m = viewXY((a.x + b.x) / 2, (a.y + b.y) / 2);
    const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, pinch.z0 * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d0));
    pinch.f = z / pinch.z0; pinch.m = m;
    const tx = m.x - (pinch.m0.x - pinch.ox) * pinch.f, ty = m.y - (pinch.m0.y - pinch.oy) * pinch.f;
    stack.style.transform = `translate3d(${tx}px,${ty}px,0) scale(${pinch.f})`;
  }
  function pinchEnde() {
    const p = pinch;
    pinch = null;
    zoom = p.z0 * p.f;
    layout({ ...p.anker, sx: p.m.x, sy: p.m.y });
  }
  let radZoom = null;
  function radZoomen(e) {
    const m = viewXY(e.clientX, e.clientY);
    if (!radZoom) radZoom = { z0: zoom, f: 1, m0: m, anker: ankerBei(m.x, m.y), ox: offX, oy: offY, t: 0 };
    const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, radZoom.z0 * radZoom.f * Math.exp(-e.deltaY * 0.01)));
    radZoom.f = z / radZoom.z0;
    stack.style.transform = `translate3d(${m.x - (radZoom.m0.x - radZoom.ox) * radZoom.f}px,${m.y - (radZoom.m0.y - radZoom.oy) * radZoom.f}px,0) scale(${radZoom.f})`;
    liveLeeren(true); ctxBar.hidden = true;
    clearTimeout(radZoom.t);
    radZoom.t = setTimeout(() => { const r = radZoom; radZoom = null; zoom = r.z0 * r.f; layout({ ...r.anker, sx: m.x, sy: m.y }); }, 160);
  }
  zoomKnopf.addEventListener('click', () => { zoom = 1; layout(ankerBei(vw / 2, vh / 2)); });

  // ---------- Zeiger-Ereignisse verteilen ----------
  const aufKnopf = e => e.target.closest?.('.ed-add, .ed-ctx, .ed-zoom');
  const onDown = e => {
    if (aufKnopf(e)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.pointerType === 'touch') {
      finger.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (finger.size === 2) { pinchStart(); return; }
      if (finger.size > 2 || pinch) return;
    }
    if (cur) return;
    if (W.tool === 'auswahl') { if (!pan) auswahlStart(e); return; }
    if (W.tool === 'lasso') { if (!pan) lassoStart(e); return; }
    if (e.pointerType === 'touch' && W.penOnly) { panStart(e); return; }
    if (W.tool === 'text') { const i = seiteBei(e); if (i >= 0) { e.preventDefault(); const p = pt(e, i); textFeld(i, p.x, p.y); } return; }
    if (FORMEN.includes(W.tool)) formStart(e);
    else start(e);
  };
  const onMove = e => {
    if (e.pointerType === 'touch' && finger.has(e.pointerId)) {
      finger.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch) { e.preventDefault(); pinchMove(); return; }
    }
    if (pan && e.pointerId === pan.id) { e.preventDefault(); panMove(e); return; }
    if (!cur || e.pointerId !== curId) return;
    if (cur.obj) auswahlMove(e);
    else if (cur.form) formMove(e);
    else if (cur.lassoPfad || cur.lassoMove) lassoMove(e);
    else weiter(e);
  };
  const onUp = e => {
    if (e.pointerType === 'touch') {
      finger.delete(e.pointerId);
      if (pinch) { if (finger.size < 2) pinchEnde(); return; }
    }
    if (pan && e.pointerId === pan.id) { panEnde(); return; }
    if (!cur || e.pointerId !== curId) return;
    if (cur.obj) auswahlEnde();
    else if (cur.form) formEnde();
    else if (cur.lassoPfad || cur.lassoMove) lassoEnde();
    else ende();
  };
  view.addEventListener('pointerdown', onDown);
  view.addEventListener('pointermove', onMove, { passive: false });
  view.addEventListener('pointerup', onUp);
  view.addEventListener('pointercancel', onUp);
  // iOS: eigene Gesten statt Safari-Zoom und Zurückwischen
  view.addEventListener('touchstart', e => { if (!aufKnopf(e)) e.preventDefault(); }, { passive: false });
  view.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
  view.addEventListener('wheel', e => {
    e.preventDefault(); stoppeSchwung();
    if (e.ctrlKey || e.metaKey) radZoomen(e);
    else setze(offX - e.deltaX, offY - e.deltaY);
  }, { passive: false });

  const onKey = e => {
    if (e.target === titel || e.target.closest?.('dialog')) return;
    const k = e.key.toLowerCase();
    if ((k === 'delete' || k === 'backspace') && (sel || lasso)) { e.preventDefault(); aktion('del'); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? wiederholen() : rueckgaengig(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); wiederholen(); }
  };
  document.addEventListener('keydown', onKey);

  // ---------- Speichern ----------
  let fehler = false;
  const offen = new Set();
  const speichereSeiten = debounce(async () => {
    const liste = [...offen]; offen.clear();
    try {
      for (const p of liste) await onSavePage(p);
      if (fehler) zeigeStatus('Gespeichert');
    } catch (err) {
      for (const p of liste) offen.add(p);
      zeigeStatus('Speichern fehlgeschlagen: ' + (err.message || err), true);
    }
  }, 400);
  const speichereVorschau = debounce(async () => {
    try { await onSaveThumb(await makeThumb(pages[0])); } catch { /* Vorschau ist nicht kritisch */ }
  }, 2500);
  function geaendert(p) {
    offen.add(p); speichereSeiten();
    if (p === pages[0]) speichereVorschau();
  }
  function zeigeStatus(t, istFehler = false) { fehler = istFehler; status.textContent = t; status.classList.toggle('fehler', istFehler); }

  const sichern = () => Promise.all([speichereSeiten.flush(), speichereVorschau.flush()]);
  const onHidden = () => { if (document.visibilityState === 'hidden') sichern(); };
  document.addEventListener('visibilitychange', onHidden);
  window.addEventListener('pagehide', sichern);

  const ro = new ResizeObserver(() => requestAnimationFrame(() => layout()));
  ro.observe(view);
  zeichneLeiste();
  layout(null);

  return {
    async close() {
      if (cur) { if (cur.s || cur.erase) ende(); else abbrechen(); }
      if (document.activeElement === titel) titel.blur();
      const t = titel.value.trim();
      if (t && t !== titelStand) { titelStand = t; await onTitle(t); }
      ro.disconnect(); stoppeSchwung();
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', sichern);
      await sichern();
      for (const s of slots) for (const k of [...s.kacheln.values()]) abbauen(k);
      for (const c of vorrat) c.width = c.height = 0;
      live.width = live.height = 0;
    },
    sichern,
  };
}
