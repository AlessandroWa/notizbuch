// Service Worker: hält die App offline verfügbar. Bei jeder neuen Version VERSION erhöhen
// (gleiche Nummer wie in js/util.js), sonst bekommen installierte Geräte die Änderung nicht.
const VERSION = '0.3.0';
const CACHE = 'notizbuch-' + VERSION;
const DATEIEN = [
  './', 'index.html', 'app.css', 'manifest.webmanifest',
  'js/main.js', 'js/ui.js', 'js/store.js', 'js/db.js', 'js/ink.js', 'js/editor.js', 'js/backup.js', 'js/util.js',
  'js/zip.js', 'js/pdf.js', 'js/import.js', 'js/vorschau.js', 'js/objekte.js',
  'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs',
  'vendor/pdfjs/standard_fonts/FoxitDingbats.pfb',
  'vendor/pdfjs/standard_fonts/FoxitFixed.pfb',
  'vendor/pdfjs/standard_fonts/FoxitFixedBold.pfb',
  'vendor/pdfjs/standard_fonts/FoxitFixedBoldItalic.pfb',
  'vendor/pdfjs/standard_fonts/FoxitFixedItalic.pfb',
  'vendor/pdfjs/standard_fonts/FoxitSerif.pfb',
  'vendor/pdfjs/standard_fonts/FoxitSerifBold.pfb',
  'vendor/pdfjs/standard_fonts/FoxitSerifBoldItalic.pfb',
  'vendor/pdfjs/standard_fonts/FoxitSerifItalic.pfb',
  'vendor/pdfjs/standard_fonts/FoxitSymbol.pfb',
  'vendor/pdfjs/standard_fonts/LiberationSans-Bold.ttf',
  'vendor/pdfjs/standard_fonts/LiberationSans-BoldItalic.ttf',
  'vendor/pdfjs/standard_fonts/LiberationSans-Italic.ttf',
  'vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/logo-walz.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(DATEIEN.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('notizbuch-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// vendor/pdfjs/cmaps/ wird erst bei Bedarf geladen und dann im Cache behalten.
// Erst Cache, dann Netz. Seitenaufrufe bekommen immer index.html aus dem Cache.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('index.html', { ignoreSearch: true }).then(r => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req).then(res => {
    if (res.ok && res.type === 'basic') { const kopie = res.clone(); caches.open(CACHE).then(c => c.put(req, kopie)); }
    return res;
  })));
});
