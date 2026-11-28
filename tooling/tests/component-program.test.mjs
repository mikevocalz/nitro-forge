import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CANONICAL_BASELINE_SHA256, RECORDED_ADDITION_IDS, REQUIRED_PLATFORMS, parseCanonicalBaseline, validateComponentProgram, TRON_BLOB_PREFIX } from "../verify-component-program.mjs";

const baselinePath = fileURLToPath(new URL("../../docs/completion/baseline-roster.tsv", import.meta.url));
const baselineBytes = readFileSync(baselinePath);
const canonical = parseCanonicalBaseline(baselineBytes);

function fixture(t) {
  const rootDir = mkdtempSync(join(tmpdir(), "nyc-tron-program-"));
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  mkdirSync(join(rootDir, "docs/completion/reports"), { recursive: true });
  mkdirSync(join(rootDir, "packages/example/src"), { recursive: true });
  copyFileSync(baselinePath, join(rootDir, "docs/completion/baseline-roster.tsv"));
  writeFileSync(join(rootDir, "docs/completion/reports/proof.md"), "# Test fixture evidence\n");
  writeFileSync(join(rootDir, "packages/example/src/Control.ts"), "export function Control() {}\n");
  writeFileSync(join(rootDir, "packages/example/package.json"), JSON.stringify({
    name: "@fixture/example", exports: { "./Control": { default: "./dist/Control.js" } },
  }));
  const ledger = {
    schemaVersion: 1, baselineSha256: CANONICAL_BASELINE_SHA256, requiredPlatforms: [...REQUIRED_PLATFORMS],
    components: canonical.map(({ id, name }) => ({
      id, name, phase: "P04", requirement: "Test the canonical capability.", libraryScope: true,
      sourceCandidates: [], evidence: [], implementationReview: "pending", acceptance: "unverified",
    })),
    additions: [],
  };
  const row = id => ledger.components.find(value => value.id === id);
  const local = row("A-01");
  Object.assign(local, { implementationReview: "implemented", sourceCandidates: [TRON_BLOB_PREFIX + "packages/example/src/Control.ts"], evidence: [TRON_BLOB_PREFIX + "docs/completion/reports/proof.md"] });
  const external = row("N-03");
  Object.assign(external, {
    libraryScope: false, implementationReview: "implemented-external", evidence: [TRON_BLOB_PREFIX + "docs/completion/reports/proof.md"],
    externalImplementation: { owners: [{
      repository: "mikevocalz/nitro-forge", revision: "a".repeat(40),
      sourcePaths: ["packages/muse/src/pose.ts"], publicExports: ["@nitro-forge/muse/pose"],
    }, {
      repository: "mikevocalz/viro", revision: "b".repeat(40),
      sourcePaths: ["src/TrackedPose.ts"], publicExports: ["TrackedPosePublisher"],
    }] },
  });
  return { rootDir, ledger, row, validate: (value, options = {}) => validateComponentProgram(value ?? ledger, { rootDir, sourceRoot: rootDir, recordedAdditions: [], ...options }) };
}

test("local and pinned external implementations count separately from pending external work", t => {
  const f = fixture(t), pending = f.row("N-10");
  Object.assign(pending, { libraryScope: false, evidence: [TRON_BLOB_PREFIX + "docs/completion/reports/proof.md"], externalImplementation: structuredClone(f.row("N-03").externalImplementation) });
  assert.deepEqual(f.validate(), { canonical: 341, localImplemented: 1, localPartial: 0, externalImplemented: 1, pending: 339, accepted: 0,
    additions: { total: 0, localImplemented: 0, localPartial: 0, externalImplemented: 0, pending: 0, accepted: 0 } });
  delete pending.externalImplementation.owners[0].revision;
  assert.throws(() => f.validate(), /pinned external revision/, "pending metadata must be valid without claiming completion");
});

test("external completion requires revision, actual source paths, public exports and an existing report", t => {
  const f = fixture(t);
  const mutations = [
    [row => delete row.externalImplementation, /metadata/],
    [row => row.externalImplementation.owners = [], /external owners/],
    [row => delete row.externalImplementation.owners[0].revision, /revision/],
    [row => row.externalImplementation.owners[0].sourcePaths = [], /sourcePaths/],
    [row => row.externalImplementation.owners[0].publicExports = [], /publicExports/],
    [row => row.evidence = [], /evidence/],
    [row => row.evidence = [TRON_BLOB_PREFIX + "docs/completion/reports/missing.md"], /missing file/],
  ];
  for (const [mutate, message] of mutations) {
    const ledger = structuredClone(f.ledger);
    mutate(ledger.components.find(row => row.id === "N-03"));
    assert.throws(() => f.validate(ledger), message);
  }
});

test("external repositories, paths and immutable revisions cannot be unsafe or mutable references", t => {
  const f = fixture(t);
  for (const repository of ["https://github.com/owner/repo", "../repo", "owner/repo/extra", "owner/repo?ref=main", "/owner/repo"]) {
    const ledger = structuredClone(f.ledger);ledger.components.find(row => row.id === "N-03").externalImplementation.owners[0].repository = repository;
    assert.throws(() => f.validate(ledger), /unsafe external repository/);
  }
  for (const path of ["../outside.ts", "/outside/source.ts", "C:\\source.ts", "packages/../source.ts", "packages/%2e%2e/source.ts", "packages//source.ts", "packages/./source.ts", "source.ts?ref=main"]) {
    const ledger = structuredClone(f.ledger);ledger.components.find(row => row.id === "N-03").externalImplementation.owners[0].sourcePaths = [path];
    assert.throws(() => f.validate(ledger), /unsafe external source path/);
  }
  for (const revision of ["main", "v1.0.0", "A".repeat(40), "a".repeat(39), "0".repeat(40)]) {
    const ledger = structuredClone(f.ledger);ledger.components.find(row => row.id === "N-03").externalImplementation.owners[0].revision = revision;
    assert.throws(() => f.validate(ledger), /pinned external revision/);
  }
});

test("external ownership cannot masquerade as local implementation or source", t => {
  const f = fixture(t);
  for (const mutate of [
    row => row.libraryScope = true,
    row => row.sourceCandidates = [TRON_BLOB_PREFIX + "packages/example/src/Control.ts"],
    row => row.implementationReview = "implemented",
  ]) {
    const ledger = structuredClone(f.ledger);mutate(ledger.components.find(row => row.id === "N-03"));
    assert.throws(() => f.validate(ledger), /external ownership/);
  }
});

test("local implementations need existing owned source, evidence and a public export", t => {
  const f = fixture(t);
  for (const [key, value, message] of [
    ["sourceCandidates", [TRON_BLOB_PREFIX + "packages/example/src/Missing.ts"], /missing file/],
    ["sourceCandidates", [TRON_BLOB_PREFIX + "packages/example/src/../src/Control.ts"], /unsafe path/],
    ["sourceCandidates", [], /owned source/],
    ["evidence", [], /owned source/],
    ["evidence", [TRON_BLOB_PREFIX + "docs/completion/../../outside.md"], /unsafe path/],
  ]) {
    const ledger = structuredClone(f.ledger);ledger.components[0][key] = value;
    assert.throws(() => f.validate(ledger), message);
  }
  writeFileSync(join(f.rootDir, "packages/example/package.json"), JSON.stringify({ name: "@fixture/example", exports: {} }));
  assert.throws(() => f.validate(), /independent public export/);
});

test("the exact 341 canonical IDs and names cannot be replaced while retaining the count", t => {
  const f = fixture(t);
  const duplicate = structuredClone(f.ledger);duplicate.components[1].id = duplicate.components[0].id;
  assert.throws(() => f.validate(duplicate), /Duplicate/);
  const replacement = structuredClone(f.ledger);replacement.components[1].id = "ZZ-99";
  assert.throws(() => f.validate(replacement), /replaced canonical ID/);
  const removed = structuredClone(f.ledger);removed.components.pop();
  assert.throws(() => f.validate(removed), /341/);
  const renamed = structuredClone(f.ledger);renamed.components[0].name = "UnrelatedControl";
  assert.throws(() => f.validate(renamed), /canonical name/);
});

test("baseline contents and ledger baseline identity remain frozen", t => {
  const f = fixture(t), changed = structuredClone(f.ledger);
  changed.baselineSha256 = "a".repeat(64);
  assert.throws(() => f.validate(changed), /baseline hash changed/);
  writeFileSync(join(f.rootDir, "docs/completion/baseline-roster.tsv"), baselineBytes.toString().replace("WorkspaceHost", "DifferentHost"));
  assert.throws(() => f.validate(), /baseline SHA256/);
});

test("the required eight-platform scope cannot shrink, duplicate or substitute another platform", t => {
  const f = fixture(t);
  for (const requiredPlatforms of [REQUIRED_PLATFORMS.slice(0, 7), [...REQUIRED_PLATFORMS.slice(0, 7), "linux"], [...REQUIRED_PLATFORMS.slice(0, 7), "ios"]]) {
    assert.throws(() => f.validate({ ...f.ledger, requiredPlatforms }), /Required platform scope/);
  }
});

test("unknown implementation, acceptance and platform result statuses are rejected", t => {
  const f = fixture(t);
  for (const [key, value, message] of [
    ["implementationReview", "done-ish", /unknown implementation/],
    ["acceptance", "accepted-without-device", /unknown acceptance/],
    ["platformEvidence", { ios: { status: "probably-passed" } }, /unknown ios evidence status/],
    ["platformEvidence", { linux: { status: "passed", evidence: [TRON_BLOB_PREFIX + "docs/completion/reports/proof.md"] } }, /unknown evidence platform/],
  ]) {
    const ledger = structuredClone(f.ledger);ledger.components[0][key] = value;
    assert.throws(() => f.validate(ledger), message);
  }
});

test("accepted rows require completed implementation and eight passing, existing proofs", t => {
  const f = fixture(t), row = f.row("A-01");row.acceptance = "accepted";
  assert.throws(() => f.validate(), /without ios proof/);
  row.platformEvidence = Object.fromEntries(REQUIRED_PLATFORMS.map(platform => [platform, { status: "passed", evidence: [TRON_BLOB_PREFIX + "docs/completion/reports/proof.md"] }]));
  assert.equal(f.validate().accepted, 1);
  row.platformEvidence.pico.status = "partial";
  assert.throws(() => f.validate(), /without pico proof/);
  row.platformEvidence.pico = { status: "passed", evidence: [] };
  assert.throws(() => f.validate(), /pico evidence/);
  row.platformEvidence.pico = { status: "passed", evidence: [TRON_BLOB_PREFIX + "docs/completion/reports/missing.md"] };
  assert.throws(() => f.validate(), /missing file/);
  row.platformEvidence.pico = { status: "passed", evidence: [TRON_BLOB_PREFIX + "docs/completion/reports/proof.md"] };
  row.implementationReview = "pending";
  assert.throws(() => f.validate(), /before implementation review/);
});

test("partial work must stay visible and cannot be labeled implemented", t => {
  const f = fixture(t), row = f.row("A-01");row.implementationReview = "partial";
  assert.throws(() => f.validate(), /remaining library work/);
  row.remainingLibraryWork = ["Finish the native callback contract."];
  assert.equal(f.validate().localPartial, 1);
  row.implementationReview = "implemented";
  assert.throws(() => f.validate(), /unfinished library requirements/);
});

const addition = (id, extra = {}) => ({
  id, name: "AddedControl" + id.replace("-", ""), phase: "P04", gate: "T2", decision: TRON_BLOB_PREFIX + "docs/completion/reports/proof.md",
  requirement: "Test an added capability.", libraryScope: true, sourceCandidates: [], evidence: [],
  implementationReview: "pending", acceptance: "unverified", ...extra,
});

test("additions are counted apart from the frozen 341 and follow the same row rules", t => {
  const f = fixture(t);
  f.ledger.additions = [
    addition("W-01", { implementationReview: "implemented", sourceCandidates: [TRON_BLOB_PREFIX + "packages/example/src/Control.ts"], evidence: [TRON_BLOB_PREFIX + "docs/completion/reports/proof.md"] }),
    addition("W-02"),
  ];
  const summary = f.validate();
  assert.equal(summary.canonical, 341);
  assert.equal(summary.localImplemented, 1, "canonical counts never include additions");
  assert.deepEqual(summary.additions, { total: 2, localImplemented: 1, localPartial: 0, externalImplemented: 0, pending: 1, accepted: 0 });
  for (const [mutate, message] of [
    [row => row.sourceCandidates = [TRON_BLOB_PREFIX + "packages/example/src/Missing.ts"], /missing file/],
    [row => row.evidence = [], /owned source and evidence/],
    [row => row.acceptance = "accepted", /without ios proof/],
    [row => row.platformEvidence = { linux: { status: "passed", evidence: [TRON_BLOB_PREFIX + "docs/completion/reports/proof.md"] } }, /unknown evidence platform/],
    [row => row.implementationReview = "done-ish", /unknown implementation/],
  ]) {
    const ledger = structuredClone(f.ledger);mutate(ledger.additions[0]);
    assert.throws(() => f.validate(ledger), message);
  }
  const accepted = structuredClone(f.ledger);
  Object.assign(accepted.additions[0], { acceptance: "accepted",
    platformEvidence: Object.fromEntries(REQUIRED_PLATFORMS.map(platform => [platform, { status: "passed", evidence: [TRON_BLOB_PREFIX + "docs/completion/reports/proof.md"] }])) });
  assert.equal(f.validate(accepted).additions.accepted, 1);
  assert.equal(f.validate(accepted).accepted, 0);
});

test("additions cannot replace, rename into or shadow canonical rows, and need a gate and decision record", t => {
  const f = fixture(t);
  for (const [extra, message] of [
    [{ id: "A-01" }, /reuses a canonical ID/],
    [{ id: "W01" }, /Addition IDs/],
    [{ id: "w-01" }, /Addition IDs/],
    [{ name: "WorkspaceHost" }, /name not used by a canonical row/],
    [{ gate: undefined }, /gate that added it/],
    [{ gate: "T2 maybe" }, /gate that added it/],
    [{ decision: undefined }, /decision record/],
    [{ decision: TRON_BLOB_PREFIX + "docs/completion/reports/missing.md" }, /missing file/],
    [{ decision: TRON_BLOB_PREFIX + "docs/completion/../../outside.md" }, /unsafe path/],
    [{ phase: "later" }, /scope metadata/],
  ]) {
    const ledger = structuredClone(f.ledger);ledger.additions = [addition("W-01", extra)];
    assert.throws(() => f.validate(ledger), message);
  }
  const duplicate = structuredClone(f.ledger);duplicate.additions = [addition("W-01"), addition("W-01", { name: "Other" })];
  assert.throws(() => f.validate(duplicate), /Duplicate addition ID/);
  const sameName = structuredClone(f.ledger);sameName.additions = [addition("W-01"), addition("W-02", { name: "AddedControlW01" })];
  assert.throws(() => f.validate(sameName), /another addition/);
  const missing = structuredClone(f.ledger);delete missing.additions;
  assert.throws(() => f.validate(missing), /additions list/);
});

test("recorded additions can grow but never be dropped, and the repository records the T2 rows", t => {
  const f = fixture(t);
  f.ledger.additions = [addition("W-01")];
  assert.throws(() => f.validate(f.ledger, { recordedAdditions: ["W-01", "W-02"] }), /W-02 was removed/);
  f.ledger.additions.push(addition("W-02"), addition("W-03"));
  assert.equal(f.validate(f.ledger, { recordedAdditions: ["W-01", "W-02"] }).additions.total, 3);
  assert.deepEqual(RECORDED_ADDITION_IDS, ["W-01", "W-02", "W-03", "W-04", "W-05"]);
  const repository = JSON.parse(readFileSync(fileURLToPath(new URL("../../docs/completion/library-progress.json", import.meta.url)), "utf8"));
  assert.deepEqual(repository.additions.map(row => [row.id, row.gate]), RECORDED_ADDITION_IDS.map(id => [id, "T2"]));
  assert.equal(repository.components.length, 341, "the canonical baseline stays frozen");
});

test("proof validation rejects untracked or altered blobs even when a local file exists", t => {
  const f = fixture(t);
  const paths = ["packages/example/package.json", "packages/example/src/Control.ts", "docs/completion/reports/proof.md"];
  const sourceTree = new Map(paths.map(path => {
    const bytes = readFileSync(join(f.rootDir, path));
    return [path, createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest("hex")];
  }));
  assert.equal(f.validate(undefined, { sourceTree }).localImplemented, 1);
  const source = join(f.rootDir, "packages/example/src/Control.ts");
  const original = readFileSync(source);
  writeFileSync(source, "export function Control() { return 'altered'; }\n");
  assert.throws(() => f.validate(undefined, { sourceTree }), /differs from the pinned Tron blob/);
  writeFileSync(source, original);
  sourceTree.delete("docs/completion/reports/proof.md");
  assert.throws(() => f.validate(undefined, { sourceTree }), /not tracked by the pinned Tron tree/);
});
