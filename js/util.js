// Kleine Helfer, überall gebraucht.
export const VERSION = '0.5.7';

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);

export const datum = t => new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
export const datumZeit = t => datum(t) + ' ' + new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

export function debounce(fn, ms) {
  let t = 0;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => { t = 0; fn(...a); }, ms); };
  d.flush = (...a) => { if (t) { clearTimeout(t); t = 0; return fn(...a); } };
  d.pending = () => !!t;
  return d;
}
