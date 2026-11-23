import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { validateGateFile } from "../validate-v1.mjs";

const json = path => JSON.parse(readFileSync(new URL("../../" + path, import.meta.url), "utf8"));

test("F7 owns the application program, keeps every ledger platform column, scopes v1 to ios, android and web, and pins the consumer release", () => {
  const readiness = json("docs/release/v1-readiness.json"), gate = readiness.gates.find(gate => gate.id === "F7");
  const program = gate.componentProgram;
  const completion = json(program.completionLedger), adopted = json(program.adoptedLedger);
  assert.equal(program.owner, "Nitro Forge");
  assert.equal(program.baselineRows, completion.components.length);
  assert.equal(program.baselineRows, adopted.components.length);
  assert.equal(program.additionalRows, adopted.additions.length);
  assert.deepEqual(program.ledgerPlatforms, completion.requiredPlatforms);
  assert.deepEqual(program.ledgerPlatforms, adopted.requiredPlatforms);
  const scope = program.v1Scope;
  assert.deepEqual([...scope.platforms, ...scope.postV1Platforms].sort(), [...program.ledgerPlatforms].sort());
  assert.deepEqual(scope.platforms, ["ios", "android", "web"]);
  assert.ok(gate.acceptance.some(text => text.includes("Owner decision D2") && text.includes(scope.rows)));
  assert.equal(program.consumerReleasePin, "tooling/nyc-tron.json");
  assert.ok(json(program.consumerReleasePin).tag);
  assert.ok(gate.acceptance.some(text => text.includes("Forge owns") && text.includes("exact Tron release")));
  assert.deepEqual(validateGateFile(readiness).errors, []);
});
