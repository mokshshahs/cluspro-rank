# ClusPro Rank

<img width="1123" height="553" alt="Screenshot 2026-08-23 at 6 45 21 PM" src="https://github.com/user-attachments/assets/675f1cdd-04da-4948-a4ac-d1ff5a98cf4c" />

Website URL: https://mokshshahs.github.io/cluspro-rank 

A single-page tool that turns manually-collected [ClusPro](https://cluspro.org) docking
results into one sortable, filterable comparison table.

ClusPro runs each candidate complex as its own job with its own results page, and offers no
way to compare jobs side by side — so people split-screen the results page against a
spreadsheet and copy numbers by hand. This replaces that step.

Everything runs client-side. No backend, no database, no network calls except the PapaParse
script tag. Nothing you enter leaves the browser tab.

## How it ranks, and why

**Ranking is by cluster size, not by score.** ClusPro ranks models by cluster population —
the native binding site tends to sit in the widest energy funnel, so it accumulates the most
docked structures — and the server's documentation *strongly discourages* judging models by
the PIPER weighted scores:

> "the best way to rank models is by cluster size, which is how the models are ranked coming
> out of ClusPro"

> "we **strongly** encourage you *to not judge models based on these scores* because that is
> not what the scoring was designed for"

The scoring exists to filter ~10⁹ sampled positions down to 1,000; among those final 1,000
it is too coarse to discriminate. The docs also state the scores are not binding affinities
and are not meant for comparison between different docking jobs.

So this tool sorts on **Members** by default and keeps Center score and Lowest energy as
secondary context. You can still sort by them — sometimes you need the number for a figure —
but the default doesn't encourage a comparison the method won't support.

## Headline scores

A results page gives a **full cluster table per coefficient set** — every cluster with its
rank, member count, `Center` score, and `Lowest Energy` score. The whole table is stored per
job. The main table shows one derived **headline** score, chosen by a rule you set above the
table:

| Rule | What it takes |
|---|---|
| **Cluster 0 — Lowest Energy** *(default)* | Best-scoring pose in the cluster ClusPro numbered 0 |
| **Cluster 0 — Center** | Centroid pose of the largest cluster |
| **Specific cluster — Lowest Energy** | The rank you type, for every job |
| **Global minimum** | Most negative value anywhere — any cluster, either score |
| **Manual override** | Per row: expand it and click any value to pin it |

Changing the rule recomputes every row instantly — the full cluster data is already stored,
so nothing is ever re-pasted. A manual override always beats the global rule, is flagged in
the cell, and is counted next to the rule selector. The Cluster and Members columns follow
whichever cluster the headline came from, so under *Global minimum* a row may report cluster
3 rather than 0.

Rules match ClusPro's **cluster number**, not position in your paste. A table copied from
partway down (starting at cluster 2, say) has no cluster 0, so cluster-0 rules report `—`
rather than passing off cluster 2's score as cluster 0's; the paste warns you at the time and
the table explains the blanks. Records typed by hand or imported from CSV carry no cluster
number and stand in for rank 0.

Expand any row (▸) to see every stored cluster and click a value to pin it.

Two consequences worth knowing:

- **Each coefficient set is clustered independently.** Cluster 0 in Balanced is not the same
  structure as cluster 0 in Electrostatic-favored, and the member counts differ. That's why
  the table shows one coefficient set at a time, with cluster rank and size alongside its own
  scores. The **All sets** view compares center scores across sets and deliberately hides
  cluster rank and size, which would imply a correspondence that doesn't exist.
- **Whichever cluster you report, report the same one everywhere.** The tool records the
  cluster rank and size in their own columns so the choice is visible in the table rather
  than buried in your notes.

Source: [ClusPro 2.0 help documentation](https://cluspro.org/help.php)

## Layout of the site

Four views, hash-routed so Back works and each is linkable:

- **How to use** (`#/home`) — the landing page: what the tool is, the ranking rationale, and the
  full walkthrough. No table here; it is reference only.
- **Paste** (`#/paste`) — coefficient-set tabs, paste box, and the results table below.
- **Manual** (`#/manual`) — the typed-entry grid, and the results table below.
- **CSV** (`#/csv`) — import and template download, and the results table below.

There is **one** results table. It is moved into whichever entry view is open rather than
duplicated, so all three views show the same rows, sort, filter, and headline rule. The job
count appears on the nav so the table is visibly still there while you are on Home.

## Running it

Open `index.html` in a browser. There is no build step.

To serve it locally instead:

```sh
python3 -m http.server 8000 -d .
# → http://localhost:8000
```

## Deploying

The repo root is the site. No config files, no build command.

- **GitHub Pages** — push, then Settings → Pages → deploy from branch, folder `/ (root)`.
- **Vercel** — import the repo and accept the defaults; framework preset "Other", no build
  command, output directory `.`.

## Using it

**Adding jobs — three ways:**

1. **Paste, under a coefficient-set tab** — the entry area has four tabs: Balanced,
   Electrostatic-favored, Hydrophobic-favored, VdW+Elec. **The open tab is the only thing
   that decides which set a pasted table is filed under.**

   This is not a convenience default — ClusPro's copyable Cluster Scores table
   (`Cluster / Members / Representative / Weighted Score`) contains no text naming its
   coefficient set; that label exists only in ClusPro's own page tabs, outside the selection.
   So the app cannot detect it and does not try. Pick the tab first, then paste.

   The parser reads every cluster row (`0  123  Center  -716.1`) and attaches each
   `Lowest Energy` line to the cluster stated above it, since those lines carry no rank or
   member count of their own. **Every cluster is kept.** After adding, the box and fields
   clear but the tab stays put, so you can work through every job on one set before moving to
   the next. Pasting another set for a PDB ID already in the table merges into that job's row;
   re-pasting the same set replaces it.

   **Validation is strict.** A paste must be a single cluster table with at least one numbered
   cluster. Prose, a header row alone, bare numbers, `Balanced: -812.4`, an orphan
   `Lowest Energy` line, or two tables at once are each rejected with a specific message and
   nothing is imported — no guess-parsing, no partial rows.

   There is no file upload: ClusPro's downloadable model PDBs contain only a generic header
   and ATOM coordinate records — no scores — so there is nothing in them to parse.
2. **Manual form** — for a job with no cluster table to paste. PDB ID (required), optional
   complex/model label, a free-text tag, then a grid of cluster / members / center / lowest
   per coefficient set. At least one value is required; cluster size alone is a valid row.
   It merges by PDB ID the same way pasting does.
3. **CSV import** — `pdb_id`, `complex_label`, `tag`, then per-set columns like
   `balanced_cluster`, `balanced_members`, `balanced_center`, `balanced_lowest`. A long
   format with a `coefficient_set` column also works, as does a bare `balanced` column (read
   as its center score). Header names are matched loosely (`PDB ID`, `Model`, `Mutation`,
   `Electrostatic-favoured`, `VdW+Elec`…), unrecognised columns are ignored and reported.

The **tag** field is deliberately free text. It holds mutation types in the demo data, but
it's just a label — use it for construct, batch, run number, or anything else.

**Reading the table:**

- Every header sorts, best-first on the first click. **Members sorts descending** (bigger
  cluster is better); scores sort **ascending** (more negative is stronger). Click again to
  flip.
- The sort follows your data until you choose a column yourself: once cluster sizes exist,
  ranking moves to Members automatically. After that, a column you click is respected — and
  it follows the same field when you switch coefficient sets.
- Rows missing the sorted value sink to the bottom in both directions.
- Only fields that actually contain data get a column.
- ★ marks the top value per column, recomputed against the current filter — so filtering to
  one tag shows the best row *within that group*.
- The search box matches PDB ID, complex label, or tag. *Top 5 / Top 10 / All* trims the view.

**Saving:** state is in memory only — no localStorage, by design, so the same code runs
embedded. CSV is the save/load mechanism:

- **Export table** — exactly what's on screen: current coefficient set, sort, filter, top-N,
  plus a `headline_rule` column recording which rule produced each score. This is the one for
  a paper or poster. In the **All sets** view its per-set columns are named `*_headline`, not
  `*_center`, because under most rules they hold Lowest Energy values.
- **Export all sets** — every row, every set, every field, ignoring filter and top-N.

Both write the **headline cluster's** record, not the whole cluster table — a CSV round trip
keeps the row you were looking at but collapses the full cluster list to one entry. Full
cluster tables live only in the session; re-paste to restore them.

A reload clears everything, so export before closing the tab.

**Undo:** one step, covering the last change — a paste, a manual add, a CSV import, a row
delete, *Clear demo data*, or *Clear all rows*. The button sits above the table and names what
it will reverse (*"Undo: Replaced Balanced for 1LYZ"*); <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Z</kbd>
does the same, except while typing in a field, where the browser's own text undo wins.

It exists mainly for one mistake: pasting with the wrong tab open silently replaces a
coefficient set you already had, and the confirmation looks identical to a normal one — the app
cannot know your intent didn't match your click. Replacements are therefore styled as warnings
rather than successes, and they say outright that data was overwritten.

**One step is not a safety net.** The next change discards what was undoable, and a rejected
paste or import creates no undo entry at all. Running dozens to hundreds of jobs, export to CSV
every 10–20 jobs as a checkpoint; undo catches the mistake you notice immediately, the export
catches the one you notice later.

**Demo data:** six rows of real scores from a KRAS/TCR docking study, marked `demo`. Only a
single score per set was recorded at the time, with no cluster table, so those rows have no
cluster rank or member count and nothing is invented to fill the gap — which is why the
Members column only appears once you enter data that has it, and why the table says so. *Clear demo data* removes just those rows; *Clear all rows* empties
the table.

## Tests

269 checks across three suites — the coefficient-set and field matchers, the cluster-table
parser and its rejection paths (the real ClusPro table in `tests/fixture.mjs` is the canonical
fixture), the headline rules, and the full UI in jsdom: tab-scoped pasting, cross-tab merging
into one row, malformed-paste rejection, partial per-job completeness, cluster-size ranking,
rule switching without re-pasting, row expansion, manual overrides, one-level undo
(including the wrong-tab replacement it exists for, and the keyboard shortcut), filtering, top-N,
add/validate/delete, both CSV exports with quoting, and the import path driven through the
real PapaParse build the page loads.

```sh
cd tests
npm install     # jsdom, test-only — the site itself has no dependencies
npm test
```

`tests/` is kept out of the site root so the deploy stays pure static; nothing there is
served or needed at runtime.

## Layout

```
index.html   markup
styles.css   styling, light + dark via prefers-color-scheme
app.js       parsing, state, ranking, rendering, CSV in/out
tests/       jsdom test suites (dev only) 
```

PapaParse 5.4.1 is loaded from cdnjs for CSV import. If it fails to load, import says so and
everything else — paste, manual entry, ranking, export — still works.

Not affiliated with ClusPro or Boston University.
