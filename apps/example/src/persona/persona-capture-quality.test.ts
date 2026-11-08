import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lumaStats,
  lightingPassed,
  qualityForFrame,
  qualityForCapture,
  faceCoveragePassed,
  headPosePassed,
  LIGHTING_MIN_MEAN,
  LIGHTING_MAX_MEAN,
  FACE_DETECTION_MAX_AGE_MS,
  type FaceDetection,
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

const NOW = 1_000_000;

function detection(over: Partial<FaceDetection> = {}): FaceDetection {
  return {
    faceCount: 1,
    box: { x: 0.35, y: 0.2, width: 0.3, height: 0.4 },
    yawDeg: 0,
    rollDeg: 0,
    at: NOW,
    ...over,
  };
}

test('face coverage passes for a single centered face', () => {
  assert.equal(faceCoveragePassed(detection(), NOW), true);
});

test('face coverage fails without a fresh single face', () => {
  assert.equal(faceCoveragePassed(null, NOW), false);
  assert.equal(faceCoveragePassed(detection({ faceCount: 0, box: null }), NOW), false);
  assert.equal(faceCoveragePassed(detection({ faceCount: 2 }), NOW), false);
  assert.equal(
    faceCoveragePassed(detection({ at: NOW - FACE_DETECTION_MAX_AGE_MS - 1 }), NOW),
    false,
  );
});

test('face coverage rejects tiny, huge and off-center faces', () => {
  assert.equal(
    faceCoveragePassed(detection({ box: { x: 0.4, y: 0.4, width: 0.05, height: 0.05 } }), NOW),
    false,
  );
  assert.equal(
    faceCoveragePassed(detection({ box: { x: 0, y: 0, width: 0.95, height: 0.95 } }), NOW),
    false,
  );
  assert.equal(
    faceCoveragePassed(detection({ box: { x: 0.8, y: 0.1, width: 0.15, height: 0.3 } }), NOW),
    false,
  );
});

test('head pose uses measured yaw/roll and rejects missing angles', () => {
  assert.equal(headPosePassed(detection({ yawDeg: 10, rollDeg: -8 }), NOW), true);
  assert.equal(headPosePassed(detection({ yawDeg: 40 }), NOW), false);
  assert.equal(headPosePassed(detection({ yawDeg: null }), NOW), false);
  assert.equal(headPosePassed(detection({ rollDeg: null }), NOW), false);
});

test('qualityForCapture includes face gates only when detection exists', () => {
  const { buf, w, h, bpr } = yPlane(140);
  const stats = lumaStats(buf, w, h, bpr);
  const lit = qualityForFrame(stats);
  const noDet = qualityForCapture(stats, null, NOW);
  assert.deepEqual(noDet.gateNames, ['lighting']);
  const withDet = qualityForCapture(stats, detection(), NOW);
  assert.deepEqual(withDet.gateNames, ['lighting', 'face_coverage', 'head_pose']);
  assert.deepEqual(withDet.gatePassed, [true, true, true]);
  assert.deepEqual(lit.gatePassed, noDet.gatePassed);
});
