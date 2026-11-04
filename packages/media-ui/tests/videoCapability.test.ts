import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { VIDEO_PLAYBACK_CAPABILITY } from "../src/videoCapability";

const root = resolve(import.meta.dirname, "../../..");
describe("selected video runtime boundary", () => {
  it("reports blocked, not simulated playback", () => {
    expect(VIDEO_PLAYBACK_CAPABILITY.status).toBe("blocked");
    expect(VIDEO_PLAYBACK_CAPABILITY.library).toBe("react-native-video");
    expect(VIDEO_PLAYBACK_CAPABILITY.requiredRuntime).toBe("Nitro v1");
  });
  it("does not install the rejected Expo Video backend", () => {
    for (const path of ["apps/forge-media-lab/package.json", "packages/media-ui/package.json"]) {
      const manifest = JSON.parse(readFileSync(resolve(root, path), "utf8"));
      for (const section of ["dependencies", "devDependencies", "peerDependencies"]) {
        expect(manifest[section]?.["expo-video"]).toBeUndefined();
      }
    }
  });
  it("does not import or drive an unavailable decoder", () => {
    const source = readFileSync(resolve(root, "packages/media-ui/src/NativeVideoMonitor.tsx"), "utf8");
    expect(source).not.toMatch(/from ["'](?:expo-video|react-native-video)["']/);
    expect(source).not.toContain("setInterval");
    expect(source).not.toContain("store.setState");
    expect(source).toContain("VIDEO_PLAYBACK_CAPABILITY.reason");
  });
});
