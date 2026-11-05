import { describe, expect, it } from "vitest";
import {
  MAX_DECODED_BYTES, MAX_ENCODED_BYTES, UNKNOWN_DURATION_MAX_ENCODED_BYTES,
  decodedByteEstimate, preDecodeRejection, postDecodeRejection,
} from "../src/webDecodeBounds";

describe("web decode memory bounds", () => {
  it("estimates float32 decoded bytes", () => {
    expect(decodedByteEstimate(10, 48000, 2)).toBe(10 * 48000 * 2 * 4);
    expect(decodedByteEstimate(Number.POSITIVE_INFINITY, 48000, 2)).toBe(Number.POSITIVE_INFINITY);
  });
  it("rejects a known long duration before decoding", () => {
    const reason = preDecodeRejection(1_000_000, 3 * 3600, 48000);
    expect(reason).toMatch(/MiB/);
    expect(preDecodeRejection(1_000_000, 60, 48000)).toBeUndefined();
  });
  it("applies a tighter encoded cap when duration is unknown", () => {
    expect(preDecodeRejection(UNKNOWN_DURATION_MAX_ENCODED_BYTES, Number.NaN, 48000)).toBeUndefined();
    expect(preDecodeRejection(UNKNOWN_DURATION_MAX_ENCODED_BYTES + 1, Number.POSITIVE_INFINITY, 48000))
      .toMatch(/duration is unknown/);
    expect(preDecodeRejection(MAX_ENCODED_BYTES + 1, 1, 48000)).toMatch(/Encoded/);
    expect(preDecodeRejection(0, 1, 48000)).toMatch(/Encoded/);
  });
  it("rejects an oversized decode after the fact", () => {
    const frames = MAX_DECODED_BYTES / 4 + 1;
    expect(postDecodeRejection(frames, 1)).toMatch(/MiB/);
    expect(postDecodeRejection(48000, 2)).toBeUndefined();
  });
});
