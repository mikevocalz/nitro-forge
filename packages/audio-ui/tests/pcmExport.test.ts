import { describe, expect, it } from "vitest";

describe("./pcm export conditions", () => {
  it("fails loudly without a react-native or browser condition", async () => {
    await expect(import("@nitro-forge/audio-ui/pcm")).rejects.toThrow(/export condition/);
  });
});
