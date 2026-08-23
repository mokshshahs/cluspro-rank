/* ClusPro Rank — client-side comparison table for ClusPro docking jobs.
 * No backend, no storage: state lives in memory, CSV is the save/load format.
 *
 * A pasted results page gives a full cluster table per coefficient set. The whole
 * table is kept per job; the main table shows one derived "headline" score chosen
 * by a rule that can be changed at any time without re-pasting.
 *
 * Ranking defaults to Members (cluster size) because ClusPro ranks models by
 * cluster population and its documentation discourages ranking by the PIPER
 * weighted scores. See https://cluspro.org/help.php */
'use strict';

/* ────────────────────────────────────────────────────────────────────
 * Coefficient sets, record fields, headline rules
 * ──────────────────────────────────────────────────────────────────── */

const COEFF_SETS = [
  { key: 'balanced',      label: 'Balanced',              csv: 'balanced' },
  { key: 'electrostatic', label: 'Electrostatic-favored', csv: 'electrostatic_favored' },
  { key: 'hydrophobic',   label: 'Hydrophobic-favored',   csv: 'hydrophobic_favored' },
  { key: 'vdwelec',       label: 'VdW+Elec',              csv: 'vdw_elec' }
];
const SET_BY_KEY = Object.fromEntries(COEFF_SETS.map((s) => [s.key, s]));

/* Fields of one cluster record — also the manual-entry grid and CSV columns. */
const SET_FIELDS = [
  { field: 'cluster', label: 'Cluster',       int: true },
  { field: 'members', label: 'Members',       int: true },
  { field: 'center',  label: 'Center score',  int: false },
  { field: 'lowest',  label: 'Lowest energy', int: false }
];

/* Derived columns in the main table. `better` drives default sort direction and ★. */
const TABLE_FIELDS = [
  { field: 'cluster', label: 'Cluster', better: 'low',  badge: false, help: 'Cluster the headline score came from. Rank 0 is the largest cluster.' },
  { field: 'members', label: 'Members', better: 'high', badge: true,  help: 'Population of that cluster. ClusPro ranks models by this, so bigger is better.' },
  { field: 'score',   label: 'Score',   better: 'low',  badge: true,  help: 'Headline score under the current rule. An energy: more negative sorts first.' }
];

const HEADLINE_RULES = {
  c0lowest:  { short: () => 'cluster 0, lowest energy' },
  c0center:  { short: () => 'cluster 0, center' },
  clusterN:  { short: () => `cluster ${state.clusterN}, lowest energy` },
  globalmin: { short: () => 'global minimum' }
};
const ruleShort = () => HEADLINE_RULES[state.headlineRule].short();

/* Map a free-text label onto a coefficient set. Tolerant of case, punctuation,
 * British spelling ("favoured"), abbreviations, and a doubled letter or two.
 * Order matters: "VdW+Elec" contains "elec", so VdW is tested first. */
function detectSetKey(rawLabel) {
  if (!rawLabel) return null;
  const s = String(rawLabel).toLowerCase().replace(/[^a-z]/g, '');
  if (/vdw|vanderwaals/.test(s)) return 'vdwelec';
  if (/hydro?p?h?obic|hphobic/.test(s)) return 'hydrophobic';
  if (/electro|elec/.test(s)) return 'electrostatic';
  if (/bal+anc/.test(s)) return 'balanced';
  return null;
}

/* Which cluster-record field a column header refers to. Most specific first:
 * "cluster_center" is a centre, "cluster_members" is a population. */
function detectFieldKey(rawLabel) {
  if (!rawLabel) return null;
  const s = String(rawLabel).toLowerCase().replace(/[^a-z]/g, '');
  if (/lowest|lowenergy|minenergy/.test(s)) return 'lowest';
  if (/cent(er|re)/.test(s)) return 'center';
  if (/members|clustersize|population|nstruct/.test(s)) return 'members';
  if (/cluster|rank/.test(s)) return 'cluster';
  return null;
}

/* ────────────────────────────────────────────────────────────────────
 * State
 * ──────────────────────────────────────────────────────────────────── */

let nextId = 1;

const DEFAULT_SORT = { key: 'members:balanced', dir: 'desc' };

const VIEWS = ['home', 'paste', 'manual', 'csv'];

const state = {
  rows: [],
  view: 'home',             // home = how-to; the other three each host the table
  entrySet: 'balanced',     // active paste tab — the only source of truth for a paste
  coeff: 'balanced',        // a set key, or 'all' for the cross-set view
  headlineRule: 'c0lowest', // default: cluster 0, Lowest Energy
  clusterN: 1,              // rank used by the "specific cluster" rule
  sort: { ...DEFAULT_SORT },
  sortPinned: false,        // true once the user clicks a header themselves
  filter: '',
  topN: 'all',
  expanded: new Set()       // row ids showing their full cluster list
};

const cleanCluster = (src) => {
  const out = {};
  for (const f of SET_FIELDS) if (Number.isFinite(src[f.field])) out[f.field] = src[f.field];
  return out;
};

/* A set entry is { clusters: [...], manual: null | {rank, field} }. A flat
 * single-cluster record (manual entry, CSV row) is wrapped into a one-item list
 * so every downstream rule works the same way. */
function normalizeSet(src) {
  if (!src) return null;
  const list = Array.isArray(src) ? src : Array.isArray(src.clusters) ? src.clusters : [src];
  const clusters = list.map(cleanCluster).filter((c) => Object.keys(c).length);
  if (!clusters.length) return null;
  const manual = src && src.manual && clusters[src.manual.rank] ? { ...src.manual } : null;
  return { clusters, manual };
}

function makeRow({ pdbId, complexLabel, tag, sets, demo }) {
  const clean = {};
  for (const s of COEFF_SETS) {
    const entry = normalizeSet(sets && sets[s.key]);
    if (entry) clean[s.key] = entry;
  }
  return {
    id: nextId++,
    pdbId: (pdbId || '').trim(),
    complexLabel: (complexLabel || '').trim(),
    tag: (tag || '').trim(),
    sets: clean,
    demo: !!demo
  };
}

const rowHasAnyValue = (row) => COEFF_SETS.some((s) => row.sets[s.key]);

/* ────────────────────────────────────────────────────────────────────
 * One-level undo
 *
 * The dangerous case this exists for: pasting with the wrong tab open
 * replaces a coefficient set you already had, and the confirmation reads
 * exactly like a normal one — the app cannot know your intent didn't match
 * your click. One step back is enough to catch that on the next glance.
 * ──────────────────────────────────────────────────────────────────── */

let undoSnapshot = null;   // { label, rows } captured before the last mutation

/* Rows are plain data (numbers, strings, arrays, plain objects), so a JSON
 * round trip is a sufficient deep copy. */
function snapshot() {
  undoSnapshot = { label: '', rows: JSON.parse(JSON.stringify(state.rows)) };
}

function labelUndo(text) {
  if (undoSnapshot) undoSnapshot.label = text;
}

function undoLast() {
  if (!undoSnapshot) return;
  const { label, rows } = undoSnapshot;
  state.rows = rows;
  undoSnapshot = null;          // single level: undo cannot be undone
  state.expanded.clear();
  render();
  setStatus('#table-status',
    `Undone: ${label.charAt(0).toLowerCase()}${label.slice(1)}. Table restored to ${rows.length} row${rows.length === 1 ? '' : 's'}.`, 'ok');
}

/* Pasting a second coefficient set for a job already in the table should extend
 * that row, not duplicate it. */
const sameJob = (row, pdbId, complexLabel) =>
  row.pdbId.toLowerCase() === pdbId.trim().toLowerCase() &&
  row.complexLabel.toLowerCase() === (complexLabel || '').trim().toLowerCase();

/* Real scores from a KRAS/TCR docking study, recorded before cluster tables were
 * captured — so each is a single value with no cluster rank or population. Nothing
 * is invented to fill the gaps. */
const DEMO_ROWS = [
  { pdbId: '8WUL', complexLabel: 'complex 3', tag: 'G12V', sets: { balanced: { center: -1149.73 }, electrostatic: { center: -1423.9 } } },
  { pdbId: '8I5D', complexLabel: '',          tag: 'G12V', sets: { balanced: { center:  -814.1 }, electrostatic: { center:  -772.4 } } },
  { pdbId: '7OW3', complexLabel: 'complex 1', tag: 'G12D', sets: { balanced: { center:  -752.9 }, electrostatic: { center:  -806.2 } } },
  { pdbId: '6ULN', complexLabel: '',          tag: 'G12D', sets: { balanced: { center:  -725.4 }, electrostatic: { center:  -816.4 } } },
  { pdbId: '6ULR', complexLabel: 'TCR 9',     tag: 'G12D', sets: { balanced: { center:  -698.2 }, electrostatic: { center:  -652.4 } } },
  { pdbId: '8I5C', complexLabel: 'complex 1', tag: 'G12V', sets: { balanced: { center:  -593.2 }, electrostatic: { center:  -681.3 } } }
];

/* ────────────────────────────────────────────────────────────────────
 * Pasted-text parsing
 *
 * A real results page repeats this block once per coefficient set:
 *
 *   Balanced
 *   Cluster  Members  Representative  Weighted Score
 *   0        123      Center          -716.1
 *                     Lowest Energy   -770.2
 *   1        114      Center          -754.7
 *                     Lowest Energy   -872.7
 *
 * A "Lowest Energy" line carries no cluster number or member count of its own —
 * it belongs to the most recently seen cluster row.
 * ──────────────────────────────────────────────────────────────────── */

const CLUSTER_ROW = /^\s*(\d+)\s+(\d+)\s+cent(?:er|re)\s+(-?\d+(?:\.\d+)?)\s*$/i;
const LOWEST_ROW = /^\s*lowest\s*energy\s+(-?\d+(?:\.\d+)?)\s*$/i;
const TABLE_HEADER = /cluster\s+members|representative|weighted\s*score/i;

const SHAPE_ERROR =
  'This doesn’t look like a ClusPro cluster table — expected a header row and numbered clusters ' +
  'like “0    123    Center    -716.1”, each optionally followed by its “Lowest Energy” line. ' +
  'Copy the Cluster Scores table from one coefficient set and paste it whole.';

/* Parse exactly one coefficient set's cluster table. Which set it belongs to is
 * NOT inferred — the copied text never says — so the caller supplies it from the
 * active entry tab.
 *
 * Strict: anything that isn't the expected shape is rejected outright, with a
 * reason, rather than partially imported. Returns
 *   { ok: true, clusters: [...], ignored: n }
 *   { ok: false, reason, message }
 */
function parseClusterTable(text) {
  const raw = text == null ? '' : String(text);
  if (!raw.trim()) {
    return { ok: false, reason: 'empty', message: 'Nothing to add — paste a cluster table first.' };
  }

  const lines = raw.split(/\r\n|[\r\n]/);   // \n, \r\n, and lone \r
  const clusters = [];
  let current = null;
  let ignored = 0;      // lines that are neither header, blank, cluster nor lowest
  let orphanLowest = 0; // a Lowest Energy line with no cluster above it

  for (const line of lines) {
    if (!line.trim()) continue;

    const row = line.match(CLUSTER_ROW);
    if (row) {
      current = { cluster: Number(row[1]), members: Number(row[2]), center: parseFloat(row[3]) };
      clusters.push(current);
      continue;
    }

    const low = line.match(LOWEST_ROW);
    if (low) {
      if (!current) { orphanLowest++; continue; }
      if (current.lowest === undefined) current.lowest = parseFloat(low[1]);
      continue;
    }

    if (TABLE_HEADER.test(line)) continue;
    ignored++;
  }

  if (!clusters.length) {
    return { ok: false, reason: 'shape', message: SHAPE_ERROR };
  }
  if (orphanLowest) {
    return {
      ok: false,
      reason: 'orphan',
      message: 'A “Lowest Energy” line appears before any numbered cluster, so it can’t be attached to one. ' +
               'Start the selection at the header row or at cluster 0.'
    };
  }
  /* Cluster ranks are listed in increasing order within one table. A repeat or a
   * step backwards means two tables were pasted together — which, with no set
   * labels in the text, cannot be split apart safely. */
  for (let i = 1; i < clusters.length; i++) {
    if (clusters[i].cluster <= clusters[i - 1].cluster) {
      return {
        ok: false,
        reason: 'multiple',
        message: 'This looks like more than one cluster table — the cluster numbers restart partway through. ' +
                 'Paste one coefficient set at a time, with its tab selected above.'
      };
    }
  }

  return { ok: true, clusters, ignored };
}

/* ────────────────────────────────────────────────────────────────────
 * Headline score selection
 * ──────────────────────────────────────────────────────────────────── */

/* Find the cluster ClusPro *numbered* n — not the nth item in the list. A table
 * copied from partway down starts at, say, cluster 2, and calling that "cluster 0"
 * would report one cluster's score under another's name.
 *
 * Records entered by hand or via CSV carry no cluster number at all; for those the
 * single record stands in for rank 0. */
function clusterByNumber(clusters, n) {
  const hit = clusters.find((c) => c.cluster === n);
  if (hit) return hit;
  if (clusters.every((c) => c.cluster === undefined)) return n === 0 ? clusters[0] || null : null;
  return null;
}

/* Returns { cluster, field, value, manual?, fallback? } or null.
 * A per-row manual override always wins over the global rule. */
function headlineFor(row, setKey) {
  const set = row.sets[setKey];
  if (!set || !set.clusters.length) return null;

  if (set.manual) {
    const c = set.clusters[set.manual.rank];
    if (c && Number.isFinite(c[set.manual.field])) {
      return { cluster: c, field: set.manual.field, value: c[set.manual.field], manual: true };
    }
  }

  if (state.headlineRule === 'globalmin') {
    let best = null;
    for (const c of set.clusters) {
      for (const f of ['center', 'lowest']) {
        if (Number.isFinite(c[f]) && (!best || c[f] < best.value)) best = { cluster: c, field: f, value: c[f] };
      }
    }
    return best;
  }

  const primary = state.headlineRule === 'c0center' ? 'center' : 'lowest';
  const secondary = primary === 'center' ? 'lowest' : 'center';
  const wanted = state.headlineRule === 'clusterN' ? state.clusterN : 0;
  const c = clusterByNumber(set.clusters, wanted);
  if (!c) return null;
  if (Number.isFinite(c[primary])) return { cluster: c, field: primary, value: c[primary] };
  /* Older rows hold only one of the two scores — use it rather than showing a gap,
   * and say so in the cell tooltip. */
  if (Number.isFinite(c[secondary])) return { cluster: c, field: secondary, value: c[secondary], fallback: true };
  return null;
}

function describeHeadline(h) {
  if (!h) return '';
  const where = h.cluster.cluster !== undefined ? `cluster ${h.cluster.cluster}` : 'the only record';
  const what = h.field === 'lowest' ? 'Lowest Energy' : 'Center';
  if (h.manual) return `Manual override: ${where}, ${what}.`;
  if (h.fallback) return `${where}, ${what} — no ${h.field === 'lowest' ? 'Center' : 'Lowest Energy'} value recorded.`;
  return `${where}, ${what}.`;
}

const overrideCount = () =>
  state.rows.reduce((n, r) => n + COEFF_SETS.filter((s) => r.sets[s.key] && r.sets[s.key].manual).length, 0);

/* ────────────────────────────────────────────────────────────────────
 * Columns / derived views
 * ──────────────────────────────────────────────────────────────────── */

function derived(row, setKey, field) {
  const h = headlineFor(row, setKey);
  if (!h) return undefined;
  if (field === 'score') return h.value;
  const v = h.cluster[field];
  return Number.isFinite(v) ? v : undefined;
}

const setsWithData = () => COEFF_SETS.filter((s) => state.rows.some((r) => r.sets[s.key]));

function activeColumns() {
  const cols = [
    { key: 'pdb', label: 'PDB ID', type: 'text', get: (r) => `${r.pdbId} ${r.complexLabel}`.trim() },
    { key: 'tag', label: 'Tag', type: 'text', get: (r) => r.tag }
  ];

  if (state.coeff === 'all') {
    /* Cross-set view: headline scores only. Cluster rank and population are
     * deliberately absent — each set is clustered separately, so putting them in
     * one row would imply a correspondence that does not exist. */
    for (const s of setsWithData()) {
      /* Same rule as the single-set view: a column only appears if some row
       * actually resolves a value for it under the current headline rule. */
      if (!state.rows.some((r) => derived(r, s.key, 'score') !== undefined)) continue;
      cols.push({
        key: `score:${s.key}`, label: s.label, type: 'num', better: 'low', badge: true,
        help: `Headline score, ${s.label} set (${ruleShort()}).`,
        get: (r) => derived(r, s.key, 'score')
      });
    }
    return cols;
  }

  const k = state.coeff;
  for (const f of TABLE_FIELDS) {
    if (state.rows.some((r) => derived(r, k, f.field) !== undefined)) {
      cols.push({
        key: `${f.field}:${k}`,
        label: f.field === 'score' ? `Score · ${ruleShort()}` : f.label,
        type: 'num', better: f.better, badge: f.badge, help: f.help,
        get: (r) => derived(r, k, f.field)
      });
    }
  }
  return cols;
}

const bestFirstDir = (col) => (col.type === 'text' ? 'asc' : col.better === 'high' ? 'desc' : 'asc');

function filteredRows() {
  const q = state.filter.trim().toLowerCase();
  if (!q) return state.rows.slice();
  return state.rows.filter((r) => `${r.pdbId} ${r.complexLabel} ${r.tag}`.toLowerCase().includes(q));
}

function sortRows(rows, cols) {
  const col = cols.find((c) => c.key === state.sort.key);
  if (!col) return rows.slice();
  const mul = state.sort.dir === 'asc' ? 1 : -1;

  return rows.slice().sort((a, b) => {
    let cmp;
    if (col.type === 'text') {
      const av = col.get(a);
      const bv = col.get(b);
      if (!av && bv) return 1;                       // blanks last, either direction
      if (av && !bv) return -1;
      cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' }) * mul;
    } else {
      const av = col.get(a);
      const bv = col.get(b);
      if (av === undefined && bv === undefined) cmp = 0;
      else if (av === undefined) return 1;           // missing values always sink
      else if (bv === undefined) return -1;
      else cmp = (av - bv) * mul;
    }
    return cmp || a.pdbId.localeCompare(b.pdbId) || a.id - b.id;
  });
}

function bestValues(rows, cols) {
  const best = {};
  for (const col of cols) {
    if (!col.badge) continue;
    for (const r of rows) {
      const v = col.get(r);
      if (v === undefined) continue;
      if (best[col.key] === undefined) best[col.key] = v;
      else best[col.key] = col.better === 'high' ? Math.max(best[col.key], v) : Math.min(best[col.key], v);
    }
  }
  return best;
}

function currentView() {
  const cols = activeColumns();

  const members = cols.find((c) => c.key.startsWith('members:'));
  const preferred = members || cols.find((c) => c.type === 'num') || cols[0];

  if (!state.sortPinned) {
    if (state.sort.key !== preferred.key) state.sort = { key: preferred.key, dir: bestFirstDir(preferred) };
  } else if (!cols.some((c) => c.key === state.sort.key)) {
    const field = state.sort.key.split(':')[0];
    const sameField = cols.find((c) => c.key.startsWith(`${field}:`));
    state.sort = sameField
      ? { key: sameField.key, dir: state.sort.dir }
      : { key: preferred.key, dir: bestFirstDir(preferred) };
  }

  const filtered = sortRows(filteredRows(), cols);
  const limit = state.topN === 'all' ? filtered.length : Number(state.topN);
  return { cols, filtered, best: bestValues(filtered, cols), shown: filtered.slice(0, limit) };
}

/* ────────────────────────────────────────────────────────────────────
 * Rendering
 * ──────────────────────────────────────────────────────────────────── */

const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, ...kids) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const k of kids) if (k != null) node.append(k);
  return node;
};

const fmtScore = (v) => (v === undefined ? '—' : v.toFixed(2));
const fmtCount = (v) => (v === undefined ? '—' : String(v));
const isCount = (col) => col.key.startsWith('members:') || col.key.startsWith('cluster:');

function applySort(key) {
  if (!key) return;
  const col = activeColumns().find((c) => c.key === key);
  if (!col) return;
  state.sortPinned = true;
  state.sort = state.sort.key === key
    ? { key, dir: state.sort.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: bestFirstDir(col) };
  render();
}

function render() {
  const { cols, filtered, best, shown } = currentView();

  renderEntryTabs();   // per-tab job counts change as rows are added
  renderNavCounts();
  renderCoeffBar();
  renderRuleBar();
  renderUndo();
  renderHead(cols);
  renderBody(shown, cols, best);

  const total = state.rows.length;
  $('#row-count').textContent = total === 0
    ? 'No jobs yet'
    : `Showing ${shown.length} of ${filtered.length} matching job${filtered.length === 1 ? '' : 's'}` +
      (filtered.length === total ? ` (${total} total)` : ` — ${total} total`);

  const unresolved = state.coeff === 'all' ? 0
    : state.rows.filter((r) => r.sets[state.coeff] && !headlineFor(r, state.coeff)).length;

  const hint = $('#coeff-hint');
  if (state.coeff === 'all') {
    hint.textContent = 'Cross-set view: headline scores only. Cluster rank and size are hidden here because each coefficient set is clustered independently — pick a single set to rank by cluster size.';
    hint.hidden = false;
  } else if (total && unresolved > 0) {
    /* Rows that hold data for this set but resolve to nothing under the current
     * rule — usually a table copied from partway down, so there is no cluster 0. */
    hint.textContent = `${unresolved} job${unresolved === 1 ? '' : 's'} in this set ${unresolved === 1 ? 'has' : 'have'} data but no cluster matching “${ruleShort()}”, so ${unresolved === 1 ? 'its score shows' : 'their scores show'} as “—”. Expand the row to see which clusters it actually has, or change the headline rule.`;
    hint.hidden = false;
  } else if (total && !cols.some((c) => c.key.startsWith('members:'))) {
    hint.textContent = 'No cluster sizes entered yet, so ranking falls back to score. Paste a full cluster table to rank the way ClusPro does.';
    hint.hidden = false;
  } else {
    hint.hidden = true;
  }

  const empty = $('#empty-state');
  if (total === 0) {
    empty.textContent = 'No jobs in the table. Paste a ClusPro results block, fill in the form, or import a CSV.';
    empty.hidden = false;
  } else if (shown.length === 0) {
    empty.textContent = state.filter ? `Nothing matches “${state.filter}”.` : 'No data for this coefficient set.';
    empty.hidden = false;
  } else {
    empty.hidden = true;
  }

  $('#clear-demo-btn').hidden = !state.rows.some((r) => r.demo);
  $('#clear-all-btn').hidden = total === 0;

  const tags = [...new Set(state.rows.map((r) => r.tag).filter(Boolean))].sort();
  $('#tag-list').replaceChildren(...tags.map((t) => el('option', { value: t })));
}

function renderCoeffBar() {
  const available = setsWithData();
  const options = (available.length ? available : COEFF_SETS).map((s) => ({ key: s.key, label: s.label }));
  if (options.length > 1) options.push({ key: 'all', label: 'All sets' });
  if (!options.some((o) => o.key === state.coeff)) state.coeff = options[0].key;

  $('#coeff-group').replaceChildren(...options.map((o) => {
    const btn = el('button', {
      type: 'button',
      className: `seg${state.coeff === o.key ? ' is-active' : ''}`,
      textContent: o.label
    });
    btn.dataset.coeff = o.key;
    btn.setAttribute('aria-pressed', String(state.coeff === o.key));
    return btn;
  }));
}

/* ────────────────────────────────────────────────────────────────────
 * Views
 *
 * One results table exists; it is moved into whichever entry view is open
 * rather than duplicated, so there is a single source of DOM and state.
 * ──────────────────────────────────────────────────────────────────── */

function showView(name) {
  state.view = VIEWS.includes(name) ? name : 'home';

  for (const v of VIEWS) $(`#view-${v}`).hidden = v !== state.view;
  for (const a of document.querySelectorAll('#main-nav a')) {
    const on = a.dataset.view === state.view;
    a.classList.toggle('is-active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }

  const table = $('#results-section');
  const slot = $(`#view-${state.view} .table-slot`);
  if (slot) {
    if (table.parentElement !== slot) slot.append(table);
    table.hidden = false;
  } else {
    table.hidden = true;    // Home is reference only
  }

  const hash = `#/${state.view}`;
  if (window.location.hash !== hash) window.location.hash = hash;
  renderNavCounts();
}

/* Job count on the nav, so the table is visibly still there from Home. */
function renderNavCounts() {
  const n = state.rows.length;
  for (const a of document.querySelectorAll('#main-nav a')) {
    const base = a.dataset.label || (a.dataset.label = a.textContent.trim());
    a.textContent = base;
    if (a.dataset.view !== 'home' && n) a.append(el('span', { className: 'nav-count', textContent: String(n) }));
  }
}

const viewFromHash = () => (window.location.hash || '').replace(/^#\/?/, '').split(/[?&]/)[0];

function renderUndo() {
  const btn = $('#undo-btn');
  btn.hidden = !undoSnapshot;
  if (!undoSnapshot) return;
  btn.textContent = `↩ Undo: ${undoSnapshot.label}`;
  btn.title = `Put the table back as it was before “${undoSnapshot.label}”. One step only.`;
}

function renderRuleBar() {
  $('#headline-rule').value = state.headlineRule;
  $('#rule-n-wrap').hidden = state.headlineRule !== 'clusterN';
  const n = overrideCount();
  $('#rule-note').textContent = n
    ? `Applies to every row except ${n} manual override${n === 1 ? '' : 's'}.`
    : 'Applies to every row. Expand a row to override it individually.';
}

function renderHead(cols) {
  const tr = el('tr');
  tr.append(el('th', { scope: 'col', className: 'expander' }, ''));
  for (const c of cols) {
    const sorted = state.sort.key === c.key;
    const arrow = el('span', {
      className: 'arrow',
      textContent: sorted ? (state.sort.dir === 'asc' ? '▲' : '▼') : '▲'
    });
    const th = el('th', {
      className: `sortable${c.type === 'num' ? ' num' : ''}${sorted ? ' is-sorted' : ''}`,
      title: c.help || 'Sort alphabetically',
      scope: 'col',
      tabIndex: 0
    }, c.label, arrow);
    th.dataset.key = c.key;
    th.setAttribute('aria-sort', sorted ? (state.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    tr.append(th);
  }
  tr.append(el('th', { scope: 'col', className: 'actions' }, ''));
  $('#results-head').replaceChildren(tr);
}

/* Which sets a row can show detail for in the current view. */
const detailSets = (row) =>
  (state.coeff === 'all' ? COEFF_SETS : [SET_BY_KEY[state.coeff]]).filter((s) => row.sets[s.key]);

function renderBody(rows, cols, best) {
  const out = [];

  for (const r of rows) {
    const tr = el('tr', { className: r.demo ? 'demo' : '' });
    const expandable = detailSets(r).length > 0;
    const open = state.expanded.has(r.id);

    const toggle = el('button', {
      type: 'button',
      className: `expander-btn${open ? ' is-open' : ''}`,
      textContent: open ? '▾' : '▸',
      title: open ? 'Hide cluster list' : 'Show every cluster'
    });
    toggle.dataset.expand = String(r.id);
    toggle.setAttribute('aria-expanded', String(open));
    tr.append(el('td', { className: 'expander' }, expandable ? toggle : ''));

    for (const col of cols) {
      if (col.key === 'pdb') {
        const td = el('td', { className: 'pdb' }, r.pdbId || '—');
        if (r.demo) td.append(el('span', { className: 'demo-flag', textContent: 'demo', title: 'Example row — cluster tables were not captured for this study' }));
        if (r.complexLabel) td.append(el('span', { className: 'complex', textContent: r.complexLabel }));
        tr.append(td);
        continue;
      }
      if (col.key === 'tag') {
        tr.append(el('td', { className: 'tag' }, r.tag ? el('span', { className: 'chip', textContent: r.tag }) : '—'));
        continue;
      }

      const v = col.get(r);
      const isBest = col.badge && v !== undefined && v === best[col.key];
      const setKey = col.key.split(':')[1];
      const h = headlineFor(r, setKey);
      const isScore = col.key.startsWith('score:');

      const td = el('td', {
        className: `num${v === undefined ? ' missing' : ''}${isBest ? ' is-best' : ''}${isScore && h && h.manual ? ' is-manual' : ''}`,
        title: isScore && h ? describeHeadline(h) : isBest ? `Top ${col.label} in the current filter` : ''
      }, isCount(col) ? fmtCount(v) : fmtScore(v));

      if (isScore && h && h.manual) td.append(el('span', { className: 'manual-flag', textContent: 'set', title: 'Manual override on this row' }));
      if (isBest) td.append(el('span', { className: 'star', textContent: '★' }));
      tr.append(td);
    }

    const del = el('button', { type: 'button', className: 'row-del', textContent: '×', title: `Remove ${r.pdbId}` });
    del.dataset.id = String(r.id);
    tr.append(el('td', { className: 'actions' }, del));
    out.push(tr);

    if (open && expandable) out.push(detailRow(r, cols.length + 2));
  }

  $('#results-body').replaceChildren(...out);
}

/* Full cluster list for a row, with each value clickable to pin it as the headline. */
function detailRow(row, span) {
  const wrap = el('div', { className: 'detail-wrap' });

  for (const s of detailSets(row)) {
    const set = row.sets[s.key];
    const h = headlineFor(row, s.key);

    const head = el('div', { className: 'detail-head' },
      el('span', { className: 'detail-title', textContent: s.label }),
      el('span', { className: 'detail-sub', textContent: `${set.clusters.length} cluster${set.clusters.length === 1 ? '' : 's'} · ${describeHeadline(h)}` })
    );
    if (set.manual) {
      const reset = el('button', { type: 'button', className: 'btn btn-ghost btn-tiny', textContent: 'Use global rule' });
      reset.dataset.reset = `${row.id}:${s.key}`;
      head.append(reset);
    }
    wrap.append(head);

    const body = set.clusters.map((c, rank) => {
      const tr = el('tr');
      tr.append(el('td', { className: 'num', textContent: String(rank) }));
      tr.append(el('td', { className: 'num', textContent: fmtCount(c.cluster) }));
      tr.append(el('td', { className: 'num', textContent: fmtCount(c.members) }));

      for (const field of ['center', 'lowest']) {
        const v = c[field];
        const chosen = h && h.cluster === c && h.field === field;
        const td = el('td', { className: `num${v === undefined ? ' missing' : ''}${chosen ? ' is-chosen' : ''}` });
        if (v === undefined) {
          td.append('—');
        } else {
          const btn = el('button', {
            type: 'button',
            className: 'pick-btn',
            textContent: v.toFixed(2),
            title: chosen ? 'Current headline score' : 'Use this value as the headline score for this row'
          });
          btn.dataset.pick = `${row.id}:${s.key}:${rank}:${field}`;
          td.append(btn);
        }
        tr.append(td);
      }
      return tr;
    });

    wrap.append(el('table', { className: 'detail-table' },
      el('thead', {}, el('tr', {},
        el('th', { scope: 'col' }, 'Rank'),
        el('th', { scope: 'col' }, 'Cluster'),
        el('th', { scope: 'col' }, 'Members'),
        el('th', { scope: 'col' }, 'Center'),
        el('th', { scope: 'col' }, 'Lowest Energy')
      )),
      el('tbody', {}, ...body)
    ));
  }

  const td = el('td', { className: 'detail-cell' }, wrap);
  td.colSpan = span;
  return el('tr', { className: 'detail-row' }, td);
}

function setStatus(sel, message, kind) {
  const node = $(sel);
  node.textContent = message || '';
  node.className = `status${kind ? ' ' + kind : ''}`;
}

/* ────────────────────────────────────────────────────────────────────
 * CSV in / out
 * ──────────────────────────────────────────────────────────────────── */

const CSV_HEADER_ALIASES = {
  pdb: ['pdbid', 'pdb', 'pdbcode', 'id', 'structure', 'receptor'],
  complex: ['complexlabel', 'complex', 'model', 'modellabel', 'label', 'name', 'job'],
  tag: ['tag', 'tags', 'group', 'category', 'mutation', 'mutationtype', 'annotation', 'note'],
  setname: ['coefficientset', 'coeffset', 'set', 'coefficients', 'scoringset']
};

function mapCsvHeader(header) {
  const norm = String(header || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const [type, names] of Object.entries(CSV_HEADER_ALIASES)) {
    if (names.includes(norm)) return { type };
  }
  const set = detectSetKey(header);
  const field = detectFieldKey(header);
  if (set && field) return { type: 'field', set, field };
  if (set) return { type: 'field', set, field: 'center' };   // bare "balanced" = centre score
  if (field) return { type: 'field', set: null, field };
  return null;
}

function toNumber(raw) {
  if (raw == null) return NaN;
  const s = String(raw).trim()
    .replace(/^[−–—]/, '-')   // U+2212 minus, en/em dash used as a minus
    .replace(/,/g, '');       // thousands separators
  /* Internal whitespace means this cell is not a single number — "1 2" must not
   * silently become 12. */
  if (!s || /\s/.test(s)) return NaN;
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(s)) return NaN;
  return parseFloat(s);
}

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename, rowsOfArrays) {
  const text = rowsOfArrays.map((r) => r.map(csvEscape).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8;' }));
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

/* The cluster a CSV row should carry. `strict` matches the on-screen view, so a
 * row showing “—” exports blank. Without it (the all-sets backup) fall back to the
 * first stored cluster, so a row whose headline is unresolved under the current
 * rule still exports its data instead of vanishing. */
function csvCluster(row, setKey, strict) {
  const h = headlineFor(row, setKey);
  if (h) return h.cluster;
  if (strict) return null;
  const set = row.sets[setKey];
  return set && set.clusters.length ? set.clusters[0] : null;
}

function exportCurrentView() {
  const { cols, shown } = currentView();
  if (!shown.length) {
    setStatus('#table-status', 'Nothing to export — the current view is empty.', 'warn');
    return;
  }

  let header;
  let body;
  if (state.coeff === 'all') {
    /* These are headline scores, which under most rules are Lowest Energy values —
     * so they must not be labelled "_center". This export is for a figure; use
     * "Export all sets" for a CSV that re-imports. */
    const keys = cols.filter((c) => c.key.startsWith('score:')).map((c) => c.key.split(':')[1]);
    header = ['pdb_id', 'complex_label', 'tag', 'headline_rule', ...keys.map((k) => `${SET_BY_KEY[k].csv}_headline`)];
    body = shown.map((r) => [
      r.pdbId, r.complexLabel, r.tag, ruleShort(),
      ...keys.map((k) => derived(r, k, 'score') ?? '')
    ]);
  } else {
    header = ['pdb_id', 'complex_label', 'tag', 'coefficient_set', 'headline_rule', ...SET_FIELDS.map((f) => f.field)];
    body = shown.map((r) => {
      const c = csvCluster(r, state.coeff, true) || {};
      const h = headlineFor(r, state.coeff);
      return [
        r.pdbId, r.complexLabel, r.tag, SET_BY_KEY[state.coeff].label,
        h && h.manual ? 'manual override' : ruleShort(),
        ...SET_FIELDS.map((f) => (Number.isFinite(c[f.field]) ? c[f.field] : ''))
      ];
    });
  }
  downloadCsv(`cluspro-rank-${state.coeff}-${stamp()}.csv`, [header, ...body]);
  setStatus('#table-status', `Exported ${shown.length} row${shown.length === 1 ? '' : 's'} in the current sort and filter.`, 'ok');
}

function exportAllSets() {
  if (!state.rows.length) {
    setStatus('#table-status', 'Nothing to export — the table is empty.', 'warn');
    return;
  }
  const sets = setsWithData();
  const header = ['pdb_id', 'complex_label', 'tag'];
  for (const s of sets) for (const f of SET_FIELDS) header.push(`${s.csv}_${f.field}`);

  const body = state.rows.map((r) => {
    const cells = [r.pdbId, r.complexLabel, r.tag];
    for (const s of sets) {
      const c = csvCluster(r, s.key, false) || {};
      for (const f of SET_FIELDS) cells.push(Number.isFinite(c[f.field]) ? c[f.field] : '');
    }
    return cells;
  });
  downloadCsv(`cluspro-rank-all-${stamp()}.csv`, [header, ...body]);
  setStatus('#table-status', `Exported all ${state.rows.length} rows across ${sets.length} coefficient set${sets.length === 1 ? '' : 's'} (headline cluster only).`, 'ok');
}

function importCsvFile(file) {
  if (typeof window.Papa === 'undefined') {
    setStatus('#csv-status', 'PapaParse failed to load (offline or blocked CDN), so CSV import is unavailable. Manual and paste entry still work.', 'err');
    return;
  }
  window.Papa.parse(file, {
    header: true,
    skipEmptyLines: 'greedy',
    complete: (results) => {
      const fields = results.meta.fields || [];
      const mapping = fields.map((f) => ({ field: f, map: mapCsvHeader(f) }));
      if (!mapping.some((m) => m.map)) {
        setStatus('#csv-status', `Could not recognise any columns in ${file.name}. Expected pdb_id, complex_label, tag, and per-set columns such as balanced_members.`, 'err');
        return;
      }

      snapshot();
      let added = 0;
      let skipped = 0;
      let unnamedSets = 0;
      const setCol = mapping.find((m) => m.map && m.map.type === 'setname');

      for (const raw of results.data) {
        const rec = { pdbId: '', complexLabel: '', tag: '', sets: {} };

        /* An unreadable coefficient_set value falls back to Balanced — count those
         * so the fallback is reported rather than silently misfiling rows. */
        let rowSet = 'balanced';
        if (setCol) {
          const named = detectSetKey(raw[setCol.field]);
          if (named) rowSet = named;
          else if (String(raw[setCol.field] ?? '').trim()) unnamedSets++;
        }

        for (const { field, map } of mapping) {
          if (!map || map.type === 'setname') continue;
          const cell = raw[field];
          if (map.type === 'pdb') rec.pdbId = String(cell ?? '').trim();
          else if (map.type === 'complex') rec.complexLabel = String(cell ?? '').trim();
          else if (map.type === 'tag') rec.tag = String(cell ?? '').trim();
          else {
            const n = toNumber(cell);
            if (!Number.isFinite(n)) continue;
            const key = map.set || rowSet;
            (rec.sets[key] = rec.sets[key] || {})[map.field] = n;
          }
        }

        const row = makeRow(rec);
        if (!row.pdbId && !rowHasAnyValue(row)) { skipped++; continue; }
        if (!row.pdbId) row.pdbId = '(unnamed)';
        state.rows.push(row);
        added++;
      }

      const unknown = mapping.filter((m) => !m.map).map((m) => m.field);
      if (!added) {
        undoSnapshot = null;   // nothing changed, so there is nothing to undo
        render();
        setStatus('#csv-status', `No usable rows in ${file.name} — every row was missing both a PDB ID and any numeric value.`, 'err');
        return;
      }
      labelUndo(`Imported ${added} row${added === 1 ? '' : 's'} from ${file.name}`);
      render();
      const bits = [`Imported ${added} row${added === 1 ? '' : 's'} from ${file.name}.`];
      if (skipped) bits.push(`${skipped} unusable row${skipped === 1 ? '' : 's'} skipped.`);
      if (unnamedSets) bits.push(`${unnamedSets} row${unnamedSets === 1 ? '' : 's'} had an unrecognised coefficient_set and were filed under Balanced.`);
      if (unknown.length) bits.push(`Ignored column${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`);
      setStatus('#csv-status', bits.join(' '), unnamedSets ? 'warn' : 'ok');
    },
    error: (err) => setStatus('#csv-status', `Could not read that file: ${err.message}`, 'err')
  });
}

/* ────────────────────────────────────────────────────────────────────
 * Entry form
 * ──────────────────────────────────────────────────────────────────── */

const inputId = (setKey, field) => `f-${setKey}-${field}`;

function buildSetInputs() {
  $('#set-inputs').replaceChildren(...COEFF_SETS.map((s) => {
    const tr = el('tr');
    tr.append(el('th', { scope: 'row', className: 'set-name', textContent: s.label }));
    for (const f of SET_FIELDS) {
      const input = el('input', {
        type: 'number',
        step: f.int ? '1' : 'any',
        min: f.int ? '0' : '',
        id: inputId(s.key, f.field),
        placeholder: f.field === 'cluster' ? '0' : f.field === 'members' ? '123' : '−000.00'
      });
      input.setAttribute('aria-label', `${s.label} ${f.label}`);
      tr.append(el('td', {}, input));
    }
    return tr;
  }));
}

/* Returns { sets, bad } — `bad` lists fields that must be whole numbers but aren't,
 * so a cluster rank of 1.5 is refused rather than stored and displayed. */
function readFormSets() {
  const sets = {};
  const bad = [];
  for (const s of COEFF_SETS) {
    const entry = {};
    for (const f of SET_FIELDS) {
      const v = toNumber($(`#${inputId(s.key, f.field)}`).value);
      if (!Number.isFinite(v)) continue;
      if (f.int && !Number.isInteger(v)) { bad.push(`${s.label} ${f.label}`); continue; }
      if (f.int && v < 0) { bad.push(`${s.label} ${f.label}`); continue; }
      entry[f.field] = v;
    }
    if (Object.keys(entry).length) sets[s.key] = entry;
  }
  return { sets, bad };
}

function clearSetInputs() {
  for (const s of COEFF_SETS) for (const f of SET_FIELDS) $(`#${inputId(s.key, f.field)}`).value = '';
}

/* ────────────────────────────────────────────────────────────────────
 * Paste tabs — the active tab is the sole source of truth for which
 * coefficient set a pasted table belongs to.
 * ──────────────────────────────────────────────────────────────────── */

function renderEntryTabs() {
  $('#entry-tabs').replaceChildren(...COEFF_SETS.map((s) => {
    const active = state.entrySet === s.key;
    const count = state.rows.filter((r) => r.sets[s.key]).length;
    const btn = el('button', { type: 'button', className: `tab${active ? ' is-active' : ''}` },
      s.label,
      count ? el('span', { className: 'tab-count', textContent: String(count) }) : null
    );
    btn.dataset.set = s.key;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(active));
    btn.title = `File pasted tables under ${s.label}${count ? ` — ${count} job${count === 1 ? '' : 's'} so far` : ''}`;
    return btn;
  }));

  const label = SET_BY_KEY[state.entrySet].label;
  $('#entry-set-name').textContent = label;
  $('#add-paste-btn').textContent = `Add to ${label}`;
}

function clearEntryFields() {
  $('#paste-input').value = '';
  $('#t-pdb').value = '';
  $('#t-complex').value = '';
  $('#t-tag').value = '';
}

/* Parse + validate + file the pasted table under the active tab. */
function addFromPaste() {
  const setKey = state.entrySet;
  const setLabel = SET_BY_KEY[setKey].label;

  const result = parseClusterTable($('#paste-input').value);
  if (!result.ok) {
    setStatus('#paste-status', result.message, 'err');
    return;
  }

  const pdbId = $('#t-pdb').value.trim();
  if (!pdbId) {
    setStatus('#paste-status', 'A PDB ID is required — it is what a pasted table gets filed against.', 'err');
    $('#t-pdb').focus();
    return;
  }

  const complexLabel = $('#t-complex').value;
  snapshot();
  const { row, isNew, replaced } = addOrMergeJob(pdbId, complexLabel, $('#t-tag').value, { [setKey]: result.clusters });

  clearEntryFields();

  const label = row.pdbId + (row.complexLabel ? ` (${row.complexLabel})` : '');
  const top = result.clusters[0];
  const detail = [`${result.clusters.length} cluster${result.clusters.length === 1 ? '' : 's'}`];
  if (top.members !== undefined) detail.push(`top: ${top.members} members`);
  if (top.lowest !== undefined) detail.push(`lowest ${top.lowest}`);
  const verb = isNew ? 'Added' : replaced ? `Replaced ${setLabel} for` : 'Updated';

  labelUndo(`${verb} ${label}`);   // "Replaced Balanced for 1LYZ" / "Added 7ABC"
  render();

  /* A table copied from partway down has no cluster 0, so the cluster-0 rules
   * will find nothing for this job. Say so rather than showing a silent dash. */
  const startsAt = result.clusters[0].cluster;
  const partial = startsAt !== undefined && startsAt !== 0;

  /* A replacement overwrote data that was already there — flag it differently
   * from a plain add, since the wrong-tab mistake looks identical otherwise. */
  setStatus('#paste-status',
    `${verb} ${label} — ${setLabel}: ${detail.join(', ')}.` +
    (replaced ? ' Previous data for that set was overwritten — use Undo if that was the wrong tab.' : '') +
    (partial ? ` Note: this table starts at cluster ${startsAt}, so cluster-0 rules will show no score for it — re-copy from the top of the table if you need one.` : '') +
    (!replaced && !partial ? ` Still on ${setLabel}; paste the next job.` : ''),
    replaced || partial ? 'warn' : 'ok');
  $('#paste-input').focus();
}

/* ────────────────────────────────────────────────────────────────────
 * Wiring
 * ──────────────────────────────────────────────────────────────────── */

/* Adding data for a PDB ID already in the table extends that job's row rather
 * than duplicating it — the same job's four coefficient sets arrive separately. */
function addOrMergeJob(pdbId, complexLabel, tag, sets) {
  const existing = state.rows.find((r) => sameJob(r, pdbId, complexLabel));
  if (existing) {
    let merged = 0;
    let replaced = false;
    for (const s of COEFF_SETS) {
      const entry = normalizeSet(sets[s.key]);
      if (!entry) continue;
      if (existing.sets[s.key]) replaced = true;
      existing.sets[s.key] = entry;
      merged++;
    }
    if (tag.trim()) existing.tag = tag.trim();
    return { row: existing, merged, replaced, isNew: false };
  }
  const row = makeRow({ pdbId, complexLabel, tag, sets });
  state.rows.push(row);
  return { row, merged: 0, replaced: false, isNew: true };
}

function init() {
  buildSetInputs();
  renderEntryTabs();

  /* Views: hash routing, so Back works and a view is linkable. */
  window.addEventListener('hashchange', () => showView(viewFromHash()));
  showView(viewFromHash() || 'home');
  DEMO_ROWS.forEach((r) => state.rows.push(makeRow({ ...r, demo: true })));

  /* a. Paste tabs — the active tab decides the coefficient set */
  $('#entry-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    state.entrySet = btn.dataset.set;
    renderEntryTabs();
    setStatus('#paste-status', '');
    $('#paste-input').focus();
  });

  $('#add-paste-btn').addEventListener('click', addFromPaste);

  $('#paste-clear-btn').addEventListener('click', () => {
    clearEntryFields();
    setStatus('#paste-status', '');
    $('#paste-input').focus();
  });

  /* b. Manual entry */
  $('#job-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const pdbId = $('#f-pdb').value.trim();
    const { sets, bad } = readFormSets();

    if (!pdbId) {
      setStatus('#form-status', 'A PDB ID is required.', 'err');
      $('#f-pdb').focus();
      return;
    }
    if (bad.length) {
      setStatus('#form-status', `Cluster rank and Members must be whole numbers of 0 or more — check ${bad.join(', ')}.`, 'err');
      return;
    }
    if (!Object.keys(sets).length) {
      setStatus('#form-status', 'Enter at least one value — cluster size or a score.', 'err');
      return;
    }

    snapshot();
    const { row, merged } = addOrMergeJob(pdbId, $('#f-complex').value, $('#f-tag').value, sets);
    const label = row.pdbId + (row.complexLabel ? ` (${row.complexLabel})` : '');

    $('#job-form').reset();
    clearSetInputs();
    labelUndo(`${merged ? 'Updated' : 'Added'} ${label}`);
    render();
    setStatus('#form-status', merged
      ? `Updated ${label} — added ${merged} coefficient set${merged === 1 ? '' : 's'} to the existing row.`
      : `Added ${label}.`, 'ok');
    $('#f-pdb').focus();
  });

  $('#job-form').addEventListener('reset', () => {
    setStatus('#form-status', '');
    setTimeout(clearSetInputs, 0);   // let the native reset finish first
  });

  /* c. CSV import + template */
  $('#csv-input').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) importCsvFile(file);
    e.target.value = '';
  });

  $('#template-btn').addEventListener('click', () => {
    const header = ['pdb_id', 'complex_label', 'tag'];
    for (const s of COEFF_SETS) for (const f of SET_FIELDS) header.push(`${s.csv}_${f.field}`);
    downloadCsv('cluspro-rank-template.csv', [
      header,
      ['8WUL', 'complex 3', 'G12V', 0, 123, -716.1, -770.2, ...Array(header.length - 7).fill('')]
    ]);
    setStatus('#csv-status', 'Blank template downloaded — fill it in and import it back.', 'ok');
  });

  /* Headline rule — recomputes every row from stored cluster data */
  const announceRule = () => {
    const n = overrideCount();
    setStatus('#table-status', `Headline score now ${ruleShort()}${n ? `, except ${n} manual override${n === 1 ? '' : 's'}` : ''}.`, 'ok');
  };

  $('#headline-rule').addEventListener('change', (e) => {
    state.headlineRule = e.target.value;
    render();
    announceRule();
  });

  $('#rule-n').addEventListener('input', (e) => {
    const n = Number(e.target.value);
    state.clusterN = Number.isInteger(n) && n >= 0 ? n : 0;
    render();
    announceRule();
  });

  /* Coefficient-set switch */
  $('#coeff-group').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg');
    if (!btn) return;
    state.coeff = btn.dataset.coeff;
    render();
  });

  /* Table interaction */
  $('#results-head').addEventListener('click', (e) => {
    const th = e.target.closest('th.sortable');
    if (th) applySort(th.dataset.key);
  });
  $('#results-head').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const th = e.target.closest('th.sortable');
    if (!th) return;
    e.preventDefault();
    applySort(th.dataset.key);
  });

  $('#results-body').addEventListener('click', (e) => {
    const expand = e.target.closest('[data-expand]');
    if (expand) {
      const id = Number(expand.dataset.expand);
      state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);
      render();
      return;
    }

    const pick = e.target.closest('[data-pick]');
    if (pick) {
      const [id, setKey, rank, field] = pick.dataset.pick.split(':');
      const row = state.rows.find((r) => r.id === Number(id));
      if (row && row.sets[setKey]) {
        row.sets[setKey].manual = { rank: Number(rank), field };
        render();
        setStatus('#table-status', `${row.pdbId}: headline pinned to cluster rank ${rank}, ${field === 'lowest' ? 'Lowest Energy' : 'Center'}.`, 'ok');
      }
      return;
    }

    const reset = e.target.closest('[data-reset]');
    if (reset) {
      const [id, setKey] = reset.dataset.reset.split(':');
      const row = state.rows.find((r) => r.id === Number(id));
      if (row && row.sets[setKey]) {
        row.sets[setKey].manual = null;
        render();
        setStatus('#table-status', `${row.pdbId}: back to the global rule (${ruleShort()}).`, 'ok');
      }
      return;
    }

    const del = e.target.closest('.row-del');
    if (del) {
      const id = Number(del.dataset.id);
      const gone = state.rows.find((r) => r.id === id);
      snapshot();
      state.rows = state.rows.filter((r) => r.id !== id);
      state.expanded.delete(id);
      labelUndo(`Removed ${gone ? gone.pdbId : 'a row'}`);
      render();
    }
  });

  $('#filter-input').addEventListener('input', (e) => {
    state.filter = e.target.value;
    render();
  });

  $('#topn-group').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg');
    if (!btn) return;
    state.topN = btn.dataset.topn;
    for (const b of $('#topn-group').querySelectorAll('.seg')) b.classList.toggle('is-active', b === btn);
    render();
  });

  /* Undo — button plus Ctrl/Cmd+Z, except while typing in a field, where the
   * browser's own text undo should win. */
  $('#undo-btn').addEventListener('click', undoLast);

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'z' && e.key !== 'Z') return;
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (!undoSnapshot) return;
    e.preventDefault();
    undoLast();
  });

  /* Export + clearing */
  $('#export-btn').addEventListener('click', exportCurrentView);
  $('#export-all-btn').addEventListener('click', exportAllSets);

  $('#clear-demo-btn').addEventListener('click', () => {
    const n = state.rows.filter((r) => r.demo).length;
    snapshot();
    state.rows = state.rows.filter((r) => !r.demo);
    labelUndo(`Removed ${n} demo row${n === 1 ? '' : 's'}`);
    render();
    setStatus('#table-status', `Removed ${n} demo row${n === 1 ? '' : 's'}.`, 'ok');
  });

  $('#clear-all-btn').addEventListener('click', () => {
    const n = state.rows.length;
    if (!window.confirm(`Remove all ${n} rows? Undo can bring them back until the next change — export first if you need them for good.`)) return;
    snapshot();
    labelUndo(`Cleared all ${n} row${n === 1 ? '' : 's'}`);
    state.rows = [];
    state.filter = '';
    state.coeff = 'balanced';
    state.sort = { ...DEFAULT_SORT };
    state.sortPinned = false;
    state.expanded.clear();
    $('#filter-input').value = '';
    render();
    setStatus('#table-status', 'Table cleared.', 'ok');
  });

  render();
}

document.addEventListener('DOMContentLoaded', init);

/* Exposed for the test suites; harmless in the browser. */
if (typeof window !== 'undefined') {
  window.ClusProRank = {
    parseClusterTable, detectSetKey, detectFieldKey, mapCsvHeader, toNumber,
    headlineFor, activeColumns, showView, state, COEFF_SETS, SET_FIELDS, HEADLINE_RULES,
    getUndo: () => undoSnapshot
  };
}
