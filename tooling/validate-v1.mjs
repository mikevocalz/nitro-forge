// Read-only v1 readiness check for Nitro Forge, modelled on NYC-Tron UI's
// tooling/release-readiness.mjs. It never changes a gate status.
//
//   node tooling/validate-v1.mjs                        stable: fails unless every gate passed
//   node tooling/validate-v1.mjs --version 1.0.0-rc.1   prerelease: reports, fails only on a malformed record
//   node tooling/validate-v1.mjs --output report.json   also writes the result as JSON
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const GATE_IDS = ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9"];
export const GATE_STATUSES = ["not-started", "in-progress", "blocked", "not-run", "passed"];
export const COMPAT_STATUSES = ["passed", "build-passed", "partial", "not-verified", "NOT RUN"];
const CLAIMS = new Set(["passed", "build-passed", "partial"]);
const FULL_SHA = /^[0-9a-f]{40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const json = path => JSON.parse(readFileSync(path, "utf8"));

/** Semver without build metadata; a prerelease suffix selects report-only mode (same rule as Tron). */
export function releaseChannel(version) {
  const number = "(?:0|[1-9][0-9]*)";
  const match = new RegExp("^" + number + "\\." + number + "\\." + number + "(?:-([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$").exec(version ?? "");
  if (!match || match[1]?.split(".").some(part => /^[0-9]+$/.test(part) && part.length > 1 && part.startsWith("0"))) {
    throw new Error("v1 readiness: invalid release version " + JSON.stringify(version));
  }
  return match[1] ? "prerelease" : "stable";
}

/** True when `path` is repository-relative, stays inside rootDir and names an existing file. */
export function evidenceExists(path, rootDir = root) {
  if (typeof path !== "string" || path === "" || isAbsolute(path)) return false;
  const base = realpathSync(rootDir);
  const full = resolve(base, path);
  if (!full.startsWith(base + sep) || !existsSync(full)) return false;
  const real = realpathSync(full);
  return real.startsWith(base + sep) && statSync(real).isFile();
}

/**
 * Checks the gate file. `errors` are malformed records (fatal in every mode).
 * A gate is `ready` only when it is passed with existing evidence, a full commit and a signing reviewer.
 */
export function validateGateFile(doc, { rootDir = root } = {}) {
  const errors = [];
  if (doc?.schemaVersion !== 1 || doc.gateSet !== "v1" || !Array.isArray(doc.gates)) {
    return { errors: ["gate file must be schemaVersion 1, gateSet v1, with a gates array"], gates: [] };
  }
  const seen = new Set();
  const gates = doc.gates.map(gate => {
    const id = gate?.id;
    const problems = [];
    if (!GATE_IDS.includes(id)) errors.push("unknown gate id " + JSON.stringify(id));
    else if (seen.has(id)) errors.push("duplicate gate " + id);
    seen.add(id);
    if (!GATE_STATUSES.includes(gate?.status)) errors.push(id + ": status must be one of " + GATE_STATUSES.join(", "));
    if (!Array.isArray(gate?.acceptance) || gate.acceptance.length === 0 || gate.acceptance.some(line => typeof line !== "string" || !line.trim())) {
      errors.push(id + ": acceptance text is missing");
    }
    if (gate?.status !== "passed" && (typeof gate?.statusReason !== "string" || !gate.statusReason.trim())) {
      errors.push(id + ": a gate that has not passed needs a statusReason");
    }
    const hasEvidence = gate?.evidence !== null && gate?.evidence !== undefined;
    const evidenceOk = hasEvidence && evidenceExists(gate.evidence, rootDir);
    if (hasEvidence && !evidenceOk) errors.push(id + ": evidence path does not exist in the repository: " + gate.evidence);
    const commitOk = typeof gate?.commit === "string" && FULL_SHA.test(gate.commit);
    if (gate?.commit !== null && gate?.commit !== undefined && !commitOk) errors.push(id + ": commit must be a full 40-character SHA");
    const reviewerOk = typeof gate?.reviewer === "string" && gate.reviewer.trim() !== "" && gate.reviewer !== gate.owner;
    if (!hasEvidence) problems.push("no evidence");
    if (!commitOk) problems.push("no commit");
    if (!reviewerOk) problems.push("no reviewer signature");
    if (gate?.status === "passed") {
      if (!evidenceOk || !commitOk || !reviewerOk || !DATE.test(gate.reviewedAt ?? "")) {
        errors.push(id + ": marked passed without existing evidence, a full commit, a reviewer other than the owner and a review date");
      }
    } else {
      problems.unshift("status " + (gate?.status ?? "missing"));
    }
    const ready = gate?.status === "passed" && evidenceOk && commitOk && reviewerOk;
    return { id, title: gate?.title ?? "", status: gate?.status ?? "missing", evidence: gate?.evidence ?? null,
      commit: gate?.commit ?? null, reviewer: gate?.reviewer ?? null, ready, problems: ready ? [] : problems,
      reason: gate?.statusReason ?? "" };
  });
  for (const id of GATE_IDS) if (!seen.has(id)) errors.push("missing gate " + id);
  return { errors, gates };
}

function checkReceipts(name, receipts, rootDir, errors) {
  if (!Array.isArray(receipts) || receipts.length === 0) {
    errors.push(name + ": a claimed status needs at least one receipt");
    return;
  }
  for (const receipt of receipts) {
    if (!evidenceExists(receipt?.path, rootDir)) errors.push(name + ": receipt path does not exist: " + receipt?.path);
    if (!FULL_SHA.test(receipt?.commit ?? "")) errors.push(name + ": receipt " + receipt?.path + " lacks a full commit");
    if (!DATE.test(receipt?.capturedAt ?? "")) errors.push(name + ": receipt " + receipt?.path + " lacks a capture date");
  }
}

function checkEntry(name, entry, rootDir, errors) {
  if (!COMPAT_STATUSES.includes(entry?.status)) {
    errors.push(name + ": status must be one of " + COMPAT_STATUSES.join(", "));
    return;
  }
  if (entry.build || entry.runtime) {
    for (const part of ["build", "runtime"]) {
      const sub = entry[part];
      if (!sub) continue;
      if (!COMPAT_STATUSES.includes(sub.status)) errors.push(name + "." + part + ": invalid status");
      else if (CLAIMS.has(sub.status)) checkReceipts(name + "." + part, sub.receipts, rootDir, errors);
    }
  } else if (CLAIMS.has(entry.status)) {
    checkReceipts(name, entry.receipts, rootDir, errors);
  }
  for (const receipt of entry.unboundReceipts ?? []) {
    if (!evidenceExists(receipt?.path, rootDir)) errors.push(name + ": unbound receipt path does not exist: " + receipt?.path);
  }
}

/** Every platform claim in compatibility.v1.json must point at an existing receipt at a stated commit. */
export function validateCompatibility(doc, { rootDir = root } = {}) {
  const errors = [];
  if (doc?.schemaVersion !== 2 || typeof doc.runtimes !== "object" || doc.runtimes === null) {
    return { errors: ["compatibility.v1.json must be schemaVersion 2 with a runtimes object"], entries: [] };
  }
  const entries = [];
  for (const [group, items] of [["runtimes", doc.runtimes], ["hostServices", doc.hostServices ?? {}]]) {
    for (const [key, entry] of Object.entries(items)) {
      checkEntry(group + "." + key, entry, rootDir, errors);
      entries.push({ name: key, status: entry?.status });
    }
  }
  return { errors, entries };
}

/** Read-only gate: prerelease reports, stable fails unless every gate is ready. Nothing changes status. */
export function validateV1({ version, gates, compatibility }, { rootDir = root } = {}) {
  const channel = version === undefined ? "stable" : releaseChannel(version);
  const gateResult = validateGateFile(gates, { rootDir });
  const compat = validateCompatibility(compatibility, { rootDir });
  const errors = [...gateResult.errors, ...compat.errors];
  const notReady = gateResult.gates.filter(gate => !gate.ready);
  const passed = gateResult.gates.length - notReady.length;
  let status;
  if (errors.length) status = "invalid";
  else if (channel === "prerelease") status = "candidate";
  else status = notReady.length ? "blocked" : "ready";
  return { status, channel, version: version ?? null, passed, total: GATE_IDS.length, gates: gateResult.gates,
    compatibility: compat.entries, errors,
    blockers: channel === "stable" ? notReady.map(gate => gate.id + ": " + gate.problems.join(", ")) : [],
    note: channel === "prerelease" ? "Prerelease report only. It does not claim any v1 gate or owner approval." : undefined };
}

const cell = (value, width) => {
  const text = String(value ?? "-");
  return text.length > width ? text.slice(0, width - 1) + "…" : text.padEnd(width);
};

/** Fixed-width per-gate table for the terminal. */
export function formatTable(result) {
  const head = cell("Gate", 5) + cell("Status", 12) + cell("Evidence", 54) + cell("Commit", 10) + cell("Reviewer", 10) + "Title";
  const rows = result.gates.map(gate => cell(gate.id, 5) + cell(gate.status, 12) + cell(gate.evidence, 54) +
    cell(gate.commit ? gate.commit.slice(0, 7) : "-", 10) + cell(gate.reviewer, 10) + gate.title);
  return [head, "-".repeat(head.length + 12), ...rows].join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!["--version", "--output"].includes(key) || !args[i + 1] || options[key] !== undefined) {
      console.error("usage: node tooling/validate-v1.mjs [--version <semver>] [--output <report.json>]");
      process.exit(2);
    }
    options[key] = args[i + 1];
  }
  let result;
  try {
    result = validateV1({
      version: options["--version"],
      gates: json(join(root, "docs/release/v1-readiness.json")),
      compatibility: json(join(root, "compatibility.v1.json")),
    });
    console.log(formatTable(result));
    console.log("");
    for (const error of result.errors) console.error("error: " + error);
    for (const blocker of result.blockers) console.log("blocked " + blocker);
    console.log("v1 readiness: " + result.status + " (" + result.channel + "); " + result.passed + "/" + result.total +
      " gates passed; no gate status changed.");
    if (result.status === "invalid" || result.status === "blocked") process.exitCode = 1;
  } catch (error) {
    result = { status: "invalid", version: options["--version"] ?? null, errors: [error.message] };
    console.error(error.message);
    process.exitCode = 1;
  }
  if (options["--output"]) writeFileSync(resolve(options["--output"]), JSON.stringify(result, null, 2) + "\n");
}
