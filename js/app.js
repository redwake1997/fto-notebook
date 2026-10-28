// FTO Notebook: the app. Everything stays in this browser on this device.
//   fton.guide  the FTO's evaluation guide (kept until replaced)
//   fton.shift  the current shift's notes (deleted on End shift, or 24 h after the shift started)
//   fton.theme  auto | light | dark
//   fton.recent recently used objective IDs (no note text)
(function () {
'use strict';

const T = window.FTOText;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const KEYS = { guide: 'fton.guide', shift: 'fton.shift', theme: 'fton.theme', recent: 'fton.recent' };
const LEVEL_NAME = { 7: 'Exceeds standard', 4: 'Meets standard', 1: 'Below standard' };
const LEVEL_SHORT = { 7: 'Exceeds', 4: 'Meets', 1: 'Below' };

// ---------- small helpers ----------
const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return e;
}
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

const store = {
  ok: true,
  get(key) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
  set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { store.ok = false; showStorageWarning(); return false; } },
  del(key) { try { localStorage.removeItem(key); } catch (e) { /* nothing to do */ } },
};
function showStorageWarning() { $('#storage-warning').hidden = false; }
try { localStorage.setItem('fton.test', '1'); localStorage.removeItem('fton.test'); } catch (e) { store.ok = false; showStorageWarning(); }

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = el('textarea', { style: 'position:fixed;opacity:0;top:0;left:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (err) { /* ignore */ }
    ta.remove();
  }
  toast('Copied');
}

function grow(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 2 + 'px';
}

// ---------- theme ----------
function applyTheme() {
  const t = store.get(KEYS.theme) || 'auto';
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  for (const box of $$('.theme-control')) {
    box.replaceChildren(...['auto', 'light', 'dark'].map(v => el('button', {
      class: v === t ? 'on' : '',
      'aria-pressed': String(v === t),
      onclick: () => { store.set(KEYS.theme, v); applyTheme(); },
    }, v === 'auto' ? 'Auto' : v === 'light' ? 'Light' : 'Dark')));
  }
}

// ---------- guide ----------
let guide = null;
let S = null; // scorer
let N = null; // narrator

function useGuide(g) {
  guide = g;
  S = window.FTOScoring.createScorer(g);
  N = window.FTONarrative.createNarrator(S);
  const count = g.categories.reduce((n, c) => n + c.objectives.length, 0);
  const info = `${g.categories.length} categories · ${count} objectives · stays on this device`;
  $('#start-guide-info').textContent = info;
  $('#shift-guide-info').textContent = info;
}

function loadSavedGuide() {
  const g = store.get(KEYS.guide);
  if (g && !window.FTOScoring.validateGuide(g).length) { useGuide(g); return true; }
  return false;
}

async function importGuide(file, errorEl) {
  const fail = msg => {
    if (errorEl) { errorEl.textContent = msg; errorEl.hidden = false; }
    else alert(msg);
  };
  if (!file) return;
  let g;
  try { g = JSON.parse(await file.text()); } catch (e) { fail("That file couldn't be read. Choose your FTO Notebook guide file (.json)."); return; }
  const problems = window.FTOScoring.validateGuide(g);
  if (problems.length) { fail(problems[0]); return; }
  if (shift && guide && !confirm('Replace the guide during a shift? Objectives that are not in the new guide will stop counting.')) return;
  if (!store.set(KEYS.guide, g)) { fail("This browser couldn't save the guide."); return; }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if (errorEl) errorEl.hidden = true;
  useGuide(g);
  toast('Guide loaded');
  route();
}

$('#guide-file').addEventListener('change', e => importGuide(e.target.files[0], $('#guide-error')));
for (const input of $$('.guide-replace')) input.addEventListener('change', e => { importGuide(e.target.files[0]); e.target.value = ''; });

// ---------- shift lifecycle ----------
let shift = null;
let saveTimer = null;
function save(now) {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (now) store.set(KEYS.shift, shift);
  else saveTimer = setTimeout(() => { saveTimer = null; store.set(KEYS.shift, shift); }, 150);
}
// Never lose the last keystrokes: save right away when the app is closed or sent to the background.
function flush() { if (shift && saveTimer) save(true); }
window.addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

function newShift() {
  return {
    v: 1, startedAt: Date.now(), calls: ['general'], activeCall: 'general', notes: [],
    overrides: {}, narrOn: {}, narr: {}, confirmedNO: {}, training: null, view: 'notes',
  };
}
const expired = s => !s || !s.startedAt || Date.now() - s.startedAt > MAX_AGE_MS;

function wipeShift(reason) {
  clearTimeout(saveTimer);
  saveTimer = null;
  shift = null;
  store.del(KEYS.shift);
  $('#wiped-banner').hidden = reason !== 'expired';
  $('#ended-banner').hidden = reason !== 'ended' && reason !== 'moved';
  if (reason === 'moved') $('#ended-banner').textContent = 'Shift moved to the other device and deleted from this one.';
  else $('#ended-banner').textContent = 'Shift ended. All notes were deleted from this device.';
  route();
}

function checkExpiry() {
  if (shift && expired(shift)) wipeShift('expired');
}
setInterval(checkExpiry, 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkExpiry(); });

$('#start-btn').addEventListener('click', () => {
  shift = newShift();
  save(true);
  $('#wiped-banner').hidden = true;
  $('#ended-banner').hidden = true;
  route();
});
$('#end-btn').addEventListener('click', () => {
  if (!confirm('End the shift and permanently delete all notes from this device?\n\nOnly do this after the DOR is completed in ESO.')) return;
  wipeShift('ended');
});

// ---------- routing ----------
function route() {
  const screens = { guide: $('#screen-guide'), start: $('#screen-start'), shift: $('#screen-shift') };
  const which = !guide ? 'guide' : !shift ? 'start' : 'shift';
  for (const [k, node] of Object.entries(screens)) node.hidden = k !== which;
  applyTheme();
  if (which === 'shift') setView(shift.view || 'notes');
}

for (const t of $$('.tab')) t.addEventListener('click', () => setView(t.dataset.view));
function setView(view) {
  shift.view = view;
  save();
  for (const t of $$('.tab')) {
    t.classList.toggle('active', t.dataset.view === view);
    if (t.dataset.view === view) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  }
  $('#view-notes').hidden = view !== 'notes';
  $('#view-review').hidden = view !== 'review';
  $('#view-shift').hidden = view !== 'shift';
  renderHeader();
  if (view === 'notes') renderNotes();
  if (view === 'review') renderReview();
  if (view === 'shift') renderShiftView();
  window.scrollTo(0, 0);
}

function fmtTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function hoursLeft() {
  return Math.max(0, Math.ceil((shift.startedAt + MAX_AGE_MS - Date.now()) / 3600000));
}
function renderHeader() {
  $('#shift-sub').textContent = `Orientee · started ${fmtTime(shift.startedAt)} · clears in ${hoursLeft()} h`;
}

// ---------- notes view ----------
const callTitle = id => (id === 'general' ? 'General' : `Call ${id}`);

function renderCalls() {
  $('#calls').replaceChildren(
    ...shift.calls.map(id => el('button', {
      class: 'chip' + (id === shift.activeCall ? ' active' : ''),
      'aria-pressed': String(id === shift.activeCall),
      title: id === 'general' ? 'Notes not tied to a call: arrival, uniform, truck check, station, debrief' : null,
      onclick: () => { shift.activeCall = id; save(); renderNotes(); },
    }, callTitle(id))),
    el('button', { class: 'chip add', onclick: newCall }, '+ New call'),
  );
}

function newCall() {
  const nums = shift.calls.filter(c => c !== 'general').map(Number);
  const next = String((nums.length ? Math.max(...nums) : 0) + 1);
  shift.calls.push(next);
  shift.activeCall = next;
  save();
  renderNotes();
  $('#note-text').focus();
}

function updateComposer() {
  const text = $('#note-text').value.trim();
  const taught = $('#note-teaching').checked;
  $('#note-label').textContent = `Note for ${callTitle(shift.activeCall)}`;
  $('#btn-objectives').hidden = taught;
  $('#btn-objectives').disabled = !!text;
  $('#btn-objectives').title = text ? 'You have a note typed. Use Note + Objectives to save it with objectives.' : '';
  $('#btn-note').textContent = taught ? 'Save training note' : 'Note + Objectives';
  $('#btn-note').disabled = !text;
}

let flagTimer = null;
$('#note-text').addEventListener('input', () => {
  updateComposer();
  clearTimeout(flagTimer);
  flagTimer = setTimeout(() => renderFlagList($('#note-flags'), T.findFlags($('#note-text').value)), 350);
});
$('#note-teaching').addEventListener('change', updateComposer);
$('#note-text').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !$('#btn-note').disabled) $('#btn-note').click();
});

function renderFlagList(box, flags, onDismiss) {
  box.replaceChildren(...flags.map(f => el('div', { class: 'flag' },
    el('span', {}, el('strong', {}, `Possibly subjective: "${f.found}". `), `${f.reason} ${T.SUGGESTION}`),
    onDismiss ? el('button', { class: 'btn link', onclick: () => onDismiss(f.term) }, 'Dismiss') : null,
  )));
}

$('#btn-objectives').addEventListener('click', () => {
  const n = makeNote('', false);
  openPicker(n.id);
});
$('#btn-note').addEventListener('click', () => {
  const text = $('#note-text').value.trim();
  if (!text) return;
  const taught = $('#note-teaching').checked;
  const n = makeNote(text, taught);
  $('#note-text').value = '';
  $('#note-teaching').checked = false;
  $('#note-flags').replaceChildren();
  updateComposer();
  if (taught) { renderNotes(); toast('Training note saved'); }
  else openPicker(n.id);
});

function makeNote(text, teaching) {
  const n = { id: uid(), callId: shift.activeCall, text, teaching, objectiveIds: [], observedCategories: [], dismissedFlags: [], at: Date.now() };
  shift.notes.push(n);
  save();
  renderNotes();
  return n;
}

function tagEl(oid, extraClass = '') {
  const o = S.getObjective(oid);
  if (!o) return null;
  return el('span', { class: `tag l${o.level} ${extraClass}`, title: `${S.category(o.categoryId).name}: ${o.text}` },
    `${o.categoryId} · ${LEVEL_SHORT[o.level]} · ${o.text}`);
}
function observedEl(cid) {
  const c = S.category(cid);
  return el('span', { class: 'tag obs' }, `${cid} · ${c ? c.name : ''} · Observed – meets standard`);
}

function renderNotes() {
  renderCalls();
  updateComposer();
  const groups = shift.calls.slice().reverse().map(callId => {
    const notes = shift.notes.filter(n => n.callId === callId).slice().reverse();
    if (!notes.length && callId !== shift.activeCall) return null;
    return el('div', { class: 'group' },
      el('div', { class: 'group-head' + (callId === shift.activeCall ? ' active' : '') }, callTitle(callId)),
      notes.length ? notes.map(noteCard) : el('p', { class: 'empty-call' }, 'No notes yet.'),
    );
  });
  $('#notes').replaceChildren(...groups.filter(Boolean));
}

function belowWithoutNote(n) {
  return !(n.text || '').trim() && n.objectiveIds.some(id => { const o = S.getObjective(id); return o && o.level === 1; });
}

function noteCard(n) {
  const card = el('div', { class: 'card note' });
  const flags = el('div', {});
  renderFlagList(flags, T.findFlags(n.text, n.dismissedFlags || []), term => {
    n.dismissedFlags = [...(n.dismissedFlags || []), term];
    save(); renderNotes();
  });
  const tags = el('div', { class: 'tags' }, n.objectiveIds.map(id => tagEl(id)), n.observedCategories.map(observedEl));
  const nothingTagged = !n.objectiveIds.length && !n.observedCategories.length;
  const parts = [
    (n.text || '').trim() ? el('div', { class: 'note-text' }, n.text) : el('div', { class: 'note-empty' }, 'Objectives only, no note'),
    flags.childNodes.length ? flags : null,
    belowWithoutNote(n) ? el('div', { class: 'nudge' },
      el('span', {}, 'Below-standard objective with no note. Add the specifics, since this narrative is required.'),
      el('button', { class: 'btn link', onclick: () => editNote(card, n) }, 'Add note')) : null,
    n.teaching ? el('span', { class: 'badge' }, 'Taught') : null,
    tags.childNodes.length ? tags : null,
    !n.teaching && nothingTagged ? el('div', { class: 'nudge' }, el('span', {}, 'No objectives selected yet.'),
      el('button', { class: 'btn link', onclick: () => openPicker(n.id) }, 'Select')) : null,
    el('div', { class: 'note-actions' },
      el('button', { class: 'btn link', onclick: () => openPicker(n.id) }, 'Objectives'),
      el('button', { class: 'btn link', onclick: () => editNote(card, n) }, (n.text || '').trim() ? 'Edit' : 'Add note'),
      el('button', { class: 'btn link', onclick: () => { n.teaching = !n.teaching; save(); renderNotes(); } }, n.teaching ? 'Not taught' : 'Taught'),
      el('button', { class: 'btn link', onclick: () => {
        if (!confirm('Delete this note?')) return;
        shift.notes = shift.notes.filter(x => x.id !== n.id); save(); renderNotes();
      } }, 'Delete'),
    ),
  ];
  card.append(...parts.filter(Boolean));
  return card;
}

function editNote(card, n) {
  const ta = el('textarea', { rows: 3, spellcheck: 'true', autocapitalize: 'sentences', 'aria-label': 'Edit note' });
  ta.value = n.text || '';
  const flags = el('div', {});
  ta.addEventListener('input', () => renderFlagList(flags, T.findFlags(ta.value, n.dismissedFlags || [])));
  card.replaceChildren(ta, flags, el('div', { class: 'btn-row end' },
    el('button', { class: 'btn', onclick: () => renderNotes() }, 'Cancel'),
    el('button', { class: 'btn primary', onclick: () => { n.text = ta.value.trim(); save(); renderNotes(); } }, 'Save'),
  ));
  ta.focus();
}

// ---------- objectives picker ----------
let pickingId = null;
const picker = $('#picker');

function openPicker(noteId) {
  pickingId = noteId;
  const n = shift.notes.find(x => x.id === noteId);
  $('#picker-title').textContent = `Select Objectives · ${callTitle(n.callId)}`;
  $('#picker-note').textContent = (n.text || '').trim() || 'Objectives only, no note';
  $('#picker-search').value = '';
  renderPicker();
  picker.showModal();
  $('#picker-list').scrollTop = 0;
}

function finishPicking() {
  if (pickingId == null) return;
  const n = shift && shift.notes.find(x => x.id === pickingId);
  // An empty "Objectives" entry with nothing selected is discarded.
  if (n && !(n.text || '').trim() && !n.objectiveIds.length && !n.observedCategories.length) {
    shift.notes = shift.notes.filter(x => x.id !== n.id);
  }
  pickingId = null;
  save();
  if (shift && !$('#view-notes').hidden) renderNotes();
  if (shift && !$('#view-review').hidden) renderReview();
}
function closePicker() {
  finishPicking();
  if (picker.open) picker.close();
}
$('#picker-done').addEventListener('click', closePicker);
picker.addEventListener('close', finishPicking); // Escape key or system back
// Tap outside the sheet closes it (taps on the sheet's own padding or gaps do not).
picker.addEventListener('click', e => {
  if (e.target !== picker) return;
  const b = picker.getBoundingClientRect();
  if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) closePicker();
});
$('#picker-search').addEventListener('input', renderPicker);

function rememberRecent(oid) {
  const r = (store.get(KEYS.recent) || []).filter(x => x !== oid && S.getObjective(x));
  r.unshift(oid);
  store.set(KEYS.recent, r.slice(0, 8));
}

function toggleList(arr, value, on) {
  const i = arr.indexOf(value);
  if (on && i < 0) arr.push(value);
  if (!on && i >= 0) arr.splice(i, 1);
}

function setObjective(n, oid, on) {
  toggleList(n.objectiveIds, oid, on);
  if (on) rememberRecent(oid);
  save();
  renderPicker();
}

function shortText(t, words = 6) {
  const w = t.split(/\s+/);
  return w.length > words ? w.slice(0, words).join(' ') + '…' : t;
}

function renderPicker() {
  const n = shift.notes.find(x => x.id === pickingId);
  if (!n) return;
  const q = $('#picker-search').value.toLowerCase().split(/\s+/).filter(Boolean);
  const searching = q.length > 0;
  const match = s => q.every(w => s.toLowerCase().includes(w));

  // Recently used
  const recent = (store.get(KEYS.recent) || []).map(id => S.getObjective(id)).filter(Boolean);
  $('#picker-recent').replaceChildren(...(recent.length && !searching ? [
    el('span', { class: 'label' }, 'Recently used'),
    el('div', { class: 'recent-row' }, recent.map(o => {
      const on = n.objectiveIds.includes(o.id);
      return el('button', {
        class: `recent-chip l${o.level}${on ? ' on' : ''}`, 'aria-pressed': String(on), title: o.text,
        onclick: () => setObjective(n, o.id, !on),
      }, `${on ? '✓ ' : ''}${o.categoryId} · ${shortText(o.text)}`);
    })),
  ] : []));

  const cats = guide.categories.map(cat => {
    const hits = cat.objectives.filter(o => !searching || match(o.text) || match(cat.name));
    if (searching && !hits.length) return null;
    const picked = cat.objectives.filter(o => n.objectiveIds.includes(o.id)).length + (n.observedCategories.includes(cat.id) ? 1 : 0);
    const meetsStd = n.observedCategories.includes(cat.id);
    const body = el('div', { class: 'cat-body' },
      el('label', { class: 'obj meets-std' + (meetsStd ? ' on' : '') },
        el('input', { type: 'checkbox', checked: meetsStd, onchange: e => { toggleList(n.observedCategories, cat.id, e.target.checked); save(); renderPicker(); } }),
        el('span', {}, 'Observed – meets standard')),
      [7, 4, 1].map(level => {
        const items = hits.filter(o => o.level === level);
        if (!items.length) return null;
        return el('div', {},
          el('div', { class: `lvl-head l${level}` }, `${level} · ${LEVEL_NAME[level]}`),
          items.map(o => {
            const on = n.objectiveIds.includes(o.id);
            return el('label', { class: 'obj' + (on ? ' on' : '') },
              el('input', { type: 'checkbox', checked: on, onchange: e => setObjective(n, o.id, e.target.checked) }),
              el('span', {}, o.text));
          }));
      }),
    );
    return el('details', { class: 'cat', open: searching || picked > 0 },
      el('summary', {}, el('span', {}, `${cat.id}) ${cat.name}`), picked ? el('span', { class: 'count' }, `${picked} selected`) : null),
      body);
  }).filter(Boolean);

  const list = $('#picker-list');
  const keep = list.scrollTop;
  list.replaceChildren(...cats);
  if (!cats.length) list.append(el('p', { class: 'picker-hint' }, 'Nothing in the guide matches that search.'));
  else if (searching) list.append(el('p', { class: 'picker-hint' }, 'Showing only categories with a matching objective. Clear the search to see all.'));
  list.scrollTop = keep;
}

// ---------- review ----------
const results = () => S.scoreShift(shift.notes, shift.overrides);

function narrativeOn(r) {
  if (typeof r.score !== 'number') return false;
  if (r.narrativeRequired) return true;
  return hasOwn(shift.narrOn, r.categoryId) ? shift.narrOn[r.categoryId] : r.narrativeDefaultOn;
}
const narrativeText = r => (shift.narr[r.categoryId] ? shift.narr[r.categoryId].text : N.draftNarrative(r, shift.notes));
const trainingText = () => (shift.training ? shift.training.text : N.draftTraining(shift.notes));

function badge(score) {
  if (typeof score !== 'number') return el('div', { class: 'score-badge no' }, el('b', {}, 'Not Observed'));
  const kind = score < S.MEETS ? 'below' : score === S.MEETS ? 'meets' : 'exceeds';
  const word = score < S.MEETS ? 'Below' : score === S.MEETS ? 'Meets' : 'Exceeds';
  return el('div', { class: `score-badge ${kind}`, 'aria-label': `Score ${score}, ${word}` }, el('b', {}, String(score)), el('span', {}, word));
}

function cardProblem(r) {
  if (r.score === S.NOT_OBSERVED) return !shift.confirmedNO[r.categoryId];
  return r.narrativeRequired && !narrativeText(r).trim();
}

function renderReview() {
  const res = results();
  const below = res.filter(r => typeof r.score === 'number' && r.score < S.MEETS).length;
  const toConfirm = res.filter(r => r.score === S.NOT_OBSERVED && !shift.confirmedNO[r.categoryId]).length;
  const untagged = shift.notes.filter(n => !n.teaching && !n.objectiveIds.length && !n.observedCategories.length).length;
  $('#review-summary').replaceChildren(...[
    below ? el('span', { class: 'pill bad' }, `${below} below standard`) : null,
    toConfirm ? el('span', { class: 'pill' }, `${toConfirm} to confirm as Not Observed`) : null,
    untagged ? el('span', { class: 'pill bad' }, `${untagged} ${untagged === 1 ? 'note has' : 'notes have'} no objectives`) : null,
    !below && !toConfirm && !untagged ? el('span', { class: 'pill' }, 'Everything is ready to copy') : null,
  ].filter(Boolean));

  // Category list (laptop)
  const index = [];
  let sec = null;
  for (const r of res) {
    if (r.section !== sec) { sec = r.section; if (sec) index.push(el('div', { class: 'index-section' }, sec)); }
    const small = typeof r.score === 'number' ? String(r.score) : 'N/O';
    index.push(el('button', {
      class: 'index-item' + (cardProblem(r) ? ' problem' : ''),
      onclick: () => document.getElementById(`cat-${r.categoryId}`).scrollIntoView({ behavior: 'smooth', block: 'start' }),
    }, el('span', { class: 'index-name' }, r.label), el('span', { class: 'tag ' + (typeof r.score !== 'number' ? 'obs' : r.score < S.MEETS ? 'l1' : r.score === S.MEETS ? 'l4' : 'l7') }, small)));
  }
  $('#review-index').replaceChildren(...index);

  // Cards
  const out = [];
  sec = null;
  for (const r of res) {
    if (r.section !== sec) { sec = r.section; if (sec) out.push(el('div', { class: 'section-head' }, sec)); }
    out.push(reviewCard(r));
  }
  $('#review').replaceChildren(...out);

  const ta = $('#training-text');
  if (document.activeElement !== ta) ta.value = trainingText();
  requestAnimationFrame(() => grow(ta));
  renderNarrFlags($('#training-flags'), T.findFlags(ta.value));
}

function renderNarrFlags(box, flags) {
  if (!box) return;
  if (!flags.length) {
    box.className = 'flags-line ok';
    box.textContent = '✓ No subjective wording found';
  } else {
    box.className = 'flags-line warn';
    box.textContent = `Possibly subjective: ${flags.map(f => `"${f.found}"`).join(', ')}. ${T.SUGGESTION}`;
  }
}

function reviewCard(r) {
  const card = el('section', { class: 'card rcard' + (cardProblem(r) ? ' problem' : ''), id: `cat-${r.categoryId}`, 'aria-label': r.label });

  let sub;
  if (r.overridden) {
    sub = el('span', { class: 'muted small' }, `You set this score. Auto score: ${r.computedScore}. `,
      el('button', { class: 'btn link', onclick: () => { delete shift.overrides[r.categoryId]; save(); renderReview(); } }, 'Reset'));
  } else if (r.score === S.NOT_OBSERVED) {
    sub = el('span', { class: 'muted small' }, 'Nothing recorded this shift');
  } else {
    sub = el('span', { class: 'muted small' }, `Lowest: ${r.settingCalls.map(callTitle).join(', ')}${r.narrativeRequired ? ' · narrative required' : ''}`);
  }
  card.append(el('div', { class: 'rhead' }, el('div', { class: 'rtitle' }, el('strong', {}, r.label), sub), badge(r.score)));

  // Change score
  const sel = el('select', { 'aria-label': `Change score for ${r.label}` },
    [S.NOT_OBSERVED, 1, 2, 3, 4, 5, 6, 7].map(v => el('option', { value: String(v), selected: String(v) === String(r.score) }, String(v))));
  sel.addEventListener('change', () => {
    const v = sel.value === S.NOT_OBSERVED ? S.NOT_OBSERVED : Number(sel.value);
    if (String(v) === String(r.computedScore)) delete shift.overrides[r.categoryId];
    else shift.overrides[r.categoryId] = v;
    save(); renderReview();
  });
  card.append(el('label', { class: 'score-row' }, 'Change score', sel));

  // What's behind the score
  if (r.callScores.length) {
    const ul = el('ul', { class: 'obs-list' });
    for (const c of r.callScores) {
      for (const nid of c.noteIds) {
        const n = shift.notes.find(x => x.id === nid);
        if (!n) continue;
        const here = n.objectiveIds.filter(id => { const o = S.getObjective(id); return o && o.categoryId === r.categoryId; });
        ul.append(el('li', { class: r.settingCalls.includes(c.callId) ? 'setting' : '' },
          el('div', { class: 'obs-head' },
            el('strong', {}, `${callTitle(c.callId)} (${c.score})`),
            el('button', { class: 'btn link', onclick: () => {
              n.objectiveIds = n.objectiveIds.filter(id => !here.includes(id));
              n.observedCategories = n.observedCategories.filter(x => x !== r.categoryId);
              save(); renderReview();
            } }, "Doesn't count here")),
          (n.text || '').trim() ? el('span', {}, n.text) : el('span', { class: 'note-empty' }, 'Objectives only, no note'),
          el('div', { class: 'tags' }, here.map(id => tagEl(id)), n.observedCategories.includes(r.categoryId) ? observedEl(r.categoryId) : null),
        ));
      }
    }
    card.append(ul);
  }

  // Not Observed
  if (r.score === S.NOT_OBSERVED) {
    card.append(el('label', { class: 'check' },
      el('input', { type: 'checkbox', checked: !!shift.confirmedNO[r.categoryId], onchange: e => { shift.confirmedNO[r.categoryId] = e.target.checked; save(); renderReview(); } }),
      'Confirm: not observed this shift'));
    return card;
  }

  // Narrative
  const on = narrativeOn(r);
  if (r.narrativeRequired) {
    card.append(el('div', { class: 'narr-head' }, el('strong', {}, 'Narrative'), el('span', { class: 'req' }, 'Required, score below 4')));
  } else {
    card.append(el('label', { class: 'check' },
      el('input', { type: 'checkbox', checked: on, onchange: e => { shift.narrOn[r.categoryId] = e.target.checked; save(); renderReview(); } }),
      r.score === S.MEETS ? 'Add a narrative (optional at 4)' : 'Include narrative'));
  }
  if (!on) return card;

  const settingHasText = r.callScores.filter(c => r.settingCalls.includes(c.callId))
    .some(c => c.noteIds.some(id => { const n = shift.notes.find(x => x.id === id); return n && (n.text || '').trim(); }));
  if (r.narrativeRequired && !settingHasText) {
    card.append(el('div', { class: 'nudge' }, el('span', {}, 'There is no written note for the call that set this score. Add the specifics to the narrative.')));
  }

  const ta = el('textarea', { rows: 3, spellcheck: 'true', autocapitalize: 'sentences', 'aria-label': `Narrative for ${r.label}` });
  ta.value = narrativeText(r);
  const flags = el('div', {});
  ta.addEventListener('input', () => {
    shift.narr[r.categoryId] = { text: ta.value, basis: N.draftBasis(r, shift.notes) };
    grow(ta);
    renderNarrFlags(flags, N.narrativeFlags(ta.value, r.categoryId));
    card.classList.toggle('problem', r.narrativeRequired && !ta.value.trim());
    save();
  });
  card.append(ta, flags);
  renderNarrFlags(flags, N.narrativeFlags(ta.value, r.categoryId));
  requestAnimationFrame(() => grow(ta));

  const saved = shift.narr[r.categoryId];
  if (saved && saved.basis !== N.draftBasis(r, shift.notes)) {
    card.append(el('div', { class: 'stale' }, 'Notes or score changed since you edited this narrative.',
      el('button', { class: 'btn link', onclick: () => redraft(r) }, 'Re-draft')));
  }
  card.append(el('div', { class: 'btn-row end' },
    el('button', { class: 'btn', onclick: () => redraft(r) }, 'Re-draft'),
    el('button', { class: 'btn primary', onclick: () => copyText(ta.value.trim()) }, 'Copy'),
  ));
  return card;
}

function redraft(r) {
  if (shift.narr[r.categoryId] && !confirm('Replace your edited narrative with a fresh draft?')) return;
  delete shift.narr[r.categoryId];
  save(); renderReview();
}

$('#training-text').addEventListener('input', e => {
  shift.training = { text: e.target.value };
  grow(e.target);
  renderNarrFlags($('#training-flags'), T.findFlags(e.target.value));
  save();
});
$('#training-redraft').addEventListener('click', () => {
  if (shift.training && !confirm('Replace your edited Training Provided with a fresh draft?')) return;
  shift.training = null;
  save(); renderReview();
});
$('#training-copy').addEventListener('click', () => copyText($('#training-text').value.trim()));

// ---------- shift view ----------
function renderShiftView() {
  const calls = shift.calls.filter(c => c !== 'general').length;
  $('#stat-start').textContent = fmtTime(shift.startedAt);
  $('#stat-calls').textContent = `${calls} ${calls === 1 ? 'call' : 'calls'}`;
  $('#stat-notes').textContent = `${shift.notes.length} ${shift.notes.length === 1 ? 'note' : 'notes'}`;
  $('#stat-left').textContent = `${hoursLeft()} h`;
}

// ---------- send by QR ----------
let sendTimer = null;
function drawQR(canvas, text) {
  const qr = window.qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const count = qr.getModuleCount();
  const quiet = 4;
  const size = canvas.width;
  const cell = Math.floor(size / (count + quiet * 2));
  const offset = Math.floor((size - cell * count) / 2);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000000';
  for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (qr.isDark(r, c)) ctx.fillRect(offset + c * cell, offset + r * cell, cell, cell);
}

$('#send-btn').addEventListener('click', async () => {
  save(true);
  const { parts, code } = await window.FTOHandoff.encode(shift);
  $('#send-code').textContent = code;
  let i = 0;
  const show = () => {
    drawQR($('#send-qr'), parts[i]);
    $('#send-part').textContent = parts.length > 1 ? `Part ${i + 1} of ${parts.length}` : 'One part';
    i = (i + 1) % parts.length;
  };
  show();
  clearInterval(sendTimer);
  if (parts.length > 1) sendTimer = setInterval(show, 650);
  $('#send').showModal();
});
$('#send').addEventListener('close', () => clearInterval(sendTimer));
$('#send-cancel').addEventListener('click', () => $('#send').close());
$('#send-done').addEventListener('click', () => {
  if (!confirm('Has the laptop shown "Received" with the same check code?\n\nThis deletes the shift from this phone.')) return;
  $('#send').close();
  wipeShift('moved');
});

// ---------- receive by webcam ----------
let stream = null;
let scanning = false;
let receiver = null;
let received = null;

function stopCamera() {
  scanning = false;
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  $('#receive-video').srcObject = null;
}

async function openReceive() {
  receiver = window.FTOHandoff.createReceiver();
  received = null;
  $('#receive-use').hidden = true;
  $('#receive-bar').style.width = '0';
  $('#receive-status').textContent = 'Starting camera…';
  $('#receive').showModal();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    $('#receive-status').textContent = 'This browser cannot use the camera here. Open FTO Notebook from its https:// address.';
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  } catch (e) {
    $('#receive-status').textContent = 'Camera not available. Allow camera access for this site and try again.';
    return;
  }
  const video = $('#receive-video');
  video.srcObject = stream;
  await video.play().catch(() => {});
  $('#receive-status').textContent = 'Looking for the QR code…';
  scanning = true;
  scanLoop();
}

const scanCanvas = document.createElement('canvas');
const scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true });
let lastScan = 0;
function scanLoop(ts = 0) {
  if (!scanning) return;
  requestAnimationFrame(scanLoop);
  if (ts - lastScan < 120) return;
  lastScan = ts;
  const video = $('#receive-video');
  if (video.readyState < 2 || !video.videoWidth) return;
  const scale = Math.min(1, 800 / video.videoWidth);
  scanCanvas.width = Math.round(video.videoWidth * scale);
  scanCanvas.height = Math.round(video.videoHeight * scale);
  scanCtx.drawImage(video, 0, 0, scanCanvas.width, scanCanvas.height);
  const img = scanCtx.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
  const hit = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
  if (hit && hit.data) ingest(hit.data);
}

async function ingest(text) {
  if (!receiver || received) return;
  const p = receiver.add(text);
  if (!p.ok) return;
  $('#receive-bar').style.width = `${Math.round((p.have / p.total) * 100)}%`;
  $('#receive-status').textContent = `Read ${p.have} of ${p.total} ${p.total === 1 ? 'part' : 'parts'}…`;
  if (!p.done) return;
  stopCamera();
  try {
    const out = await receiver.finish();
    const s = out.shift;
    if (!s || !Array.isArray(s.notes) || !s.startedAt) throw new Error('bad');
    if (expired(s)) { $('#receive-status').textContent = 'That shift is more than 24 hours old, so it was not kept.'; return; }
    received = s;
    const calls = (s.calls || []).filter(c => c !== 'general').length;
    $('#receive-status').replaceChildren(el('strong', {}, 'Received. '),
      `${calls} ${calls === 1 ? 'call' : 'calls'}, ${s.notes.length} ${s.notes.length === 1 ? 'note' : 'notes'}. Check code `,
      el('strong', {}, out.code), '. Make sure it matches the phone.');
    $('#receive-use').hidden = false;
  } catch (e) {
    $('#receive-status').textContent = "That transfer couldn't be read. Try sending again.";
  }
}

$('#receive-use').addEventListener('click', () => {
  if (!received) return;
  if (shift && !confirm('Replace the shift already on this device with the one from the phone?')) return;
  shift = { ...newShift(), ...received, view: 'review' };
  save(true);
  $('#receive').close();
  toast('Shift received');
  route();
});
$('#receive-cancel').addEventListener('click', () => $('#receive').close());
$('#receive').addEventListener('close', stopCamera);
$('#start-receive').addEventListener('click', openReceive);
$('#shift-receive').addEventListener('click', openReceive);

// For testing the handoff without a camera.
window.__ftoIngest = ingest;

// ---------- start ----------
function boot() {
  applyTheme();
  loadSavedGuide();
  const saved = store.get(KEYS.shift);
  if (saved && expired(saved)) { store.del(KEYS.shift); $('#wiped-banner').hidden = false; }
  else if (saved) shift = saved;
  route();
}
boot();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
})();
