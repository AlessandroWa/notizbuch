// Zeichnen von Papier und Strichen. Technik aus stift-test.html übernommen:
// Druckstärke je Punkt, quadratische Kurven durch die Mittelpunkte, runde Enden.
// Alle Koordinaten in Seiten-Einheiten (A4 = 1000 × 1414), Punkte flach: [x, y, druck, x, y, druck, …].

export const PAGE_W = 1000;
export const PAGE_H = 1414;
export const MM = PAGE_W / 210; // Einheiten pro Millimeter
export const PAPIERE = { liniert: 'Liniert', kariert: 'Kariert', blanko: 'Blanko', mm: 'Millimeter' };
const MARKER_ALPHA = 0.4;

export const wOf = (s, p) => (s.t === 'marker' ? s.w : s.w * (0.35 + 0.9 * p));

function linien(ctx, farbe, breite, w, h, schritt, start, senkrecht, nurJede = 1) {
  ctx.strokeStyle = farbe; ctx.lineWidth = breite;
  ctx.beginPath();
  let i = 0;
  for (let y = start; y < h - 0.5; y += schritt, i++) if (i % nurJede === 0) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
  if (senkrecht) { i = 0; for (let x = start; x < w - 0.5; x += schritt, i++) if (i % nurJede === 0) { ctx.moveTo(x, 0); ctx.lineTo(x, h); } }
  ctx.stroke();
}

export function drawPaper(ctx, paper, w, h) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  if (paper === 'liniert') linien(ctx, '#c9d7ec', 1.2, w, h, 8 * MM, 25 * MM, false);
  else if (paper === 'kariert') linien(ctx, '#dbe3ee', 1, w, h, 5 * MM, 5 * MM, true);
  else if (paper === 'mm') {
    linien(ctx, '#f6dcc6', 0.5, w, h, MM, MM, true);
    linien(ctx, '#efc29c', 0.8, w, h, MM, MM, true, 5);
    linien(ctx, '#e3a46f', 1.1, w, h, MM, MM, true, 10);
  }
}

// Stift-Strich stückweise zeichnen (für das Live-Schreiben): Segmente ab Punkt "from".
export function drawInkPart(ctx, s, from) {
  const a = s.pts, n = a.length / 3;
  if (!n) return;
  ctx.strokeStyle = s.c; ctx.fillStyle = s.c;
  if (from === 0) { ctx.beginPath(); ctx.arc(a[0], a[1], wOf(s, a[2]) / 2, 0, Math.PI * 2); ctx.fill(); }
  if (n >= 2 && from <= 1) { // Anfang: vom ersten Punkt bis zur ersten Mitte
    ctx.lineWidth = wOf(s, a[5]);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo((a[0] + a[3]) / 2, (a[1] + a[4]) / 2); ctx.stroke();
  }
  for (let i = Math.max(1, from); i < n - 1; i++) {
    const j = i * 3;
    const ax = a[j - 3], ay = a[j - 2], bx = a[j], by = a[j + 1], cx = a[j + 3], cy = a[j + 4];
    ctx.lineWidth = wOf(s, a[j + 2]);
    ctx.beginPath(); ctx.moveTo((ax + bx) / 2, (ay + by) / 2); ctx.quadraticCurveTo(bx, by, (bx + cx) / 2, (by + cy) / 2); ctx.stroke();
  }
}

// Letztes halbes Stück bis zum Endpunkt.
export function drawInkTail(ctx, s) {
  const a = s.pts, n = a.length / 3;
  if (n < 2) return;
  const j = (n - 1) * 3;
  ctx.strokeStyle = s.c; ctx.lineWidth = wOf(s, a[j + 2]);
  ctx.beginPath(); ctx.moveTo((a[j - 3] + a[j]) / 2, (a[j - 2] + a[j + 1]) / 2); ctx.lineTo(a[j], a[j + 1]); ctx.stroke();
}

// Textmarker: ein durchgehender Pfad, transparent und "multipliziert", damit Schrift darunter dunkel bleibt.
export function drawMarker(ctx, s) {
  const a = s.pts, n = a.length / 3;
  if (!n) return;
  ctx.save();
  ctx.globalAlpha = MARKER_ALPHA;
  ctx.globalCompositeOperation = 'multiply';
  ctx.strokeStyle = s.c; ctx.lineWidth = s.w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  if (n === 1) ctx.lineTo(a[0] + 0.01, a[1]);
  else {
    for (let i = 1; i < n - 1; i++) {
      const j = i * 3;
      ctx.quadraticCurveTo(a[j], a[j + 1], (a[j] + a[j + 3]) / 2, (a[j + 1] + a[j + 4]) / 2);
    }
    ctx.lineTo(a[(n - 1) * 3], a[(n - 1) * 3 + 1]);
  }
  ctx.stroke();
  ctx.restore();
}

export function drawStroke(ctx, s) {
  if (s.t === 'marker') drawMarker(ctx, s);
  else { drawInkPart(ctx, s, 0); drawInkTail(ctx, s); }
}

export function renderPage(ctx, page) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  drawPaper(ctx, page.paper, page.w, page.h);
  // page.objects (Bilder, PDF, Symbole, Text) kommen ab Bauschritt 2 hier dazu.
  for (const s of page.strokes) drawStroke(ctx, s);
}

// Begrenzungsrahmen eines Strichs (für den Radierer), zwischengespeichert.
const boxen = new WeakMap();
export function strokeBox(s) {
  let b = boxen.get(s);
  if (!b) {
    const a = s.pts;
    b = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < a.length; i += 3) {
      if (a[i] < b[0]) b[0] = a[i]; if (a[i + 1] < b[1]) b[1] = a[i + 1];
      if (a[i] > b[2]) b[2] = a[i]; if (a[i + 1] > b[3]) b[3] = a[i + 1];
    }
    boxen.set(s, b);
  }
  return b;
}

function abstandSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

export function trifft(s, x, y, r) {
  const b = strokeBox(s), rr = r + s.w;
  if (x < b[0] - rr || x > b[2] + rr || y < b[1] - rr || y > b[3] + rr) return false;
  const a = s.pts, n = a.length / 3, grenze = r + s.w / 2;
  if (n === 1) return Math.hypot(a[0] - x, a[1] - y) < grenze;
  for (let i = 0; i < n - 1; i++) {
    const j = i * 3;
    if (abstandSeg(x, y, a[j], a[j + 1], a[j + 3], a[j + 4]) < grenze) return true;
  }
  return false;
}

// Vorschaubild der ersten Seite als JPEG.
export function makeThumb(page, breite = 420) {
  const c = document.createElement('canvas');
  const k = breite / page.w;
  c.width = breite; c.height = Math.round(page.h * k);
  const ctx = c.getContext('2d');
  ctx.scale(k, k);
  renderPage(ctx, page);
  return new Promise(res => c.toBlob(b => res(b), 'image/jpeg', 0.82));
}
