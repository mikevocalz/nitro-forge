// BM25 retrieval check over registry title + description. No dependencies.
// Usage: node docs/agent-native/retrieval-eval.mjs [--copy copy.json] [--baseline copy-baseline.json] [--verbose] [--json]
// A proxy: `shadcn search` does its own matching and an agent may use semantic search. A low BM25 score
// means the words are not in the copy; it does not prove an embedding search would miss.
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const verbose = process.argv.includes("--verbose");
const K1 = 1.2, B = 0.75;
const STOP = new Set("a an the for of to and or with in on at by is it that this as from into using use need want i my me our".split(" "));

function stem(w) {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 3 && w.endsWith("es") && /(ss|x|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}
export function tokens(s) {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").toLowerCase()
    .split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w)).map(stem);
}
export function buildIndex(docs) {
  const rows = docs.map((d) => {
    const t = tokens(d.title + " " + d.description);
    const tf = new Map();
    for (const w of t) tf.set(w, (tf.get(w) || 0) + 1);
    return {id: d.id, len: t.length, tf};
  });
  const N = rows.length, avg = rows.reduce((a, r) => a + r.len, 0) / N, df = new Map();
  for (const r of rows) for (const w of r.tf.keys()) df.set(w, (df.get(w) || 0) + 1);
  return {rows, N, avg, df};
}
export function search(ix, q) {
  const qt = [...new Set(tokens(q))];
  return ix.rows.map((r) => {
    let s = 0;
    for (const w of qt) {
      const f = r.tf.get(w); if (!f) continue;
      const n = ix.df.get(w), idf = Math.log(1 + (ix.N - n + 0.5) / (n + 0.5));
      s += (idf * f * (K1 + 1)) / (f + K1 * (1 - B + (B * r.len) / ix.avg));
    }
    return {id: r.id, s};
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || (a.id < b.id ? -1 : 1));
}
function evaluate(docs, queries, label) {
  const ix = buildIndex(docs);
  const res = {label, n: 0, rec3: 0, rec5: 0, misses: []};
  for (const q of queries) {
    if (!q.relevant.length) continue;
    const r = search(ix, q.query), rel = new Set(q.relevant);
    const f = (k) => r.slice(0, k).filter((x) => rel.has(x.id)).length;
    res.n++; res.rec3 += f(3) / rel.size; res.rec5 += f(5) / rel.size;
    const rank = q.relevant.map((id) => { const i = r.findIndex((x) => x.id === id); return i < 0 ? "none" : i + 1; });
    if (verbose) console.log(`  ${label} ${q.id} rank=${rank.join(",")} "${q.query}"`);
    if (f(5) < rel.size || f(3) < rel.size) res.misses.push({id: q.id, query: q.query, rank, top3: r.slice(0, 3).map((x) => x.id)});
  }
  res.recall3 = res.rec3 / res.n; res.recall5 = res.rec5 / res.n;
  return res;
}
const load = (f) => JSON.parse(fs.readFileSync(path.resolve(here, f), "utf8"));
const Q = load("retrieval-queries.json").queries;
const copy = load(arg("--copy", "copy.json")).items ?? load(arg("--copy", "copy.json"));
const baseP = arg("--baseline", "copy-baseline.json");
const runs = [];
if (fs.existsSync(path.resolve(here, baseP))) runs.push(evaluate(load(baseP), Q, "before (handoff Purpose, first sentence)"));
runs.push(evaluate(copy, Q, "after (copy.json)"));
const pct = (x) => (100 * x).toFixed(1) + "%";
for (const r of runs) {
  console.log(`\n## ${r.label}: ${r.n} queries with an expected item`);
  console.log(`recall@3 ${pct(r.recall3)}   recall@5 ${pct(r.recall5)}`);
  for (const m of r.misses) console.log(`  miss ${m.id} "${m.query}" rank=${m.rank.join(",")} top3=${m.top3.join(" | ")}`);
}
const ix = buildIndex(copy);
console.log("\n## unsatisfiable queries, top 3 hits from the 17 items (a hit here is a false lead, not a pass)");
for (const q of Q.filter((q) => !q.relevant.length))
  console.log(`  ${q.id} "${q.query}" -> ${search(ix, q.query).slice(0, 3).map((x) => `${x.id} (${x.s.toFixed(1)})`).join(" | ") || "no match"}`);
// Length gate
const bad = copy.filter((c) => c.description.length > 140);
if (bad.length) { console.log("\nOVER 140:", bad.map((b) => `${b.id} ${b.description.length}`).join(", ")); process.exitCode = 1; }

// Prerequisite check: an agent must learn the prerequisite from the description. Source: "Requires" lines in 03-design-handoff.md.
const NEEDS = {
  "forge-workspace": ["StudioUIProvider", "studio-layout"], "forge-document-stage": ["StudioUIProvider", "studio-layout"],
  "quill-text-editor": ["StudioUIProvider"], "prism-editor": ["StudioUIProvider", "ignition", "editor-controls"], "prism-canvas": ["StudioUIProvider"],
  "persona-turret": ["StudioUIProvider"], "persona-composer": ["StudioUIProvider"], "workspace-utilities": ["studio-layout"],
  "nyc-tron-host": ["@nyc-tron"], "forge-icon": ["react-native-svg"], "forge-icon-button": ["forge-icon"],
};
function prereqs(docs, label) {
  const by = new Map(docs.map((d) => [d.id, (d.title + " " + d.description).toLowerCase()]));
  let total = 0, ok = 0; const gaps = [];
  for (const [id, req] of Object.entries(NEEDS)) for (const r of req) {
    total++; if (by.get(id)?.includes(r.toLowerCase())) ok++; else gaps.push(`${id}:${r}`);
  }
  console.log(`\n## prerequisites stated in title + description, ${label}: ${ok}/${total}${gaps.length ? "  missing " + gaps.join(", ") : ""}`);
}
if (fs.existsSync(path.resolve(here, baseP))) prereqs(load(baseP), "before");
prereqs(copy, "after");
