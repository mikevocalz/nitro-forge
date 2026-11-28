import test from "node:test";
import assert from "node:assert/strict";
import { exact } from "../src/exact-optional.ts";

test("exact drops keys whose value is undefined", () => {
  const props = exact({ message: undefined, unstyled: false, title: "Save" });
  assert.deepEqual(props, { unstyled: false, title: "Save" });
  assert.equal(Object.hasOwn(props, "message"), false);
});

test("exact keeps falsy values that are not undefined", () => {
  assert.deepEqual(exact({ a: null, b: 0, c: "", d: false, e: Number.NaN }), { a: null, b: 0, c: "", d: false, e: Number.NaN });
});

test("exact returns a new object and leaves its input unchanged", () => {
  const input = { message: undefined, label: "Gain" };
  const out = exact(input);
  assert.notEqual(out, input);
  assert.deepEqual(input, { message: undefined, label: "Gain" });
});
