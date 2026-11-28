import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SOURCE_PIN, TRON_BLOB_PREFIX, adoptComponentProgram,
  tronSourcePath, validatePinnedTronCheckout,
} from "../verify-component-program.mjs";

const ledger = JSON.parse(readFileSync(new URL("../../docs/completion/library-progress.json", import.meta.url), "utf8"));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

test("adoption preserves every row field while converting only source, evidence and decision locations", () => {
  const original = structuredClone(ledger);
  original.canonicalPlan = "https://github.com/mikevocalz/nitro-forge/blob/codex/complete-all-components/docs/completion/PLAN.md";
  for (const row of [...original.components, ...original.additions]) {
    row.sourceCandidates = row.sourceCandidates.map(url => tronSourcePath(url, "packages"));
    row.evidence = row.evidence.map(url => tronSourcePath(url, "docs/completion").slice("docs/completion/".length));
    if (row.decision) row.decision = tronSourcePath(row.decision, "docs/completion").slice("docs/completion/".length);
    for (const gate of Object.values(row.platformEvidence ?? {})) gate.evidence = gate.evidence.map(url => tronSourcePath(url, "docs/completion").slice("docs/completion/".length));
  }
  assert.equal(sha256(JSON.stringify(original, null, 2) + "\n"), SOURCE_PIN.ledgerSha256,
    "the migrated ledger must reconstruct the exact original bytes, including every acceptance value");
  assert.deepEqual(adoptComponentProgram(original), ledger);
  assert.equal(ledger.components.length, 341);
  assert.equal(ledger.additions.length, 5);
  assert.ok([...ledger.components, ...ledger.additions].every(row => row.acceptance === "unverified"));
  const forge = JSON.parse(readFileSync(new URL("../../docs/completion/components.json", import.meta.url), "utf8"));
  assert.deepEqual(forge.components.map(row => [row.id, row.name]), ledger.components.map(row => [row.id, row.name]));
  assert.deepEqual(Object.fromEntries(["unverified", "in-progress", "blocked"].map(status => [status, forge.components.filter(row => row.completion === status).length])),
    { unverified: 35, "in-progress": 274, blocked: 32 });
});

test("pinned URL resolution rejects mutable refs, other hosts, traversal, encoded paths and the wrong tree prefix", () => {
  assert.equal(tronSourcePath(TRON_BLOB_PREFIX + "packages/ui/src/Control.tsx", "packages"), "packages/ui/src/Control.tsx");
  for (const url of [
    TRON_BLOB_PREFIX.replace(SOURCE_PIN.revision, "main") + "packages/ui/src/Control.tsx",
    TRON_BLOB_PREFIX.replace("github.com", "example.com") + "packages/ui/src/Control.tsx",
    TRON_BLOB_PREFIX + "packages/../outside.ts", TRON_BLOB_PREFIX + "packages/%2e%2e/outside.ts",
    TRON_BLOB_PREFIX + "packages//Control.ts", TRON_BLOB_PREFIX + "packages/Control.ts?ref=main",
    TRON_BLOB_PREFIX + "docs/completion/report.md",
  ]) assert.throws(() => tronSourcePath(url, "packages"), /pinned Tron commit URL|unsafe path|outside/);
});

function checkoutFixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "forge-tron-pin-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = args => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git(["init", "--quiet"]);
  const pin = { repository: SOURCE_PIN.repository };
  for (const key of ["ledger", "validator", "tests"]) {
    pin[key + "Path"] = key + ".txt";
    writeFileSync(join(dir, key + ".txt"), key + " fixture\n");
    pin[key + "Sha256"] = sha256(readFileSync(join(dir, key + ".txt")));
  }
  git(["add", "."]);
  git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "Fixture"]);
  pin.revision = git(["rev-parse", "HEAD"]);
  return { dir, pin, git };
}

test("checkout provenance verifies revision, source checksums, clean tracked bytes and rejects untracked files", t => {
  const { dir, pin } = checkoutFixture(t);
  const proof = validatePinnedTronCheckout(dir, pin);
  assert.equal(proof.revision, pin.revision);
  assert.ok(proof.sourceTree.has("ledger.txt"));
  assert.throws(() => validatePinnedTronCheckout(dir, { ...pin, revision: "a".repeat(40) }), /pinned revision/);
  assert.throws(() => validatePinnedTronCheckout(dir, { ...pin, ledgerSha256: "a".repeat(64) }), /source checksum/);
  assert.throws(() => validatePinnedTronCheckout(dir, { ...pin, repository: "other/project" }), /source identity/);
  writeFileSync(join(dir, "ledger.txt"), "changed\n");
  assert.throws(() => validatePinnedTronCheckout(dir, pin), /must be clean/);
  writeFileSync(join(dir, "ledger.txt"), "ledger fixture\n");
  writeFileSync(join(dir, "untracked.txt"), "extra\n");
  assert.throws(() => validatePinnedTronCheckout(dir, pin), /must be clean/);
});

test("checkout provenance rejects a parent Git root and unsupported invocation has no default source checkout", t => {
  const { dir, pin } = checkoutFixture(t);
  mkdirSync(join(dir, "nested"));
  assert.throws(() => validatePinnedTronCheckout(join(dir, "nested"), pin), /pinned revision/);
  assert.throws(() => execFileSync(process.execPath, [new URL("../verify-component-program.mjs", import.meta.url).pathname],
    { stdio: ["ignore", "pipe", "pipe"] }), error => error.status === 1 && /usage: --tron-source/.test(error.stderr.toString()));
});

test("CI checks the adopted program against the same immutable source revision", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/completion-plan.yml", import.meta.url), "utf8");
  assert.ok(workflow.includes("ref: " + SOURCE_PIN.revision));
  assert.ok(workflow.includes("node tooling/verify-component-program.mjs --tron-source tron-program-source"));
  assert.ok(workflow.includes("node --test tooling/tests/component-program*.test.mjs"));
});
