// Notiz-Editor: Schreiben mit dem Apple Pencil.
// Schreibtechnik wie stift-test.html: Striche-Canvas (desynchronized) plus Live-Ebene,
// getCoalescedEvents für alle Zwischenpunkte, getPredictedEvents gegen Verzögerung.
// Seiten liegen untereinander. Nur sichtbare Seiten bekommen Canvas (spart Speicher auf dem iPad).
// Jede Seite: Hintergrund-Canvas (Papier oder PDF) + Striche-Canvas. "Nur Stift": Finger blättert.
import { PAPIERE, drawPaper, drawInkPart, drawInkTail, drawMarker, drawStrokes, wOf, trifft } from './ink.js';
import { zeichne as zeichnePdf } from './pdf.js';
import {
  SYMBOLE, MASSSTAEBE, STANDARD_MASSSTAB, RASTER, zeichneSymbol, zeichneObjekt, zeichneObjekte, istKasten, lokal, global,
  trefferObjekt, griffe, rasten, rasteKasten, rasteLinie, neuesSymbol, inCm, proCm,
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
const MAX_PX = 7e6; // Pixel je Canvas (Safari-Grenze 16,7 Mio., Speicher schonen)
const VORLAUF = 300; // Seiten so weit außerhalb des Bildschirms schon vorbereiten (px)

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
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

export function openEditor(root, { note, pages, ordnerName, onBack, onTitle, onSavePage, onAddPage, onSaveThumb, neueSeite }) {
  let W = ladeWerkzeug();
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
      </div>
      <div class="ed-zeile">
        <div class="grp" data-g="tools">
          <button data-tool="pen" title="Stift" aria-label="Stift">${ICON.pen}</button>
          <button data-tool="marker" title="Textmarker" aria-label="Textmarker">${ICON.marker}</button>
          <button data-tool="eraser" title="Radierer (ganze Striche)" aria-label="Radierer">${ICON.eraser}</button>
        </div>
        <div class="grp" data-g="skizze">
          <button data-tool="auswahl" title="Auswählen und verschieben" aria-label="Auswählen">${ICON.auswahl}</button>
          <button data-tool="linie" title="Gerade Linie" aria-label="Linie">${ICON.linie}</button>
          <button data-tool="rechteck" title="Rechteck" aria-label="Rechteck">${ICON.rechteck}</button>
          <button data-tool="mass" title="Maßlinie" aria-label="Maßlinie">${ICON.mass}</button>
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
      <div class="ed-ctx" hidden role="toolbar" aria-label="Objekt">
        <button data-k="drehen">↻ 90°</button><button data-k="spiegeln">⇋ Spiegeln</button><button data-k="dup">Duplizieren</button>
        <button data-k="masse">Maße …</button><button data-k="del" class="gefahr">Löschen</button>
      </div>
      <div class="ed-seitenzahl" aria-live="off"></div>
    </div>
  </div>`;

  const $ = s => root.querySelector(s);
  const bar = $('.ed-bar'), view = $('.ed-view'), stack = $('.ed-stack');
  const ctxBar = $('.ed-ctx'), symbolLeiste = $('.ed-symbole');
  const live = $('.ed-live'), titel = $('.ed-title'), status = $('.ed-status'), seitenzahl = $('.ed-seitenzahl');
  const lctx = live.getContext('2d', { desynchronized: true }) || live.getContext('2d');

  // Seiten-Elemente (ohne Canvas) und Knopf "Neue Seite"
  const slots = [];
  const addBtn = document.createElement('button');
  addBtn.className = 'ed-add';
  addBtn.innerHTML = ICON.plus + '<span>Neue Seite</span>';
  function slotFuer(p) {
    const el = document.createElement('div');
    el.className = 'ed-page';
    return { el, p, an: false };
  }
  for (const p of pages) { p.objects ||= []; slots.push(slotFuer(p)); }
  for (const c of symbolLeiste.querySelectorAll('canvas[data-icon]')) {
    const art = c.dataset.icon, s = SYMBOLE[art], g = c.getContext('2d'), k = Math.min(70 / s.b, 52 / s.l);
    g.translate(44, 32); g.scale(k, k);
    zeichneSymbol(g, art, s.b, s.l, 2.4 / k, '#eef0f3');
  }
  stack.append(...slots.map(s => s.el), addBtn);

  // ---------- Werkzeugleiste ----------
  const hatPapier = () => pages.some(p => !p.bg);
  function zeichneLeiste() {
    for (const b of bar.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', b.dataset.tool === W.tool);
    const art = W.tool === 'marker' ? 'marker' : 'pen';
    const farben = art === 'marker' ? MARKER_FARBEN : PEN_FARBEN;
    const breiten = art === 'marker' ? MARKER_BREITEN : PEN_BREITEN;
    const aus = !['pen', 'marker', 'linie', 'rechteck'].includes(W.tool);
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
    if (b.dataset.tool) { W.tool = b.dataset.tool; if (W.tool !== 'auswahl') waehle(null); }
    else if (b.dataset.a === 'symbole') W.symbole = !W.symbole;
    else if (b.dataset.a === 'massstab') {
      const p = slots[mitte].p, alt = p.massstab || STANDARD_MASSSTAB;
      p.massstab = MASSSTAEBE[(MASSSTAEBE.indexOf(alt) + 1) % MASSSTAEBE.length];
      striche(mitte); geaendert(p);
    }
    else if (b.dataset.c) { W[art].c = +b.dataset.c; if (W.tool === 'eraser') W.tool = art; }
    else if (b.dataset.w) { W[art].w = +b.dataset.w; if (W.tool === 'eraser') W.tool = art; }
    else if (b.dataset.a === 'undo') rueckgaengig();
    else if (b.dataset.a === 'redo') wiederholen();
    else if (b.dataset.a === 'penonly') W.penOnly = !W.penOnly;
    else if (b.dataset.a === 'paper') {
      const erste = pages.find(p => !p.bg);
      const neu = PAPIER_REIHE[(PAPIER_REIHE.indexOf(erste.paper) + 1) % PAPIER_REIHE.length];
      slots.forEach((s, i) => { if (!s.p.bg) { s.p.paper = neu; if (s.an) hintergrund(i); geaendert(s.p); } });
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

  // ---------- Lage der Seiten ----------
  let scale = 1, offX = RAND, offY = RAND, vw = 0, vh = 0, stapelH = 0, dpr = 1;
  let tops = [], mitte = 0;

  function layout() {
    const r = view.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const anteil = stapelH ? (RAND - offY) / stapelH : 0;
    vw = r.width; vh = r.height; dpr = window.devicePixelRatio || 1;
    scale = Math.min((vw - 2 * RAND) / 1000, 1.25);
    tops = [];
    let y = 0;
    for (const s of slots) {
      tops.push(y);
      Object.assign(s.el.style, { top: y + 'px', width: s.p.w * scale + 'px', height: s.p.h * scale + 'px' });
      y += s.p.h * scale + LUECKE;
    }
    addBtn.style.top = y + 'px';
    addBtn.style.width = 1000 * scale + 'px';
    stapelH = y + 64;
    live.width = Math.round(vw * dpr); live.height = Math.round(vh * dpr);
    live.style.width = vw + 'px'; live.style.height = vh + 'px';
    offX = Math.max(RAND, (vw - 1000 * scale) / 2);
    for (let i = 0; i < slots.length; i++) abbauen(i);
    setzeY(RAND - anteil * stapelH);
    zeigeAuswahl();
  }

  function setzeY(y) {
    const min = Math.min(RAND, vh - stapelH - RAND);
    offY = Math.max(min, Math.min(RAND, y));
    stack.style.transform = `translate3d(${offX}px,${offY}px,0)`;
    sichtbar();
    if (sel && !cur) zeigeAuswahl();
  }

  // Seiten im Sichtbereich bekommen Canvas, die anderen geben den Speicher wieder frei.
  function sichtbar() {
    const vorher = mitte;
    mitte = 0;
    for (let i = 0; i < slots.length; i++) {
      const t = offY + tops[i], b = t + slots[i].p.h * scale;
      const zeigen = b > -VORLAUF && t < vh + VORLAUF;
      if (zeigen && !slots[i].an) aufbauen(i);
      else if (!zeigen && slots[i].an && !(cur && cur.pi === i)) abbauen(i);
      if (t < vh / 2) mitte = i;
    }
    seitenzahl.textContent = slots.length > 1 ? `Seite ${mitte + 1} von ${slots.length}` : '';
    if (mitte !== vorher && !symbolLeiste.hidden) zeichneLeiste();
  }

  function aufbauen(i) {
    const s = slots[i], p = s.p;
    const cssW = p.w * scale, cssH = p.h * scale;
    const d = Math.min(dpr, Math.sqrt(MAX_PX / (cssW * cssH)));
    s.bg = document.createElement('canvas'); s.bg.className = 'bg';
    s.base = document.createElement('canvas'); s.base.className = 'base';
    for (const c of [s.bg, s.base]) {
      c.width = Math.round(cssW * d); c.height = Math.round(cssH * d);
      c.style.width = cssW + 'px'; c.style.height = cssH + 'px';
    }
    s.bctx = s.base.getContext('2d', { desynchronized: true }) || s.base.getContext('2d');
    s.bctx.setTransform(d * scale, 0, 0, d * scale, 0, 0);
    s.bctx.lineCap = 'round'; s.bctx.lineJoin = 'round';
    s.d = d;
    s.el.append(s.bg, s.base);
    s.an = true;
    hintergrund(i);
    zeichneObjekte(s.bctx, p);
    drawStrokes(s.bctx, p);
  }

  function hintergrund(i) {
    const s = slots[i], p = s.p;
    s.task?.cancel(); s.task = null;
    if (p.bg?.art === 'pdf') {
      s.task = zeichnePdf(s.bg, p.bg.fileId, p.bg.seite);
      s.task.promise.catch(err => zeigeStatus('PDF-Seite konnte nicht angezeigt werden: ' + (err.message || err), true));
    } else {
      const ctx = s.bg.getContext('2d');
      ctx.setTransform(s.d * scale, 0, 0, s.d * scale, 0, 0);
      drawPaper(ctx, p.paper, p.w, p.h);
    }
  }

  function abbauen(i) {
    const s = slots[i];
    if (!s.an) return;
    s.task?.cancel(); s.task = null;
    for (const c of [s.bg, s.base]) { c.width = c.height = 0; c.remove(); }
    s.bg = s.base = s.bctx = null; s.an = false;
  }

  function striche(i) {
    const s = slots[i];
    if (!s.an) return;
    s.bctx.clearRect(0, 0, s.p.w, s.p.h);
    zeichneObjekte(s.bctx, s.p);
    drawStrokes(s.bctx, s.p);
  }

  // ---------- Schreiben ----------
  let cur = null, curId = null, drawn = 0, tailBox = null;
  const undo = [], redo = [];

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

  function liveLeeren(ganz) {
    if (ganz) { lctx.save(); lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.clearRect(0, 0, live.width, live.height); lctx.restore(); tailBox = null; return; }
    if (tailBox) { const [x, y, w, h] = tailBox; lctx.clearRect(x, y, w, h); tailBox = null; }
  }

  function radiere(e) {
    const i = seiteBei(e);
    if (i < 0) return;
    const p = pt(e, i), page = slots[i].p, R = 9 / scale;
    let weg = false;
    for (let k = page.strokes.length - 1; k >= 0; k--) {
      const s = page.strokes[k];
      if (trifft(s, p.x, p.y, R)) { cur.removed.push({ page, s, i: k }); page.strokes.splice(k, 1); weg = true; }
    }
    if (weg) striche(i);
  }

  function start(e) {
    stoppeSchwung(); pan = null;
    const i = seiteBei(e);
    if (i < 0 || !slots[i].an) return;
    e.preventDefault();
    try { view.setPointerCapture(e.pointerId); } catch { /* synthetische Events */ }
    curId = e.pointerId;
    if (W.tool === 'eraser' || e.button === 5) { cur = { erase: true, removed: [] }; radiere(e); return; }
    const p = pt(e, i), art = W.tool === 'marker' ? 'marker' : 'pen';
    cur = {
      pi: i, s: {
        id: uid(), t: art,
        c: (art === 'marker' ? MARKER_FARBEN : PEN_FARBEN)[W[art].c],
        w: (art === 'marker' ? MARKER_BREITEN : PEN_BREITEN)[W[art].w],
        pts: [p.x, p.y, p.p],
      },
    };
    drawn = 0;
    lctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offX, dpr * (offY + tops[i]));
    lctx.lineCap = 'round'; lctx.lineJoin = 'round';
    if (art === 'pen') drawInkPart(slots[i].bctx, cur.s, 0);
    else { liveLeeren(true); drawMarker(lctx, cur.s); }
  }

  function weiter(e) {
    e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    const liste = evs.length ? evs : [e];
    if (cur.erase) { for (const ev of liste) radiere(ev); return; }
    const s = cur.s, a = s.pts, minD = 0.6 / scale;
    for (const ev of liste) {
      const p = pt(ev, cur.pi), n = a.length;
      if (Math.hypot(p.x - a[n - 3], p.y - a[n - 2]) >= minD) a.push(p.x, p.y, p.p);
    }
    if (s.t === 'marker') { liveLeeren(true); drawMarker(lctx, s); return; }
    const n = a.length / 3;
    drawInkPart(slots[cur.pi].bctx, s, Math.max(1, drawn));
    drawn = Math.max(1, n - 1);
    // Live-Ebene: Ende des Strichs plus vorhergesagte Punkte, damit der Strich "an der Spitze klebt".
    liveLeeren();
    const pred = e.getPredictedEvents ? e.getPredictedEvents() : [];
    const tail = [];
    for (let i = Math.max(0, n - 2); i < n; i++) tail.push({ x: a[i * 3], y: a[i * 3 + 1], p: a[i * 3 + 2] });
    for (const ev of pred) tail.push(pt(ev, cur.pi));
    if (tail.length > 1) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      lctx.strokeStyle = s.c;
      lctx.beginPath();
      lctx.moveTo((tail[0].x + tail[1].x) / 2, (tail[0].y + tail[1].y) / 2);
      for (let i = 1; i < tail.length; i++) { lctx.lineWidth = wOf(s, tail[i].p); lctx.lineTo(tail[i].x, tail[i].y); }
      lctx.stroke();
      for (const q of tail) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
      const m = s.w * 2 + 2;
      tailBox = [x0 - m, y0 - m, x1 - x0 + 2 * m, y1 - y0 + 2 * m];
    }
  }

  function ende() {
    if (!cur) return;
    if (cur.erase) {
      if (cur.removed.length) {
        undo.push({ op: 'erase', items: cur.removed.reverse() }); redo.length = 0;
        for (const p of new Set(cur.removed.map(r => r.page))) geaendert(p);
      }
    } else {
      const { s, pi } = cur, sl = slots[pi];
      if (s.t === 'marker') { liveLeeren(true); if (sl.an) drawMarker(sl.bctx, s); }
      else { liveLeeren(); if (sl.an) drawInkTail(sl.bctx, s); }
      sl.p.strokes.push(s);
      undo.push({ op: 'add', page: sl.p, s }); redo.length = 0;
      geaendert(sl.p);
    }
    cur = null; curId = null;
    zeichneLeiste();
    sichtbar();
  }

  const neuZeichnen = page => { const i = slots.findIndex(s => s.p === page); if (i >= 0) striche(i); };
  function rueckgaengig() {
    const a = undo.pop();
    if (!a) return;
    const betroffen = new Set();
    if (a.op === 'obj') { a.page.objects = structuredClone(a.vorher); waehle(null); betroffen.add(a.page); }
    else if (a.op === 'add') { const i = a.page.strokes.indexOf(a.s); if (i >= 0) a.page.strokes.splice(i, 1); betroffen.add(a.page); }
    else for (const { page, s, i } of a.items) { page.strokes.splice(Math.min(i, page.strokes.length), 0, s); betroffen.add(page); }
    redo.push(a);
    for (const p of betroffen) { neuZeichnen(p); geaendert(p); }
    zeichneLeiste();
  }
  function wiederholen() {
    const a = redo.pop();
    if (!a) return;
    const betroffen = new Set();
    if (a.op === 'obj') { a.page.objects = structuredClone(a.nachher); waehle(null); betroffen.add(a.page); }
    else if (a.op === 'add') { a.page.strokes.push(a.s); betroffen.add(a.page); }
    else for (const { page, s } of [...a.items].reverse()) { const i = page.strokes.indexOf(s); if (i >= 0) page.strokes.splice(i, 1); betroffen.add(page); }
    undo.push(a);
    for (const p of betroffen) { neuZeichnen(p); geaendert(p); }
    zeichneLeiste();
  }

  // ---------- Objekte: Symbole, Linien, Rechtecke, Maße ----------
  const FORMEN = ['linie', 'rechteck', 'mass'];
  let sel = null; // {pi, o}
  const PENFARBE = () => PEN_FARBEN[W.pen.c];
  const PENBREITE = () => PEN_BREITEN[W.pen.w] * 1.4;

  function liveSeite(i) {
    lctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offX, dpr * (offY + tops[i]));
    lctx.lineCap = 'round'; lctx.lineJoin = 'round';
  }

  function waehle(s) { sel = s; zeigeAuswahl(); }

  // Änderung an den Objekten einer Seite mit Rückgängig-Eintrag
  function objektAenderung(i, fn, vorher = structuredClone(slots[i].p.objects)) {
    const page = slots[i].p;
    fn(page);
    const nachher = structuredClone(page.objects);
    if (JSON.stringify(vorher) === JSON.stringify(nachher)) return;
    undo.push({ op: 'obj', page, vorher, nachher }); redo.length = 0;
    striche(i); geaendert(page); zeichneLeiste();
  }

  function einfuegen(art) {
    const i = mitte, page = slots[i].p;
    const y = Math.max(80, Math.min(page.h - 80, (vh / 2 - offY - tops[i]) / scale));
    const o = neuesSymbol(art, page.w / 2, y, page.massstab, uid());
    objektAenderung(i, p => p.objects.push(o));
    W.tool = 'auswahl'; merke();
    waehle({ pi: i, o });
    zeichneLeiste();
  }

  function zeigeAuswahl() {
    liveLeeren(true);
    ctxBar.hidden = true;
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
    // Kontextleiste unter (oder über) dem Objekt
    const pts = griffe(o, 30 * k).map(g => ({ x: offX + g.x * scale, y: offY + tops[sel.pi] + g.y * scale }));
    const x0 = Math.min(...pts.map(q => q.x)), x1 = Math.max(...pts.map(q => q.x));
    const y0 = Math.min(...pts.map(q => q.y)), y1 = Math.max(...pts.map(q => q.y));
    const kasten = istKasten(o), symbol = o.typ === 'symbol';
    ctxBar.querySelector('[data-k=drehen]').hidden = !kasten;
    ctxBar.querySelector('[data-k=spiegeln]').hidden = !symbol;
    ctxBar.querySelector('[data-k=masse]').hidden = !kasten;
    ctxBar.hidden = false;
    const bw = ctxBar.offsetWidth, bh = ctxBar.offsetHeight;
    let top = y1 + 14;
    if (top + bh > vh - 8) top = Math.max(8, y0 - bh - 14);
    ctxBar.style.left = Math.max(8, Math.min(vw - bw - 8, (x0 + x1) / 2 - bw / 2)) + 'px';
    ctxBar.style.top = top + 'px';
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
    try { view.setPointerCapture(e.pointerId); } catch { /* synthetisch */ }
    curId = e.pointerId;
    cur = { obj: griff ? griff.art : 'move', griff, pi: i, start: p, orig: structuredClone(sel.o), vorher: structuredClone(page.objects) };
    ctxBar.hidden = true;
    zeigeAuswahl();
    ctxBar.hidden = true;
  }

  function auswahlMove(e) {
    e.preventDefault();
    const p = pt(e, cur.pi), o = sel.o, g = cur.orig;
    if (cur.obj === 'move') {
      const dx = p.x - cur.start.x, dy = p.y - cur.start.y;
      if (istKasten(o)) { o.x = g.x + dx; o.y = g.y + dy; rasteKasten(o); }
      else {
        const sx = rasten(g.x1 + dx) - g.x1, sy = rasten(g.y1 + dy) - g.y1;
        Object.assign(o, { x1: g.x1 + sx, y1: g.y1 + sy, x2: g.x2 + sx, y2: g.y2 + sy });
      }
    } else if (cur.obj === 'ecke') {
      const { sx, sy } = cur.griff, lp = lokal(g, p.x, p.y);
      const ox = -sx * g.w / 2, oy = -sy * g.h / 2;
      const w = Math.max(RASTER, rasten(Math.abs(lp.x - ox))), h = Math.max(RASTER, rasten(Math.abs(lp.y - oy)));
      const m = global(g, ox + sx * w / 2, oy + sy * h / 2);
      Object.assign(o, { w, h, x: m.x, y: m.y });
    } else if (cur.obj === 'drehen') {
      let r = Math.atan2(p.y - o.y, p.x - o.x) * 180 / Math.PI + 90;
      const r90 = Math.round(r / 90) * 90;
      r = Math.abs(r - r90) < 6 ? r90 : Math.round(r);
      o.rot = ((r % 360) + 360) % 360;
      if (o.rot % 90 === 0) rasteKasten(o);
    } else if (cur.obj === 'ende') {
      const n = cur.griff.n, a = n === 1 ? 2 : 1;
      const { x2, y2 } = rasteLinie(o['x' + a], o['y' + a], p.x, p.y);
      o['x' + n] = x2; o['y' + n] = y2;
    }
    striche(cur.pi);
    zeigeAuswahl();
    ctxBar.hidden = true;
  }

  function auswahlEnde() {
    const { pi, vorher } = cur;
    cur = null; curId = null;
    objektAenderung(pi, () => {}, vorher);
    zeigeAuswahl();
  }

  function formStart(e) {
    const i = seiteBei(e);
    if (i < 0 || !slots[i].an) return;
    e.preventDefault();
    try { view.setPointerCapture(e.pointerId); } catch { /* synthetisch */ }
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

  async function objektAktion(k) {
    if (!sel) return;
    const { pi } = sel, page = slots[pi].p, id = sel.o.id;
    const finde = p => p.objects.find(x => x.id === id);
    if (k === 'del') { objektAenderung(pi, p => { p.objects = p.objects.filter(x => x.id !== id); }); waehle(null); return; }
    if (k === 'dup') {
      const kopie = { ...structuredClone(sel.o), id: uid() };
      if (istKasten(kopie)) { kopie.x += RASTER * 2; kopie.y += RASTER * 2; }
      else { kopie.x1 += RASTER * 2; kopie.x2 += RASTER * 2; kopie.y1 += RASTER * 2; kopie.y2 += RASTER * 2; }
      objektAenderung(pi, p => p.objects.push(kopie));
      waehle({ pi, o: kopie }); return;
    }
    if (k === 'drehen') objektAenderung(pi, p => { const o = finde(p); o.rot = (Math.round(o.rot / 90) * 90 + 90) % 360; rasteKasten(o); });
    if (k === 'spiegeln') objektAenderung(pi, p => { const o = finde(p); o.spiegel = !o.spiegel; });
    if (k === 'masse') {
      const o = sel.o, name = o.typ === 'symbol' ? SYMBOLE[o.art].name : 'Rechteck';
      const m = await ui.frageMasse(`${name}: Maße bei 1:${page.massstab || STANDARD_MASSSTAB}`, inCm(o.w, page.massstab), inCm(o.h, page.massstab));
      if (!m) return;
      objektAenderung(pi, p => { const x = finde(p); x.w = m.b * proCm(p.massstab); x.h = m.l * proCm(p.massstab); rasteKasten(x); });
    }
    sel = { pi, o: finde(slots[pi].p) };
    zeigeAuswahl();
  }
  ctxBar.addEventListener('pointerdown', e => e.stopPropagation());
  ctxBar.addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (b) objektAktion(b.dataset.k); });

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
    setzeY(RAND - tops[tops.length - 1]);
    zeichneLeiste();
  });

  // ---------- Blättern mit dem Finger (mit Schwung) und Mausrad ----------
  let pan = null, schwung = 0;
  function stoppeSchwung() { if (schwung) cancelAnimationFrame(schwung); schwung = 0; }
  function panStart(e) {
    if (cur || pan) return;
    stoppeSchwung();
    try { view.setPointerCapture(e.pointerId); } catch { /* egal */ }
    pan = { id: e.pointerId, y: e.clientY, o: offY, ly: e.clientY, lt: performance.now(), v: 0 };
  }
  function panMove(e) {
    const t = performance.now(), dt = Math.max(1, t - pan.lt);
    pan.v = 0.7 * ((e.clientY - pan.ly) / dt) + 0.3 * pan.v;
    pan.ly = e.clientY; pan.lt = t;
    setzeY(pan.o + e.clientY - pan.y);
  }
  function panEnde() {
    let v = performance.now() - pan.lt > 80 ? 0 : pan.v, t0 = performance.now();
    pan = null;
    if (Math.abs(v) < 0.1) return;
    const schritt = t => {
      const dt = t - t0; t0 = t;
      setzeY(offY + v * dt);
      v *= Math.pow(0.95, dt / 16);
      schwung = Math.abs(v) > 0.02 ? requestAnimationFrame(schritt) : 0;
    };
    schwung = requestAnimationFrame(schritt);
  }

  const aufKnopf = e => e.target.closest?.('.ed-add, .ed-ctx');
  const onDown = e => {
    if (aufKnopf(e)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (W.tool === 'auswahl') { if (!cur && !pan) auswahlStart(e); return; }
    if (e.pointerType === 'touch' && W.penOnly) { panStart(e); return; }
    if (cur) return;
    if (FORMEN.includes(W.tool)) formStart(e);
    else start(e);
  };
  const onMove = e => {
    if (pan && e.pointerId === pan.id) { e.preventDefault(); panMove(e); return; }
    if (!cur || e.pointerId !== curId) return;
    if (cur.obj) auswahlMove(e);
    else if (cur.form) formMove(e);
    else weiter(e);
  };
  const onUp = e => {
    if (pan && e.pointerId === pan.id) { panEnde(); return; }
    if (!cur || e.pointerId !== curId) return;
    if (cur.obj) auswahlEnde();
    else if (cur.form) formEnde();
    else ende();
  };
  view.addEventListener('pointerdown', onDown);
  view.addEventListener('pointermove', onMove, { passive: false });
  view.addEventListener('pointerup', onUp);
  view.addEventListener('pointercancel', onUp);
  // iOS: Finger-Gesten (Zoom, Zurückwischen) auf der Schreibfläche unterdrücken
  view.addEventListener('touchstart', e => { if (e.touches.length === 1 && !aufKnopf(e)) e.preventDefault(); }, { passive: false });
  view.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
  view.addEventListener('wheel', e => { e.preventDefault(); stoppeSchwung(); setzeY(offY - e.deltaY); }, { passive: false });

  const onKey = e => {
    if (e.target === titel) return;
    const k = e.key.toLowerCase();
    if ((k === 'delete' || k === 'backspace') && sel) { e.preventDefault(); objektAktion('del'); return; }
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
      fehler = false;
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

  const ro = new ResizeObserver(() => requestAnimationFrame(layout));
  ro.observe(view);
  zeichneLeiste();
  layout();

  return {
    async close() {
      if (cur) ende();
      if (document.activeElement === titel) titel.blur();
      const t = titel.value.trim();
      if (t && t !== titelStand) { titelStand = t; await onTitle(t); }
      ro.disconnect(); stoppeSchwung();
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', sichern);
      await sichern();
      for (let i = 0; i < slots.length; i++) abbauen(i);
      live.width = live.height = 0;
    },
  };
}
