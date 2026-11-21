// Ziehen und Ablegen wie bei Notability: lange auf einen Ordner oder eine Notiz tippen (oder mit der Maus
// gedrückt halten), dann ziehen.
//  - Ordner auf Ordner (Mitte)       → wird Unterordner
//  - Ordner an den oberen/unteren Rand einer Zeile in der Seitenleiste → davor/dahinter einreihen
//  - Ordner auf „Ordner“ (Überschrift) → Hauptordner (oberste Ebene)
//  - Notiz auf Ordner                → wird dorthin verschoben
import * as store from './store.js';

const HALTEN_MS = 450;

export function ziehenEinrichten({ fertig, meldung, klappeAuf }) {
  let warte = null, zug = null;

  const quelleVon = el => {
    const z = el.closest?.('[data-zieh]');
    if (!z || z.closest('.ed, dialog, .menue-hg')) return null;
    const [typ, id] = z.dataset.zieh.split(':');
    if (typ === 'ordner' && store.folder(id)?.system) return null;
    const titel = typ === 'ordner' ? store.folder(id)?.name : store.note(id)?.title;
    const farbe = typ === 'ordner' ? store.folder(id)?.color : null;
    return titel ? { typ, id, titel, farbe, el: z } : null;
  };

  document.addEventListener('pointerdown', e => {
    if (zug || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const q = quelleVon(e.target);
    if (!q) return;
    const x = e.clientX, y = e.clientY;
    warte = { q, x, y, id: e.pointerId, uhr: setTimeout(() => starte(q, x, y), e.pointerType === 'mouse' ? 300 : HALTEN_MS) };
  });

  function abbrechenWarten() { if (warte) { clearTimeout(warte.uhr); warte = null; } }

  function starte(q, x, y) {
    warte = null;
    const geist = document.createElement('div');
    geist.className = 'zieh-geist';
    geist.innerHTML = (q.farbe ? `<span class="dot" style="background:${q.farbe}"></span>` : '<span class="zieh-blatt"></span>') + '<span></span>';
    geist.lastChild.textContent = q.titel;
    document.body.append(geist);
    document.body.classList.add('zieht');
    q.el.classList.add('zieh-quelle');
    zug = { q, geist, ziel: null, lage: null, aufklapp: null };
    navigator.vibrate?.(15);
    bewege(x, y);
  }

  function zielBei(x, y) {
    const el = document.elementFromPoint(x, y);
    const t = el?.closest?.('[data-ordner], [data-ziel=oben]');
    if (!t) return { ziel: null };
    if (t.dataset.ziel === 'oben') return zug.q.typ === 'ordner' ? { ziel: t, lage: 'oben' } : { ziel: null };
    const id = t.dataset.ordner;
    if (zug.q.typ === 'notiz') return { ziel: t, lage: 'in' };
    if (id === zug.q.id) return { ziel: null };
    let lage = 'in';
    if (t.classList.contains('baum-zeile')) {
      const r = t.getBoundingClientRect(), rel = (y - r.top) / r.height;
      if (rel < 0.25) lage = 'vor'; else if (rel > 0.75) lage = 'nach';
    }
    const f = store.folder(id);
    const neuEltern = lage === 'in' ? id : (f.parentId ?? null);
    if (!store.canMoveFolder(zug.q.id, neuEltern)) return { ziel: null };
    if (lage !== 'in' && f.system && !f.parentId) return { ziel: null }; // vor/nach "To Do": nein
    return { ziel: t, lage };
  }

  function markiere(t, lage) {
    if (zug.ziel === t && zug.lage === lage) return;
    zug.ziel?.classList.remove('ziel-in', 'ziel-vor', 'ziel-nach', 'ziel-oben');
    clearTimeout(zug.aufklapp);
    zug.ziel = t; zug.lage = lage;
    if (!t) return;
    t.classList.add('ziel-' + lage);
    // eingeklappten Ordner nach kurzem Verweilen aufklappen
    if (lage === 'in' && t.getAttribute('aria-expanded') === 'false') {
      zug.aufklapp = setTimeout(() => { if (zug?.ziel === t) { const id = t.dataset.ordner; zug.ziel = null; klappeAuf(id); } }, 800);
    }
  }

  function bewege(x, y) {
    zug.geist.style.transform = `translate(${x + 14}px, ${y - 22}px)`;
    const { ziel, lage } = zielBei(x, y);
    markiere(ziel, lage);
    // am Rand der Seitenleiste bzw. Ordneransicht automatisch blättern
    for (const bereich of document.querySelectorAll('#side, #main')) {
      const r = bereich.getBoundingClientRect();
      if (x < r.left || x > r.right) continue;
      if (y < r.top + 50) bereich.scrollTop -= 12; else if (y > r.bottom - 50) bereich.scrollTop += 12;
    }
  }

  document.addEventListener('pointermove', e => {
    if (warte && e.pointerId === warte.id && Math.hypot(e.clientX - warte.x, e.clientY - warte.y) > 10) abbrechenWarten();
    if (zug) { e.preventDefault(); bewege(e.clientX, e.clientY); }
  }, { passive: false });
  // Während des Ziehens darf die Seite nicht scrollen
  document.addEventListener('touchmove', e => { if (zug) e.preventDefault(); }, { passive: false });

  async function ende(abbruch) {
    abbrechenWarten();
    if (!zug) return;
    const { q, ziel, lage, geist } = zug;
    clearTimeout(zug.aufklapp);
    zug = null;
    geist.remove();
    document.body.classList.remove('zieht');
    q.el.classList.remove('zieh-quelle');
    ziel?.classList.remove('ziel-in', 'ziel-vor', 'ziel-nach', 'ziel-oben');
    // den Klick nach dem Loslassen nicht als "Öffnen" werten
    const schlucke = ev => { ev.stopPropagation(); ev.preventDefault(); };
    document.addEventListener('click', schlucke, { capture: true, once: true });
    setTimeout(() => document.removeEventListener('click', schlucke, { capture: true }), 400);
    if (abbruch || !ziel) return;
    try {
      if (q.typ === 'notiz') {
        const zid = ziel.dataset.ordner;
        if (store.note(q.id).folderId !== zid) { await store.moveNote(q.id, zid); meldung(`„${q.titel}“ → „${store.folder(zid).name}“`); }
      } else if (lage === 'oben') {
        await store.ordneOrdner(q.id, null);
        meldung(`„${q.titel}“ ist jetzt ein Hauptordner`);
      } else if (lage === 'in') {
        const zid = ziel.dataset.ordner;
        await store.ordneOrdner(q.id, zid);
        meldung(`„${q.titel}“ → „${store.folder(zid).name}“`);
      } else {
        const f = store.folder(ziel.dataset.ordner), eltern = f.parentId ?? null;
        const liste = store.children(eltern).filter(x => x.id !== q.id);
        const i = liste.findIndex(x => x.id === f.id) + (lage === 'nach' ? 1 : 0);
        await store.ordneOrdner(q.id, eltern, i);
      }
    } catch (err) { meldung(err.message || String(err)); }
    fertig();
  }
  document.addEventListener('pointerup', () => ende(false));
  document.addEventListener('pointercancel', () => ende(!zug));
}
