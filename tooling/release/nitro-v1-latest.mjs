/**
 * Nitro v1 release guard. Finds newest PUBLIC v1 release (including alphas)
 * from the official Margelo repository instead of npm's stable "latest" tag.
 *
 * This tool never updates versions or installs native code. CI failing after
 * a new release means "open a reviewed upgrade PR with device tests".
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const baselinePath = join(root, "tooling/release/nitro-v1-baseline.json");
export const NITRO_V1_NAMES = [
  "react-native-nitro-modules", "nitro-core", "nitrogen",
];

export function assertCoherentNitroV1(manifests, baseline) {
  assert.match(baseline, /^1\.0\.0-alpha\.nightly\.\d+\.g[0-9a-f]+$/,
    "Pin an exact published v1 nightly build, not a moving dist-tag");
  for (const { path, pkg } of manifests) {
    const declared = [];
    for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      for (const name of NITRO_V1_NAMES) {
        const version = pkg[section]?.[name];
        if (version?.startsWith("1.")) declared.push({ name, version, section });
      }
    }
    for (const pin of declared) {
      assert.equal(pin.version, baseline,
        `${path} ${pin.section}:${pin.name} must match the accepted v1 release`);
    }
  }
}

export function newestV1Release(releases) {
  if (!Array.isArray(releases)) throw new TypeError("GitHub release list unavailable");
  const candidates = releases.filter(release =>
    release && !release.draft &&
    typeof release.tag_name === "string" &&
    /^v?1\./.test(release.tag_name) &&
    typeof release.published_at === "string" &&
    Number.isFinite(Date.parse(release.published_at)),
  ).sort((a,b) => Date.parse(b.published_at) - Date.parse(a.published_at));
  const newest = candidates[0];
  if (!newest) throw new Error("No published Nitro v1 release available");
  return newest.tag_name.replace(/^v/, "");
}

async function localManifests() {
  const files = [join(root, "package.json")];
  const { readdir } = await import("node:fs/promises");
  for (const parent of ["apps", "packages"]) {
    for (const item of await readdir(join(root, parent), { withFileTypes: true })) {
      if (item.isDirectory()) files.push(join(root, parent, item.name, "package.json"));
    }
  }
  const list = [];
  for (const file of files) {
    const pkg = JSON.parse(await readFile(file, "utf8"));
    list.push({ path:file.slice(root.length + 1), pkg });
  }
  return list;
}

async function run() {
  const mode = process.argv[2];
  if (!["--offline","--online"].includes(mode) || process.argv.length !== 3) {
    throw new Error("Usage: nitro-v1-latest.mjs --offline|--online");
  }
  const { version } = JSON.parse(await readFile(baselinePath,"utf8"));
  assertCoherentNitroV1(await localManifests(), version);
  console.log("Nitro v1 family is exact-pinned to", version);
  if (mode === "--offline") return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let releases;
  try {
    const response = await fetch("https://api.github.com/repos/margelo/nitro/releases?per_page=50",{
      headers: {
        Accept:"application/vnd.github+json",
        "X-GitHub-Api-Version":"2022-11-28",
        "User-Agent":"NitroForge-v1-release-audit",
        ...(process.env.GITHUB_TOKEN ? { Authorization:"Bearer "+process.env.GITHUB_TOKEN } : {}),
      },
      signal:controller.signal,
    });
    if (!response.ok) throw new Error("GitHub releases API returned "+response.status);
    releases = await response.json();
  } finally {
    clearTimeout(timeout);
  }
  const newest = newestV1Release(releases);
  assert.equal(version, newest,
    "A newer Nitro v1 release is available. Update the three exact versions " +
    "through a reviewed compatibility PR, regenerate pnpm lockfile and run native tests.");
  console.log("Pinned Nitro v1 build matches the newest public release:", newest);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1;});
}
