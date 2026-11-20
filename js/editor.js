// Notiz-Editor: Schreiben mit dem Apple Pencil.
// Schreibtechnik wie stift-test.html: zwei Canvas (fertige Striche + Live-Ebene), desynchronized,
// getCoalescedEvents für alle Zwischenpunkte, getPredictedEvents gegen Verzögerung.
// "Nur Stift": Finger schreibt nicht, sondern blättert (Wischen mit Schwung).
import { PAPIERE, drawInkPart, drawInkTail, drawMarker, renderPage, wOf, trifft, makeThumb } from './ink.js';
import { uid, esc, debounce } from './util.js';

const PEN_FARBEN = ['#1b1d21', '#1f5fd6', '#d23a2f', '#1d8a4e', '#e07b00', '#7b3fc4'];
const MARKER_FARBEN = ['#ffd60a', '#7ee07e', '#ff8ad8', '#7cc4ff'];
const PEN_BREITEN = [1.8, 2.8, 4.5];
const MARKER_BREITEN = [14, 22, 32];
const PAPIER_REIHE = Object.keys(PAPIERE);
const RAND = 16; // Abstand Seite zum Rand in px

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
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

export function openEditor(root, { note, pages, ordnerName, onBack, onTitle, onSavePage, onSaveThumb }) {
  const page = pages[0]; // Mehrere Seiten: Bauschritt 2 (Datenmodell kann es schon)
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
      <div class="ed-page"><canvas class="base"></canvas><canvas class="live"></canvas></div>
    </div>
  </div>`;

  const $ = s => root.querySelector(s);
  const bar = $('.ed-bar'), view = $('.ed-view'), pageEl = $('.ed-page');
  const base = $('.base'), live = $('.live'), titel = $('.ed-title'), status = $('.ed-status');
  const bctx = base.getContext('2d', { desynchronized: true }) || base.getContext('2d');
  const lctx = live.getContext('2d', { desynchronized: true }) || live.getContext('2d');

  // ---------- Werkzeugleiste ----------
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
    $('[data-a=paper]').textContent = PAPIERE[page.paper] || 'Papier';
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
      page.paper = PAPIER_REIHE[(PAPIER_REIHE.indexOf(page.paper) + 1) % PAPIER_REIHE.length];
      neuZeichnen(); geaendert();
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

  // ---------- Größe und Lage der Seite ----------
  let scale = 1, cssW = 0, cssH = 0, offX = 0, offY = RAND, vw = 0, vh = 0;

  function layout() {
    const r = view.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const altH = cssH, altY = offY;
    vw = r.width; vh = r.height;
    scale = Math.min((vw - 2 * RAND) / page.w, 1.25);
    cssW = page.w * scale; cssH = page.h * scale;
    // Pixeldichte wie Bildschirm, aber unter der Canvas-Grenze von Safari (16,7 Mio. Pixel) bleiben.
    let d = window.devicePixelRatio || 1;
    const MAX = 16e6;
    if (cssW * d * cssH * d > MAX) d = Math.sqrt(MAX / (cssW * cssH));
    for (const c of [base, live]) {
      c.width = Math.round(cssW * d); c.height = Math.round(cssH * d);
      c.style.width = cssW + 'px'; c.style.height = cssH + 'px';
    }
    pageEl.style.width = cssW + 'px'; pageEl.style.height = cssH + 'px';
    for (const x of [bctx, lctx]) { x.setTransform(d * scale, 0, 0, d * scale, 0, 0); x.lineCap = 'round'; x.lineJoin = 'round'; }
    offX = Math.max(RAND, (vw - cssW) / 2);
    setzeY(altH ? RAND + (altY - RAND) * cssH / altH : RAND);
    neuZeichnen();
  }

  function setzeY(y) {
    const min = Math.min(RAND, vh - cssH - RAND);
    offY = Math.max(min, Math.min(RAND, y));
    pageEl.style.transform = `translate3d(${offX}px,${offY}px,0)`;
  }

  function neuZeichnen() {
    renderPage(bctx, page);
    lctx.clearRect(0, 0, page.w, page.h);
  }

  // ---------- Schreiben ----------
  let cur = null, curId = null, drawn = 0, tailBox = null;
  const undo = [], redo = [];

  function pt(e) {
    const r = base.getBoundingClientRect();
    const p = e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5;
    return { x: Math.round((e.clientX - r.left) / scale * 10) / 10, y: Math.round((e.clientY - r.top) / scale * 10) / 10, p: Math.round(p * 100) / 100 };
  }
  const aufSeite = p => p.x >= -20 && p.y >= -20 && p.x <= page.w + 20 && p.y <= page.h + 20;

  function radiere(p) {
    const R = 9 / scale;
    let weg = false;
    for (let i = page.strokes.length - 1; i >= 0; i--) {
      const s = page.strokes[i];
      if (trifft(s, p.x, p.y, R)) { cur.removed.push({ s, i }); page.strokes.splice(i, 1); weg = true; }
    }
    if (weg) neuZeichnen();
  }

  function liveLeeren() {
    if (tailBox) { const [x, y, w, h] = tailBox; lctx.clearRect(x, y, w, h); tailBox = null; }
  }

  function start(e) {
    stoppeSchwung(); pan = null;
    const p = pt(e);
    if (!aufSeite(p)) return;
    e.preventDefault();
    try { view.setPointerCapture(e.pointerId); } catch { /* synthetische Events */ }
    curId = e.pointerId;
    if (W.tool === 'eraser' || e.button === 5) { cur = { erase: true, removed: [] }; radiere(p); return; }
    const art = W.tool === 'marker' ? 'marker' : 'pen';
    cur = {
      id: uid(), t: art,
      c: (art === 'marker' ? MARKER_FARBEN : PEN_FARBEN)[W[art].c],
      w: (art === 'marker' ? MARKER_BREITEN : PEN_BREITEN)[W[art].w],
      pts: [p.x, p.y, p.p],
    };
    drawn = 0;
    if (art === 'pen') drawInkPart(bctx, cur, 0);
    else { lctx.clearRect(0, 0, page.w, page.h); drawMarker(lctx, cur); }
  }

  function weiter(e) {
    e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    const liste = evs.length ? evs : [e];
    if (cur.erase) { for (const ev of liste) radiere(pt(ev)); return; }
    const a = cur.pts, minD = 0.6 / scale;
    for (const ev of liste) {
      const p = pt(ev), n = a.length;
      if (Math.hypot(p.x - a[n - 3], p.y - a[n - 2]) >= minD) a.push(p.x, p.y, p.p);
    }
    if (cur.t === 'marker') { lctx.clearRect(0, 0, page.w, page.h); drawMarker(lctx, cur); return; }
    const n = a.length / 3;
    drawInkPart(bctx, cur, Math.max(1, drawn));
    drawn = Math.max(1, n - 1);
    // Live-Ebene: Ende des Strichs plus vorhergesagte Punkte, damit der Strich "an der Spitze klebt".
    liveLeeren();
    const pred = e.getPredictedEvents ? e.getPredictedEvents() : [];
    const tail = [];
    for (let i = Math.max(0, n - 2); i < n; i++) tail.push({ x: a[i * 3], y: a[i * 3 + 1], p: a[i * 3 + 2] });
    for (const ev of pred) tail.push(pt(ev));
    if (tail.length > 1) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      lctx.strokeStyle = cur.c;
      lctx.beginPath();
      lctx.moveTo((tail[0].x + tail[1].x) / 2, (tail[0].y + tail[1].y) / 2);
      for (let i = 1; i < tail.length; i++) {
        lctx.lineWidth = wOf(cur, tail[i].p);
        lctx.lineTo(tail[i].x, tail[i].y);
      }
      lctx.stroke();
      for (const q of tail) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
      const m = cur.w * 2 + 2;
      tailBox = [x0 - m, y0 - m, x1 - x0 + 2 * m, y1 - y0 + 2 * m];
    }
  }

  function ende() {
    if (!cur) return;
    if (cur.erase) {
      if (cur.removed.length) { undo.push({ op: 'erase', items: cur.removed.reverse() }); redo.length = 0; geaendert(); }
    } else {
      const s = cur;
      if (s.t === 'marker') { lctx.clearRect(0, 0, page.w, page.h); drawMarker(bctx, s); }
      else { liveLeeren(); drawInkTail(bctx, s); }
      page.strokes.push(s);
      undo.push({ op: 'add', s }); redo.length = 0;
      geaendert();
    }
    cur = null; curId = null;
    zeichneLeiste();
  }

  function rueckgaengig() {
    const a = undo.pop();
    if (!a) return;
    if (a.op === 'add') { const i = page.strokes.indexOf(a.s); if (i >= 0) page.strokes.splice(i, 1); }
    else for (const { s, i } of a.items) page.strokes.splice(Math.min(i, page.strokes.length), 0, s);
    redo.push(a); neuZeichnen(); geaendert(); zeichneLeiste();
  }
  function wiederholen() {
    const a = redo.pop();
    if (!a) return;
    if (a.op === 'add') page.strokes.push(a.s);
    else for (const { s } of [...a.items].reverse()) { const i = page.strokes.indexOf(s); if (i >= 0) page.strokes.splice(i, 1); }
    undo.push(a); neuZeichnen(); geaendert(); zeichneLeiste();
  }

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

  const onDown = e => {
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
  view.addEventListener('touchstart', e => { if (e.touches.length === 1) e.preventDefault(); }, { passive: false });
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
  const speichereSeite = debounce(async () => {
    try { await onSavePage(page); zeigeStatus(fehler ? 'Gespeichert' : ''); fehler = false; }
    catch (err) { fehler = true; zeigeStatus('Speichern fehlgeschlagen: ' + (err.message || err)); }
  }, 400);
  const speichereVorschau = debounce(async () => {
    try { await onSaveThumb(await makeThumb(page)); } catch { /* Vorschau ist nicht kritisch */ }
  }, 2500);
  function geaendert() { speichereSeite(); speichereVorschau(); }
  function zeigeStatus(t) { status.textContent = t; status.classList.toggle('fehler', fehler); }

  const sichern = () => Promise.all([speichereSeite.flush(), speichereVorschau.flush()]);
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
    },
  };
}
