// Seite als Bild: Vorschau (klein) und PDF-Export (groß).
// Reihenfolge wie im Editor: Papier oder PDF, darüber Objekte (Symbole, Fotos, Text), darüber Handschrift.
import { drawPaper, drawStrokes } from './ink.js';
import { zeichne } from './pdf.js';
import { zeichneObjekte, ladeBilder } from './objekte.js';

export async function seitenCanvas(page, breite, doc = null) {
  const c = document.createElement('canvas');
  const k = breite / page.w;
  c.width = Math.round(breite); c.height = Math.round(page.h * k);
  const ctx = c.getContext('2d');
  await ladeBilder(page);
  if (page.bg?.art === 'pdf') {
    try { await zeichne(c, page.bg.fileId, page.bg.seite, doc).promise; }
    catch { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.setTransform(k, 0, 0, k, 0, 0);
  } else {
    ctx.setTransform(k, 0, 0, k, 0, 0);
    drawPaper(ctx, page.paper, page.w, page.h);
  }
  zeichneObjekte(ctx, page);
  drawStrokes(ctx, page);
  return c;
}

export async function makeThumb(page, breite = 420, doc = null) {
  const c = await seitenCanvas(page, breite, doc);
  const blob = await new Promise(res => c.toBlob(b => res(b), 'image/jpeg', 0.82));
  c.width = c.height = 0;
  return blob;
}
