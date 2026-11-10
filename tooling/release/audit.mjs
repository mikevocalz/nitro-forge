/**
 * NitroForge npm direct-dependency audit.
 *
 * --offline : collect repository manifests without network or mutation
 * --registry: compare every registry dependency with npm "latest" and write a
 *             reviewer report; do not install packages or change package.json.
 */
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const requested = process.argv.slice(2);

export function normalizeSpec(spec) {
  if (typeof spec !== "string") return null;
  const match = /^[~^]?(\d+)\.(\d+)\.(\d+)(?:-([\da-zA-Z.-]+))?$/.exec(spec);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), raw: spec,
    prerelease: match[4] !== undefined };
}
export function compareTriplet(a, b) {
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return Math.sign(a[key] - b[key]);
  }
  return 0;
}
export function summarizeDependency(name, spec, latest) {
  const installedRange = normalizeSpec(spec);
  const tagged = normalizeSpec(latest);
  if (!installedRange) return { name, spec, latest, status: "custom-or-unparseable" };
  if (!tagged || tagged.prerelease) return { name, spec, latest, status: "verify-registry-tag" };
  if (installedRange.prerelease) {
    return { name, spec, latest, status: "prerelease-channel-review" };
  }
  if (compareTriplet(tagged, installedRange) > 0) {
    return { name, spec, latest, status: "review-newer" };
  }
  if (compareTriplet(tagged, installedRange) < 0) {
    return { name, spec, latest, status: "pinned-ahead-of-latest" };
  }
  return { name, spec, latest, status: "up-to-date" };
}

async function manifests() {
  const paths = [join(root, "package.json")];
  for (const folder of ["apps", "packages"]) {
    const entries = await readdir(join(root, folder), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      paths.push(join(root, folder, entry.name, "package.json"));
    }
  }
  const result = [];
  for (const path of paths) {
    const pkg = JSON.parse(await readFile(path, "utf8"));
    result.push({ path: path.slice(root.length + 1), pkg });
  }
  return result;
}
export function collectExternal(packages) {
  const byName = new Map();
  for (const { path, pkg } of packages) {
    for (const group of ["dependencies", "devDependencies", "optionalDependencies"]) {
      for (const [name, spec] of Object.entries(pkg[group] ?? {})) {
        if (name.startsWith("@nitro-forge/") && typeof spec === "string" && spec.startsWith("workspace:")) continue;
        const items = byName.get(name) ?? [];
        items.push({ path, group, spec });
        byName.set(name, items);
      }
    }
  }
  return byName;
}

async function readRegistryLatest(name) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const endpoint = "https://registry.npmjs.org/" + encodeURIComponent(name);
    const res = await fetch(endpoint, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("npm " + res.status + " for " + name);
    const payload = await res.json();
    const latest = payload?.["dist-tags"]?.latest;
    if (typeof latest !== "string") throw new Error("Missing latest dist-tag for " + name);
    return latest;
  } finally {
    clearTimeout(timeout);
  }
}

function markdown(report) {
  const lines = [
    "# NitroForge npm latest audit",
    "",
    "Latest npm tags are **review opportunities**, not automatic installation choices.",
    "Expo SDK, RN, Skia v3/Graphite and WebGPU/Dawn versions must be upgraded as a",
    "tested compatibility family. Native builds, renderer tests and pnpm lock",
    "regeneration remain mandatory after any upgrade.",
    "",
    "| Package | Declared version(s) | npm latest | Review |",
    "| --- | --- | --- | --- |",
  ];
  for (const row of report) {
    const specs = [...new Set(row.uses.map((use) => use.spec))].join(", ");
    lines.push("| \`" + row.name + "\` | \`" + specs + "\` | \`" + row.latest
      + "\` | " + row.status + " |");
  }
  lines.push("", "The audit does not claim that packages are installed at latest versions.", "");
  return lines.join("\n");
}

async function main() {
  if (requested.length !== 1 || !["--offline", "--registry"].includes(requested[0])) {
    throw new Error("Usage: audit.mjs --offline|--registry");
  }
  const list = await manifests();
  const byName = collectExternal(list);
  const candidates = [...byName].filter(([name, uses]) =>
    !name.startsWith("node:") && uses.some(({ spec }) => normalizeSpec(spec)),
  ).sort(([a], [b]) => a.localeCompare(b));
  if (requested[0] === "--offline") {
    console.log("Found " + list.length + " package manifests, " + byName.size
      + " distinct external dependencies, " + candidates.length + " version-auditable names");
    return;
  }
  const report = [];
  const parallelism = 5;
  let cursor = 0;
  const worker = async () => {
    while (cursor < candidates.length) {
      const index = cursor++;
      const [name, uses] = candidates[index];
      try {
        const latest = await readRegistryLatest(name);
        const statuses = uses.map(({ spec }) => summarizeDependency(name, spec, latest).status);
        report.push({ name, uses, latest, status: [...new Set(statuses)].join(", ") });
      } catch (error) {
        report.push({ name, uses, latest: "unavailable", status: "registry-error: " + String(error.message ?? error) });
      }
    }
  };
  await Promise.all(Array.from({ length: parallelism }, worker));
  report.sort((a, b) => a.name.localeCompare(b.name));
  const out = join(root, "reports/npm/latest-review.md");
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, markdown(report), "utf8");
  console.log(markdown(report));
  const failures = report.filter((x) => x.latest === "unavailable");
  if (failures.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
