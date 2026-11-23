import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { validateGateFile } from "../validate-v1.mjs";

const json = path => JSON.parse(readFileSync(new URL("../../" + path, import.meta.url), "utf8"));

test("F7 owns the application program with unchanged platform requirements and an explicit consumer-release pin", () => {
  const readiness = json("docs/release/v1-readiness.json"), gate = readiness.gates.find(gate => gate.id === "F7");
  const program = gate.componentProgram;
  const completion = json(program.completionLedger), adopted = json(program.adoptedLedger);
  assert.equal(program.owner, "Nitro Forge");
  assert.equal(program.baselineRows, completion.components.length);
  assert.equal(program.baselineRows, adopted.components.length);
  assert.equal(program.additionalRows, adopted.additions.length);
  assert.deepEqual(program.requiredPlatforms, completion.requiredPlatforms);
  assert.deepEqual(program.requiredPlatforms, adopted.requiredPlatforms);
  assert.equal(program.consumerReleasePin, "tooling/nyc-tron.json");
  assert.ok(json(program.consumerReleasePin).tag);
  assert.ok(gate.acceptance.some(text => text.includes("Forge owns") && text.includes("exact Tron release")));
  assert.deepEqual(validateGateFile(readiness).errors, []);
});
