// Vorlagen für neue Notizen.
import { MM } from './ink.js';
import { textMasse } from './objekte.js';
import { uid, datum } from './util.js';

const GRAU = '#8a8687';
const ZEILE = 8 * MM, OBEN = 25 * MM; // wie Papier "liniert"
const LINKS = 40;

function text(x, y, t, gr, c = GRAU) {
  const m = textMasse(t, gr);
  return { id: uid(), typ: 'text', text: t, gr, c, x: x + m.w / 2, y: y + m.h / 2, w: m.w, h: m.h, rot: 0, spiegel: false };
}
// Beschriftung so, dass sie auf der Linie "steht"
const feld = (zeile, t) => text(LINKS, OBEN + zeile * ZEILE - 15 * 1.3 - 2, t, 15);

export const VORLAGEN = {
  beratung: {
    name: 'Beratungsgespräch',
    paper: 'liniert',
    titel: () => 'Beratung ' + datum(Date.now()),
    objekte: () => [
      text(LINKS, 22 * MM - 30 * 1.3 + 4, 'Beratungsgespräch', 30, '#424041'),
      text(1000 - 260, 22 * MM - 15 * 1.3, 'Datum: ' + datum(Date.now()), 15),
      feld(1, 'Kunde'),
      feld(2, 'Adresse'),
      feld(4, 'Telefon / E-Mail'),
      feld(5, 'Worum geht es'),
      feld(7, 'Interesse (Fliesen, Naturstein …)'),
      feld(9, 'Material / Formate'),
      feld(11, 'Nächster Schritt'),
      { id: uid(), typ: 'linie', x1: LINKS, y1: OBEN + 12.5 * ZEILE, x2: 1000 - LINKS, y2: OBEN + 12.5 * ZEILE, c: GRAU, lw: 1.5 },
      feld(14, 'Notizen / Skizze'),
    ],
  },
};
