// IndexedDB: dünner Wrapper. Alle Daten liegen nur auf dem Gerät.
const NAME = 'notizbuch';
const VER = 1;
export const STORES = ['folders', 'notes', 'pages', 'thumbs', 'files', 'meta'];

let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(NAME, VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      const neu = (n, opt) => d.objectStoreNames.contains(n) ? null : d.createObjectStore(n, opt);
      neu('folders', { keyPath: 'id' });
      neu('notes', { keyPath: 'id' })?.createIndex('folderId', 'folderId');
      neu('pages', { keyPath: 'id' })?.createIndex('noteId', 'noteId');
      neu('thumbs', { keyPath: 'noteId' });
      neu('files', { keyPath: 'id' });
      neu('meta', { keyPath: 'key' });
    };
    r.onsuccess = () => {
      const d = r.result;
      d.onversionchange = () => { d.close(); location.reload(); };
      d.onclose = () => { dbp = null; };
      res(d);
    };
    r.onerror = () => { dbp = null; rej(r.error); };
    r.onblocked = () => rej(new Error('Datenbank blockiert. Bitte andere Fenster der App schließen.'));
  });
  return dbp;
}

const asP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const fertig = t => new Promise((res, rej) => {
  t.oncomplete = () => res();
  t.onerror = () => rej(t.error);
  t.onabort = () => rej(t.error || new Error('Speichern abgebrochen'));
});

// Safari verliert nach dem Hintergrund manchmal die Verbindung: einmal neu öffnen und wiederholen.
async function mitWiederholung(fn) {
  try { return await fn(await open()); }
  catch (e) {
    if (e && (e.name === 'InvalidStateError' || /closing|lost|connection/i.test(e.message || ''))) {
      dbp = null;
      return fn(await open());
    }
    throw e;
  }
}

export const getAll = s => mitWiederholung(d => asP(d.transaction(s).objectStore(s).getAll()));
export const keys = s => mitWiederholung(d => asP(d.transaction(s).objectStore(s).getAllKeys()));
export const get = (s, k) => mitWiederholung(d => asP(d.transaction(s).objectStore(s).get(k)));

// Schreibvorgang über mehrere Stores in einer Transaktion: fn bekommt {store: ObjectStore}.
export const tx = (stores, fn) => mitWiederholung(d => {
  const t = d.transaction(stores, 'readwrite');
  const o = {};
  for (const s of stores) o[s] = t.objectStore(s);
  fn(o);
  return fertig(t);
});

export const put = (s, v) => tx([s], o => o[s].put(v));
