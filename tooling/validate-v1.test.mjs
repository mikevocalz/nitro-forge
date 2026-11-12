import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  GATE_IDS, evidenceExists, formatTable, releaseChannel, validateCompatibility, validateGateFile, validateV1,
} from "./validate-v1.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repo, "tooling/validate-v1.mjs");
const sha = "a".repeat(40);
const sandbox = mkdtempSync(join(tmpdir(), "validate-v1-"));
mkdirSync(join(sandbox, "docs/release/evidence"), { recursive: true });
writeFileSync(join(sandbox, "docs/release/evidence/receipt.txt"), "receipt\n");
after(() => rmSync(sandbox, { recursive: true, force: true }));

const gate = (id, overrides = {}) => ({
  id, title: "Gate " + id, owner: "F0", reviewerRole: "R2", acceptance: ["Acceptance for " + id + "."],
  status: "not-started", statusReason: "Not begun.", evidence: null, commit: null, reviewer: null, reviewedAt: null, ...overrides,
});
const passedGate = id => gate(id, { status: "passed", statusReason: undefined, evidence: "docs/release/evidence/receipt.txt",
  commit: sha, reviewer: "R2", reviewedAt: "2026-11-11" });
const gateFile = gates => ({ schemaVersion: 1, gateSet: "v1", gates });
const allPassed = () => gateFile(GATE_IDS.map(passedGate));
const compat = (runtimes = {}) => ({ schemaVersion: 2, runtimes, hostServices: {} });
const receipt = { path: "docs/release/evidence/receipt.txt", commit: sha, capturedAt: "2026-11-11" };

test("releaseChannel splits stable and prerelease like Tron", () => {
  assert.equal(releaseChannel("1.0.0"), "stable");
  assert.equal(releaseChannel("1.0.0-rc.1"), "prerelease");
  assert.throws(() => releaseChannel("1.0"));
  assert.throws(() => releaseChannel("1.0.0-rc.01"));
  assert.throws(() => releaseChannel("v1.0.0"));
});

test("evidenceExists rejects missing, absolute, escaping and directory paths", () => {
  assert.equal(evidenceExists("docs/release/evidence/receipt.txt", sandbox), true);
  assert.equal(evidenceExists("docs/release/evidence/missing.txt", sandbox), false);
  assert.equal(evidenceExists(join(sandbox, "docs/release/evidence/receipt.txt"), sandbox), false);
  assert.equal(evidenceExists("../outside.txt", sandbox), false);
  assert.equal(evidenceExists("docs/release/evidence", sandbox), false);
  assert.equal(evidenceExists(null, sandbox), false);
});

test("evidenceExists rejects a symlink that leaves the repository", () => {
  const outside = mkdtempSync(join(tmpdir(), "validate-v1-outside-"));
  writeFileSync(join(outside, "secret.txt"), "x");
  symlinkSync(join(outside, "secret.txt"), join(sandbox, "docs/release/evidence/link.txt"));
  try {
    assert.equal(evidenceExists("docs/release/evidence/link.txt", sandbox), false);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test("stable mode is ready only when every gate passed with evidence, commit and reviewer", () => {
  const result = validateV1({ gates: allPassed(), compatibility: compat() }, { rootDir: sandbox });
  assert.equal(result.status, "ready");
  assert.equal(result.passed, 9);
  assert.deepEqual(result.errors, []);
});

test("stable mode blocks on any gate that has not passed", () => {
  const gates = allPassed();
  gates.gates[1] = gate("F2", { status: "blocked", statusReason: "Tron rc.2 does not exist." });
  const result = validateV1({ version: "1.0.0", gates, compatibility: compat() }, { rootDir: sandbox });
  assert.equal(result.status, "blocked");
  assert.equal(result.passed, 8);
  assert.match(result.blockers[0], /^F2: status blocked/);
});

test("prerelease mode reports without failing", () => {
  const gates = gateFile(GATE_IDS.map(id => gate(id)));
  const result = validateV1({ version: "1.0.0-rc.1", gates, compatibility: compat() }, { rootDir: sandbox });
  assert.equal(result.status, "candidate");
  assert.equal(result.passed, 0);
  assert.deepEqual(result.blockers, []);
});

test("a passed gate without existing evidence, full commit or reviewer is invalid in every mode", () => {
  for (const broken of [
    { evidence: "docs/release/evidence/missing.txt" },
    { evidence: null },
    { commit: "0ad4ed2" },
    { reviewer: null },
    { reviewer: "F0" },
    { reviewedAt: null },
  ]) {
    const gates = allPassed();
    gates.gates[0] = { ...passedGate("F1"), ...broken };
    for (const version of ["1.0.0", "1.0.0-rc.1"]) {
      const result = validateV1({ version, gates, compatibility: compat() }, { rootDir: sandbox });
      assert.equal(result.status, "invalid", JSON.stringify(broken) + " " + version);
    }
  }
});

test("gate file structure: missing, duplicate, unknown ids and bad status are errors", () => {
  const ids = GATE_IDS.slice(1).map(id => gate(id));
  assert.ok(validateGateFile(gateFile(ids), { rootDir: sandbox }).errors.includes("missing gate F1"));
  const dup = validateGateFile(gateFile([...GATE_IDS.map(id => gate(id)), gate("F3")]), { rootDir: sandbox });
  assert.ok(dup.errors.includes("duplicate gate F3"));
  const unknown = validateGateFile(gateFile([...GATE_IDS.map(id => gate(id)), gate("F10")]), { rootDir: sandbox });
  assert.ok(unknown.errors.some(error => error.includes("F10")));
  const bad = validateGateFile(gateFile(GATE_IDS.map(id => gate(id, id === "F4" ? { status: "done" } : {}))), { rootDir: sandbox });
  assert.ok(bad.errors.some(error => error.startsWith("F4: status")));
  const empty = validateGateFile(gateFile(GATE_IDS.map(id => gate(id, id === "F5" ? { acceptance: [] } : {}))), { rootDir: sandbox });
  assert.ok(empty.errors.includes("F5: acceptance text is missing"));
  const noReason = validateGateFile(gateFile(GATE_IDS.map(id => gate(id, id === "F6" ? { statusReason: "" } : {}))), { rootDir: sandbox });
  assert.ok(noReason.errors.includes("F6: a gate that has not passed needs a statusReason"));
  assert.equal(validateGateFile({ schemaVersion: 2, gateSet: "v1", gates: [] }).errors.length, 1);
});

test("an unfinished gate may cite partial evidence, but the path must exist", () => {
  const ok = gateFile(GATE_IDS.map(id => gate(id, id === "F7" ? { status: "in-progress", evidence: "docs/release/evidence/receipt.txt" } : {})));
  assert.deepEqual(validateGateFile(ok, { rootDir: sandbox }).errors, []);
  const missing = gateFile(GATE_IDS.map(id => gate(id, id === "F7" ? { status: "in-progress", evidence: "nope.txt" } : {})));
  assert.ok(validateGateFile(missing, { rootDir: sandbox }).errors.some(error => error.startsWith("F7: evidence path")));
});

test("compatibility claims need an existing receipt at a full commit", () => {
  assert.deepEqual(validateCompatibility(compat({ ios: { status: "passed", receipts: [receipt] } }), { rootDir: sandbox }).errors, []);
  assert.deepEqual(validateCompatibility(compat({ web: { status: "NOT RUN" } }), { rootDir: sandbox }).errors, []);
  const none = validateCompatibility(compat({ ios: { status: "passed" } }), { rootDir: sandbox });
  assert.match(none.errors[0], /needs at least one receipt/);
  const shortSha = validateCompatibility(compat({ ios: { status: "build-passed", receipts: [{ ...receipt, commit: "3dd98cc" }] } }), { rootDir: sandbox });
  assert.match(shortSha.errors[0], /lacks a full commit/);
  const gone = validateCompatibility(compat({ ios: { status: "passed", receipts: [{ ...receipt, path: "gone.txt" }] } }), { rootDir: sandbox });
  assert.match(gone.errors[0], /does not exist/);
  const bad = validateCompatibility(compat({ ios: { status: "historically-tested" } }), { rootDir: sandbox });
  assert.match(bad.errors[0], /status must be one of/);
  const split = validateCompatibility(compat({ android: { status: "partial", build: { status: "build-passed", receipts: [receipt] },
    runtime: { status: "passed", receipts: [] } } }), { rootDir: sandbox });
  assert.match(split.errors[0], /android.runtime/);
  assert.equal(validateCompatibility({ schemaVersion: 1, runtimes: {} }).errors.length, 1);
});

test("formatTable prints one row per gate", () => {
  const result = validateV1({ version: "1.0.0-rc.1", gates: allPassed(), compatibility: compat() }, { rootDir: sandbox });
  const lines = formatTable(result).split("\n");
  assert.equal(lines.length, 11);
  assert.match(lines[2], /^F1 +passed +docs\/release\/evidence\/receipt\.txt +aaaaaaa +R2/);
});

test("the committed gate file and compatibility record are well formed", () => {
  const gates = JSON.parse(readFileSync(join(repo, "docs/release/v1-readiness.json"), "utf8"));
  const compatibility = JSON.parse(readFileSync(join(repo, "compatibility.v1.json"), "utf8"));
  const result = validateV1({ version: "1.0.0-rc.1", gates, compatibility });
  assert.deepEqual(result.errors, []);
  assert.equal(result.status, "candidate");
  assert.deepEqual(result.gates.map(gate => gate.id), GATE_IDS);
});

test("CLI: stable exits 1 with a table, prerelease exits 0", () => {
  const stable = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.equal(stable.status, 1);
  assert.match(stable.stdout, /^Gate +Status/m);
  assert.match(stable.stdout, /v1 readiness: blocked \(stable\)/);
  const pre = spawnSync(process.execPath, [script, "--version", "1.0.0-rc.1"], { encoding: "utf8" });
  assert.equal(pre.status, 0, pre.stderr);
  assert.match(pre.stdout, /v1 readiness: candidate \(prerelease\)/);
  const usage = spawnSync(process.execPath, [script, "--force"], { encoding: "utf8" });
  assert.equal(usage.status, 2);
});
