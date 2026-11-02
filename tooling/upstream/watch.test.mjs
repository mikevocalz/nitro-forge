import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCatalog, compareObserved, updateObserved, buildReport } from "./watch.mjs";

const shaA = "a".repeat(40);
const shaB = "b".repeat(40);
const sample = () => ({
  schemaVersion: 1,
  candidates: [{
    name: "photocraft",
    repository: "storytold/photocraft",
    baseRef: "main",
    lastObservedSha: shaA,
    admittedSha: null,
    licenseReview: "unreviewed",
    runtimeStatus: "not-integrated",
  }],
});

test("validates fixed repo identity and exact SHAs", () => {
  assert.equal(validateCatalog(sample()).candidates.length, 1);
  assert.throws(() => validateCatalog({
    ...sample(), candidates: [{
      ...sample().candidates[0], repository: "untrusted/redirect",
    }],
  }));
  assert.throws(() => validateCatalog({
    ...sample(), candidates: [{
      ...sample().candidates[0], lastObservedSha: "main",
    }],
  }));
});

test("records observed HEAD drift without admitting upstream code", () => {
  const before = sample();
  const changes = compareObserved(before, { photocraft: shaB });
  assert.equal(changes.length, 1);
  assert.equal(before.candidates[0].lastObservedSha, shaA);
  const after = updateObserved(before, changes);
  assert.equal(after.candidates[0].lastObservedSha, shaB);
  assert.equal(after.candidates[0].admittedSha, null);
  assert.equal(after.candidates[0].runtimeStatus, "not-integrated");
});

test("no changes leaves catalog identical and excludes report rows", () => {
  const before = sample();
  const changes = compareObserved(before, { photocraft: shaA });
  assert.deepEqual(changes, []);
  assert.deepEqual(updateObserved(before, changes), before);
});

test("summary contains compare link and explicit review requirement", () => {
  const text = buildReport(compareObserved(sample(), { photocraft: shaB }));
  assert.match(text, /photocraft/);
  assert.match(text, /compare/);
  assert.match(text, /No code is admitted/);
});

test("invalid output SHA fails closed", () => {
  assert.throws(() => compareObserved(sample(), { photocraft: "latest" }));
});
