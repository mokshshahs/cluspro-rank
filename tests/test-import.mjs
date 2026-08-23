// CSV import path, with the real cdnjs PapaParse build loaded into the window.
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const DIR = new URL('../', import.meta.url).pathname;
const dom = new JSDOM(fs.readFileSync(`${DIR}/index.html`, 'utf8'), { runScripts: 'outside-only' });
const { window } = dom;
const { document } = window;

// Let jsdom's own deferred DOMContentLoaded fire before app.js attaches its listener,
// so init() runs exactly once even though this test awaits.
await new Promise((r) => setTimeout(r, 50));

// The exact build the page loads, evaluated in-window so Papa uses jsdom's FileReader.
window.eval(fs.readFileSync(new URL('./papaparse-5.4.1.min.js', import.meta.url), 'utf8'));
window.confirm = () => true;
window.eval(fs.readFileSync(`${DIR}/app.js`, 'utf8'));
document.dispatchEvent(new window.Event('DOMContentLoaded'));

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
};
const $ = (s) => document.querySelector(s);
const captured = [];
const state = () => window.ClusProRank.state;
const set0 = (row, key) => (row.sets[key] ? row.sets[key].clusters[0] : undefined);
const clusters = (row, key) => (row.sets[key] ? row.sets[key].clusters : undefined);
const rowsOf = () => state().rows;
const headers = () => [...document.querySelectorAll('#results-head th.sortable')].map((th) => th.textContent.replace(/[▲▼]/g, '').trim());
const domRows = () => [...document.querySelectorAll('#results-body tr:not(.detail-row)')].map((tr) =>
  [...tr.querySelectorAll('td:not(.expander):not(.actions)')].map((td) => {
    const copy = td.cloneNode(true);
    copy.querySelectorAll('.demo-flag, .star').forEach((n) => n.remove());
    return copy.textContent.trim();
  }));
const click = (n) => n.dispatchEvent(new window.Event('click', { bubbles: true }));
const clearAll = () => click($('#clear-all-btn'));

// Swap in a Blob stub only while capturing a download, so File construction
// elsewhere still uses jsdom's real implementation.
const RealBlob = window.Blob;
window.URL.createObjectURL = (b) => { captured.push(b); return 'blob:x'; };
window.URL.revokeObjectURL = () => {};
window.HTMLAnchorElement.prototype.click = function () {};
function capture(button) {
  window.Blob = class { constructor(parts) { this.text = parts.join(''); } };
  try {
    click($(button));
    return captured.pop().text;
  } finally {
    window.Blob = RealBlob;
  }
}

async function importCsv(text, name = 'jobs.csv') {
  const file = new window.File([text], name, { type: 'text/csv' });
  Object.defineProperty($('#csv-input'), 'files', { value: [file], configurable: true });
  $('#csv-input').dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
}

clearAll();
check('cleared before import', rowsOf().length, 0);

// ── wide per-set format, as exported by "Export all sets" ─────────
await importCsv(
`pdb_id,complex_label,tag,balanced_cluster,balanced_members,balanced_center,balanced_lowest,electrostatic_favored_members,electrostatic_favored_center
7ABC,complex 1,G12D,0,123,-716.1,-770.2,201,-901.4
8WUL,complex 3,G12V,0,88,-1149.73,-1201.0,64,-1423.9
5AAA,,WT,1,45,-402.0,-455.5,,`);
check('rows imported', rowsOf().length, 3);
check('status ok', $('#csv-status').className, 'status ok');
check('all four balanced fields captured', set0(rowsOf()[0], 'balanced'),
  { cluster: 0, members: 123, center: -716.1, lowest: -770.2 });
check('second set kept separate', set0(rowsOf()[0], 'electrostatic'), { members: 201, center: -901.4 });
check('absent values stay absent', rowsOf()[2].sets.electrostatic, undefined);
check('a CSV row becomes a one-cluster record', clusters(rowsOf()[0], 'balanced').length, 1);
check('cluster columns render', headers(), ['PDB ID', 'Tag', 'Cluster', 'Members', 'Score · cluster 0, lowest energy']);
check('ranked by cluster size on arrival', domRows().map((r) => r[0].slice(0, 4)), ['7ABC', '8WUL', '5AAA']);
check('sort is Members descending', state().sort, { key: 'members:balanced', dir: 'desc' });

// ── long format with a coefficient_set column ─────────────────────
clearAll();
await importCsv(
`pdb_id,tag,coefficient_set,cluster,members,center,lowest
6ULN,G12D,Balanced,0,140,-725.4,-800.1
7OW3,G12D,Electrostatic-favored,0,95,-806.2,-830.0`, 'long.csv');
check('long format rows imported', rowsOf().length, 2);
check('coefficient_set column routes the values', set0(rowsOf()[0], 'balanced'),
  { cluster: 0, members: 140, center: -725.4, lowest: -800.1 });
check('second row landed in its own set', [rowsOf()[1].sets.balanced, set0(rowsOf()[1], 'electrostatic')],
  [undefined, { cluster: 0, members: 95, center: -806.2, lowest: -830 }]);

// ── loose headers, quoting, whitespace, BOM ───────────────────────
clearAll();
await importCsv(
`﻿PDB ID,Model,Mutation,Balanced,Electrostatic-favoured,VdW+Elec,Balanced Members,Notes
6ULR , TCR 9 ,"G12D, batch 2", -698.2 ,-652.4,-301.2, 77 ,ignore me
"8I5C","complex 1",G12V,-593.2,-681.3,,54,`, 'loose.csv');
check('loose headers imported', rowsOf().length, 2);
// field order follows SET_FIELDS (cluster, members, center, lowest)
check('bare set column read as centre score, sibling members column merged in',
  set0(rowsOf()[0], 'balanced'), { members: 77, center: -698.2 });
check('british spelling mapped', set0(rowsOf()[0], 'electrostatic'), { center: -652.4 });
check('vdw+elec mapped', set0(rowsOf()[0], 'vdwelec'), { center: -301.2 });
check('values trimmed', [rowsOf()[0].pdbId, rowsOf()[0].complexLabel], ['6ULR', 'TCR 9']);
check('quoted tag with a comma survives', rowsOf()[0].tag, 'G12D, batch 2');
check('unknown column reported', $('#csv-status').textContent.includes('Ignored column: Notes'), true);

// ── junk handling ─────────────────────────────────────────────────
clearAll();
await importCsv(
`pdb_id,tag,balanced_members
7OW3,G12D,140
,,
5XYZ,WT,n/a
,,60`, 'messy.csv');
check('blank row dropped, bad number ignored, id-less row kept',
  rowsOf().map((r) => [r.pdbId, set0(r, 'balanced') && set0(r, 'balanced').members]),
  [['7OW3', 140], ['5XYZ', undefined], ['(unnamed)', 60]]);

clearAll();
await importCsv('name,notes\nfoo,bar', 'unrelated.csv');
check('file with no usable rows rejected', [rowsOf().length, $('#csv-status').className], [0, 'status err']);
check('rejection explains why', $('#csv-status').textContent.includes('No usable rows'), true);

clearAll();
await importCsv('alpha,beta\n1,2', 'nocols.csv');
check('file with no recognisable columns rejected',
  $('#csv-status').textContent.includes('Could not recognise any columns'), true);

// ── round trip through "Export all sets" ──────────────────────────
clearAll();
const original =
`pdb_id,complex_label,tag,balanced_cluster,balanced_members,balanced_center,balanced_lowest,electrostatic_favored_members,electrostatic_favored_center
7ABC,complex 1,"G12D, run 2",0,123,-716.1,-770.2,201,-901.4
6ULR,TCR 9,G12D,2,45,-698.2,-712.0,,`;
await importCsv(original, 'a.csv');
const exported = capture('#export-all-btn');

clearAll();
await importCsv(exported, 'b.csv');
check('round trip preserves every field',
  rowsOf().map((r) => [r.pdbId, r.complexLabel, r.tag, set0(r, 'balanced'), set0(r, 'electrostatic')]),
  [['7ABC', 'complex 1', 'G12D, run 2', { cluster: 0, members: 123, center: -716.1, lowest: -770.2 }, { members: 201, center: -901.4 }],
   ['6ULR', 'TCR 9', 'G12D', { cluster: 2, members: 45, center: -698.2, lowest: -712 }, undefined]]);

// ── round trip through the single-set "Export table" ──────────────
const viewCsv = capture('#export-btn');
clearAll();
await importCsv(viewCsv, 'c.csv');
// 6ULR's only record is cluster 2, so under a "cluster 0" rule it has no headline,
// shows "—" on screen, and the figure export blanks it — the view export mirrors
// the view exactly. The all-sets backup above still carried it (asserted there).
check('single-set export re-imports what the view showed',
  rowsOf().map((r) => [r.pdbId, set0(r, 'balanced')]),
  [['7ABC', { cluster: 0, members: 123, center: -716.1, lowest: -770.2 }],
   ['6ULR', undefined]]);
check('single-set export carries no other set', rowsOf()[0].sets.electrostatic, undefined);

// ── an import is undoable in one step ─────────────────────────────
const before = rowsOf().length;
await importCsv('pdb_id,balanced_members\n9XYZ,42\n8XYZ,17', 'extra.csv');
check('import added rows', rowsOf().length, before + 2);
check('undo offers the import back',
  $('#undo-btn').textContent, '↩ Undo: Imported 2 rows from extra.csv');
click($('#undo-btn'));
check('undo reverses the whole import at once', rowsOf().length, before);
check('the rows it added are gone', rowsOf().some((r) => r.pdbId === '9XYZ'), false);
check('undo button hides afterwards', $('#undo-btn').hidden, true);

// a rejected import leaves nothing to undo
await importCsv('alpha,beta\n1,2', 'nope.csv');
check('a rejected import creates no undo entry', window.ClusProRank.getUndo(), null);
check('and the table is untouched', rowsOf().length, before);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
