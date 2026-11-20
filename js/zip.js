// ZIP lesen und schreiben, ohne Fremdbibliothek.
// Lesen: liest nur das Inhaltsverzeichnis, einzelne Dateien erst bei Bedarf (große ZIPs belasten den Speicher nicht).
// Unterstützt "gespeichert" und "deflate" (über DecompressionStream) sowie ZIP64 (Dateien über 4 GB).

const u16 = (v, o) => v.getUint16(o, true);
const u32 = (v, o) => v.getUint32(o, true);
const u64 = (v, o) => u32(v, o) + u32(v, o + 4) * 2 ** 32;

function dosDatum(zeit, datum) {
  return new Date(1980 + (datum >> 9), ((datum >> 5) & 15) - 1, datum & 31, zeit >> 11, (zeit >> 5) & 63, (zeit & 31) * 2).getTime();
}

const utf8 = new TextDecoder('utf-8', { fatal: true });
const CP437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
function name(bytes, istUtf8) {
  try { return utf8.decode(bytes); } catch { if (istUtf8) throw new Error('Ungültiger Dateiname im ZIP'); }
  return [...bytes].map(b => (b < 128 ? String.fromCharCode(b) : CP437[b - 128])).join('');
}

export async function istZip(datei) {
  if (datei.size < 22) return false;
  const v = new DataView(await datei.slice(0, 4).arrayBuffer());
  return u32(v, 0) === 0x04034b50 || u32(v, 0) === 0x06054b50;
}

// Liefert die Einträge: {name, ordner, methode, gross, gepackt, off, datum}
export async function liesInhalt(datei) {
  const groesse = datei.size;
  const n = Math.min(groesse, 65557);
  const ende = new DataView(await datei.slice(groesse - n).arrayBuffer());
  let p = -1;
  for (let i = n - 22; i >= 0; i--) if (u32(ende, i) === 0x06054b50) { p = i; break; }
  if (p < 0) throw new Error('Die Datei ist kein gültiges ZIP-Archiv.');
  let anzahl = u16(ende, p + 10), cdGroesse = u32(ende, p + 12), cdOff = u32(ende, p + 16);
  if (anzahl === 0xffff || cdGroesse === 0xffffffff || cdOff === 0xffffffff) { // ZIP64
    const lpos = groesse - n + p - 20;
    const l = new DataView(await datei.slice(lpos, lpos + 20).arrayBuffer());
    if (u32(l, 0) !== 0x07064b50) throw new Error('ZIP64-Verzeichnis nicht gefunden.');
    const z = new DataView(await datei.slice(u64(l, 8), u64(l, 8) + 56).arrayBuffer());
    if (u32(z, 0) !== 0x06064b50) throw new Error('ZIP64-Verzeichnis beschädigt.');
    anzahl = u64(z, 32); cdGroesse = u64(z, 40); cdOff = u64(z, 48);
  }
  const cd = new DataView(await datei.slice(cdOff, cdOff + cdGroesse).arrayBuffer());
  const raus = [];
  for (let o = 0, i = 0; i < anzahl; i++) {
    if (u32(cd, o) !== 0x02014b50) throw new Error('ZIP-Verzeichnis beschädigt.');
    const flags = u16(cd, o + 8), nlen = u16(cd, o + 28), xlen = u16(cd, o + 30), klen = u16(cd, o + 32);
    let gepackt = u32(cd, o + 20), gross = u32(cd, o + 24), off = u32(cd, o + 42);
    // ZIP64-Zusatzfeld
    for (let x = o + 46 + nlen; x < o + 46 + nlen + xlen;) {
      const id = u16(cd, x), len = u16(cd, x + 2);
      if (id === 1) {
        let q = x + 4;
        if (gross === 0xffffffff) { gross = u64(cd, q); q += 8; }
        if (gepackt === 0xffffffff) { gepackt = u64(cd, q); q += 8; }
        if (off === 0xffffffff) { off = u64(cd, q); }
      }
      x += 4 + len;
    }
    const n_ = name(new Uint8Array(cd.buffer, o + 46, nlen), flags & 0x800).replace(/\\/g, '/');
    raus.push({ name: n_, ordner: n_.endsWith('/'), methode: u16(cd, o + 10), gross, gepackt, off, datum: dosDatum(u16(cd, o + 12), u16(cd, o + 14)) });
    o += 46 + nlen + xlen + klen;
  }
  return raus;
}

// Inhalt eines Eintrags als Blob.
export async function eintragBlob(datei, e, typ = '') {
  const k = new DataView(await datei.slice(e.off, e.off + 30).arrayBuffer());
  if (u32(k, 0) !== 0x04034b50) throw new Error('ZIP-Eintrag beschädigt: ' + e.name);
  const start = e.off + 30 + u16(k, 26) + u16(k, 28);
  const roh = datei.slice(start, start + e.gepackt);
  if (e.methode === 0) return new Blob([await roh.arrayBuffer()], { type: typ });
  if (e.methode === 8) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Dieses Gerät kann gepackte ZIPs nicht entpacken (iPadOS aktualisieren).');
    const b = await new Response(roh.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
    return typ ? new Blob([b], { type: typ }) : b;
  }
  throw new Error(`Packverfahren ${e.methode} wird nicht unterstützt: ${e.name}`);
}

// ---------- Schreiben (ohne Kompression; PDFs und JPEGs sind schon gepackt) ----------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(d) {
  let c = 0xffffffff;
  for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export class ZipSchreiber {
  constructor() { this.teile = []; this.cd = []; this.off = 0; this.n = 0; }

  async dazu(dateiname, blob) {
    const daten = new Uint8Array(await blob.arrayBuffer());
    const nb = new TextEncoder().encode(dateiname);
    const crc = crc32(daten), g = daten.length;
    if (this.off + g + 30 + nb.length > 0xfffffff0) throw new Error('Die Sicherung ist größer als 4 GB. Das wird noch nicht unterstützt.');
    const d = new Date();
    const zeit = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const datum = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const kopf = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x800, 2], [8, 0, 2], [10, zeit, 2], [12, datum, 2], [14, crc, 4], [18, g, 4], [22, g, 4], [26, nb.length, 2], [28, 0, 2]]
      .forEach(([o, v, l]) => (l === 4 ? kopf.setUint32(o, v, true) : kopf.setUint16(o, v, true)));
    const z = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x800, 2], [10, 0, 2], [12, zeit, 2], [14, datum, 2], [16, crc, 4], [20, g, 4], [24, g, 4],
      [28, nb.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, this.off, 4]]
      .forEach(([o, v, l]) => (l === 4 ? z.setUint32(o, v, true) : z.setUint16(o, v, true)));
    this.teile.push(kopf, nb, blob);
    this.cd.push(z, nb);
    this.off += 30 + nb.length + g;
    this.n++;
  }

  fertig(typ = 'application/zip') {
    const cdGroesse = this.cd.reduce((s, t) => s + t.byteLength, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(8, this.n, true); e.setUint16(10, this.n, true);
    e.setUint32(12, cdGroesse, true); e.setUint32(16, this.off, true);
    return new Blob([...this.teile, ...this.cd, e], { type: typ });
  }
}
