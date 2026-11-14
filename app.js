'use strict';
// ================= Hilfsfunktionen =================
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => fmt(new Date());
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d); };
const monday = (s) => addDays(s, -((parse(s).getDay() + 6) % 7));
const de = (s) => (s ? parse(s).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
function isoWeek(s) {
  const d = parse(s); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - w1) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, mo - 1, da);
}
function germanHolidays(y) {
  const e = easter(y), rel = (n) => { const d = new Date(e); d.setDate(d.getDate() + n); return fmt(d); };
  return [[`${y}-01-01`, 'Neujahr'], [rel(-2), 'Karfreitag'], [rel(1), 'Ostermontag'], [`${y}-05-01`, 'Tag der Arbeit'],
    [rel(39), 'Christi Himmelfahrt'], [rel(50), 'Pfingstmontag'], [`${y}-10-03`, 'Tag der Deutschen Einheit'],
    [`${y}-12-25`, '1. Weihnachtstag'], [`${y}-12-26`, '2. Weihnachtstag']];
}

const DEF = { c_weekday: '#ffffff', c_sat: '#f1f3f5', c_sun: '#e9ecef', c_holiday: '#ffe8cc', c_vacation: '#ced4da', c_sick: '#ffc9c9', c_boss: '#e7f5ff', c_extras: '#fff9db', c_entry: '#d3f9d8' };
const COLS = [['c_weekday', 'Normale Wochentage'], ['c_sat', 'Samstag'], ['c_sun', 'Sonntag'], ['c_holiday', 'Feiertage'], ['c_vacation', 'Urlaub'],
  ['c_sick', 'Krankheit'], ['c_boss', 'Chefzeile'], ['c_extras', 'EXTRAS-Zeile'], ['c_entry', 'Individuelle Kalendereinträge']];
const STATUS = { geplant: ['Geplant', '#228be6'], in_bearbeitung: ['In Bearbeitung', '#fab005'], erledigt: ['Erledigt', '#40c057'], problem: ['Problem / Verzögerung', '#fa5252'] };

let S = { employees: [], sites: [], entries: [], absences: [], notes: [], holidays: [], settings: {} };
let view = { page: 'kalender', mode: 'week', anchor: today() };
let lastJson = '', dragId = null, archive = { q: '', f: 'alle' }, noteFilter = 'offen', holYear = new Date().getFullYear();
const col = (k) => S.settings[k] || DEF[k];
const siteOf = (id) => S.sites.find((s) => s.id === id);
const empOf = (id) => S.employees.find((e) => e.id === id);
const emps = () => S.employees.filter((e) => !e.deleted && e.active).sort((a, b) => a.sort - b.sort || a.id - b.id);
const allEmps = () => S.employees.filter((e) => !e.deleted).sort((a, b) => a.sort - b.sort || a.id - b.id);

// ================= Server-Kommunikation =================
async function api(method, url, body) {
  let r;
  try {
    r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  } catch (e) { $('#banner').hidden = false; throw new Error('Keine Verbindung zum Server.'); }
  $('#banner').hidden = true;
  let data = null; try { data = await r.json(); } catch (e) { /* leer */ }
  if (!r.ok) { const err = new Error((data && data.error) || `Fehler ${r.status}`); err.status = r.status; err.data = data; throw err; }
  return data;
}
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = err ? 'err' : ''; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), err ? 5000 : 2200);
}
async function run(fn) { try { await fn(); } catch (e) { toast(e.message, true); } }
async function load(silent) {
  const s = await api('GET', '/api/state');
  const j = JSON.stringify(s);
  if (silent && j === lastJson) return;
  lastJson = j; S = s; render();
}

// ================= Dialoge =================
function modal({ title, body, submit = 'Speichern', onSubmit, foot = '' }) {
  const m = $('#modal');
  m.innerHTML = `<div class="dlg"><form><h2>${title}</h2><div>${body}</div><div class="foot">${foot}<button type="button" class="btn" data-act="close">${onSubmit ? 'Abbrechen' : 'Schließen'}</button>${onSubmit ? `<button class="btn pri">${submit}</button>` : ''}</div></form></div>`;
  m.hidden = false;
  const f = m.querySelector('form');
  f.onsubmit = (ev) => { ev.preventDefault(); run(async () => { if ((await onSubmit?.(f)) !== false) closeModal(); }); };
  return f;
}
function closeModal() { $('#modal').hidden = true; $('#modal').innerHTML = ''; }
function ask(msg, btns) {
  return new Promise((res) => {
    const c = $('#confirm');
    c.innerHTML = `<div class="dlg small"><p>${esc(msg)}</p><div class="foot">${btns.map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div></div>`;
    c.hidden = false;
    c.onclick = (e) => { const b = e.target.closest('[data-i]'); if (!b) return; c.hidden = true; res(btns[b.dataset.i].value); };
  });
}
const askDelete = (msg, label = 'Löschen') => ask(msg, [{ label: 'Abbrechen', value: false }, { label, value: true, cls: 'dan' }]);
const askConflict = (msg) => ask(msg, [{ label: 'Abbrechen', value: false }, { label: 'Trotzdem durchführen', value: true, cls: 'pri' }]);

// ================= Doppelbelegung =================
function conflict(empId, date, excludeId) {
  if (S.entries.some((e) => e.row_type === 'work' && e.employee_id === empId && e.date === date && e.id !== excludeId))
    return 'Achtung! Dieser Mitarbeiter ist an diesem Tag bereits verplant.';
  const a = S.absences.find((x) => x.employee_id === empId && x.date === date);
  if (a) return `Achtung! Dieser Mitarbeiter hat an diesem Tag eingetragen: ${a.type === 'vacation' ? 'URLAUB' : 'KRANK'}.`;
  return null;
}

// ================= Rendering =================
const PAGES = [['kalender', 'Kalender'], ['mitarbeiter', 'Mitarbeiter'], ['archiv', 'Baustellenarchiv'], ['notizen', 'Notizen'], ['dashboard', 'Dashboard'], ['einstellungen', 'Einstellungen']];
function render() {
  $('#nav').innerHTML = PAGES.map(([p, l]) => `<button data-act="nav" data-p="${p}" class="${view.page === p ? 'on' : ''}">${l}</button>`).join('');
  const w = $('.cal-wrap'); const sl = w ? w.scrollLeft : 0, st = w ? w.scrollTop : 0;
  const first = !w;
  $('#main').innerHTML = { kalender: viewCal, mitarbeiter: viewEmps, archiv: viewArchive, notizen: viewNotes, dashboard: viewDash, einstellungen: viewSettings }[view.page]();
  const w2 = $('.cal-wrap');
  if (w2) { w2.scrollLeft = sl; w2.scrollTop = st; if (first) { const t = $('th.today', w2); if (t) w2.scrollLeft = Math.max(0, t.offsetLeft - 200); } }
}

function calDays() {
  if (view.mode === 'week') { const m = monday(view.anchor); return Array.from({ length: 7 }, (_, i) => addDays(m, i)); }
  const d = parse(view.anchor), n = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return Array.from({ length: n }, (_, i) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(i + 1)}`);
}
function viewCal() {
  const days = calDays(), list = emps(), t = today();
  const hol = {}; S.holidays.forEach((h) => (hol[h.date] = h.name));
  const abs = {}; S.absences.forEach((a) => (abs[`${a.employee_id}|${a.date}`] = a));
  const ents = {}; S.entries.forEach((e) => { (ents[`${e.row_type === 'extras' ? 'x' : e.employee_id}|${e.date}`] ||= []).push(e); });
  const title = view.mode === 'week' ? `KW ${isoWeek(days[0])} · ${de(days[0])} – ${de(days[6])}` : parse(view.anchor).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  const chips = (key) => (ents[key] || []).sort((a, b) => a.sort - b.sort || a.id - b.id).map((e) => {
    const s = e.site_id ? siteOf(e.site_id) : null;
    const st = s ? `<span class="dot" style="background:${STATUS[s.status][1]}" title="${STATUS[s.status][0]}"></span>` : '';
    return `<div class="chip" draggable="true" data-act="chip" data-id="${e.id}" style="background:${e.color || col('c_entry')}">${st}<span>${esc(s ? s.name : e.text)}</span></div>`;
  }).join('');
  const cell = (empId, d, boss, extras) => {
    const a = extras ? null : abs[`${empId}|${d}`], dow = parse(d).getDay();
    let bg = a ? (a.type === 'vacation' ? col('c_vacation') : col('c_sick')) : extras ? col('c_extras') : boss ? col('c_boss')
      : hol[d] ? col('c_holiday') : dow === 0 ? col('c_sun') : dow === 6 ? col('c_sat') : col('c_weekday');
    return `<td data-act="cell" data-emp="${empId}" data-date="${d}" style="background:${bg}">${a ? `<div class="abs" data-act="abs" data-emp="${empId}" data-date="${d}">${a.type === 'vacation' ? 'URLAUB' : 'KRANK'}</div>` : ''}${!extras && hol[d] && !a ? `<div class="hol">${esc(hol[d])}</div>` : ''}${chips(`${empId}|${d}`)}</td>`;
  };
  const head = days.map((d) => `<th class="${d === t ? 'today' : ''}" style="background:${hol[d] ? col('c_holiday') : '#fff'}">${WD[parse(d).getDay()]}<small>${de(d).slice(0, 5)}</small></th>`).join('');
  const rows = list.map((e) => `<tr><td class="name" style="background:${e.is_boss ? col('c_boss') : '#fff'}">${esc(e.name)}</td>${days.map((d) => cell(e.id, d, e.is_boss, false)).join('')}</tr>`).join('')
    || `<tr><td class="name">–</td><td colspan="${days.length}">Noch keine Mitarbeiter angelegt. Bitte im Bereich „Mitarbeiter“ hinzufügen.</td></tr>`;
  const ex = `<tr><td class="name" style="background:${col('c_extras')}">EXTRAS</td>${days.map((d) => cell('x', d, false, true)).join('')}</tr>`;
  return `<div class="toolbar">
    <div class="seg"><button class="btn ${view.mode === 'week' ? 'on' : ''}" data-act="mode" data-m="week">Woche</button><button class="btn ${view.mode === 'month' ? 'on' : ''}" data-act="mode" data-m="month">Monat</button></div>
    <div class="seg"><button class="btn" data-act="step" data-n="-m" title="Vorheriger Monat">«</button><button class="btn" data-act="step" data-n="-w" title="Vorherige Woche">‹</button><button class="btn" data-act="step" data-n="0">Heute</button><button class="btn" data-act="step" data-n="w" title="Nächste Woche">›</button><button class="btn" data-act="step" data-n="m" title="Nächster Monat">»</button></div>
    <span class="title">${title}</span><span class="sp"></span>
    <button class="btn" data-act="absence">Urlaub / Krank eintragen</button>
    <button class="btn pri" data-act="newentry">+ Eintrag</button></div>
    <div class="cal-wrap"><table class="cal"><thead><tr><th class="corner">Mitarbeiter</th>${head}</tr></thead><tbody>${rows}${ex}</tbody></table></div>
    <div class="legend">${Object.entries(STATUS).map(([, [l, c]]) => `<span><i class="dot" style="background:${c}"></i>${l}</span>`).join('')}<span>Zelle anklicken = neuer Eintrag · Eintrag anklicken = bearbeiten · Doppelklick = Baustellendetails · Ziehen = verschieben</span></div>`;
}

function viewEmps() {
  const list = allEmps(), gone = S.employees.filter((e) => e.deleted);
  return `<h1>Mitarbeiterverwaltung</h1>
  <div class="inline-form"><label>Name<input id="newname" placeholder="Vor- und Nachname"></label><label class="inl" style="margin-bottom:10px"><input type="checkbox" id="newboss"> Chefzeile</label><button class="btn pri" data-act="emp-add" style="margin-bottom:10px">Mitarbeiter hinzufügen</button></div>
  <div class="tbl-wrap"><table class="list"><tr><th>Reihenfolge</th><th>Name</th><th>Infos</th><th>Aktiv</th><th></th></tr>
  ${list.map((e, i) => `<tr><td><button class="btn sm" data-act="emp-move" data-id="${e.id}" data-d="-1" ${i === 0 ? 'disabled' : ''}>▲</button> <button class="btn sm" data-act="emp-move" data-id="${e.id}" data-d="1" ${i === list.length - 1 ? 'disabled' : ''}>▼</button></td>
  <td>${esc(e.name)} ${e.is_boss ? '<span class="pill" style="background:#868e96">Chef</span>' : ''}</td><td>${esc(e.info)}</td>
  <td><input type="checkbox" data-act="emp-active" data-id="${e.id}" ${e.active ? 'checked' : ''}></td>
  <td><button class="btn sm" data-act="emp-edit" data-id="${e.id}">Bearbeiten</button> <button class="btn sm dan" data-act="emp-del" data-id="${e.id}">Löschen</button></td></tr>`).join('') || '<tr><td colspan="5">Keine Mitarbeiter.</td></tr>'}</table></div>
  <p style="color:var(--mut);font-size:13px">Deaktivierte Mitarbeiter verschwinden aus dem Kalender. „Löschen“ blendet einen Mitarbeiter aus – alle bisherigen Einträge bleiben in der Datenbank erhalten.</p>
  ${gone.length ? `<h2>Gelöschte Mitarbeiter</h2><div class="tbl-wrap"><table class="list">${gone.map((e) => `<tr><td>${esc(e.name)}</td><td><button class="btn sm" data-act="emp-restore" data-id="${e.id}">Wiederherstellen</button></td></tr>`).join('')}</table></div>` : ''}`;
}

function viewArchive() {
  const q = archive.q.toLowerCase();
  const list = S.sites.filter((s) => (archive.f === 'alle' || (archive.f === 'abgeschlossen' ? s.status === 'erledigt' : s.status !== 'erledigt'))
    && (!q || [s.name, s.customer, s.address, s.contact].some((x) => (x || '').toLowerCase().includes(q)))).sort((a, b) => b.id - a.id);
  return `<h1>Baustellenarchiv</h1>
  <div class="toolbar"><input id="aq" placeholder="Suchen: Baustelle, Kunde, Adresse …" value="${esc(archive.q)}" style="min-width:240px">
  <select id="af">${[['alle', 'Alle'], ['aktiv', 'Nicht abgeschlossen'], ['abgeschlossen', 'Abgeschlossen']].map(([v, l]) => `<option value="${v}" ${archive.f === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
  <span class="sp"></span><button class="btn pri" data-act="site-new">+ Neue Baustelle</button></div>
  <div class="tbl-wrap"><table class="list"><tr><th>Status</th><th>Bauvorhaben</th><th>Kunde</th><th>Adresse</th><th>Einsätze</th><th></th></tr>
  ${list.map((s) => `<tr><td><span class="pill" style="background:${STATUS[s.status][1]}">${STATUS[s.status][0]}</span></td><td>${esc(s.name)}</td><td>${esc(s.customer)}</td><td>${esc(s.address)}</td>
  <td>${S.entries.filter((e) => e.site_id === s.id).length}</td>
  <td style="white-space:nowrap"><button class="btn sm" data-act="site-open" data-id="${s.id}">Öffnen</button> <button class="btn sm" data-act="pdf-site" data-id="${s.id}">Arbeitsauftrag</button>
  ${s.status === 'erledigt' ? `<button class="btn sm" data-act="site-react" data-id="${s.id}">Wieder aktivieren</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6">Keine Baustellen gefunden.</td></tr>'}</table></div>`;
}

function viewNotes() {
  const list = S.notes.filter((n) => (noteFilter === 'offen' ? !n.done : noteFilter === 'erledigt' ? n.done : true)).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  return `<h1>Tagesnotizen</h1>
  <div class="inline-form"><label>Datum<input type="date" id="nd" value="${today()}"></label><label style="flex:1;min-width:200px">Notiz<input id="nt" placeholder="Notiz eingeben"></label><button class="btn pri" data-act="note-add" style="margin-bottom:10px">Notiz speichern</button></div>
  <div class="toolbar"><div class="seg">${['offen', 'erledigt', 'alle'].map((f) => `<button class="btn ${noteFilter === f ? 'on' : ''}" data-act="note-filter" data-f="${f}">${f[0].toUpperCase() + f.slice(1)}</button>`).join('')}</div></div>
  <div class="tbl-wrap"><table class="list"><tr><th></th><th>Datum</th><th>Notiz</th><th></th></tr>
  ${list.map((n) => `<tr><td><input type="checkbox" data-act="note-done" data-id="${n.id}" ${n.done ? 'checked' : ''} title="Erledigt"></td><td>${de(n.date)}</td><td class="${n.done ? 'done' : ''}">${esc(n.text)}</td>
  <td style="white-space:nowrap"><button class="btn sm" data-act="note-edit" data-id="${n.id}">Bearbeiten</button> <button class="btn sm dan" data-act="note-del" data-id="${n.id}">Löschen</button></td></tr>`).join('') || '<tr><td colspan="4">Keine Notizen.</td></tr>'}</table></div>`;
}

function viewDash() {
  const t = today(), act = allEmps().filter((e) => e.active);
  const away = (type) => act.filter((e) => S.absences.some((a) => a.employee_id === e.id && a.date === t && a.type === type)).length;
  const vac = away('vacation'), sick = away('sick');
  const cards = [['Mitarbeiter gesamt', allEmps().length], ['Heute verfügbar', act.length - vac - sick], ['Im Urlaub', vac], ['Krank', sick],
    ['Aktive Baustellen (in Bearbeitung)', S.sites.filter((s) => s.status === 'in_bearbeitung').length],
    ['Geplante Einsätze (ab heute)', S.entries.filter((e) => e.row_type === 'work' && e.date >= t).length],
    ['Offene Aufträge (nicht erledigt)', S.sites.filter((s) => s.status !== 'erledigt').length]];
  const todays = S.entries.filter((e) => e.row_type === 'work' && e.date === t);
  return `<h1>Dashboard – ${de(t)}</h1><div class="card-grid">${cards.map(([l, v]) => `<div class="card"><b>${v}</b><span>${l}</span></div>`).join('')}</div>
  <h2 style="margin-top:20px">Heutige Einsätze</h2><div class="tbl-wrap"><table class="list">${todays.map((e) => `<tr><td>${esc(empOf(e.employee_id)?.name || '')}</td><td>${esc(e.site_id ? siteOf(e.site_id)?.name : e.text)}</td></tr>`).join('') || '<tr><td>Heute keine Einsätze geplant.</td></tr>'}</table></div>`;
}

function viewSettings() {
  const hs = S.holidays.filter((h) => h.date.startsWith(String(holYear))).sort((a, b) => a.date.localeCompare(b.date));
  return `<h1>Einstellungen</h1><h2>Kalenderfarben</h2>
  <div class="colors">${COLS.map(([k, l]) => `<div><input type="color" data-chg="color" data-key="${k}" value="${col(k)}"><span>${l}</span></div>`).join('')}</div>
  <div class="inline-form"><button class="btn" data-act="colors-reset">Grundeinstellungen wiederherstellen</button><a class="btn" href="/api/export" download>Datensicherung herunterladen (JSON)</a></div>
  <h2 style="margin-top:22px">Feiertage</h2>
  <div class="inline-form"><label>Jahr<input type="number" id="hy" value="${holYear}" min="2000" max="2100" style="width:100px"></label>
  <button class="btn" data-act="hol-gen">Gesetzliche Feiertage (Deutschland, bundesweit) eintragen</button></div>
  <div class="inline-form"><label>Datum<input type="date" id="hd"></label><label>Bezeichnung<input id="hn" placeholder="z. B. Betriebsferien"></label><button class="btn pri" data-act="hol-add" style="margin-bottom:10px">Feiertag hinzufügen</button></div>
  <div class="tbl-wrap"><table class="list">${hs.map((h) => `<tr><td>${de(h.date)}</td><td>${esc(h.name)}</td><td><button class="btn sm dan" data-act="hol-del" data-id="${h.id}">Löschen</button></td></tr>`).join('') || `<tr><td>Keine Feiertage für ${holYear}.</td></tr>`}</table></div>`;
}

// ================= Aktionen (Klicks) =================
const actions = {
  nav: (el) => { view.page = el.dataset.p; render(); },
  close: () => closeModal(),
  mode: (el) => { view.mode = el.dataset.m; render(); },
  step: (el) => {
    const n = el.dataset.n, d = parse(view.anchor);
    if (n === '0') view.anchor = today();
    else if (n.endsWith('m')) view.anchor = fmt(new Date(d.getFullYear(), d.getMonth() + (n[0] === '-' ? -1 : 1), 1));
    else view.anchor = addDays(view.anchor, n[0] === '-' ? -7 : 7);
    render();
  },
  cell: (el) => { if (!el.dataset.emp) return; entryModal({ emp: el.dataset.emp, date: el.dataset.date }); },
  chip: (el) => entryModal({ id: +el.dataset.id }),
  abs: (el) => absenceModal(+el.dataset.emp, el.dataset.date),
  newentry: () => entryModal({ emp: String(emps()[0]?.id || 'x'), date: today() }),
  absence: () => absenceModal(emps()[0]?.id, today()),
  'emp-add': async () => {
    const name = $('#newname').value.trim(); if (!name) throw new Error('Bitte einen Namen eingeben.');
    await api('POST', '/api/employees', { name, is_boss: $('#newboss').checked, sort: Math.max(-1, ...S.employees.map((e) => e.sort)) + 1 }); await load();
  },
  'emp-active': async (el) => { await api('PUT', `/api/employees/${el.dataset.id}`, { active: el.checked }); await load(); },
  'emp-move': async (el) => {
    const l = allEmps(), i = l.findIndex((e) => e.id === +el.dataset.id), j = i + +el.dataset.d;
    if (j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
    for (let k = 0; k < l.length; k++) if (l[k].sort !== k) await api('PUT', `/api/employees/${l[k].id}`, { sort: k });
    await load();
  },
  'emp-edit': (el) => {
    const e = empOf(+el.dataset.id);
    modal({ title: 'Mitarbeiter bearbeiten', body: `<label>Name<input name="name" required value="${esc(e.name)}"></label><label>Informationen (Telefon, Qualifikation …)<textarea name="info" rows="3">${esc(e.info)}</textarea></label>
      <label class="inl"><input type="checkbox" name="boss" ${e.is_boss ? 'checked' : ''}> Chefzeile</label><label class="inl"><input type="checkbox" name="active" ${e.active ? 'checked' : ''}> Aktiv (im Kalender sichtbar)</label>`,
    onSubmit: async (f) => { const d = new FormData(f); await api('PUT', `/api/employees/${e.id}`, { name: d.get('name').trim(), info: d.get('info'), is_boss: !!d.get('boss'), active: !!d.get('active') }); await load(); } });
  },
  'emp-del': async (el) => {
    if (!(await askDelete('Mitarbeiter wirklich löschen? Er wird ausgeblendet, alle bisherigen Einträge bleiben erhalten.'))) return;
    await api('PUT', `/api/employees/${el.dataset.id}`, { deleted: true, active: false }); await load();
  },
  'emp-restore': async (el) => { await api('PUT', `/api/employees/${el.dataset.id}`, { deleted: false, active: true }); await load(); },
  'site-new': () => siteModal(null),
  'site-open': (el) => siteModal(+el.dataset.id),
  'site-react': async (el) => { await api('PUT', `/api/sites/${el.dataset.id}`, { status: 'geplant' }); await load(); toast('Baustelle wieder aktiviert.'); },
  'pdf-site': (el) => pdfFor(+el.dataset.id),
  'pdf-entry': (el) => pdfFor(+el.dataset.site, +el.dataset.id),
  'note-add': async () => {
    const text = $('#nt').value.trim(); if (!text) throw new Error('Bitte eine Notiz eingeben.');
    if (!$('#nd').value) throw new Error('Bitte ein Datum wählen.');
    await api('POST', '/api/notes', { date: $('#nd').value, text }); await load();
  },
  'note-filter': (el) => { noteFilter = el.dataset.f; render(); },
  'note-done': async (el) => { await api('PUT', `/api/notes/${el.dataset.id}`, { done: el.checked }); await load(); },
  'note-del': async (el) => { if (await askDelete('Notiz löschen?')) { await api('DELETE', `/api/notes/${el.dataset.id}`); await load(); } },
  'note-edit': (el) => {
    const n = S.notes.find((x) => x.id === +el.dataset.id);
    modal({ title: 'Notiz bearbeiten', body: `<label>Datum<input type="date" name="date" required value="${n.date}"></label><label>Notiz<textarea name="text" rows="3" required>${esc(n.text)}</textarea></label>`,
      onSubmit: async (f) => { const d = new FormData(f); await api('PUT', `/api/notes/${n.id}`, { date: d.get('date'), text: d.get('text').trim() }); await load(); } });
  },
  'colors-reset': async () => { if (await askDelete('Alle Farben auf die Grundeinstellungen zurücksetzen?', 'Zurücksetzen')) { await api('DELETE', '/api/settings'); await load(); } },
  'hol-gen': async () => {
    const y = +$('#hy').value; holYear = y;
    const have = new Set(S.holidays.map((h) => h.date));
    for (const [date, name] of germanHolidays(y)) if (!have.has(date)) await api('POST', '/api/holidays', { date, name });
    await load(); toast(`Feiertage ${y} eingetragen.`);
  },
  'hol-add': async () => {
    if (!$('#hd').value || !$('#hn').value.trim()) throw new Error('Bitte Datum und Bezeichnung eingeben.');
    holYear = +$('#hd').value.slice(0, 4);
    await api('POST', '/api/holidays', { date: $('#hd').value, name: $('#hn').value.trim() }); await load();
  },
  'hol-del': async (el) => { await api('DELETE', `/api/holidays/${el.dataset.id}`); await load(); },
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el && actions[el.dataset.act]) run(() => actions[el.dataset.act](el, e));
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.chg === 'color') run(async () => { await api('PUT', '/api/settings', { [el.dataset.key]: el.value }); await load(); });
  if (el.id === 'af') { archive.f = el.value; render(); }
  if (el.id === 'hy') { holYear = +el.value || holYear; render(); }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'aq') { archive.q = e.target.value; const pos = e.target.selectionStart; render(); const q = $('#aq'); q.focus(); q.setSelectionRange(pos, pos); }
});
document.addEventListener('dblclick', (e) => {
  const c = e.target.closest('.chip'); if (!c) return;
  const en = S.entries.find((x) => x.id === +c.dataset.id);
  if (en?.site_id) { closeModal(); siteModal(en.site_id); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

// ---- Drag & Drop ----
document.addEventListener('dragstart', (e) => {
  const c = e.target.closest?.('.chip'); if (!c) return;
  dragId = +c.dataset.id; e.dataTransfer.setData('text/plain', String(dragId)); e.dataTransfer.effectAllowed = 'move';
});
document.addEventListener('dragover', (e) => { const td = e.target.closest?.('td[data-date]'); if (td && dragId) { e.preventDefault(); td.classList.add('over'); } });
document.addEventListener('dragleave', (e) => e.target.closest?.('td[data-date]')?.classList.remove('over'));
document.addEventListener('dragend', () => { dragId = null; document.querySelectorAll('.over').forEach((x) => x.classList.remove('over')); });
document.addEventListener('drop', (e) => {
  const td = e.target.closest?.('td[data-date]'); if (!td || !dragId) return;
  e.preventDefault(); td.classList.remove('over');
  const id = dragId; dragId = null;
  run(async () => {
    const en = S.entries.find((x) => x.id === id); if (!en) return;
    const toExtras = td.dataset.emp === 'x';
    if ((en.row_type === 'extras') !== toExtras) throw new Error('EXTRAS-Einträge und Einsätze können nicht zwischen den Zeilen getauscht werden.');
    const empId = toExtras ? null : +td.dataset.emp;
    if (empId === en.employee_id && td.dataset.date === en.date) return;
    if (!toExtras) { const m = conflict(empId, td.dataset.date, id); if (m && !(await askConflict(m))) return; }
    await api('PUT', `/api/entries/${id}`, { employee_id: empId, date: td.dataset.date }); await load();
  });
});

// ================= Eintrag-Dialog =================
function entryModal(o) {
  const ent = o.id ? S.entries.find((e) => e.id === o.id) : null;
  if (o.id && !ent) return;
  const extras = ent ? ent.row_type === 'extras' : o.emp === 'x';
  const emp = ent ? ent.employee_id : extras ? null : +o.emp, date = ent ? ent.date : o.date;
  const sites = [...S.sites].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const empOpts = [...emps(), ...(emp && !emps().some((e) => e.id === emp) && empOf(emp) ? [empOf(emp)] : [])];
  const body = `${extras ? '' : `<label>Mitarbeiter<select name="emp">${empOpts.map((e) => `<option value="${e.id}" ${e.id === emp ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select></label>`}
  <label>Datum<input type="date" name="date" required value="${date}"></label>
  ${extras ? '' : `<label>Baustelle<select name="site"><option value="">– keine / Freitext –</option><option value="new">+ Neue Baustelle anlegen …</option>${sites.map((s) => `<option value="${s.id}" ${ent?.site_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>`}
  <label>${extras ? 'Eintrag (z. B. Materialbestellung, Liefertermin)' : 'Freitext – oder Name der neuen Baustelle'}<input name="text" value="${esc(ent && !ent.site_id ? ent.text : '')}"></label>
  <label class="inl"><input type="checkbox" name="usecolor" ${ent?.color ? 'checked' : ''}> Eigene Hintergrundfarbe <input type="color" name="color" value="${ent?.color || col('c_entry')}"></label>
  ${!ent && !extras ? `<fieldset><legend>Weitere Mitarbeiter derselben Baustelle zuweisen</legend>${emps().map((e) => `<label class="inl" style="margin:2px 0"><input type="checkbox" name="more" value="${e.id}"> ${esc(e.name)}</label>`).join('')}</fieldset>` : ''}`;
  const foot = ent ? `<button type="button" class="btn dan" id="delentry">Löschen</button>${ent.site_id ? `<button type="button" class="btn" data-act="site-open" data-id="${ent.site_id}">Baustellendetails</button><button type="button" class="btn" data-act="pdf-entry" data-site="${ent.site_id}" data-id="${ent.id}">ARBEITSAUFTRAG HERUNTERLADEN</button>` : ''}` : '';
  const f = modal({ title: ent ? 'Eintrag bearbeiten' : 'Neuer Eintrag', body, foot, onSubmit: async (f) => {
    const d = new FormData(f), dt = d.get('date'), text = d.get('text').trim();
    let siteId = extras ? null : d.get('site') || null;
    if (extras && !text) throw new Error('Bitte einen Text eingeben.');
    if (!extras && !siteId && !text) throw new Error('Bitte eine Baustelle wählen oder einen Text eingeben.');
    if (siteId === 'new' && !text) throw new Error('Bitte den Namen der neuen Baustelle eingeben.');
    const ids = extras ? [null] : [...new Set([+d.get('emp'), ...d.getAll('more').map(Number)])];
    if (!extras) for (const id of ids) { const m = conflict(id, dt, ent?.id); if (m && !(await askConflict(`${m}${ids.length > 1 ? ' (' + empOf(id).name + ')' : ''}`))) return false; }
    if (siteId === 'new') siteId = (await api('POST', '/api/sites', { name: text, status: 'geplant', start_date: dt })).id; else siteId = siteId ? +siteId : null;
    const base = { date: dt, site_id: siteId, text: siteId ? '' : text, color: d.get('usecolor') ? d.get('color') : null, row_type: extras ? 'extras' : 'work' };
    if (ent) await api('PUT', `/api/entries/${ent.id}`, { ...base, employee_id: ids[0] });
    else for (const id of ids) await api('POST', '/api/entries', { ...base, employee_id: id });
    await load();
  } });
  const del = $('#delentry', f);
  if (del) del.onclick = () => run(async () => { if (await askDelete('Eintrag löschen?')) { await api('DELETE', `/api/entries/${ent.id}`); closeModal(); await load(); } });
}

// ================= Baustellen-Details =================
function siteModal(id) {
  const s = id ? siteOf(id) : { name: '', address: '', customer: '', contact: '', phone: '', description: '', notes: '', work_time: '', start_date: today(), status: 'geplant' };
  const assigned = id ? S.entries.filter((e) => e.site_id === id && e.employee_id).sort((a, b) => a.date.localeCompare(b.date)) : [];
  const inp = (n, l, t = 'text') => `<label>${l}<input type="${t}" name="${n}" value="${esc(s[n] || '')}"></label>`;
  modal({ title: id ? 'Baustelle – Details' : 'Neue Baustelle', submit: 'Speichern',
    foot: id ? `<button type="button" class="btn" data-act="pdf-site" data-id="${id}">ARBEITSAUFTRAG HERUNTERLADEN</button>` : '',
    body: `${inp('name', 'Name des Bauvorhabens')}${inp('address', 'Vollständige Baustellenadresse')}
    <div class="row2">${inp('customer', 'Kunde / Auftraggeber')}${inp('contact', 'Ansprechpartner')}${inp('phone', 'Telefonnummer', 'tel')}${inp('work_time', 'Arbeitszeit (z. B. 07:00–16:00)')}${inp('start_date', 'Einsatzdatum', 'date')}
    <label>Baustellenstatus<select name="status">${Object.entries(STATUS).map(([k, [l]]) => `<option value="${k}" ${s.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <label>Beschreibung der Arbeiten<textarea name="description" rows="3">${esc(s.description)}</textarea></label>
    <label>Besondere Hinweise<textarea name="notes" rows="2">${esc(s.notes)}</textarea></label>
    <fieldset><legend>Zugewiesene Mitarbeiter (Zuweisung im Kalender)</legend>${assigned.map((e) => `${esc(empOf(e.employee_id)?.name || '?')} – ${de(e.date)}`).join('<br>') || 'Noch keine Mitarbeiter zugewiesen.'}</fieldset>`,
    onSubmit: async (f) => {
      const d = Object.fromEntries(new FormData(f));
      if (!d.name.trim()) throw new Error('Bitte den Namen des Bauvorhabens eingeben.');
      d.name = d.name.trim(); d.start_date = d.start_date || null;
      if (id) await api('PUT', `/api/sites/${id}`, d); else await api('POST', '/api/sites', d);
      await load();
    } });
}

// ================= Urlaub / Krankheit =================
function absenceModal(empId, date) {
  const a = S.absences.find((x) => x.employee_id === empId && x.date === date);
  modal({ title: 'Urlaub / Krankheit', submit: 'Übernehmen',
    body: `<label>Mitarbeiter<select name="emp">${allEmps().map((e) => `<option value="${e.id}" ${e.id === empId ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select></label>
    <div class="row2"><label>Von<input type="date" name="from" required value="${date}"></label><label>Bis<input type="date" name="to" required value="${date}"></label></div>
    <label>Art<select name="type"><option value="vacation" ${a?.type !== 'sick' ? 'selected' : ''}>Urlaub</option><option value="sick" ${a?.type === 'sick' ? 'selected' : ''}>Krank</option><option value="clear">Eintrag entfernen</option></select></label>`,
    onSubmit: async (f) => {
      const d = Object.fromEntries(new FormData(f)), body = { employee_id: +d.emp, from: d.from, to: d.to };
      if (d.to < d.from) throw new Error('Das Enddatum liegt vor dem Startdatum.');
      if (d.type === 'clear') { await api('POST', '/api/absences/clear', body); await load(); return; }
      try { await api('POST', '/api/absences/range', { ...body, type: d.type }); }
      catch (e) {
        if (e.status !== 409) throw e;
        const txt = e.data.conflicts.map((c) => `${de(c.date)} (${c.type === 'vacation' ? 'Urlaub' : 'Krank'})`).join(', ');
        if (!(await ask(`Achtung! Im gewählten Zeitraum ist bereits etwas eingetragen: ${txt}. Überschreiben?`, [{ label: 'Abbrechen', value: false }, { label: 'Überschreiben', value: true, cls: 'pri' }]))) return false;
        await api('POST', '/api/absences/range', { ...body, type: d.type, overwrite: true });
      }
      await load();
    } });
}

// ================= PDF-Arbeitsauftrag =================
function pdfFor(siteId, entryId) {
  const s = siteOf(siteId); if (!s) throw new Error('Baustelle nicht gefunden.');
  if (!window.jspdf) throw new Error('PDF-Bibliothek nicht geladen (Internetverbindung / cdnjs erreichbar?).');
  let list = S.entries.filter((e) => e.site_id === siteId && e.employee_id && (!entryId || e.id === entryId)).sort((a, b) => a.date.localeCompare(b.date));
  list = list.map((e) => ({ emp: empOf(e.employee_id)?.name || '', date: e.date }));
  if (!list.length) list = [{ emp: '', date: s.start_date || '' }];
  const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
  list.forEach((it, i) => { if (i) doc.addPage(); pdfPage(doc, s, it); });
  doc.save(`Arbeitsauftrag_${s.name.replace(/[^\wäöüÄÖÜß-]+/g, '_')}.pdf`);
}
function pdfPage(doc, s, it) {
  const W = 210, M = 18, LW = 48; let y = 42;
  doc.setFillColor(33, 37, 41); doc.rect(0, 0, W, 28, 'F');
  doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.text('ARBEITSAUFTRAG', M, 18);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.text('Erstellt am ' + new Date().toLocaleDateString('de-DE'), W - M, 18, { align: 'right' });
  doc.setTextColor(33);
  const dateTxt = it.date ? parse(it.date).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
  const row = (label, val, min = 8) => {
    const lines = doc.splitTextToSize(String(val || '–'), W - 2 * M - LW), h = Math.max(min, lines.length * 5.5 + 3);
    if (y + h > 275) { doc.addPage(); y = 20; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(110); doc.text(label.toUpperCase(), M, y + 4);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(33); doc.text(lines, M + LW, y + 4);
    doc.setDrawColor(222); doc.line(M, y + h, W - M, y + h); y += h + 2;
  };
  row('Mitarbeiter', it.emp); row('Bauvorhaben', s.name); row('Baustellenadresse', s.address); row('Kunde', s.customer);
  row('Ansprechpartner', s.contact); row('Telefon', s.phone); row('Datum', dateTxt); row('Arbeitszeit', s.work_time);
  row('Arbeitsbeschreibung', s.description, 40); row('Besondere Hinweise', s.notes, 25);
  if (y > 250) { doc.addPage(); y = 20; }
  y = Math.max(y + 12, 255);
  doc.setDrawColor(100); doc.line(M, y, M + 70, y); doc.line(W - M - 70, y, W - M, y);
  doc.setFontSize(9); doc.setTextColor(110); doc.text('Unterschrift Mitarbeiter', M, y + 5); doc.text('Unterschrift Kunde / Bauleitung', W - M - 70, y + 5);
}

// ================= Start & Synchronisierung =================
run(() => load());
setInterval(() => {
  if (document.hidden || !$('#modal').hidden || !$('#confirm').hidden || dragId) return;
  load(true).catch(() => {});
}, 15000);
