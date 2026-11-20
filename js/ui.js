// Dialoge und Menüs (eigene, damit sie auf iPad und PC gleich aussehen).
import { esc } from './util.js';
import * as store from './store.js';

function dialog(html, init) {
  return new Promise(res => {
    const d = document.createElement('dialog');
    d.className = 'dlg';
    d.innerHTML = html;
    document.body.append(d);
    let wert;
    const schliesse = v => { wert = v; d.close(); };
    d.addEventListener('close', () => { d.remove(); res(wert); });
    d.addEventListener('click', e => { if (e.target === d) schliesse(undefined); });
    d.querySelector('[data-x=abbrechen]')?.addEventListener('click', () => schliesse(undefined));
    init?.(d, schliesse);
    d.showModal();
  });
}

export function frage(titel, wert = '', ok = 'OK') {
  return dialog(`<form method="dialog">
    <h2>${esc(titel)}</h2>
    <input name="t" value="${esc(wert)}" maxlength="120" autocomplete="off" required>
    <div class="dlg-knoepfe"><button type="button" data-x="abbrechen">Abbrechen</button><button class="primaer">${esc(ok)}</button></div>
  </form>`, (d, fertig) => {
    const i = d.querySelector('input');
    setTimeout(() => { i.focus(); i.select(); }, 30);
    d.querySelector('form').addEventListener('submit', e => { e.preventDefault(); const v = i.value.trim(); if (v) fertig(v); });
  });
}

export function bestaetige(text, ok = 'OK', gefahr = false) {
  return dialog(`<div>
    <p class="dlg-text">${esc(text)}</p>
    <div class="dlg-knoepfe"><button type="button" data-x="abbrechen">Abbrechen</button><button class="${gefahr ? 'gefahr' : 'primaer'}" data-x="ok">${esc(ok)}</button></div>
  </div>`, (d, fertig) => d.querySelector('[data-x=ok]').addEventListener('click', () => fertig(true))).then(Boolean);
}

export function meldung(text) {
  return dialog(`<div><p class="dlg-text">${esc(text)}</p><div class="dlg-knoepfe"><button class="primaer" data-x="abbrechen">OK</button></div></div>`);
}

export function waehleFarbe(aktuell) {
  return dialog(`<div>
    <h2>Farbe</h2>
    <div class="farbwahl">${store.FARBEN.map(c => `<button data-c="${c}" aria-label="Farbe ${c}" aria-pressed="${c === aktuell}"><span class="dot" style="background:${c}"></span></button>`).join('')}</div>
    <div class="dlg-knoepfe"><button type="button" data-x="abbrechen">Abbrechen</button></div>
  </div>`, (d, fertig) => d.querySelector('.farbwahl').addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (b) fertig(b.dataset.c); }));
}

// Ordner auswählen (für "Verschieben nach"). ausschluss: Ordner-IDs, die nicht wählbar sind.
export function waehleOrdner(titel, { ausschluss = [], oberste = false } = {}) {
  const zeilen = [];
  const lauf = (pid, tiefe) => {
    for (const f of store.children(pid)) {
      zeilen.push(`<button class="baum-zeile" data-id="${f.id}" style="padding-left:${12 + tiefe * 18}px" ${ausschluss.includes(f.id) ? 'disabled' : ''}>
        <span class="dot" style="background:${f.color}"></span><span>${esc(f.name)}</span></button>`);
      lauf(f.id, tiefe + 1);
    }
  };
  lauf(null, 0);
  return dialog(`<div>
    <h2>${esc(titel)}</h2>
    <div class="baum-liste">${oberste ? '<button class="baum-zeile" data-id=""><span class="dot leer"></span><span>Oberste Ebene</span></button>' : ''}${zeilen.join('')}</div>
    <div class="dlg-knoepfe"><button type="button" data-x="abbrechen">Abbrechen</button></div>
  </div>`, (d, fertig) => d.querySelector('.baum-liste').addEventListener('click', e => {
    const b = e.target.closest('[data-id]');
    if (b && !b.disabled) fertig(b.dataset.id || null);
  }));
}

// Kleines Menü am Knopf. punkte: [{k, t, gefahr?}] oder '-' für Trennlinie.
export function menue(anker, punkte) {
  return new Promise(res => {
    const hg = document.createElement('div');
    hg.className = 'menue-hg';
    const m = document.createElement('div');
    m.className = 'menue';
    m.setAttribute('role', 'menu');
    m.innerHTML = punkte.map(p => p === '-' ? '<hr>' :
      `<button role="menuitem" data-k="${p.k}" class="${p.gefahr ? 'gefahr' : ''}">${esc(p.t)}</button>`).join('');
    hg.append(m);
    document.body.append(hg);
    const r = anker.getBoundingClientRect();
    const mr = m.getBoundingClientRect();
    m.style.top = Math.min(r.bottom + 6, innerHeight - mr.height - 8) + 'px';
    m.style.left = Math.max(8, Math.min(r.right - mr.width, innerWidth - mr.width - 8)) + 'px';
    const zu = k => { hg.remove(); document.removeEventListener('keydown', esc_); res(k); };
    const esc_ = e => { if (e.key === 'Escape') zu(undefined); };
    document.addEventListener('keydown', esc_);
    hg.addEventListener('click', e => { const b = e.target.closest('[data-k]'); zu(b ? b.dataset.k : undefined); });
    m.querySelector('button')?.focus({ preventScroll: true });
  });
}

// Fortschrittsanzeige für lange Vorgänge (lässt sich nicht wegklicken).
export function fortschritt(titel) {
  const d = document.createElement('dialog');
  d.className = 'dlg fortschritt';
  d.innerHTML = `<h2>${esc(titel)}</h2><p class="dlg-text" data-t>Bitte warten …</p><progress max="1" value="0"></progress><p class="klein" data-k></p>`;
  d.addEventListener('cancel', e => e.preventDefault());
  document.body.append(d);
  d.showModal();
  return {
    setze(text, anteil, klein = '') {
      d.querySelector('[data-t]').textContent = text;
      if (anteil == null) d.querySelector('progress').removeAttribute('value');
      else d.querySelector('progress').value = anteil;
      d.querySelector('[data-k]').textContent = klein;
    },
    zu() { d.close(); d.remove(); },
  };
}

// Breite und Länge in cm abfragen.
export function frageMasse(titel, b, l) {
  return dialog(`<form method="dialog">
    <h2>${esc(titel)}</h2>
    <div class="masse"><label>Breite (cm)<input name="b" type="number" inputmode="numeric" min="5" max="2000" value="${b}" required></label>
    <label>Länge (cm)<input name="l" type="number" inputmode="numeric" min="5" max="2000" value="${l}" required></label></div>
    <div class="dlg-knoepfe"><button type="button" data-x="abbrechen">Abbrechen</button><button class="primaer">Übernehmen</button></div>
  </form>`, (d, fertig) => {
    const f = d.querySelector('form');
    setTimeout(() => f.b.select(), 30);
    f.addEventListener('submit', e => {
      e.preventDefault();
      const nb = +f.b.value, nl = +f.l.value;
      if (nb >= 5 && nl >= 5) fertig({ b: nb, l: nl });
    });
  });
}

// Mehrzeiligen Text abfragen (Textfelder).
export function frageText(titel, wert = '') {
  return dialog(`<form method="dialog">
    <h2>${esc(titel)}</h2>
    <textarea name="t" rows="5" maxlength="4000">${esc(wert)}</textarea>
    <div class="dlg-knoepfe"><button type="button" data-x="abbrechen">Abbrechen</button><button class="primaer">Übernehmen</button></div>
  </form>`, (d, fertig) => {
    const f = d.querySelector('form');
    setTimeout(() => f.t.focus(), 30);
    f.addEventListener('submit', e => { e.preventDefault(); fertig(f.t.value.replace(/\s+$/, '')); });
  });
}
