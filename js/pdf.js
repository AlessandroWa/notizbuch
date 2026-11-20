// PDF-Seiten anzeigen (pdf.js liegt in vendor/, damit alles offline geht).
import * as db from './db.js';

const BASIS = new URL('../vendor/pdfjs/', import.meta.url).href;
let lib = null;
async function pdfjs() {
  if (!lib) {
    lib = await import('../vendor/pdfjs/pdf.min.mjs');
    lib.GlobalWorkerOptions.workerSrc = BASIS + 'pdf.worker.min.mjs';
  }
  return lib;
}

const OPTIONEN = {
  cMapUrl: BASIS + 'cmaps/', cMapPacked: true, standardFontDataUrl: BASIS + 'standard_fonts/',
  isEvalSupported: false, enableXfa: false,
};

async function oeffne(daten) {
  const p = await pdfjs();
  return p.getDocument({ ...OPTIONEN, data: daten }).promise;
}

// Geöffnete Dokumente, die zuletzt benutzten bleiben offen.
const offen = new Map();
function dokument(fileId) {
  let d = offen.get(fileId);
  if (d) { offen.delete(fileId); offen.set(fileId, d); return d; }
  d = db.get('files', fileId).then(async f => {
    if (!f) throw new Error('PDF-Datei fehlt');
    return oeffne(new Uint8Array(await f.blob.arrayBuffer()));
  });
  d.catch(() => offen.delete(fileId));
  offen.set(fileId, d);
  while (offen.size > 3) {
    const [k, alt] = offen.entries().next().value;
    offen.delete(k);
    alt.then(x => x.destroy()).catch(() => {});
  }
  return d;
}

// Seitengrößen einer PDF (für den Import), Größe in PDF-Punkten.
export async function seitenInfo(blob) {
  const d = await oeffne(new Uint8Array(await blob.arrayBuffer()));
  try {
    const seiten = [];
    for (let i = 1; i <= d.numPages; i++) {
      const v = (await d.getPage(i)).getViewport({ scale: 1 });
      seiten.push({ w: v.width, h: v.height });
    }
    return { seiten, doc: d };
  } catch (e) { d.destroy(); throw e; }
}

// Seite in einen Canvas zeichnen, Breite = canvas.width. Gibt {promise, cancel} zurück.
export function zeichne(canvas, fileId, seite, doc = null) {
  let task = null, abbruch = false;
  const promise = (async () => {
    const d = doc || await dokument(fileId);
    const p = await d.getPage(seite);
    if (abbruch) return false;
    const v1 = p.getViewport({ scale: 1 });
    const v = p.getViewport({ scale: canvas.width / v1.width });
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    task = p.render({ canvasContext: ctx, viewport: v, background: '#ffffff' });
    try { await task.promise; } catch (e) { if (e?.name === 'RenderingCancelledException') return false; throw e; }
    return true;
  })();
  return { promise, cancel() { abbruch = true; task?.cancel(); } };
}

export function vergiss(fileId) {
  const d = offen.get(fileId);
  offen.delete(fileId);
  d?.then(x => x.destroy()).catch(() => {});
}
