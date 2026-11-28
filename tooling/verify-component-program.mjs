// Ported from NYC-Tron UI at 0e09d3be; original MIT license applies.
// Provenance: docs/completion/library-progress-source.json.
// Original notice: tooling/licenses/NYC-Tron-UI-MIT.txt.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCE_PIN = Object.freeze(JSON.parse(readFileSync(join(root, "docs/completion/library-progress-source.json"), "utf8")));
export const TRON_BLOB_PREFIX = `https://github.com/${SOURCE_PIN.repository}/blob/${SOURCE_PIN.revision}/`;
export const CANONICAL_BASELINE_SHA256 = "a1fd6593a84f899dc2946e6337fde7c59897607701516b6d64732d51d44b75db";
export const REQUIRED_PLATFORMS = Object.freeze(["ios", "android", "web", "macos", "windows", "visionos", "quest", "pico"]);
const implementationStatuses = new Set(["pending", "partial", "implemented", "implemented-external"]);
const acceptanceStatuses = new Set(["unverified", "accepted"]);
const platformStatuses = new Set(["unverified", "not-run", "partial", "blocked", "failed", "passed"]);
const ADDITION_ID = /^[A-Z]{1,3}-[0-9]{2,3}$/;
/**
 * Rows added after the frozen 341-row baseline, by gate. The list only grows:
 * an addition stays a stable blocker until it is accepted, and removing one
 * fails validation. Each names the gate that added it and its decision record
 * under docs/completion (T2: reports/T2-WINDOW-CHROME.md).
 */
export const RECORDED_ADDITION_IDS = Object.freeze(["W-01", "W-02", "W-03", "W-04", "W-05"]);
const fail = message => { throw new Error("Component program: " + message); };
const nonempty = value => typeof value === "string" && value.length > 0 && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);

function safePath(value) {
  return nonempty(value) && /^[A-Za-z0-9_@+./-]+$/.test(value) &&
    !value.startsWith("/") && value.split("/").every(part => part !== "" && part !== "." && part !== "..");
}
function stringList(value, label, required = false) {
  if (!Array.isArray(value) || required && value.length === 0 || value.some(item => !nonempty(item))) fail(label + " must be a nonempty-string list");
  if (new Set(value).size !== value.length) fail(label + " contains duplicates");
  return value;
}
function equalSet(actual, expected) {
  return actual.length === expected.length && new Set(actual).size === actual.length && expected.every(value => actual.includes(value));
}

/** The frozen upstream TSV is checked byte-for-byte, not just by row count. */
export function parseCanonicalBaseline(bytes) {
  if (createHash("sha256").update(bytes).digest("hex") !== CANONICAL_BASELINE_SHA256) fail("Canonical baseline SHA256 does not match the frozen original");
  const lines = bytes.toString().split(/\r?\n/).filter(Boolean);
  const columns = lines.shift().split("\t");
  const idIndex = columns.indexOf("id"), nameIndex = columns.indexOf("name");
  if (idIndex < 0 || nameIndex < 0) fail("Canonical baseline needs id/name columns");
  const rows = lines.map(line => { const values = line.split("\t"); return { id: values[idIndex], name: values[nameIndex] }; });
  if (rows.length !== 341 || new Set(rows.map(row => row.id)).size !== 341) fail("Canonical baseline must contain exactly 341 unique IDs");
  return rows;
}

function verifyTrackedFile(rootDir, path, sourceTree) {
  if (!sourceTree) return;
  const expected = sourceTree.get(path);
  if (!expected) fail("source file is not tracked by the pinned Tron tree: " + path);
  const bytes = readFileSync(join(rootDir, path));
  const actual = createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest("hex");
  if (actual !== expected) fail("source file differs from the pinned Tron blob: " + path);
}

function packageManifests(rootDir, sourceTree) {
  const packages = join(rootDir, "packages");
  if (!existsSync(packages)) return [];
  const paths = readdirSync(packages, { withFileTypes: true }).filter(entry => entry.isDirectory())
    .map(entry => join(packages, entry.name));
  paths.push(join(packages, "windows-fluent/rnw-fabric"), join(packages, "macos-appkit/spark"));
  return paths.filter(directory => existsSync(join(directory, "package.json"))).map(directory => {
    const path = directory.slice(rootDir.length + 1).split(sep).join("/") + "/package.json";
    verifyTrackedFile(rootDir, path, sourceTree);
    return { directory, manifest: JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) };
  });
}
function exportTargets(value) {
  if (typeof value === "string") return [value];
  return value && typeof value === "object" ? Object.values(value).flatMap(exportTargets) : [];
}

/**
 * Validate local ownership and explicit, pinned external ownership without
 * treating either source review as eight-platform runtime acceptance.
 * Canonical rows match the frozen baseline by ID and name. Rows added later
 * live in `additions` and pass the same per-row rules; `summary.additions`
 * counts them separately so the 341 canonical figures never change meaning.
 * Remote paths are syntactically checked here; reviewers verify their pinned
 * repository contents and record that provenance in the required report.
 */
export function validateComponentProgram(ledger, { rootDir = root, sourceRoot, sourceTree, recordedAdditions = RECORDED_ADDITION_IDS } = {}) {
  if (!sourceRoot) fail("a pinned Tron source checkout is required; supply --tron-source");
  sourceRoot = realpathSync(resolve(sourceRoot));
  rootDir = realpathSync(resolve(rootDir));
  const canonical = parseCanonicalBaseline(readFileSync(join(rootDir, "docs/completion/baseline-roster.tsv")));
  if (ledger?.schemaVersion !== 1) fail("Unknown ledger schema version");
  if (ledger.baselineSha256 !== CANONICAL_BASELINE_SHA256) fail("Ledger baseline hash changed");
  if (!Array.isArray(ledger.requiredPlatforms) || !equalSet(ledger.requiredPlatforms, REQUIRED_PLATFORMS)) {
    fail("Required platform scope must retain ios, android, web, macos, windows, visionos, quest and pico");
  }
  if (!Array.isArray(ledger.components) || ledger.components.length !== 341) fail("The canonical scope must retain all 341 IDs");
  const canonicalNames = new Map(canonical.map(row => [row.id, row.name]));
  const ids = new Set(), manifests = packageManifests(sourceRoot, sourceTree);
  const summary = { canonical: 341, localImplemented: 0, localPartial: 0, externalImplemented: 0, pending: 0, accepted: 0 };
  const localFile = (base, url, label) => {
    const sourcePath = tronSourcePath(url, base);
    const path = sourcePath.slice(base.length + 1);
    if (!safePath(path)) fail(label + " has an unsafe path: " + path);
    const basePath = join(sourceRoot, base), file = join(basePath, path);
    if (!existsSync(file) || !statSync(file).isFile()) fail(label + " has a missing file: " + path);
    if (!realpathSync(file).startsWith(realpathSync(basePath) + sep)) fail(label + " escapes its owned directory: " + path);
    verifyTrackedFile(sourceRoot, sourcePath, sourceTree);
  };
  const evidence = (paths, label, required = false) => {
    for (const path of stringList(paths ?? [], label, required)) localFile("docs/completion", path, label);
  };
  const validateExternal = row => {
    if (row.libraryScope !== false || row.sourceCandidates.length !== 0) fail(row.id + " external ownership cannot masquerade as local source");
    const owners = row.externalImplementation?.owners;
    if (!Array.isArray(owners) || !owners.length) fail(row.id + " needs pinned external owners");
    evidence(row.evidence, row.id + " external evidence", true);
    const seen = new Set();
    for (const owner of owners) {
      if (!owner || !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(owner.repository ?? "")) {
        fail(row.id + " has an unsafe external repository");
      }
      if (!/^[a-f0-9]{40}$/.test(owner.revision ?? "") || /^0{40}$/.test(owner.revision)) fail(row.id + " needs a pinned external revision (40 lowercase hex characters)");
      const identity = owner.repository.toLowerCase();
      if (seen.has(identity)) fail(row.id + " repeats an external repository owner");
      seen.add(identity);
      for (const path of stringList(owner.sourcePaths, row.id + " external sourcePaths", true)) {
        if (!safePath(path)) fail(row.id + " has an unsafe external source path: " + path);
      }
      for (const value of stringList(owner.publicExports, row.id + " external publicExports", true)) {
        if (/^(?:[./]|file:|https?:)/.test(value) || value.includes("\\") || value.split("/").some(part => part === ".." || part === ".")) {
          fail(row.id + " has an unsafe external public export: " + value);
        }
      }
    }
  };

  // One rule set for canonical rows and recorded additions; only identity differs.
  const validateRow = (row, counts) => {
    if (!/^P\d{2}$/.test(row.phase ?? "") || !nonempty(row.requirement) || typeof row.libraryScope !== "boolean") fail("Missing scope metadata for " + row.id);
    if (!implementationStatuses.has(row.implementationReview)) fail(row.id + " has an unknown implementation review status");
    if (!acceptanceStatuses.has(row.acceptance)) fail(row.id + " has an unknown acceptance status");
    stringList(row.sourceCandidates, row.id + " sourceCandidates");
    for (const source of row.sourceCandidates) {
      localFile("packages", source, row.id + " source candidate");
    }
    evidence(row.evidence, row.id + " evidence");
    if (row.remainingLibraryWork !== undefined) stringList(row.remainingLibraryWork, row.id + " remaining library work");
    if (["implemented", "implemented-external"].includes(row.implementationReview) && row.remainingLibraryWork?.length) fail(row.id + " still has unfinished library requirements");

    if (row.externalImplementation !== undefined) {
      if (!["pending", "implemented-external"].includes(row.implementationReview)) fail(row.id + " has external ownership on a local implementation status");
      validateExternal(row);
    }
    if (row.implementationReview === "implemented-external") {
      if (!row.externalImplementation) fail(row.id + " needs pinned external implementation metadata");
      counts.externalImplemented++;
    } else if (["implemented", "partial"].includes(row.implementationReview)) {
      if (!row.libraryScope || !row.sourceCandidates.length || !row.evidence?.length) fail(row.id + " needs owned source and evidence");
      if (row.implementationReview === "partial" && !row.remainingLibraryWork?.length) fail(row.id + " must name its remaining library work");
      const exported = row.sourceCandidates.some(source => {
        const dist = resolve(sourceRoot, tronSourcePath(source, "packages").replace("/src/", "/dist/").replace(/\.tsx?$/, ".js"));
        return manifests.some(({ directory, manifest }) => exportTargets(manifest.exports).some(target => resolve(directory, target) === dist));
      });
      if (!exported) fail(row.id + " needs an independent public export");
      if (row.implementationReview === "partial") counts.localPartial++;
      else counts.localImplemented++;
    } else counts.pending++;

    if (row.platformEvidence !== undefined && (!row.platformEvidence || typeof row.platformEvidence !== "object" || Array.isArray(row.platformEvidence))) fail(row.id + " has invalid platform evidence");
    for (const [platform, gate] of Object.entries(row.platformEvidence ?? {})) {
      if (!REQUIRED_PLATFORMS.includes(platform)) fail(row.id + " has an unknown evidence platform " + platform);
      if (!gate || !platformStatuses.has(gate.status)) fail(row.id + " has an unknown " + platform + " evidence status");
      evidence(gate.evidence, row.id + " " + platform + " evidence", gate.status === "passed");
    }
    if (row.acceptance === "accepted") {
      if (!["implemented", "implemented-external"].includes(row.implementationReview)) fail(row.id + " cannot be accepted before implementation review is complete");
      for (const platform of REQUIRED_PLATFORMS) {
        const gate = row.platformEvidence?.[platform];
        if (gate?.status !== "passed" || !gate.evidence?.length) fail(row.id + " cannot be accepted without " + platform + " proof");
      }
      counts.accepted++;
    }
  };

  for (const row of ledger.components) {
    if (!row || !row.id || ids.has(row.id)) fail("Duplicate/missing ID " + row?.id);
    if (!canonicalNames.has(row.id)) fail("Unknown/replaced canonical ID " + row.id);
    ids.add(row.id);
    if (row.name !== canonicalNames.get(row.id)) fail(row.id + " changed its canonical name");
    validateRow(row, summary);
  }
  if (!Array.isArray(ledger.additions)) fail("The ledger needs an additions list (empty when nothing was added)");
  const canonicalNameSet = new Set(canonicalNames.values()), additionNames = new Set();
  const additions = { total: ledger.additions.length, localImplemented: 0, localPartial: 0, externalImplemented: 0, pending: 0, accepted: 0 };
  for (const row of ledger.additions) {
    if (!row || !ADDITION_ID.test(row.id ?? "")) fail("Addition IDs use a letter prefix and a two- or three-digit number: " + row?.id);
    if (canonicalNames.has(row.id)) fail(row.id + " reuses a canonical ID; additions cannot replace or extend canonical rows");
    if (ids.has(row.id)) fail("Duplicate addition ID " + row.id);
    ids.add(row.id);
    if (!nonempty(row.name) || canonicalNameSet.has(row.name) || additionNames.has(row.name)) fail(row.id + " needs a name not used by a canonical row or another addition");
    additionNames.add(row.name);
    if (!/^T\d+$|^F\d+$/.test(row.gate ?? "")) fail(row.id + " needs the gate that added it (for example T2)");
    if (!nonempty(row.decision)) fail(row.id + " needs the decision record that scopes it");
    localFile("docs/completion", row.decision, row.id + " decision");
    validateRow(row, additions);
  }
  for (const id of recordedAdditions) {
    if (!ledger.additions.some(row => row.id === id)) fail("Recorded addition " + id + " was removed; additions can be added but not dropped");
  }
  summary.additions = additions;
  if ([...ids].filter(id => canonicalNames.has(id)).length !== canonical.length) fail("The canonical ID set changed");
  return summary;
}

/** Decode only exact immutable Tron links, never mutable refs or arbitrary hosts. */
export function tronSourcePath(url, base) {
  if (typeof url !== "string" || !url.startsWith(TRON_BLOB_PREFIX)) fail("source/evidence must use the pinned Tron commit URL");
  const path = url.slice(TRON_BLOB_PREFIX.length);
  if (!safePath(path) || !path.startsWith(base + "/")) fail("unsafe path or source outside " + base + "/");
  return path;
}

/** Pure transformation used for handoff accounting, without promoting statuses. */
export function adoptComponentProgram(source) {
  const ledger = structuredClone(source);
  ledger.canonicalPlan = "https://github.com/mikevocalz/nitro-forge/blob/dab27e177f05a747f2a234e3892f62e2f7b8c28b/docs/completion/PLAN.md";
  const link = (base, path) => {
    if (!safePath(path)) fail("unsafe source handoff path");
    return TRON_BLOB_PREFIX + base + path;
  };
  for (const row of [...ledger.components, ...ledger.additions]) {
    row.sourceCandidates = row.sourceCandidates.map(path => link("", path));
    row.evidence = (row.evidence ?? []).map(path => link("docs/completion/", path));
    if (row.decision !== undefined) row.decision = link("docs/completion/", row.decision);
    for (const gate of Object.values(row.platformEvidence ?? {})) gate.evidence = (gate.evidence ?? []).map(path => link("docs/completion/", path));
  }
  return ledger;
}

/** CI checks real tracked bytes at the exact recorded source revision. */
export function validatePinnedTronCheckout(sourceRoot, pin = SOURCE_PIN) {
  if (pin.repository !== "mikevocalz/NYC-Tron-UI" || !/^[a-f0-9]{40}$/.test(pin.revision)) fail("invalid Tron source identity");
  sourceRoot = realpathSync(resolve(sourceRoot));
  const git = args => execFileSync("git", ["-C", sourceRoot, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  if (realpathSync(git(["rev-parse", "--show-toplevel"])) !== sourceRoot || git(["rev-parse", "HEAD"]) !== pin.revision) fail("Tron checkout is not the pinned revision");
  if (git(["status", "--porcelain", "--untracked-files=all"])) fail("Tron proof checkout must be clean, including untracked files");
  for (const key of ["ledger", "validator", "tests"]) {
    if (!safePath(pin[key + "Path"])) fail("unsafe pinned source path");
    const bytes = readFileSync(join(sourceRoot, pin[key + "Path"]));
    if (createHash("sha256").update(bytes).digest("hex") !== pin[key + "Sha256"]) fail("Tron " + key + " source checksum differs");
  }
  const sourceTree = new Map(git(["ls-tree", "-rz", "HEAD"]).split("\0").filter(Boolean).map(entry => {
    const match = /^(\d+) blob ([a-f0-9]{40})\t(.+)$/.exec(entry);
    if (!match) fail("unexpected object in pinned Tron tree");
    return [match[3], match[2]];
  }));
  return { repository: pin.repository, revision: pin.revision, clean: true, sourceTree };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== "--tron-source" || !args[1]) fail("usage: --tron-source <clean checkout at recorded revision>");
    const sourceRoot = args[1];
    const { sourceTree } = validatePinnedTronCheckout(sourceRoot);
    const ledger = JSON.parse(readFileSync(join(root, "docs/completion/library-progress.json"), "utf8"));
    const result = validateComponentProgram(ledger, { sourceRoot, sourceTree });
    console.log(`Forge component program: ${result.canonical} canonical IDs; ${result.localImplemented} Tron implementations, ${result.localPartial} partial, ${result.externalImplemented} pinned external implementations, ${result.pending} pending; ${result.accepted} accepted with all eight platform proofs.`);
    console.log(`Recorded additions: ${result.additions.total}; ${result.additions.accepted} accepted. No acceptance or Forge completion status changed.`);
    console.log(`Tron source and direct evidence files resolved at ${SOURCE_PIN.revision}; nested report links and external-owner source contents are not checked by this validator.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
