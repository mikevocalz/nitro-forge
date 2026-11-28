import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SEND_LEVEL, ROUTING_GRID_MIN_WIDTH, clampSendLevel, cycleOutput, dragToSendLevel, formatSendLevel,
  outputName, resolveOutput, routingGridWidth, routingLayout, sendLabel, sendLevel, stepSendLevel,
} from "../src/audio/routing.ts";
import {
  INSERT_KINDS, INSERT_KIND_LABELS, MAX_INSERTS, addBlockedReason, describeInsert, filterPresets, moveTarget,
} from "../src/audio/inserts.ts";

const buses = [{ id: "a", name: "Reverb" }, { id: "b", name: "Delay" }];

test("layout switches to the grid only when every column fits", () => {
  assert.equal(routingLayout(0, 2), "cards");
  assert.equal(routingLayout(390, 1), "cards");
  assert.equal(routingLayout(ROUTING_GRID_MIN_WIDTH, 1), "grid");
  assert.equal(routingLayout(ROUTING_GRID_MIN_WIDTH - 1, 1), "cards");
  assert.equal(routingLayout(routingGridWidth(3) - 1, 3), "cards", "three buses need more than 600");
  assert.equal(routingLayout(routingGridWidth(3), 3), "grid");
});

test("send levels clamp, round to percent, step and drag", () => {
  assert.equal(clampSendLevel(1.4), 1);
  assert.equal(clampSendLevel(-0.2), 0);
  assert.equal(clampSendLevel(0.123), 0.12);
  assert.throws(() => clampSendLevel(Number.NaN), RangeError);
  assert.equal(formatSendLevel(DEFAULT_SEND_LEVEL), "50%");
  assert.equal(stepSendLevel(0.5, 1), 0.55);
  assert.equal(stepSendLevel(0.98, 1), 1);
  assert.equal(stepSendLevel(0.5, -1, 0.2), 0.3);
  assert.equal(dragToSendLevel(0.5, 50, 100), 1);
  assert.equal(dragToSendLevel(0.5, -25, 100), 0.25);
  assert.throws(() => dragToSendLevel(0.5, 10, 0), RangeError);
});

test("outputs resolve, name and cycle through master and buses", () => {
  assert.deepEqual(resolveOutput(null, buses), { kind: "master" });
  assert.equal(outputName(resolveOutput("b", buses)), "Delay");
  assert.deepEqual(resolveOutput("gone", buses), { kind: "missing", id: "gone" });
  assert.equal(outputName(resolveOutput("gone", buses)), "Missing bus");
  assert.equal(cycleOutput(null, buses, 1), "a");
  assert.equal(cycleOutput("b", buses, 1), null, "wraps to master");
  assert.equal(cycleOutput(null, buses, -1), "b");
  assert.equal(cycleOutput("gone", buses, 1), "a", "missing output starts from master");
});

test("send lookup and labels", () => {
  const src = { id: 1, name: "Vocal", output: "a", sends: [{ bus: "a", level: 0.3 }] };
  assert.equal(sendLevel(src, "a"), 0.3, "a send to the output bus is legal");
  assert.equal(sendLevel(src, "b"), undefined);
  assert.equal(sendLabel("Vocal", "Reverb"), "Vocal send to Reverb");
});

test("insert kinds, full chain reason, moves and descriptions", () => {
  assert.deepEqual(INSERT_KINDS.map(k => INSERT_KIND_LABELS[k]), ["Gain", "EQ", "Compressor"]);
  assert.equal(MAX_INSERTS, 8);
  assert.equal(addBlockedReason(7), undefined);
  assert.equal(addBlockedReason(8), "All 8 slots are in use. Remove an effect to add another.");
  assert.equal(addBlockedReason(3, 3), "All 3 slots are in use. Remove an effect to add another.");
  assert.equal(moveTarget(0, -1, 3), undefined);
  assert.equal(moveTarget(2, 1, 3), undefined);
  assert.equal(moveTarget(1, 1, 3), 2);
  assert.equal(describeInsert({ kind: "eq", bypassed: true, summary: "Vocal presence" }, 1, 3),
    "Slot 2 of 3, EQ, Vocal presence, bypassed");
  assert.equal(describeInsert({ kind: "gain", bypassed: false }, 0, 1), "Slot 1 of 1, Gain");
});

test("preset filter matches every word, ignores case and accents, keeps order", () => {
  const presets = [
    { id: "flat", label: "Flat" }, { id: "vp", label: "Vocal presence" },
    { id: "bt", label: "Bass tighten" }, { id: "tel", label: "Téléphone" },
  ];
  assert.deepEqual(filterPresets(presets, "").map(p => p.id), ["flat", "vp", "bt", "tel"]);
  assert.deepEqual(filterPresets(presets, "  ").length, 4);
  assert.deepEqual(filterPresets(presets, "VOC").map(p => p.id), ["vp"]);
  assert.deepEqual(filterPresets(presets, "telephone").map(p => p.id), ["tel"]);
  assert.deepEqual(filterPresets(presets, "presence vocal").map(p => p.id), ["vp"]);
  assert.deepEqual(filterPresets(presets, "zzz"), []);
});
