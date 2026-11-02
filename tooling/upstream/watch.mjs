/**
 * ArtCraft observer: records NEW PUBLIC upstream HEADs in an observation-only
 * catalog. It never changes admitted source pins, Rust dependencies or SDK code.
 *
 * Usage:
 *   node tooling/upstream/watch.mjs --validate
 *   node tooling/upstream/watch.mjs --check   # exit code 2 if drift detected
 *   node tooling/upstream/watch.mjs --write   # update observed pins only
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceFile = join(root, "upstream.candidates.json");
const outputReport = join(root, "reports/upstream/last-observed-update.md");
const shaPattern = /^[a-f0-9]{40}$/;
const namePattern = /^[a-z][a-z0-9-]{1,80}$/;

export function validateCatalog(catalog) {
  if (catalog === null || typeof catalog !== "object"
    || catalog.schemaVersion !== 1 || !Array.isArray(catalog.candidates)) {
    throw new Error("Expected schemaVersion 1 and candidates array");
  }
  const names = new Set();
  for (const candidate of catalog.candidates) {
    if (candidate === null || typeof candidate !== "object"
      || typeof candidate.name !== "string" || !namePattern.test(candidate.name)
      || candidate.repository !== "storytold/" + candidate.name
      || candidate.baseRef !== "main"
      || typeof candidate.lastObservedSha !== "string"
      || !shaPattern.test(candidate.lastObservedSha)
      || (candidate.admittedSha !== null
        && (typeof candidate.admittedSha !== "string" || !shaPattern.test(candidate.admittedSha)))
      || !["unreviewed", "reviewed"].includes(candidate.licenseReview)
      || !["not-integrated", "source-admitted", "runtime-verified"].includes(candidate.runtimeStatus)
      || (candidate.runtimeStatus !== "not-integrated"
        && (candidate.admittedSha === null || candidate.licenseReview !== "reviewed"))) {
      throw new Error("Invalid candidate: " + String(candidate?.name ?? "<missing>"));
    }
    if (names.has(candidate.name)) throw new Error("Duplicate upstream candidate: " + candidate.name);
    names.add(candidate.name);
  }
  if (names.size === 0 || names.size > 25) throw new Error("Expected 1..25 candidates");
  return catalog;
}

export function compareObserved(catalog, observedHeads) {
  const changes = [];
  for (const entry of catalog.candidates) {
    const head = observedHeads[entry.name];
    if (typeof head !== "string" || !shaPattern.test(head)) {
      throw new Error("Missing valid observed head for " + entry.name);
    }
    if (entry.lastObservedSha !== head) {
      changes.push({
        name: entry.name,
        repository: entry.repository,
        before: entry.lastObservedSha,
        after: head,
        admittedSha: entry.admittedSha,
      });
    }
  }
  return changes;
}

export function updateObserved(catalog, changes) {
  const byName = new Map(changes.map((item) => [item.name, item.after]));
  return {
    ...catalog,
    candidates: catalog.candidates.map((entry) =>
      byName.has(entry.name)
        ? { ...entry, lastObservedSha: byName.get(entry.name) }
        : { ...entry },
    ),
  };
}

export function buildReport(changes) {
  const lines = [
    "# ArtCraft source changes requiring review",
    "",
    "This PR updates **observed** Git heads only. No code is admitted,",
    "compiled, linked, shipped, or enabled in an editor by this change.",
    "",
    "| Candidate | Previously observed | New observed | Compare | Admitted source |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const change of changes) {
    const url = "https://github.com/" + change.repository;
    const range = encodeURIComponent(change.before + "..." + change.after);
    lines.push(
      "| " + change.name + " | \`" + change.before.slice(0, 12) + "\`"
      + " | \`" + change.after.slice(0, 12) + "\`"
      + " | [review diff](" + url + "/compare/" + range + ")"
      + " | " + (change.admittedSha ? "\`" + change.admittedSha.slice(0, 12) + "\`" : "not admitted") + " |",
    );
  }
  lines.push(
    "",
    "Required follow-up: reviewer classifies merged upstream PRs, security,",
    "licenses/NOTICE and transitive dependencies; updates tested adapters in a",
    "separate PR after iOS/Android/WASM and document behavior evidence.",
    "",
  );
  return lines.join("\n");
}

async function fetchHead(entry) {
  // Fixed API origin and validated repo/branch; never fetch an arbitrary URL
  // out of untrusted source config. No credentials exposed in reports.
  const url = "https://api.github.com/repos/" + entry.repository
    + "/git/ref/heads/" + entry.baseRef;
  const token = process.env.GITHUB_TOKEN;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "NitroForge-ArtCraft-Observation-Watcher",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("GitHub API status " + response.status + " for " + entry.repository);
    const result = await response.json();
    if (result?.object?.type !== "commit" || !shaPattern.test(result.object.sha)) {
      throw new Error("Non-commit or malformed HEAD for " + entry.repository);
    }
    return [entry.name, result.object.sha];
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !["--validate", "--check", "--write"].includes(args[0])) {
    throw new Error("Usage: watch.mjs --validate|--check|--write");
  }
  const catalog = validateCatalog(JSON.parse(await readFile(sourceFile, "utf8")));
  if (args[0] === "--validate") {
    console.log("Validated " + catalog.candidates.length + " ArtCraft observation candidates (no network)");
    return;
  }
  const observed = Object.fromEntries(await Promise.all(catalog.candidates.map(fetchHead)));
  const changes = compareObserved(catalog, observed);
  console.log(changes.length + " upstream source changes since last observation");
  for (const change of changes) console.log(change.name + ": " + change.before + " -> " + change.after);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await writeFile(process.env.GITHUB_STEP_SUMMARY, buildReport(changes), { flag: "a" });
  }
  if (args[0] === "--check" && changes.length > 0) {
    process.exitCode = 2;
    return;
  }
  if (args[0] === "--write" && changes.length > 0) {
    const next = updateObserved(catalog, changes);
    validateCatalog(next);
    await writeFile(sourceFile, JSON.stringify(next, null, 2) + "\n");
    await mkdir(dirname(outputReport), { recursive: true });
    await writeFile(outputReport, buildReport(changes));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
