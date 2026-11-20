// Objekte auf einer Seite: Sanitär-Symbole, Rechtecke, Linien, Maßlinien.
// Alle Maße in Seiten-Einheiten (Seite = 1000 breit = 210 mm Papier).
// Kasten-Objekte: {id, typ: 'symbol'|'rechteck'|'bild'|'text', art?, x, y (Mitte), w, h, rot (Grad), spiegel, c?, lw?}
//   bild: fileId (Foto im Store "files"); text: text, gr (Schriftgröße in Einheiten), c
// Linien-Objekte: {id, typ: 'linie'|'mass', x1, y1, x2, y2, c, lw}
// Die Wandseite eines Symbols ist oben (y = -h/2), bei rot = 0.
import { MM } from './ink.js';
import * as db from './db.js';

export const STANDARD_MASSSTAB = 20;
export const MASSSTAEBE = [10, 20, 25, 50];
export const RASTER = 2.5 * MM; // Einrasten alle 2,5 mm Papier (= 5 cm bei 1:20)
const LINIE = '#1b1d21';
const MASS_FARBE = '#d23a2f';

// Einheiten je Zentimeter in der Wirklichkeit
export const proCm = massstab => (10 / (massstab || STANDARD_MASSSTAB)) * MM;

export const SYMBOLE = {
  wc: { name: 'WC', b: 37, l: 55 },
  wt: { name: 'Waschbecken', b: 60, l: 45 },
  dwt: { name: 'Doppel-WT', b: 120, l: 48 },
  urinal: { name: 'Urinal', b: 35, l: 30 },
  tasse: { name: 'Duschtasse', b: 90, l: 90 },
  rinne: { name: 'Dusche Rinne', b: 120, l: 100 },
  wanne: { name: 'Badewanne', b: 170, l: 75 },
};

// ---------- Fotos: dekodierte Bilder zwischenspeichern ----------
const bilder = new Map(); // fileId -> ImageBitmap | Promise | 'fehler'
let wennGeladen = () => {};
export function beiBildGeladen(fn) { wennGeladen = fn; }
export function ladeBild(fileId) {
  let b = bilder.get(fileId);
  if (b) return b instanceof Promise ? b : Promise.resolve(b);
  b = db.get('files', fileId).then(f => (f ? createImageBitmap(f.blob) : 'fehler')).catch(() => 'fehler')
    .then(bmp => { bilder.set(fileId, bmp); wennGeladen(fileId); return bmp; });
  bilder.set(fileId, b);
  return b;
}
export async function ladeBilder(page) {
  await Promise.all((page.objects || []).filter(o => o.typ === 'bild').map(o => ladeBild(o.fileId)));
}

// ---------- Text ----------
export const SCHRIFT = '-apple-system, "Segoe UI", Helvetica, Arial, sans-serif';
let messCtx = null;
export function textMasse(text, gr) {
  messCtx ||= document.createElement('canvas').getContext('2d');
  messCtx.font = `${gr}px ${SCHRIFT}`;
  const zeilen = String(text).split('\n');
  const w = Math.max(gr, ...zeilen.map(z => messCtx.measureText(z).width));
  return { w: w + gr * 0.2, h: zeilen.length * gr * 1.3 };
}

// ---------- Zeichnen ----------
function rundRechteck(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function ellipse(ctx, x, y, rx, ry) { ctx.beginPath(); ctx.ellipse(x, y, Math.max(rx, 0.1), Math.max(ry, 0.1), 0, 0, Math.PI * 2); }

// Symbol im eigenen Koordinatensystem (Mitte = 0,0) zeichnen. lw = Linienstärke.
export function zeichneSymbol(ctx, art, w, h, lw = 2, farbe = LINIE) {
  const x = -w / 2, y = -h / 2;
  ctx.save();
  ctx.strokeStyle = farbe; ctx.fillStyle = farbe; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (art === 'wc') { // wandhängend, ohne Spülkasten
    const a = w * 0.34;
    ctx.beginPath();
    ctx.moveTo(-a, y); ctx.lineTo(a, y);
    ctx.bezierCurveTo(w / 2, y + h * 0.12, w / 2, h / 2, 0, h / 2);
    ctx.bezierCurveTo(-w / 2, h / 2, -w / 2, y + h * 0.12, -a, y);
    ctx.closePath(); ctx.stroke();
    ctx.lineWidth = lw * 0.75;
    ellipse(ctx, 0, h * 0.06, w * 0.26, h * 0.3); ctx.stroke();
  } else if (art === 'wt') {
    rundRechteck(ctx, x, y, w, h, Math.min(w, h) * 0.12); ctx.stroke();
    ctx.lineWidth = lw * 0.75;
    ellipse(ctx, 0, h * 0.08, w * 0.36, h * 0.3); ctx.stroke();
    ellipse(ctx, 0, y + h * 0.13, lw * 1.4, lw * 1.4); ctx.fill();
  } else if (art === 'dwt') {
    rundRechteck(ctx, x, y, w, h, Math.min(w, h) * 0.12); ctx.stroke();
    ctx.lineWidth = lw * 0.75;
    for (const s of [-1, 1]) {
      ellipse(ctx, s * w / 4, h * 0.08, w * 0.18, h * 0.3); ctx.stroke();
      ellipse(ctx, s * w / 4, y + h * 0.13, lw * 1.4, lw * 1.4); ctx.fill();
    }
  } else if (art === 'urinal') {
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(-x, y); ctx.lineTo(-x, y + h * 0.35);
    ctx.bezierCurveTo(-x, h / 2, w * 0.25, h / 2, 0, h / 2);
    ctx.bezierCurveTo(-w * 0.25, h / 2, x, h / 2, x, y + h * 0.35);
    ctx.closePath(); ctx.stroke();
    ctx.lineWidth = lw * 0.75;
    ctx.beginPath(); ctx.moveTo(x + w * 0.18, y + h * 0.25); ctx.lineTo(-x - w * 0.18, y + h * 0.25); ctx.stroke();
  } else if (art === 'tasse') {
    ctx.strokeRect(x, y, w, h);
    ctx.lineWidth = lw * 0.6;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(-x, -y); ctx.moveTo(-x, y); ctx.lineTo(x, -y); ctx.stroke();
    ctx.lineWidth = lw * 0.75;
    ellipse(ctx, 0, 0, Math.min(w, h) * 0.06, Math.min(w, h) * 0.06); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke();
  } else if (art === 'rinne') { // Rinne immer an einer Schmalseite
    ctx.strokeRect(x, y, w, h);
    const lang = Math.max(w, h), d = Math.max(lang * 0.022, lw * 1.5), rand = lang * 0.035;
    if (w >= h) {
      ctx.fillRect(-x - rand - d, y + h * 0.08, d, h * 0.84);
      ctx.lineWidth = lw * 0.5; ctx.setLineDash([lw * 3, lw * 3]);
      ctx.beginPath(); ctx.moveTo(x + w * 0.1, 0); ctx.lineTo(-x - rand - d * 2, 0); ctx.stroke();
    } else {
      ctx.fillRect(x + w * 0.08, -y - rand - d, w * 0.84, d);
      ctx.lineWidth = lw * 0.5; ctx.setLineDash([lw * 3, lw * 3]);
      ctx.beginPath(); ctx.moveTo(0, y + h * 0.1); ctx.lineTo(0, -y - rand - d * 2); ctx.stroke();
    }
  }
  else if (art === 'wanne') {
    rundRechteck(ctx, x, y, w, h, Math.min(w, h) * 0.06); ctx.stroke();
    const e = Math.min(w, h) * 0.1;
    ctx.lineWidth = lw * 0.75;
    rundRechteck(ctx, x + e, y + e, w - 2 * e, h - 2 * e, Math.min(w, h) * 0.32); ctx.stroke();
    const r = Math.min(w, h) * 0.05, ax = w >= h ? x + e + Math.min(w, h) * 0.22 : 0, ay = w >= h ? 0 : y + e + Math.min(w, h) * 0.22;
    ellipse(ctx, ax, ay, r, r); ctx.stroke();
  }
  ctx.restore();
}

const masstext = (laenge, massstab) => {
  const cm = laenge / proCm(massstab);
  return cm >= 100 ? (cm / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' m' : Math.round(cm) + ' cm';
};

export function zeichneObjekt(ctx, o, massstab) {
  ctx.save();
  if (istKasten(o)) {
    ctx.translate(o.x, o.y);
    ctx.rotate(o.rot * Math.PI / 180);
    if (o.spiegel) { if (o.art === 'rinne' && o.w < o.h) ctx.scale(1, -1); else ctx.scale(-1, 1); }
    if (o.typ === 'symbol') zeichneSymbol(ctx, o.art, o.w, o.h, 2);
    else if (o.typ === 'bild') {
      const b = bilder.get(o.fileId);
      if (b && !(b instanceof Promise) && b !== 'fehler') ctx.drawImage(b, -o.w / 2, -o.h / 2, o.w, o.h);
      else { ctx.fillStyle = '#eceaea'; ctx.fillRect(-o.w / 2, -o.h / 2, o.w, o.h); if (!b) ladeBild(o.fileId); }
    } else if (o.typ === 'text') {
      ctx.fillStyle = o.c || LINIE; ctx.font = `${o.gr}px ${SCHRIFT}`; ctx.textBaseline = 'top';
      String(o.text).split('\n').forEach((z, i) => ctx.fillText(z, -o.w / 2 + o.gr * 0.1, -o.h / 2 + i * o.gr * 1.3 + o.gr * 0.12));
    } else { ctx.strokeStyle = o.c || LINIE; ctx.lineWidth = o.lw || 3; ctx.lineJoin = 'miter'; ctx.strokeRect(-o.w / 2, -o.h / 2, o.w, o.h); }
  } else if (o.typ === 'linie') {
    ctx.strokeStyle = o.c || LINIE; ctx.lineWidth = o.lw || 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(o.x1, o.y1); ctx.lineTo(o.x2, o.y2); ctx.stroke();
  } else if (o.typ === 'mass') {
    const dx = o.x2 - o.x1, dy = o.y2 - o.y1, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l, t = 7;
    ctx.strokeStyle = ctx.fillStyle = o.c || MASS_FARBE; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(o.x1, o.y1); ctx.lineTo(o.x2, o.y2);
    for (const [px, py] of [[o.x1, o.y1], [o.x2, o.y2]]) { ctx.moveTo(px - nx * t, py - ny * t); ctx.lineTo(px + nx * t, py + ny * t); }
    ctx.stroke();
    let w = Math.atan2(dy, dx);
    if (w > Math.PI / 2 || w <= -Math.PI / 2) w += Math.PI; // Text immer lesbar
    ctx.translate((o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2);
    ctx.rotate(w);
    ctx.font = '600 15px -apple-system, "Segoe UI", Helvetica, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(masstext(l, massstab), 0, -5);
  }
  ctx.restore();
}

export function zeichneObjekte(ctx, page) {
  for (const o of page.objects || []) zeichneObjekt(ctx, o, page.massstab);
}

// ---------- Geometrie ----------
export const istKasten = o => o.typ !== 'linie' && o.typ !== 'mass';
export function lokal(o, x, y) { // Punkt in Objekt-Koordinaten
  const r = -o.rot * Math.PI / 180, dx = x - o.x, dy = y - o.y;
  return { x: dx * Math.cos(r) - dy * Math.sin(r), y: dx * Math.sin(r) + dy * Math.cos(r) };
}
export function global(o, lx, ly) {
  const r = o.rot * Math.PI / 180;
  return { x: o.x + lx * Math.cos(r) - ly * Math.sin(r), y: o.y + lx * Math.sin(r) + ly * Math.cos(r) };
}
function abstandSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

// Oberstes Objekt unter dem Punkt (tol = Toleranz in Einheiten)
export function trefferObjekt(page, x, y, tol) {
  const liste = page.objects || [];
  for (let i = liste.length - 1; i >= 0; i--) {
    const o = liste[i];
    if (istKasten(o)) {
      const p = lokal(o, x, y);
      if (o.typ === 'rechteck') {
        const innen = Math.abs(p.x) <= o.w / 2 - tol && Math.abs(p.y) <= o.h / 2 - tol;
        if (!innen && Math.abs(p.x) <= o.w / 2 + tol && Math.abs(p.y) <= o.h / 2 + tol) return o; // Rahmen
      } else if (Math.abs(p.x) <= o.w / 2 + tol && Math.abs(p.y) <= o.h / 2 + tol) return o;
    } else if (abstandSeg(x, y, o.x1, o.y1, o.x2, o.y2) <= tol + 4) return o;
  }
  return null;
}

// Griffe des ausgewählten Objekts: [{art: 'ecke'|'drehen'|'ende', x, y, sx?, sy?, n?}]
export function griffe(o, abstand) {
  if (istKasten(o)) {
    const g = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) g.push({ art: 'ecke', sx, sy, ...global(o, sx * o.w / 2, sy * o.h / 2) });
    g.push({ art: 'drehen', ...global(o, 0, -o.h / 2 - abstand) });
    return g;
  }
  return [{ art: 'ende', n: 1, x: o.x1, y: o.y1 }, { art: 'ende', n: 2, x: o.x2, y: o.y2 }];
}

export const rasten = v => Math.round(v / RASTER) * RASTER;

// Kasten so verschieben, dass seine Kanten am Raster liegen (bei 90°-Drehungen), sonst die Mitte.
export function rasteKasten(o) {
  const r = ((o.rot % 360) + 360) % 360;
  if (r % 90 === 0) {
    const ex = r % 180 === 0 ? o.w / 2 : o.h / 2, ey = r % 180 === 0 ? o.h / 2 : o.w / 2;
    o.x = rasten(o.x - ex) + ex; o.y = rasten(o.y - ey) + ey;
  } else { o.x = rasten(o.x); o.y = rasten(o.y); }
}

// Linie: Winkel nahe 0/45/90° einrasten, Endpunkt ans Raster.
export function rasteLinie(x1, y1, x2, y2) {
  x2 = rasten(x2); y2 = rasten(y2);
  const l = Math.hypot(x2 - x1, y2 - y1), w = Math.atan2(y2 - y1, x2 - x1), s = Math.round(w / (Math.PI / 4)) * (Math.PI / 4);
  if (Math.abs(w - s) < 0.07 && l > 0) { x2 = x1 + Math.cos(s) * l; y2 = y1 + Math.sin(s) * l; if (Math.abs(Math.sin(s)) < 1e-9) y2 = y1; if (Math.abs(Math.cos(s)) < 1e-9) x2 = x1; }
  return { x2, y2 };
}

export function neuesSymbol(art, x, y, massstab, id) {
  const s = SYMBOLE[art], k = proCm(massstab);
  const o = { id, typ: 'symbol', art, x, y, w: s.b * k, h: s.l * k, rot: 0, spiegel: false };
  rasteKasten(o);
  return o;
}

export const inCm = (einheiten, massstab) => Math.round(einheiten / proCm(massstab));

// Punkt im Vieleck (Lasso), poly = [x, y, x, y, …]
export function imVieleck(x, y, poly) {
  let drin = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) drin = !drin;
  }
  return drin;
}

// Objekt um dx/dy verschieben
export function verschiebe(o, dx, dy) {
  if (istKasten(o)) { o.x += dx; o.y += dy; } else { o.x1 += dx; o.x2 += dx; o.y1 += dy; o.y2 += dy; }
}
