// Notiz als PDF: jede Seite als Bild (200 dpi) in eine einfache PDF-Datei.
import { seitenCanvas } from './vorschau.js';

const A4_BREITE_PT = 595.28;
const enc = new TextEncoder();

export async function notizAlsPdf(titel, pages, melde = () => {}) {
  const teile = [], offsets = [];
  let laenge = 0;
  const schreib = t => { const b = typeof t === 'string' ? enc.encode(t) : t; teile.push(b); laenge += b.length; };
  const objekt = (nr, kopf, strom) => {
    offsets[nr] = laenge;
    schreib(`${nr} 0 obj\n${kopf}\n`);
    if (strom) { schreib('stream\n'); schreib(strom); schreib('\nendstream\n'); }
    schreib('endobj\n');
  };
  schreib('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const n = pages.length;
  // Nummern: 1 Katalog, 2 Seitenbaum, dann je Seite: Seite, Inhalt, Bild
  const seitenNr = i => 3 + i * 3;
  objekt(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objekt(2, `<< /Type /Pages /Count ${n} /Kids [${pages.map((_, i) => `${seitenNr(i)} 0 R`).join(' ')}] >>`);
  for (let i = 0; i < n; i++) {
    melde(`Seite ${i + 1} von ${n}`, i / n);
    const p = pages[i];
    const c = await seitenCanvas(p, 1654); // A4 bei 200 dpi
    const jpg = new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85))).arrayBuffer());
    const bw = c.width, bh = c.height;
    c.width = c.height = 0;
    const w = A4_BREITE_PT, h = +(A4_BREITE_PT * p.h / p.w).toFixed(2);
    const inhalt = enc.encode(`q ${w} 0 0 ${h} 0 0 cm /Bild Do Q`);
    const nr = seitenNr(i);
    objekt(nr, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Bild ${nr + 2} 0 R >> >> /Contents ${nr + 1} 0 R >>`);
    objekt(nr + 1, `<< /Length ${inhalt.length} >>`, inhalt);
    objekt(nr + 2, `<< /Type /XObject /Subtype /Image /Width ${bw} /Height ${bh} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>`, jpg);
  }
  const anzahl = 3 + n * 3;
  const xref = laenge;
  let x = `xref\n0 ${anzahl}\n0000000000 65535 f \n`;
  for (let i = 1; i < anzahl; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  schreib(x);
  schreib(`trailer\n<< /Size ${anzahl} /Root 1 0 R /Info << /Title (${pdfText(titel)}) /Producer (Notizbuch) >> >>\nstartxref\n${xref}\n%%EOF\n`);
  const name = (titel.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Notiz') + '.pdf';
  return new File(teile, name, { type: 'application/pdf' });
}

// Titel für das PDF-Info-Feld (nur einfache Zeichen, Umlaute umschreiben)
function pdfText(t) {
  return t.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
    .replace(/[^\x20-\x7e]/g, '').replace(/[()\\]/g, '\\$&');
}
