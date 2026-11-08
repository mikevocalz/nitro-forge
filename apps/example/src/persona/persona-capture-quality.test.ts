import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lumaStats,
  lightingPassed,
  qualityForFrame,
  LIGHTING_MIN_MEAN,
  LIGHTING_MAX_MEAN,
} from '../persona-capture/quality.ts';
import { CAPTURE_STEPS, CAPTURE_STEP_IDS, CAPTURE_STEP_SKIPPABLE } from '../persona-capture/steps.ts';

function yPlane(meanByte: number, width = 64, height = 64): { buf: ArrayBuffer; w: number; h: number; bpr: number } {
  const bpr = width;
  const buf = new ArrayBuffer(bpr * height);
  new Uint8Array(buf).fill(meanByte);
  return { buf, w: width, h: height, bpr };
}

test('lumaStats samples a uniform mid-gray plane', () => {
  const { buf, w, h, bpr } = yPlane(128);
  const s = lumaStats(buf, w, h, bpr);
  assert.equal(s.samples > 0, true);
  assert.ok(Math.abs(s.mean - 128 / 255) < 0.02);
  assert.equal(s.darkRatio, 0);
});

test('lumaStats flags a dark plane', () => {
  const { buf, w, h, bpr } = yPlane(10);
  const s = lumaStats(buf, w, h, bpr);
  assert.equal(lightingPassed(s), false);
  assert.equal(s.darkRatio, 1);
});

test('lighting gate accepts a normally lit frame', () => {
  const { buf, w, h, bpr } = yPlane(140);
  const s = lumaStats(buf, w, h, bpr);
  const v = qualityForFrame(s);
  assert.deepEqual(v.gateNames, ['lighting']);
  assert.deepEqual(v.gatePassed, [true]);
  assert.ok(s.mean >= LIGHTING_MIN_MEAN && s.mean <= LIGHTING_MAX_MEAN);
});

test('empty stats can never pass the lighting gate', () => {
  const v = qualityForFrame({ mean: 0, darkRatio: 1, samples: 0 });
  assert.deepEqual(v.gatePassed, [false]);
});

test('capture step plan matches the native session contract', () => {
  assert.equal(CAPTURE_STEP_IDS.length, CAPTURE_STEP_SKIPPABLE.length);
  assert.equal(new Set(CAPTURE_STEP_IDS).size, CAPTURE_STEP_IDS.length);
  assert.equal(CAPTURE_STEP_IDS[0], 'front');
  assert.equal(CAPTURE_STEPS.every((s) => s.id && s.prompt), true);
});
