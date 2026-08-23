// Node smoke test for the pure-logic parts of app.js (no DOM needed).
import fs from 'node:fs';
import vm from 'node:vm';
import { REAL_TABLE, REAL_CLUSTERS } from './fixture.mjs';

const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const sandbox = {
  document: { addEventListener: () => {}, querySelector: () => null },
  window: {},
  URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
  Blob: class {},
  setTimeout,
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const { parseClusterTable, detectSetKey, detectFieldKey, mapCsvHeader, toNumber } = sandbox.window.ClusProRank;

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
};

// ── coefficient-set label matching (CSV headers only — never pasted text) ──
eq('set: Balanced', detectSetKey('Balanced'), 'balanced');
eq('set: Ballanced (typo)', detectSetKey('Ballanced'), 'balanced');
eq('set: Electrostatic-favored', detectSetKey('Electrostatic-favored'), 'electrostatic');
eq('set: Electrostatic-favoured (UK)', detectSetKey('Electrostatic-favoured'), 'electrostatic');
eq('set: Hydrophobic-favored', detectSetKey('Hydrophobic-favored'), 'hydrophobic');
eq('set: VdW+Elec beats Elec', detectSetKey('VdW+Elec'), 'vdwelec');
eq('set: van der Waals + Elec', detectSetKey('van der Waals + Elec'), 'vdwelec');
eq('set: unrelated', detectSetKey('Cluster members'), null);

// ── per-set field matching ────────────────────────────────────────
eq('field: members', detectFieldKey('members'), 'members');
eq('field: cluster', detectFieldKey('cluster'), 'cluster');
eq('field: cluster_members → members', detectFieldKey('cluster_members'), 'members');
eq('field: cluster_center → center', detectFieldKey('cluster_center'), 'center');
eq('field: Lowest Energy', detectFieldKey('Lowest Energy'), 'lowest');
eq('field: Weighted Score → none', detectFieldKey('Weighted Score'), null);

// ── the real ClusPro cluster table ────────────────────────────────
const good = parseClusterTable(REAL_TABLE);
eq('the real table is accepted', good.ok, true);
eq('every cluster is kept, in order', good.clusters, REAL_CLUSTERS);
eq('each Lowest Energy attaches to the cluster stated above it',
  good.clusters.map((c) => [c.cluster, c.lowest]),
  [[0, -770.2], [1, -872.7], [2, -716.9], [3, -815.4], [4, -796.3]]);
eq('equal Center and Lowest Energy both survive',
  good.clusters[4], { cluster: 4, members: 80, center: -796.3, lowest: -796.3 });
eq('cluster rank tracks population, not score — rank 0 is not the best score',
  [good.clusters[0].members, Math.min(...good.clusters.map((c) => c.lowest))], [123, -872.7]);
eq('no stray lines in a clean table', good.ignored, 0);

// the coefficient set is never inferred from the text
eq('parse result carries no coefficient set', 'set' in good, false);
eq('a set heading in the text is just an ignored line',
  parseClusterTable(`Balanced\n${REAL_TABLE}`).ignored, 1);
eq('and does not change what is parsed',
  parseClusterTable(`Balanced\n${REAL_TABLE}`).clusters, REAL_CLUSTERS);

// header row optional, cluster lines are not
eq('header row is optional',
  parseClusterTable('0    123    Center    -716.1\nLowest Energy    -770.2').clusters,
  [{ cluster: 0, members: 123, center: -716.1, lowest: -770.2 }]);
eq('a cluster with no Lowest Energy line is still valid',
  parseClusterTable('0    10    Center    -100.0').clusters,
  [{ cluster: 0, members: 10, center: -100 }]);
eq('first Lowest Energy per cluster wins',
  parseClusterTable('0    10    Center    -100.0\nLowest Energy    -111.1\nLowest Energy    -222.2').clusters,
  [{ cluster: 0, members: 10, center: -100, lowest: -111.1 }]);
eq('tab-separated columns parse',
  parseClusterTable('0\t123\tCenter\t-716.1\nLowest Energy\t-770.2').clusters,
  [{ cluster: 0, members: 123, center: -716.1, lowest: -770.2 }]);

// ── strict rejection: no guess-parsing, no partial imports ────────
const bad = (name, text, reason) => {
  const r = parseClusterTable(text);
  eq(name, [r.ok, r.reason], [false, reason]);
};
bad('empty paste rejected', '', 'empty');
bad('whitespace-only paste rejected', '   \n\t\n ', 'empty');
bad('prose rejected', 'hello world, this is not a docking result', 'shape');
bad('label: value pastes are no longer guess-parsed', 'Balanced: -1149.73', 'shape');
bad('header row alone rejected', 'Cluster    Members    Representative    Weighted Score', 'shape');
bad('a bare list of numbers rejected', '-716.1\n-770.2\n-754.7', 'shape');
bad('a cluster line missing its score rejected', '0    123    Center', 'shape');
bad('orphan Lowest Energy rejected', 'Lowest Energy    -999.9\n0    10    Center    -100.0', 'orphan');
bad('two tables pasted together rejected', `${REAL_TABLE}\n${REAL_TABLE}`, 'multiple');
bad('cluster numbers stepping backwards rejected',
  '0    10    Center    -100.0\n0    9    Center    -90.0', 'multiple');

eq('rejection message names what was expected',
  parseClusterTable('nonsense').message.includes('numbered clusters'), true);
eq('multi-table message says to paste one set at a time',
  parseClusterTable(`${REAL_TABLE}\n${REAL_TABLE}`).message.includes('one coefficient set at a time'), true);
eq('a rejection returns no clusters at all',
  'clusters' in parseClusterTable('nonsense'), false);

// ── headline score selection ──────────────────────────────────────
const { headlineFor, state } = sandbox.window.ClusProRank;
const jobRow = { sets: { balanced: { clusters: REAL_CLUSTERS, manual: null } } };
const headline = () => headlineFor(jobRow, 'balanced');

state.headlineRule = 'c0lowest';
eq('default rule: cluster 0, Lowest Energy', headline().value, -770.2);
eq('default rule reports where it came from', [headline().cluster.cluster, headline().field], [0, 'lowest']);

state.headlineRule = 'c0center';
eq('rule b: cluster 0, Center', headline().value, -716.1);

state.headlineRule = 'clusterN';
state.clusterN = 3;
eq('rule c: a specific cluster rank', headline().value, -815.4);
eq('specific-rank rule reports that rank', headline().cluster.cluster, 3);
state.clusterN = 99;
eq('a rank beyond the list has no headline', headline(), null);
state.clusterN = 1;

state.headlineRule = 'globalmin';
eq('rule d: global minimum across all clusters and both scores', headline().value, -872.7);
eq('global minimum comes from cluster 1, not cluster 0', [headline().cluster.cluster, headline().field], [1, 'lowest']);

state.headlineRule = 'c0lowest';
jobRow.sets.balanced.manual = { rank: 4, field: 'center' };
eq('per-row pin beats the global rule', headline().value, -796.3);
eq('override is flagged', headline().manual, true);
jobRow.sets.balanced.manual = null;
eq('clearing the override restores the global rule', headline().value, -770.2);

// a record holding only one of the two scores still produces a headline
const oneScore = { sets: { balanced: { clusters: [{ center: -500.5 }], manual: null } } };
eq('missing Lowest Energy falls back to Center', headlineFor(oneScore, 'balanced').value, -500.5);
eq('the fallback is marked as such', headlineFor(oneScore, 'balanced').fallback, true);
eq('an empty cluster list has no headline',
  headlineFor({ sets: { balanced: { clusters: [], manual: null } } }, 'balanced'), null);

// ── cluster rules match ClusPro's cluster NUMBER, not list position ──
// A table copied from partway down starts at cluster 2; calling that "cluster 0"
// would report one cluster's score under another's name.
const mid = { sets: { balanced: { clusters: parseClusterTable(
  '2    107    Center    -620.8\nLowest Energy    -716.9\n3    98    Center    -673.4\nLowest Energy    -815.4').clusters, manual: null } } };
state.headlineRule = 'c0lowest';
eq('no cluster 0 in a partial table means no headline', headlineFor(mid, 'balanced'), null);
state.headlineRule = 'clusterN';
state.clusterN = 2;
eq('the cluster actually numbered 2 is found', headlineFor(mid, 'balanced').value, -716.9);
state.clusterN = 3;
eq('and cluster 3 is the second list entry, matched by number', headlineFor(mid, 'balanced').value, -815.4);

// gaps in the numbering are respected
const gapped = { sets: { balanced: { clusters: parseClusterTable(
  '0    10    Center    -100.0\n1    9    Center    -90.0\n3    8    Center    -80.0').clusters, manual: null } } };
state.clusterN = 3;
eq('a gapped table finds cluster 3', headlineFor(gapped, 'balanced').value, -80);
state.clusterN = 2;
eq('and reports nothing for the missing cluster 2', headlineFor(gapped, 'balanced'), null);
state.headlineRule = 'c0lowest';

// records with no cluster number at all (manual entry, CSV) still resolve at rank 0
const numberless = { sets: { balanced: { clusters: [{ center: -400.5 }], manual: null } } };
eq('a numberless record stands in for cluster 0', headlineFor(numberless, 'balanced').value, -400.5);
state.headlineRule = 'clusterN';
state.clusterN = 2;
eq('but not for any other rank', headlineFor(numberless, 'balanced'), null);
state.headlineRule = 'c0lowest';
state.clusterN = 1;

// ── line endings and awkward numbers ──────────────────────────────
eq('CRLF line endings parse',
  parseClusterTable('0\t123\tCenter\t-716.1\r\nLowest Energy\t-770.2\r\n').clusters,
  [{ cluster: 0, members: 123, center: -716.1, lowest: -770.2 }]);
eq('lone CR line endings parse',
  parseClusterTable('0    123    Center    -716.1\rLowest Energy    -770.2').clusters,
  [{ cluster: 0, members: 123, center: -716.1, lowest: -770.2 }]);
eq('trailing spaces on a cluster line are fine',
  parseClusterTable('0    123    Center    -716.1   ').clusters,
  [{ cluster: 0, members: 123, center: -716.1 }]);
eq('an unexpected extra column is rejected, not silently truncated',
  parseClusterTable('0    123    Center    -716.1    99.9').ok, false);
eq('positive and zero scores are kept',
  parseClusterTable('0    10    Center    716.1\nLowest Energy    0').clusters,
  [{ cluster: 0, members: 10, center: 716.1, lowest: 0 }]);
eq('a 200-cluster table parses whole', (() => {
  const big = Array.from({ length: 200 }, (_, i) => `${i}    ${500 - i}    Center    ${-900 + i}`).join('\n');
  const r = parseClusterTable(big);
  return [r.ok, r.clusters.length, r.clusters[199].cluster];
})(), [true, 200, 199]);

// ── CSV header mapping ────────────────────────────────────────────
eq('csv: pdb_id', mapCsvHeader('pdb_id'), { type: 'pdb' });
eq('csv: PDB ID', mapCsvHeader('PDB ID'), { type: 'pdb' });
eq('csv: complex_label', mapCsvHeader('complex_label'), { type: 'complex' });
eq('csv: mutation → tag', mapCsvHeader('mutation'), { type: 'tag' });
eq('csv: coefficient_set', mapCsvHeader('coefficient_set'), { type: 'setname' });
eq('csv: balanced_members', mapCsvHeader('balanced_members'), { type: 'field', set: 'balanced', field: 'members' });
eq('csv: balanced_cluster', mapCsvHeader('balanced_cluster'), { type: 'field', set: 'balanced', field: 'cluster' });
eq('csv: vdw_elec_lowest', mapCsvHeader('vdw_elec_lowest'), { type: 'field', set: 'vdwelec', field: 'lowest' });
eq('csv: electrostatic_favored_center', mapCsvHeader('electrostatic_favored_center'), { type: 'field', set: 'electrostatic', field: 'center' });
eq('csv: bare "balanced" reads as centre score', mapCsvHeader('balanced'), { type: 'field', set: 'balanced', field: 'center' });
eq('csv: bare "members" defers to the row set', mapCsvHeader('members'), { type: 'field', set: null, field: 'members' });
eq('csv: unknown col', mapCsvHeader('notes_2'), null);

// ── number coercion ───────────────────────────────────────────────
eq('num: -1,149.73', toNumber('-1,149.73'), -1149.73);
eq('num: unicode minus', toNumber('−814.1'), -814.1);
eq('num: en dash as minus', toNumber('–814.1'), -814.1);
eq('num: integer members', toNumber('123'), 123);
eq('num: padded', toNumber('  -698.2  '), -698.2);
eq('num: explicit plus', toNumber('+716.1'), 716.1);
eq('num: zero', toNumber('0'), 0);
eq('num: exponent', toNumber('1e3'), 1000);
eq('num: leading dot', toNumber('.5'), 0.5);
eq('num: trailing dot', toNumber('5.'), 5);
eq('num: two numbers in one cell is not a number', Number.isFinite(toNumber('1 2')), false);
eq('num: double minus', Number.isFinite(toNumber('--5')), false);
eq('num: Infinity', Number.isFinite(toNumber('Infinity')), false);
eq('num: blank', Number.isFinite(toNumber('')), false);
eq('num: text', Number.isFinite(toNumber('n/a')), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
