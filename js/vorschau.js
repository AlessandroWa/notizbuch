// Vorschaubild der ersten Seite als JPEG (Papier oder PDF, darüber die Striche).
import { drawPaper, drawStrokes } from './ink.js';
import { zeichne } from './pdf.js';

export async function makeThumb(page, breite = 420, doc = null) {
  const c = document.createElement('canvas');
  const k = breite / page.w;
  c.width = breite; c.height = Math.round(page.h * k);
  const ctx = c.getContext('2d');
  if (page.bg?.art === 'pdf') {
    try { await zeichne(c, page.bg.fileId, page.bg.seite, doc).promise; }
    catch { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.setTransform(k, 0, 0, k, 0, 0);
  } else {
    ctx.setTransform(k, 0, 0, k, 0, 0);
    drawPaper(ctx, page.paper, page.w, page.h);
  }
  drawStrokes(ctx, page);
  const blob = await new Promise(res => c.toBlob(b => res(b), 'image/jpeg', 0.82));
  c.width = c.height = 0;
  return blob;
}
