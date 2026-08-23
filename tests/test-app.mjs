// Integration test: loads the real index.html + app.js in jsdom and drives the UI.
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { REAL_TABLE } from './fixture.mjs';

const DIR = new URL('../', import.meta.url).pathname;
const html = fs.readFileSync(`${DIR}/index.html`, 'utf8');
const appJs = fs.readFileSync(`${DIR}/app.js`, 'utf8');

const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
const { document } = window;

// Capture downloads instead of performing them. Blob is stubbed so the text is
// readable synchronously — an `await` here would let jsdom fire its own deferred
// DOMContentLoaded and run init() a second time.
const downloads = [];
window.Blob = class { constructor(parts) { this.text = parts.join(''); } };
window.URL.createObjectURL = (blob) => { downloads.push(blob); return 'blob:fake'; };
window.URL.revokeObjectURL = () => {};
window.HTMLAnchorElement.prototype.click = function () {};
window.confirm = () => true;

window.eval(appJs);
document.dispatchEvent(new window.Event('DOMContentLoaded'));

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
};

const $ = (s) => document.querySelector(s);
const state = () => window.ClusProRank.state;
const headers = () => [...document.querySelectorAll('#results-head th.sortable')].map((th) => th.textContent.replace(/[▲▼]/g, '').trim());
const rows = () => [...document.querySelectorAll('#results-body tr:not(.detail-row)')];
const detailRows = () => [...document.querySelectorAll('#results-body tr.detail-row')];
const cells = (tr) => [...tr.querySelectorAll('td:not(.expander):not(.actions)')].map((td) => {
  const copy = td.cloneNode(true);
  copy.querySelectorAll('.demo-flag, .star, .manual-flag').forEach((n) => n.remove());
  return copy.textContent.trim();
});
const ids = () => rows().map((tr) => cells(tr)[0].slice(0, 4));
const rowOf = (pdb) => rows().findIndex((tr) => cells(tr)[0].startsWith(pdb));
const cellOf = (pdb, label) => cells(rows()[rowOf(pdb)])[headers().indexOf(label)];
const scoreHeader = () => headers().find((h) => h.startsWith('Score'));
const click = (node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));
const th = (label) => [...document.querySelectorAll('#results-head th.sortable')].find((h) => h.textContent.includes(label));
const setValue = (sel, v) => { $(sel).value = v; $(sel).dispatchEvent(new window.Event('input', { bubbles: true })); };
const setRule = (v) => { $('#headline-rule').value = v; $('#headline-rule').dispatchEvent(new window.Event('change', { bubbles: true })); };
const submitForm = () => $('#job-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

const VIEW_NAMES = ['home', 'paste', 'manual', 'csv'];
const tabs = () => [...document.querySelectorAll('#entry-tabs .tab')];
const tab = (label) => tabs().find((b) => b.textContent.startsWith(label));
const openTab = (label) => click(tab(label));
/* Paste into the currently open tab and hit add. */
const addPaste = (text, pdb, extra = {}) => {
  $('#paste-input').value = text;
  if (pdb !== undefined) $('#t-pdb').value = pdb;
  if (extra.complex) $('#t-complex').value = extra.complex;
  if (extra.tag) $('#t-tag').value = extra.tag;
  click($('#add-paste-btn'));
};

const ELEC_TABLE = `Cluster    Members    Representative    Weighted Score
0    201    Center    -901.4
Lowest Energy    -988.0
1    77    Center    -880.2
Lowest Energy    -880.2`;

const HYDRO_TABLE = `0    64    Center    -305.5
Lowest Energy    -311.9`;

// ── 1. Tabs are present and Balanced is active ────────────────────
check('four coefficient-set tabs', tabs().map((b) => b.textContent.replace(/\d+$/, '').trim()),
  ['Balanced', 'Electrostatic-favored', 'Hydrophobic-favored', 'VdW+Elec']);
check('Balanced active by default', state().entrySet, 'balanced');
check('active tab marked', tab('Balanced').getAttribute('aria-selected'), 'true');
check('add button names the active set', $('#add-paste-btn').textContent, 'Add to Balanced');
check('context line names the active set', $('#entry-set-name').textContent, 'Balanced');
// ── 1b. Views ─────────────────────────────────────────────────────
const view = (n) => $(`#view-${n}`);
const navLink = (n) => $(`#main-nav a[data-view="${n}"]`);
const goTo = (n) => window.ClusProRank.showView(n);

check('home is the landing view', state().view, 'home');
check('only home is visible', VIEW_NAMES.map((n) => view(n).hidden), [false, true, true, true]);
check('home carries the how-to content',
  $('.help-sample').textContent.includes('0    123    Center    -716.1'), true);
check('home warns that the tab decides the set',
  $('.help-warn').textContent.includes('the only thing that decides'), true);
check('home offers a card per entry method',
  [...document.querySelectorAll('.method-card')].map((a) => a.getAttribute('href')),
  ['#/paste', '#/manual', '#/csv']);
check('the results table is hidden on home', $('#results-section').hidden, true);
check('nav marks the active view', navLink('home').classList.contains('is-active'), true);

goTo('paste');
check('switching shows only that view', VIEW_NAMES.map((n) => view(n).hidden), [true, false, true, true]);
check('the table moves into the paste view',
  $('#view-paste .table-slot').contains($('#results-section')), true);
check('and becomes visible', $('#results-section').hidden, false);
check('nav follows', [navLink('paste').classList.contains('is-active'), navLink('home').classList.contains('is-active')], [true, false]);

goTo('manual');
check('the same table instance moves to manual — never duplicated',
  [document.querySelectorAll('#results-section').length, $('#view-manual .table-slot').contains($('#results-section'))],
  [1, true]);
goTo('csv');
check('and to csv', $('#view-csv .table-slot').contains($('#results-section')), true);
check('rows persist across view switches', rows().length, 6);
goTo('home');
check('home hides the table again', $('#results-section').hidden, true);
check('an unknown view falls back to home',
  (() => { goTo('nonsense'); return state().view; })(), 'home');
goTo('paste');

check('6 demo rows on load', rows().length, 6);
check('demo rows show only a Score column',
  headers(), ['PDB ID', 'Tag', 'Score · cluster 0, lowest energy']);

// ── 2. Switching tabs changes where a paste is filed ──────────────
openTab('Electrostatic-favored');
check('tab switch updates state', state().entrySet, 'electrostatic');
check('button follows the tab', $('#add-paste-btn').textContent, 'Add to Electrostatic-favored');
check('context line follows the tab', $('#entry-set-name').textContent, 'Electrostatic-favored');
openTab('Balanced');

// ── 3. Paste into Balanced ────────────────────────────────────────
addPaste(REAL_TABLE, '7ABC', { tag: 'G12D' });
check('row added', rows().length, 7);
check('filed under the active tab, not guessed from text',
  Object.keys(state().rows.find((r) => r.pdbId === '7ABC').sets), ['balanced']);
check('all five clusters stored',
  state().rows.find((r) => r.pdbId === '7ABC').sets.balanced.clusters.length, 5);
check('headline is cluster 0 Lowest Energy', cellOf('7ABC', 'Score · cluster 0, lowest energy'), '-770.20');
check('status confirms the set and stays put',
  $('#paste-status').textContent,
  'Added 7ABC — Balanced: 5 clusters, top: 123 members, lowest -770.2. Still on Balanced; paste the next job.');
check('paste box cleared for the next job', $('#paste-input').value, '');
check('id fields cleared too', [$('#t-pdb').value, $('#t-tag').value], ['', '']);
check('tab did not change', state().entrySet, 'balanced');
check('tab shows a job count', tab('Balanced').textContent.endsWith('7'), true);

// ── 4. Same PDB via a different tab merges into one row ───────────
openTab('Electrostatic-favored');
addPaste(ELEC_TABLE, '7ABC');
check('no duplicate row', rows().length, 7);
check('both sets on one job',
  Object.keys(state().rows.find((r) => r.pdbId === '7ABC').sets), ['balanced', 'electrostatic']);
check('merge is reported', $('#paste-status').textContent.startsWith('Updated 7ABC — Electrostatic-favored: 2 clusters'), true);
check('each set keeps its own clusters',
  state().rows.find((r) => r.pdbId === '7ABC').sets.electrostatic.clusters.length, 2);

const coeffBtn = (label) => [...document.querySelectorAll('#coeff-group .seg')].find((b) => b.textContent === label);
click(coeffBtn('Electrostatic-favored'));
check('the merged set has its own headline', cellOf('7ABC', 'Score · cluster 0, lowest energy'), '-988.00');
check('and its own cluster size', cellOf('7ABC', 'Members'), '201');
click(coeffBtn('Balanced'));
check('the first set is untouched', cellOf('7ABC', 'Score · cluster 0, lowest energy'), '-770.20');

// re-pasting the same set replaces it rather than duplicating
openTab('Electrostatic-favored');
addPaste(ELEC_TABLE, '7ABC');
check('re-paste replaces that set', rows().length, 7);
check('replacement is reported', $('#paste-status').textContent.includes('Replaced Electrostatic-favored for 7ABC'), true);

// ── 5. Partial completeness: 2 of 4 sets ──────────────────────────
check('only sets with data get a display tab',
  [...document.querySelectorAll('#coeff-group .seg')].map((b) => b.textContent),
  ['Balanced', 'Electrostatic-favored', 'All sets']);
click(coeffBtn('All sets'));
check('cross-set view shows only the two populated sets',
  headers(), ['PDB ID', 'Tag', 'Balanced', 'Electrostatic-favored']);
check('the job with 2 of 4 sets reads correctly',
  [cellOf('7ABC', 'Balanced'), cellOf('7ABC', 'Electrostatic-favored')], ['-770.20', '-988.00']);
check('a job with only Balanced leaves the other column empty',
  cellOf('8WUL', 'Electrostatic-favored') !== '—', true);

// a third set appears only once it has data
openTab('Hydrophobic-favored');
addPaste(HYDRO_TABLE, '7ABC');
check('third set added to the same row',
  Object.keys(state().rows.find((r) => r.pdbId === '7ABC').sets), ['balanced', 'electrostatic', 'hydrophobic']);
check('still one row', rows().length, 7);
check('display tabs now include the third set',
  [...document.querySelectorAll('#coeff-group .seg')].map((b) => b.textContent),
  ['Balanced', 'Electrostatic-favored', 'Hydrophobic-favored', 'All sets']);
check('VdW+Elec never appears — no job has it',
  [...document.querySelectorAll('#coeff-group .seg')].some((b) => b.textContent === 'VdW+Elec'), false);
click(coeffBtn('Hydrophobic-favored'));
check('rows with no data in this set show em dashes', cellOf('8WUL', 'Score · cluster 0, lowest energy'), '—');
check('the job that has it shows its value', cellOf('7ABC', 'Score · cluster 0, lowest energy'), '-311.90');
click(coeffBtn('Balanced'));
openTab('Balanced');

// ── 6. Malformed pastes are rejected with a specific message ──────
const rejects = (name, text, fragment) => {
  const before = rows().length;
  addPaste(text, '9ZZZ');
  check(name, [rows().length, $('#paste-status').className, $('#paste-status').textContent.includes(fragment)],
    [before, 'status err', true]);
};
rejects('prose rejected', 'hello there, some notes about docking', 'numbered clusters');
rejects('empty paste rejected', '', 'paste a cluster table first');
rejects('header row alone rejected', 'Cluster  Members  Representative  Weighted Score', 'numbered clusters');
rejects('bare numbers rejected', '-716.1\n-770.2', 'numbered clusters');
rejects('label: value rejected', 'Balanced: -812.4', 'numbered clusters');
rejects('two tables at once rejected', `${REAL_TABLE}\n${REAL_TABLE}`, 'one coefficient set at a time');
rejects('orphan Lowest Energy rejected', 'Lowest Energy   -999.9\n0   10   Center   -100.0', 'can’t be attached');
check('nothing was partially imported by any rejection',
  state().rows.some((r) => r.pdbId === '9ZZZ'), false);

// a valid table with no PDB ID is also refused, and nothing is added
$('#paste-input').value = REAL_TABLE;
$('#t-pdb').value = '';
click($('#add-paste-btn'));
check('PDB ID required', [rows().length, $('#paste-status').className], [7, 'status err']);
check('the message says why', $('#paste-status').textContent.includes('PDB ID is required'), true);
check('a rejected paste is left in the box to fix', $('#paste-input').value, REAL_TABLE);
click($('#paste-clear-btn'));
check('clear empties the box and status', [$('#paste-input').value, $('#paste-status').textContent], ['', '']);

// ── 7. Headline rules still work over stored clusters ─────────────
setRule('c0center');
check('rule b recomputes instantly', cellOf('7ABC', 'Score · cluster 0, center'), '-716.10');
setRule('clusterN');
check('specific-cluster input appears', $('#rule-n-wrap').hidden, false);
setValue('#rule-n', '3');
check('rule c uses the given rank', cellOf('7ABC', 'Score · cluster 3, lowest energy'), '-815.40');
check('the row follows that cluster', [cellOf('7ABC', 'Cluster'), cellOf('7ABC', 'Members')], ['3', '98']);
setRule('globalmin');
check('specific-cluster input hides again', $('#rule-n-wrap').hidden, true);
check('rule d finds the best score anywhere', cellOf('7ABC', 'Score · global minimum'), '-872.70');
setRule('c0lowest');
check('back to the default', scoreHeader(), 'Score · cluster 0, lowest energy');

// ── 8. Expansion and per-row pin ──────────────────────────────────
click(rows()[rowOf('7ABC')].querySelector('.expander-btn'));
check('detail row opens', detailRows().length, 1);
check('every stored cluster listed',
  [...detailRows()[0].querySelectorAll('.detail-table tbody tr')].length, 5);
click(detailRows()[0].querySelector('[data-pick$=":3:lowest"]'));
check('pin overrides the global rule', cellOf('7ABC', 'Score · cluster 0, lowest energy'), '-815.40');
check('pin is flagged', rows()[rowOf('7ABC')].querySelector('.manual-flag') !== null, true);
check('rule note counts overrides', $('#rule-note').textContent, 'Applies to every row except 1 manual override.');
click(detailRows()[0].querySelector('[data-reset]'));
check('reset restores the rule', cellOf('7ABC', 'Score · cluster 0, lowest energy'), '-770.20');
click(rows()[rowOf('7ABC')].querySelector('.expander-btn'));

// ── 9. Manual entry form unchanged ────────────────────────────────
$('#f-pdb').value = '5AAA';
$('#f-tag').value = 'WT';
$('#f-balanced-members').value = '88';
$('#f-balanced-center').value = '-400.5';
submitForm();
check('manual row added', rows().length, 8);
check('manual entry becomes a one-cluster record',
  state().rows.find((r) => r.pdbId === '5AAA').sets.balanced.clusters, [{ members: 88, center: -400.5 }]);
check('manual entry merges by PDB ID too', (() => {
  $('#f-pdb').value = '5AAA';
  $('#f-electrostatic-center').value = '-333.3';
  submitForm();
  return [rows().length, Object.keys(state().rows.find((r) => r.pdbId === '5AAA').sets)];
})(), [8, ['balanced', 'electrostatic']]);
check('manual form rejects a row with no values', (() => {
  $('#f-pdb').value = '4BBB'; submitForm();
  return [rows().length, $('#form-status').className];
})(), [8, 'status err']);
$('#job-form').reset();

// ── 10. Sorting, filtering, export unchanged ──────────────────────
check('ranked by cluster size', ids().slice(0, 2), ['7ABC', '5AAA']);
click(th('Score'));
check('score sort is user-pinned', state().sortPinned, true);
setValue('#filter-input', 'g12d');
check('filter by tag', ids(), ['7ABC', '7OW3', '6ULN', '6ULR']);
setValue('#filter-input', '');
click($('#export-btn'));
const viewCsv = downloads.pop().text;
check('export still records the rule',
  viewCsv.split('\r\n')[0], 'pdb_id,complex_label,tag,coefficient_set,headline_rule,cluster,members,center,lowest');
check('export row carries the headline cluster',
  viewCsv.split('\r\n').find((l) => l.startsWith('7ABC')),
  '7ABC,,G12D,Balanced,"cluster 0, lowest energy",0,123,-716.1,-770.2');

// ── 11. Demo toggle and clearing ──────────────────────────────────
click($('#clear-demo-btn'));
check('demo rows removed', ids().sort(), ['5AAA', '7ABC']);
click($('#clear-all-btn'));
check('clear all empties the table', rows().length, 0);
check('tab counts reset', tabs().every((b) => !/\d/.test(b.textContent)), true);
check('entry tab stays usable after clearing', state().entrySet, 'balanced');
addPaste(REAL_TABLE, '1XYZ');
check('can paste again into an empty table', rows().length, 1);

// ── 12. One-level undo ────────────────────────────────────────────
const undoBtn = () => $('#undo-btn');
const clustersOf = (pdb, set) => {
  const r = state().rows.find((x) => x.pdbId === pdb);
  return r && r.sets[set] ? r.sets[set].clusters : undefined;
};

check('undo button offers the last action', [undoBtn().hidden, undoBtn().textContent],
  [false, '↩ Undo: Added 1XYZ']);
click(undoBtn());
check('undo removes the row it added', rows().length, 0);
check('undo button hides after use', undoBtn().hidden, true);
check('undo is single level — nothing left to undo', window.ClusProRank.getUndo(), null);
check('undoing twice is a no-op', (() => { click(undoBtn()); return rows().length; })(), 0);

// the wrong-tab scenario: Electrostatic data pasted while Balanced is open
openTab('Balanced');
addPaste(REAL_TABLE, '1LYZ', { tag: 'lysozyme' });
check('job set up with Balanced data', clustersOf('1LYZ', 'balanced').length, 5);
const originalBalanced = JSON.stringify(clustersOf('1LYZ', 'balanced'));

addPaste(ELEC_TABLE, '1LYZ');   // still on Balanced — the mistake
check('the wrong-tab paste overwrites Balanced', clustersOf('1LYZ', 'balanced').length, 2);
check('it never reaches Electrostatic-favored', clustersOf('1LYZ', 'electrostatic'), undefined);
check('a replacement is flagged as a warning, not a plain success',
  $('#paste-status').className, 'status warn');
check('the message says data was overwritten',
  $('#paste-status').textContent.includes('Previous data for that set was overwritten'), true);
check('undo names the replacement', undoBtn().textContent, '↩ Undo: Replaced Balanced for 1LYZ');

click(undoBtn());
check('undo restores the original Balanced clusters exactly',
  JSON.stringify(clustersOf('1LYZ', 'balanced')), originalBalanced);
check('the job survives the undo', rows().length, 1);
check('undo status names what was reverted',
  $('#table-status').textContent, 'Undone: replaced Balanced for 1LYZ. Table restored to 1 row.');

// a rejected paste changes nothing, so it creates no undo entry
addPaste('this is not a cluster table', '1LYZ');
check('a rejected paste creates no undo entry', window.ClusProRank.getUndo(), null);

openTab('Electrostatic-favored');
addPaste(ELEC_TABLE, '1LYZ');
check('correct tab adds a second set', Object.keys(state().rows[0].sets), ['balanced', 'electrostatic']);
addPaste('garbage text', '1LYZ');
check('a rejected paste after a good one keeps that undo available',
  undoBtn().textContent, '↩ Undo: Updated 1LYZ');
click(undoBtn());
check('undo removes only the merged set', Object.keys(state().rows[0].sets), ['balanced']);

// undo covers destructive table actions too
const before = rows().length;
click($('#clear-all-btn'));
check('clear all empties', rows().length, 0);
check('undo offers the clear back', undoBtn().textContent, '↩ Undo: Cleared all 1 row');
click(undoBtn());
check('clear all is reversible', rows().length, before);
click(rows()[0].querySelector('.row-del'));
check('row deleted', rows().length, before - 1);
check('undo names the deleted row', undoBtn().textContent, '↩ Undo: Removed 1LYZ');
click(undoBtn());
check('delete is reversible', rows().length, before);

// keyboard shortcut
const press = (target, opts = {}) =>
  target.dispatchEvent(new window.KeyboardEvent('keydown',
    { key: 'z', metaKey: true, bubbles: true, cancelable: true, ...opts }));
click(rows()[0].querySelector('.row-del'));
check('a row is gone again', rows().length, before - 1);
press(document.body);
check('Cmd+Z undoes', rows().length, before);
click(rows()[0].querySelector('.row-del'));
press($('#paste-input'));
check('Cmd+Z inside a textarea is left to the browser', rows().length, before - 1);
press($('#t-pdb'));
check('Cmd+Z inside an input is left to the browser too', rows().length, before - 1);
press(document.body, { shiftKey: true });
check('Shift+Cmd+Z is not treated as undo', rows().length, before - 1);
press(document.body);
check('and plain Cmd+Z still works afterwards', rows().length, before);

// ── 13. Tables copied from partway down ───────────────────────────
click($('#clear-all-btn'));
window.ClusProRank.getUndo();          // (undo entry exists; not used here)
const MID_TABLE = `2    107    Center    -620.8
Lowest Energy    -716.9
3    98    Center    -673.4
Lowest Energy    -815.4`;
openTab('Balanced');
addPaste(REAL_TABLE, '1FUL');            // a complete table, so the columns exist
addPaste(MID_TABLE, '3MID');
check('a partial table is still accepted', rows().length, 2);
check('but the paste warns that cluster 0 is missing',
  [$('#paste-status').className, $('#paste-status').textContent.includes('starts at cluster 2')], ['status warn', true]);
check('under a cluster-0 rule its score is blank, not another cluster’s',
  cellOf('3MID', 'Score · cluster 0, lowest energy'), '—');
check('the complete job is unaffected',
  cellOf('1FUL', 'Score · cluster 0, lowest energy'), '-770.20');
check('with every column collapsing only when no row resolves', (() => {
  click(rows()[rowOf('1FUL')].querySelector('.row-del'));
  const only = headers();
  click($('#undo-btn'));
  return only;
})(), ['PDB ID', 'Tag']);
check('and the table says why',
  [$('#coeff-hint').hidden, $('#coeff-hint').textContent.includes('no cluster matching')], [false, true]);
check('expanding still shows the clusters it does have',
  (() => { click(rows()[rowOf('3MID')].querySelector('.expander-btn'));
    return [...detailRows()[0].querySelectorAll('.detail-table tbody tr')]
      .map((tr) => tr.querySelectorAll('td')[1].textContent); })(), ['2', '3']);
click(rows()[rowOf('3MID')].querySelector('.expander-btn'));

setRule('clusterN');
setValue('#rule-n', '2');
check('asking for cluster 2 by number finds it', cellOf('3MID', 'Score · cluster 2, lowest energy'), '-716.90');
check('and reports that cluster, not list position 0', cellOf('3MID', 'Cluster'), '2');
check('hint clears once every row resolves', $('#coeff-hint').hidden, true);
setRule('c0lowest');

// ── 14. Manual grid rejects non-integer ranks and sizes ───────────
click($('#clear-all-btn'));
$('#f-pdb').value = '7INT';
$('#f-balanced-cluster').value = '1.5';
$('#f-balanced-center').value = '-500';
submitForm();
check('a fractional cluster rank is refused', [rows().length, $('#form-status').className], [0, 'status err']);
check('the message names the offending field',
  $('#form-status').textContent.includes('Balanced Cluster'), true);
$('#f-balanced-cluster').value = '-2';
submitForm();
check('a negative cluster rank is refused', rows().length, 0);
$('#f-balanced-cluster').value = '1';
$('#f-balanced-members').value = '12.5';
submitForm();
check('a fractional member count is refused too', rows().length, 0);
$('#f-balanced-members').value = '12';
submitForm();
check('whole numbers are accepted', rows().length, 1);
check('scores may still be fractional',
  state().rows[0].sets.balanced.clusters[0], { cluster: 1, members: 12, center: -500 });
$('#job-form').reset();

// ── 15. Cross-set export labels headline scores honestly ──────────
click($('#clear-all-btn'));
openTab('Balanced');
addPaste(REAL_TABLE, '9EXP');
openTab('Electrostatic-favored');
addPaste(ELEC_TABLE, '9EXP');
click(coeffBtn('All sets'));
click($('#export-btn'));
const allViewCsv = downloads.pop().text;
check('cross-set export does not call a Lowest Energy value a centre score',
  allViewCsv.split('\r\n')[0],
  'pdb_id,complex_label,tag,headline_rule,balanced_headline,electrostatic_favored_headline');
check('and records which rule produced the numbers',
  allViewCsv.split('\r\n')[1], '9EXP,,,"cluster 0, lowest energy",-770.2,-988');
click(coeffBtn('Balanced'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
