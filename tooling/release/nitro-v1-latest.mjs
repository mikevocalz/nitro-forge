/**
 * Nitro v1 release guard. Finds newest PUBLIC v1 release (including alphas)
 * from the official Margelo repository instead of npm's stable "latest" tag.
 *
 * This tool never updates versions or installs native code. CI failing after
 * a new release means "open a reviewed upgrade PR with device tests".
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const baselinePath = join(root, "tooling/release/nitro-v1-baseline.json");
export const NITRO_V1_NAMES = [
  "react-native-nitro-modules", "nitro-core", "nitrogen",
];

export function assertCoherentNitroV1(manifests, baseline, sourceProfiles = []) {
  assert.match(baseline, /^1\.0\.0-alpha\.nightly\.\d+\.g[0-9a-f]+$/,
    "Pin an exact published v1 nightly build, not a moving dist-tag");
  // Source compatibility is an explicit reviewed policy, never inferred from
  // an arbitrary peer range. It permits selected peers, not a second runtime
  // or a different generator in the mobile dependency graph.
  const acceptedPeers = new Map();
  for (const profile of sourceProfiles) {
    assert.match(profile.version, /^1\.0\.0-alpha\.nightly\.\d+\.g[0-9a-f]+$/,
      "Source compatibility profiles require an exact published nightly");
    assert.notEqual(profile.version, baseline, "A source profile must identify a distinct host core");
    assert.ok(!acceptedPeers.has(profile.manifest), "Duplicate source compatibility manifest");
    const manifest = manifests.find(item => item.path === profile.manifest);
    assert.ok(manifest, "Source compatibility manifest is missing: " + profile.manifest);
    const { pkg } = manifest;
    assert.equal(pkg.name, profile.packageName, "Source compatibility package identity changed");
    assert.equal(pkg.rnqnxNative?.schemaVersion, 1, "Source compatibility requires native package metadata");
    for (const platform of profile.platforms) {
      const native = pkg.rnqnxNative.platforms?.[platform];
      assert.deepEqual(native?.nitroCoreVersions, [profile.version],
        "Source compatibility native core changed for " + platform);
      assert.equal(native.requiresDispatcher, true,
        "Source compatibility requires the real dispatcher for " + platform);
    }
    assert.equal(pkg.peerDependenciesMeta?.["react-native-nitro-modules"]?.optional, true,
      "The mobile installer must remain optional for the source-only Qt profile");
    for (const name of NITRO_V1_NAMES) {
      assert.equal(pkg.devDependencies?.[name], baseline,
        "The mobile runtime and generator must remain at the accepted v1 release");
    }
    const peers = new Map();
    for (const name of profile.peerDependencies) {
      assert.ok(["nitro-core", "react-native-nitro-modules"].includes(name),
        "Source compatibility cannot change the generator requirement");
      const expected = profile.version + " || " + baseline;
      assert.equal(pkg.peerDependencies?.[name], expected,
        `${profile.manifest} peerDependencies:${name} must match the exact reviewed source profiles`);
      peers.set(name, expected);
    }
    acceptedPeers.set(profile.manifest, peers);
  }
  for (const { path, pkg } of manifests) {
    const declared = [];
    for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      for (const name of NITRO_V1_NAMES) {
        const version = pkg[section]?.[name];
        // Any specifier that can resolve to v1 (exact, ^1, ~1, >=1, v1, npm:...@1)
        // must be the exact baseline, except a reviewed source profile's exact
        // peer alternatives. A range would float to a newer nightly.
        if (typeof version === "string" && /(^|[\s@^~=<>v])1\./.test(version))
          declared.push({ name, version, section });
      }
    }
    for (const pin of declared) {
      const expected = pin.section === "peerDependencies"
        ? acceptedPeers.get(path)?.get(pin.name) ?? baseline : baseline;
      assert.equal(pin.version, expected,
        `${path} ${pin.section}:${pin.name} must match the accepted v1 release`);
    }
  }
}

export function assertSourceCompatibilityEvidence(profile, baseline, manifestSha256, evidence) {
  assert.equal(evidence.profiles.qtNitroCore, profile.version,
    "Source compatibility evidence does not match the exact host core");
  assert.equal(evidence.profiles.qtSourceCompatibility, profile.name,
    "Source compatibility evidence does not match the reviewed profile");
  assert.equal(evidence.profiles.mobileGenerator, baseline,
    "Source compatibility evidence must be renewed after a generator change");
  assert.equal(evidence.package.name, profile.packageName,
    "Source compatibility evidence has a different package identity");
  assert.equal(evidence.package.manifestSha256, manifestSha256,
    "Source compatibility package manifest changed; renew its packed native evidence");
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
    const bytes = await readFile(file);
    const pkg = JSON.parse(bytes.toString("utf8"));
    list.push({ path:file.slice(root.length + 1), pkg,
      manifestSha256:createHash("sha256").update(bytes).digest("hex") });
  }
  return list;
}

async function run() {
  const mode = process.argv[2];
  if (!["--offline","--online"].includes(mode) || process.argv.length !== 3) {
    throw new Error("Usage: nitro-v1-latest.mjs --offline|--online");
  }
  const { version, sourceCompatibilityProfiles = [] } = JSON.parse(await readFile(baselinePath,"utf8"));
  const manifests = await localManifests();
  assertCoherentNitroV1(manifests, version, sourceCompatibilityProfiles);
  for (const profile of sourceCompatibilityProfiles) {
    const evidence = JSON.parse(await readFile(join(root, profile.evidence), "utf8"));
    assertSourceCompatibilityEvidence(profile, version,
      manifests.find(item => item.path === profile.manifest).manifestSha256, evidence);
  }
  console.log("Nitro v1 mobile runtime and generator are exact-pinned to", version);
  for (const profile of sourceCompatibilityProfiles)
    console.log("Reviewed source profile:", profile.name, profile.version,
      "(one host core; no target-device acceptance claim)");
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
