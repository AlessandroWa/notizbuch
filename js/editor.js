// Notiz-Editor: Schreiben mit dem Apple Pencil.
// Schreibtechnik wie stift-test.html: Striche-Canvas (desynchronized) plus Live-Ebene,
// getCoalescedEvents für alle Zwischenpunkte, getPredictedEvents gegen Verzögerung.
// Seiten liegen untereinander. Nur sichtbare Seiten bekommen Canvas (spart Speicher auf dem iPad).
// Jede Seite: Hintergrund-Canvas (Papier oder PDF) + Striche-Canvas. "Nur Stift": Finger blättert.
import { PAPIERE, drawPaper, drawInkPart, drawInkTail, drawMarker, drawStrokes, wOf, trifft } from './ink.js';
import { zeichne as zeichnePdf } from './pdf.js';
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
        <div class="grp" data-g="colors"></div>
        <div class="grp" data-g="widths"></div>
        <span class="ed-status" aria-live="polite"></span>
      </div>
    </div>
    <div class="ed-view">
      <div class="ed-stack"></div>
      <canvas class="ed-live"></canvas>
      <div class="ed-seitenzahl" aria-live="off"></div>
    </div>
  </div>`;

  const $ = s => root.querySelector(s);
  const bar = $('.ed-bar'), view = $('.ed-view'), stack = $('.ed-stack');
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
  for (const p of pages) slots.push(slotFuer(p));
  stack.append(...slots.map(s => s.el), addBtn);

  // ---------- Werkzeugleiste ----------
  const hatPapier = () => pages.some(p => !p.bg);
  function zeichneLeiste() {
    for (const b of bar.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', b.dataset.tool === W.tool);
    const art = W.tool === 'marker' ? 'marker' : 'pen';
    const farben = art === 'marker' ? MARKER_FARBEN : PEN_FARBEN;
    const breiten = art === 'marker' ? MARKER_BREITEN : PEN_BREITEN;
    const aus = W.tool === 'eraser';
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
    $('[data-a=undo]').disabled = !undo.length;
    $('[data-a=redo]').disabled = !redo.length;
    live.classList.toggle('multiply', W.tool === 'marker');
  }

  bar.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const art = W.tool === 'marker' ? 'marker' : 'pen';
    if (b.dataset.tool) { W.tool = b.dataset.tool; }
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
  let tops = [];

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
  }

  function setzeY(y) {
    const min = Math.min(RAND, vh - stapelH - RAND);
    offY = Math.max(min, Math.min(RAND, y));
    stack.style.transform = `translate3d(${offX}px,${offY}px,0)`;
    sichtbar();
  }

  // Seiten im Sichtbereich bekommen Canvas, die anderen geben den Speicher wieder frei.
  function sichtbar() {
    let mitte = 0;
    for (let i = 0; i < slots.length; i++) {
      const t = offY + tops[i], b = t + slots[i].p.h * scale;
      const zeigen = b > -VORLAUF && t < vh + VORLAUF;
      if (zeigen && !slots[i].an) aufbauen(i);
      else if (!zeigen && slots[i].an && !(cur && cur.pi === i)) abbauen(i);
      if (t < vh / 2) mitte = i;
    }
    seitenzahl.textContent = slots.length > 1 ? `Seite ${mitte + 1} von ${slots.length}` : '';
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
    if (a.op === 'add') { const i = a.page.strokes.indexOf(a.s); if (i >= 0) a.page.strokes.splice(i, 1); betroffen.add(a.page); }
    else for (const { page, s, i } of a.items) { page.strokes.splice(Math.min(i, page.strokes.length), 0, s); betroffen.add(page); }
    redo.push(a);
    for (const p of betroffen) { neuZeichnen(p); geaendert(p); }
    zeichneLeiste();
  }
  function wiederholen() {
    const a = redo.pop();
    if (!a) return;
    const betroffen = new Set();
    if (a.op === 'add') { a.page.strokes.push(a.s); betroffen.add(a.page); }
    else for (const { page, s } of [...a.items].reverse()) { const i = page.strokes.indexOf(s); if (i >= 0) page.strokes.splice(i, 1); betroffen.add(page); }
    undo.push(a);
    for (const p of betroffen) { neuZeichnen(p); geaendert(p); }
    zeichneLeiste();
  }

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

  const aufKnopf = e => e.target.closest?.('.ed-add');
  const onDown = e => {
    if (aufKnopf(e)) return;
    if (e.pointerType === 'touch' && W.penOnly) { panStart(e); return; }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (cur) return;
    start(e);
  };
  const onMove = e => {
    if (pan && e.pointerId === pan.id) { e.preventDefault(); panMove(e); return; }
    if (cur && e.pointerId === curId) weiter(e);
  };
  const onUp = e => {
    if (pan && e.pointerId === pan.id) { panEnde(); return; }
    if (cur && e.pointerId === curId) ende();
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
